# ระบบบริหารเป้าหมาย ทีเด็ด และ Scoreboard

Static Web App (HTML/CSS/JS ล้วน ไม่มี build step) + Supabase (Postgres) เป็น Backend/Database
Deploy ผ่าน GitHub Pages ได้ฟรี

---

## 1. โครงสร้างไฟล์

```
├── index.html              # redirect เข้า login/app ตามสถานะ session
├── login.html               # หน้าล็อกอิน + บังคับเปลี่ยนรหัสผ่านครั้งแรก
├── app.html                  # SPA shell (sidebar + router)
├── css/style.css             # ธีมทั้งหมด
├── js/
│   ├── config.js             # ⚠️ ต้องแก้ URL/anon key ของ Supabase ที่นี่
│   ├── supabaseClient.js
│   ├── session.js            # จัดการ session token ใน localStorage
│   ├── api.js                # เรียก Supabase RPC ทั้งหมด
│   ├── ui.js                 # helper: toast, modal, pill
│   ├── app.js                # router หลัก
│   └── pages/                # แต่ละหน้า: dashboard, goals, scoreboard, approvals,
│                              # analytics, org, adminUsers, profile, exportPage
└── sql/schema.sql            # รันใน Supabase SQL Editor ครั้งเดียวตอน setup
```

## 2. ตั้งค่า Supabase (ทำครั้งเดียว)

1. สร้างบัญชี/โปรเจกต์ใหม่ที่ https://supabase.com (แผน Free เพียงพอสำหรับเริ่มต้น)
2. เปิด **SQL Editor** → วางเนื้อหาทั้งหมดจาก `sql/schema.sql` → กด **Run**
   - สคริปต์นี้จะ: สร้างตาราง, ปิด RLS แบบ deny-all บนทุกตาราง, สร้าง RPC Function
     ทั้งหมดสำหรับ Auth/Org/Goal/Tactic/Scoreboard/Analytics, และใส่ข้อมูลตัวอย่าง
     6 คน (ลบ/แก้ไขได้ทีหลังผ่านหน้า "จัดการพนักงาน")
3. ไปที่ **Project Settings → API** คัดลอกค่า:
   - `Project URL`
   - `anon public` key
4. เปิดไฟล์ `js/config.js` แล้ววางค่าแทน `SUPABASE_URL` และ `SUPABASE_ANON_KEY`

> **ทำไมปลอดภัยแม้ฝัง anon key ไว้ใน client:** ทุกตาราง (`users`, `goals`, `tactics`,
> `scoreboard_monthly`, `sessions`) เปิด Row Level Security แต่ไม่มี policy ใดๆ ให้
> role `anon`/`authenticated` เลย จึง query ตรงไม่ได้ทั้งสิ้น การเข้าถึงข้อมูลทุก
> อย่างต้องผ่าน RPC Function ที่เป็น `SECURITY DEFINER` เท่านั้น ซึ่งแต่ละฟังก์ชัน
> จะตรวจสอบ session token + สิทธิ์ตามสายบังคับบัญชาเองก่อนทำงานทุกครั้ง

## 3. บัญชีทดสอบเริ่มต้น (จากข้อมูลตัวอย่างใน schema.sql)

| รหัสพนักงาน | รหัสผ่าน | สิทธิ์ | ตำแหน่ง |
|---|---|---|---|
| 900001 | 900001 | ADMIN | ผู้จัดการทั่วไป |
| 900002 | 900002 | SUPERVISOR | ผู้จัดการฝ่าย |
| 900003 | 900003 | SUPERVISOR | ผู้จัดการส่วน |
| 443757 | 443757 | SUPERVISOR | ผู้จัดการแผนก |
| 591144 | 591144 | STAFF | เจ้าหน้าที่ |
| 123456 | 123456 | STAFF | เจ้าหน้าที่ (ไม่มีรหัสพนักงาน) |

ทุกบัญชีจะถูกบังคับให้ตั้งรหัสผ่านใหม่ตอนล็อกอินครั้งแรก

## 4. รันทดสอบในเครื่องก่อน Deploy

ต้องรันผ่าน local web server (ไม่ใช่เปิดไฟล์ตรงๆ) เพราะใช้ ES Modules:

```bash
# ตัวเลือกใดตัวเลือกหนึ่ง
npx serve .
# หรือ
python3 -m http.server 8080
```

แล้วเปิด `http://localhost:8080/login.html`

## 5. Deploy ขึ้น GitHub Pages

1. สร้าง repo ใหม่บน GitHub แล้ว push โฟลเดอร์นี้ทั้งหมดขึ้นไปที่ branch `main`
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Goal & Scoreboard system"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo-name>.git
   git push -u origin main
   ```
2. ไปที่ repo → **Settings → Pages**
3. ที่ **Source** เลือก `Deploy from a branch` → Branch: `main` → Folder: `/ (root)` → Save
4. รอ 1–2 นาที เว็บจะพร้อมใช้งานที่ `https://<username>.github.io/<repo-name>/login.html`

### ⚠️ ข้อควรระวัง (บทเรียนจากรอบที่แล้ว — เจอแล้วอย่าให้ซ้ำ)

1. **Deploy ผ่านหน้าเว็บ GitHub (ไม่ใช้ git)**: ต้องลาก**ทั้งโฟลเดอร์** `js/`, `css/`,
   `sql/` ขึ้นไปพร้อมกันเสมอ (เลือกทั้งโฟลเดอร์ ไม่ใช่ไฟล์ข้างในทีละไฟล์ — ไม่งั้น
   ไฟล์จะหลุดไปกองที่ root ทำให้เปิดเว็บแล้ว 404) และ**ห้ามอัปโหลดไฟล์ `.zip`
   ตรงๆ** (GitHub ไม่แตกไฟล์ zip ให้อัตโนมัติ) ต้องแตกไฟล์ในเครื่องก่อนแล้วค่อยลาก
   โฟลเดอร์ที่แตกแล้วขึ้นไป
2. **`js/config.js` ต้องมีค่า Supabase URL/Key ที่ถูกต้องก่อน push** (เป็นไฟล์ public บน GitHub —
   ถ้า repo เป็น private ก็ปลอดภัยกว่า แต่ต่อให้เป็น public ก็ยังปลอดภัยเพราะ RLS ล็อกไว้ตามข้อ 2)
3. **Admin Lockout**: ก่อนลบ/ปิดใช้งานบัญชี ADMIN คนสุดท้ายในระบบทุกครั้ง ต้องตั้ง
   ADMIN คนใหม่ให้สำเร็จและ login ทดสอบผ่านก่อนเสมอ — ระบบมีการป้องกันในตัว
   (ลบตัวเองไม่ได้ / SUPERVISOR เลื่อนสิทธิ์ตัวเองเป็น ADMIN ไม่ได้) **แต่การป้องกัน
   นี้ทำงานเฉพาะตอนใช้งานผ่านแอปเท่านั้น** — ถ้าลบ/แก้ไขผ่าน Supabase
   **Table Editor** โดยตรงจะข้ามการป้องกันทั้งหมดไปเลย ควรหลีกเลี่ยงการแก้ไข
   ตาราง `users` ตรงๆ ผ่าน Table Editor
4. Supabase Auth **ไม่ได้ถูกใช้งาน** ระบบทำ session เองผ่านตาราง `sessions` — session
   หมดอายุใน 12 ชั่วโมง (ปรับได้ที่ `sessions.expires_at` default ใน schema.sql)
5. ถ้าต้องการ custom domain ให้เพิ่มไฟล์ `CNAME` ที่ root ตามมาตรฐาน GitHub Pages

## 6. โมดูลที่มีในเวอร์ชันนี้

| Module | สถานะ |
|---|---|
| Authentication & บังคับเปลี่ยนรหัสผ่านครั้งแรก | ✅ |
| โครงสร้างองค์กร + Fallback Routing (ตำแหน่งว่างข้ามอัตโนมัติ) | ✅ |
| แผนกจัดการได้จากในแอป (ไม่ hardcode) + พนักงานสังกัดได้หลายแผนก | ✅ |
| สายบริหาร/สายผู้ชำนาญการ (Dual-Track) + ตำแหน่งสร้างอัตโนมัติ | ✅ |
| เป้าหมาย & ทีเด็ด + เงื่อนไขประเมินผล (>,≥,<,≤,=) + ถือเป้าร่วม | ✅ |
| Monthly Scoreboard & Approval Workflow | ✅ |
| Interactive Analytics (Bar/Trend/Gauge/Progress) | ✅ |
| ผังองค์กรแบบต้นไม้ (Level × Department, เส้นบัส, สีพื้นหลังแยกแผนก) | ✅ |
| นำเข้าข้อมูลจาก Excel/Sheet (วาง Tab-separated) — เป้าหมาย/ทีเด็ด/Scoreboard | ✅ |
| โหมดสว่าง/มืด (จำค่าไว้ที่เครื่อง) | ✅ |
| Excel Export | ✅ |

## 7. ข้อจำกัดที่ควรทราบ / แนะนำให้ทดสอบเพิ่ม

- **Fallback Routing**: ระบบอ่านค่า `supervisor_id` ของพนักงานตรงๆ เป็นผู้อนุมัติ
  ดังนั้นเวลาผู้ดูแลระบบตั้งค่าโครงสร้างองค์กร หากตำแหน่งระดับกลางว่างอยู่
  ให้ตั้งค่า `supervisor_id` ของพนักงานคนนั้นชี้ข้ามไปยังหัวหน้าระดับถัดไปที่มี
  ตัวตนจริงโดยตรง
- **สิทธิ์แก้ไขข้ามแผนก**: SUPERVISOR แก้ไขเป้าหมาย/ทีเด็ด/Scoreboard ได้ทั้งลูกน้อง
  สายตรง และคนแผนกเดียวกันที่ระดับต่ำกว่า — แต่สิทธิ์แก้ไข**ข้อมูลพนักงาน**
  (ตำแหน่ง/แผนก/ลบ) ยังจำกัดเฉพาะ ADMIN หรือสายบังคับบัญชาตรงเท่านั้น
- **RETURNS TABLE ชื่อคอลัมน์ชนกัน**: ถ้าเพิ่ม RPC ใหม่ที่มี `returns table (...)`
  ซึ่งชื่อคอลัมน์ผลลัพธ์ตรงกับชื่อคอลัมน์จริงในตาราง (เช่น `department`, `role`,
  `user_id`) ต้องใส่ table alias กำกับทุกจุดที่อ้างคอลัมน์นั้นในฟังก์ชันเสมอ
  ไม่งั้นจะได้ error "column reference is ambiguous"
- **Cascade delete**: ทุกจุดที่ query ตารางลูก-แม่ร่วมกัน (เช่น tactics-goals)
  ต้องเช็ค `is_active` ของ**ทั้งคู่** ไม่ใช่แค่ตารางลูกอย่างเดียว
- **Patch แบบเรียงลำดับ**: อย่าแก้ `schema.sql` ตรงๆ หลัง deploy ไปแล้ว ให้สร้างไฟล์
  `patch_XXX_ชื่อเรื่อง.sql` ใหม่ทุกครั้ง เขียนด้วย `create or replace function`
  (idempotent รันซ้ำได้ปลอดภัย) แล้วรันตามลำดับเลขที่ Supabase SQL Editor
- ควรทดสอบกรณี Concurrent edit (สองคนแก้ไข Goal เดียวกันพร้อมกัน) เพิ่มเติมก่อนใช้งานจริง
- แนะนำเปลี่ยนรหัสผ่านบัญชี ADMIN ตัวอย่าง (900001) ทันทีหลัง deploy จริง
