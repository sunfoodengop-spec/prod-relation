import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, escapeHtml as esc } from '../ui.js';
import { openImportModal } from '../importCsv.js';
import { USERS_IMPORT_HEADERS, importUsersFromRows } from '../userImport.js';

const ROLE_LABEL = { STAFF: 'เจ้าหน้าที่', SUPERVISOR: 'หัวหน้างาน', ADMIN: 'ผู้ดูแลระบบ' };
const TRACK_LABEL = { MANAGEMENT: 'สายบริหาร', SPECIALIST: 'สายผู้ชำนาญการ' };

let allUsers = [];
let allDepartments = []; // [{dept_key, label, sort_order}]
let positionTitles = [];  // [{org_level, track, title}]

export async function render(container, { user }) {
  if (user.role !== 'ADMIN') {
    container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">🔒</div>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div></div>`;
    return;
  }

  container.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  [allDepartments, positionTitles] = await Promise.all([api.listDepartments(), api.listPositionTitles()]);

  container.innerHTML = `
    <div class="flex-between mb-16" style="flex-wrap:wrap;gap:10px">
      <div class="flex gap-8" style="flex-wrap:wrap">
        <input id="search-box" placeholder="ค้นหาชื่อ, รหัสพนักงาน, ตำแหน่ง..." style="width:280px">
        <select id="dept-filter" style="width:220px">
          <option value="">ทุกแผนก</option>
          ${allDepartments.map(d => `<option value="${esc(d.dept_key)}">${esc(d.label)}</option>`).join('')}
        </select>
      </div>
      <div class="flex gap-8">
        <button class="btn" id="manage-dept-btn">🗂️ จัดการแผนก</button>
        <button class="btn" id="export-users-btn">📤 Export Excel</button>
        <button class="btn" id="import-users-btn">📥 Import Excel</button>
        <button class="btn btn-primary" id="add-user-btn">+ เพิ่มพนักงาน</button>
      </div>
    </div>
    <div class="card"><div id="users-table"></div></div>
  `;

  document.getElementById('add-user-btn').onclick = () => openUserModal(null);
  document.getElementById('manage-dept-btn').onclick = () => openDeptManagerModal();
  document.getElementById('export-users-btn').onclick = () => exportUsersExcel();
  document.getElementById('import-users-btn').onclick = () => openUsersImportModal();
  document.getElementById('search-box').oninput = () => renderTable();
  document.getElementById('dept-filter').onchange = () => renderTable();

  await load();
}

async function load() {
  document.getElementById('users-table').innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  allUsers = await api.getSubordinates(); // ADMIN role returns everyone
  renderTable();
}

function deptLabel(key) {
  const d = allDepartments.find(x => x.dept_key === key);
  return d ? d.label : key;
}
function deptLabelsForUser(u) {
  return (u.department || '').split(',').filter(Boolean).map(deptLabel).join(', ') || '-';
}

function renderTable() {
  const wrap = document.getElementById('users-table');
  const f = (document.getElementById('search-box')?.value || '').toLowerCase();
  const deptFilter = document.getElementById('dept-filter')?.value || '';

  const rows = allUsers.filter(u => {
    const matchesSearch = !f || `${u.first_name} ${u.last_name} ${u.emp_code} ${u.position_title}`.toLowerCase().includes(f);
    const matchesDept = !deptFilter || (u.department || '').split(',').includes(deptFilter);
    return matchesSearch && matchesDept;
  });

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">👥</div>ไม่พบพนักงานที่ตรงกับเงื่อนไข</div>`;
    return;
  }

  wrap.innerHTML = `<table><thead><tr>
    <th>รหัสพนักงาน</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>แผนก</th><th>สาย</th><th>สิทธิ์</th><th>หัวหน้า</th><th></th>
  </tr></thead><tbody>
    ${rows.map(u => `
      <tr>
        <td class="text-muted">${esc(u.emp_code)}</td>
        <td>${esc(u.first_name)} ${esc(u.last_name)} ${u.nickname ? `<span class="text-dim">(${esc(u.nickname)})</span>` : ''}</td>
        <td>${esc(u.position_title)}</td>
        <td class="text-muted">${esc(deptLabelsForUser(u))}</td>
        <td><span class="role-badge">${TRACK_LABEL[u.track] || u.track}</span></td>
        <td><span class="role-badge">${ROLE_LABEL[u.role] || u.role}</span></td>
        <td class="text-muted">${supervisorName(u.supervisor_id)}</td>
        <td class="flex gap-8">
          <button class="btn btn-sm" data-edit="${u.user_id}">แก้ไข</button>
          <button class="btn btn-sm" data-reset="${u.user_id}">รีเซ็ตรหัสผ่าน</button>
          <button class="btn btn-sm btn-danger" data-delete="${u.user_id}">ลบ</button>
        </td>
      </tr>
    `).join('')}
  </tbody></table>`;

  wrap.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openUserModal(allUsers.find(u => u.user_id == b.dataset.edit)));
  wrap.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPassword(Number(b.dataset.reset)));
  wrap.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => deleteUser(Number(b.dataset.delete), allUsers.find(u => u.user_id == b.dataset.delete)));
}

async function deleteUser(userId, u) {
  if (!(await confirmDialog(`ลบ "${u.first_name} ${u.last_name}" ออกจากระบบใช่หรือไม่? ลูกน้องโดยตรงของคนนี้จะถูกเลื่อนขึ้นไปอยู่ใต้ผู้บังคับบัญชาของเขาแทนโดยอัตโนมัติ (ประวัติเป้าหมาย/Scoreboard ที่เคยบันทึกไว้จะยังอยู่ครบ)`))) return;
  try {
    await api.deactivateUser(userId);
    toast('ลบพนักงานเรียบร้อย');
    await load();
  } catch (err) { toast(err.message, 'error'); }
}

function supervisorName(id) {
  const s = allUsers.find(u => u.user_id === id);
  return s ? `${s.first_name} ${s.last_name}` : '— (สูงสุด)';
}

// ---- ระดับชั้นที่มีอยู่ (จาก position_titles, ไม่ hardcode) -----------------
function levelOptions() {
  const levels = [...new Set(positionTitles.map(p => p.org_level))].sort((a, b) => b - a);
  return levels.map(lv => {
    const mgmt = positionTitles.find(p => p.org_level === lv && p.track === 'MANAGEMENT');
    return { level: lv, label: mgmt ? mgmt.title : `ระดับ ${lv}` };
  });
}
function computeTitlePreview(level, track, isActing) {
  const row = positionTitles.find(p => p.org_level === Number(level) && p.track === track);
  let title = row ? row.title : `${track === 'SPECIALIST' ? 'ผู้ชำนาญการ' : 'เจ้าหน้าที่'} (ระดับ ${level})`;
  if (isActing) title = 'รักษาการ' + title;
  return title;
}

function openUserModal(u) {
  const supervisorOptions = allUsers
    .filter(x => x.user_id !== u?.user_id)
    .map(x => `<option value="${x.user_id}" ${u?.supervisor_id === x.user_id ? 'selected' : ''}>${esc(x.first_name)} ${esc(x.last_name)} — ${esc(x.position_title)}</option>`)
    .join('');
  const currentDepts = new Set((u?.department || '').split(',').filter(Boolean));
  const levels = levelOptions();

  const backdrop = openModal(`
    <h3 style="margin-top:0">${u ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงานใหม่'}</h3>
    <div class="field"><label>รหัสพนักงาน</label><input id="f-code" value="${esc(u?.emp_code || '')}" ${u ? '' : 'placeholder="เช่น 443757 หรือ 123456 ถ้าไม่มีรหัส"'}></div>
    <div class="field-row">
      <div class="field"><label>ชื่อ</label><input id="f-fn" value="${esc(u?.first_name || '')}"></div>
      <div class="field"><label>นามสกุล</label><input id="f-ln" value="${esc(u?.last_name || '')}"></div>
    </div>
    <div class="field"><label>ชื่อเล่น</label><input id="f-nick" value="${esc(u?.nickname || '')}"></div>

    <div class="field-row">
      <div class="field"><label>ระดับชั้น</label>
        <select id="f-level">${levels.map(l => `<option value="${l.level}" ${u?.org_level == l.level ? 'selected' : ''}>${l.level} — ${esc(l.label)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>สาย</label>
        <select id="f-track">
          <option value="MANAGEMENT" ${(u?.track || 'MANAGEMENT') === 'MANAGEMENT' ? 'selected' : ''}>สายบริหาร</option>
          <option value="SPECIALIST" ${u?.track === 'SPECIALIST' ? 'selected' : ''}>สายผู้ชำนาญการ</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label class="flex gap-8" style="cursor:pointer"><input type="checkbox" id="f-acting" style="width:auto" ${u?.is_acting ? 'checked' : ''}> รักษาการ</label>
    </div>
    <div class="field">
      <label>ตำแหน่ง (สร้างอัตโนมัติ)</label>
      <input id="f-title-preview" value="${esc(computeTitlePreview(u?.org_level ?? levels[0]?.level ?? 40, u?.track || 'MANAGEMENT', u?.is_acting))}" disabled>
    </div>

    <div class="field">
      <div class="flex-between">
        <label style="margin:0">แผนก (เลือกได้มากกว่า 1)</label>
        <button class="btn btn-sm btn-ghost" id="add-dept-inline-btn" type="button">+ เพิ่มแผนกใหม่</button>
      </div>
      <div id="dept-checkboxes" style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;max-height:160px;overflow-y:auto;margin-top:6px">
        ${allDepartments.map(d => `
          <label class="flex gap-8" style="cursor:pointer;padding:4px 0">
            <input type="checkbox" value="${esc(d.dept_key)}" style="width:auto" ${currentDepts.has(d.dept_key) ? 'checked' : ''}>
            ${esc(d.label)}
          </label>
        `).join('') || '<span class="text-dim" style="font-size:13px">ยังไม่มีแผนก กด "+ เพิ่มแผนกใหม่"</span>'}
      </div>
    </div>

    <div class="field"><label>สิทธิ์การใช้งาน</label>
      <select id="f-role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
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

  const updatePreview = () => {
    const lv = backdrop.querySelector('#f-level').value;
    const track = backdrop.querySelector('#f-track').value;
    const acting = backdrop.querySelector('#f-acting').checked;
    backdrop.querySelector('#f-title-preview').value = computeTitlePreview(lv, track, acting);
  };
  backdrop.querySelector('#f-level').onchange = updatePreview;
  backdrop.querySelector('#f-track').onchange = updatePreview;
  backdrop.querySelector('#f-acting').onchange = updatePreview;

  backdrop.querySelector('#add-dept-inline-btn').onclick = () => openAddDepartmentModal(async (newDept) => {
    allDepartments.push(newDept);
    const box = backdrop.querySelector('#dept-checkboxes');
    box.insertAdjacentHTML('beforeend', `
      <label class="flex gap-8" style="cursor:pointer;padding:4px 0">
        <input type="checkbox" value="${esc(newDept.dept_key)}" style="width:auto" checked>
        ${esc(newDept.label)}
      </label>
    `);
  });

  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      const sup = backdrop.querySelector('#f-sup').value;
      const depts = [...backdrop.querySelectorAll('#dept-checkboxes input[type="checkbox"]:checked')].map(el => el.value).join(',');
      await api.upsertUser({
        user_id: u?.user_id ?? null,
        emp_code: backdrop.querySelector('#f-code').value.trim(),
        first_name: backdrop.querySelector('#f-fn').value.trim(),
        last_name: backdrop.querySelector('#f-ln').value.trim(),
        nickname: backdrop.querySelector('#f-nick').value.trim(),
        departments: depts,
        org_level: Number(backdrop.querySelector('#f-level').value),
        track: backdrop.querySelector('#f-track').value,
        is_acting: backdrop.querySelector('#f-acting').checked,
        supervisor_id: sup ? Number(sup) : null,
        role: backdrop.querySelector('#f-role').value,
      });
      closeModal(backdrop);
      toast('บันทึกข้อมูลพนักงานเรียบร้อย');
      await load();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openAddDepartmentModal(onAdded) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">+ เพิ่มแผนกใหม่</h3>
    <div class="field"><label>รหัสแผนก (ภาษาอังกฤษ ไม่มีช่องว่าง)</label><input id="f-key" placeholder="เช่น PRODUCTION"></div>
    <div class="field"><label>ชื่อแผนกที่แสดงผล</label><input id="f-label" placeholder="เช่น ฝ่ายผลิต"></div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">เพิ่มแผนก</button>
    </div>
  `);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    const key = backdrop.querySelector('#f-key').value.trim().toUpperCase().replace(/\s+/g, '_');
    const label = backdrop.querySelector('#f-label').value.trim();
    if (!key || !label) { toast('กรุณากรอกรหัสและชื่อแผนกให้ครบ', 'error'); return; }
    try {
      await api.upsertDepartment(key, label, allDepartments.length);
      closeModal(backdrop);
      toast('เพิ่มแผนกเรียบร้อย');
      onAdded({ dept_key: key, label, sort_order: allDepartments.length });
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openDeptManagerModal() {
  const backdrop = openModal(`
    <h3 style="margin-top:0">🗂️ จัดการแผนก</h3>
    <p class="text-muted" style="font-size:13px;margin-top:-6px">ลำดับที่นี่ = ลำดับคอลัมน์ในหน้าผังองค์กร (ซ้าย→ขวา)</p>
    <div id="dept-list" class="mb-16"></div>
    <button class="btn btn-primary" id="add-dept-btn">+ เพิ่มแผนกใหม่</button>
    <div class="flex gap-8 mt-16" style="justify-content:flex-end">
      <button class="btn" id="close-btn">ปิด</button>
    </div>
  `);
  const renderList = () => {
    const sorted = [...allDepartments].sort((a, b) => a.sort_order - b.sort_order || a.dept_key.localeCompare(b.dept_key));
    backdrop.querySelector('#dept-list').innerHTML = sorted.length
      ? `<table><thead><tr><th>รหัส</th><th>ชื่อ</th><th></th></tr></thead><tbody>
          ${sorted.map((d, i) => `<tr>
            <td class="text-muted">${esc(d.dept_key)}</td><td>${esc(d.label)}</td>
            <td class="flex gap-8">
              <button class="btn btn-sm btn-ghost" data-up="${esc(d.dept_key)}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-sm btn-ghost" data-down="${esc(d.dept_key)}" ${i === sorted.length - 1 ? 'disabled' : ''}>↓</button>
            </td>
          </tr>`).join('')}
        </tbody></table>`
      : `<div class="text-dim" style="font-size:13px">ยังไม่มีแผนก</div>`;

    backdrop.querySelectorAll('[data-up]').forEach(b => b.onclick = () => swapOrder(b.dataset.up, -1));
    backdrop.querySelectorAll('[data-down]').forEach(b => b.onclick = () => swapOrder(b.dataset.down, 1));
  };

  // เรียงลำดับปัจจุบัน (ตัดเสมอด้วย dept_key) แล้วสลับตำแหน่งใน array จากนั้น
  // เขียน sort_order ใหม่ทั้งหมดแบบเรียงต่อเนื่อง 0,1,2,... ทุกครั้ง — กันปัญหา
  // แผนกที่ sort_order เท่ากันอยู่เดิม ทำให้กด ↑/↓ แล้วดูเหมือนไม่มีอะไรเกิดขึ้น
  async function swapOrder(deptKey, dir) {
    const sorted = [...allDepartments].sort((a, b) => a.sort_order - b.sort_order || a.dept_key.localeCompare(b.dept_key));
    const idx = sorted.findIndex(d => d.dept_key === deptKey);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    try {
      await Promise.all(sorted.map((d, i) => {
        d.sort_order = i;
        return api.upsertDepartment(d.dept_key, d.label, i);
      }));
      renderList();
    } catch (err) { toast(err.message, 'error'); }
  }

  renderList();
  backdrop.querySelector('#close-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#add-dept-btn').onclick = () => openAddDepartmentModal((newDept) => {
    newDept.sort_order = Math.max(0, ...allDepartments.map(d => d.sort_order)) + 1;
    allDepartments.push(newDept);
    renderList();
    renderTable();
  });
}

async function resetPassword(userId) {
  if (!(await confirmDialog('ต้องการรีเซ็ตรหัสผ่านกลับเป็นรหัสพนักงานใช่หรือไม่? พนักงานจะต้องตั้งรหัสผ่านใหม่ในการเข้าสู่ระบบครั้งถัดไป'))) return;
  try {
    await api.adminResetPassword(userId);
    toast('รีเซ็ตรหัสผ่านเรียบร้อย');
  } catch (err) { toast(err.message, 'error'); }
}

// ============================================================================
// Export / Import พนักงานเป็น Excel
// ============================================================================
async function exportUsersExcel() {
  try {
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const rows = allUsers.map(u => ({
      'รหัสพนักงาน': u.emp_code, 'ชื่อ': u.first_name, 'นามสกุล': u.last_name, 'ชื่อเล่น': u.nickname || '',
      'ตำแหน่ง': u.position_title, 'แผนก': deptLabelsForUser(u),
      'รหัสแผนก': u.department || '', 'ระดับ': u.org_level,
      'สาย': TRACK_LABEL[u.track] || u.track, 'รักษาการ': u.is_acting ? 'TRUE' : 'FALSE',
      'สิทธิ์': ROLE_LABEL[u.role] || u.role,
      'รหัสหัวหน้า': allUsers.find(x => x.user_id === u.supervisor_id)?.emp_code || '',
      'ชื่อหัวหน้า': supervisorName(u.supervisor_id),
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'พนักงาน');
    XLSX.writeFile(wb, `รายชื่อพนักงาน_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast('Export เรียบร้อย');
  } catch (err) { toast(err.message, 'error'); }
}

function openUsersImportModal() {
  const prefillRows = allUsers.map(u => [
    u.emp_code, u.first_name, u.last_name, u.nickname || '', u.department || '',
    u.org_level, u.track, u.is_acting ? 'TRUE' : 'FALSE', u.role,
    allUsers.find(x => x.user_id === u.supervisor_id)?.emp_code || '',
  ]);
  openImportModal({
    title: 'รายชื่อพนักงาน', headers: USERS_IMPORT_HEADERS, blankFilename: 'รายชื่อพนักงาน.csv',
    hint: 'จับคู่ด้วย "รหัสพนักงาน" — ถ้ามีอยู่แล้วจะ<strong>เขียนทับ</strong>ข้อมูลเดิม ถ้าไม่พบจะสร้างใหม่ · แผนกใส่เป็นรหัส (dept_key) คั่นด้วยคอมม่าถ้ามีมากกว่า 1 แผนก · เรียงแถวก่อน-หลังแบบไหนก็ได้ ระบบจะผูกหัวหน้าให้ถูกต้องเสมอ',
    prefillRows,
    onImport: async (rows) => {
      const result = await importUsersFromRows(rows, allUsers);
      await load();
      return result;
    },
  });
}
