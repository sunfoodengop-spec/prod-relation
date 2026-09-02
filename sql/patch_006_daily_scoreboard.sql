-- ============================================================================
-- Patch 006: กรอกผลงานจริงเป็นรายวัน — มุมมองแสดงผลเลือกได้ รายวัน / เฉลี่ยรายเดือน
-- ============================================================================
-- แนวคิด: ค่า "ผลจริง" ของเป้าหมายตอนนี้กรอกทีละวัน (ตาราง scoreboard_daily)
-- ส่วน "ผลรายเดือน" ที่หน้า Scoreboard/Org/Export/Analytics เห็น คือค่าเฉลี่ย
-- ของรายวันในเดือนนั้นๆ คำนวณสดทุกครั้งที่อ่าน (ไม่ได้เก็บซ้ำ) — ตาราง
-- scoreboard_monthly เดิมเปลี่ยนบทบาทเหลือแค่ "ติดตามสถานะการอนุมัติ" รายเดือน
-- (DRAFT/SUBMITTED/APPROVED/REJECTED) เท่านั้น ไม่เก็บตัวเลขผลงานอีกต่อไป
-- ============================================================================

-- 1) ตารางผลงานจริงรายวัน --------------------------------------------------
create table if not exists scoreboard_daily (
    daily_id     serial primary key,
    goal_id      int not null references goals(goal_id) on delete cascade,
    entry_date   date not null,
    actual_val   decimal(10,2),
    updated_at   timestamptz not null default now(),
    unique (goal_id, entry_date)
);
alter table scoreboard_daily enable row level security;
create index if not exists idx_scoreboard_daily_goal_date on scoreboard_daily(goal_id, entry_date);

-- 2) scoreboard_monthly เหลือแค่สถานะอนุมัติ (เอา actual_val ออก) -----------
alter table scoreboard_monthly drop column if exists actual_val;

-- ============================================================================
-- 3) เอา upsert_scoreboard (กรอกรายเดือน) เดิมออก แทนที่ด้วยกรอกรายวัน
-- ============================================================================
drop function if exists upsert_scoreboard(uuid, int, int, decimal);

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
    -- ให้หัวหน้าเห็นว่ามีการแก้ไขแล้ว รอส่งใหม่
    update scoreboard_monthly
        set approval_status = 'DRAFT', reviewer_comments = null
        where goal_id = p_goal_id
          and month_num = extract(month from p_entry_date)::int
          and approval_status = 'REJECTED';

    return v_id;
end;
$$;

-- 4) ดึงผลงานรายวันของเดือนที่เลือก (สำหรับมุมมอง "รายวัน") -----------------
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

-- ============================================================================
-- 5) get_scoreboard (มุมมอง "เฉลี่ยรายเดือน"): ผลจริง = ค่าเฉลี่ยรายวันในเดือนนั้น
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

-- ============================================================================
-- 6) get_individual_analytics: weighted_actual รายเดือน ใช้ค่าเฉลี่ยรายวันด้วย
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
-- 7) submit_monthly_report: เขียนใหม่เป็น upsert เพราะ scoreboard_monthly
--    ไม่ถูกสร้างอัตโนมัติตอนกรอกรายวันอีกต่อไป (ต้องสร้างแถวตอนส่งอนุมัติแทน)
-- ============================================================================
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

grant execute on all functions in schema public to anon, authenticated;
