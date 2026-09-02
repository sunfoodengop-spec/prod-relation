-- ============================================================================
-- Patch 009: ซ่อม "Could not find the function ... in the schema cache"
-- ============================================================================
-- อาการนี้เกิดได้จาก 2 สาเหตุ:
--   (1) ยังไม่เคยรัน patch ที่สร้างฟังก์ชันนี้จริงๆ (เช่น เคยข้าม patch_004 ไป)
--   (2) Supabase (PostgREST) แคช schema ไว้เก่า ยังไม่รู้จักฟังก์ชันที่สร้างใหม่
--       แม้ฟังก์ชันจะมีอยู่จริงในฐานข้อมูลแล้วก็ตาม
-- Patch นี้แก้ทั้งสองกรณีพร้อมกัน: สร้าง/แทนที่ฟังก์ชันที่เกี่ยวข้องใหม่ให้ครบ
-- (ปลอดภัย รันซ้ำได้ ไม่กระทบข้อมูล) แล้วสั่งให้ Supabase โหลด schema ใหม่
-- ทันทีด้วยคำสั่ง NOTIFY ท้ายไฟล์
-- ============================================================================

-- 1) จัดการแผนก
create or replace function list_departments(p_session_token uuid)
returns table (dept_key varchar, label varchar, sort_order int)
language plpgsql
security definer
as $$
declare v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    return query select d.dept_key, d.label, d.sort_order from departments d
        where d.is_active = true order by d.sort_order, d.label;
end;
$$;

create or replace function upsert_department(p_session_token uuid, p_dept_key varchar, p_label varchar, p_sort_order int)
returns boolean
language plpgsql
security definer
as $$
declare v_uid int; v_role user_role;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if v_role <> 'ADMIN' then raise exception 'FORBIDDEN'; end if;

    insert into departments (dept_key, label, sort_order)
    values (p_dept_key, p_label, coalesce(p_sort_order, 0))
    on conflict (dept_key) do update set
        label = excluded.label, sort_order = excluded.sort_order, is_active = true;
    return true;
end;
$$;

create or replace function list_position_titles(p_session_token uuid)
returns table (org_level smallint, track person_track, title varchar)
language plpgsql
security definer
as $$
declare v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    return query select pt.org_level, pt.track, pt.title from position_titles pt
        order by pt.org_level desc, pt.track;
end;
$$;

-- 2) รีเซ็ตรหัสผ่าน
create or replace function admin_reset_password(p_session_token uuid, p_target_user_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int;
    v_role user_role;
    v_emp_code varchar;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if v_role <> 'ADMIN' then raise exception 'FORBIDDEN'; end if;

    select u2.emp_code into v_emp_code from users u2 where u2.user_id = p_target_user_id;
    update users set password_hash = crypt(v_emp_code, gen_salt('bf')), is_first_login = true
        where user_id = p_target_user_id;
    return true;
end;
$$;

-- 3) ลบพนักงาน (Soft Delete) — Admin หรือผู้บังคับบัญชาที่สูงกว่าเท่านั้น
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

    update users set supervisor_id = v_target_supervisor
    where supervisor_id = p_target_user_id;

    update users set is_active = false where user_id = p_target_user_id;

    return true;
end;
$$;

grant execute on all functions in schema public to anon, authenticated;

-- 4) บังคับให้ Supabase (PostgREST) โหลด schema ใหม่ทันที — สำคัญมาก ถ้าข้ามขั้น
--    ตอนนี้ ฟังก์ชันที่เพิ่งสร้าง/แทนที่ข้างบนอาจยังเรียกไม่ได้อีกสักพัก
notify pgrst, 'reload schema';
