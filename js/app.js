import { requireLoginOrRedirect, getUser, clearSession } from './session.js';
import { initials } from './ui.js';

if (!requireLoginOrRedirect()) {
  throw new Error('redirecting to login');
}

const user = getUser();

const ROLE_LABEL = { STAFF: 'เจ้าหน้าที่', SUPERVISOR: 'หัวหน้างาน', ADMIN: 'ผู้ดูแลระบบ' };
const PAGE_TITLES = {
  dashboard: 'ภาพรวม', goals: 'เป้าหมาย & ทีเด็ด', scoreboard: 'Scoreboard รายเดือน',
  approvals: 'รายการรออนุมัติ', analytics: 'วิเคราะห์ผลงาน', org: 'ผังองค์กร',
  export: 'ส่งออก Excel', 'admin/users': 'จัดการพนักงาน', profile: 'โปรไฟล์ของฉัน',
};

// ---- Topbar user ----------------------------------------------------------
document.getElementById('topbar-user').innerHTML = `
  <span>${user.first_name} ${user.last_name} <span class="role-badge">${ROLE_LABEL[user.role] || user.role}</span></span>
  <div class="avatar">${initials(user.first_name, user.last_name)}</div>
  <button class="btn btn-sm" id="logout-btn">ออกจากระบบ</button>
`;
document.getElementById('logout-btn').onclick = () => {
  clearSession();
  window.location.href = './login.html';
};
document.getElementById('sidebar-foot').innerHTML =
  `${user.position_title}${user.department ? ' · ' + user.department : ''}`;

// ---- Role-based nav visibility ---------------------------------------------
if (user.role === 'STAFF') {
  document.getElementById('nav-approvals').style.display = 'none';
}
if (user.role === 'ADMIN') {
  document.getElementById('admin-label').style.display = 'block';
  document.getElementById('nav-admin').style.display = 'flex';
}

// ---- Mobile sidebar toggle --------------------------------------------------
const sidebar = document.getElementById('sidebar');
const mobileToggle = document.getElementById('mobile-toggle');
if (window.matchMedia('(max-width: 620px)').matches) mobileToggle.style.display = 'block';
mobileToggle.onclick = () => sidebar.classList.toggle('open');

// ---- Router -----------------------------------------------------------------
const content = document.getElementById('content');

const ROUTES = {
  dashboard: () => import('./pages/dashboard.js'),
  goals: () => import('./pages/goals.js'),
  scoreboard: () => import('./pages/scoreboard.js'),
  approvals: () => import('./pages/approvals.js'),
  analytics: () => import('./pages/analytics.js'),
  org: () => import('./pages/org.js'),
  export: () => import('./pages/exportPage.js'),
  'admin/users': () => import('./pages/adminUsers.js'),
  profile: () => import('./pages/profile.js'),
};

async function renderRoute() {
  let route = (window.location.hash || '#/dashboard').replace('#/', '');
  if (!ROUTES[route]) route = 'dashboard';

  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  document.getElementById('page-title').textContent = PAGE_TITLES[route] || '';
  sidebar.classList.remove('open');

  content.innerHTML = `<div class="loading-page"><span class="spinner"></span> กำลังโหลด...</div>`;
  try {
    const mod = await ROUTES[route]();
    await mod.render(content, { user });
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="card"><div class="empty-state">
      <div class="icon">⚠️</div>
      <div>เกิดข้อผิดพลาด: ${err.message || err}</div>
    </div></div>`;
  }
}

window.addEventListener('hashchange', renderRoute);
renderRoute();
