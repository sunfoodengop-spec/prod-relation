import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, escapeHtml as esc, OPERATOR_SYMBOL, OPERATOR_LABEL_TH } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';

let ctx; // { user }
let viewingUserId;
let subordinates = [];
let currentGoals = [];

export async function render(container, context) {
  ctx = context;
  viewingUserId = context.user.user_id;

  if (context.user.role !== 'STAFF') {
    try { subordinates = await api.getSubordinates(); } catch { subordinates = []; }
  }

  container.innerHTML = `
    <div class="flex-between mb-16">
      <div class="flex gap-12">
        ${subordinates.length ? `
          <select id="viewer-select" style="width:260px">
            <option value="${context.user.user_id}">🙋 ของฉันเอง (${esc(context.user.first_name)})</option>
            ${subordinates.map(s => `<option value="${s.user_id}">${esc(s.first_name)} ${esc(s.last_name)} — ${esc(s.position_title)}</option>`).join('')}
          </select>
        ` : ''}
      </div>
      <button class="btn btn-primary" id="add-goal-btn">+ เพิ่มเป้าหมาย</button>
    </div>

    <div id="goals-list"></div>

    ${subordinates.length ? `
      <div class="card mt-24">
        <div class="card-title">🤝 ถือเป้าร่วมกับลูกน้อง</div>
        <p class="text-muted" style="margin:-4px 0 12px;font-size:13px">
          เมื่อถือเป้าร่วม เป้าหมายจะปรากฏในรายการของคุณ (ด้านบน แบบอ่านอย่างเดียว) โดยข้อมูลทั้งหมด — ทีเด็ด และผลบันทึก Scoreboard — จะดึงมาจากสิ่งที่ลูกน้องกรอกเท่านั้น ไม่มีการคัดลอกหรือกรอกซ้ำ
        </p>
        <div id="adopt-panel"></div>
      </div>
    ` : ''}
  `;

  document.getElementById('add-goal-btn').onclick = () => openGoalModal(null);
  const viewerSelect = document.getElementById('viewer-select');
  if (viewerSelect) viewerSelect.onchange = async (e) => {
    viewingUserId = Number(e.target.value);
    await loadGoals(container);
  };

  await loadGoals(container);
  if (subordinates.length) await loadAdoptPanel();
}

async function loadGoals(container) {
  const list = document.getElementById('goals-list');
  list.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  currentGoals = await api.listGoals(viewingUserId, CURRENT_YEAR_CE);

  if (!currentGoals.length) {
    list.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">🎯</div>ยังไม่มีเป้าหมายในปีนี้ กด "+ เพิ่มเป้าหมาย" เพื่อเริ่มต้น</div></div>`;
    return;
  }

  list.innerHTML = currentGoals.map(g => `
    <div class="card" ${g.is_shared ? 'style="border-color:var(--amber)"' : ''}>
      <div class="flex-between">
        <div>
          <strong style="font-size:15.5px">${esc(g.goal_title)}</strong>
          ${g.is_shared ? `<span class="pill yellow" style="margin-left:8px"><span class="dot"></span>ถือร่วมกับ ${esc(g.owner_name)}</span>` : ''}
          <div class="text-muted" style="font-size:13px;margin-top:4px">
            ตัวชี้วัด: ${esc(g.metric_unit || '-')} · เป้าหมาย: <strong>${OPERATOR_SYMBOL[g.evaluation_operator] || '≥'} ${g.target_value ?? '-'}</strong> · น้ำหนัก: ${g.weight_percentage ?? '-'}%
          </div>
        </div>
        <div class="flex gap-8">
          ${g.is_shared ? `
            <button class="btn btn-sm btn-ghost" data-release-goal="${g.goal_id}">เลิกถือร่วม</button>
          ` : `
            <button class="btn btn-sm" data-edit-goal="${g.goal_id}">แก้ไข</button>
            <button class="btn btn-sm btn-danger" data-del-goal="${g.goal_id}">ลบ</button>
          `}
        </div>
      </div>
      <div class="mt-16">
        <div class="flex-between mb-8">
          <span class="text-muted" style="font-size:13px">ทีเด็ด (${g.tactics.length})</span>
          ${g.is_shared ? '' : `<button class="btn btn-sm" data-add-tactic="${g.goal_id}">+ เพิ่มทีเด็ด</button>`}
        </div>
        ${g.tactics.map(t => `
          <div class="flex-between" style="padding:8px 0;border-top:1px solid var(--border)">
            <div>
              <div>${esc(t.tactic_title)}</div>
              ${t.action_plan_description ? `<div class="text-dim" style="font-size:12.5px">${esc(t.action_plan_description)}</div>` : ''}
            </div>
            ${g.is_shared ? '' : `
              <div class="flex gap-8">
                <button class="btn btn-sm" data-edit-tactic='${t.tactic_id}' data-goal="${g.goal_id}">แก้ไข</button>
                <button class="btn btn-sm btn-danger" data-del-tactic="${t.tactic_id}">ลบ</button>
              </div>
            `}
          </div>
        `).join('') || '<div class="text-dim" style="font-size:13px;padding:6px 0">ยังไม่มีทีเด็ด</div>'}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-edit-goal]').forEach(b => b.onclick = () => openGoalModal(currentGoals.find(g => g.goal_id == b.dataset.editGoal)));
  list.querySelectorAll('[data-del-goal]').forEach(b => b.onclick = () => deleteGoal(b.dataset.delGoal, container));
  list.querySelectorAll('[data-release-goal]').forEach(b => b.onclick = () => releaseGoal(b.dataset.releaseGoal, container));
  list.querySelectorAll('[data-add-tactic]').forEach(b => b.onclick = () => openTacticModal(b.dataset.addTactic, null));
  list.querySelectorAll('[data-edit-tactic]').forEach(b => b.onclick = () => {
    const g = currentGoals.find(g => g.goal_id == b.dataset.goal);
    const t = g.tactics.find(t => t.tactic_id == b.dataset.editTactic);
    openTacticModal(b.dataset.goal, t);
  });
  list.querySelectorAll('[data-del-tactic]').forEach(b => b.onclick = () => deleteTactic(b.dataset.delTactic, container));
}

function openGoalModal(goal) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${goal ? 'แก้ไขเป้าหมาย' : 'เพิ่มเป้าหมายใหม่'}</h3>
    <div class="field"><label>ชื่อเป้าหมาย</label><input id="f-title" value="${esc(goal?.goal_title || '')}"></div>
    <div class="field-row">
      <div class="field"><label>ตัวชี้วัด (หน่วย)</label><input id="f-unit" value="${esc(goal?.metric_unit || '')}"></div>
      <div class="field"><label>ค่าเป้าหมาย</label><input id="f-target" type="number" step="0.01" value="${goal?.target_value ?? ''}"></div>
    </div>
    <div class="field">
      <label>เงื่อนไขบรรลุเป้า (ผลจริง [เงื่อนไข] ค่าเป้าหมาย)</label>
      <select id="f-operator">
        ${Object.entries(OPERATOR_LABEL_TH).map(([k, v]) => `<option value="${k}" ${(goal?.evaluation_operator || 'GTE') === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <div class="text-dim" style="font-size:11.5px;margin-top:4px">เช่น เป้าลดของเสีย/ลดเวลาเครื่องเสีย ให้เลือก "น้อยกว่าหรือเท่ากับ" เพราะยิ่งน้อยยิ่งดี</div>
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
        goal_id: goal?.goal_id ?? null, target_user_id: viewingUserId,
        goal_title: backdrop.querySelector('#f-title').value.trim(),
        metric_unit: backdrop.querySelector('#f-unit').value.trim(),
        target_value: numOrNull(backdrop.querySelector('#f-target').value),
        weight_percentage: numOrNull(backdrop.querySelector('#f-weight').value),
        evaluation_operator: backdrop.querySelector('#f-operator').value,
        year: CURRENT_YEAR_CE, parent_goal_id: goal?.parent_goal_id ?? null,
      });
      closeModal(backdrop);
      toast('บันทึกเป้าหมายเรียบร้อย');
      await loadGoals(document);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openTacticModal(goalId, tactic) {
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
      await loadGoals(document);
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function deleteGoal(goalId, container) {
  if (!(await confirmDialog('ต้องการลบเป้าหมายนี้ใช่หรือไม่? ทีเด็ดภายใต้เป้าหมายนี้จะถูกลบไปด้วย'))) return;
  try { await api.deleteGoal(goalId); toast('ลบเป้าหมายแล้ว'); await loadGoals(container); }
  catch (err) { toast(err.message, 'error'); }
}
async function deleteTactic(tacticId, container) {
  if (!(await confirmDialog('ต้องการลบทีเด็ดนี้ใช่หรือไม่?'))) return;
  try { await api.deleteTactic(tacticId); toast('ลบทีเด็ดแล้ว'); await loadGoals(container); }
  catch (err) { toast(err.message, 'error'); }
}
async function releaseGoal(goalId, container) {
  if (!(await confirmDialog('เลิกถือเป้าร่วมนี้ใช่หรือไม่? (เป้าหมายจริงของลูกน้องจะยังอยู่ตามเดิม แค่จะไม่แสดงในรายการของคุณอีก)'))) return;
  try { await api.releaseSharedGoal(goalId); toast('เลิกถือเป้าร่วมแล้ว'); await loadGoals(container); }
  catch (err) { toast(err.message, 'error'); }
}

async function loadAdoptPanel() {
  const panel = document.getElementById('adopt-panel');
  panel.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;

  const rows = await Promise.all(subordinates.map(async s => ({
    sub: s, goals: await api.listGoals(s.user_id, CURRENT_YEAR_CE),
  })));

  // แสดงเฉพาะเป้าหมายของลูกน้องเอง (ไม่รวมที่ลูกน้องถือร่วมมาจากคนอื่นอีกที กันวนซ้ำ)
  // และที่ตัวเราเองยังไม่ได้ถือร่วมอยู่แล้ว
  const heldGoalIds = new Set(currentGoals.filter(g => g.is_shared).map(g => g.goal_id));
  const items = [];
  rows.forEach(({ sub, goals }) => goals
    .filter(g => !g.is_shared && !heldGoalIds.has(g.goal_id))
    .forEach(g => items.push({ goal_id: g.goal_id, title: g.goal_title, tactics_count: g.tactics.length, owner: sub })));

  if (!items.length) {
    panel.innerHTML = `<div class="empty-state"><div class="icon">🤝</div>ไม่มีเป้าหมายของลูกน้องให้ถือร่วมเพิ่มแล้ว</div>`;
    return;
  }

  panel.innerHTML = `<table><thead><tr>
    <th>เป้าหมาย</th><th>เจ้าของ</th><th>ทีเด็ด</th><th></th>
  </tr></thead><tbody>
    ${items.map(it => `
      <tr>
        <td>${esc(it.title)}</td>
        <td class="text-muted">${esc(it.owner.first_name)} ${esc(it.owner.last_name)}</td>
        <td class="text-muted">${it.tactics_count}</td>
        <td><button class="btn btn-sm" data-hold="${it.goal_id}">ถือเป้าร่วม</button></td>
      </tr>
    `).join('')}
  </tbody></table>`;

  panel.querySelectorAll('[data-hold]').forEach(b => b.onclick = () => holdGoal(Number(b.dataset.hold)));
}

async function holdGoal(goalId) {
  try {
    await api.holdSharedGoal(goalId);
    toast('ถือเป้าร่วมเรียบร้อย');
    await loadGoals(document);
    await loadAdoptPanel();
  } catch (err) { toast(err.message, 'error'); }
}

function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
