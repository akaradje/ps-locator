/* ============================================================
   tools/build-gov.js — รวมชุดข้อมูลหน่วยงานราชการและหน่วยงานของรัฐทั่วประเทศไทย
   Sources (Official Thai Government Open Data — data.go.th / DGA):
     1. gov-central.csv & gov-sub.csv (DGA 2567 — ส่วนกลางระดับกรม/รัฐวิสาหกิจ/องค์การมหาชน/มหาวิทยาลัย/องค์กรอิสระ)
     2. bma-dist.csv (กทม. — 50 สำนักงานเขต)
     3. admincourt.csv (ศาลปกครองทั่วประเทศ)
     4. nacc.csv (สำนักงาน ป.ป.ช. ทั่วประเทศ)
     5. prisons.csv (กรมราชทัณฑ์ 2568 — เรือนจำและทัณฑสถานทั่วประเทศ)
     6. pwa.geojson (การประปาส่วนภูมิภาค 234 สาขาทั่วประเทศ)
     7. citizeninfo.csv (DGA CITIZENinfo — ศาลากลาง, ที่ว่าการอำเภอ, อปท. อบจ./เทศบาล/อบต., ศาลยุติธรรม, อัยการ, ที่ดิน, สรรพากร, ขนส่ง, ประกันสังคม, บังคับคดี, คุมประพฤติ, ตม., ศูนย์ดำรงธรรม, โรงพยาบาลรัฐ ฯลฯ)
   Output: data/gov.js (window.GOV_AGENCIES = [...]) + data/gov.json
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

function readText(filePath, encoding = 'utf8') {
  const buf = fs.readFileSync(filePath);
  if (encoding === 'windows-874' || encoding === 'tis-620') {
    return new TextDecoder('windows-874').decode(buf);
  }
  return buf.toString('utf8');
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\r' && next === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const hdr = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => c.trim()))
    .map(r => {
      const o = {};
      hdr.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      return o;
    });
}

function cleanVal(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  if (!s || /^(-|n\/a|none|null|ไม่มี|ไม่ระบุ)$/i.test(s)) return '';
  return s;
}

function normalizeUrl(raw) {
  const s = cleanVal(raw);
  if (!s) return '';
  const first = s.split(/[\s,;]+/)[0];
  if (!first || !/\./.test(first)) return '';
  return /^https?:\/\//i.test(first) ? first : 'https://' + first;
}

function extractProvince(addr) {
  const m = String(addr || '').match(/(?:จังหวัด|จ\.)\s*([ก-๙]+)|กรุงเทพมหานคร/);
  if (!m) return '';
  return m[0].startsWith('กรุงเทพ') ? 'กรุงเทพมหานคร' : m[1];
}

function mapCategory(lawCat, opdcCat, ministry, name) {
  const s = `${lawCat} ${opdcCat} ${ministry} ${name}`;
  if (/องค์กรปกครองส่วนท้องถิ่น|อบจ\.|เทศบาล|องค์การบริหารส่วนตำบล|อบต\.|สำนักงานเขต|เมืองพัทยา|ส่งเสริมการปกครองท้องถิ่น/.test(s)) return 'local';
  if (/ศาล|อัยการ|รัฐสภา|องค์กรอิสระ|ผู้ตรวจการแผ่นดิน|ป\.ป\.ช\.|กกต\.|ตรวจเงินแผ่นดิน|สิทธิมนุษยชน/.test(s)) return 'independent';
  if (/รัฐวิสาหกิจ|การไฟฟ้า|การประปา|การรถไฟ|ขนส่งมวลชน|ท่าอากาศยาน/.test(s)) return 'soe';
  if (/องค์การมหาชน/.test(lawCat) || /องค์การมหาชน/.test(opdcCat)) return 'public_org';
  if (/สถาบันอุดมศึกษา|มหาวิทยาลัย/.test(lawCat) || /^มหาวิทยาลัย|^สถาบันเทคโนโลยี|^ราชวิทยาลัย/.test(name)) return 'university';
  if (/ส่วนราชการ|กระทรวง|กรม|จังหวัด|อำเภอ|เรือนจำ|ทัณฑสถาน/.test(s)) return 'ministry';
  return 'other';
}

const inputDir = process.argv[2] || 'C:/Users/muean/.gemini/antigravity/brain/11c85856-1bf7-402a-acda-af2b56bd996a/scratch';

const seen = new Set();
const out = [];
let nextId = 1;

function addAgency(item) {
  const name = cleanVal(item.name);
  if (!name) return;
  const key = name.replace(/\s+/g, '').toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);

  const address = cleanVal(item.address);
  const province = cleanVal(item.province) || extractProvince(address);
  const rec = {
    id: nextId++,
    name,
    ministry: cleanVal(item.ministry) || 'ไม่สังกัดกระทรวง',
    category: item.category || mapCategory(item.law_cat || '', '', item.ministry || '', name),
    law_cat: cleanVal(item.law_cat) || 'หน่วยงานของรัฐ',
    address
  };
  const en = cleanVal(item.en);
  const abbr = cleanVal(item.abbr);
  const phone = cleanVal(item.phone);
  const email = cleanVal(item.email);
  const website = normalizeUrl(item.website);
  const mission = cleanVal(item.mission);
  if (en) rec.en = en;
  if (abbr) rec.abbr = abbr;
  if (province) rec.province = province;
  if (phone) rec.phone = phone;
  if (email) rec.email = email;
  if (website) rec.website = website;
  if (mission) rec.mission = mission;
  out.push(rec);
}

/* 1. DGA Central & Sub-department Agencies (458) */
const c1 = parseCSV(readText(path.join(inputDir, 'gov-central.csv')));
const c2 = parseCSV(readText(path.join(inputDir, 'gov-sub.csv')));
for (const r of [...c1, ...c2]) {
  const status = cleanVal(r.CurrentStatusDetails);
  if (status && /ยุบเลิก|ยกเลิก|สิ้นสภาพ|โอนย้าย/.test(status)) continue;
  addAgency({
    name: r.OrgNameThai,
    en: r.OrgNameEnglish,
    abbr: r.OrgNameAbbr,
    ministry: r.MinistryNameThai,
    category: mapCategory(r.MajorCategoryName_byLaw, r.MajoCategoryName_byOPDC, r.MinistryNameThai, r.OrgNameThai),
    law_cat: r.MajorCategoryName_byLaw || r.SubCategoryName_byLaw || r.MajoCategoryName_byOPDC,
    address: r.AddressComprehensive,
    province: r.ProvinceNameThai,
    phone: r.PhoneNumberGeneral || r.PhoneNumberGeneralnohyphen,
    email: r.EmailAddress,
    website: r.OrgWebsite,
    mission: r.MainMissionName
  });
}

/* 2. BMA 50 Districts */
const bma = parseCSV(readText(path.join(inputDir, 'bma-dist.csv')));
for (const r of bma) {
  addAgency({
    name: r.name,
    ministry: 'กรุงเทพมหานคร',
    category: 'local',
    law_cat: 'องค์กรปกครองส่วนท้องถิ่นรูปแบบพิเศษ',
    address: r.address,
    province: 'กรุงเทพมหานคร',
    phone: r.tel,
    website: 'https://www.bangkok.go.th'
  });
}

/* 3. Administrative Courts (windows-874) */
const ac = parseCSV(readText(path.join(inputDir, 'admincourt.csv'), 'windows-874'));
for (const r of ac) {
  const addr = [
    cleanVal(r.Building),
    cleanVal(r['Address no']) ? 'เลขที่ ' + cleanVal(r['Address no']) : '',
    cleanVal(r.Village) ? 'หมู่ ' + cleanVal(r.Village) : '',
    cleanVal(r.street) ? 'ถ.' + cleanVal(r.street) : '',
    cleanVal(r.Subdistrict) ? cleanVal(r.Subdistrict) : '',
    cleanVal(r.district) ? cleanVal(r.district) : '',
    cleanVal(r.province) ? cleanVal(r.province) : '',
    cleanVal(r.post)
  ].filter(Boolean).join(' ');
  addAgency({
    name: r.namecourt,
    ministry: 'สำนักงานศาลปกครอง',
    category: 'independent',
    law_cat: 'ศาลปกครอง',
    address: addr,
    province: r.province,
    website: 'https://www.admincourt.go.th'
  });
}

/* 4. NACC Offices Nationwide */
const nacc = parseCSV(readText(path.join(inputDir, 'nacc.csv')));
for (const r of nacc) {
  addAgency({
    name: r.OFFICE_NAME,
    ministry: 'สำนักงาน ป.ป.ช.',
    category: 'independent',
    law_cat: 'องค์กรอิสระตามรัฐธรรมนูญ',
    address: r.FULL_ADDRESS || r.ADDRESS_TEXT,
    province: r.PROVINCE,
    phone: r.TELEPHONE,
    email: r.EMAIL,
    website: 'https://www.nacc.go.th'
  });
}

/* 5. Department of Corrections — Prisons & Correctional Institutions 2568 */
const prisons = parseCSV(readText(path.join(inputDir, 'prisons.csv')));
for (const r of prisons) {
  const addr = [cleanVal(r['ที่อยู่']), cleanVal(r['จังหวัด']) ? 'จ.' + cleanVal(r['จังหวัด']) : '', cleanVal(r['รหัส'])].filter(Boolean).join(' ');
  addAgency({
    name: r['เรือนจำ'],
    ministry: 'กระทรวงยุติธรรม',
    category: 'ministry',
    law_cat: 'กรมราชทัณฑ์',
    address: addr,
    province: r['จังหวัด'],
    website: 'https://www.correct.go.th'
  });
}

/* 6. Provincial Waterworks Authority (PWA) 234 Branches (windows-874) */
const pwa = JSON.parse(readText(path.join(inputDir, 'pwa.geojson'), 'windows-874'));
for (const f of pwa.features || []) {
  const p = f.properties || {};
  addAgency({
    name: p['ชื่อ_สาขา'],
    ministry: 'กระทรวงมหาดไทย',
    category: 'soe',
    law_cat: 'รัฐวิสาหกิจ (การประปาส่วนภูมิภาค)',
    address: p['ที่อยู่'],
    phone: p['โทรศัพท์'],
    website: 'https://www.pwa.co.th'
  });
}

/* 7. DGA CITIZENinfo Nationwide Public Service Points (filtered to real agencies/offices, excluding schools/RPHs/bank branches/post offices) */
const ci = parseCSV(readText(path.join(inputDir, 'citizeninfo.csv')));
for (const r of ci) {
  const min = cleanVal(r['กระทรวง']);
  const dept = cleanVal(r['กรม']);
  const name = cleanVal(r['หน่วยงาน']);
  const addr = cleanVal(r['ที่อยู่จุดบริการ']);
  if (!name || !addr) continue;

  /* ข้ามโรงเรียนระดับพื้นฐาน, รพ.สต. ประจำหมู่บ้าน, สาขาธนาคารพาณิชย์, ที่ทำการไปรษณีย์, ศูนย์บริการ TOT */
  if (/สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน|บริษัท ไปรษณีย์ไทย|ธนาคารออมสิน|ธนาคารกรุงไทย|ธนาคารเพื่อการเกษตร|ธนาคารอาคารสงเคราะห์|บริษัท ทีโอที|บริษัท กสท/.test(dept)) continue;
  if (/โรงพยาบาลส่งเสริมสุขภาพตำบล|สถานีอนามัย/.test(name)) continue;

  addAgency({
    name,
    ministry: min || dept || 'หน่วยงานของรัฐ',
    category: mapCategory('', '', `${min} ${dept}`, name),
    law_cat: dept || min || 'หน่วยงานของรัฐ',
    address: addr
  });
}

const outDir = path.join(__dirname, '..', 'data');
fs.writeFileSync(path.join(outDir, 'gov.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
const jsText =
  '/* ชุดข้อมูลหน่วยงานของรัฐทั่วประเทศไทย — รวมข้อมูลเปิดภาครัฐ DGA, CITIZENinfo, กทม., ศาลปกครอง, ป.ป.ช., กรมราชทัณฑ์, กปภ. */\nwindow.GOV_AGENCIES = ' +
  JSON.stringify(out) + ';\n';
fs.writeFileSync(path.join(outDir, 'gov.js'), jsText, 'utf8');

const byCat = {};
const byMin = new Set();
for (const g of out) {
  byCat[g.category] = (byCat[g.category] || 0) + 1;
  if (g.ministry) byMin.add(g.ministry);
}
console.log('Total agencies:', out.length);
console.log('By category:', byCat);
console.log('Ministries/groups:', byMin.size);
console.log('data/gov.js size (MB):', (Buffer.byteLength(jsText) / 1024 / 1024).toFixed(2));
