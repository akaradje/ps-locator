# AGENTS.md — คู่มือสำหรับ AI Agent และผู้พัฒนาร่วม

เอกสารนี้คือกติกาและบริบทที่ต้องอ่านก่อนแก้โค้ดใน repo **PS Locator** (สารบบสถานีตำรวจทั่วประเทศ)
เป้าหมายสูงสุด: **ข้อมูลถูกต้องห้ามมั่ว · UI ใช้ง่ายแบบราชการสมัยใหม่ · เว็บเบาไม่มี dependency**

## 1. โครงการนี้คืออะไร

- เว็บ static หน้าเดียว (`index.html`) ค้นหาสถานีตำรวจ **1,484 แห่ง ครบ 77 จังหวัด** จากข้อมูลสำนักงานตำรวจแห่งชาติ
- ผู้ใช้หลัก: พนักงานสอบสวน เจ้าหน้าที่ตำรวจ ประชาชน — ใช้ค้นที่อยู่/เบอร์โทร พิมพ์แนบเอกสารคดี นำทาง
- Stack: **HTML + CSS + vanilla JS ล้วน ไม่มี build step ไม่มี framework ไม่มี dependency ภายนอก** (ยกเว้น Google Fonts/Maps embed)
- โฮสต์จริง: Cloudflare Workers static assets — https://ps-locator.prajamwan.workers.dev
- Repo: https://github.com/akaradje/ps-locator · สถานะล่าสุดดู [`PROJECT_STATUS.md`](PROJECT_STATUS.md)

## 2. กติกาเหล็ก (ห้ามละเมิด)

1. **ห้ามแก้ไขข้อมูลสถานีทุกกรณี** — `data/stations.js` และ `data/stations.json` เป็นข้อมูลยืนยันจาก ตร. แล้ว การอัปเดตข้อมูลทำได้ผ่านขั้นตอนในหัวข้อ 6 เท่านั้น (รันสคริปต์จากข้อมูลดิบต้นทางใหม่ ไม่ใช่แก้มือ)
2. **ห้ามแต่งเติมข้อมูล** — ฟิลด์ที่ต้นทางไม่มี (45 สถานี) ต้องแสดง “ไม่มีข้อมูล” ห้ามเดาที่อยู่/เบอร์/เว็บไซต์
3. **ห้ามเพิ่ม dependency / build step / framework** — เว็บต้องเปิดผ่าน static server ได้ทันทีโดยไม่ติดตั้งอะไร
4. **ห้ามเปลี่ยนคีย์ localStorage** (`ps:saved`, `ps:theme`) และ **URL params** (`q`, `province`, `region`, `sort`, `page`, `j`, `jtab`) — ผู้ใช้มีข้อมูลบันทึกและลิงก์แชร์ค้างอยู่ · ตัวเลือก `#sortBy` ถูกเอาออกจากหน้าเว็บแล้ว แต่ `state.sort` และพารามิเตอร์ `sort` **ต้องยังอ่านได้** เพื่อรักษาลิงก์เก่า · **ห้ามใช้คีย์ `ps:scene` และพารามิเตอร์ `pin`** (เป็นของฟีเจอร์ปักหมุดที่ถูกลบ)
5. **ข้อความ UI ทั้งหมดเป็นภาษาไทย** — ตรวจทานก่อน commit ทุกครั้ง ห้ามมีคำภาษาอื่นปน (จีน เวียดนาม ญี่ปุ่น ฯลฯ) ในข้อความที่ผู้ใช้เห็น รวมถึง README/CHANGELOG/release notes
6. **ระบบพิมพ์ A4 และ CSV ต้องทำงานเสมอ** — เป็นฟีเจอร์หลักที่ผู้ใช้พึ่งพา (พิมพ์แนบคดี, CSV เปิด Excel ภาษาไทยไม่เพี้ยนด้วย BOM) · งานพิมพ์ **ห้ามมีช่องลงชื่อและบรรทัดแหล่งข้อมูล** (ตัดออกตามคำขอผู้ใช้ 16 พ.ย. 2569) เหลือเพียง “พิมพ์จาก PS Locator · วันที่พิมพ์ …”
7. **รองรับสองธีม (สว่าง/มืด) ทุกคอมโพเนนต์ใหม่** — ใช้ CSS variables เท่านั้น ห้าม hardcode สี และตรวจ contrast ทั้งสองธีม
8. **Accessibility เป็นข้อบังคับ** — คีย์บอร์ดครบ, aria ถูกต้อง, เคารพ `prefers-reduced-motion`, focus trap ในโมดัล
9. **ขอบเขตโปรเจกต์ = สารบบสถานีตำรวจ + ตรวจเขตอำนาจจากตำบล + ย่อประกาศที่ค้นหาได้** — แต่ **“ปักหมุดที่เกิดเหตุ / วางแผนเข้าพื้นที่” ถูกตัดออกตามคำสั่งผู้ใช้ 17 พ.ย. 2569** · **ห้ามนำกลับมา** เว้นแต่ผู้ใช้สั่งชัดเจน · ผลค้นหาเขตอำนาจมาจากการถอดข้อความประกาศ (มี 4 สถานีถอดไม่ครบ + เขตบางส่วน) → ต้องแสดงป้ายเตือนและตรวจต้นฉบับทางการก่อนใช้ทางกฎหมาย
10. **Release เก่าห้ามแก้** — notes และไฟล์แนบของ `v1.0.0` / `v1.1.0` / `v1.2.0` คงเดิมถาวร เพื่อให้ย้อนกลับได้จริง · ทุก release ใหม่ต้องแนบ zip snapshot + ระบุ SHA256 ใน notes
11. การ commit/push/tag/release: ทำเมื่อผู้ใช้สั่งเท่านั้น — และใช้ author เดิมของ repo (`Monoia <35655438+akaradje@users.noreply.github.com>`) ผ่าน `git -c user.name=... -c user.email=...` ห้ามแก้ git config ของเครื่อง

## 3. โครงสร้างไฟล์

```
index.html              หน้าสารบบสถานี — โครงสร้าง + inline theme script ใน <head> (กันจอวาบ)
jurisdiction.html       หน้าเขตอำนาจสอบสวน (ค้นจากชื่อตำบล + ย่อประกาศ) — ใช้ app.js ร่วมกัน
qr-poster.html          โปสเตอร์ QR พิมพ์ A4 (ชี้ไปเว็บจริง)
manifest.webmanifest    PWA manifest
assets/styles.css       Design system: CSS variables สองธีม + คอมโพเนนต์ + @media print
assets/app.js           Logic ทั้งหมด: ค้นหา/กรอง/เรียง/แบ่งหน้า/โมดัล/พิมพ์/CSV/บันทึก/ธีม
assets/favicon.svg      ไอคอน
assets/ps-locator-*.png โปสเตอร์ QR + PNG เต็ม
data/stations.js        window.STATIONS = [...] (generated — ห้ามแก้มือ)
data/stations.json      ข้อมูลเดียวกันรูป JSON (generated — ห้ามแก้มือ)
data/jurisdictions.js   window.JURISDICTION = {...} (generated — ห้ามแก้มือ, โหลดแบบ lazy)
tools/build-stations.ps1  แปลง stations-raw.json → stations.js/.json + ผูกภาคอัตโนมัติ
tools/merge-data.ps1      รวม/เทียบข้อมูลดิบเมื่ออัปเดตจากต้นทาง
tools/serve.ps1           dev server (PowerShell HttpListener, default port 8123)
tools/extract-gazette.py  (ผู้ดูแล/ออฟไลน์) ถอดข้อความไทยจาก PDF ราชกิจจานุเบกษา
tools/build-jurisdictions.py (ผู้ดูแล/ออฟไลน์) สร้าง data/jurisdictions.js
docs/DATA_SOURCES.md      เอกสารอ้างอิงแหล่งข้อมูล
docs/gazette/2567.txt     ข้อความประกาศ ตร. 427 หน้า (ใช้ค้นฉบับเต็ม)
docs/gazette/2568-2.txt   ข้อความประกาศฉบับที่ 2 อีก 13 หน้า
CHANGELOG.md            บันทึกการเปลี่ยนแปลงรายเวอร์ชัน (root)
PROJECT_STATUS.md       สถานะโครงการปัจจุบัน
README.md               คู่มือภาพรวม
.previews/              ภาพทดสอบ UI (gitignore — ไม่ขึ้น repo)
```

หมายเหตุ: `data/stations-raw.json` (ข้อมูลดิบก่อนผูกภาค) ไม่อยู่ใน repo — ผู้ดูแลเก็บในเครื่อง เป็น input ของ build script

## 4. สถาปัตยกรรมที่ต้องรู้ก่อนแก้ `assets/app.js`

- **ข้อมูล:** `window.STATIONS` — ฟิลด์ต่อสถานี: `id, name, address, phone, fax, website, province_th, region`
- **region ids:** `bkk` (บช.น.), `p1`…`p9` (ภ.1–ภ.9) — ลำดับ/ชื่อแสดงอยู่ใน `REGIONS`
- **การค้นหา:** `norm()` = NFC + lowercase + ตัด “สถานีตำรวจ/สน./สภ.” + ลบช่องว่าง/วรรคตอน · ดัชนี `HAY` (Map ต่อ id: name/addr/prov/phone/region ที่ normalize แล้ว) **สร้างครั้งเดียวตอน boot** — ห้ามกลับไป normalize ซ้ำทุกรอบพิมพ์
- **สถานะ:** object `state` เดียว (q, province, region, sort, page, savedOnly) — `renderResults()` คือท่อหลัก: นับ → chips → active filters → innerHTML การ์ด → stagger → pagination → `syncURL()` (history.replaceState)
- **ตัวเลือกเรียงลำดับ (`#sortBy`) ถูกเอาออกจากหน้าเว็บแล้ว** ตามคำขอผู้ใช้ · `state.sort`, `getFiltered()` และพารามิเตอร์ `sort` ใน URL **ยังอยู่** เพื่อรักษาลิงก์แชร์เก่า · โค้ดที่อ้าง `#sortBy` ต้องใช้ optional chaining/null-check เสมอ · `resetFilters()` คือจุดคืนค่า `state.sort = 'region'` · **ห้ามนำ dropdown นี้กลับมา** เว้นแต่ผู้ใช้ขอ
- **คำแนะนำค้นหา:** จัดอันดับ ชื่อขึ้นต้น(0) → ชื่อมีคำ(1) → จังหวัด(2) → ที่อยู่(3) → เบอร์/ภาค(4), สูงสุด 8 รายการ · ไฮไลต์ด้วย `hl()` (escape ทีละส่วน ปลอดภัยจาก XSS)
- **ธีม:** `html[data-theme]` + `applyTheme()` · inline script ใน head ตั้งธีมก่อน paint · ถ้าไม่มีค่าที่บันทึกไว้ให้ตาม `prefers-color-scheme` (listener ทำงานเฉพาะเมื่อผู้ใช้ยังไม่เคยเลือก)
- **โมดัล:** focus trap (Tab วนในกล่อง), Esc ปิด, คลิก overlay ปิด, คืนโฟกัสจุดเดิม · เปิดจาก suggestion ต้องปิด suggestion ก่อนเสมอ · `.modal` เป็น flex column → `.modal-head`/`.modal-foot` ตรึง, `.modal-body` เลื่อนเอง · ปุ่ม `#dCopy` ต้องเป็น btn-primary ลำดับแรกใน `.modal-foot`
- **พิมพ์:** `printStation()` / `printFilteredList()` — ตราสัญลักษณ์ SVG + หัวกระดาษราชการ + ท้ายใบ “พิมพ์จาก PS Locator · วันที่พิมพ์ …” · **ไม่มีช่องลงชื่อ / ไม่มีบรรทัดแหล่งข้อมูล / ไม่มี “หน้า 1 / 1”** · `@page A4 margin 14mm 13mm` · บังคับ `color-scheme: light` ตอนพิมพ์
- **คัดลอก:** `stationCopyText()` = ชื่อสถานี + ที่อยู่ + โทรศัพท์ — **ไม่มีแฟกซ์** · ต้องเก็บ `e.currentTarget` ไว้ในตัวแปรก่อนเข้า async callback ไม่งั้น feedback “คัดลอกแล้ว” จะไม่แสดง
- **URL:** `syncURL()` ต้องต่อ `window.location.hash` กลับเข้า `history.replaceState` เสมอ · เพิ่ม `j` (คำค้นตำบล) และ `jtab` (`jur` / `digest`) แต่ **ต้องไม่มี `pin` / `jtab=scene`**
- **เขตอำนาจ:** `data/jurisdictions.js` โหลด lazy ด้วย `loadJurisdiction()` → `afterJurisdictionLoaded()` · `normJur()` ตัดคำนำหน้าเกี่ยวกับตำบล/อำเภอ/จังหวัด แต่ `jurKeys()` ต้องเก็บทั้งแบบตัดและแบบดิบไว้ (ตำบลจริงชื่อ `จ. ป. ร.`) · ถ้ามี exact hit ใน `d.index` ให้กด fuzzy station-name fallback ไว้ เพื่อไม่ให้ผลค้นหาเพี้ยน · แยกป้ายเตือน `missing` (ถอดไม่ครบ) กับ `partialCount` (บางส่วน/เฉพาะหมู่ที่/แนวเขต) · `data/jurisdictions.js` ห้ามแก้มือ ต้องสร้างจาก `tools/build-jurisdictions.py` เท่านั้น
- **CSV:** UTF-8 + BOM literal นำหน้าเสมอ (ทั้ง `exportCSV()` และ `exportJurisdictionCSV()`)
- **pitfall ที่เคยเจอ (อย่าทำซ้ำ):**
  - CSS grid auto-placement: item ที่กำหนด row ชัดแต่ column auto จะถูกจัดก่อน item auto อื่น → กำหนด `grid-column/grid-row` ชัดทุกส่วนย่อย
  - Flex `flex:1; min-width:0` ในแถวที่เนื้อหาแน่นจะยุบเหลือ ~0 → ใช้ `flex:1 1 <basis>; min-width:<px>`
  - อย่าอ่าน state (เช่น aria-pressed) จาก node ที่ถูก re-render หลุด DOM แล้ว

## 5. คำสั่งที่ใช้บ่อย

```powershell
# รัน dev server (ต้องเปิดผ่าน HTTP ห้าม file://)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8123
# → http://localhost:8123
```
```bash
node --check assets/app.js        # ตรวจ syntax JS (ไม่มี test runner อื่น)
git status --short                # ตรวจว่า data/ ไม่ถูกแก้ก่อน commit เสมอ
git diff v1.0.0 HEAD -- data/     # ต้องว่างเปล่า — ถ้ามี output คือละเมิดกติกาข้อ 1
```

## 6. ขั้นตอนอัปเดตข้อมูล (ทำเมื่อ ตร. เปลี่ยนแปลงเท่านั้น)

1. ดึงข้อมูลใหม่จากต้นทาง https://www.royalthaipolice.go.th/th/police-stations (ระบบฝัง: `…/stations/index.php?action=fetch_state&country_id=<id>` และ `?action=fetch_city&state_id=<id>`)
2. เก็บเป็น `data/stations-raw.json` (โครงดูใน README) — ใช้ `tools/merge-data.ps1` ช่วยรวม/เทียบกับชุดเดิม
3. รัน `powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-stations.ps1` → ได้ `stations.js` + `stations.json` ใหม่ผูกภาคอัตโนมัติ
4. ตรวจ: จำนวนสถานี/จังหวัดครบ, ฟิลด์ว่างยังแสดง “ไม่มีข้อมูล”, ไม่มีรายการแต่งเติม
5. อัปเดตข้อความ “ข้อมูล ณ วันที่ …” ใน `index.html` และวันที่ในฟิลด์พิมพ์ของ `assets/app.js`
6. บันทึก CHANGELOG + เพิ่มเวอร์ชัน (หัวข้อ 8) — **การอัปเดตข้อมูลเป็น minor/major version เสมอ** พร้อมระบุวันที่รวบรวมใหม่ใน release notes

## 7. Checklist ทดสอบก่อนเผยแพร่ทุกเวอร์ชัน

ทดสอบบนเบราว์เซอร์จริงผ่าน HTTP ทั้ง **มือถือ (~632px) และเดสก์ท็อป (≥1280px)**:

- [ ] ค้นหา + suggestions + คีย์บอร์ด ↑↓/Enter/Esc/Tab + คลิกเลือก → โมดัลถูกต้อง
- [ ] Combobox จังหวัด: พิมพ์กรอง/จำนวน/คีย์บอร์ด/คลิกนอกปิด · ชิปกองบัญชาการ + จำนวน
- [ ] แบ่งหน้า · ล้างตัวกรอง (ต้องคืน `state.sort` กลับเป็น `region`) · เฉพาะที่บันทึก · **ต้องไม่มีตัวเลือก “เรียง:” ในแถบค้นหา** · ลิงก์เก่า `?sort=name` ยังแสดงลำดับเดิมได้
- [ ] ธีมมืด/สว่าง: สลับ/จำค่าข้ามรีโหลด/ตามค่าระบบ/meta theme-color · ไม่มีจอวาบ
- [ ] Mini-search ซิงค์สองทาง · ปุ่มกลับขึ้นบน
- [ ] โมดัล: แผนที่ embed/โทร/นำทาง/คัดลอก+feedback/พิมพ์/บันทึก · Esc · focus trap
- [ ] พิมพ์ A4 (รายสถานี + บัญชีรายนาม) · CSV เปิดใน Excel ภาษาไทยไม่เพี้ยน
- [ ] URL params: รีโหลดแล้วตัวกรองอยู่ครบ · แชร์ลิงก์เปิดได้ผลเดิม
- [ ] **console errors = 0** · ไม่มีการทับซ้อน/ล้น/ตกจอ · ข้อมูล data/ ไม่ถูกแก้
- [ ] ข้อความ UI เป็นไทยล้วน ไม่มีคำภาษาอื่นปน
- [ ] หน้าเขตอำนาจ: ค้นตำบล → ได้ สภ./สน. + รายชื่อตำบล + เขตเพื่อนบ้าน + เลขหน้า · suggestions คีย์บอร์ด · ป้ายเตือน 4 สถานีถอดไม่ครบ/เขตบางส่วน · ค้นฉบับเต็ม · พิมพ์ใบตรวจสอบ A4 · CSV · โหลด lazy · ทั้งสองธีม
- [ ] **ไม่มีเศษโค้ด/UI ของฟีเจอร์ปักหมุดที่เกิดเหตุ** — สแกน `parsePin`, `setPin`, `ps:scene`, `jtab=scene`, `incident-map`, `ปักหมุด` ต้องไม่พบในโค้ด/ข้อความที่ผู้ใช้เห็น (`jurisdiction` / `jtab` / `JURISDICTION` / `gazette` ต้องมีเพราะเป็นฟีเจอร์ที่คืนแล้ว)

## 8. ขั้นตอน Release + Rollback (ทำเมื่อผู้ใช้สั่ง)

```bash
# 1) อัปเดต CHANGELOG.md (เพิ่มหัวข้อเวอร์ชันใหม่บนสุด — ภาษาไทย, ระบุ “หมายเหตุข้อมูล” เสมอ)
# 2) commit (author เดิมของ repo, ห้ามแก้ git config)
git -c user.name=Monoia -c user.email=35655438+akaradje@users.noreply.github.com commit -am "..."
# 3) annotated tag
git -c user.name=Monoia -c user.email=35655438+akaradje@users.noreply.github.com tag -a vX.Y.Z -m "..."
# 4) push
git push origin main --tags
# 5) zip snapshot สำหรับ deploy/rollback (เฉพาะไฟล์ที่ commit แล้ว — ตรวจเนื้อหาก่อนแนบเสมอ)
git archive --format=zip -o ps-locator-vX.Y.Z.zip vX.Y.Z
sha256sum ps-locator-vX.Y.Z.zip    # ใส่ค่าใน release notes
# 6) release notes ภาษาไทยละเอียดสุด: สรุปภาพรวม/เพิ่ม/เปลี่ยนแปลง/ตัดออก/แก้ไข/หมายเหตุข้อมูล/
#    การทดสอบ/วิธี deploy/วิธีย้อนกลับ/ประวัติทุกเวอร์ชัน/SHA256
gh release create vX.Y.Z --title "..." --notes-file notes.md ps-locator-vX.Y.Z.zip
# 7) ตรวจว่า release เก่ายังอยู่ครบ (ห้ามแก้ notes หรือ asset ของ release เก่า)
gh release list --repo akaradje/ps-locator
```

- เวอร์ชัน: ฟีเจอร์ UI ใหม่ = minor · อัปเดตข้อมูล = minor ขึ้นไปพร้อมระบุชัด · แก้บั๊กเล็กน้อย = patch
- **Rollback 3 ทาง:** (1) ดาวน์โหลด zip ของ release ที่ต้องการ (`v1.2.0` = ไม่มีเขตอำนาจเลย, `v1.1.0`, `v1.0.0`) → อัปโหลดทับใน Cloudflare Dashboard (~1 นาที, แนะนำ) (2) `git checkout <tag>` หรือ `git revert <commit>` (3) `git archive --format=zip ... <tag>` แล้ว deploy
- **ตรวจสอบความสมบูรณ์ก่อน deploy:** เปรียบเทียบ SHA256 ของ zip ที่ดาวน์โหลดกับค่าที่ระบุใน release notes
- **Release เก่า = จุดย้อนกลับ:** อย่าแก้ `--notes`, อย่าลบ/แทนที่ asset ของ `v1.0.0` / `v1.1.0` / `v1.2.0` · ถ้าต้องการรายละเอียดเพิ่ม ให้เขียนรวมไว้ใน notes ของ release ใหม่แทน
- **ข้อมูลเขตอำนาจติด release ด้วย:** zip ต้องมี `data/jurisdictions.js` และ `docs/gazette/*.txt` — ตรวจรายชื่อไฟล์ใน zip ก่อนสร้าง release เสมอ
- Deploy จริง: Cloudflare Dashboard → Workers & Pages → Upload your static files → Deploy (ทำในบัญชี Cloudflare ของผู้ดูแล — agent ทำให้ไม่ได้)
- หลัง deploy: ตรวจเว็บจริง + แนะนำรัน Lighthouse ซ้ำ แล้วอัปเดต `PROJECT_STATUS.md`

## 9. แนวทางโค้ด

- Vanilla JS สมัยใหม่ (const/let, arrow, template literals) — ไฟล์เดียว `assets/app.js` ไม่ต้องแยกโมดูล
- สี/ระยะ/ฟอนต์ ผ่าน CSS variables ใน `:root` และ `[data-theme="dark"]` เท่านั้น
- Comment เท่าที่จำเป็น: อธิบาย “ทำไม” เฉพาะจุดที่เงื่อนไขไม่ชัดเจน — ไม่เขียน comment เล่าสิ่งที่โค้ดทำชัดเจนอยู่แล้ว
- HTML ที่ผู้ใช้เห็น escape เสมอ (`esc()`/`hl()`) — ห้าม innerHTML ข้อมูลดิบที่ไม่ผ่าน escape
- ภาษาไทยใน UI: สะกดราชการถูกต้อง (สถานีตำรวจ, กองบัญชาการ, ตำรวจภูธรภาค) · วันที่รูปแบบไทย · เบอร์โทรแสดงตาม `formatPhoneDisplay()`
- ก่อนส่งงาน: รัน checklist หัวข้อ 7 + `node --check` + ตรวจ `git diff -- data/` ว่าง
