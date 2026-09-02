import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, MONTHS_TH, escapeHtml as esc, OPERATOR_SYMBOL, OPERATOR_LABEL_TH } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';
import { openImportModal } from '../importCsv.js';
import { GOALS_IMPORT_HEADERS, TACTICS_IMPORT_HEADERS, SCOREBOARD_IMPORT_HEADERS, importGoalsFromRows, importTacticsFromRows, importScoreboardFromRows } from '../goalImport.js';

// ---- Layout constants (px) -------------------------------------------------
const CARD_W = 172, CARD_H = 62, CARD_GAP_Y = 12, CARD_GAP_X = 10, COL_GAP = 30, ROW_GAP = 60;
const HEADER_H = 30, TOP_MARGIN = 16, LEFT_MARGIN = 24;

let allPeople = [];
let byId = new Map();
let departments = []; // [{dept_key, label, sort_order}]
let currentUser = null;
let subordinateIds = new Set(); // สำหรับ SUPERVISOR เช็คสิทธิ์ลบ (Admin ไม่ต้องเช็ค)
let lastContainer = null;
let colorIndex = new Map(); // dept_key -> 0..5 (สำหรับสีพื้นหลังคอลัมน์)
let activeTab = 'chart'; // 'chart' | 'reorder'
let zoomPct = Number(localStorage.getItem('org_zoom_pct')) || 100;

function deptKeysOf(p) {
  return (p.department || '').split(',').filter(Boolean);
}

export async function render(container, ctx) {
  currentUser = ctx.user;
  lastContainer = container;
  container.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;

  [allPeople, departments] = await Promise.all([api.getOrgChart(), api.listDepartments()]);
  if (!allPeople.length) {
    container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">🕸️</div>ไม่มีข้อมูลผังองค์กรที่คุณมีสิทธิ์เห็น</div></div>`;
    return;
  }
  byId = new Map(allPeople.map(p => [p.user_id, p]));

  subordinateIds = new Set();
  if (currentUser.role === 'SUPERVISOR') {
    try { (await api.getSubordinates()).forEach(s => subordinateIds.add(s.user_id)); } catch { /* ignore */ }
  }

  renderShell(container);
}

function renderShell(container) {
  container.innerHTML = `
    <div class="card mb-16" style="padding:10px 14px">
      <div class="flex-between" style="flex-wrap:wrap;gap:10px">
        <div class="org-tabs">
          <button class="btn btn-sm ${activeTab === 'chart' ? 'active' : ''}" data-tab="chart">🕸️ ผังองค์กร</button>
          ${currentUser.role === 'ADMIN' ? `<button class="btn btn-sm ${activeTab === 'reorder' ? 'active' : ''}" data-tab="reorder">🔀 จัดเรียงคอลัมน์</button>` : ''}
        </div>
        ${activeTab === 'chart' ? `
          <div class="org-zoom-bar">
            <button class="btn btn-sm" id="zoom-out-btn" title="ซูมออก">－</button>
            <span class="zoom-label" id="zoom-label">${zoomPct}%</span>
            <button class="btn btn-sm" id="zoom-in-btn" title="ซูมเข้า">＋</button>
            <button class="btn btn-sm btn-ghost" id="zoom-reset-btn">รีเซ็ต 100%</button>
          </div>
        ` : ''}
      </div>
    </div>
    <div id="org-tab-content"></div>
  `;

  container.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { activeTab = b.dataset.tab; renderShell(container); });

  if (activeTab === 'chart') {
    document.getElementById('zoom-out-btn').onclick = () => setZoom(zoomPct - 25);
    document.getElementById('zoom-in-btn').onclick = () => setZoom(zoomPct + 25);
    document.getElementById('zoom-reset-btn').onclick = () => setZoom(100);
    renderChartTab();
  } else {
    renderReorderTab();
  }
}

function setZoom(pct) {
  zoomPct = Math.max(25, Math.min(150, pct));
  localStorage.setItem('org_zoom_pct', String(zoomPct));
  const label = document.getElementById('zoom-label');
  if (label) label.textContent = zoomPct + '%';
  const canvas = document.querySelector('.org-tree-canvas');
  if (canvas) canvas.style.zoom = zoomPct / 100;
}

function renderChartTab() {
  const target = document.getElementById('org-tab-content');
  // คนที่ไม่มีแผนก (เช่น GM/ผู้บริหาร) วาดเป็นแถวคานกลางเหนือ Matrix แผนก
  const topPeople = allPeople.filter(p => deptKeysOf(p).length === 0);
  const rest = allPeople.filter(p => deptKeysOf(p).length > 0);

  drawTree(topPeople, rest, target);
  setZoom(zoomPct);
  allPeople.forEach(p => loadAchievementBadge(p.user_id));
}

// ============================================================================
// แท็บจัดเรียงคอลัมน์แผนก — ปรับลำดับได้ตรงนี้เลยโดยไม่ต้องไปหน้า Admin
// ============================================================================
function renderReorderTab() {
  const target = document.getElementById('org-tab-content');
  target.innerHTML = `
    <div class="card">
      <div class="card-title">จัดเรียงลำดับคอลัมน์แผนก (ซ้าย → ขวา ในผังองค์กร)</div>
      <p class="text-muted" style="margin-top:-8px;font-size:13px">กด ↑ / ↓ เพื่อสลับลำดับ มีผลทันทีกับหน้าผังองค์กรของทุกคน</p>
      <div id="dept-reorder-list"></div>
    </div>
  `;
  renderReorderList();
}

function renderReorderList() {
  const list = document.getElementById('dept-reorder-list');
  const sorted = [...departments].sort((a, b) => a.sort_order - b.sort_order);
  if (!sorted.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">🗂️</div>ยังไม่มีแผนก — ไปเพิ่มที่หน้า "จัดการพนักงาน" ก่อน</div>`;
    return;
  }
  list.innerHTML = sorted.map((d, i) => `
    <div class="dept-reorder-row">
      <div class="flex gap-8">
        <span class="handle">${i + 1}</span>
        <span>${esc(d.label)}</span>
        <span class="text-dim" style="font-size:12px">(${esc(d.dept_key)})</span>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-sm btn-ghost" data-up="${esc(d.dept_key)}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-sm btn-ghost" data-down="${esc(d.dept_key)}" ${i === sorted.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-up]').forEach(b => b.onclick = () => swapDeptOrder(b.dataset.up, -1));
  list.querySelectorAll('[data-down]').forEach(b => b.onclick = () => swapDeptOrder(b.dataset.down, 1));
}

async function swapDeptOrder(deptKey, dir) {
  const sorted = [...departments].sort((a, b) => a.sort_order - b.sort_order);
  const idx = sorted.findIndex(d => d.dept_key === deptKey);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const aOrder = a.sort_order, bOrder = b.sort_order;
  try {
    await Promise.all([
      api.upsertDepartment(a.dept_key, a.label, bOrder),
      api.upsertDepartment(b.dept_key, b.label, aOrder),
    ]);
    a.sort_order = bOrder; b.sort_order = aOrder;
    renderReorderList();
    toast('ปรับลำดับคอลัมน์แล้ว');
  } catch (err) { toast(err.message, 'error'); }
}

// ============================================================================
// Layout: จัดกลุ่มคอลัมน์แผนกให้แผนกที่มีหัวหน้าร่วม (คุมมากกว่า 1 แผนก) อยู่
// ติดกันเสมอ (Union-Find เรียงคอลัมน์เท่านั้น ไม่ได้ merge ความกว้างคอลัมน์)
// ============================================================================
function buildColumnOrder(rest) {
  const used = new Set();
  rest.forEach(p => deptKeysOf(p).forEach(k => used.add(k)));
  const cols = departments.filter(d => used.has(d.dept_key));
  const parent = new Map(cols.map(c => [c.dept_key, c.dept_key]));
  function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }

  rest.forEach(p => {
    const keys = deptKeysOf(p).filter(k => used.has(k));
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  });

  const groupMinOrder = new Map();
  cols.forEach(c => {
    const root = find(c.dept_key);
    groupMinOrder.set(root, Math.min(groupMinOrder.get(root) ?? Infinity, c.sort_order));
  });

  return [...cols].sort((a, b) => {
    const ga = groupMinOrder.get(find(a.dept_key)), gb = groupMinOrder.get(find(b.dept_key));
    if (ga !== gb) return ga - gb;
    return a.sort_order - b.sort_order;
  });
}

function drawTree(topPeople, rest, container) {
  const columns = buildColumnOrder(rest);
  columns.forEach((c, i) => { if (!colorIndex.has(c.dept_key)) colorIndex.set(c.dept_key, i % 6); });

  const levels = [...new Set(rest.map(p => p.org_level))].sort((a, b) => b - a);

  // ---- แบ่งคนในแต่ละ (ระดับ x คอลัมน์) เป็น solo (แผนกเดียว) และ multi (คุมหลายแผนก)
  const soloCell = {}; // `${level}|${deptKey}` -> [people] เรียงตาม emp_code, MANAGEMENT ก่อน SPECIALIST
  const multiAtLevel = {}; // `${level}` -> [people ที่คุมหลายแผนก]
  levels.forEach(lv => { multiAtLevel[lv] = []; columns.forEach(c => { soloCell[`${lv}|${c.dept_key}`] = []; }); });

  rest.forEach(p => {
    const keys = deptKeysOf(p).filter(k => columns.some(c => c.dept_key === k));
    if (keys.length === 0) return;
    if (keys.length === 1) {
      soloCell[`${p.org_level}|${keys[0]}`]?.push(p);
    } else {
      multiAtLevel[p.org_level]?.push(p);
    }
  });
  const byEmpTrack = (a, b) => (a.track === b.track ? (a.emp_code || '').localeCompare(b.emp_code || '') : (a.track === 'MANAGEMENT' ? -1 : 1));
  Object.values(soloCell).forEach(arr => arr.sort(byEmpTrack));

  // ---- ความกว้างแต่ละคอลัมน์ = จำนวนคนมากสุดในแถวใดๆ ของคอลัมน์นั้น (แนวนอน)
  const colWidth = {};
  columns.forEach(c => {
    const maxCount = Math.max(1, ...levels.map(lv => soloCell[`${lv}|${c.dept_key}`].length || 1));
    colWidth[c.dept_key] = maxCount * (CARD_W + CARD_GAP_X) - CARD_GAP_X;
  });
  const colX = {}; // center
  let cx = LEFT_MARGIN;
  columns.forEach(c => { colX[c.dept_key] = cx + colWidth[c.dept_key] / 2; cx += colWidth[c.dept_key] + COL_GAP; });
  const totalWidth = Math.max(cx - COL_GAP + LEFT_MARGIN, CARD_W + 60);
  const centerX = totalWidth / 2;

  const nodePos = new Map(); // user_id -> {x, y}
  const busY = {}; // level -> y ของเส้นบัสใต้แถวระดับนั้น
  let y = TOP_MARGIN;

  // ---- แถวผู้บริหาร/ไม่มีแผนก (วางกึ่งกลาง ซ้อนจากบนลงล่างตามระดับ) --------
  const topLevels = [...new Set(topPeople.map(p => p.org_level))].sort((a, b) => b - a);
  topLevels.forEach(lv => {
    const people = topPeople.filter(p => p.org_level === lv);
    const rowW = people.length * (CARD_W + COL_GAP) - COL_GAP;
    people.forEach((p, i) => {
      nodePos.set(p.user_id, { x: centerX - rowW / 2 + CARD_W / 2 + i * (CARD_W + COL_GAP), y: y + CARD_H / 2 });
    });
    busY[lv] = y + CARD_H + ROW_GAP / 2;
    y += CARD_H + ROW_GAP;
  });

  // ---- แถว Matrix แผนก -------------------------------------------------------
  y += HEADER_H;
  const colLabelY = y - HEADER_H;
  const rowTop = {};
  levels.forEach(lv => {
    const hasMulti = multiAtLevel[lv].length > 0;
    rowTop[lv] = y;
    let rowY = y;

    if (hasMulti) {
      const people = multiAtLevel[lv];
      people.forEach(p => {
        const keys = deptKeysOf(p).filter(k => columns.some(c => c.dept_key === k));
        const xs = keys.map(k => colX[k]);
        const widths = keys.map(k => colWidth[k]);
        const leftEdge = Math.min(...keys.map((k, i) => xs[i] - widths[i] / 2));
        const rightEdge = Math.max(...keys.map((k, i) => xs[i] + widths[i] / 2));
        nodePos.set(p.user_id, { x: (leftEdge + rightEdge) / 2, y: rowY + CARD_H / 2 });
      });
      rowY += CARD_H + CARD_GAP_Y;
    }

    columns.forEach(c => {
      const people = soloCell[`${lv}|${c.dept_key}`];
      const rowW = people.length * (CARD_W + CARD_GAP_X) - CARD_GAP_X;
      people.forEach((p, i) => {
        nodePos.set(p.user_id, { x: colX[c.dept_key] - rowW / 2 + CARD_W / 2 + i * (CARD_W + CARD_GAP_X), y: rowY + CARD_H / 2 });
      });
    });

    const rowH = (hasMulti ? CARD_H + CARD_GAP_Y : 0) + CARD_H;
    busY[lv] = y + rowH + ROW_GAP / 2;
    y += rowH + ROW_GAP;
  });
  const totalHeight = y - ROW_GAP + 20;

  // ---- เส้นเชื่อมแบบ "เส้นบัส" ไล่ตามลำดับชั้น ห้ามข้ามสาย ----------------
  // เส้นจะวิ่งลงตรงใต้หัวหน้า (แนวตั้งคงที่) ไปจนถึง "บัสของระดับที่อยู่เหนือ
  // ลูกน้องขึ้นไป 1 ขั้น" เท่านั้นถึงจะเลี้ยวหาลูกน้อง — แม้สายบังคับบัญชาจะ
  // ข้ามระดับจริง (เช่น ตำแหน่งกลางว่าง) เส้นก็จะยังไล่ผ่านทีละชั้นแนวตั้ง
  // ไม่ตัดเฉียงข้ามคอลัมน์แผนกอื่นกลางแถว
  const allLevelsSorted = [...new Set(allPeople.map(p => p.org_level))].sort((a, b) => b - a);
  const links = [];
  allPeople.forEach(p => {
    if (!p.supervisor_id) return;
    const sup = byId.get(p.supervisor_id);
    const from = nodePos.get(p.supervisor_id);
    const to = nodePos.get(p.user_id);
    if (!from || !to || !sup) return;
    const nearestAboveChild = allLevelsSorted.filter(lv => lv > p.org_level).sort((a, b) => a - b)[0];
    const busLevel = (nearestAboveChild !== undefined && nearestAboveChild <= sup.org_level) ? nearestAboveChild : sup.org_level;
    const bus = busY[busLevel] ?? (from.y + CARD_H / 2 + 20);
    links.push(`<path d="M ${from.x} ${from.y + CARD_H / 2} V ${bus} H ${to.x} V ${to.y - CARD_H / 2}" class="org-link" fill="none" />`);
  });

  const deptBgs = columns.map(c => `
    <div class="org-tree-dept-bg c${colorIndex.get(c.dept_key)}"
         style="left:${colX[c.dept_key] - colWidth[c.dept_key] / 2 - 8}px;width:${colWidth[c.dept_key] + 16}px;height:${totalHeight}px;top:0"></div>
  `).join('');

  container.innerHTML = `
    <div class="card mb-16" style="padding:10px 14px">
      <p class="text-muted" style="margin:0;font-size:13px">
        คลิกที่การ์ดพนักงานเพื่อดูเป้าหมาย/ทีเด็ด/Scoreboard ${currentUser.role === 'ADMIN' ? '· สิทธิ์ผู้ดูแลระบบสามารถเพิ่ม/แก้ไขเป้าหมาย ทีเด็ด และลบพนักงานได้จากหน้านี้' : '· ผู้บังคับบัญชาสามารถลบลูกน้องในสายงานของตนได้'}
      </p>
    </div>
    <div class="org-tree-wrap">
      <div class="org-tree-canvas" style="width:${totalWidth}px;height:${totalHeight}px">
        ${deptBgs}
        ${columns.map(c => `<div class="org-tree-col-label" style="left:${colX[c.dept_key]}px;top:${colLabelY}px;width:${colWidth[c.dept_key]}px">${esc(c.label)}</div>`).join('')}
        <svg class="org-tree-svg" width="${totalWidth}" height="${totalHeight}">
          <style>.org-link { stroke: var(--border); stroke-width: 1.6px; }</style>
          ${links.join('')}
        </svg>
        ${topPeople.map(p => nodeHtml(p, nodePos.get(p.user_id), true)).join('')}
        ${rest.map(p => { const pos = nodePos.get(p.user_id); return pos ? nodeHtml(p, pos, false) : ''; }).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-person]').forEach(el => {
    el.onclick = () => openPersonModal(Number(el.dataset.person));
  });
}

function nodeHtml(p, pos, isTop) {
  const isMulti = deptKeysOf(p).length > 1;
  const isSpecialist = p.track === 'SPECIALIST';
  const cls = [isTop ? 'gm-node' : '', isSpecialist ? 'specialist' : '', isMulti ? 'multi-dept' : ''].filter(Boolean).join(' ');
  return `
    <div class="org-tree-node ${cls}" data-person="${p.user_id}" style="left:${pos.x}px;top:${pos.y}px">
      <div class="name">${isTop ? '👑 ' : ''}${esc(p.first_name)} ${esc(p.last_name)}${isSpecialist ? '<span class="track-tag">ชช.</span>' : ''}</div>
      <div class="pos">${esc(p.position_title || '')}</div>
      <div class="achv-row" id="achv-${p.user_id}">
        <div class="achv-bar"><span style="width:0%;background:var(--border)"></span></div>
        <span class="achv-val">…</span>
      </div>
    </div>
  `;
}

async function loadAchievementBadge(userId) {
  const slot = document.getElementById(`achv-${userId}`);
  if (!slot) return;
  try {
    const analytics = await api.getIndividualAnalytics(userId, CURRENT_YEAR_CE);
    const val = analytics.overall_achievement;
    const pct = val == null ? 0 : Math.min(100, Math.max(0, val));
    const color = val == null ? 'var(--border)' : val >= 100 ? 'var(--green)' : val >= 80 ? 'var(--amber)' : 'var(--red)';
    slot.innerHTML = `
      <div class="achv-bar"><span style="width:${pct}%;background:${color}"></span></div>
      <span class="achv-val">${val != null ? val + '%' : '—'}</span>
    `;
  } catch {
    slot.innerHTML = `<span class="achv-val">🔒</span>`;
  }
}

// ============================================================================
// Modal: ดู + (ถ้า ADMIN) แก้ไข เป้าหมาย/ทีเด็ด/Scoreboard ของบุคคล + ลบพนักงาน
// ============================================================================
async function openPersonModal(userId) {
  const person = byId.get(userId);
  const backdrop = openModal(`<div class="loading-page"><span class="spinner"></span></div>`);
  backdrop.querySelector('.modal').style.width = '860px';
  await refreshPersonModal(backdrop, userId, person);
}

async function refreshPersonModal(backdrop, userId, person) {
  let goals, scoreboard;
  try {
    [goals, scoreboard] = await Promise.all([
      api.listGoals(userId, CURRENT_YEAR_CE),
      api.getScoreboard(userId, CURRENT_YEAR_CE),
    ]);
  } catch (err) {
    backdrop.querySelector('.modal').innerHTML = `<div class="empty-state"><div class="icon">🔒</div>${esc(err.message)}</div>
      <div class="flex" style="justify-content:flex-end"><button class="btn" id="close-btn">ปิด</button></div>`;
    backdrop.querySelector('#close-btn').onclick = () => closeModal(backdrop);
    return;
  }

  const canEdit = currentUser.role === 'ADMIN';
  const canDelete = userId !== currentUser.user_id &&
    (currentUser.role === 'ADMIN' || (currentUser.role === 'SUPERVISOR' && subordinateIds.has(userId)));

  const rowsHtml = goals.map(g => {
    const monthly = scoreboard.filter(s => s.goal_id === g.goal_id);
    const goalRow = `
      <tr class="goal-row">
        <td class="goal-title-cell">${esc(g.goal_title)} ${g.is_shared ? `<span class="pill yellow" style="margin-left:6px"><span class="dot"></span>ถือร่วมกับ ${esc(g.owner_name)}</span>` : ''}</td>
        <td>${g.target_value != null ? (OPERATOR_SYMBOL[g.evaluation_operator] || '≥') + ' ' + g.target_value : ''}${g.metric_unit ? ' ' + esc(g.metric_unit) : ''}</td>
        ${MONTHS_TH.map((_, i) => {
          const m = monthly.find(x => x.month_num === i + 1);
          const bg = m?.status_color === 'GREEN' ? 'var(--green-bg)' : m?.status_color === 'YELLOW' ? 'var(--amber-bg)' : m?.status_color === 'RED' ? 'var(--red-bg)' : '';
          return `<td style="background:${bg}">${m?.actual_val ?? ''}</td>`;
        }).join('')}
        ${canEdit ? `<td class="actions-cell">
          ${g.is_shared ? '<span class="text-dim" style="font-size:11px">อ่านอย่างเดียว</span>' : `
            <button class="btn btn-sm" data-edit-goal="${g.goal_id}">แก้ไข</button>
            <button class="btn btn-sm btn-danger" data-del-goal="${g.goal_id}">ลบ</button>
          `}
        </td>` : ''}
      </tr>`;
    const tacticsLine = g.tactics.map(t => `
      <span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px">
        ⚡ ${esc(t.tactic_title)}
        ${canEdit && !g.is_shared ? `<a href="#" data-edit-tactic="${t.tactic_id}" data-goal="${g.goal_id}" style="font-size:11px">✏️</a><a href="#" data-del-tactic="${t.tactic_id}" style="font-size:11px">🗑️</a>` : ''}
      </span>`).join('');
    const tacticsRow = `
      <tr class="tactic-row">
        <td class="goal-title-cell" colspan="${2 + MONTHS_TH.length + (canEdit ? 1 : 0)}">
          ${tacticsLine || '<span class="text-dim">ยังไม่มีทีเด็ด</span>'}
          ${canEdit && !g.is_shared ? `<button class="btn btn-sm btn-ghost" data-add-tactic="${g.goal_id}">+ เพิ่มทีเด็ด</button>` : ''}
        </td>
      </tr>`;
    return goalRow + tacticsRow;
  }).join('');

  backdrop.querySelector('.modal').innerHTML = `
    <div class="flex-between" style="align-items:flex-start">
      <div>
        <h3 style="margin:0 0 2px">${esc(person.first_name)} ${esc(person.last_name)} ${person.nickname ? `(${esc(person.nickname)})` : ''}</h3>
        <p class="text-muted" style="margin:0;font-size:13px">${esc(person.position_title)}</p>
      </div>
      <div class="flex gap-8">
        ${canDelete ? `<button class="btn btn-sm btn-danger" id="delete-person-btn">🗑️ ลบพนักงาน</button>` : ''}
        ${canEdit ? `<button class="btn btn-sm" id="import-btn">📥 นำเข้า Excel</button>` : ''}
        ${canEdit ? `<button class="btn btn-primary btn-sm" id="add-goal-btn">+ เพิ่มเป้าหมาย</button>` : ''}
      </div>
    </div>
    <div style="overflow-x:auto;margin-top:14px">
      ${goals.length ? `
      <table class="sb-modal-table">
        <thead>
          <tr>
            <th class="goal-title-head">เป้าหมาย / ทีเด็ด</th>
            <th>Target</th>
            ${MONTHS_TH.map(m => `<th>${m}</th>`).join('')}
            ${canEdit ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>` : `<div class="empty-state"><div class="icon">🎯</div>ยังไม่มีเป้าหมายในปีนี้</div>`}
    </div>
    <div class="flex gap-8 mt-16" style="justify-content:flex-end">
      <button class="btn" id="close-btn">ปิด</button>
    </div>
  `;

  backdrop.querySelector('#close-btn').onclick = () => closeModal(backdrop);
  if (canDelete) {
    backdrop.querySelector('#delete-person-btn').onclick = () => deletePerson(userId, person, backdrop);
  }
  if (canEdit) {
    backdrop.querySelector('#import-btn').onclick = () => openPersonImportChooser(userId, goals, backdrop, person);
    backdrop.querySelector('#add-goal-btn').onclick = () => openGoalEditModal(null, userId, backdrop);
    backdrop.querySelectorAll('[data-edit-goal]').forEach(b => b.onclick = () => openGoalEditModal(goals.find(g => g.goal_id == b.dataset.editGoal), userId, backdrop));
    backdrop.querySelectorAll('[data-del-goal]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('ลบเป้าหมายนี้ใช่หรือไม่? ทีเด็ดภายใต้เป้าหมายนี้จะถูกลบไปด้วย'))) return;
      try { await api.deleteGoal(b.dataset.delGoal); toast('ลบเป้าหมายแล้ว'); await refreshPersonModal(backdrop, userId, person); }
      catch (err) { toast(err.message, 'error'); }
    });
    backdrop.querySelectorAll('[data-add-tactic]').forEach(b => b.onclick = (e) => { e.preventDefault(); openTacticEditModal(null, b.dataset.addTactic, userId, backdrop, person); });
    backdrop.querySelectorAll('[data-edit-tactic]').forEach(a => a.onclick = (e) => {
      e.preventDefault();
      const g = goals.find(g => g.goal_id == a.dataset.goal);
      const t = g.tactics.find(t => t.tactic_id == a.dataset.editTactic);
      openTacticEditModal(t, a.dataset.goal, userId, backdrop, person);
    });
    backdrop.querySelectorAll('[data-del-tactic]').forEach(a => a.onclick = async (e) => {
      e.preventDefault();
      if (!(await confirmDialog('ลบทีเด็ดนี้ใช่หรือไม่?'))) return;
      try { await api.deleteTactic(a.dataset.delTactic); toast('ลบทีเด็ดแล้ว'); await refreshPersonModal(backdrop, userId, person); }
      catch (err) { toast(err.message, 'error'); }
    });
  }
}

function openPersonImportChooser(userId, goals, parentBackdrop, person) {
  const chooser = openModal(`
    <h3 style="margin-top:0">📥 นำเข้า Excel — ${esc(person.first_name)} ${esc(person.last_name)}</h3>
    <div class="flex gap-8" style="flex-direction:column">
      <button class="btn" id="choose-goals">🎯 นำเข้าเป้าหมาย</button>
      <button class="btn" id="choose-tactics">⚡ นำเข้าทีเด็ด</button>
      <button class="btn" id="choose-scoreboard">🗓️ นำเข้าผลงานรายเดือน (12 เดือน)</button>
    </div>
    <div class="flex gap-8 mt-16" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
    </div>
  `);
  chooser.querySelector('#cancel-btn').onclick = () => closeModal(chooser);
  const ownGoals = goals.filter(g => !g.is_shared);

  chooser.querySelector('#choose-goals').onclick = () => {
    closeModal(chooser);
    openImportModal({
      title: 'เป้าหมาย', headers: GOALS_IMPORT_HEADERS, blankFilename: 'เป้าหมาย.csv',
      hint: 'จับคู่ด้วย "ชื่อเป้าหมาย" — ถ้ามีอยู่แล้วจะอัปเดตทับ ถ้าไม่พบจะสร้างใหม่',
      prefillRows: ownGoals.map(g => [g.goal_title, g.metric_unit || '', g.target_value ?? '', OPERATOR_SYMBOL[g.evaluation_operator] || '>=', g.weight_percentage ?? '']),
      onImport: async (rows) => {
        const result = await importGoalsFromRows(userId, CURRENT_YEAR_CE, rows, ownGoals);
        await refreshPersonModal(parentBackdrop, userId, person);
        return result;
      },
    });
  };
  chooser.querySelector('#choose-tactics').onclick = () => {
    closeModal(chooser);
    openImportModal({
      title: 'ทีเด็ด', headers: TACTICS_IMPORT_HEADERS, blankFilename: 'ทีเด็ด.csv',
      hint: 'ต้องมี "ชื่อเป้าหมายที่แนบ" ตรงกับเป้าหมายที่มีอยู่แล้วเท่านั้น',
      prefillRows: ownGoals.flatMap(g => g.tactics.map(t => [g.goal_title, t.tactic_title, t.action_plan_description || ''])),
      onImport: async (rows) => {
        const result = await importTacticsFromRows(userId, rows, ownGoals);
        await refreshPersonModal(parentBackdrop, userId, person);
        return result;
      },
    });
  };
  chooser.querySelector('#choose-scoreboard').onclick = () => {
    closeModal(chooser);
    openImportModal({
      title: 'ผลงานจริงรายเดือน', headers: SCOREBOARD_IMPORT_HEADERS, blankFilename: 'ผลงานรายเดือน.csv',
      hint: 'จับคู่ด้วย "ชื่อเป้าหมาย" เว้นช่องเดือนที่ไม่มีข้อมูลไว้ได้',
      prefillRows: ownGoals.map(g => [g.goal_title, ...Array(12).fill('')]),
      onImport: async (rows) => {
        const result = await importScoreboardFromRows(rows, ownGoals, CURRENT_YEAR_CE);
        await refreshPersonModal(parentBackdrop, userId, person);
        return result;
      },
    });
  };
}

async function deletePerson(userId, person, backdrop) {
  const ok = await confirmDialog(
    `ลบ "${person.first_name} ${person.last_name}" ออกจากระบบใช่หรือไม่? ` +
    `ลูกน้องโดยตรงของคนนี้จะถูกเลื่อนขึ้นไปอยู่ใต้ผู้บังคับบัญชาของเขาแทนโดยอัตโนมัติ ` +
    `(ประวัติเป้าหมาย/Scoreboard ที่เคยบันทึกไว้จะยังอยู่ครบ)`
  );
  if (!ok) return;
  try {
    await api.deactivateUser(userId);
    closeModal(backdrop);
    toast('ลบพนักงานเรียบร้อย');
    if (lastContainer) await render(lastContainer, { user: currentUser });
  } catch (err) { toast(err.message, 'error'); }
}

function openGoalEditModal(goal, targetUserId, parentBackdrop) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${goal ? 'แก้ไขเป้าหมาย' : 'เพิ่มเป้าหมายใหม่'}</h3>
    <div class="field"><label>ชื่อเป้าหมาย</label><input id="f-title" value="${esc(goal?.goal_title || '')}"></div>
    <div class="field-row">
      <div class="field"><label>ตัวชี้วัด (หน่วย)</label><input id="f-unit" value="${esc(goal?.metric_unit || '')}"></div>
      <div class="field"><label>ค่าเป้าหมาย</label><input id="f-target" type="number" step="0.01" value="${goal?.target_value ?? ''}"></div>
    </div>
    <div class="field">
      <label>เงื่อนไขบรรลุเป้า</label>
      <select id="f-operator">
        ${Object.entries(OPERATOR_LABEL_TH).map(([k, v]) => `<option value="${k}" ${(goal?.evaluation_operator || 'GTE') === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>น้ำหนัก (%)</label><input id="f-weight" type="number" step="0.01" value="${goal?.weight_percentage ?? ''}"></div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      await api.upsertGoal({
        goal_id: goal?.goal_id ?? null, target_user_id: targetUserId,
        goal_title: backdrop.querySelector('#f-title').value.trim(),
        metric_unit: backdrop.querySelector('#f-unit').value.trim(),
        target_value: numOrNull(backdrop.querySelector('#f-target').value),
        weight_percentage: numOrNull(backdrop.querySelector('#f-weight').value),
        evaluation_operator: backdrop.querySelector('#f-operator').value,
        year: CURRENT_YEAR_CE, parent_goal_id: goal?.parent_goal_id ?? null,
      });
      closeModal(backdrop);
      toast('บันทึกเป้าหมายเรียบร้อย');
      await refreshPersonModal(parentBackdrop, targetUserId, byId.get(targetUserId));
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openTacticEditModal(tactic, goalId, targetUserId, parentBackdrop, person) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${tactic ? 'แก้ไขทีเด็ด' : 'เพิ่มทีเด็ดใหม่'}</h3>
    <div class="field"><label>ชื่อทีเด็ด</label><input id="f-title" value="${esc(tactic?.tactic_title || '')}"></div>
    <div class="field"><label>รายละเอียดแผนปฏิบัติการ</label><textarea id="f-desc" rows="3">${esc(tactic?.action_plan_description || '')}</textarea></div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      await api.upsertTactic({
        tactic_id: tactic?.tactic_id ?? null, goal_id: goalId,
        tactic_title: backdrop.querySelector('#f-title').value.trim(),
        action_plan_description: backdrop.querySelector('#f-desc').value.trim(),
      });
      closeModal(backdrop);
      toast('บันทึกทีเด็ดเรียบร้อย');
      await refreshPersonModal(parentBackdrop, targetUserId, person);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
