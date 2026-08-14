import { supabase } from './supabaseClient.js';
import { getToken, clearSession } from './session.js';

// แปล error code จาก Postgres ให้อ่านง่ายเป็นภาษาไทย
const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง',
  INVALID_SESSION: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  FORBIDDEN_ROLE_ELEVATION: 'ไม่สามารถกำหนดสิทธิ์ผู้ดูแลระบบให้ผู้อื่นได้',
  PASSWORD_TOO_SHORT: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร',
  MUST_SPECIFY_PARENT_GOAL: 'กรุณาเลือกเป้าหมายที่จะแนบทีเด็ดนี้',
  CANNOT_ADOPT_TACTIC_AS_GOAL: 'ไม่สามารถพลิกทีเด็ดเป็นเป้าหมายได้โดยตรง',
  GOAL_NOT_FOUND: 'ไม่พบเป้าหมายนี้',
  CANNOT_HOLD_OWN_GOAL: 'ไม่สามารถถือเป้าร่วมกับเป้าหมายของตัวเองได้',
};

function friendlyError(err) {
  const raw = err?.message || String(err);
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) return new Error(ERROR_MESSAGES[code]);
  }
  return new Error(raw);
}

async function call(fnName, params = {}, { auth = true } = {}) {
  const payload = { ...params };
  if (auth) {
    const token = getToken();
    if (!token) {
      window.location.href = './login.html';
      throw new Error('INVALID_SESSION');
    }
    payload.p_session_token = token;
  }
  const { data, error } = await supabase.rpc(fnName, payload);
  if (error) {
    if (error.message?.includes('INVALID_SESSION')) {
      clearSession();
      window.location.href = './login.html';
    }
    throw friendlyError(error);
  }
  return data;
}

export const api = {
  // Auth
  login: (empCode, password) => call('login', { p_emp_code: empCode, p_password: password }, { auth: false }),
  changePassword: (newPassword) => call('change_password', { p_new_password: newPassword }),
  getMyProfile: () => call('get_my_profile'),
  updateMyProfile: (nickname, avatarUrl) => call('update_my_profile', { p_nickname: nickname, p_avatar_url: avatarUrl }),

  // Org
  getSubordinates: () => call('get_subordinates'),
  getOrgChart: () => call('get_org_chart'),
  upsertUser: (u) => call('upsert_user', {
    p_target_user_id: u.user_id ?? null, p_emp_code: u.emp_code, p_first_name: u.first_name,
    p_last_name: u.last_name, p_nickname: u.nickname ?? null, p_position_title: u.position_title,
    p_department: u.department ?? null, p_org_level: u.org_level, p_supervisor_id: u.supervisor_id ?? null,
    p_role: u.role,
  }),
  adminResetPassword: (targetUserId) => call('admin_reset_password', { p_target_user_id: targetUserId }),

  // Goals / Tactics
  listGoals: (targetUserId, year) => call('list_goals', { p_target_user_id: targetUserId, p_year: year }),
  upsertGoal: (g) => call('upsert_goal', {
    p_goal_id: g.goal_id ?? null, p_target_user_id: g.target_user_id, p_goal_title: g.goal_title,
    p_metric_unit: g.metric_unit ?? null, p_target_value: g.target_value ?? null,
    p_weight_percentage: g.weight_percentage ?? null, p_year: g.year, p_parent_goal_id: g.parent_goal_id ?? null,
    p_evaluation_operator: g.evaluation_operator ?? 'GTE',
  }),
  deleteGoal: (goalId) => call('delete_goal', { p_goal_id: goalId }),
  upsertTactic: (t) => call('upsert_tactic', {
    p_tactic_id: t.tactic_id ?? null, p_goal_id: t.goal_id, p_tactic_title: t.tactic_title,
    p_action_plan_description: t.action_plan_description ?? null,
  }),
  deleteTactic: (tacticId) => call('delete_tactic', { p_tactic_id: tacticId }),
  holdSharedGoal: (goalId) => call('hold_shared_goal', { p_goal_id: goalId }),
  releaseSharedGoal: (goalId) => call('release_shared_goal', { p_goal_id: goalId }),

  // Scoreboard
  upsertScoreboard: (s) => call('upsert_scoreboard', {
    p_goal_id: s.goal_id, p_month_num: s.month_num, p_actual_val: s.actual_val ?? null,
  }),
  getScoreboard: (targetUserId, year) => call('get_scoreboard', { p_target_user_id: targetUserId, p_year: year }),
  submitMonthlyReport: (year, month) => call('submit_monthly_report', { p_year: year, p_month_num: month }),
  getPendingApprovals: () => call('get_pending_approvals'),
  reviewMonthlyReport: (targetUserId, year, month, decision, comments) => call('review_monthly_report', {
    p_target_user_id: targetUserId, p_year: year, p_month_num: month, p_decision: decision, p_comments: comments ?? null,
  }),

  // Analytics
  getIndividualAnalytics: (targetUserId, year) => call('get_individual_analytics', { p_target_user_id: targetUserId, p_year: year }),
};
