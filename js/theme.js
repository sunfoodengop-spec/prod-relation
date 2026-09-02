const KEY = 'gsb_theme';

export function getTheme() {
  return localStorage.getItem(KEY) || 'dark';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function initTheme() {
  applyTheme(getTheme());
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(KEY, next);
  applyTheme(next);
  return next;
}

export function themeToggleButtonHtml() {
  const isLight = getTheme() === 'light';
  return `<button class="btn btn-sm theme-toggle-btn" id="theme-toggle-btn" title="สลับโหมดสว่าง/มืด">${isLight ? '🌙' : '☀️'}</button>`;
}

export function wireThemeToggle(buttonEl) {
  if (!buttonEl) return;
  buttonEl.onclick = () => {
    const next = toggleTheme();
    buttonEl.textContent = next === 'light' ? '🌙' : '☀️';
  };
}
