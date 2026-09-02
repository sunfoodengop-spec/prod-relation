import { api } from './api.js';
import { MONTHS_TH } from './ui.js';

const OP_TEXT_TO_CODE = { '>': 'GT', '>=': 'GTE', '≥': 'GTE', '<': 'LT', '<=': 'LTE', '≤': 'LTE', '=': 'EQ' };

export const GOALS_IMPORT_HEADERS = ['ชื่อเป้าหมาย', 'ตัวชี้วัด', 'ค่าเป้าหมาย', 'เงื่อนไข(>,>=,<,<=,=)', 'น้ำหนัก(%)'];
export const TACTICS_IMPORT_HEADERS = ['ชื่อเป้าหมายที่แนบ', 'ชื่อทีเด็ด', 'รายละเอียด'];
export const SCOREBOARD_IMPORT_HEADERS = ['ชื่อเป้าหมาย', ...MONTHS_TH];

export async function importGoalsFromRows(targetUserId, year, rows, existingGoals) {
  let created = 0, updated = 0, skipped = 0; const errors = [];
  for (const row of rows) {
    const [title, unit, targetStr, opText, weightStr] = row;
    if (!title) { skipped++; continue; }
    const existing = existingGoals.find(g => g.goal_title.trim() === title.trim());
    const operator = OP_TEXT_TO_CODE[(opText || '').trim()] || 'GTE';
    try {
      await api.upsertGoal({
        goal_id: existing?.goal_id ?? null, target_user_id: targetUserId,
        goal_title: title.trim(), metric_unit: (unit || '').trim() || null,
        target_value: targetStr ? Number(targetStr) : null,
        weight_percentage: weightStr ? Number(weightStr) : null,
        evaluation_operator: operator, year,
        parent_goal_id: existing?.parent_goal_id ?? null,
      });
      existing ? updated++ : created++;
    } catch (err) { errors.push(`"${title}": ${err.message}`); skipped++; }
  }
  return { created, updated, skipped, errors };
}

export async function importTacticsFromRows(targetUserId, rows, existingGoals) {
  let created = 0, updated = 0, skipped = 0; const errors = [];
  for (const row of rows) {
    const [goalTitle, tacticTitle, desc] = row;
    if (!goalTitle || !tacticTitle) { skipped++; continue; }
    const goal = existingGoals.find(g => g.goal_title.trim() === goalTitle.trim());
    if (!goal) { errors.push(`ไม่พบเป้าหมาย "${goalTitle}" — ข้ามแถวนี้`); skipped++; continue; }
    const existingTactic = goal.tactics.find(t => t.tactic_title.trim() === tacticTitle.trim());
    try {
      await api.upsertTactic({
        tactic_id: existingTactic?.tactic_id ?? null, goal_id: goal.goal_id,
        tactic_title: tacticTitle.trim(), action_plan_description: (desc || '').trim(),
      });
      existingTactic ? updated++ : created++;
    } catch (err) { errors.push(`"${tacticTitle}": ${err.message}`); skipped++; }
  }
  return { created, updated, skipped, errors };
}

export async function importScoreboardFromRows(rows, existingGoals, year) {
  let created = 0, updated = 0, skipped = 0; const errors = [];
  for (const row of rows) {
    const [goalTitle, ...monthVals] = row;
    if (!goalTitle) { skipped++; continue; }
    const goal = existingGoals.find(g => g.goal_title.trim() === goalTitle.trim());
    if (!goal) { errors.push(`ไม่พบเป้าหมาย "${goalTitle}" — ข้ามแถวนี้`); skipped++; continue; }
    for (let m = 0; m < 12; m++) {
      const raw = (monthVals[m] || '').trim();
      if (raw === '') continue;
      const val = Number(raw);
      if (Number.isNaN(val)) { errors.push(`"${goalTitle}" เดือน ${MONTHS_TH[m]}: ค่าไม่ใช่ตัวเลข ("${raw}")`); continue; }
      const monthNum = m + 1;
      const lastDay = new Date(year, monthNum, 0).getDate(); // บันทึกลงวันสุดท้ายของเดือน
      const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      try {
        await api.upsertScoreboardDaily({ goal_id: goal.goal_id, entry_date: dateStr, actual_val: val });
        updated++;
      } catch (err) { errors.push(`"${goalTitle}" เดือน ${MONTHS_TH[m]}: ${err.message}`); }
    }
  }
  return { created, updated, skipped, errors };
}
