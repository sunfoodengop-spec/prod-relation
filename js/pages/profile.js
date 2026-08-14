import { api } from '../api.js';
import { toast, escapeHtml as esc } from '../ui.js';
import { updateUser } from '../session.js';

const ROLE_LABEL = { STAFF: 'เจ้าหน้าที่', SUPERVISOR: 'หัวหน้างาน', ADMIN: 'ผู้ดูแลระบบ' };

export async function render(container) {
  const p = await api.getMyProfile();
  const profile = Array.isArray(p) ? p[0] : p;

  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">ข้อมูลส่วนตัว</div>
        <div class="field"><label>รหัสพนักงาน</label><input value="${esc(profile.emp_code)}" disabled></div>
        <div class="field-row">
          <div class="field"><label>ชื่อ</label><input value="${esc(profile.first_name)}" disabled></div>
          <div class="field"><label>นามสกุล</label><input value="${esc(profile.last_name)}" disabled></div>
        </div>
        <div class="field"><label>ชื่อเล่น</label><input id="f-nick" value="${esc(profile.nickname || '')}"></div>
        <div class="field"><label>ตำแหน่ง</label><input value="${esc(profile.position_title)}" disabled></div>
        <div class="field"><label>สิทธิ์การใช้งาน</label><input value="${ROLE_LABEL[profile.role] || profile.role}" disabled></div>
        <button class="btn btn-primary" id="save-profile-btn">บันทึกการเปลี่ยนแปลง</button>
      </div>

      <div class="card">
        <div class="card-title">เปลี่ยนรหัสผ่าน</div>
        <div id="pw-error"></div>
        <div class="field"><label>รหัสผ่านใหม่</label><input id="f-newpw" type="password" minlength="6"></div>
        <div class="field"><label>ยืนยันรหัสผ่านใหม่</label><input id="f-confirmpw" type="password" minlength="6"></div>
        <button class="btn" id="save-pw-btn">เปลี่ยนรหัสผ่าน</button>
      </div>
    </div>
  `;

  document.getElementById('save-profile-btn').onclick = async () => {
    try {
      const nick = document.getElementById('f-nick').value.trim();
      await api.updateMyProfile(nick, null);
      updateUser({ nickname: nick });
      toast('บันทึกโปรไฟล์เรียบร้อย');
    } catch (err) { toast(err.message, 'error'); }
  };

  document.getElementById('save-pw-btn').onclick = async () => {
    const errSlot = document.getElementById('pw-error');
    errSlot.innerHTML = '';
    const p1 = document.getElementById('f-newpw').value;
    const p2 = document.getElementById('f-confirmpw').value;
    if (p1 !== p2) { errSlot.innerHTML = `<div class="error-box">รหัสผ่านใหม่ไม่ตรงกัน</div>`; return; }
    try {
      await api.changePassword(p1);
      toast('เปลี่ยนรหัสผ่านเรียบร้อย');
      document.getElementById('f-newpw').value = '';
      document.getElementById('f-confirmpw').value = '';
    } catch (err) { errSlot.innerHTML = `<div class="error-box">${err.message}</div>`; }
  };
}
