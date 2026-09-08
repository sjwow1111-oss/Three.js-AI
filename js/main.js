import { PRESETS, normalizeBase, listModels, streamChat, testConnection } from './providers.js';
import { SYSTEM_PROMPT, buildUserPrompt, buildRefinePrompt, buildFixPrompt, extractCode } from './prompts.js';
import { Viewer } from './viewer.js';
import * as store from './store.js';

/* ── 짧은 헬퍼 ──────────────────────────────────── */
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
  const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
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

/* ── 앱 상태 ────────────────────────────────────── */
const state = {
  cfg: { ...store.loadSettings(), apiKey: store.loadApiKey() },
  images: [],            // { mime, data(base64), url(dataURL) }
  history: [],           // 모델과 주고받은 대화
  code: '',
  lastPrompt: '',
  busy: false,
  abort: null,
  fixTries: 0,
  view: { autoRotate: false, wireframe: false, grid: true },
};

const viewer = new Viewer($('sandbox'));

/* ══════════════════════════════════════════════════
   1. 연결 설정 화면
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
  if (!cfg.endpoint) return '엔드포인트(Base URL)를 입력해 주세요.';
  try { new URL(normalizeBase(cfg.endpoint)); } catch { return '엔드포인트 주소 형식이 올바르지 않습니다.'; }
  if (!cfg.model) return '모델 ID를 입력하거나 목록에서 선택해 주세요.';
  return '';
}

$('btn-key-toggle').onclick = () => {
  const el = $('in-key');
  el.type = el.type === 'password' ? 'text' : 'password';
};

$('btn-load-models').onclick = async (e) => {
  const cfg = readSetupForm();
  if (!cfg.endpoint) { setupMsg('먼저 엔드포인트를 입력해 주세요.', 'err'); return; }
  e.target.disabled = true;
  $('model-status').textContent = '모델 목록을 불러오는 중…';
  try {
    const ids = await listModels(cfg);
    $('model-list').innerHTML = ids.map((id) => `<option value="${esc(id)}"></option>`).join('');
    $('model-status').textContent = `${ids.length}개 모델을 찾았습니다. 입력창을 클릭해 선택하세요.`;
    if (!$('in-model').value && ids.length) {
      const pick = ids.find((i) => /gpt-4o|claude|sonnet|llama-3|qwen/i.test(i)) || ids[0];
      $('in-model').value = pick;
    }
    setupMsg('', 'info');
  } catch (err) {
    $('model-status').textContent = '';
    setupMsg('모델 목록 실패: ' + err.message + ' — 모델 ID를 직접 입력해도 됩니다. (CORS 오류라면 고급 설정에서 프록시를 켜 보세요.)', 'err');
  } finally {
    e.target.disabled = false;
  }
};

$('btn-test').onclick = async (e) => {
  const cfg = readSetupForm();
  const problem = validate(cfg);
  if (problem) { setupMsg(problem, 'err'); return; }
  e.target.disabled = true;
  setupMsg('연결을 확인하는 중…', 'info');
  try {
    const reply = await testConnection(cfg);
    setupMsg(`연결 성공 ✓ 모델 응답: "${reply}"`, 'ok');
  } catch (err) {
    setupMsg('연결 실패: ' + err.message, 'err');
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
   2. 스튜디오
   ══════════════════════════════════════════════════ */
function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function openStudio() {
  const c = state.cfg;
  $('conn-info').innerHTML =
    `<b>${esc(c.protocol === 'anthropic' ? 'Anthropic 호환' : 'OpenAI 호환')}</b> · ` +
    `<b>${esc(c.model)}</b> · ${esc(normalizeBase(c.endpoint))}${c.proxy ? ' · 프록시' : ''}`;
  showScreen('screen-studio');
  log(`연결됨: ${normalizeBase(c.endpoint)} (${c.protocol}) / 모델 ${c.model}`);
}

$('btn-settings').onclick = () => { fillSetupForm(); setupMsg(''); showScreen('screen-setup'); };

/* ── 예시 프롬프트 ─────────────────────────────── */
const EXAMPLES = [
  '눈 덮인 산 위의 작은 통나무집, 창문에서 새어나오는 따뜻한 불빛',
  '레트로 스타일의 빨간 스포츠카',
  '떠다니는 섬 위의 마법사 탑',
  '로우폴리 고양이',
  '토성 같은 고리를 가진 행성과 궤도를 도는 위성',
  '유리 돔 안의 작은 다육식물 정원',
  '네온사인이 가득한 사이버펑크 골목 간판',
];
$('examples').innerHTML = EXAMPLES.map((t, i) => `<button type="button" data-i="${i}">${esc(t)}</button>`).join('');
$('examples').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('in-prompt').value = EXAMPLES[Number(b.dataset.i)];
  $('in-prompt').focus();
};

/* ── 이미지 입력 ───────────────────────────────── */
const MAX_IMAGES = 4;

function fileToDownscaledImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지 형식을 인식하지 못했습니다.'));
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
    if (state.images.length >= MAX_IMAGES) { toast(`사진은 최대 ${MAX_IMAGES}장까지 첨부됩니다.`); break; }
    if (!file.type.startsWith('image/')) continue;
    try { state.images.push(await fileToDownscaledImage(file)); }
    catch (err) { toast(err.message); }
  }
  renderThumbs();
}

function renderThumbs() {
  const box = $('thumbs');
  box.innerHTML = state.images
    .map((im, i) => `<div class="thumb"><img src="${im.url}" alt="참고 사진 ${i + 1}"><button type="button" data-i="${i}" title="삭제">×</button></div>`)
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

/* ── 탭 전환 ───────────────────────────────────── */
$$('.tab').forEach((tab) => {
  tab.onclick = () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === tab.dataset.view));
  };
});
const showTab = (name) => $$('.tab').find((t) => t.dataset.view === name)?.click();

/* ── 뷰어 옵션 버튼 ────────────────────────────── */
function bindToggle(id, key, label) {
  const btn = $(id);
  btn.classList.toggle('on', state.view[key]);
  btn.onclick = () => {
    state.view[key] = !state.view[key];
    btn.classList.toggle('on', state.view[key]);
    viewer.setOptions({ [key]: state.view[key] });
    toast(`${label} ${state.view[key] ? '켜짐' : '꺼짐'}`, 1100);
  };
}
bindToggle('btn-rotate', 'autoRotate', '자동 회전');
bindToggle('btn-wire', 'wireframe', '와이어프레임');
bindToggle('btn-grid', 'grid', '그리드');

$('btn-shot').onclick = async () => {
  if (!state.code) { toast('먼저 모델을 생성해 주세요.'); return; }
  try {
    const dataUrl = await viewer.screenshot();
    const blob = await (await fetch(dataUrl)).blob();
    download(blob, `${slug(state.lastPrompt)}.png`);
    toast('PNG를 저장했습니다.');
  } catch (err) { toast('캡처 실패: ' + err.message); }
};

$('btn-glb').onclick = async () => {
  if (!state.code) { toast('먼저 모델을 생성해 주세요.'); return; }
  try {
    const buffer = await viewer.exportGLB();
    download(new Blob([buffer], { type: 'model/gltf-binary' }), `${slug(state.lastPrompt)}.glb`);
    toast('GLB를 저장했습니다. Blender·게임엔진에서 열 수 있어요.');
  } catch (err) { toast('GLB 내보내기 실패: ' + err.message); }
};

$('btn-code-dl').onclick = () => {
  if (!state.code) { toast('먼저 모델을 생성해 주세요.'); return; }
  download(new Blob([state.code], { type: 'text/javascript' }), `${slug(state.lastPrompt)}.js`);
};

/* ── 생성 파이프라인 ───────────────────────────── */
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
  log('오류: ' + message.split('\n')[0]);
}

$('btn-stop').onclick = () => {
  state.abort?.abort();
  toast('생성을 중지했습니다.');
};

/** 모델에게 코드를 요청하고 스트리밍으로 받아온다 */
async function askForCode(userMessage, busyLabel) {
  setBusy(true, busyLabel, '응답을 기다리는 중…');
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
        $('busy-sub').textContent = `${streamed.length.toLocaleString()}자 생성됨…`;
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

/** 코드를 뷰어에서 실행하고, 실패하면 한 번 자동 수정을 시도한다 */
async function runCode(code) {
  state.code = code;
  $('code-out').textContent = code;
  setBusy(true, '3D 씬을 만드는 중…', '');
  try {
    const stats = await viewer.run(code);
    state.fixTries = 0;
    setBusy(false);
    $('viewer-error').hidden = true;
    $('viewer-empty').hidden = true;
    $('followup').hidden = false;
    $('stat-line').textContent =
      `메시 ${stats.meshes}개 · 삼각형 ${stats.triangles.toLocaleString()}개 · 빌드 ${stats.ms}ms` +
      (stats.animated ? ' · 애니메이션 있음' : '');
    log(`모델 생성 완료 (메시 ${stats.meshes}, 삼각형 ${stats.triangles})`);
    saveSnapshotToGallery();
    return true;
  } catch (err) {
    setBusy(false);
    const message = err.message || String(err);
    if (viewer.bootError) { showError(message); return false; }
    if (state.fixTries < 1) {
      state.fixTries++;
      log('실행 오류 발생 → AI에게 자동 수정을 요청합니다.');
      toast('오류가 나서 AI에게 수정을 요청했습니다…');
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
      '오류를 고치는 중…'
    );
    return runCode(code);
  } catch (err) {
    setBusy(false);
    showError(errorMessage + '\n\n[자동 수정 실패] ' + (err.message || err));
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
  if (!prompt && !state.images.length) { toast('만들고 싶은 것을 적거나 사진을 첨부해 주세요.'); return; }

  state.history = [];
  state.fixTries = 0;
  state.lastPrompt = prompt || '사진 기반 모델';
  $('code-out').textContent = '';
  showTab('preview');

  const text = buildUserPrompt({
    prompt,
    style: $('in-style').value,
    detail: $('in-detail').value,
    animate: $('in-animate').checked,
    hasImages: state.images.length > 0,
  });
  log(`생성 요청: "${state.lastPrompt}" (사진 ${state.images.length}장)`);

  try {
    const code = await askForCode(
      { role: 'user', text, images: state.images.map(({ mime, data }) => ({ mime, data })) },
      'AI가 모델을 설계하는 중…'
    );
    await runCode(code);
  } catch (err) {
    setBusy(false);
    if (err.name === 'AbortError') { $('viewer-empty').hidden = false; return; }
    showError('API 요청 실패\n' + (err.message || err));
  }
};

$('btn-refine').onclick = async () => {
  const instruction = $('in-followup').value.trim();
  if (!instruction) { toast('무엇을 바꿀지 적어 주세요.'); return; }
  if (!state.code) { toast('먼저 모델을 생성해 주세요.'); return; }
  state.fixTries = 0;
  log('수정 요청: ' + instruction);
  try {
    const code = await askForCode({ role: 'user', text: buildRefinePrompt(instruction) }, '모델을 수정하는 중…');
    $('in-followup').value = '';
    await runCode(code);
  } catch (err) {
    setBusy(false);
    if (err.name === 'AbortError') return;
    showError('API 요청 실패\n' + (err.message || err));
  }
};

/* ── 갤러리 ────────────────────────────────────── */
async function saveSnapshotToGallery() {
  try {
    await new Promise((r) => setTimeout(r, 350));   // 첫 프레임이 안정될 시간
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
    log('갤러리 저장 건너뜀: ' + (err.message || err));
  }
}

function renderGallery() {
  const rows = store.loadGallery();
  $('gallery-count').textContent = `${rows.length}개`;
  const box = $('gallery-items');
  if (!rows.length) {
    box.innerHTML = '<p class="dim">아직 저장된 작품이 없습니다. 모델을 생성하면 자동으로 쌓입니다.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="gcard" data-id="${r.id}">
      <img src="${r.thumb}" alt="${esc(r.title)}" loading="lazy">
      <div class="meta">
        <div class="title">${esc(r.title)}</div>
        <div class="when">${new Date(r.at).toLocaleString('ko-KR')}</div>
      </div>
      <button class="del" type="button" data-del="${r.id}">삭제</button>
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
      toast('갤러리에서 불러왔습니다.');
    };
  });
  $$('[data-del]', box).forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); store.removeFromGallery(b.dataset.del); renderGallery(); };
  });
}

$('btn-gallery').onclick = () => { $('gallery').hidden = !$('gallery').hidden; renderGallery(); };
$('btn-gallery-close').onclick = () => { $('gallery').hidden = true; };
$('btn-gallery-clear').onclick = () => {
  if (confirm('갤러리의 모든 작품을 삭제할까요?')) { store.clearGallery(); renderGallery(); }
};

/* ── 뷰어 이벤트 ───────────────────────────────── */
viewer.onError = (message) => {
  if (state.busy) return;                 // 생성 중 오류는 파이프라인이 처리한다
  if (!state.code) showError(message);    // 뷰어 부팅 실패 등
  else log('뷰어 경고: ' + message.split('\n')[0]);
};

/* ── 시작 ──────────────────────────────────────── */
fillSetupForm();
renderGallery();
viewer.ready.then(() => {
  viewer.setOptions(state.view);
  log('뷰어 준비 완료 (샌드박스 iframe)');
}).catch((err) => {
  log('뷰어 초기화 실패: ' + err.message);
});

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && $('screen-studio').classList.contains('active')) {
    e.preventDefault();
    (document.activeElement === $('in-followup') ? $('btn-refine') : $('btn-generate')).click();
  }
});
