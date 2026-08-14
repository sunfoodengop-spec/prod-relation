import { api } from '../api.js';
import { toast, statusPill, approvalPill, MONTHS_TH, OPERATOR_SYMBOL, escapeHtml as esc } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';

let ctx, viewingUserId, subordinates = [], selectedMonth, scoreData = [], goalMeta = new Map();

export async function render(container, context) {
  ctx = context;
  viewingUserId = context.user.user_id;
  selectedMonth = new Date().getMonth() + 1;

  if (context.user.role !== 'STAFF') {
    try { subordinates = await api.getSubordinates(); } catch { subordinates = []; }
  }

  container.innerHTML = `
    <div class="flex-between mb-16" style="flex-wrap:wrap;gap:12px">
      ${subordinates.length ? `
        <select id="viewer-select" style="width:260px">
          <option value="${context.user.user_id}">🙋 ของฉันเอง (${esc(context.user.first_name)})</option>
          ${subordinates.map(s => `<option value="${s.user_id}">${esc(s.first_name)} ${esc(s.last_name)} — ${esc(s.position_title)}</option>`).join('')}
        </select>
      ` : '<div></div>'}
      <button class="btn btn-primary" id="submit-month-btn">ส่งรายงานเดือนนี้ให้หัวหน้าอนุมัติ</button>
    </div>

    <div class="hint-box mb-16">
      💡 เป้าหมายกำหนดที่หน้า "เป้าหมาย &amp; ทีเด็ด" เพียงจุดเดียว (รายปี) — หน้านี้กรอกได้แค่ <strong>ผลงานจริง</strong> ของแต่ละเดือนเท่านั้น
    </div>

    <div class="card mb-16" style="padding:10px 14px">
      <div class="flex gap-8" id="month-tabs" style="flex-wrap:wrap"></div>
    </div>

    <div class="card">
      <div class="card-title">Scoreboard เดือน <span id="month-label"></span> ${CURRENT_YEAR_CE + 543}</div>
      <div id="score-table-wrap"></div>
    </div>
  `;

  document.getElementById('month-tabs').innerHTML = MONTHS_TH.map((m, i) => `
    <button class="btn btn-sm" data-month="${i + 1}" style="${i + 1 === selectedMonth ? 'background:var(--accent);color:#0B1020;border-color:var(--accent)' : ''}">${m}</button>
  `).join('');
  document.querySelectorAll('#month-tabs [data-month]').forEach(b => b.onclick = () => {
    selectedMonth = Number(b.dataset.month);
    document.querySelectorAll('#month-tabs [data-month]').forEach(x => {
      const active = Number(x.dataset.month) === selectedMonth;
      x.style.background = active ? 'var(--accent)' : '';
      x.style.color = active ? '#0B1020' : '';
      x.style.borderColor = active ? 'var(--accent)' : '';
    });
    renderTable();
  });

  const viewerSelect = document.getElementById('viewer-select');
  if (viewerSelect) viewerSelect.onchange = async (e) => { viewingUserId = Number(e.target.value); await loadData(); };
  document.getElementById('submit-month-btn').onclick = submitMonth;

  await loadData();
}

async function loadData() {
  document.getElementById('score-table-wrap').innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  const [goals, sb] = await Promise.all([
    api.listGoals(viewingUserId, CURRENT_YEAR_CE),
    api.getScoreboard(viewingUserId, CURRENT_YEAR_CE),
  ]);
  goalMeta = new Map(goals.map(g => [g.goal_id, g]));
  scoreData = sb;
  renderTable();
}

function renderTable() {
  document.getElementById('month-label').textContent = MONTHS_TH[selectedMonth - 1];
  const wrap = document.getElementById('score-table-wrap');

  const goalIds = [...new Set(scoreData.map(r => r.goal_id))];
  if (!goalIds.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">🗓️</div>ยังไม่มีเป้าหมายในปีนี้ กรุณาไปที่หน้า "เป้าหมาย & ทีเด็ด" ก่อน</div>`;
    return;
  }

  const rows = goalIds.map(gid => {
    const goalRow = scoreData.find(r => r.goal_id === gid);
    const monthRow = scoreData.find(r => r.goal_id === gid && r.month_num === selectedMonth) || {};
    const meta = goalMeta.get(gid);
    return { gid, title: goalRow.goal_title, weight: goalRow.weight_percentage, m: monthRow, meta };
  });

  wrap.innerHTML = `<table>
    <thead><tr>
      <th>เป้าหมาย</th><th>น้ำหนัก</th><th>เป้าหมาย (คงที่ทั้งปี)</th><th>ผลงานจริงเดือนนี้</th>
      <th>ส่วนต่าง</th><th>% สำเร็จ</th><th>สถานะ</th><th>การอนุมัติ</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${esc(r.title)} ${r.meta?.is_shared ? `<span class="pill yellow" style="margin-left:6px"><span class="dot"></span>ถือร่วมกับ ${esc(r.meta.owner_name)}</span>` : ''}</td>
          <td class="text-muted">${r.weight ?? '-'}%</td>
          <td class="text-muted">
            <strong>${OPERATOR_SYMBOL[r.meta?.evaluation_operator] || '≥'} ${r.m.target_val ?? '-'}</strong>
            ${r.meta?.metric_unit ? ' ' + esc(r.meta.metric_unit) : ''}
          </td>
          <td class="month-cell">${r.meta?.is_shared
            ? `<span class="text-muted">${r.m.actual_val ?? '-'}</span>`
            : `<input type="number" step="0.01" data-actual="${r.gid}" value="${r.m.actual_val ?? ''}">`}</td>
          <td class="text-muted">${r.m.variance_val ?? '-'}</td>
          <td class="text-muted">${r.m.achievement_percentage != null ? r.m.achievement_percentage + '%' : '-'}</td>
          <td>${statusPill(r.m.status_color)}</td>
          <td>
            ${approvalPill(r.m.approval_status || 'DRAFT')}
            ${r.m.approval_status === 'REJECTED' && r.m.reviewer_comments ? `<div class="text-dim" style="font-size:11.5px;margin-top:4px">${esc(r.m.reviewer_comments)}</div>` : ''}
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="flex" style="justify-content:flex-end;margin-top:14px">
    <button class="btn btn-primary" id="save-month-btn">บันทึกผลงานจริงเดือนนี้</button>
  </div>`;

  document.getElementById('save-month-btn').onclick = saveMonth;
}

async function saveMonth() {
  const btn = document.getElementById('save-month-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
  try {
    const goalIds = [...new Set(scoreData.map(r => r.goal_id))];
    for (const gid of goalIds) {
      const input = document.querySelector(`[data-actual="${gid}"]`);
      if (!input) continue; // ถือเป้าร่วม (read-only) — ไม่มีช่องกรอกให้บันทึก
      const a = input.value;
      await api.upsertScoreboard({
        goal_id: gid, month_num: selectedMonth,
        actual_val: a === '' ? null : Number(a),
      });
    }
    toast('บันทึกข้อมูลเดือน ' + MONTHS_TH[selectedMonth - 1] + ' เรียบร้อย');
    await loadData();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'บันทึกผลงานจริงเดือนนี้';
  }
}

async function submitMonth() {
  if (viewingUserId !== ctx.user.user_id) {
    toast('การส่งรายงานต้องทำโดยเจ้าของข้อมูลเอง สลับกลับไปที่ "ของฉันเอง" ก่อน', 'error');
    return;
  }
  try {
    const n = await api.submitMonthlyReport(CURRENT_YEAR_CE, selectedMonth);
    toast(n > 0 ? `ส่งรายงานเดือน ${MONTHS_TH[selectedMonth - 1]} เรียบร้อย (${n} รายการ)` : 'ไม่มีรายการที่ต้องส่ง (อาจอนุมัติแล้ว หรือยังไม่มีข้อมูล)');
    await loadData();
  } catch (err) {
    toast(err.message, 'error');
  }
}
