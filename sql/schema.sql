-- ============================================================================
-- ระบบบริหารเป้าหมาย ทีเด็ด และ Scoreboard — Supabase Schema
-- ============================================================================
-- สถาปัตยกรรม: เว็บเป็น Static Site (GitHub Pages) เรียก Supabase ด้วย anon key
-- โดยตรง จึง "ห้าม" เปิดให้ query ตาราง users/goals/... ตรงๆ (จะทำให้ password
-- hash และข้อมูลข้ามสิทธิ์รั่วออกไปที่ browser ได้)
--
-- แนวทางที่ใช้:
--   1. เปิด Row Level Security (RLS) บนทุกตาราง แต่ "ไม่สร้าง policy ใดๆ" ให้
--      role anon/authenticated เลย -> เท่ากับปิดการเข้าถึงตรงทุกช่องทาง
--   2. การอ่าน/เขียนข้อมูลทั้งหมดทำผ่าน RPC Function ที่ประกาศเป็น
--      SECURITY DEFINER เท่านั้น -> ฟังก์ชันจะรันด้วยสิทธิ์เจ้าของ (bypass RLS)
--      แต่ตัวฟังก์ชันเองจะตรวจสอบ session token + role + สายบังคับบัญชา
--      ก่อนอนุญาตทุกครั้ง
--   3. Login ไม่ใช้ Supabase Auth (เพราะ spec กำหนด username/password = รหัส
--      พนักงาน ไม่ใช่อีเมล) แต่ทำ custom session ผ่านตาราง `sessions` เอง
--      โดยฝั่ง client จะเก็บ session_token (UUID) ไว้ใน localStorage แล้วส่ง
--      แนบไปกับทุก RPC call แทน auth.uid()
--
-- วิธีติดตั้ง: เปิด Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ทั้งหมด -> Run
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================
create type user_role as enum ('STAFF', 'SUPERVISOR', 'ADMIN');
create type approval_status as enum ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');
create type status_color as enum ('GREEN', 'YELLOW', 'RED');
create type adopt_target as enum ('GOAL', 'TACTIC');
create type eval_operator as enum ('GT', 'GTE', 'LT', 'LTE', 'EQ'); -- เงื่อนไขประเมินผล: > / >= / < / <= / =
create type person_track as enum ('MANAGEMENT', 'SPECIALIST'); -- สายบริหาร vs สายผู้ชำนาญการ

-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- 2.1 Users -------------------------------------------------------------
create table users (
    user_id           serial primary key,
    emp_code          varchar(50) unique not null,       -- รหัสพนักงาน หรือ '123456'
    password_hash     varchar(255) not null,
    first_name        varchar(100) not null,
    last_name         varchar(100) not null,
    nickname          varchar(50),
    position_title    varchar(150) not null,               -- คำนวณอัตโนมัติจาก org_level+track+is_acting เสมอ (ดู _compute_position_title) — ห้ามให้ผู้ใช้พิมพ์เอง
    department        varchar(300),                          -- dept_key หลายค่าคั่นด้วย comma เช่น 'DEPT_A,DEPT_B' (อ้างอิงตาราง departments)
    org_level         smallint not null default 40,       -- ปรับตามจริงของแต่ละองค์กร ค่าเริ่มต้นที่ใช้: 80=ผู้จัดการทั่วไป, 75=ผจก.ฝ่าย/ผู้เชี่ยวชาญพิเศษ, 65=ผจก.ส่วน/ผู้เชี่ยวชาญ, 55=ผจก.แผนก/ผู้ชำนาญการพิเศษ, 40=เจ้าหน้าที่/ผู้ชำนาญการ
    track             person_track not null default 'MANAGEMENT', -- สายบริหาร หรือ สายผู้ชำนาญการ (ขนานกันคนละสายที่ org_level เดียวกันได้)
    is_acting         boolean not null default false,       -- รักษาการ (แสดงนำหน้าตำแหน่งอัตโนมัติ)
    supervisor_id     int references users(user_id),      -- ผู้บังคับบัญชาโดยตรง (fallback ถูก "baked" ไว้ในค่านี้:
                                                            -- ถ้าตำแหน่งระดับกลางว่าง ให้ตั้งค่านี้ชี้ข้ามไปยังระดับถัดไปเลย)
    role              user_role not null default 'STAFF',
    is_first_login    boolean not null default true,
    is_active         boolean not null default true,
    avatar_url        text,
    created_at        timestamptz not null default now()
);

-- 2.2 Sessions (custom auth, ไม่ใช้ Supabase Auth) -----------------------
create table sessions (
    session_token   uuid primary key default gen_random_uuid(),
    user_id         int not null references users(user_id) on delete cascade,
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null default (now() + interval '12 hours')
);

-- 2.3 Goals ---------------------------------------------------------------
create table goals (
    goal_id             serial primary key,
    user_id             int not null references users(user_id) on delete cascade,
    goal_title          text not null,
    metric_unit         varchar(50),
    target_value        decimal(10,2),
    weight_percentage   decimal(5,2),
    year                int not null,
    parent_goal_id      int references goals(goal_id),   -- ลูกน้อง goal ต้นทางที่หัวหน้า "พลิก" ขึ้นมา
    evaluation_operator eval_operator not null default 'GTE', -- เงื่อนไขบรรลุเป้า: ผลจริง [op] เป้าหมาย
    is_active           boolean not null default true,
    created_at          timestamptz not null default now()
);

-- 2.4 Tactics (ทีเด็ด) -----------------------------------------------------
create table tactics (
    tactic_id                serial primary key,
    goal_id                  int not null references goals(goal_id) on delete cascade,
    tactic_title             text not null,
    action_plan_description  text,
    adopted_from_tactic_id   int references tactics(tactic_id), -- ลิงก์ทีเด็ดต้นทางเมื่อถูกพลิกขึ้นมา
    is_active                boolean not null default true,
    created_at                timestamptz not null default now()
);

-- 2.5 Scoreboard Monthly ----------------------------------------------------
-- หมายเหตุ: เก็บเฉพาะ "สถานะการอนุมัติ" รายเดือนเท่านั้น (DRAFT/SUBMITTED/
-- APPROVED/REJECTED) — ตัวเลขผลงานจริงกรอกเป็นรายวันที่ตาราง scoreboard_daily
-- แทน ผลรายเดือนที่แสดงผลคือค่าเฉลี่ยของรายวันในเดือนนั้น คำนวณสดทุกครั้งที่
-- อ่าน ไม่ถูกเก็บซ้ำในตารางนี้ เป้าหมาย (target) อ่านจาก goals.target_value
-- เพียงจุดเดียวเสมอ (Single Source of Truth)
create table scoreboard_monthly (
    scoreboard_id           serial primary key,
    goal_id                 int not null references goals(goal_id) on delete cascade,
    month_num               int not null check (month_num between 1 and 12),
    approval_status         approval_status not null default 'DRAFT',
    reviewer_comments       text,
    reviewed_by             int references users(user_id),
    updated_at              timestamptz not null default now(),
    unique (goal_id, month_num)
);

-- 2.5b Scoreboard Daily — ผลงานจริงกรอกทีละวัน (Single Source of Truth ของค่าจริง)
create table scoreboard_daily (
    daily_id     serial primary key,
    goal_id      int not null references goals(goal_id) on delete cascade,
    entry_date   date not null,
    actual_val   decimal(10,2),
    updated_at   timestamptz not null default now(),
    unique (goal_id, entry_date)
);

create index idx_goals_user_year on goals(user_id, year);
create index idx_tactics_goal on tactics(goal_id);
create index idx_scoreboard_goal_month on scoreboard_monthly(goal_id, month_num);
create index idx_scoreboard_daily_goal_date on scoreboard_daily(goal_id, entry_date);
create index idx_users_supervisor on users(supervisor_id);
create index idx_sessions_user on sessions(user_id);

-- 2.6 Departments (จัดการแผนกได้จากในแอป ไม่ hardcode) ------------------------
create table departments (
    dept_key    varchar(50) primary key,
    label       varchar(100) not null,
    sort_order  int not null default 0,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);

-- 2.7 Position Titles (สร้างชื่อตำแหน่งอัตโนมัติจาก org_level + track) -------
create table position_titles (
    org_level   smallint not null,
    track       person_track not null,
    title       varchar(150) not null,
    primary key (org_level, track)
);

-- 2.8 Goal Co-Owners (ถือเป้าร่วม) -------------------------------------------
-- หัวหน้า "ถือร่วม" เป้าหมายของลูกน้องโดยอ้างอิง goal_id เดิมโดยตรง ไม่คัดลอก
-- ข้อมูลใดๆ ทีเด็ด/ผลบันทึก Scoreboard จึงเป็นแถวเดียวกันกับที่ลูกน้องกรอกเสมอ
create table goal_co_owners (
    goal_id         int not null references goals(goal_id) on delete cascade,
    holder_user_id  int not null references users(user_id) on delete cascade,
    created_at      timestamptz not null default now(),
    primary key (goal_id, holder_user_id)
);
create index idx_goal_co_owners_holder on goal_co_owners(holder_user_id);

-- ============================================================================
-- 3. ล็อกทุกตารางด้วย RLS แบบไม่มี policy ให้ anon/authenticated เลย
--    (เข้าถึงได้ทางเดียวคือผ่าน RPC ด้านล่าง ซึ่งเป็น SECURITY DEFINER)
-- ============================================================================
alter table users enable row level security;
alter table sessions enable row level security;
alter table goals enable row level security;
alter table tactics enable row level security;
alter table scoreboard_monthly enable row level security;
alter table scoreboard_daily enable row level security;
alter table goal_co_owners enable row level security;
alter table departments enable row level security;
alter table position_titles enable row level security;
-- ไม่สร้าง policy ใดๆ ต่อจากนี้ = deny-all สำหรับ anon/authenticated โดย default

-- ============================================================================
-- 4. HELPER FUNCTIONS (internal, ไม่เรียกจาก client โดยตรง)
-- ============================================================================

-- 4.1 ตรวจ session token -> คืน user_id ถ้ายังไม่หมดอายุ, error ถ้าไม่ valid
create or replace function _current_user_id(p_session_token uuid)
returns int
language plpgsql
security definer
as $$
declare
    v_user_id int;
begin
    select user_id into v_user_id
    from sessions
    where session_token = p_session_token
      and expires_at > now();

    if v_user_id is null then
        raise exception 'INVALID_SESSION' using errcode = '28000';
    end if;

    return v_user_id;
end;
$$;

-- 4.2 ตรวจว่า p_ancestor_id เป็นหัวหน้า (ทางตรงหรือทางอ้อม) ของ p_user_id หรือไม่
create or replace function _is_supervisor_of(p_ancestor_id int, p_user_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_current int;
    v_depth int := 0;
begin
    if p_ancestor_id = p_user_id then
        return false;
    end if;
    v_current := p_user_id;
    while v_current is not null and v_depth < 10 loop
        select u2.supervisor_id into v_current from users u2 where u2.user_id = v_current;
        if v_current = p_ancestor_id then
            return true;
        end if;
        v_depth := v_depth + 1;
    end loop;
    return false;
end;
$$;

-- 4.2b คำนวณตำแหน่งอัตโนมัติจาก org_level + track + is_acting — ห้ามให้
--      ผู้ใช้พิมพ์ตำแหน่งเอง (กันตำแหน่งปนชื่อแผนก / สะกดไม่ตรงกัน)
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

-- 4.2c เช็คว่าแผนกของสองคนทับซ้อนกันหรือไม่ (comma-separated dept_key overlap)
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

-- 4.3 หา "ผู้อนุมัติ" ของพนักงานคนหนึ่ง = supervisor_id โดยตรง
--     (Fallback Routing ถูกเข้ารหัสไว้ในข้อมูล users.supervisor_id อยู่แล้ว:
--      ตอนตั้งค่าโครงสร้างองค์กร ถ้าตำแหน่งระดับกลางว่าง ผู้ดูแลระบบต้อง set
--      supervisor_id ของพนักงานคนนั้นให้ชี้ข้ามไปยังหัวหน้าระดับถัดไปที่มีตัวตน)
create or replace function _get_approver(p_user_id int)
returns int
language sql
security definer
as $$
    select supervisor_id from users where user_id = p_user_id;
$$;

-- 4.4 คำนวณผลสำเร็จ / สถานะสี — รู้ทิศทางเงื่อนไข (มากกว่า/น้อยกว่า/เท่ากับ)
create or replace function _calc_achievement_pct(p_target decimal, p_actual decimal, p_op eval_operator)
returns decimal
language plpgsql
immutable
as $$
begin
    if p_actual is null then return null; end if;
    if p_op in ('GT','GTE') then
        if coalesce(p_target,0) = 0 then
            return case when p_actual = 0 then 100 else null end;
        end if;
        return round((p_actual / p_target) * 100, 2);
    elsif p_op in ('LT','LTE') then
        if coalesce(p_target,0) = 0 then
            return case when p_actual = 0 then 100 else 0 end;
        end if;
        return round((p_target / greatest(p_actual, 0.0001)) * 100, 2);
    elsif p_op = 'EQ' then
        if coalesce(p_target,0) = 0 then
            return case when p_actual = 0 then 100 else 0 end;
        end if;
        return greatest(0, round(100 - (abs(p_actual - p_target) / p_target) * 100, 2));
    end if;
    return null;
end;
$$;

create or replace function _calc_achieved(p_target decimal, p_actual decimal, p_op eval_operator)
returns boolean
language plpgsql
immutable
as $$
begin
    if p_actual is null or p_target is null then return null; end if;
    return case p_op
        when 'GT' then p_actual > p_target
        when 'GTE' then p_actual >= p_target
        when 'LT' then p_actual < p_target
        when 'LTE' then p_actual <= p_target
        when 'EQ' then p_actual = p_target
        else null
    end;
end;
$$;

create or replace function _calc_status_color(p_target decimal, p_actual decimal, p_op eval_operator)
returns status_color
language plpgsql
immutable
as $$
declare
    v_pct decimal;
begin
    if p_actual is null then return null; end if;
    if _calc_achieved(p_target, p_actual, p_op) then return 'GREEN'; end if;
    v_pct := _calc_achievement_pct(p_target, p_actual, p_op);
    if v_pct is not null and v_pct >= 80 then return 'YELLOW'; end if;
    return 'RED';
end;
$$;

-- ============================================================================
-- 5. AUTH RPCs
-- ============================================================================

-- 5.1 Login: emp_code + password -> session token + profile
create or replace function login(p_emp_code varchar, p_password varchar)
returns table (
    session_token uuid,
    user_id int,
    first_name varchar,
    last_name varchar,
    nickname varchar,
    position_title varchar,
    department varchar,
    role user_role,
    org_level smallint,
    is_first_login boolean
)
language plpgsql
security definer
as $$
declare
    v_user users%rowtype;
    v_token uuid;
begin
    select * into v_user from users where emp_code = p_emp_code and is_active = true;

    if v_user.user_id is null or v_user.password_hash <> crypt(p_password, v_user.password_hash) then
        raise exception 'INVALID_CREDENTIALS' using errcode = '28P01';
    end if;

    insert into sessions (user_id) values (v_user.user_id) returning sessions.session_token into v_token;

    return query select v_token, v_user.user_id, v_user.first_name, v_user.last_name,
        v_user.nickname, v_user.position_title, v_user.department, v_user.role,
        v_user.org_level, v_user.is_first_login;
end;
$$;

-- 5.2 บังคับเปลี่ยนรหัสผ่าน (ครั้งแรก) / เปลี่ยนรหัสผ่านทั่วไป
create or replace function change_password(p_session_token uuid, p_new_password varchar)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    if length(p_new_password) < 6 then
        raise exception 'PASSWORD_TOO_SHORT';
    end if;
    update users
       set password_hash = crypt(p_new_password, gen_salt('bf')),
           is_first_login = false
     where user_id = v_uid;
    return true;
end;
$$;

-- 5.3 ดูโปรไฟล์ตนเอง
create or replace function get_my_profile(p_session_token uuid)
returns table (
    user_id int, emp_code varchar, first_name varchar, last_name varchar,
    nickname varchar, position_title varchar, department varchar,
    role user_role, org_level smallint, supervisor_id int, avatar_url text
)
language plpgsql
security definer
as $$
declare
    v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    return query
    select u.user_id, u.emp_code, u.first_name, u.last_name, u.nickname,
           u.position_title, u.department, u.role, u.org_level, u.supervisor_id, u.avatar_url
    from users u where u.user_id = v_uid;
end;
$$;

-- 5.4 แก้ไขโปรไฟล์ตนเอง (เฉพาะฟิลด์ที่พนักงานทั่วไปแก้ได้เอง)
create or replace function update_my_profile(
    p_session_token uuid, p_nickname varchar, p_avatar_url text
)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    update users set nickname = p_nickname, avatar_url = coalesce(p_avatar_url, avatar_url)
    where user_id = v_uid;
    return true;
end;
$$;

-- ============================================================================
-- 6. ORG STRUCTURE RPCs
-- ============================================================================

-- 6.1 คืนรายชื่อ "ลูกน้องทุกระดับ" (สำหรับ Cascade/Adopt + Supervisor edit)
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

-- 6.2 คืนผังองค์กรทั้งหมดที่ผู้ใช้มีสิทธิ์เห็น (สำหรับ Org Chart)
--     ADMIN เห็นทั้งองค์กร — ทุก Role อื่นเห็น: ตนเอง + สายบังคับบัญชาด้านบน
--     (ให้เห็นบริบทถึงยอดสุด) + ลูกน้องทุกระดับ + ทุกคนในแผนกเดียวกัน (ไม่ต้อง
--     อยู่สายบังคับบัญชาเดียวกันก็เห็นได้ ถ้าอยู่แผนกเดียวกัน)
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
    with recursive up as ( -- ตัวเองและสายบังคับบัญชาด้านบน
        select u.* from users u where u.user_id = v_uid
        union all
        select u.* from users u join up on u.user_id = up.supervisor_id
    ),
    down as ( -- ลูกน้องทุกระดับ
        select u.* from users u where u.supervisor_id = v_uid
        union all
        select u.* from users u join down d on u.supervisor_id = d.user_id
    ),
    same_dept as ( -- ทุกคนในแผนกเดียวกัน
        select u.* from users u where _shares_department(u.department, v_my_dept)
    )
    select x.user_id, x.emp_code, x.first_name, x.last_name, x.nickname, x.position_title,
           x.department, x.org_level, x.supervisor_id, x.avatar_url, x.role, x.track, x.is_acting
    from (select * from up union select * from down union select * from same_dept) x
    where x.is_active = true;
end;
$$;

-- 6.3 Admin/Supervisor: สร้างหรือแก้ไขพนักงาน — ตำแหน่งคำนวณอัตโนมัติเสมอ
--     (ไม่รับตำแหน่งที่พิมพ์เอง กันตำแหน่งปนชื่อแผนก/สะกดไม่ตรงกัน)
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
    -- (สิทธิ์นี้ไม่ขยายตามกติกา "แผนกเดียวกัน" ที่ _can_manage มี — ตั้งใจ เพื่อความปลอดภัย)
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

-- 6.3b จัดการแผนก (Admin เท่านั้น) — ห้าม hardcode รายชื่อแผนกในโค้ด
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

-- 6.4 Admin: reset รหัสผ่านพนักงานกลับเป็นรหัสพนักงาน + บังคับเปลี่ยนใหม่รอบหน้า
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

-- 6.5 ลบพนักงาน (Soft Delete) — Admin หรือผู้บังคับบัญชาที่สูงกว่าเท่านั้น
--     ลูกน้องโดยตรงของคนที่ถูกลบจะถูกเลื่อนขึ้นไปอยู่ใต้ผู้บังคับบัญชาของเขาแทน
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

-- ============================================================================
-- 7. GOAL & TACTIC RPCs
-- ============================================================================

-- ตรวจสิทธิ์แก้ไขข้อมูลของ target_user_id (ตนเอง / หัวหน้าของเขา /
-- คนแผนกเดียวกันที่ระดับต่ำกว่า / admin) — ใช้กับ Goal/Tactic/Scoreboard
-- RPC เท่านั้น ไม่ใช้กับการแก้ไขข้อมูลพนักงาน (upsert_user มีเช็คแยกของตัวเอง)
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

-- 7.1 รายการ Goals ของคนใดคนหนึ่ง (พร้อม tactics แบบ nested json)
--     รวมเป้าหมายที่ "ถือร่วม" ด้วย — ทีเด็ดใต้เป้าหมายที่ถือร่วมติดมาอัตโนมัติ
--     เพราะเป็น goal_id เดียวกันกับต้นฉบับ
create or replace function list_goals(p_session_token uuid, p_target_user_id int, p_year int)
returns table (
    goal_id int, goal_title text, metric_unit varchar, target_value decimal,
    weight_percentage decimal, parent_goal_id int, evaluation_operator eval_operator,
    is_shared boolean, owner_name text, tactics json
)
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then
        raise exception 'FORBIDDEN';
    end if;

    return query
    select g.goal_id, g.goal_title, g.metric_unit, g.target_value, g.weight_percentage,
           g.parent_goal_id, g.evaluation_operator,
           (g.user_id <> p_target_user_id) as is_shared,
           case when g.user_id <> p_target_user_id
                then (select ou.first_name || ' ' || ou.last_name from users ou where ou.user_id = g.user_id)
                else null end as owner_name,
           coalesce((select json_agg(json_build_object(
                'tactic_id', t.tactic_id, 'tactic_title', t.tactic_title,
                'action_plan_description', t.action_plan_description,
                'adopted_from_tactic_id', t.adopted_from_tactic_id))
             from tactics t where t.goal_id = g.goal_id and t.is_active = true), '[]'::json) as tactics
    from goals g
    where g.is_active = true and g.year = p_year
      and (g.user_id = p_target_user_id
           or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
    order by g.goal_id;
end;
$$;

-- 7.2 สร้าง/แก้ไข Goal
create or replace function upsert_goal(
    p_session_token uuid, p_goal_id int, p_target_user_id int, p_goal_title text,
    p_metric_unit varchar, p_target_value decimal, p_weight_percentage decimal,
    p_year int, p_parent_goal_id int, p_evaluation_operator eval_operator default 'GTE'
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then raise exception 'FORBIDDEN'; end if;

    if p_goal_id is null then
        insert into goals (user_id, goal_title, metric_unit, target_value, weight_percentage, year, parent_goal_id, evaluation_operator)
        values (p_target_user_id, p_goal_title, p_metric_unit, p_target_value, p_weight_percentage, p_year, p_parent_goal_id, coalesce(p_evaluation_operator, 'GTE'))
        returning goal_id into v_id;
    else
        update goals set goal_title = p_goal_title, metric_unit = p_metric_unit,
            target_value = p_target_value, weight_percentage = p_weight_percentage,
            evaluation_operator = coalesce(p_evaluation_operator, evaluation_operator)
        where goal_id = p_goal_id returning goal_id into v_id;
    end if;
    return v_id;
end;
$$;

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

-- 7.3 สร้าง/แก้ไข Tactic
create or replace function upsert_tactic(
    p_session_token uuid, p_tactic_id int, p_goal_id int,
    p_tactic_title text, p_action_plan_description text
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select user_id into v_owner from goals where goal_id = p_goal_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    if p_tactic_id is null then
        insert into tactics (goal_id, tactic_title, action_plan_description)
        values (p_goal_id, p_tactic_title, p_action_plan_description)
        returning tactic_id into v_id;
    else
        update tactics set tactic_title = p_tactic_title, action_plan_description = p_action_plan_description
        where tactic_id = p_tactic_id returning tactic_id into v_id;
    end if;
    return v_id;
end;
$$;

create or replace function delete_tactic(p_session_token uuid, p_tactic_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select g.user_id into v_owner from tactics t join goals g on g.goal_id = t.goal_id where t.tactic_id = p_tactic_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;
    update tactics set is_active = false where tactic_id = p_tactic_id;
    return true;
end;
$$;

-- 7.4 ถือเป้าร่วมกับลูกน้อง (Joint Goal Holding) — ไม่คัดลอกข้อมูล อ้างอิงถึง
--     goal_id เดิมของลูกน้องโดยตรง ทีเด็ด/ผลบันทึก Scoreboard จึงมาจากแถวเดียวกัน
--     กับที่ลูกน้องกรอกเสมอ (Single Source of Truth)
create or replace function hold_shared_goal(p_session_token uuid, p_goal_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if v_role = 'STAFF' then raise exception 'FORBIDDEN'; end if;

    select user_id into v_owner from goals where goal_id = p_goal_id;
    if v_owner is null then raise exception 'GOAL_NOT_FOUND'; end if;
    if v_owner = v_uid then raise exception 'CANNOT_HOLD_OWN_GOAL'; end if;
    if not _is_supervisor_of(v_uid, v_owner) and v_role <> 'ADMIN' then
        raise exception 'FORBIDDEN';
    end if;

    insert into goal_co_owners (goal_id, holder_user_id) values (p_goal_id, v_uid)
        on conflict (goal_id, holder_user_id) do nothing;
    return true;
end;
$$;

-- 7.5 เลิกถือเป้าร่วม
create or replace function release_shared_goal(p_session_token uuid, p_goal_id int)
returns boolean
language plpgsql
security definer
as $$
declare v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    delete from goal_co_owners where goal_id = p_goal_id and holder_user_id = v_uid;
    return true;
end;
$$;

-- ============================================================================
-- 8. SCOREBOARD & APPROVAL RPCs
-- ============================================================================

-- 8.1 บันทึกผลงานจริงรายวัน (upsert) — เป้าหมายอ่านจาก goals.target_value เสมอ
create or replace function upsert_scoreboard_daily(
    p_session_token uuid, p_goal_id int, p_entry_date date, p_actual_val decimal
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select user_id into v_owner from goals where goal_id = p_goal_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    insert into scoreboard_daily (goal_id, entry_date, actual_val)
    values (p_goal_id, p_entry_date, p_actual_val)
    on conflict (goal_id, entry_date) do update set
        actual_val = excluded.actual_val, updated_at = now()
    returning daily_id into v_id;

    -- ถ้าเดือนนี้เคยถูกตีกลับ (REJECTED) การแก้ไขรายวันใหม่จะดึงกลับมาเป็น DRAFT
    update scoreboard_monthly
        set approval_status = 'DRAFT', reviewer_comments = null
        where goal_id = p_goal_id
          and month_num = extract(month from p_entry_date)::int
          and approval_status = 'REJECTED';

    return v_id;
end;
$$;

-- 8.1b ดึงผลงานรายวันของเดือนที่เลือก (สำหรับมุมมอง "รายวัน")
create or replace function get_scoreboard_daily(
    p_session_token uuid, p_target_user_id int, p_year int, p_month_num int
)
returns table (
    goal_id int, goal_title text, entry_date date, actual_val decimal
)
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then raise exception 'FORBIDDEN'; end if;

    return query
    select g.goal_id, g.goal_title, d.entry_date::date, s.actual_val
    from goals g
    cross join lateral generate_series(
        make_date(p_year, p_month_num, 1),
        (make_date(p_year, p_month_num, 1) + interval '1 month' - interval '1 day')::date,
        interval '1 day'
    ) as d(entry_date)
    left join scoreboard_daily s on s.goal_id = g.goal_id and s.entry_date = d.entry_date::date
    where g.year = p_year and g.is_active = true
      and (g.user_id = p_target_user_id
           or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
    order by g.goal_id, d.entry_date;
end;
$$;

-- 8.2 ดึง Scoreboard ทั้งปีของคนใดคนหนึ่ง (มุมมอง "เฉลี่ยรายเดือน" — ผลจริง
--     คือค่าเฉลี่ยของรายวันในเดือนนั้น คำนวณสดเสมอ)
create or replace function get_scoreboard(p_session_token uuid, p_target_user_id int, p_year int)
returns table (
    goal_id int, goal_title text, weight_percentage decimal,
    month_num int, target_val decimal, actual_val decimal,
    variance_val decimal, achievement_percentage decimal,
    status_color status_color, approval_status approval_status, reviewer_comments text
)
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then raise exception 'FORBIDDEN'; end if;

    return query
    select g.goal_id, g.goal_title, g.weight_percentage, mn.month_num,
           g.target_value as target_val,
           avgd.avg_val as actual_val,
           case when avgd.avg_val is null then null else avgd.avg_val - g.target_value end as variance_val,
           _calc_achievement_pct(g.target_value, avgd.avg_val, g.evaluation_operator) as achievement_percentage,
           _calc_status_color(g.target_value, avgd.avg_val, g.evaluation_operator) as status_color,
           coalesce(s.approval_status, 'DRAFT') as approval_status,
           s.reviewer_comments
    from goals g
    cross join generate_series(1,12) as mn(month_num)
    left join scoreboard_monthly s on s.goal_id = g.goal_id and s.month_num = mn.month_num
    left join lateral (
        select round(avg(d.actual_val), 2) as avg_val
        from scoreboard_daily d
        where d.goal_id = g.goal_id
          and extract(year from d.entry_date)::int = p_year
          and extract(month from d.entry_date)::int = mn.month_num
          and d.actual_val is not null
    ) avgd on true
    where g.year = p_year and g.is_active = true
      and (g.user_id = p_target_user_id
           or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
    order by g.goal_id, mn.month_num;
end;
$$;

-- 8.3 ส่งรายงานประจำเดือน (DRAFT/REJECTED -> SUBMITTED) ให้หัวหน้าตรวจ
--     (upsert เพราะ scoreboard_monthly ไม่ถูกสร้างอัตโนมัติตอนกรอกรายวันแล้ว)
create or replace function submit_monthly_report(p_session_token uuid, p_year int, p_month_num int)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_count int;
begin
    v_uid := _current_user_id(p_session_token);

    insert into scoreboard_monthly (goal_id, month_num, approval_status)
    select g.goal_id, p_month_num, 'SUBMITTED'
    from goals g
    where g.user_id = v_uid and g.year = p_year and g.is_active = true
    on conflict (goal_id, month_num) do update set
        approval_status = 'SUBMITTED', reviewer_comments = null, updated_at = now()
        where scoreboard_monthly.approval_status in ('DRAFT', 'REJECTED');

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

-- 8.4 รายการรออนุมัติของหัวหน้า
create or replace function get_pending_approvals(p_session_token uuid)
returns table (
    target_user_id int, employee_name text, month_num int, year int, submitted_goals int
)
language plpgsql
security definer
as $$
declare
    v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    return query
    select g.user_id, (u.first_name || ' ' || u.last_name), s.month_num, g.year, count(*)::int
    from scoreboard_monthly s
    join goals g on g.goal_id = s.goal_id
    join users u on u.user_id = g.user_id
    where s.approval_status = 'SUBMITTED'
      and _get_approver(g.user_id) = v_uid
    group by g.user_id, u.first_name, u.last_name, s.month_num, g.year;
end;
$$;

-- 8.5 อนุมัติ / ตีกลับ รายงานของลูกน้อง (ทั้งเดือน ทุกเป้าหมาย)
create or replace function review_monthly_report(
    p_session_token uuid, p_target_user_id int, p_year int, p_month_num int,
    p_decision approval_status, p_comments text
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_count int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;

    if v_role <> 'ADMIN' and _get_approver(p_target_user_id) <> v_uid then
        raise exception 'FORBIDDEN';
    end if;
    if p_decision not in ('APPROVED','REJECTED') then
        raise exception 'INVALID_DECISION';
    end if;

    update scoreboard_monthly s set
        approval_status = p_decision, reviewer_comments = p_comments,
        reviewed_by = v_uid, updated_at = now()
    from goals g
    where g.goal_id = s.goal_id and g.user_id = p_target_user_id and g.year = p_year
      and s.month_num = p_month_num and s.approval_status = 'SUBMITTED';
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

-- ============================================================================
-- 9. ANALYTICS RPC (สรุปสำหรับ Gauge / Bar / Trend / Progress)
-- ============================================================================
create or replace function get_individual_analytics(p_session_token uuid, p_target_user_id int, p_year int)
returns json
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_result json;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then raise exception 'FORBIDDEN'; end if;

    select json_build_object(
        'monthly', (
            select coalesce(json_agg(x order by x.month_num), '[]'::json) from (
                select mn.month_num,
                       round(sum(g.target_value * g.weight_percentage/100),2) as weighted_target,
                       round(sum(coalesce(avgd.avg_val,0) * g.weight_percentage/100),2) as weighted_actual
                from goals g
                cross join generate_series(1,12) as mn(month_num)
                left join lateral (
                    select avg(d.actual_val) as avg_val from scoreboard_daily d
                    where d.goal_id = g.goal_id
                      and extract(year from d.entry_date)::int = p_year
                      and extract(month from d.entry_date)::int = mn.month_num
                      and d.actual_val is not null
                ) avgd on true
                where g.year = p_year and g.is_active = true
                  and (g.user_id = p_target_user_id
                       or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
                group by mn.month_num
            ) x
        ),
        'overall_achievement', (
            select round(avg(_calc_achievement_pct(g.target_value, avgd.avg_val, g.evaluation_operator)),2)
            from goals g
            cross join generate_series(1,12) as mn(month_num)
            left join lateral (
                select avg(d.actual_val) as avg_val from scoreboard_daily d
                where d.goal_id = g.goal_id
                  and extract(year from d.entry_date)::int = p_year
                  and extract(month from d.entry_date)::int = mn.month_num
                  and d.actual_val is not null
            ) avgd on true
            where g.year = p_year and g.is_active = true and avgd.avg_val is not null
              and (g.user_id = p_target_user_id
                   or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
        ),
        'tactics_progress', (
            select coalesce(json_agg(json_build_object(
                'tactic_title', t.tactic_title, 'goal_title', g.goal_title,
                'goal_achievement', (
                    select round(avg(_calc_achievement_pct(g.target_value, m.avg_val, g.evaluation_operator)),2)
                    from (
                        select mn.month_num,
                               (select avg(d.actual_val) from scoreboard_daily d
                                where d.goal_id = g.goal_id
                                  and extract(year from d.entry_date)::int = p_year
                                  and extract(month from d.entry_date)::int = mn.month_num
                                  and d.actual_val is not null) as avg_val
                        from generate_series(1,12) as mn(month_num)
                    ) m where m.avg_val is not null
                )
            )), '[]'::json)
            from tactics t join goals g on g.goal_id = t.goal_id
            where g.year = p_year and t.is_active = true
              and (g.user_id = p_target_user_id
                   or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
        )
    ) into v_result;

    return v_result;
end;
$$;

-- ============================================================================
-- 10. SEED DATA (ตัวอย่าง — ลบ/แก้ไขได้ตามข้อมูลจริง)
-- ============================================================================
insert into departments (dept_key, label, sort_order) values
    ('DEPT_A', 'ฝ่าย A (ตัวอย่าง — แก้ไข/เพิ่มแผนกจริงได้ที่หน้าจัดการพนักงาน)', 1),
    ('DEPT_B', 'ฝ่าย B (ตัวอย่าง)', 2);

insert into position_titles (org_level, track, title) values
    (80, 'MANAGEMENT', 'ผู้จัดการทั่วไป'),
    (75, 'MANAGEMENT', 'ผู้จัดการฝ่าย'),  (75, 'SPECIALIST', 'ผู้เชี่ยวชาญพิเศษ'),
    (65, 'MANAGEMENT', 'ผู้จัดการส่วน'),  (65, 'SPECIALIST', 'ผู้เชี่ยวชาญ'),
    (55, 'MANAGEMENT', 'ผู้จัดการแผนก'),  (55, 'SPECIALIST', 'ผู้ชำนาญการพิเศษ'),
    (40, 'MANAGEMENT', 'วิศวกร/เจ้าหน้าที่'), (40, 'SPECIALIST', 'ผู้ชำนาญการ');

-- หมายเหตุ: password ของทุกคน = emp_code ของตนเอง ตามสเปก (บังคับเปลี่ยนตอน login ครั้งแรก)
-- ตำแหน่งคำนวณอัตโนมัติจาก org_level+track ผ่าน _compute_position_title() ด้านบน
insert into users (emp_code, password_hash, first_name, last_name, nickname, position_title, department, org_level, track, is_acting, supervisor_id, role) values
('900001', crypt('900001', gen_salt('bf')), 'สมชาย', 'ผู้บริหาร', 'พี่ชาย', _compute_position_title(80,'MANAGEMENT',false), null, 80, 'MANAGEMENT', false, null, 'ADMIN'),
('900002', crypt('900002', gen_salt('bf')), 'สมหญิง', 'ฝ่ายผลิต', 'พี่หญิง', _compute_position_title(75,'MANAGEMENT',false), 'DEPT_A', 75, 'MANAGEMENT', false, 1, 'SUPERVISOR'),
('900003', crypt('900003', gen_salt('bf')), 'วิชัย', 'ส่วนผลิต', 'พี่ชัย', _compute_position_title(65,'MANAGEMENT',false), 'DEPT_A', 65, 'MANAGEMENT', false, 2, 'SUPERVISOR'),
('443757', crypt('443757', gen_salt('bf')), 'มานะ', 'แผนกซ่อมบำรุง', 'มานะ', _compute_position_title(55,'MANAGEMENT',false), 'DEPT_A', 55, 'MANAGEMENT', false, 3, 'SUPERVISOR'),
('591144', crypt('591144', gen_salt('bf')), 'สายใจ', 'เจ้าหน้าที่', 'ใจ', _compute_position_title(40,'MANAGEMENT',false), 'DEPT_A', 40, 'MANAGEMENT', false, 4, 'STAFF'),
('123456', crypt('123456', gen_salt('bf')), 'ทดสอบ', 'ระบบ', 'เทส', _compute_position_title(40,'SPECIALIST',false), 'DEPT_B', 40, 'SPECIALIST', false, 4, 'STAFF');

-- Grant execute บน RPC ทั้งหมดให้ anon + authenticated (ตัวฟังก์ชันเองตรวจสิทธิ์ภายในอยู่แล้ว)
grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
