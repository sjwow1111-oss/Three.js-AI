/** localStorage 기반 설정 · 갤러리 저장소 */

const SETTINGS_KEY = 'threejs-ai-studio.settings';
const KEY_KEY = 'threejs-ai-studio.apikey';
const GALLERY_KEY = 'threejs-ai-studio.gallery';
const GALLERY_MAX = 24;

const read = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { return false; }
};

export const DEFAULT_SETTINGS = {
  preset: 'openai',
  protocol: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: '',
  proxy: false,
  remember: false,
  maxTokens: 8000,
  temperature: 0.7,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}
export function saveSettings(s) {
  write(SETTINGS_KEY, s);
}

export function loadApiKey() {
  try { return localStorage.getItem(KEY_KEY) || ''; } catch { return ''; }
}
export function saveApiKey(key, remember) {
  try {
    if (remember && key) localStorage.setItem(KEY_KEY, key);
    else localStorage.removeItem(KEY_KEY);
  } catch { /* 저장 불가 환경 */ }
}

/* ── 갤러리 ─────────────────────────────────────── */
export function loadGallery() {
  const rows = read(GALLERY_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function addToGallery(item) {
  const rows = loadGallery();
  rows.unshift(item);
  while (rows.length > GALLERY_MAX) rows.pop();
  // 용량 초과 시 오래된 항목부터 버리며 재시도
  while (rows.length && !write(GALLERY_KEY, rows)) rows.pop();
  return rows;
}

export function removeFromGallery(id) {
  const rows = loadGallery().filter((r) => r.id !== id);
  write(GALLERY_KEY, rows);
  return rows;
}

export function clearGallery() {
  write(GALLERY_KEY, []);
  return [];
}
