#!/usr/bin/env node
/* ============================================================
   PS Locator — Automated Pre-Release QA Verification
   ตรวจครบ 5 หมวดและคืน exit code 0 (PASS) หรือ 1 (FAIL)
   การใช้งาน: node tools/qa-verify.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? '[PASS]' : '[FAIL]';
  console.log(`${tag} ${name}${detail ? ' — ' + detail : ''}`);
}

/* 1) Protected Data Diff Check */
function checkProtectedDataDiff() {
  const protectedPaths = [
    'data/stations.js',
    'data/stations.json',
    'data/jurisdictions.js',
    'docs/gazette/',
  ];
  try {
    const out = execFileSync(
      'git',
      ['diff', 'origin/main', '--', ...protectedPaths],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    if (!out) {
      record('1. Protected Data Diff (origin/main)', true, 'ไม่พบการแก้ไขข้อมูลทางการใน data/ และ docs/gazette/');
    } else {
      record('1. Protected Data Diff (origin/main)', false, 'พบการเปลี่ยนแปลงไฟล์ข้อมูลทางการต้องห้าม!');
    }
  } catch (err) {
    record('1. Protected Data Diff (origin/main)', false, `รัน git diff ไม่สำเร็จ: ${err.message}`);
  }
}

/* 2) JS Syntax Check (node --check) */
function checkJsSyntax() {
  const files = [
    'assets/app.js',
    'assets/map.js',
    'assets/offline-db.js',
    'sw.js',
    'worker.js',
  ];
  const failed = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      failed.push(`${rel} (ไม่พบไฟล์)`);
      continue;
    }
    try {
      execFileSync(process.execPath, ['--check', abs], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const msg = (err.stderr ? err.stderr.toString('utf8') : err.message).trim().split('\n')[0];
      failed.push(`${rel}: ${msg}`);
    }
  }
  if (!failed.length) {
    record('2. JS Syntax Check (node --check)', true, `ผ่านครบ ${files.length} ไฟล์`);
  } else {
    record('2. JS Syntax Check (node --check)', false, failed.join(' | '));
  }
}

/* 3) Data Integrity (stations.json + station-coords.json) */
function checkDataIntegrity() {
  try {
    const stations = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'stations.json'), 'utf8'));
    if (!Array.isArray(stations)) {
      record('3. Data Integrity', false, 'data/stations.json ไม่ใช่ array');
      return;
    }
    const idSet = new Set();
    const provSet = new Set();
    let dupIds = 0;
    for (const st of stations) {
      const id = String(st.id);
      if (idSet.has(id)) dupIds++;
      idSet.add(id);
      if (st.province_th) provSet.add(st.province_th);
    }

    const coordsPath = path.join(ROOT, 'data', 'station-coords.json');
    let coordsOk = false;
    let coordsInfo = '';
    if (fs.existsSync(coordsPath)) {
      const coords = JSON.parse(fs.readFileSync(coordsPath, 'utf8'));
      const hasValidShape =
        coords &&
        typeof coords === 'object' &&
        !Array.isArray(coords) &&
        coords.meta &&
        typeof coords.meta === 'object' &&
        coords.coords &&
        typeof coords.coords === 'object' &&
        !Array.isArray(coords.coords);
      const entries = hasValidShape ? Object.entries(coords.coords) : [];
      let validCoords = 0;
      let badCoords = 0;
      for (const [key, val] of entries) {
        if (!val || typeof val !== 'object' || !idSet.has(String(key))) {
          badCoords++;
          continue;
        }
        const lat = Number(val.lat ?? val[0]);
        const lng = Number(val.lng ?? val.lon ?? val[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106) {
          validCoords++;
        } else {
          badCoords++;
        }
      }
      coordsOk = hasValidShape && badCoords === 0;
      coordsInfo = `station-coords: schema=${hasValidShape ? 'ok' : 'invalid'}, ${validCoords} พิกัด (ผิดปกติ ${badCoords})`;
    } else {
      coordsInfo = 'ไม่พบ data/station-coords.json';
    }

    const ok = stations.length === 1484 && provSet.size === 77 && dupIds === 0 && coordsOk;
    record(
      '3. Data Integrity',
      ok,
      `stations=${stations.length}/1484, provinces=${provSet.size}/77, dupIds=${dupIds}, ${coordsInfo}`
    );
  } catch (err) {
    record('3. Data Integrity', false, err.message);
  }
}

/* 4) Internal Links Check */
function checkInternalLinks() {
  const htmlFiles = ['index.html', 'jurisdiction.html', 'map.html', 'qr-poster.html'];
  const missing = [];
  let checked = 0;

  for (const rel of htmlFiles) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      missing.push(`${rel} (ไม่พบหน้า HTML)`);
      continue;
    }
    const html = fs.readFileSync(abs, 'utf8');
    const re = /\b(?:href|src)=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const raw = m[1].trim();
      if (
        !raw ||
        raw.startsWith('#') ||
        raw.startsWith('http://') ||
        raw.startsWith('https://') ||
        raw.startsWith('mailto:') ||
        raw.startsWith('tel:') ||
        raw.startsWith('data:') ||
        raw.startsWith('about:') ||
        raw.startsWith('javascript:')
      ) {
        continue;
      }
      const cleanPath = raw.split('#')[0].split('?')[0];
      if (!cleanPath) continue;
      checked++;
      const target = cleanPath.startsWith('/')
        ? path.join(ROOT, cleanPath.slice(1))
        : path.resolve(path.dirname(abs), cleanPath);
      if (!fs.existsSync(target)) {
        missing.push(`${rel} → ${raw}`);
      }
    }
  }

  if (!missing.length) {
    record('4. Internal Links Check', true, `ตรวจ ${checked} ลิงก์ภายในใน ${htmlFiles.length} หน้า HTML ครบถ้วน`);
  } else {
    record('4. Internal Links Check', false, `ไม่พบปลายทาง: ${missing.join(', ')}`);
  }
}

/* 5) Forbidden Remnants Check */
function checkForbiddenRemnants() {
  const forbidden = ['parsePin', 'setPin', 'ps:scene', 'jtab=scene', 'incident-map'];
  const scanFiles = [
    'index.html',
    'jurisdiction.html',
    'map.html',
    'qr-poster.html',
    'sw.js',
    'worker.js',
    'assets/app.js',
    'assets/map.js',
    'assets/offline-db.js',
    'assets/styles.css',
  ];
  const hits = [];
  for (const rel of scanFiles) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf8');
    for (const token of forbidden) {
      if (content.includes(token)) {
        hits.push(`${rel} พบ "${token}"`);
      }
    }
  }
  if (!hits.length) {
    record('5. Forbidden Remnants Check', true, 'ไม่พบเศษโค้ดฟีเจอร์ปักหมุดที่ถูกลบ');
  } else {
    record('5. Forbidden Remnants Check', false, hits.join(' | '));
  }
}

function main() {
  console.log('=== PS Locator — Automated QA Verification ===');
  checkProtectedDataDiff();
  checkJsSyntax();
  checkDataIntegrity();
  checkInternalLinks();
  checkForbiddenRemnants();

  const failedCount = results.filter((r) => !r.ok).length;
  console.log('----------------------------------------------');
  console.log(`สรุปผล QA: ผ่าน ${results.length - failedCount}/${results.length} หมวด`);
  process.exit(failedCount === 0 ? 0 : 1);
}

main();
