/**
 * Adapters for AI platforms.
 * Supports both the OpenAI-compatible (/chat/completions) and Anthropic-compatible
 * (/messages) shapes. Either way, messages come in this common form:
 *   { role:'user'|'assistant', text:string, images?:[{mime,data}] }   // data = base64 without the prefix
 */

export const PRESETS = [
  { id:'openai',     label:'OpenAI',       protocol:'openai',    endpoint:'https://api.openai.com/v1',        model:'gpt-4o' },
  { id:'anthropic',  label:'Anthropic',    protocol:'anthropic', endpoint:'https://api.anthropic.com/v1',     model:'claude-sonnet-4-5' },
  { id:'openrouter', label:'OpenRouter',   protocol:'openai',    endpoint:'https://openrouter.ai/api/v1',     model:'' },
  { id:'groq',       label:'Groq',         protocol:'openai',    endpoint:'https://api.groq.com/openai/v1',   model:'' },
  { id:'together',   label:'Together',     protocol:'openai',    endpoint:'https://api.together.xyz/v1',      model:'' },
  { id:'deepseek',   label:'DeepSeek',     protocol:'openai',    endpoint:'https://api.deepseek.com/v1',      model:'deepseek-chat' },
  { id:'mistral',    label:'Mistral',      protocol:'openai',    endpoint:'https://api.mistral.ai/v1',        model:'' },
  { id:'ollama',     label:'Ollama (local)', protocol:'openai',   endpoint:'http://localhost:11434/v1',        model:'' },
  { id:'lmstudio',   label:'LM Studio',    protocol:'openai',    endpoint:'http://localhost:1234/v1',         model:'' },
  { id:'custom',     label:'Custom',        protocol:'openai',    endpoint:'',                                 model:'' },
];

/** Normalize a base URL: drop trailing slashes and endpoint paths, default to /v1 when no path is given */
export function normalizeBase(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/(chat\/completions|completions|messages|responses|models)$/i, '');
  try {
    const url = new URL(u);
    if (url.pathname === '' || url.pathname === '/') u = url.origin + '/v1';
  } catch { /* keep as typed */ }
  return u.replace(/\/+$/, '');
}

function headersFor(cfg) {
  const h = { 'content-type': 'application/json' };
  if (cfg.protocol === 'anthropic') {
    if (cfg.apiKey) h['x-api-key'] = cfg.apiKey;
    h['anthropic-version'] = '2023-06-01';
    // required to call the official Anthropic API straight from a browser
    h['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (cfg.apiKey) {
    h['authorization'] = 'Bearer ' + cfg.apiKey;
  }
  return h;
}

function requestUrl(cfg, path) {
  const target = normalizeBase(cfg.endpoint) + path;
  return cfg.proxy ? '/api/proxy?url=' + encodeURIComponent(target) : target;
}

async function readError(res) {
  let detail = '';
  try {
    const txt = await res.text();
    try {
      const j = JSON.parse(txt);
      detail = j?.error?.message || j?.message || j?.error || txt;
    } catch { detail = txt; }
  } catch { /* ignore */ }
  detail = String(detail || '').slice(0, 600);
  return new Error(`Request failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
}

/* ── model listing ─────────────────────────────────── */
export async function listModels(cfg) {
  const res = await fetch(requestUrl(cfg, '/models'), { headers: headersFor(cfg) });
  if (!res.ok) throw await readError(res);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : (json.data || json.models || []);
  const ids = rows
    .map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model))
    .filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/* ── message conversion ────────────────────────────── */
function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (!m.images?.length) { out.push({ role: m.role, content: m.text }); continue; }
    const parts = [];
    if (m.text) parts.push({ type: 'text', text: m.text });
    for (const img of m.images) {
      parts.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } });
    }
    out.push({ role: m.role, content: parts });
  }
  return out;
}

function toAnthropicMessages(messages) {
  return messages.map((m) => {
    if (!m.images?.length) return { role: m.role, content: m.text };
    const parts = m.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.data },
    }));
    if (m.text) parts.push({ type: 'text', text: m.text });
    return { role: m.role, content: parts };
  });
}

/* ── SSE stream parser ─────────────────────────────── */
async function* sseLines(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + (buf[idx] === '\r' ? 4 : 2));
      const data = chunk
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (data) yield data;
    }
  }
}

/**
 * Streaming chat. Pushes chunks through onDelta(textChunk) and returns the full text.
 */
export async function streamChat(cfg, { system, messages, signal, onDelta }) {
  const isAnthropic = cfg.protocol === 'anthropic';
  const path = isAnthropic ? '/messages' : '/chat/completions';
  const maxTokens = Number(cfg.maxTokens) || 8000;
  const temperature = Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : 0.7;

  const body = isAnthropic
    ? { model: cfg.model, system, messages: toAnthropicMessages(messages), max_tokens: maxTokens, temperature, stream: true }
    : { model: cfg.model, messages: toOpenAIMessages(system, messages), max_tokens: maxTokens, temperature, stream: true };

  const res = await fetch(requestUrl(cfg, path), {
    method: 'POST',
    headers: headersFor(cfg),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res);
  if (!res.body) throw new Error('Could not read the streaming response.');

  let full = '';
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    let evt;
    try { evt = JSON.parse(data); } catch { continue; }

    if (isAnthropic) {
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        full += evt.delta.text; onDelta?.(evt.delta.text);
      } else if (evt.type === 'error') {
        throw new Error(evt.error?.message || 'Anthropic stream error');
      }
    } else {
      const d = evt.choices?.[0]?.delta;
      const piece = d?.content ?? evt.choices?.[0]?.text ?? '';
      if (typeof piece === 'string' && piece) { full += piece; onDelta?.(piece); }
      else if (Array.isArray(piece)) {
        for (const p of piece) if (p?.text) { full += p.text; onDelta?.(p.text); }
      }
      if (evt.error) throw new Error(evt.error.message || 'API stream error');
    }
  }
  if (!full.trim()) throw new Error('The model returned an empty response. Try a different model.');
  return full;
}

/** Minimal call used by the connection test */
export async function testConnection(cfg) {
  const text = await streamChat(cfg, {
    system: 'You are a connectivity probe. Reply with exactly: OK',
    messages: [{ role: 'user', text: 'ping' }],
  });
  return text.trim().slice(0, 40);
}
