const TOKEN_KEY = 'gsb_session_token';
const USER_KEY = 'gsb_user';

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function updateUser(patch) {
  const u = getUser();
  if (!u) return;
  const merged = { ...u, ...patch };
  localStorage.setItem(USER_KEY, JSON.stringify(merged));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
  return !!getToken() && !!getUser();
}

export function requireLoginOrRedirect() {
  if (!isLoggedIn()) {
    window.location.href = './login.html';
    return false;
  }
  return true;
}
