import { api } from '../api.js';
import { toast, statusPill, approvalPill, MONTHS_TH, OPERATOR_SYMBOL, escapeHtml as esc } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';
import { openImportModal } from '../importCsv.js';
import { SCOREBOARD_IMPORT_HEADERS, importScoreboardFromRows } from '../goalImport.js';

let ctx, viewingUserId, subordinates = [], selectedMonth, viewMode = 'daily';
let goalMeta = new Map(); // goal_id -> goal (จาก listGoals)
let monthlyData = [];      // จาก getScoreboard (มุมมองเฉลี่ยรายเดือน)
let dailyData = [];        // จาก getScoreboardDaily (มุมมองรายวัน ของเดือนที่เลือก)
let dailyOriginal = new Map(); // `${goal_id}|${date}` -> ค่าที่โหลดมา (เช็คว่ามีการแก้ไขก่อนบันทึก)

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

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
      <div class="flex gap-8">
        <button class="btn" id="import-scoreboard-btn">📥 นำเข้าข้อมูล</button>
        <button class="btn btn-primary" id="submit-month-btn">ส่งรายงานเดือนนี้ให้หัวหน้าอนุมัติ</button>
      </div>
    </div>

    <div class="hint-box mb-16">
      💡 เป้าหมายกำหนดที่หน้า "เป้าหมาย &amp; ทีเด็ด" เพียงจุดเดียว (รายปี) — หน้านี้กรอกผลงานจริงเป็น <strong>รายวัน</strong> ระบบจะคำนวณค่าเฉลี่ยรายเดือนให้อัตโนมัติ
    </div>

    <div class="card mb-16" style="padding:10px 14px">
      <div class="flex-between" style="flex-wrap:wrap;gap:10px">
        <div class="flex gap-8" id="month-tabs" style="flex-wrap:wrap"></div>
        <div class="flex gap-8" id="view-toggle">
          <button class="btn btn-sm" data-view="daily">📅 รายวัน</button>
          <button class="btn btn-sm" data-view="monthly">📊 เฉลี่ยรายเดือน</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Scoreboard เดือน <span id="month-label"></span> ${CURRENT_YEAR_CE + 543}</div>
      <div id="score-table-wrap"></div>
    </div>
  `;

  document.getElementById('month-tabs').innerHTML = MONTHS_TH.map((m, i) => `
    <button class="btn btn-sm" data-month="${i + 1}">${m}</button>
  `).join('');
  highlightMonthTab();
  document.querySelectorAll('#month-tabs [data-month]').forEach(b => b.onclick = async () => {
    selectedMonth = Number(b.dataset.month);
    highlightMonthTab();
    await loadDailyIfNeeded();
    renderTable();
  });

  highlightViewToggle();
  document.querySelectorAll('#view-toggle [data-view]').forEach(b => b.onclick = async () => {
    viewMode = b.dataset.view;
    highlightViewToggle();
    await loadDailyIfNeeded();
    renderTable();
  });

  const viewerSelect = document.getElementById('viewer-select');
  if (viewerSelect) viewerSelect.onchange = async (e) => { viewingUserId = Number(e.target.value); await loadData(); };
  document.getElementById('submit-month-btn').onclick = submitMonth;
  document.getElementById('import-scoreboard-btn').onclick = () => openScoreboardImportModal();

  await loadData();
}

function highlightMonthTab() {
  document.querySelectorAll('#month-tabs [data-month]').forEach(x => {
    const active = Number(x.dataset.month) === selectedMonth;
    x.style.background = active ? 'var(--accent)' : '';
    x.style.color = active ? '#0B1020' : '';
    x.style.borderColor = active ? 'var(--accent)' : '';
  });
}
function highlightViewToggle() {
  document.querySelectorAll('#view-toggle [data-view]').forEach(x => {
    const active = x.dataset.view === viewMode;
    x.style.background = active ? 'var(--accent)' : '';
    x.style.color = active ? '#0B1020' : '';
    x.style.borderColor = active ? 'var(--accent)' : '';
  });
}

async function loadData() {
  document.getElementById('score-table-wrap').innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  const [goals, monthly] = await Promise.all([
    api.listGoals(viewingUserId, CURRENT_YEAR_CE),
    api.getScoreboard(viewingUserId, CURRENT_YEAR_CE),
  ]);
  goalMeta = new Map(goals.map(g => [g.goal_id, g]));
  monthlyData = monthly;
  await loadDailyIfNeeded(true);
  renderTable();
}

async function loadDailyIfNeeded(force = false) {
  if (viewMode !== 'daily' && !force) return;
  const daily = await api.getScoreboardDaily(viewingUserId, CURRENT_YEAR_CE, selectedMonth);
  dailyData = daily;
  dailyOriginal = new Map(daily.map(d => [`${d.goal_id}|${d.entry_date}`, d.actual_val]));
}

function renderTable() {
  document.getElementById('month-label').textContent = MONTHS_TH[selectedMonth - 1];
  const wrap = document.getElementById('score-table-wrap');
  const goalIds = [...goalMeta.keys()];

  if (!goalIds.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">🗓️</div>ยังไม่มีเป้าหมายในปีนี้ กรุณาไปที่หน้า "เป้าหมาย & ทีเด็ด" ก่อน</div>`;
    return;
  }

  if (viewMode === 'daily') renderDailyTable(wrap, goalIds);
  else renderMonthlyTable(wrap, goalIds);
}

function renderDailyTable(wrap, goalIds) {
  const nDays = daysInMonth(CURRENT_YEAR_CE, selectedMonth);
  const days = Array.from({ length: nDays }, (_, i) => i + 1);

  wrap.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th style="position:sticky;left:0;background:var(--bg-panel);z-index:1">เป้าหมาย</th>
          <th>เป้าหมาย (คงที่ทั้งปี)</th>
          ${days.map(d => `<th>${d}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${goalIds.map(gid => {
            const meta = goalMeta.get(gid);
            const isShared = meta.is_shared;
            return `<tr>
              <td style="position:sticky;left:0;background:var(--bg-panel);z-index:1">
                ${esc(meta.goal_title)} ${isShared ? `<span class="pill yellow" style="margin-left:4px"><span class="dot"></span>ถือร่วม</span>` : ''}
              </td>
              <td class="text-muted" style="white-space:nowrap">
                <strong>${OPERATOR_SYMBOL[meta.evaluation_operator] || '≥'} ${meta.target_value ?? '-'}</strong>
                ${meta.metric_unit ? ' ' + esc(meta.metric_unit) : ''}
              </td>
              ${days.map(d => {
                const dateStr = `${CURRENT_YEAR_CE}-${String(selectedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const row = dailyData.find(x => x.goal_id === gid && x.entry_date === dateStr);
                const val = row?.actual_val ?? '';
                return isShared
                  ? `<td class="text-dim" style="font-size:12px">${val}</td>`
                  : `<td class="day-cell"><input type="number" step="0.01" data-gid="${gid}" data-date="${dateStr}" value="${val}"></td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="flex" style="justify-content:flex-end;margin-top:14px">
      <button class="btn btn-primary" id="save-daily-btn">บันทึกผลงานรายวัน</button>
    </div>
  `;
  document.getElementById('save-daily-btn').onclick = saveDaily;
}

function renderMonthlyTable(wrap, goalIds) {
  const rows = goalIds.map(gid => {
    const meta = goalMeta.get(gid);
    const m = monthlyData.find(r => r.goal_id === gid && r.month_num === selectedMonth) || {};
    return { gid, meta, m };
  });

  wrap.innerHTML = `<table>
    <thead><tr>
      <th>เป้าหมาย</th><th>น้ำหนัก</th><th>เป้าหมาย (คงที่ทั้งปี)</th><th>เฉลี่ยรายวันเดือนนี้</th>
      <th>ส่วนต่าง</th><th>% สำเร็จ</th><th>สถานะ</th><th>การอนุมัติ</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${esc(r.meta.goal_title)} ${r.meta.is_shared ? `<span class="pill yellow" style="margin-left:6px"><span class="dot"></span>ถือร่วมกับ ${esc(r.meta.owner_name)}</span>` : ''}</td>
          <td class="text-muted">${r.meta.weight_percentage ?? '-'}%</td>
          <td class="text-muted">
            <strong>${OPERATOR_SYMBOL[r.meta.evaluation_operator] || '≥'} ${r.meta.target_value ?? '-'}</strong>
            ${r.meta.metric_unit ? ' ' + esc(r.meta.metric_unit) : ''}
          </td>
          <td class="text-muted">${r.m.actual_val ?? '-'}</td>
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
  <div class="hint-box mt-16">ค่านี้คำนวณจากค่าเฉลี่ยของรายวัน — แก้ไขได้ที่มุมมอง "📅 รายวัน" เท่านั้น</div>`;
}

async function saveDaily() {
  const btn = document.getElementById('save-daily-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
  try {
    const inputs = [...document.querySelectorAll('#score-table-wrap [data-gid][data-date]')];
    const jobs = [];
    for (const input of inputs) {
      const gid = Number(input.dataset.gid);
      const dateStr = input.dataset.date;
      const key = `${gid}|${dateStr}`;
      const newVal = input.value === '' ? null : Number(input.value);
      const oldVal = dailyOriginal.has(key) ? dailyOriginal.get(key) : null;
      const changed = (newVal ?? null) !== (oldVal ?? null);
      if (changed) {
        jobs.push(api.upsertScoreboardDaily({ goal_id: gid, entry_date: dateStr, actual_val: newVal }));
      }
    }
    if (!jobs.length) { toast('ไม่มีข้อมูลที่เปลี่ยนแปลง'); return; }
    await Promise.all(jobs);
    toast(`บันทึกผลงานรายวันเรียบร้อย (${jobs.length} รายการ)`);
    await loadDailyIfNeeded(true);
    const monthly = await api.getScoreboard(viewingUserId, CURRENT_YEAR_CE);
    monthlyData = monthly;
    renderTable();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'บันทึกผลงานรายวัน';
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

function openScoreboardImportModal() {
  const ownGoals = [...goalMeta.values()].filter(g => !g.is_shared);
  const prefillRows = ownGoals.map(g => [g.goal_title, ...Array(12).fill('')]);
  openImportModal({
    title: 'ผลงานจริงรายเดือน', headers: SCOREBOARD_IMPORT_HEADERS,
    blankFilename: 'ผลงานรายเดือน.csv',
    hint: 'จับคู่ด้วย "ชื่อเป้าหมาย" — ค่าที่นำเข้าจะถูกบันทึกเป็นผลงานของ "วันสุดท้ายของเดือน" นั้นๆ (ไม่ใช่ค่าเฉลี่ยรายวันจริง) เหมาะกับตอนย้ายข้อมูลเก่าที่มีแค่ยอดรายเดือน แนะนำให้กรอกรายวันจริงแทนเมื่อทำได้ เว้นช่องเดือนที่ไม่มีข้อมูลไว้ได้',
    prefillRows,
    onImport: async (rows) => {
      const result = await importScoreboardFromRows(rows, ownGoals, CURRENT_YEAR_CE);
      await loadData();
      return result;
    },
  });
}
