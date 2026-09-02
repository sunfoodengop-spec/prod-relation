-- ============================================================================
-- Patch 007: เติมตาราง departments จากชื่อแผนกที่มีอยู่แล้วในข้อมูลพนักงานจริง
-- ============================================================================
-- แก้ปัญหา: หลังรัน patch 005 ผังองค์กรหายไปเหลือแค่คนที่ไม่มีแผนก (เช่น GM)
-- เพราะตาราง departments ใหม่ถูก seed แค่ตัวอย่าง DEPT_A/DEPT_B แต่พนักงาน
-- จริงยังอ้างอิงชื่อแผนกเดิม (เช่น 'วัตถุดิบ', 'OH', 'CUT-UP') ซึ่งไม่มีอยู่ใน
-- ตาราง departments เลย ทำให้ org chart หาคอลัมน์ให้วางไม่เจอ
--
-- สคริปต์นี้จะดึงชื่อแผนกทุกค่าที่ปรากฏจริงในคอลัมน์ users.department (แยกด้วย
-- comma) มาลงทะเบียนเป็นแถวใน departments ให้อัตโนมัติ โดยใช้ชื่อเดิมเป็นทั้ง
-- dept_key และ label ชั่วคราว — หลังรันแล้วไปแก้ label ให้อ่านง่ายขึ้น หรือรวม
-- แผนกย่อยเข้าด้วยกันได้ที่หน้า "จัดการพนักงาน" > "จัดการแผนก" ตามสบาย
-- ============================================================================

insert into departments (dept_key, label, sort_order)
select distinct
    trim(dept) as dept_key,
    trim(dept) as label,
    0 as sort_order
from users, unnest(string_to_array(department, ',')) as dept
where department is not null and trim(department) <> '' and trim(dept) <> ''
on conflict (dept_key) do nothing;

-- ตรวจสอบผลลัพธ์
select * from departments order by sort_order, label;
