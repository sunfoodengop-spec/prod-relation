-- ============================================================================
-- Patch 005: Departments table, Dual-Track org model, ตำแหน่ง auto-generate,
--            สิทธิ์แก้ไขข้ามแผนก, ผังองค์กรเห็นทั้งแผนก, แก้บั๊ก Cascade Delete
-- ============================================================================
-- รันใน Supabase SQL Editor ได้ทันที (ปลอดภัย รันซ้ำได้)
--
-- สรุปการเปลี่ยนแปลง:
--   1. ตาราง departments — จัดการแผนกได้จากในแอป ไม่ hardcode ในโค้ด
--   2. ตาราง position_titles — สร้างชื่อตำแหน่งอัตโนมัติจาก (ระดับ + สาย +
--      รักษาการ) ไม่ให้พิมพ์ตำแหน่งปนชื่อแผนกเองอีกต่อไป
--   3. users.track (MANAGEMENT/SPECIALIST) + users.is_acting (รักษาการ) ใหม่
--   4. users.department รองรับหลายแผนก (comma-separated string เดิม แค่ขยาย
--      ความยาวคอลัมน์)
--   5. _can_manage ขยายให้ SUPERVISOR แก้ไขข้ามแผนกได้ถ้าแผนกทับซ้อนกันและ
--      ระดับต่ำกว่า (สิทธิ์แก้ไข "ข้อมูลพนักงาน" เองยังไม่ขยายตามนี้ ตาม spec)
--   6. get_org_chart / get_subordinates ให้ทุก Role เห็นทั้งแผนกตัวเองได้
--   7. แก้บั๊ก: delete_goal ไม่เคย cascade soft-delete ทีเด็ดที่แขวนอยู่จริง
-- ============================================================================

-- 1) ENUM สายงาน --------------------------------------------------------------
do $$ begin
    create type person_track as enum ('MANAGEMENT', 'SPECIALIST');
exception when duplicate_object then null;
end $$;

-- 2) ตาราง departments (จัดการได้จากแอป) --------------------------------------
create table if not exists departments (
    dept_key    varchar(50) primary key,
    label       varchar(100) not null,
    sort_order  int not null default 0,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);
alter table departments enable row level security;
-- ไม่สร้าง policy ให้ anon/authenticated (เข้าถึงผ่าน RPC เท่านั้น)

insert into departments (dept_key, label, sort_order) values
    ('DEPT_A', 'ฝ่าย A (ตัวอย่าง — แก้ไข/เพิ่มแผนกจริงได้ที่หน้าจัดการพนักงาน)', 1),
    ('DEPT_B', 'ฝ่าย B (ตัวอย่าง)', 2)
on conflict (dept_key) do nothing;

-- 3) ตาราง position_titles (สร้างตำแหน่งอัตโนมัติจากระดับ+สายงาน) -------------
create table if not exists position_titles (
    org_level   smallint not null,
    track       person_track not null,
    title       varchar(150) not null,
    primary key (org_level, track)
);
alter table position_titles enable row level security;

insert into position_titles (org_level, track, title) values
    (80, 'MANAGEMENT', 'ผู้จัดการทั่วไป'),
    (75, 'MANAGEMENT', 'ผู้จัดการฝ่าย'),  (75, 'SPECIALIST', 'ผู้เชี่ยวชาญพิเศษ'),
    (65, 'MANAGEMENT', 'ผู้จัดการส่วน'),  (65, 'SPECIALIST', 'ผู้เชี่ยวชาญ'),
    (55, 'MANAGEMENT', 'ผู้จัดการแผนก'),  (55, 'SPECIALIST', 'ผู้ชำนาญการพิเศษ'),
    (40, 'MANAGEMENT', 'วิศวกร/เจ้าหน้าที่'), (40, 'SPECIALIST', 'ผู้ชำนาญการ')
on conflict (org_level, track) do nothing;

-- 4) แก้ไขตาราง users ----------------------------------------------------------
alter table users add column if not exists track person_track not null default 'MANAGEMENT';
alter table users add column if not exists is_acting boolean not null default false;
alter table users alter column department type varchar(300);
-- department เก็บ dept_key หลายค่าคั่นด้วย comma ไม่มีช่องว่าง เช่น 'DEPT_A,DEPT_B'

-- ============================================================================
-- 5) HELPER FUNCTIONS ใหม่
-- ============================================================================

-- คำนวณตำแหน่งอัตโนมัติ — ห้ามให้ผู้ใช้พิมพ์ตำแหน่งเอง
create or replace function _compute_position_title(p_org_level smallint, p_track person_track, p_is_acting boolean)
returns varchar
language plpgsql
security definer
as $$
declare
    v_title varchar;
begin
    select pt.title into v_title from position_titles pt
        where pt.org_level = p_org_level and pt.track = p_track;
    if v_title is null then
        v_title := (case p_track when 'SPECIALIST' then 'ผู้ชำนาญการ' else 'เจ้าหน้าที่' end)
            || ' (ระดับ ' || p_org_level || ')';
    end if;
    if p_is_acting then
        v_title := 'รักษาการ' || v_title;
    end if;
    return v_title;
end;
$$;

-- เช็คว่าแผนกของสองคนทับซ้อนกันหรือไม่ (comma-separated dept_key overlap)
create or replace function _shares_department(p_dept_a varchar, p_dept_b varchar)
returns boolean
language plpgsql
immutable
as $$
declare
    a text[]; b text[];
begin
    if p_dept_a is null or p_dept_b is null or p_dept_a = '' or p_dept_b = '' then
        return false;
    end if;
    a := string_to_array(p_dept_a, ',');
    b := string_to_array(p_dept_b, ',');
    return a && b; -- Postgres array overlap operator
end;
$$;

-- ============================================================================
-- 6) _can_manage: เพิ่มกติกา "แผนกเดียวกัน + ระดับต่ำกว่า" ให้ SUPERVISOR
--    (สิทธิ์นี้ใช้กับ Goal/Tactic/Scoreboard RPC เท่านั้น ไม่ใช้กับการแก้ไข
--    ข้อมูลพนักงานซึ่งยังคงจำกัดที่สายบังคับบัญชาตรงตามเดิม)
-- ============================================================================
create or replace function _can_manage(p_uid int, p_role user_role, p_target int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid_dept varchar; v_uid_level smallint;
    v_target_dept varchar; v_target_level smallint;
begin
    if p_role = 'ADMIN' then return true; end if;
    if p_uid = p_target then return true; end if;
    if p_role = 'SUPERVISOR' then
        if _is_supervisor_of(p_uid, p_target) then return true; end if;

        select department, org_level into v_uid_dept, v_uid_level from users where user_id = p_uid;
        select department, org_level into v_target_dept, v_target_level from users where user_id = p_target;
        if _shares_department(v_uid_dept, v_target_dept) and v_target_level < v_uid_level then
            return true;
        end if;
    end if;
    return false;
end;
$$;

-- ============================================================================
-- 7) get_subordinates: เพิ่ม track/is_acting (ใช้ prefill ฟอร์มแก้ไขพนักงาน)
--    (DROP ก่อน เพราะจำนวนคอลัมน์ผลลัพธ์เปลี่ยน)
-- ============================================================================
drop function if exists get_subordinates(uuid);

create or replace function get_subordinates(p_session_token uuid)
returns table (
    user_id int, emp_code varchar, first_name varchar, last_name varchar,
    nickname varchar, position_title varchar, department varchar,
    role user_role, org_level smallint, supervisor_id int,
    track person_track, is_acting boolean
)
language plpgsql
security definer
as $$
declare
    v_uid int;
    v_role user_role;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;

    if v_role = 'ADMIN' then
        return query select u.user_id, u.emp_code, u.first_name, u.last_name, u.nickname,
            u.position_title, u.department, u.role, u.org_level, u.supervisor_id,
            u.track, u.is_acting
            from users u where u.is_active = true order by u.org_level, u.first_name;
        return;
    end if;

    return query
    with recursive sub as (
        select u.user_id from users u where u.supervisor_id = v_uid
        union all
        select u.user_id from users u join sub s on u.supervisor_id = s.user_id
    )
    select u.user_id, u.emp_code, u.first_name, u.last_name, u.nickname,
           u.position_title, u.department, u.role, u.org_level, u.supervisor_id,
           u.track, u.is_acting
    from users u join sub on u.user_id = sub.user_id
    where u.is_active = true
    order by u.org_level, u.first_name;
end;
$$;

-- ============================================================================
-- 8) get_org_chart: ทุก Role เห็นทั้งแผนกตัวเองได้ (ไม่ใช่แค่สายตรง) +
--    เพิ่ม track/is_acting ในผลลัพธ์ด้วย
--    (DROP ก่อน เพราะจำนวนคอลัมน์ผลลัพธ์เปลี่ยน)
-- ============================================================================
drop function if exists get_org_chart(uuid);

create or replace function get_org_chart(p_session_token uuid)
returns table (
    user_id int, emp_code varchar, first_name varchar, last_name varchar, nickname varchar,
    position_title varchar, department varchar, org_level smallint,
    supervisor_id int, avatar_url text, role user_role,
    track person_track, is_acting boolean
)
language plpgsql
security definer
as $$
declare
    v_uid int;
    v_role user_role;
    v_my_dept varchar;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;

    if v_role = 'ADMIN' then
        return query select u.user_id, u.emp_code, u.first_name, u.last_name, u.nickname, u.position_title,
            u.department, u.org_level, u.supervisor_id, u.avatar_url, u.role, u.track, u.is_acting
            from users u where u.is_active = true;
        return;
    end if;

    select department into v_my_dept from users where user_id = v_uid;

    return query
    with recursive up as ( -- ตัวเองและสายบังคับบัญชาด้านบน (ให้เห็นบริบทถึงยอดสุด)
        select u.* from users u where u.user_id = v_uid
        union all
        select u.* from users u join up on u.user_id = up.supervisor_id
    ),
    down as ( -- ลูกน้องทุกระดับ
        select u.* from users u where u.supervisor_id = v_uid
        union all
        select u.* from users u join down d on u.supervisor_id = d.user_id
    ),
    same_dept as ( -- ทุกคนในแผนกเดียวกัน (ไม่ต้องอยู่สายบังคับบัญชาเดียวกัน)
        select u.* from users u where _shares_department(u.department, v_my_dept)
    )
    select x.user_id, x.emp_code, x.first_name, x.last_name, x.nickname, x.position_title,
           x.department, x.org_level, x.supervisor_id, x.avatar_url, x.role, x.track, x.is_acting
    from (select * from up union select * from down union select * from same_dept) x
    where x.is_active = true;
end;
$$;

-- ============================================================================
-- 9) upsert_user: เอา p_position_title ออก (คำนวณอัตโนมัติ), เพิ่ม
--    p_track/p_is_acting, เปลี่ยน p_department -> p_departments (comma list)
--    (DROP ก่อน เพราะจำนวน/รายการ parameter เปลี่ยน)
-- ============================================================================
drop function if exists upsert_user(uuid, int, varchar, varchar, varchar, varchar, varchar, varchar, smallint, int, user_role);

create or replace function upsert_user(
    p_session_token uuid,
    p_target_user_id int,          -- null = สร้างใหม่
    p_emp_code varchar,
    p_first_name varchar,
    p_last_name varchar,
    p_nickname varchar,
    p_departments varchar,          -- dept_key คั่นด้วย comma เช่น 'DEPT_A,DEPT_B'
    p_org_level smallint,
    p_track person_track,
    p_is_acting boolean,
    p_supervisor_id int,
    p_role user_role
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int;
    v_caller_role user_role;
    v_new_id int;
    v_title varchar;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_caller_role from users u2 where u2.user_id = v_uid;

    if v_caller_role = 'STAFF' then
        raise exception 'FORBIDDEN';
    end if;

    -- SUPERVISOR แก้ไขได้เฉพาะลูกน้องของตน (ทางตรง/ทางอ้อม) และห้ามตั้ง role เป็น ADMIN
    -- (ข้อสังเกต: สิทธิ์นี้ไม่ขยายตามกติกา "แผนกเดียวกัน" ที่ _can_manage มี — ตั้งใจ)
    if v_caller_role = 'SUPERVISOR' then
        if p_target_user_id is not null and not _is_supervisor_of(v_uid, p_target_user_id) then
            raise exception 'FORBIDDEN';
        end if;
        if p_role = 'ADMIN' then
            raise exception 'FORBIDDEN_ROLE_ELEVATION';
        end if;
    end if;

    v_title := _compute_position_title(p_org_level, p_track, p_is_acting);

    if p_target_user_id is null then
        insert into users (emp_code, password_hash, first_name, last_name, nickname,
            position_title, department, org_level, track, is_acting, supervisor_id, role)
        values (p_emp_code, crypt(p_emp_code, gen_salt('bf')), p_first_name, p_last_name,
            p_nickname, v_title, p_departments, p_org_level, p_track, coalesce(p_is_acting, false),
            p_supervisor_id, p_role)
        returning user_id into v_new_id;
        return v_new_id;
    else
        update users set
            emp_code = p_emp_code, first_name = p_first_name, last_name = p_last_name,
            nickname = p_nickname, position_title = v_title, department = p_departments,
            org_level = p_org_level, track = p_track, is_acting = coalesce(p_is_acting, false),
            supervisor_id = p_supervisor_id, role = p_role
        where user_id = p_target_user_id;
        return p_target_user_id;
    end if;
end;
$$;

-- ============================================================================
-- 10) department management RPCs
-- ============================================================================
create or replace function list_departments(p_session_token uuid)
returns table (dept_key varchar, label varchar, sort_order int)
language plpgsql
security definer
as $$
declare v_uid int;
begin
    v_uid := _current_user_id(p_session_token); -- แค่ต้อง login ก็ดูรายการแผนกได้
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

-- ============================================================================
-- 11) แก้บั๊ก: delete_goal ต้อง cascade soft-delete ทีเด็ดที่แขวนอยู่จริง
--     (ของเดิมแค่ set goals.is_active=false เฉยๆ ทีเด็ดยังเหลือ is_active=true
--     ค้างอยู่ — ป้องกัน bug นี้เกิดซ้ำ: ทุกจุดที่ query ทีเด็ด join กับ goals
--     ต้องเช็ค is_active ของทั้งคู่เสมอ ไม่ใช่แค่ตารางลูกอย่างเดียว)
-- ============================================================================
create or replace function delete_goal(p_session_token uuid, p_goal_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select user_id into v_owner from goals where goal_id = p_goal_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    update tactics set is_active = false where goal_id = p_goal_id;
    update goals set is_active = false where goal_id = p_goal_id;
    return true;
end;
$$;

grant execute on all functions in schema public to anon, authenticated;
