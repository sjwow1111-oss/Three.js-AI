import { PRESETS, normalizeBase, listModels, streamChat, testConnection } from './providers.js';
import { SYSTEM_PROMPT, buildUserPrompt, buildRefinePrompt, buildFixPrompt, extractCode } from './prompts.js';
import { Viewer } from './viewer.js';
import * as store from './store.js';

/* ── small helpers ─────────────────────────────── */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let toastTimer = null;
function toast(text, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function log(line) {
  const el = $('log-out');
  const time = new Date().toLocaleTimeString([], { hour12: false });
  el.textContent += `[${time}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const slug = (s) => (s || 'model').trim().toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'model';

/* ── app state ────────────────────────────────── */
const state = {
  cfg: { ...store.loadSettings(), apiKey: store.loadApiKey() },
  images: [],            // { mime, data(base64), url(dataURL) }
  history: [],           // conversation with the model
  code: '',
  lastPrompt: '',
  busy: false,
  abort: null,
  fixTries: 0,
  view: { autoRotate: false, wireframe: false, grid: true },
};

const viewer = new Viewer($('sandbox'));

/* ══════════════════════════════════════════════════
   1. Connection setup screen
   ══════════════════════════════════════════════════ */
function renderPresets() {
  const box = $('presets');
  box.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.dataset.id = p.id;
    b.className = state.cfg.preset === p.id ? 'on' : '';
    b.onclick = () => {
      state.cfg.preset = p.id;
      if (p.id !== 'custom') {
        $('in-protocol').value = p.protocol;
        $('in-endpoint').value = p.endpoint;
        if (p.model) $('in-model').value = p.model;
      }
      $('model-list').innerHTML = '';
      $('model-status').textContent = '';
      renderPresets();
    };
    box.appendChild(b);
  }
}

function readSetupForm() {
  return {
    preset: state.cfg.preset,
    protocol: $('in-protocol').value,
    endpoint: $('in-endpoint').value.trim(),
    apiKey: $('in-key').value.trim(),
    model: $('in-model').value.trim(),
    proxy: $('in-proxy').checked,
    remember: $('in-remember').checked,
    maxTokens: Number($('in-maxtokens').value) || 8000,
    temperature: Number($('in-temp').value),
  };
}

function fillSetupForm() {
  const c = state.cfg;
  $('in-protocol').value = c.protocol;
  $('in-endpoint').value = c.endpoint;
  $('in-key').value = c.apiKey || '';
  $('in-model').value = c.model || '';
  $('in-proxy').checked = !!c.proxy;
  $('in-remember').checked = !!c.remember;
  $('in-maxtokens').value = c.maxTokens;
  $('in-temp').value = c.temperature;
  renderPresets();
}

function setupMsg(text, kind = 'info') {
  const el = $('setup-msg');
  el.textContent = text;
  el.className = 'msg ' + kind;
}

function validate(cfg) {
  if (!cfg.endpoint) return 'Please enter an endpoint (base URL).';
  try { new URL(normalizeBase(cfg.endpoint)); } catch { return 'That endpoint URL does not look valid.'; }
  if (!cfg.model) return 'Enter a model ID or pick one from the list.';
  return '';
}

$('btn-key-toggle').onclick = () => {
  const el = $('in-key');
  el.type = el.type === 'password' ? 'text' : 'password';
};

$('btn-load-models').onclick = async (e) => {
  const cfg = readSetupForm();
  if (!cfg.endpoint) { setupMsg('Enter an endpoint first.', 'err'); return; }
  e.target.disabled = true;
  $('model-status').textContent = 'Loading models…';
  try {
    const ids = await listModels(cfg);
    $('model-list').innerHTML = ids.map((id) => `<option value="${esc(id)}"></option>`).join('');
    $('model-status').textContent = `Found ${ids.length} models — click the field to pick one.`;
    if (!$('in-model').value && ids.length) {
      const pick = ids.find((i) => /gpt-4o|claude|sonnet|llama-3|qwen/i.test(i)) || ids[0];
      $('in-model').value = pick;
    }
    setupMsg('', 'info');
  } catch (err) {
    $('model-status').textContent = '';
    setupMsg('Could not list models: ' + err.message + ' — you can still type a model ID by hand. (If this is a CORS error, try the local proxy under Advanced.)', 'err');
  } finally {
    e.target.disabled = false;
  }
};

$('btn-test').onclick = async (e) => {
  const cfg = readSetupForm();
  const problem = validate(cfg);
  if (problem) { setupMsg(problem, 'err'); return; }
  e.target.disabled = true;
  setupMsg('Checking the connection…', 'info');
  try {
    const reply = await testConnection(cfg);
    setupMsg(`Connected ✓ the model replied: "${reply}"`, 'ok');
  } catch (err) {
    setupMsg('Connection failed: ' + err.message, 'err');
  } finally {
    e.target.disabled = false;
  }
};

$('btn-start').onclick = () => {
  const cfg = readSetupForm();
  const problem = validate(cfg);
  if (problem) { setupMsg(problem, 'err'); return; }
  state.cfg = cfg;
  const { apiKey, ...persist } = cfg;
  store.saveSettings(persist);
  store.saveApiKey(apiKey, cfg.remember);
  openStudio();
};

/* ══════════════════════════════════════════════════
   2. Studio
   ══════════════════════════════════════════════════ */
function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function openStudio() {
  const c = state.cfg;
  $('conn-info').innerHTML =
    `<b>${esc(c.protocol === 'anthropic' ? 'Anthropic-compatible' : 'OpenAI-compatible')}</b> · ` +
    `<b>${esc(c.model)}</b> · ${esc(normalizeBase(c.endpoint))}${c.proxy ? ' · via proxy' : ''}`;
  showScreen('screen-studio');
  log(`Connected to ${normalizeBase(c.endpoint)} (${c.protocol}) using model ${c.model}`);
}

$('btn-settings').onclick = () => { fillSetupForm(); setupMsg(''); showScreen('screen-setup'); };

/* ── example prompts ──────────────────────────── */
const EXAMPLES = [
  'A tiny log cabin on a snowy mountain, warm light spilling from the windows',
  'A retro red sports car',
  'A wizard tower on a floating island',
  'A low-poly cat',
  'A ringed planet with a moon in orbit',
  'A little succulent garden under a glass dome',
  'A cyberpunk alley sign covered in neon',
];
$('examples').innerHTML = EXAMPLES.map((t, i) => `<button type="button" data-i="${i}">${esc(t)}</button>`).join('');
$('examples').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('in-prompt').value = EXAMPLES[Number(b.dataset.i)];
  $('in-prompt').focus();
};

/* ── reference images ─────────────────────────── */
const MAX_IMAGES = 4;

function fileToDownscaledImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unrecognized image format.'));
      img.onload = () => {
        const max = 1024;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/jpeg', 0.85);
        resolve({ mime: 'image/jpeg', data: url.split(',')[1], url });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addImages(files) {
  for (const file of files) {
    if (state.images.length >= MAX_IMAGES) { toast(`You can attach up to ${MAX_IMAGES} photos.`); break; }
    if (!file.type.startsWith('image/')) continue;
    try { state.images.push(await fileToDownscaledImage(file)); }
    catch (err) { toast(err.message); }
  }
  renderThumbs();
}

function renderThumbs() {
  const box = $('thumbs');
  box.innerHTML = state.images
    .map((im, i) => `<div class="thumb"><img src="${im.url}" alt="Reference photo ${i + 1}"><button type="button" data-i="${i}" title="Remove">×</button></div>`)
    .join('');
  $$('button', box).forEach((b) => {
    b.onclick = () => { state.images.splice(Number(b.dataset.i), 1); renderThumbs(); };
  });
}

$('btn-pick').onclick = () => $('in-images').click();
$('in-images').onchange = (e) => { addImages([...e.target.files]); e.target.value = ''; };

const dz = $('dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
  e.preventDefault(); dz.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
  e.preventDefault(); dz.classList.remove('over');
}));
dz.addEventListener('drop', (e) => addImages([...(e.dataTransfer?.files || [])]));
document.addEventListener('paste', (e) => {
  if (!$('screen-studio').classList.contains('active')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addImages(files); }
});

/* ── tabs ─────────────────────────────────────── */
$$('.tab').forEach((tab) => {
  tab.onclick = () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === tab.dataset.view));
  };
});
const showTab = (name) => $$('.tab').find((t) => t.dataset.view === name)?.click();

/* ── viewer toggles ───────────────────────────── */
function bindToggle(id, key, label) {
  const btn = $(id);
  btn.classList.toggle('on', state.view[key]);
  btn.onclick = () => {
    state.view[key] = !state.view[key];
    btn.classList.toggle('on', state.view[key]);
    viewer.setOptions({ [key]: state.view[key] });
    toast(`${label} ${state.view[key] ? 'on' : 'off'}`, 1100);
  };
}
bindToggle('btn-rotate', 'autoRotate', 'Auto-rotate');
bindToggle('btn-wire', 'wireframe', 'Wireframe');
bindToggle('btn-grid', 'grid', 'Grid');

$('btn-shot').onclick = async () => {
  if (!state.code) { toast('Generate a model first.'); return; }
  try {
    const dataUrl = await viewer.screenshot();
    const blob = await (await fetch(dataUrl)).blob();
    download(blob, `${slug(state.lastPrompt)}.png`);
    toast('Saved a PNG.');
  } catch (err) { toast('Capture failed: ' + err.message); }
};

$('btn-glb').onclick = async () => {
  if (!state.code) { toast('Generate a model first.'); return; }
  try {
    const buffer = await viewer.exportGLB();
    download(new Blob([buffer], { type: 'model/gltf-binary' }), `${slug(state.lastPrompt)}.glb`);
    toast('Saved a GLB — open it in Blender or a game engine.');
  } catch (err) { toast('GLB export failed: ' + err.message); }
};

$('btn-code-dl').onclick = () => {
  if (!state.code) { toast('Generate a model first.'); return; }
  download(new Blob([state.code], { type: 'text/javascript' }), `${slug(state.lastPrompt)}.js`);
};

/* ── generation pipeline ──────────────────────── */
function setBusy(on, text = '', sub = '') {
  state.busy = on;
  $('viewer-busy').hidden = !on;
  $('busy-text').textContent = text;
  $('busy-sub').textContent = sub;
  $('btn-generate').disabled = on;
  $('btn-refine').disabled = on;
  $('btn-stop').hidden = !on;
  if (on) { $('viewer-error').hidden = true; $('viewer-empty').hidden = true; }
}

function showError(message) {
  $('error-text').textContent = message;
  $('viewer-error').hidden = false;
  $('viewer-empty').hidden = true;
  log('Error: ' + message.split('\n')[0]);
}

$('btn-stop').onclick = () => {
  state.abort?.abort();
  toast('Generation stopped.');
};

/** Ask the model for code and stream the answer in */
async function askForCode(userMessage, busyLabel) {
  setBusy(true, busyLabel, 'Waiting for the first tokens…');
  const controller = new AbortController();
  state.abort = controller;

  state.history.push(userMessage);
  if (state.history.length > 8) state.history.splice(0, state.history.length - 8);

  let streamed = '';
  let reply;
  try {
    reply = await streamChat(state.cfg, {
      system: SYSTEM_PROMPT,
      messages: state.history,
      signal: controller.signal,
      onDelta: (chunk) => {
        streamed += chunk;
        $('code-out').textContent = streamed;
        $('busy-sub').textContent = `${streamed.length.toLocaleString()} characters so far…`;
      },
    });
  } catch (err) {
    state.history.pop();
    state.abort = null;
    throw err;
  }
  state.abort = null;

  const code = extractCode(reply);
  state.history.push({ role: 'assistant', text: '```javascript\n' + code + '\n```' });
  return code;
}

/** Run the code in the viewer; on failure, ask the AI to fix it once */
async function runCode(code) {
  state.code = code;
  $('code-out').textContent = code;
  setBusy(true, 'Building the 3D scene…', '');
  try {
    const stats = await viewer.run(code);
    state.fixTries = 0;
    setBusy(false);
    $('viewer-error').hidden = true;
    $('viewer-empty').hidden = true;
    $('followup').hidden = false;
    $('stat-line').textContent =
      `${stats.meshes} meshes · ${stats.triangles.toLocaleString()} triangles · built in ${stats.ms}ms` +
      (stats.animated ? ' · animated' : '');
    log(`Model ready (${stats.meshes} meshes, ${stats.triangles} triangles)`);
    saveSnapshotToGallery();
    return true;
  } catch (err) {
    setBusy(false);
    const message = err.message || String(err);
    if (viewer.bootError) { showError(message); return false; }
    if (state.fixTries < 1) {
      state.fixTries++;
      log('Runtime error — asking the AI to fix it.');
      toast('That code threw an error — asking the AI to fix it…');
      return autoFix(message);
    }
    showError(message);
    return false;
  }
}

async function autoFix(errorMessage) {
  try {
    const code = await askForCode(
      { role: 'user', text: buildFixPrompt(errorMessage) },
      'Fixing the error…'
    );
    return runCode(code);
  } catch (err) {
    setBusy(false);
    showError(errorMessage + '\n\n[auto-fix failed] ' + (err.message || err));
    return false;
  }
}

$('btn-autofix').onclick = () => {
  state.fixTries = 0;
  const message = $('error-text').textContent;
  $('viewer-error').hidden = true;
  autoFix(message);
};

$('btn-generate').onclick = async () => {
  const prompt = $('in-prompt').value.trim();
  if (!prompt && !state.images.length) { toast('Describe what you want, or attach a photo.'); return; }

  state.history = [];
  state.fixTries = 0;
  state.lastPrompt = prompt || 'model from photos';
  $('code-out').textContent = '';
  showTab('preview');

  const text = buildUserPrompt({
    prompt,
    style: $('in-style').value,
    detail: $('in-detail').value,
    animate: $('in-animate').checked,
    hasImages: state.images.length > 0,
  });
  log(`Generating: "${state.lastPrompt}" (${state.images.length} photo(s))`);

  try {
    const code = await askForCode(
      { role: 'user', text, images: state.images.map(({ mime, data }) => ({ mime, data })) },
      'The AI is designing your model…'
    );
    await runCode(code);
  } catch (err) {
    setBusy(false);
    if (err.name === 'AbortError') { $('viewer-empty').hidden = false; return; }
    showError('API request failed\n' + (err.message || err));
  }
};

$('btn-refine').onclick = async () => {
  const instruction = $('in-followup').value.trim();
  if (!instruction) { toast('Describe what you want changed.'); return; }
  if (!state.code) { toast('Generate a model first.'); return; }
  state.fixTries = 0;
  log('Refine: ' + instruction);
  try {
    const code = await askForCode({ role: 'user', text: buildRefinePrompt(instruction) }, 'Updating the model…');
    $('in-followup').value = '';
    await runCode(code);
  } catch (err) {
    setBusy(false);
    if (err.name === 'AbortError') return;
    showError('API request failed\n' + (err.message || err));
  }
};

/* ── gallery ──────────────────────────────────── */
async function saveSnapshotToGallery() {
  try {
    await new Promise((r) => setTimeout(r, 350));   // let the first frames settle
    const thumb = await viewer.thumbnail();
    store.addToGallery({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: state.lastPrompt,
      code: state.code,
      thumb,
      at: Date.now(),
    });
    renderGallery();
  } catch (err) {
    log('Skipped saving to the gallery: ' + (err.message || err));
  }
}

function renderGallery() {
  const rows = store.loadGallery();
  $('gallery-count').textContent = `${rows.length} saved`;
  const box = $('gallery-items');
  if (!rows.length) {
    box.innerHTML = '<p class="dim">Nothing saved yet — every model you generate lands here automatically.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="gcard" data-id="${r.id}">
      <img src="${r.thumb}" alt="${esc(r.title)}" loading="lazy">
      <div class="meta">
        <div class="title">${esc(r.title)}</div>
        <div class="when">${new Date(r.at).toLocaleString()}</div>
      </div>
      <button class="del" type="button" data-del="${r.id}">Delete</button>
    </div>`).join('');

  $$('.gcard', box).forEach((card) => {
    card.onclick = (e) => {
      if (e.target.dataset.del) return;
      const item = store.loadGallery().find((r) => r.id === card.dataset.id);
      if (!item) return;
      state.lastPrompt = item.title;
      state.history = [];
      state.fixTries = 0;
      $('gallery').hidden = true;
      showTab('preview');
      runCode(item.code);
      toast('Loaded from the gallery.');
    };
  });
  $$('[data-del]', box).forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); store.removeFromGallery(b.dataset.del); renderGallery(); };
  });
}

$('btn-gallery').onclick = () => { $('gallery').hidden = !$('gallery').hidden; renderGallery(); };
$('btn-gallery-close').onclick = () => { $('gallery').hidden = true; };
$('btn-gallery-clear').onclick = () => {
  if (confirm('Delete every model saved in the gallery?')) { store.clearGallery(); renderGallery(); }
};

/* ── viewer events ────────────────────────────── */
viewer.onError = (message) => {
  if (state.busy) return;                 // errors during generation are handled by the pipeline
  if (!state.code) showError(message);    // boot failure and the like
  else log('Viewer warning: ' + message.split('\n')[0]);
};

/* ── boot ─────────────────────────────────────── */
fillSetupForm();
renderGallery();
viewer.ready.then(() => {
  viewer.setOptions(state.view);
  log('Viewer ready (sandboxed iframe)');
}).catch((err) => {
  log('Viewer failed to start: ' + err.message);
});

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && $('screen-studio').classList.contains('active')) {
    e.preventDefault();
    (document.activeElement === $('in-followup') ? $('btn-refine') : $('btn-generate')).click();
  }
});
