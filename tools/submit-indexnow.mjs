#!/usr/bin/env node
/* ============================================================
   PS Locator — IndexNow Fast-Indexing Submitter
   ส่ง URL หลัก + 77 จังหวัด + 1,484 สถานี ไปยัง api.indexnow.org
   การใช้งาน:
     node tools/submit-indexnow.mjs --dry-run
     node tools/submit-indexnow.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const HOST = 'ps-locator.prajamwan.workers.dev';
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

  return {
    coreUrls,
    provinceUrls,
    stationUrls,
    allUrls: [...coreUrls, ...provinceUrls, ...stationUrls],
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

  const { coreUrls, provinceUrls, stationUrls, allUrls } = buildUrlList();
  const batches = chunkArray(allUrls, BATCH_SIZE);

  console.log('=== PS Locator — IndexNow Submitter ===');
  console.log(`Host:         ${HOST}`);
  console.log(`Key Location: ${KEY_LOCATION}`);
  console.log(`Core URLs:    ${coreUrls.length}`);
  console.log(`Provinces:    ${provinceUrls.length}`);
  console.log(`Stations:     ${stationUrls.length}`);
  console.log(`Total URLs:   ${allUrls.length} (${batches.length} batches × ≤${BATCH_SIZE})`);

  if (isDryRun) {
    console.log('\n[DRY-RUN] ไม่ได้ส่งคำขอไปยังเครือข่าย — ตัวอย่าง URLs:');
    console.log('  Core:    ', coreUrls[0], '...', coreUrls[coreUrls.length - 1]);
    console.log('  Province:', provinceUrls[0], '...', provinceUrls[provinceUrls.length - 1]);
    console.log('  Station: ', stationUrls[0], '...', stationUrls[stationUrls.length - 1]);
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
