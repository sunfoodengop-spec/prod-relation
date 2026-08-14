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

### ข้อควรระวัง
- **`js/config.js` ต้องมีค่า Supabase URL/Key ที่ถูกต้องก่อน push** (เป็นไฟล์ public บน GitHub —
  ถ้า repo เป็น private ก็ปลอดภัยกว่า แต่ต่อให้เป็น public ก็ยังปลอดภัยเพราะ RLS ล็อกไว้ตามข้อ 2)
- Supabase Auth **ไม่ได้ถูกใช้งาน** ระบบทำ session เองผ่านตาราง `sessions` — session
  หมดอายุใน 12 ชั่วโมง (ปรับได้ที่ `sessions.expires_at` default ใน schema.sql)
- ถ้าต้องการ custom domain ให้เพิ่มไฟล์ `CNAME` ที่ root ตามมาตรฐาน GitHub Pages

## 6. โมดูลที่ทำในเวอร์ชันนี้ (ครบตาม SRS)

| Module | สถานะ |
|---|---|
| M1 Authentication & Account Management | ✅ |
| M2 Org Structure & Fallback Routing | ✅ |
| M3 Goal & Tactical Action Management + Adopt/Cascade | ✅ |
| M4 Monthly Scoreboard & Approval Workflow | ✅ |
| M5 Interactive Analytics (Bar/Trend/Gauge/Progress) + Org Network Map | ✅ |
| M6 Excel Export Engine | ✅ |

## 7. ข้อจำกัดที่ควรทราบ / แนะนำให้ทดสอบเพิ่ม

- **Fallback Routing**: ระบบอ่านค่า `supervisor_id` ของพนักงานตรงๆ เป็นผู้อนุมัติ
  ดังนั้นเวลาผู้ดูแลระบบตั้งค่าโครงสร้างองค์กร หากตำแหน่งระดับกลางว่างอยู่
  ให้ตั้งค่า `supervisor_id` ของพนักงานคนนั้นชี้ข้ามไปยังหัวหน้าระดับถัดไปที่มี
  ตัวตนจริงโดยตรง (ไม่ต้องรอระบบคำนวณอัตโนมัติ เพราะโครงสร้างองค์กรที่แท้จริง
  ควรถูกกำหนดโดยผู้ดูแลระบบ)
- Org Network Map ใช้ D3.js วาดเป็น Tree Layout (ไม่ใช่ Force-directed) เพื่อความ
  ชัดเจนของสายบังคับบัญชา คลิกโหนดเพื่อย่อ/ขยาย
- ควรทดสอบกรณี Concurrent edit (สองคนแก้ไข Goal เดียวกันพร้อมกัน) เพิ่มเติมก่อนใช้งานจริง
- แนะนำเปลี่ยนรหัสผ่านบัญชี ADMIN ตัวอย่าง (900001) ทันทีหลัง deploy จริง
