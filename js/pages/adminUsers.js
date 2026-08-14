import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, escapeHtml as esc } from '../ui.js';

const LEVEL_LABEL = { 85: 'ผู้จัดการทั่วไป (GM)', 75: 'ผู้จัดการฝ่าย / รก.ผจก.ฝ่าย', 65: 'ผู้จัดการส่วน / รก.ผจก.ส่วน', 55: 'ผู้จัดการแผนก / รก.ผจก.แผนก', 40: 'เจ้าหน้าที่' };
const ROLE_LABEL = { STAFF: 'เจ้าหน้าที่', SUPERVISOR: 'หัวหน้างาน', ADMIN: 'ผู้ดูแลระบบ' };

let allUsers = [];

export async function render(container, { user }) {
  if (user.role !== 'ADMIN') {
    container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">🔒</div>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="flex-between mb-16">
      <input id="search-box" placeholder="ค้นหาชื่อ, รหัสพนักงาน, ตำแหน่ง..." style="width:320px">
      <button class="btn btn-primary" id="add-user-btn">+ เพิ่มพนักงาน</button>
    </div>
    <div class="card"><div id="users-table"></div></div>
  `;

  document.getElementById('add-user-btn').onclick = () => openUserModal(null, container);
  document.getElementById('search-box').oninput = (e) => renderTable(e.target.value.trim());

  await load(container);
}

async function load(container) {
  document.getElementById('users-table').innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  allUsers = await api.getSubordinates(); // ADMIN role returns everyone
  renderTable('');
}

function renderTable(filter) {
  const wrap = document.getElementById('users-table');
  const f = filter.toLowerCase();
  const rows = allUsers.filter(u =>
    !f || `${u.first_name} ${u.last_name} ${u.emp_code} ${u.position_title}`.toLowerCase().includes(f));

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">👥</div>ไม่พบพนักงานที่ตรงกับคำค้นหา</div>`;
    return;
  }

  wrap.innerHTML = `<table><thead><tr>
    <th>รหัสพนักงาน</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>แผนก</th><th>ระดับ</th><th>สิทธิ์</th><th>หัวหน้า</th><th></th>
  </tr></thead><tbody>
    ${rows.map(u => `
      <tr>
        <td class="text-muted">${esc(u.emp_code)}</td>
        <td>${esc(u.first_name)} ${esc(u.last_name)} ${u.nickname ? `<span class="text-dim">(${esc(u.nickname)})</span>` : ''}</td>
        <td>${esc(u.position_title)}</td>
        <td class="text-muted">${esc(u.department || '-')}</td>
        <td>${LEVEL_LABEL[u.org_level] || u.org_level}</td>
        <td><span class="role-badge">${ROLE_LABEL[u.role] || u.role}</span></td>
        <td class="text-muted">${supervisorName(u.supervisor_id)}</td>
        <td class="flex gap-8">
          <button class="btn btn-sm" data-edit="${u.user_id}">แก้ไข</button>
          <button class="btn btn-sm" data-reset="${u.user_id}">รีเซ็ตรหัสผ่าน</button>
        </td>
      </tr>
    `).join('')}
  </tbody></table>`;

  wrap.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openUserModal(allUsers.find(u => u.user_id == b.dataset.edit), document));
  wrap.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPassword(Number(b.dataset.reset)));
}

function supervisorName(id) {
  const s = allUsers.find(u => u.user_id === id);
  return s ? `${s.first_name} ${s.last_name}` : '— (สูงสุด)';
}

async function resetPassword(userId) {
  if (!(await confirmDialog('ต้องการรีเซ็ตรหัสผ่านกลับเป็นรหัสพนักงานใช่หรือไม่? พนักงานจะต้องตั้งรหัสผ่านใหม่ในการเข้าสู่ระบบครั้งถัดไป'))) return;
  try {
    await api.adminResetPassword(userId);
    toast('รีเซ็ตรหัสผ่านเรียบร้อย');
  } catch (err) { toast(err.message, 'error'); }
}

function openUserModal(u, container) {
  const supervisorOptions = allUsers
    .filter(x => x.user_id !== u?.user_id)
    .map(x => `<option value="${x.user_id}" ${u?.supervisor_id === x.user_id ? 'selected' : ''}>${esc(x.first_name)} ${esc(x.last_name)} — ${esc(x.position_title)}</option>`)
    .join('');

  const backdrop = openModal(`
    <h3 style="margin-top:0">${u ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงานใหม่'}</h3>
    <div class="field"><label>รหัสพนักงาน</label><input id="f-code" value="${esc(u?.emp_code || '')}" ${u ? '' : 'placeholder="เช่น 443757 หรือ 123456 ถ้าไม่มีรหัส"'}></div>
    <div class="field-row">
      <div class="field"><label>ชื่อ</label><input id="f-fn" value="${esc(u?.first_name || '')}"></div>
      <div class="field"><label>นามสกุล</label><input id="f-ln" value="${esc(u?.last_name || '')}"></div>
    </div>
    <div class="field"><label>ชื่อเล่น</label><input id="f-nick" value="${esc(u?.nickname || '')}"></div>
    <div class="field-row">
      <div class="field"><label>ตำแหน่ง</label><input id="f-pos" value="${esc(u?.position_title || '')}"></div>
      <div class="field"><label>แผนก</label><input id="f-dept" value="${esc(u?.department || '')}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>ระดับชั้น</label>
        <select id="f-level">${Object.entries(LEVEL_LABEL).map(([k, v]) => `<option value="${k}" ${u?.org_level == k ? 'selected' : ''}>${k} — ${v}</option>`).join('')}</select>
      </div>
      <div class="field"><label>สิทธิ์การใช้งาน</label>
        <select id="f-role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field"><label>ผู้บังคับบัญชา (เว้นว่างถ้าเป็นตำแหน่งสูงสุด)</label>
      <select id="f-sup"><option value="">— ไม่มี (ตำแหน่งสูงสุด) —</option>${supervisorOptions}</select>
    </div>
    <div class="hint-box mb-16">รหัสผ่านเริ่มต้นของพนักงานใหม่ = รหัสพนักงาน (บังคับเปลี่ยนตอนล็อกอินครั้งแรก)</div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);

  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      const sup = backdrop.querySelector('#f-sup').value;
      await api.upsertUser({
        user_id: u?.user_id ?? null,
        emp_code: backdrop.querySelector('#f-code').value.trim(),
        first_name: backdrop.querySelector('#f-fn').value.trim(),
        last_name: backdrop.querySelector('#f-ln').value.trim(),
        nickname: backdrop.querySelector('#f-nick').value.trim(),
        position_title: backdrop.querySelector('#f-pos').value.trim(),
        department: backdrop.querySelector('#f-dept').value.trim(),
        org_level: Number(backdrop.querySelector('#f-level').value),
        supervisor_id: sup ? Number(sup) : null,
        role: backdrop.querySelector('#f-role').value,
      });
      closeModal(backdrop);
      toast('บันทึกข้อมูลพนักงานเรียบร้อย');
      await load(container);
    } catch (err) { toast(err.message, 'error'); }
  };
}
