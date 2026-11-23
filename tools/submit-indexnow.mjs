#!/usr/bin/env node
/* ============================================================
   KadeeHub (PS Locator) — IndexNow Fast-Indexing Submitter
   ส่ง URL หลัก + 77 จังหวัด + 1,484 สถานี + 96 ธนาคาร + ~7,034 ตำบล ไปยัง api.indexnow.org
   การใช้งาน:
     node tools/submit-indexnow.mjs --dry-run
     node tools/submit-indexnow.mjs
     node tools/submit-indexnow.mjs --host kadeehub.online
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function resolveHostArg() {
  const idx = process.argv.indexOf('--host');
  if (idx !== -1 && process.argv[idx + 1]) {
    return String(process.argv[idx + 1]).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
  const eqArg = process.argv.find((a) => a.startsWith('--host='));
  if (eqArg) {
    return eqArg.slice('--host='.length).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
  return 'kadeehub.online';
}

const HOST = resolveHostArg();
const ORIGIN = `https://${HOST}`;
const KEY = 'pslocator2026indexnowkey8a7f3c91';
const KEY_LOCATION = `${ORIGIN}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH_SIZE = 500;

function buildUrlList() {
  const stationsPath = path.join(ROOT, 'data', 'stations.json');
  const stations = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
  if (!Array.isArray(stations) || !stations.length) {
    throw new Error('ไม่สามารถอ่านข้อมูลสถานีจาก data/stations.json ได้');
  }

  const banksPath = path.join(ROOT, 'data', 'banks.json');
  const banks = fs.existsSync(banksPath) ? JSON.parse(fs.readFileSync(banksPath, 'utf8')) : [];

  const jurPath = path.join(ROOT, 'data', 'jurisdictions.js');
  const tambonPairMap = new Map();
  if (fs.existsSync(jurPath)) {
    const rawJur = fs.readFileSync(jurPath, 'utf8');
    const eqIdx = rawJur.indexOf('=');
    if (eqIdx !== -1) {
      const jur = JSON.parse(rawJur.slice(eqIdx + 1).replace(/;\s*$/, '').trim());
      const records = Array.isArray(jur && jur.stations) ? jur.stations : [];
      for (const rec of records) {
        const prov = String((rec && rec.province) || '').trim();
        const tbs = Array.isArray(rec && rec.tambons) ? rec.tambons : [];
        for (const tb of tbs) {
          const name = String((tb && tb.name) || '').trim();
          if (!prov || !name) continue;
          const key = `${prov}\0${name}`;
          if (!tambonPairMap.has(key)) {
            tambonPairMap.set(key, { province: prov, tambon: name });
          }
        }
      }
    }
  }

  const coreUrls = [
    `${ORIGIN}/`,
    `${ORIGIN}/jurisdiction`,
    `${ORIGIN}/map`,
    `${ORIGIN}/banks`,
    `${ORIGIN}/gov`,
    `${ORIGIN}/provinces`,
    `${ORIGIN}/qr-poster.html`,
  ];

  const provSet = new Set();
  for (const st of stations) {
    if (st && st.province_th) provSet.add(String(st.province_th).trim());
  }
  const provinceUrls = Array.from(provSet)
    .sort((a, b) => a.localeCompare(b, 'th'))
    .map((prov) => `${ORIGIN}/province/${encodeURIComponent(prov)}`);

  const stationUrls = stations
    .filter((st) => st && st.id !== undefined && st.id !== null)
    .map((st) => `${ORIGIN}/station/${encodeURIComponent(st.id)}`);

  const bankUrls = (Array.isArray(banks) ? banks : [])
    .filter((b) => b && b.id !== undefined && b.id !== null)
    .map((b) => `${ORIGIN}/bank/${encodeURIComponent(b.id)}`);

  const tambonUrls = Array.from(tambonPairMap.values())
    .sort((a, b) => {
      const pCmp = a.province.localeCompare(b.province, 'th');
      return pCmp !== 0 ? pCmp : a.tambon.localeCompare(b.tambon, 'th');
    })
    .map((item) => `${ORIGIN}/tambon/${encodeURIComponent(item.province)}/${encodeURIComponent(item.tambon)}`);

  return {
    coreUrls,
    provinceUrls,
    stationUrls,
    bankUrls,
    tambonUrls,
    allUrls: [...coreUrls, ...provinceUrls, ...stationUrls, ...bankUrls, ...tambonUrls],
  };
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const keyFilePath = path.join(ROOT, `${KEY}.txt`);
  if (!fs.existsSync(keyFilePath)) {
    throw new Error(`ไม่พบไฟล์ยืนยัน IndexNow key: ${keyFilePath}`);
  }
  const keyFileContent = fs.readFileSync(keyFilePath, 'utf8').trim();
  if (keyFileContent !== KEY) {
    throw new Error('เนื้อหาในไฟล์ IndexNow key ไม่ตรงกับชื่อไฟล์');
  }

  const { coreUrls, provinceUrls, stationUrls, bankUrls, tambonUrls, allUrls } = buildUrlList();
  const batches = chunkArray(allUrls, BATCH_SIZE);

  console.log('=== KadeeHub (PS Locator) — IndexNow Submitter ===');
  console.log(`Host:         ${HOST}`);
  console.log(`Key Location: ${KEY_LOCATION}`);
  console.log(`Core URLs:    ${coreUrls.length}`);
  console.log(`Provinces:    ${provinceUrls.length}`);
  console.log(`Stations:     ${stationUrls.length}`);
  console.log(`Banks:        ${bankUrls.length}`);
  console.log(`Tambons:      ${tambonUrls.length}`);
  console.log(`Total URLs:   ${allUrls.length} (${batches.length} batches × ≤${BATCH_SIZE})`);

  if (isDryRun) {
    console.log('\n[DRY-RUN] ไม่ได้ส่งคำขอไปยังเครือข่าย — ตัวอย่าง URLs:');
    console.log('  Core:    ', coreUrls[0], '...', coreUrls[coreUrls.length - 1]);
    console.log('  Province:', provinceUrls[0], '...', provinceUrls[provinceUrls.length - 1]);
    console.log('  Station: ', stationUrls[0], '...', stationUrls[stationUrls.length - 1]);
    console.log('  Bank:    ', bankUrls[0], '...', bankUrls[bankUrls.length - 1]);
    console.log('  Tambon:  ', tambonUrls[0], '...', tambonUrls[tambonUrls.length - 1]);
    process.exit(0);
  }

  for (let i = 0; i < batches.length; i++) {
    const payload = {
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: batches[i],
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    console.log(`Batch ${i + 1}/${batches.length} (${batches[i].length} URLs) → HTTP ${res.status}${text ? ' ' + text.slice(0, 120) : ''}`);
    if (!res.ok) {
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
