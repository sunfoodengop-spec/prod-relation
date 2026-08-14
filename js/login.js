import { api } from './api.js';
import { saveSession, isLoggedIn, getUser } from './session.js';

if (isLoggedIn() && !getUser()?.is_first_login) {
  window.location.href = './app.html';
}

const loginForm = document.getElementById('login-form');
const resetForm = document.getElementById('reset-form');
const errorSlot = document.getElementById('error-slot');

function showError(msg) {
  errorSlot.innerHTML = `<div class="error-box">${msg}</div>`;
}
function clearError() { errorSlot.innerHTML = ''; }

let pendingUser = null; // holds profile while forcing password reset

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังเข้าสู่ระบบ...';

  const empCode = document.getElementById('emp-code').value.trim();
  const password = document.getElementById('password').value;

  try {
    const rows = await api.login(empCode, password);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง');

    const user = {
      user_id: row.user_id, first_name: row.first_name, last_name: row.last_name,
      nickname: row.nickname, position_title: row.position_title, department: row.department,
      role: row.role, org_level: row.org_level, is_first_login: row.is_first_login,
    };
    saveSession(row.session_token, user);

    if (row.is_first_login) {
      pendingUser = user;
      loginForm.style.display = 'none';
      resetForm.style.display = 'block';
    } else {
      window.location.href = './app.html';
    }
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
  }
});

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const newPass = document.getElementById('new-password').value;
  const confirmPass = document.getElementById('confirm-password').value;
  if (newPass !== confirmPass) { showError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน'); return; }

  const btn = document.getElementById('reset-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
  try {
    await api.changePassword(newPass);
    window.location.href = './app.html';
  } catch (err) {
    showError(err.message);
    btn.disabled = false; btn.textContent = 'บันทึกและเข้าสู่ระบบ';
  }
});
