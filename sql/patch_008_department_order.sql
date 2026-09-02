-- ============================================================================
-- Patch 008: กำหนดลำดับการแสดงผลแผนก (sort_order) ตามที่ระบุ
-- ============================================================================
-- รันใน Supabase SQL Editor ได้ทันที ปลอดภัย รันซ้ำได้
-- ถ้า dept_key ไหนยังไม่มีในตาราง departments จะถูกสร้างขึ้นใหม่ให้อัตโนมัติ
-- (label เริ่มต้น = ชื่อเดียวกับ dept_key ไปก่อน แก้ทีหลังได้ที่หน้า
-- "จัดการพนักงาน" > "จัดการแผนก")
-- ============================================================================

insert into departments (dept_key, label, sort_order) values
    ('LB', 'LB', 1),
    ('EVI', 'EVI', 2),
    ('CHI', 'CHI', 3),
    ('OH', 'OH', 4),
    ('CUT-UP', 'CUT-UP', 5),
    ('SC', 'SC', 6),
    ('SMP-IVQF', 'SMP-IVQF', 7),
    ('PACK', 'PACK', 8),
    ('FREEZE', 'FREEZE', 9),
    ('CS', 'CS', 10),
    ('LOAD', 'LOAD', 11)
on conflict (dept_key) do update set sort_order = excluded.sort_order;

-- ตรวจสอบผลลัพธ์
select dept_key, label, sort_order from departments order by sort_order, label;
