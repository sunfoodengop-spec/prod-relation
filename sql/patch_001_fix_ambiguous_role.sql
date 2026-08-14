-- ============================================================================
-- Patch: แก้บั๊ก "column reference role is ambiguous" ใน get_subordinates และ
-- get_org_chart — รันสคริปต์นี้แทนการรัน schema.sql ใหม่ทั้งไฟล์ (จะได้ไม่ error
-- เรื่องตาราง/type ซ้ำ) ปลอดภัย รันซ้ำได้ ไม่กระทบข้อมูลที่มีอยู่
-- ============================================================================

create or replace function get_subordinates(p_session_token uuid)
returns table (
    user_id int, emp_code varchar, first_name varchar, last_name varchar,
    nickname varchar, position_title varchar, department varchar,
    role user_role, org_level smallint, supervisor_id int
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
            u.position_title, u.department, u.role, u.org_level, u.supervisor_id
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
           u.position_title, u.department, u.role, u.org_level, u.supervisor_id
    from users u join sub on u.user_id = sub.user_id
    where u.is_active = true
    order by u.org_level, u.first_name;
end;
$$;

create or replace function get_org_chart(p_session_token uuid)
returns table (
    user_id int, emp_code varchar, first_name varchar, last_name varchar, nickname varchar,
    position_title varchar, department varchar, org_level smallint,
    supervisor_id int, avatar_url text, role user_role
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
        return query select u.user_id, u.emp_code, u.first_name, u.last_name, u.nickname, u.position_title,
            u.department, u.org_level, u.supervisor_id, u.avatar_url, u.role
            from users u where u.is_active = true;
        return;
    end if;

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
    )
    select x.user_id, x.emp_code, x.first_name, x.last_name, x.nickname, x.position_title,
           x.department, x.org_level, x.supervisor_id, x.avatar_url, x.role
    from (select * from up union select * from down) x
    where x.is_active = true;
end;
$$;
