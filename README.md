# PS Locator — สารบบสถานีตำรวจทั่วประเทศ

เว็บไซต์ค้นหาสถานีตำรวจ (สน./สภ.) สำหรับ **พนักงานสอบสวน เจ้าหน้าที่ตำรวจ และประชาชน**
ครอบคลุมสถานีตำรวจ **1,484 แห่ง ครบทั้ง 77 จังหวัด** — แสดงที่อยู่ เบอร์โทรศัพท์ โทรสาร เว็บไซต์ทางการ และปุ่มนำทาง (Google Maps) พร้อมพิมพ์รายละเอียดแนบเอกสารคดีได้

## ✨ คุณสมบัติ

- ค้นหาแบบยืดหยุ่น (ชื่อสถานี / จังหวัด / ที่อยู่ / แขวง-ตำบล) พิมพ์ไม่เต็มก็เจอ
- กรองตาม **กองบัญชาการ** บช.น. และ ตำรวจภูธรภาค 1–9 หรือ **จังหวัด** ครบ 77 จังหวัด
- โทร / นำทาง Google Maps / คัดลอกที่อยู่ / พิมพ์ / บันทึกสถานีที่ใช้บ่อย (localStorage)
- ดาวน์โหลดผลลัพธ์เป็น **CSV** (เปิดใน Excel ได้ มี BOM ภาษาไทยไม่เพี้ยน)
- พิมพ์รายงานรายสถานี หรือพิมพ์บัญชีรายนามสถานีทั้งหมดที่กรอง
- รองรับมือถือ (Responsive) — แถบกรองเลื่อนแนวนอน, การ์ดเต็มจอ
- ไม่มี build step — เปิด `index.html` ผ่านเว็บเซิร์ฟเวอร์ static ได้ทันที
- อ้างอิงข้อมูลจาก **สำนักงานตำรวจแห่งชาติ** ([royalthaipolice.go.th](https://www.royalthaipolice.go.th/th/police-stations) → เมนู “ข้อมูลสถานีตำรวจ”)

## 🌐 เว็บไซต์ออนไลน์

### **https://ps-locator.prajamwan.workers.dev**

โฮสต์บน **Cloudflare** (Workers static assets — ฟรี ไม่จำกัดปริมาณ พร้อม HTTPS) อัปเดตเว็บได้ด้วยไฟล์ `ps-locator.zip` ผ่าน Cloudflare Dashboard → Workers & Pages → Create application → **Upload your static files** → Deploy

**โค้ดสาธารณะ (Public repository):** https://github.com/akaradje/ps-locator

## 🚀 วิธีรัน

**ตัวเลือกที่ 1 — PowerShell (ไม่ต้องติดตั้งอะไรเพิ่ม)**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8123
# เปิด http://localhost:8123
```

**ตัวเลือกที่ 2 — เซิร์ฟเวอร์ static อื่นใดก็ได้** (VS Code Live Server, nginx, Apache, GitHub Pages, Cloudflare Pages …)

> ⚠️ อย่าเปิดผ่าน `file://` เพราะ Google Fonts/Maps บางส่วนอาจถูกบล็อก — ควรใช้ HTTP

## 📁 โครงสร้าง

```
PS-Locator/
├── index.html              # หน้าเดียวจบ (SPA-ish)
├── assets/
│   ├── styles.css          # Design system (ราชการสมัยใหม่ / Minimal)
│   ├── app.js              # ค้นหา/กรอง/พิมพ์/CSV/บันทึก — vanilla JS
│   └── favicon.svg
├── data/
│   ├── stations.js         # ข้อมูลสถานี (generated) — window.STATIONS
│   ├── stations.json       # ข้อมูลเดียวกันในรูป JSON (สำหรับตรวจสอบ/ต่อยอด)
│   └── stations-raw.json   # ข้อมูลดิบจากต้นทางก่อนผูกภาค
├── tools/
│   ├── build-stations.ps1  # แปลง stations-raw.json → stations.js/.json (ผูกภาคให้)
│   └── serve.ps1           # dev server ไม่ต้องติดตั้งอะไร
└── README.md
```

## 🔄 ขั้นตอนอัปเดตข้อมูล (ทำปีละครั้ง หรือเมื่อ ตร. ประกาศย้าย/เปิดสถานี)

1. เปิดหน้าทางการ: https://www.royalthaipolice.go.th/th/police-stations (หน้า “ข้อมูลสถานีตำรวจ” ฝังจากระบบ ตร.)
2. ระบบต้นทางดึงข้อมูลด้วย URL รูปแบบ `…/stations/index.php?action=fetch_state&country_id=<province_id>` และ `…?action=fetch_city&state_id=<station_id>`
3. เก็บรายการทั้งหมดเป็น `data/stations-raw.json` (ดูโครงตัวอย่างใน `data/stations-raw.json`)
4. รัน: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-stations.ps1`
5. ตรวจผล: `stations.js` และ `stations.json` จะถูกสร้างใหม่พร้อมผูกภาคให้อัตโนมัติ
6. อัปเดตข้อความ “ข้อมูล ณ วันที่ …” ใน `index.html` และ `assets/app.js` (ฟิลด์วันที่พิมพ์)

### รูปแบบ stations-raw.json

```json
[
  {
    "id": 1,
    "name": "สน.ชนะสงคราม",
    "address": "74 ถ.จักรพงษ์ แขวงตลาดยอด เขตพระนคร กรุงเทพฯ 10200",
    "phone": "022822323",
    "fax": "022823166",
    "website": "https://chanasongkhram.metro.police.go.th",
    "province_id": 1,
    "province_th": "กรุงเทพมหานคร"
  }
]
```

## 📌 หมายเหตุด้านความถูกต้อง

- ที่อยู่/โทรศัพท์/แฟกซ์/เว็บไซต์ของ **ทั้ง 1,484 รายการครบ 77 จังหวัด** มาจากระบบเปิดเผยข้อมูลของ **สำนักงานตำรวจแห่งชาติ** โดยตรง ไม่อ้างอิงจากแหล่งอื่น
- “ภาค” ผูกครบทุกสถานีตามประกาศการแบ่งเขตพื้นที่การปกครองของ ตร. (บช.น. + ภ.1–ภ.9)
- สถานีที่ต้นทางไม่ได้กรอกที่อยู่/เบอร์ จะแสดง “ไม่มีข้อมูล” อย่างชัดเจน ไม่ถูกแต่งเติม
- การนำทางใช้ Google Maps ค้นจากชื่อ + ที่อยู่ (ไม่ต้องใช้ API key)

## 🙏 เครดิต

พัฒนาโดย **ผู้ช่วยพนักงานสอบสวน สภ.เมืองชุมพร** เพื่ออำนวยความสะดวกแก่พนักงานสอบสวนทั่วประเทศไทย
แจ้งข้อมูลคลาดเคลื่อน / สอบถาม ได้ที่ **akaradje07@gmail.com**

## ⚖️ ข้อจำกัดความรับผิด

ข้อมูลนี้จัดทำเพื่ออำนวยความสะดวกในการปฏิบัติงานเท่านั้น ก่อนดำเนินการทางกฎหมายหรือจัดส่งเอกสารราชการ โปรดยืนยันกับสถานีตำรวจต้นทางอีกครั้ง
