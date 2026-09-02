import { api } from './api.js';

export const USERS_IMPORT_HEADERS = [
  'รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'แผนก(รหัสคั่นด้วยคอมม่า)',
  'ระดับ', 'สาย(MANAGEMENT/SPECIALIST)', 'รักษาการ(TRUE/FALSE)',
  'สิทธิ์(STAFF/SUPERVISOR/ADMIN)', 'รหัสหัวหน้า',
];

function parseTrack(v) {
  const t = (v || '').trim().toUpperCase();
  return t === 'SPECIALIST' ? 'SPECIALIST' : 'MANAGEMENT';
}
function parseBool(v) {
  const t = (v || '').trim().toUpperCase();
  return ['TRUE', '1', 'YES', 'ใช่'].includes(t);
}
function parseRole(v) {
  const t = (v || '').trim().toUpperCase();
  return ['STAFF', 'SUPERVISOR', 'ADMIN'].includes(t) ? t : 'STAFF';
}

// นำเข้าพนักงานจากแถวที่วางมา — จับคู่ด้วยรหัสพนักงาน (emp_code) ถ้ามีอยู่แล้ว
// จะเขียนทับ (update) ถ้าไม่พบจะสร้างใหม่ — ทำ 2 รอบ: รอบแรกสร้าง/แก้ไขข้อมูล
// พื้นฐานทุกคนก่อน (ยังไม่ผูกหัวหน้า) รอบสองค่อยผูก supervisor_id เพราะแถวใน
// ไฟล์อาจเรียงลูกน้องมาก่อนหัวหน้าก็ได้ (ไม่ต้องเรียงตามลำดับ)
export async function importUsersFromRows(rows, existingUsers) {
  let created = 0, updated = 0, skipped = 0; const errors = [];
  const empMap = new Map(existingUsers.map(u => [u.emp_code, u])); // emp_code -> user object (มี user_id)

  const parsedRows = [];
  for (const row of rows) {
    const [empCode, firstName, lastName, nickname, depts, levelStr, trackStr, actingStr, roleStr, supEmpCode] = row;
    if (!empCode || !firstName) { skipped++; continue; }
    const level = Number(levelStr);
    if (Number.isNaN(level)) { errors.push(`"${empCode}": ระดับไม่ใช่ตัวเลข ("${levelStr}")`); skipped++; continue; }
    parsedRows.push({
      empCode: empCode.trim(), firstName: firstName.trim(), lastName: (lastName || '').trim(),
      nickname: (nickname || '').trim(), departments: (depts || '').trim(),
      orgLevel: level, track: parseTrack(trackStr), isActing: parseBool(actingStr),
      role: parseRole(roleStr), supEmpCode: (supEmpCode || '').trim(),
    });
  }

  // รอบที่ 1: สร้าง/แก้ไขข้อมูลพื้นฐาน (ยังไม่ผูกหัวหน้า)
  for (const r of parsedRows) {
    const existing = empMap.get(r.empCode);
    try {
      const newId = await api.upsertUser({
        user_id: existing?.user_id ?? null, emp_code: r.empCode,
        first_name: r.firstName, last_name: r.lastName, nickname: r.nickname,
        departments: r.departments, org_level: r.orgLevel, track: r.track,
        is_acting: r.isActing, supervisor_id: existing?.supervisor_id ?? null, role: r.role,
      });
      empMap.set(r.empCode, { ...(existing || {}), user_id: newId, emp_code: r.empCode });
      existing ? updated++ : created++;
    } catch (err) {
      errors.push(`"${r.empCode}": ${err.message}`);
      skipped++;
    }
  }

  // รอบที่ 2: ผูกหัวหน้า (supervisor_id) หลังจากทุกคนมี user_id แล้ว
  for (const r of parsedRows) {
    if (!r.supEmpCode) continue;
    const me = empMap.get(r.empCode);
    const sup = empMap.get(r.supEmpCode);
    if (!me) continue; // แถวนี้ล้มเหลวตั้งแต่รอบแรกแล้ว
    if (!sup) { errors.push(`"${r.empCode}": ไม่พบรหัสหัวหน้า "${r.supEmpCode}"`); continue; }
    try {
      await api.upsertUser({
        user_id: me.user_id, emp_code: r.empCode, first_name: r.firstName, last_name: r.lastName,
        nickname: r.nickname, departments: r.departments, org_level: r.orgLevel, track: r.track,
        is_acting: r.isActing, supervisor_id: sup.user_id, role: r.role,
      });
    } catch (err) { errors.push(`"${r.empCode}" (ผูกหัวหน้า): ${err.message}`); }
  }

  return { created, updated, skipped, errors };
}
