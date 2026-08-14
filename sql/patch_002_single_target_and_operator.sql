-- ============================================================================
-- Patch 002: เป้าหมายเป็นค่าเดียวรายปี (Single Source of Truth) + เงื่อนไขประเมินผล
-- ============================================================================
-- การเปลี่ยนแปลง:
--   1. เพิ่ม evaluation_operator ให้ goals: GT(>) / GTE(≥) / LT(<) / LTE(≤) / EQ(=)
--      ใช้ตัดสินว่า "บรรลุเป้า" (GREEN) หรือไม่ — สำคัญกับเป้าที่ยิ่งน้อยยิ่งดี
--      (เช่น ลดของเสีย, ลดเวลาเครื่องเสีย) ซึ่งเดิมคำนวณ % สำเร็จผิดทิศทาง
--   2. เอาคอลัมน์ target_val/variance_val/achievement_percentage/status_color
--      ออกจาก scoreboard_monthly — ค่าเป้าหมายอ่านจาก goals.target_value เพียง
--      จุดเดียวเสมอ (Admin หรือเจ้าของแก้ที่ไหนก็แก้ "แถวเดียวกัน") ส่วนค่าเหล่านี้
--      คำนวณสดทุกครั้งที่อ่านข้อมูล ไม่ถูกเก็บซ้ำ
--   3. หน้า Scoreboard รายเดือนจะกรอกได้แค่ "ผลจริง" เท่านั้น
-- รันใน Supabase SQL Editor ได้ทันที (ปลอดภัย รันซ้ำได้ยกเว้นขั้นตอน ALTER/DROP
-- COLUMN ซึ่งจะข้ามอัตโนมัติถ้าคอลัมน์ถูกลบไปแล้ว)
-- ============================================================================

-- 1) ชนิดข้อมูลเงื่อนไขประเมินผล
do $$ begin
    create type eval_operator as enum ('GT', 'GTE', 'LT', 'LTE', 'EQ');
exception when duplicate_object then null;
end $$;

-- 2) เพิ่มคอลัมน์ evaluation_operator ให้ goals (ค่าเริ่มต้น GTE = มากกว่าหรือเท่ากับ)
alter table goals add column if not exists evaluation_operator eval_operator not null default 'GTE';

-- 3) ปรับ scoreboard_monthly ให้เก็บแค่ผลจริงรายเดือน (เอาเป้าหมาย/ผลคำนวณที่ซ้ำซ้อนออก)
alter table scoreboard_monthly drop column if exists target_val;
alter table scoreboard_monthly drop column if exists variance_val;
alter table scoreboard_monthly drop column if exists achievement_percentage;
alter table scoreboard_monthly drop column if exists status_color;

-- ============================================================================
-- 4) ฟังก์ชันคำนวณผล (ใช้ร่วมกันทุกจุดที่ต้องอ่านค่า achievement)
-- ============================================================================
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

-- แทนที่ _calc_status_color เดิม (รับ 1 argument) ด้วยเวอร์ชันใหม่ที่รู้ทิศทางเงื่อนไข
drop function if exists _calc_status_color(decimal);

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
-- 5) อัปเดต upsert_goal ให้รับ evaluation_operator
--    (DROP ก่อน เพราะจำนวน input parameter เปลี่ยน — ถ้าไม่ DROP จะได้ฟังก์ชัน
--    ซ้อนกัน 2 overload ซึ่งทำให้เรียกแบบ named parameters แล้ว "not unique" ได้)
-- ============================================================================
drop function if exists upsert_goal(uuid, int, int, text, varchar, decimal, decimal, int, int);

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

-- ============================================================================
-- 6) อัปเดต list_goals ให้คืน evaluation_operator ด้วย
--    (ต้อง DROP ก่อน เพราะ Postgres ไม่ยอมให้ CREATE OR REPLACE เปลี่ยนจำนวน/
--    ชนิดคอลัมน์ที่ RETURNS TABLE คืนค่า)
-- ============================================================================
drop function if exists list_goals(uuid, int, int);

create or replace function list_goals(p_session_token uuid, p_target_user_id int, p_year int)
returns table (
    goal_id int, goal_title text, metric_unit varchar, target_value decimal,
    weight_percentage decimal, parent_goal_id int, evaluation_operator eval_operator, tactics json
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
           coalesce((select json_agg(json_build_object(
                'tactic_id', t.tactic_id, 'tactic_title', t.tactic_title,
                'action_plan_description', t.action_plan_description,
                'adopted_from_tactic_id', t.adopted_from_tactic_id))
             from tactics t where t.goal_id = g.goal_id and t.is_active = true), '[]'::json)
    from goals g
    where g.user_id = p_target_user_id and g.year = p_year and g.is_active = true
    order by g.goal_id;
end;
$$;

-- ============================================================================
-- 7) upsert_scoreboard: กรอกได้แค่ "ผลจริง" เท่านั้น (เป้าหมายอ่านจาก goals เสมอ)
--    (DROP ก่อน เพราะเอา p_target_val ออก จำนวน parameter เปลี่ยนจาก 5 เป็น 4)
-- ============================================================================
drop function if exists upsert_scoreboard(uuid, int, int, decimal, decimal);

create or replace function upsert_scoreboard(
    p_session_token uuid, p_goal_id int, p_month_num int, p_actual_val decimal
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

    insert into scoreboard_monthly (goal_id, month_num, actual_val)
    values (p_goal_id, p_month_num, p_actual_val)
    on conflict (goal_id, month_num) do update set
        actual_val = excluded.actual_val,
        approval_status = case when scoreboard_monthly.approval_status = 'REJECTED' then 'DRAFT' else scoreboard_monthly.approval_status end,
        updated_at = now()
    returning scoreboard_id into v_id;

    return v_id;
end;
$$;

-- ============================================================================
-- 8) get_scoreboard: คำนวณ target/variance/achievement/status สดจาก goals เสมอ
--    และแสดงครบ 12 เดือนแม้ยังไม่มีการกรอกผลจริง (generate_series)
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
    where g.user_id = p_target_user_id and g.year = p_year and g.is_active = true
    order by g.goal_id, mn.month_num;
end;
$$;

-- ============================================================================
-- 9) get_individual_analytics: คำนวณจาก goals.target_value เสมอ (เส้น Target คงที่ตลอดปี)
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
                where g.user_id = p_target_user_id and g.year = p_year and g.is_active = true
                group by mn.month_num
            ) x
        ),
        'overall_achievement', (
            select round(avg(_calc_achievement_pct(g.target_value, s.actual_val, g.evaluation_operator)),2)
            from goals g join scoreboard_monthly s on s.goal_id = g.goal_id
            where g.user_id = p_target_user_id and g.year = p_year and g.is_active = true and s.actual_val is not null
        ),
        'tactics_progress', (
            select coalesce(json_agg(json_build_object(
                'tactic_title', t.tactic_title, 'goal_title', g.goal_title,
                'goal_achievement', (select round(avg(_calc_achievement_pct(g.target_value, s2.actual_val, g.evaluation_operator)),2)
                    from scoreboard_monthly s2 where s2.goal_id = g.goal_id and s2.actual_val is not null))), '[]'::json)
            from tactics t join goals g on g.goal_id = t.goal_id
            where g.user_id = p_target_user_id and g.year = p_year and t.is_active = true
        )
    ) into v_result;

    return v_result;
end;
$$;

-- ============================================================================
-- 10) adopt_item: คัดลอก evaluation_operator ไปด้วยตอนพลิกเป้าหมายขึ้นมา
-- ============================================================================
create or replace function adopt_item(
    p_session_token uuid,
    p_source_type adopt_target,
    p_source_id int,
    p_as_type adopt_target,
    p_year int,
    p_target_parent_goal_id int
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role;
    v_src_goal goals%rowtype;
    v_src_tactic tactics%rowtype;
    v_owner int;
    v_new_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if v_role = 'STAFF' then raise exception 'FORBIDDEN'; end if;

    if p_source_type = 'GOAL' then
        select * into v_src_goal from goals where goal_id = p_source_id;
        v_owner := v_src_goal.user_id;
    else
        select * into v_src_tactic from tactics where tactic_id = p_source_id;
        select user_id into v_owner from goals where goal_id = v_src_tactic.goal_id;
    end if;

    if not _is_supervisor_of(v_uid, v_owner) and v_role <> 'ADMIN' then
        raise exception 'FORBIDDEN';
    end if;

    if p_as_type = 'GOAL' then
        if p_source_type = 'TACTIC' then
            raise exception 'CANNOT_ADOPT_TACTIC_AS_GOAL';
        end if;
        insert into goals (user_id, goal_title, metric_unit, target_value, weight_percentage, year, parent_goal_id, evaluation_operator)
        values (v_uid, v_src_goal.goal_title, v_src_goal.metric_unit, v_src_goal.target_value,
                v_src_goal.weight_percentage, p_year, v_src_goal.goal_id, v_src_goal.evaluation_operator)
        returning goal_id into v_new_id;
    else
        if p_target_parent_goal_id is null then
            raise exception 'MUST_SPECIFY_PARENT_GOAL';
        end if;
        if p_source_type = 'GOAL' then
            insert into tactics (goal_id, tactic_title, action_plan_description)
            values (p_target_parent_goal_id, v_src_goal.goal_title, 'พลิกจากเป้าหมายของลูกน้อง')
            returning tactic_id into v_new_id;
        else
            insert into tactics (goal_id, tactic_title, action_plan_description, adopted_from_tactic_id)
            values (p_target_parent_goal_id, v_src_tactic.tactic_title, v_src_tactic.action_plan_description, v_src_tactic.tactic_id)
            returning tactic_id into v_new_id;
        end if;
    end if;

    return v_new_id;
end;
$$;

grant execute on all functions in schema public to anon, authenticated;
