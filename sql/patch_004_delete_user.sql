-- ============================================================================
-- Patch 004: ลบพนักงานออกจากระบบ (Soft Delete) — ผู้บังคับบัญชาที่สูงกว่า + Admin
-- ============================================================================
-- แนวคิด: ไม่ลบข้อมูลจริง (เพื่อรักษาประวัติ Goal/Scoreboard ที่เคยบันทึกไว้)
-- แต่ตั้ง is_active = false ซึ่งทุก RPC ที่มีอยู่แล้วกรอง is_active = true อยู่แล้ว
-- คนที่ถูกลบจะหายไปจากผังองค์กร/รายชื่อทันที
--
-- เมื่อลบคนที่มีลูกน้องอยู่ ลูกน้องโดยตรงทุกคนจะถูก "เลื่อนขึ้น" ไปอยู่ใต้
-- ผู้บังคับบัญชาของคนที่ถูกลบแทนอัตโนมัติ (สอดคล้องกับหลัก Fallback Routing
-- ที่ระบบใช้อยู่แล้ว — ตำแหน่งว่างระหว่างทางจะถูกข้ามไปโดยอัตโนมัติ)
-- ============================================================================

create or replace function deactivate_user(p_session_token uuid, p_target_user_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_target_supervisor int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;

    if v_uid = p_target_user_id then
        raise exception 'CANNOT_DELETE_SELF';
    end if;

    if v_role <> 'ADMIN' and not _is_supervisor_of(v_uid, p_target_user_id) then
        raise exception 'FORBIDDEN';
    end if;

    select supervisor_id into v_target_supervisor from users where user_id = p_target_user_id;

    -- เลื่อนลูกน้องโดยตรงของคนที่ถูกลบ ขึ้นไปอยู่ใต้ผู้บังคับบัญชาของเขาแทน
    update users set supervisor_id = v_target_supervisor
    where supervisor_id = p_target_user_id;

    update users set is_active = false where user_id = p_target_user_id;

    return true;
end;
$$;

grant execute on all functions in schema public to anon, authenticated;
