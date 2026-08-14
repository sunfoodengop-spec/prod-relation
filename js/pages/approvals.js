import { api } from '../api.js';
import { toast, statusPill, MONTHS_TH, openModal, closeModal, escapeHtml as esc } from '../ui.js';

export async function render(container) {
  container.innerHTML = `<div id="approvals-list"></div>`;
  await load(container);
}

async function load(container) {
  const list = document.getElementById('approvals-list');
  list.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  const pending = await api.getPendingApprovals();

  if (!pending.length) {
    list.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">✅</div>ไม่มีรายการรออนุมัติในขณะนี้</div></div>`;
    return;
  }

  list.innerHTML = `<div class="card"><table><thead><tr>
    <th>พนักงาน</th><th>เดือน</th><th>ปี</th><th>จำนวนเป้าหมายที่ส่ง</th><th></th>
  </tr></thead><tbody>
    ${pending.map((p, i) => `
      <tr>
        <td>${esc(p.employee_name)}</td>
        <td>${MONTHS_TH[p.month_num - 1]}</td>
        <td>${p.year + 543}</td>
        <td>${p.submitted_goals}</td>
        <td><button class="btn btn-sm btn-primary" data-review="${i}">ตรวจสอบ</button></td>
      </tr>
    `).join('')}
  </tbody></table></div>`;

  list.querySelectorAll('[data-review]').forEach(b => b.onclick = () => openReview(pending[b.dataset.review], container));
}

async function openReview(item, container) {
  const backdrop = openModal(`<div class="loading-page"><span class="spinner"></span></div>`);
  backdrop.querySelector('.modal').style.width = '640px';

  const data = await api.getScoreboard(item.target_user_id, item.year);
  const rows = data.filter(r => r.month_num === item.month_num);

  backdrop.querySelector('.modal').innerHTML = `
    <h3 style="margin-top:0">${esc(item.employee_name)} — เดือน ${MONTHS_TH[item.month_num - 1]} ${item.year + 543}</h3>
    <table class="mb-16"><thead><tr><th>เป้าหมาย</th><th>เป้าหมาย</th><th>ผลจริง</th><th>%สำเร็จ</th><th>สถานะ</th></tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td>${esc(r.goal_title)}</td><td>${r.target_val ?? '-'}</td><td>${r.actual_val ?? '-'}</td>
        <td>${r.achievement_percentage != null ? r.achievement_percentage + '%' : '-'}</td>
        <td>${statusPill(r.status_color)}</td>
      </tr>`).join('')}
    </tbody></table>
    <div class="field"><label>ความเห็น (จำเป็นเมื่อส่งกลับแก้ไข)</label><textarea id="f-comments" rows="3" placeholder="ระบุเหตุผล กรณีส่งกลับแก้ไข"></textarea></div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ปิด</button>
      <button class="btn btn-danger" id="reject-btn">ส่งกลับแก้ไข</button>
      <button class="btn btn-primary" id="approve-btn">อนุมัติ</button>
    </div>
  `;

  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#approve-btn').onclick = () => decide('APPROVED', backdrop, item, container);
  backdrop.querySelector('#reject-btn').onclick = () => decide('REJECTED', backdrop, item, container);
}

async function decide(decision, backdrop, item, container) {
  const comments = backdrop.querySelector('#f-comments').value.trim();
  if (decision === 'REJECTED' && !comments) {
    toast('กรุณาระบุความเห็นก่อนส่งกลับแก้ไข', 'error');
    return;
  }
  try {
    await api.reviewMonthlyReport(item.target_user_id, item.year, item.month_num, decision, comments);
    closeModal(backdrop);
    toast(decision === 'APPROVED' ? 'อนุมัติรายงานเรียบร้อย' : 'ส่งรายงานกลับแก้ไขแล้ว');
    await load(container);
  } catch (err) {
    toast(err.message, 'error');
  }
}
