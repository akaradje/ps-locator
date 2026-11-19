#!/usr/bin/env node
/**
 * PS Locator — Verify Read-Only Station Coordinate Registry (data/station-coords.json)
 * Checks:
 *  1. Valid JSON structure ({ meta: {...}, coords: {...} })
 *  2. Every station_id key in coords exists in official data/stations.json
 *  3. Every [lat, lng] pair is finite numbers within Thailand bounds (lat: 5.5–20.6, lng: 97.3–105.7)
 *  4. Reports coordinate coverage against total official stations (1,484)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const STATIONS_PATH = path.join(ROOT, 'data', 'stations.json');
const COORDS_PATH = path.join(ROOT, 'data', 'station-coords.json');

const TH_LAT_MIN = 5.5;
const TH_LAT_MAX = 20.6;
const TH_LNG_MIN = 97.3;
const TH_LNG_MAX = 105.7;

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
}

let stations;
try {
  stations = JSON.parse(fs.readFileSync(STATIONS_PATH, 'utf8'));
} catch (err) {
  fail(`ไม่สามารถอ่านไฟล์ ${STATIONS_PATH}: ${err.message}`);
}

if (!Array.isArray(stations) || stations.length === 0) {
  fail('data/stations.json ไม่มีข้อมูลสถานีที่ถูกต้อง');
}

const stationIds = new Set(stations.map((s) => String(s.id)));

let registry;
try {
  registry = JSON.parse(fs.readFileSync(COORDS_PATH, 'utf8'));
} catch (err) {
  fail(`ไม่สามารถอ่านหรือแปลง JSON ไฟล์ ${COORDS_PATH}: ${err.message}`);
}

if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
  fail('โครงสร้างรากของ data/station-coords.json ต้องเป็น JSON Object');
}

if (!registry.meta || typeof registry.meta !== 'object' || Array.isArray(registry.meta)) {
  fail('data/station-coords.json ต้องมีออบเจ็กต์ "meta"');
}

if (!registry.coords || typeof registry.coords !== 'object' || Array.isArray(registry.coords)) {
  fail('data/station-coords.json ต้องมีออบเจ็กต์ "coords"');
}

const errors = [];
const entries = Object.entries(registry.coords);

for (const [id, value] of entries) {
  if (!stationIds.has(String(id))) {
    errors.push(`station_id "${id}" ไม่พบใน data/stations.json`);
    continue;
  }
  if (!Array.isArray(value) || value.length < 2) {
    errors.push(`station_id "${id}" ต้องมีพิกัดรูปแบบ [lat, lng]`);
    continue;
  }
  const [lat, lng] = value;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    errors.push(`station_id "${id}" มีค่าพิกัดไม่ใช่ตัวเลขที่ถูกต้อง: ${JSON.stringify(value)}`);
    continue;
  }
  if (lat < TH_LAT_MIN || lat > TH_LAT_MAX || lng < TH_LNG_MIN || lng > TH_LNG_MAX) {
    errors.push(
      `station_id "${id}" มีพิกัด [${lat}, ${lng}] ออกนอกขอบเขตประเทศไทย (lat: ${TH_LAT_MIN}–${TH_LAT_MAX}, lng: ${TH_LNG_MIN}–${TH_LNG_MAX})`
    );
  }
}

const totalStations = stations.length;
const coordCount = entries.length;
const pct = ((coordCount / totalStations) * 100).toFixed(2);

console.log('=== PS Locator — Coordinate Registry Verification ===');
console.log(`ไฟล์พิกัดเสริม : data/station-coords.json (version ${registry.meta.version ?? 'N/A'})`);
console.log(`จำนวนสถานีทางการ : ${totalStations.toLocaleString('en-US')} แห่ง`);
console.log(`สถานีที่มีพิกัดยืนยัน : ${coordCount.toLocaleString('en-US')} / ${totalStations.toLocaleString('en-US')} แห่ง (${pct}%)`);

if (errors.length > 0) {
  console.error(`\nพบข้อผิดพลาด ${errors.length} รายการ:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('[PASS] โครงสร้าง JSON, station_id และขอบเขตพิกัดประเทศไทยถูกต้องทั้งหมด');
