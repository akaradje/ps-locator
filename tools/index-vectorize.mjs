#!/usr/bin/env node
/* ============================================================
   PS Locator — Gazette Chunking & Vectorize NDJSON Exporter
   อ่าน docs/gazette/2567.txt, docs/gazette/2568-2.txt และ data/stations.json
   สร้าง chunks ขนาด ~800-1,200 ตัวอักษรพร้อม overlap และ metadata ครบถ้วน
   การใช้งาน:
     node tools/index-vectorize.mjs --dry-run
     node tools/index-vectorize.mjs --out tmp/gazette-chunks.ndjson
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const GAZETTE_SOURCES = [
  {
    doc_code: '2567',
    label: 'ประกาศ ตร. 22 มี.ค. 2567',
    file: path.join(ROOT, 'docs', 'gazette', '2567.txt'),
    pdf_url: 'https://ratchakitcha.soc.go.th/documents/17187.pdf',
  },
  {
    doc_code: '2568-2',
    label: 'ประกาศ ตร. ฉบับที่ 2 · 22 ต.ค. 2568',
    file: path.join(ROOT, 'docs', 'gazette', '2568-2.txt'),
    pdf_url: 'https://ratchakitcha.soc.go.th/documents/91341.pdf',
  },
];

const STATIONS_FILE = path.join(ROOT, 'data', 'stations.json');
const TARGET_CHUNK_MIN = 800;
const TARGET_CHUNK_MAX = 1150;
const CHUNK_OVERLAP = 150;

function parseArgs(argv) {
  const opts = { dryRun: false, outFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--out') {
      opts.outFile = argv[i + 1] || '';
      i++;
    } else if (arg.startsWith('--out=')) {
      opts.outFile = arg.slice('--out='.length);
    }
  }
  return opts;
}

function normalizeText(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseGazettePages(rawText) {
  const pages = [];
  const re = /^=== PAGE (\d+) ===\s*$/gm;
  let match;
  const markers = [];
  while ((match = re.exec(rawText)) !== null) {
    markers.push({
      pageNumber: parseInt(match[1], 10),
      start: match.index + match[0].length,
      markerIndex: match.index,
    });
  }
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].markerIndex : rawText.length;
    const text = normalizeText(rawText.slice(cur.start, end));
    if (Number.isFinite(cur.pageNumber)) {
      pages.push({ page_number: cur.pageNumber, text });
    }
  }
  return pages;
}

function splitPageIntoChunks(pageText) {
  const clean = normalizeText(pageText);
  if (!clean) return [];
  if (clean.length <= TARGET_CHUNK_MAX) return [clean];

  const chunks = [];
  let start = 0;
  const len = clean.length;

  while (start < len) {
    let end = Math.min(start + TARGET_CHUNK_MAX, len);
    if (end < len) {
      /* หาจุดตัดที่เหมาะสมในช่วง [start + TARGET_CHUNK_MIN, end] */
      const slice = clean.slice(start, end);
      let cut = slice.lastIndexOf('\n');
      if (cut < TARGET_CHUNK_MIN) cut = slice.lastIndexOf(' ');
      if (cut >= TARGET_CHUNK_MIN) {
        end = start + cut;
      }
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= len) break;

    const nextStart = Math.max(start + 1, end - CHUNK_OVERLAP);
    start = nextStart;
  }

  return chunks;
}

function buildStationLookup(stations) {
  const lookup = [];
  for (const st of stations) {
    const full = String(st.name || '').normalize('NFC').trim();
    const short = full
      .replace(/^สถานีตำรวจนครบาล\s*/, '')
      .replace(/^สถานีตำรวจภูธร\s*/, '')
      .replace(/^สภ\.อ\.|^สภ\.|^สน\./, '')
      .trim();
    if (short.length >= 3) {
      lookup.push({
        id: String(st.id),
        full,
        short,
      });
    }
  }
  return lookup;
}

function detectStationIds(chunkText, lookup) {
  const ids = [];
  for (let i = 0; i < lookup.length; i++) {
    const item = lookup[i];
    if (chunkText.includes(item.full) || chunkText.includes('สถานีตำรวจภูธร ' + item.short) || chunkText.includes('สถานีตำรวจนครบาล ' + item.short) || chunkText.includes('สภ.' + item.short) || chunkText.includes('สน.' + item.short)) {
      ids.push(item.id);
      if (ids.length >= 12) break;
    }
  }
  return ids;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun && !opts.outFile) {
    console.error('การใช้งาน: node tools/index-vectorize.mjs --dry-run | --out <file.ndjson>');
    process.exit(1);
  }

  const stations = JSON.parse(fs.readFileSync(STATIONS_FILE, 'utf8'));
  const stationLookup = buildStationLookup(stations);

  const allRecords = [];
  const stats = [];

  for (const src of GAZETTE_SOURCES) {
    const raw = fs.readFileSync(src.file, 'utf8');
    const pages = parseGazettePages(raw);
    let docChunks = 0;
    let totalChars = 0;

    for (const pg of pages) {
      const pieces = splitPageIntoChunks(pg.text);
      for (let idx = 0; idx < pieces.length; idx++) {
        const text = pieces[idx];
        const id = `${src.doc_code}-p${pg.page_number}-c${idx + 1}`;
        const station_ids = detectStationIds(text, stationLookup);
        allRecords.push({
          id,
          text,
          doc_code: src.doc_code,
          label: src.label,
          page_number: pg.page_number,
          pdf_url: src.pdf_url,
          station_ids,
        });
        docChunks++;
        totalChars += text.length;
      }
    }

    stats.push({
      doc_code: src.doc_code,
      label: src.label,
      pages: pages.length,
      chunks: docChunks,
      avgChars: docChunks ? Math.round(totalChars / docChunks) : 0,
    });
  }

  console.log('=== สรุปการจัดเตรียมข้อมูลราชกิจจานุเบกษาสำหรับ Cloudflare Vectorize ===');
  console.log(`ฐานข้อมูลสถานีอ้างอิง: ${stations.length} สถานี`);
  for (const s of stats) {
    console.log(`- [${s.doc_code}] ${s.label}: ${s.pages} หน้า → ${s.chunks} chunks (เฉลี่ย ${s.avgChars} ตัวอักษร/chunk)`);
  }
  const totalPages = stats.reduce((sum, s) => sum + s.pages, 0);
  console.log(`รวมทั้งหมด: ${totalPages} หน้า → ${allRecords.length} chunks`);

  if (opts.dryRun) {
    console.log('[DRY-RUN] ไม่ได้เขียนไฟล์ออก (ใช้ --out <file.ndjson> เพื่อส่งออก)');
    return;
  }

  const outPath = path.resolve(process.cwd(), opts.outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ndjson = allRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(outPath, ndjson, 'utf8');
  console.log(`ส่งออก NDJSON สำเร็จ: ${outPath} (${allRecords.length} รายการ)`);
}

main();
