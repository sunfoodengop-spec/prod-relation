-- ============================================================================
-- Patch 003: "ถือเป้าร่วม" (Joint Goal Holding) แทนที่ "พลิกขึ้นมา" (Adopt/Copy)
-- ============================================================================
-- แนวคิดใหม่: หัวหน้าไม่ได้สร้างเป้าหมายใหม่แยกต่างหากอีกต่อไป (ของเดิมคือ Copy
-- ค่าจาก goal ของลูกน้องมาเป็น goal ใหม่ของหัวหน้า ซึ่งเสี่ยงข้อมูลไม่ตรงกัน)
-- แต่จะ "อ้างอิง" ไปยัง goal_id เดิมของลูกน้องโดยตรงผ่านตาราง goal_co_owners
-- ผลคือ: เป้าหมาย, ทีเด็ดใต้เป้าหมายนั้น, และผลบันทึก Scoreboard รายเดือน
-- ทั้งหมด เป็น "แถวเดียวกัน" กับที่ลูกน้องกรอกเป๊ะๆ ไม่มีการคัดลอกข้อมูลเลย
-- จึงรับประกันว่าข้อมูลที่หัวหน้าเห็นมาจากลูกน้องกรอกเท่านั้น และเห็นผลบันทึก
-- (actual/achievement/status) ที่อัปเดตล่าสุดเสมอ
-- ============================================================================

-- 1) ตารางเชื่อมโยง "ผู้ถือร่วม" กับเป้าหมาย
create table if not exists goal_co_owners (
    goal_id         int not null references goals(goal_id) on delete cascade,
    holder_user_id  int not null references users(user_id) on delete cascade,
    created_at      timestamptz not null default now(),
    primary key (goal_id, holder_user_id)
);
alter table goal_co_owners enable row level security;
-- ไม่สร้าง policy ให้ anon/authenticated (เข้าถึงผ่าน RPC เท่านั้น เหมือนตารางอื่น)

-- 2) ยกเลิกฟังก์ชัน adopt_item เดิม (ใช้ระบบใหม่แทน)
drop function if exists adopt_item(uuid, adopt_target, int, adopt_target, int, int);

-- 3) ถือเป้าร่วม: หัวหน้าเลือกถือเป้าหมายของลูกน้องร่วม (ไม่คัดลอกข้อมูลใดๆ)
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

-- 4) เลิกถือเป้าร่วม
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
-- 5) list_goals: รวมเป้าหมายของตัวเอง + เป้าหมายที่ถือร่วม (พร้อม flag is_shared
--    และชื่อเจ้าของตัวจริง) — ทีเด็ดใต้เป้าหมายที่ถือร่วมจะติดมาอัตโนมัติ เพราะ
--    เป็น goal_id เดียวกันกับต้นฉบับ ไม่ต้องจัดการแยก
-- ============================================================================
drop function if exists list_goals(uuid, int, int);

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

-- ============================================================================
-- 6) get_scoreboard: รวมผลบันทึกของเป้าหมายที่ถือร่วมด้วย (อ่านจากแถวเดียวกัน
--    กับที่ลูกน้องกรอก ไม่มีการคัดลอก)
-- ============================================================================
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
           s.actual_val,
           case when s.actual_val is null then null else s.actual_val - g.target_value end as variance_val,
           _calc_achievement_pct(g.target_value, s.actual_val, g.evaluation_operator) as achievement_percentage,
           _calc_status_color(g.target_value, s.actual_val, g.evaluation_operator) as status_color,
           coalesce(s.approval_status, 'DRAFT') as approval_status,
           s.reviewer_comments
    from goals g
    cross join generate_series(1,12) as mn(month_num)
    left join scoreboard_monthly s on s.goal_id = g.goal_id and s.month_num = mn.month_num
    where g.year = p_year and g.is_active = true
      and (g.user_id = p_target_user_id
           or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
    order by g.goal_id, mn.month_num;
end;
$$;

-- ============================================================================
-- 7) get_individual_analytics: รวมเป้าหมายที่ถือร่วมเข้าไปในตัวเลขภาพรวมด้วย
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
                       round(sum(coalesce(s.actual_val,0) * g.weight_percentage/100),2) as weighted_actual
                from goals g
                cross join generate_series(1,12) as mn(month_num)
                left join scoreboard_monthly s on s.goal_id = g.goal_id and s.month_num = mn.month_num
                where g.year = p_year and g.is_active = true
                  and (g.user_id = p_target_user_id
                       or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
                group by mn.month_num
            ) x
        ),
        'overall_achievement', (
            select round(avg(_calc_achievement_pct(g.target_value, s.actual_val, g.evaluation_operator)),2)
            from goals g join scoreboard_monthly s on s.goal_id = g.goal_id
            where g.year = p_year and g.is_active = true and s.actual_val is not null
              and (g.user_id = p_target_user_id
                   or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
        ),
        'tactics_progress', (
            select coalesce(json_agg(json_build_object(
                'tactic_title', t.tactic_title, 'goal_title', g.goal_title,
                'goal_achievement', (select round(avg(_calc_achievement_pct(g.target_value, s2.actual_val, g.evaluation_operator)),2)
                    from scoreboard_monthly s2 where s2.goal_id = g.goal_id and s2.actual_val is not null))), '[]'::json)
            from tactics t join goals g on g.goal_id = t.goal_id
            where g.year = p_year and t.is_active = true
              and (g.user_id = p_target_user_id
                   or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
        )
    ) into v_result;

    return v_result;
end;
$$;

grant execute on all functions in schema public to anon, authenticated;
