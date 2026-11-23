/* ============================================================
   PS Locator — App logic (Spatial Minimalist + สารบบ + เขตอำนาจ)
   Static, dependency-free.
   Data: window.STATIONS (data/stations.js),
         window.JURISDICTION (data/jurisdictions.js, lazy-loaded)
   ============================================================ */
'use strict';

/* ---------- Region metadata (ตร.แบ่ง 10 กองบัญชาการ) ---------- */
const REGIONS = [
  { id: 'all', short: 'ทั้งหมด', name: 'ทุกกองบัญชาการ' },
  { id: 'bkk', short: 'บช.น.', name: 'กองบัญชาการตำรวจนครบาล' },
  { id: 'p1',  short: 'ภ.1',   name: 'กองบัญชาการตำรวจภูธรภาค 1' },
  { id: 'p2',  short: 'ภ.2',   name: 'กองบัญชาการตำรวจภูธรภาค 2' },
  { id: 'p3',  short: 'ภ.3',   name: 'กองบัญชาการตำรวจภูธรภาค 3' },
  { id: 'p4',  short: 'ภ.4',   name: 'กองบัญชาการตำรวจภูธรภาค 4' },
  { id: 'p5',  short: 'ภ.5',   name: 'กองบัญชาการตำรวจภูธรภาค 5' },
  { id: 'p6',  short: 'ภ.6',   name: 'กองบัญชาการตำรวจภูธรภาค 6' },
  { id: 'p7',  short: 'ภ.7',   name: 'กองบัญชาการตำรวจภูธรภาค 7' },
  { id: 'p8',  short: 'ภ.8',   name: 'กองบัญชาการตำรวจภูธรภาค 8' },
  { id: 'p9',  short: 'ภ.9',   name: 'กองบัญชาการตำรวจภูธรภาค 9' },
];
const REGION_NAME = Object.fromEntries(REGIONS.map(r => [r.id, r.name]));
const REGION_SHORT = Object.fromEntries(REGIONS.map(r => [r.id, r.short]));
const REGION_ORDER = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));

const STATIONS = (window.STATIONS || []).slice();
const ST_BY_ID = new Map(STATIONS.map(s => [s.id, s]));
const PER_PAGE = 18;

/* ---------- State ---------- */
const state = {
  q: '',
  province: '',
  region: 'all',
  sort: 'region',
  page: 1,
  savedOnly: false,
  saved: new Set(),
};

try { state.saved = new Set(JSON.parse(localStorage.getItem('ps:saved') || '[]')); }
catch { state.saved = new Set(); }

const jurParams = { q: '', tab: 'jur' };

/* ---------- Helpers ---------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Normalize Thai text for exact-first search: NFC + strip สน./สภ./สภ.อ. prefixes + strip punctuation/whitespace */
function norm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/สถานีตำรวจ/g, '')
    .replace(/สภ\.อ\.|สน\.|สภ\./g, '')
    .replace(/[\s\-‐-―.,()\/\\]+/g, '');
}

/** Fold Thai diacritics, garun (พยัญชนะ+ทัณฑฆาต), and commonly swapped chars (ฎ/ฏ) for fuzzy fallback only */
function foldThai(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[ก-ฮ][\u0E34-\u0E3A]?\u0E4C/g, '')
    .replace(/[\u0E47-\u0E4E]/g, '')
    .replace(/ฏ/g, 'ฎ');
}

/* Official Thai police abbreviations & administrative prefixes */
const ABBR_REGION_MAP = Object.freeze({
  'กทม': 'bkk', 'บชน': 'bkk', 'นครบาล': 'bkk', 'bkk': 'bkk',
  'ภ1': 'p1', 'ภาค1': 'p1', 'ภูธรภาค1': 'p1', 'p1': 'p1',
  'ภ2': 'p2', 'ภาค2': 'p2', 'ภูธรภาค2': 'p2', 'p2': 'p2',
  'ภ3': 'p3', 'ภาค3': 'p3', 'ภูธรภาค3': 'p3', 'p3': 'p3',
  'ภ4': 'p4', 'ภาค4': 'p4', 'ภูธรภาค4': 'p4', 'p4': 'p4',
  'ภ5': 'p5', 'ภาค5': 'p5', 'ภูธรภาค5': 'p5', 'p5': 'p5',
  'ภ6': 'p6', 'ภาค6': 'p6', 'ภูธรภาค6': 'p6', 'p6': 'p6',
  'ภ7': 'p7', 'ภาค7': 'p7', 'ภูธรภาค7': 'p7', 'p7': 'p7',
  'ภ8': 'p8', 'ภาค8': 'p8', 'ภูธรภาค8': 'p8', 'p8': 'p8',
  'ภ9': 'p9', 'ภาค9': 'p9', 'ภูธรภาค9': 'p9', 'p9': 'p9',
});

const ABBR_EXPAND_MAP = Object.freeze({
  'กทม': 'กรุงเทพมหานคร',
  'กรุงเทพ': 'กรุงเทพมหานคร',
  'บชน': 'กรุงเทพมหานคร',
  'bkk': 'กรุงเทพมหานคร',
  'นครบาล': 'กรุงเทพมหานคร',
});

const REGION_ALIASES = Object.freeze({
  bkk: ['กทม', 'บชน', 'bkk', 'นครบาล', 'กรุงเทพ', 'กรุงเทพมหานคร'],
  p1: ['ภ1', 'p1', 'ภาค1', 'ภูธรภาค1'],
  p2: ['ภ2', 'p2', 'ภาค2', 'ภูธรภาค2'],
  p3: ['ภ3', 'p3', 'ภาค3', 'ภูธรภาค3'],
  p4: ['ภ4', 'p4', 'ภาค4', 'ภูธรภาค4'],
  p5: ['ภ5', 'p5', 'ภาค5', 'ภูธรภาค5'],
  p6: ['ภ6', 'p6', 'ภาค6', 'ภูธรภาค6'],
  p7: ['ภ7', 'p7', 'ภาค7', 'ภูธรภาค7'],
  p8: ['ภ8', 'p8', 'ภาค8', 'ภูธรภาค8'],
  p9: ['ภ9', 'p9', 'ภาค9', 'ภูธรภาค9'],
});

/* Single Intl.Segmenter instance reused across boot and queries (with whitespace fallback) */
const TH_SEGMENTER = (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function')
  ? new Intl.Segmenter('th', { granularity: 'word' })
  : null;

function stripAdminPrefix(s) {
  return String(s ?? '').replace(/^(?:สภ\.อ\.|สภ\.|สน\.|จว\.|ต\.|อ\.|ถ\.|ซ\.)/u, '');
}

function segmentWords(raw) {
  const text = String(raw ?? '').normalize('NFC').trim();
  if (!text) return [];
  const out = [];
  if (TH_SEGMENTER) {
    for (const seg of TH_SEGMENTER.segment(text)) {
      if (!seg.isWordLike) continue;
      const w = norm(stripAdminPrefix(seg.segment));
      if (w.length >= 2) out.push(w);
    }
  } else {
    for (const part of text.split(/\s+/)) {
      const w = norm(stripAdminPrefix(part));
      if (w.length >= 2) out.push(w);
    }
  }
  return out;
}

/* Pre-allocated buffers for bounded Damerau-Levenshtein (avoids per-call allocations) */
let _dlPrev2 = new Int32Array(64);
let _dlPrev1 = new Int32Array(64);
let _dlCurr  = new Int32Array(64);

/** Bounded Damerau-Levenshtein distance with length and row-min early exit */
function boundedDL(a, b, maxDist) {
  const al = a.length, bl = b.length;
  if (a === b) return 0;
  if (Math.abs(al - bl) > maxDist) return maxDist + 1;
  if (al === 0) return bl <= maxDist ? bl : maxDist + 1;
  if (bl === 0) return al <= maxDist ? al : maxDist + 1;

  if (bl + 1 > _dlCurr.length) {
    const sz = Math.max(bl + 1, _dlCurr.length * 2);
    _dlPrev2 = new Int32Array(sz);
    _dlPrev1 = new Int32Array(sz);
    _dlCurr  = new Int32Array(sz);
  }
  let p2 = _dlPrev2, p1 = _dlPrev1, cur = _dlCurr;
  for (let j = 0; j <= bl; j++) p1[j] = j;

  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let val = p1[j] + 1;
      const ins = cur[j - 1] + 1;
      if (ins < val) val = ins;
      const sub = p1[j - 1] + cost;
      if (sub < val) val = sub;
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        const trans = p2[j - 2] + 1;
        if (trans < val) val = trans;
      }
      cur[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
    const tmp = p2; p2 = p1; p1 = cur; cur = tmp;
  }
  return p1[bl] <= maxDist ? p1[bl] : maxDist + 1;
}

/* Precomputed normalized + segmented + folded haystack per station (built once at boot). */
const HAY = new Map();
for (const st of STATIONS) {
  const name = norm(st.name);
  const addr = norm(st.address);
  const prov = norm(st.province_th);
  const phone = norm(st.phone);
  const region = norm(REGION_SHORT[st.region] || '');
  const aliases = REGION_ALIASES[st.region] || [];
  const aliasStr = aliases.join('|');
  const tokSet = new Set();
  for (const w of segmentWords(st.name + ' ' + st.province_th)) tokSet.add(w);
  const tokens = [...tokSet];
  const foldedTokSet = new Set();
  for (const w of tokens) {
    const fw = foldThai(w);
    if (fw.length >= 3) foldedTokSet.add(fw);
  }
  const tokensFold = [...foldedTokSet];
  HAY.set(st.id, {
    name,
    addr,
    prov,
    phone,
    region,
    regionId: st.region || '',
    aliasStr,
    nameProv: name + '|' + prov + '|' + region + '|' + aliasStr,
    full: name + '|' + prov + '|' + addr + '|' + phone + '|' + region + '|' + aliasStr,
    nameFold: foldThai(name),
    provFold: foldThai(prov),
    tokens,
    tokensFold,
  });
}

const PROVINCES = (() => {
  const m = new Map();
  for (const st of STATIONS) m.set(st.province_th, (m.get(st.province_th) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'th'));
})();

/** Prepare parsed query context once per search (reused across all 1,484 stations) */
function prepareQuery(raw) {
  const rawTrim = String(raw ?? '').normalize('NFC').trim();
  const stripped = rawTrim.split(/\s+/).map(stripAdminPrefix).join(' ').trim();
  const qNorm = norm(stripped || rawTrim);
  if (!qNorm) return null;

  const qFold = foldThai(qNorm);
  const regionId = ABBR_REGION_MAP[qNorm] || '';
  const expanded = ABBR_EXPAND_MAP[qNorm] || '';

  /* Multi-token exact terms: prefer whitespace-split tokens, else Intl.Segmenter words */
  const wsParts = rawTrim.split(/\s+/).filter(Boolean);
  const hasSpaces = wsParts.length >= 2;
  let rawTokens = [];
  if (hasSpaces) {
    for (const p of wsParts) {
      const t = norm(stripAdminPrefix(p));
      if (t) rawTokens.push(t);
    }
  } else {
    const segs = segmentWords(stripped || rawTrim);
    if (segs.length >= 2) rawTokens = segs;
  }

  const tokens = rawTokens.length >= 2
    ? rawTokens.map(t => ({
        raw: t,
        regionId: ABBR_REGION_MAP[t] || '',
        expanded: ABBR_EXPAND_MAP[t] || '',
      }))
    : [];

  const maxDist = qNorm.length >= 7 ? 2 : (qNorm.length >= 4 ? 1 : 0);
  const maxDistFold = qFold.length >= 7 ? 2 : (qFold.length >= 4 ? 1 : 0);

  return { rawTrim, qNorm, qFold, regionId, expanded, tokens, hasSpaces, maxDist, maxDistFold };
}

/**
 * Strict Exact-First scoring for a station:
 *  Tier 0 (0-1): Exact / Prefix match on station name
 *  Tier 1 (2-6): Exact substring match (name -> province -> address -> phone/region/abbr)
 *  Tier 2 (7-8): Multi-token exact match across name/province/address/region/abbr
 *  Tier 3 (10+): Fuzzy fallback (Thai diacritic/garun folding + bounded Damerau-Levenshtein)
 *  Returns -1 when no match.
 */
function scoreStation(st, qCtx) {
  if (!qCtx) return 0;
  const h = HAY.get(st.id);
  if (!h) return -1;
  const { qNorm, qFold, regionId, expanded, tokens, hasSpaces, maxDist, maxDistFold } = qCtx;

  /* Tier 0: Exact / Prefix on station name */
  if (h.name === qNorm) return 0;
  if (h.name.startsWith(qNorm)) return 1;

  /* Tier 1: Exact substring & official abbreviation match */
  if (h.name.includes(qNorm)) return 2;
  if (h.prov === qNorm || h.prov.startsWith(qNorm)) return 3;
  if (h.prov.includes(qNorm)) return 4;
  if (h.addr.includes(qNorm)) return 5;
  if (
    h.phone.includes(qNorm) ||
    h.region === qNorm ||
    h.region.includes(qNorm) ||
    (regionId && h.regionId === regionId) ||
    (expanded && (h.prov.includes(expanded) || h.aliasStr.includes(qNorm)))
  ) return 6;

  /* Tier 2: Multi-token exact match (e.g. "เมือง ชุมพร", "บางรัก กทม") */
  if (tokens.length >= 2) {
    let allInNameProv = true;
    let allInFull = true;
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      const inNP = h.nameProv.includes(tk.raw) ||
        (tk.regionId && h.regionId === tk.regionId) ||
        (tk.expanded && h.prov.includes(tk.expanded));
      if (!inNP) {
        allInNameProv = false;
        if (!hasSpaces) { allInFull = false; break; }
        const inFull = h.addr.includes(tk.raw) || h.phone.includes(tk.raw);
        if (!inFull) { allInFull = false; break; }
      }
    }
    if (allInFull) return allInNameProv ? 7 : 8;
  }

  /* Tier 3: Fuzzy & typo-tolerant fallback (only when qNorm.length >= 3) */
  if (qNorm.length >= 3) {
    /* 3A: Diacritic / garun / ฎ-ฏ folding */
    if (qFold.length >= 3) {
      if (h.nameFold === qFold) return 10;
      if (h.nameFold.startsWith(qFold)) return 11;
      if (h.nameFold.includes(qFold)) return 12;
      if (h.provFold.includes(qFold)) return 13;
    }

    /* 3B: Bounded Damerau-Levenshtein (4-6 chars: maxDist 1, >=7 chars: maxDist 2) */
    if (maxDist > 0) {
      const qLen = qNorm.length;
      const qfLen = qFold.length;
      const qDiffFold = qFold !== qNorm;

      if (Math.abs(qLen - h.name.length) <= maxDist) {
        const dName = boundedDL(qNorm, h.name, maxDist);
        if (dName <= maxDist) return 14 + dName;
      }
      if (maxDistFold > 0 && (qDiffFold || h.nameFold !== h.name) && Math.abs(qfLen - h.nameFold.length) <= maxDistFold) {
        const dNameF = boundedDL(qFold, h.nameFold, maxDistFold);
        if (dNameF <= maxDistFold) return 14 + dNameF;
      }

      if (Math.abs(qLen - h.prov.length) <= maxDist) {
        const dProv = boundedDL(qNorm, h.prov, maxDist);
        if (dProv <= maxDist) return 17 + dProv;
      }
      if (maxDistFold > 0 && (qDiffFold || h.provFold !== h.prov) && Math.abs(qfLen - h.provFold.length) <= maxDistFold) {
        const dProvF = boundedDL(qFold, h.provFold, maxDistFold);
        if (dProvF <= maxDistFold) return 17 + dProvF;
      }

      for (let i = 0; i < h.tokens.length; i++) {
        const tok = h.tokens[i];
        if (Math.abs(qLen - tok.length) <= maxDist) {
          const dTok = boundedDL(qNorm, tok, maxDist);
          if (dTok <= maxDist) return 20 + dTok;
        }
      }
      if (maxDistFold > 0 && qDiffFold) {
        for (let i = 0; i < h.tokensFold.length; i++) {
          const tokF = h.tokensFold[i];
          if (Math.abs(qfLen - tokF.length) <= maxDistFold) {
            const dTokF = boundedDL(qFold, tokF, maxDistFold);
            if (dTokF <= maxDistFold) return 20 + dTokF;
          }
        }
      }
    }
  }

  return -1;
}

function stationMatches(st, qOrCtx) {
  if (!qOrCtx) return true;
  const ctx = typeof qOrCtx === 'string' ? prepareQuery(qOrCtx) : qOrCtx;
  if (!ctx) return true;
  return scoreStation(st, ctx) >= 0;
}

function compareBySort(a, b) {
  switch (state.sort) {
    case 'name':
      return a.name.localeCompare(b.name, 'th');
    case 'province':
      return a.province_th.localeCompare(b.province_th, 'th') || a.name.localeCompare(b.name, 'th');
    case 'region':
    default:
      return (REGION_ORDER[a.region] - REGION_ORDER[b.region]) ||
        a.province_th.localeCompare(b.province_th, 'th') ||
        a.name.localeCompare(b.name, 'th');
  }
}

function getFiltered() {
  const qCtx = prepareQuery(state.q);
  if (!qCtx) {
    const list = STATIONS.filter(st =>
      (!state.province || st.province_th === state.province) &&
      (state.region === 'all' || st.region === state.region) &&
      (!state.savedOnly || state.saved.has(st.id))
    );
    list.sort(compareBySort);
    return list;
  }
  const scored = [];
  for (let i = 0; i < STATIONS.length; i++) {
    const st = STATIONS[i];
    if (state.province && st.province_th !== state.province) continue;
    if (state.region !== 'all' && st.region !== state.region) continue;
    if (state.savedOnly && !state.saved.has(st.id)) continue;
    const sc = scoreStation(st, qCtx);
    if (sc >= 0) scored.push({ st, sc });
  }
  /* Strict Exact-First: sort by tier bucket (Exact/Token < 10 before Fuzzy >= 10), then exact score, then state.sort */
  scored.sort((a, b) => a.sc - b.sc || compareBySort(a.st, b.st));
  return scored.map(x => x.st);
}

function formatPhoneDisplay(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 9) return d.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{3})(\d{4,5})/, '$1-$2-$3');
  return p;
}

const mapsLink = (st) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(st.name + ' ' + (st.address || st.province_th));
const mapsEmbed = (st) => 'https://www.google.com/maps?q=' + encodeURIComponent(st.name + ' ' + (st.address || st.province_th)) + '&output=embed';

function hl(text, qRaw) {
  const t = String(text ?? '');
  const raw = String(qRaw ?? '').trim();
  if (!raw) return esc(t);
  const lower = t.toLowerCase();

  const needles = [];
  const seen = new Set();
  const pushNeedle = (s) => {
    const n = String(s ?? '').trim().toLowerCase();
    if (!n || seen.has(n)) return;
    seen.add(n);
    needles.push(n);
  };
  pushNeedle(raw);
  const parts = raw.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    const clean = stripAdminPrefix(p).trim();
    if (clean.length >= 2) pushNeedle(clean);
    const exp = ABBR_EXPAND_MAP[norm(clean)];
    if (exp) pushNeedle(exp);
  }
  if (parts.length === 1) {
    for (const w of segmentWords(raw)) {
      if (w.length >= 2) pushNeedle(w);
    }
  }

  const ranges = [];
  for (const needle of needles) {
    let idx = lower.indexOf(needle);
    let count = 0;
    while (idx !== -1 && count < 8 && ranges.length < 24) {
      ranges.push([idx, idx + needle.length]);
      idx = lower.indexOf(needle, idx + needle.length);
      count++;
    }
  }
  if (!ranges.length) return esc(t);

  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = ranges[i];
    if (cur[0] <= prev[1]) {
      if (cur[1] > prev[1]) prev[1] = cur[1];
    } else {
      merged.push(cur);
    }
  }

  let out = '', pos = 0;
  for (const [a, b] of merged) {
    out += esc(t.slice(pos, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>';
    pos = b;
  }
  return out + esc(t.slice(pos));
}

/* ---------- Spatial Canvas (dot-matrix + pointer pull + pulses) ---------- */
const canvas = $('#spatial-canvas');
const ctx = canvas && canvas.getContext('2d');
const pointer = { x: -9999, y: -9999, active: false };
const pulses = [];
let width = 0, height = 0, dpr = 1, gridCols = 0, gridRows = 0;
const spacing = 38;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const searchCapsule = $('#searchCapsule');
const capsuleTilt = $('#capsuleTilt');
const suggestPanel = $('#suggestPanel');
let selected = null;

function resizeCanvas() {
  if (!canvas || !ctx) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gridCols = Math.ceil(width / spacing) + 1;
  gridRows = Math.ceil(height / spacing) + 1;
}

function emitCapsulePulse(strength = 0.7, maxRadius) {
  if (reducedMotion.matches) return;
  const target = searchCapsule || $('#jurCapsule');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  pulses.push({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    r: 12,
    maxR: maxRadius || Math.max(width, height) * 0.72,
    strength,
  });
  if (pulses.length > 5) pulses.shift();
}

function renderSpatialField() {
  if (ctx && !document.hidden) {
    ctx.clearRect(0, 0, width, height);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const dot = isLight ? [71, 85, 105] : [148, 163, 184];
    const pulseCol = isLight ? [2, 132, 199] : [56, 189, 248];
    const baseAlpha = (document.body.classList.contains('has-results') || document.body.classList.contains('page-jur')) ? 0.09 : 0.16;

    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].r += 8.5;
      if (pulses[i].r > pulses[i].maxR) pulses.splice(i, 1);
    }
    const offsetX = (width - (gridCols - 1) * spacing) * 0.5;
    const offsetY = (height - (gridRows - 1) * spacing) * 0.5;
    for (let row = 0; row < gridRows; row++) {
      const baseY = offsetY + row * spacing;
      for (let col = 0; col < gridCols; col++) {
        const baseX = offsetX + col * spacing;
        let drawX = baseX, drawY = baseY, alpha = baseAlpha, radius = 1.15, tint = 0;
        if (pointer.active && !reducedMotion.matches) {
          const dx = baseX - pointer.x, dy = baseY - pointer.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 36100 && distSq > 0.1) {
            const dist = Math.sqrt(distSq), factor = 1 - dist / 190, pull = factor * factor * 9;
            drawX -= dx / dist * pull;
            drawY -= dy / dist * pull;
            alpha += factor * 0.36;
            radius += factor * 1.1;
            tint = Math.max(tint, factor * 0.85);
          }
        }
        for (let p = 0; p < pulses.length; p++) {
          const pu = pulses[p];
          const band = Math.abs(Math.hypot(baseX - pu.x, baseY - pu.y) - pu.r);
          if (band < 46) {
            const wave = (1 - band / 46) * (1 - pu.r / pu.maxR) * pu.strength;
            alpha += wave * 0.55;
            radius += wave * 1.4;
            tint = Math.max(tint, wave);
          }
        }
        const r = Math.round(dot[0] + (pulseCol[0] - dot[0]) * tint);
        const g = Math.round(dot[1] + (pulseCol[1] - dot[1]) * tint);
        const b = Math.round(dot[2] + (pulseCol[2] - dot[2]) * tint);
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(alpha, 0.88).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  requestAnimationFrame(renderSpatialField);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(renderSpatialField);

window.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.active = true;
  if (searchCapsule) {
    const r = searchCapsule.getBoundingClientRect();
    searchCapsule.style.setProperty('--spot-x', `${e.clientX - r.left}px`);
    searchCapsule.style.setProperty('--spot-y', `${e.clientY - r.top}px`);
    const suggestOpen = suggestPanel && !suggestPanel.hidden;
    if (!document.body.classList.contains('has-results') && !suggestOpen && !reducedMotion.matches) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist < 360) {
        const rotY = (e.clientX - cx) / 360 * 3.2;
        const rotX = -((e.clientY - cy) / 360) * 3.2;
        if (capsuleTilt) capsuleTilt.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
        return;
      }
    }
    if (capsuleTilt) capsuleTilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
  }
}, { passive: true });

/* ---------- Theme (dark / light) ---------- */
function applyTheme(t, persist = true) {
  document.documentElement.dataset.theme = t;
  if (persist) {
    try { localStorage.setItem('ps:theme', t); } catch { /* private mode */ }
  }
  const sun = $('#theme-icon-sun'), moon = $('#theme-icon-moon');
  if (sun && moon) {
    sun.style.display = t === 'light' ? 'none' : '';
    moon.style.display = t === 'dark' ? 'none' : '';
  }
  const btn = $('#themeToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.setAttribute('aria-label', t === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด');
    btn.title = t === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';
  }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#05070c' : '#f7f9fc';
}

/* ---------- Toast + Clipboard + Envelope Copy ---------- */
let toastTimer;
function showToast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

const hasAddress = (st) => !!(st && String(st.address || '').trim());
function envelopeCopyText(st) {
  const a = String(st.address || '').trim();
  return a ? `${st.name}\n${a}` : st.name;
}
const reportURL = (st) => 'mailto:akaradje07@gmail.com?subject=' +
  encodeURIComponent('แจ้งที่อยู่ไม่ถูกต้อง — ' + st.name) + '&body=' +
  encodeURIComponent(`สถานี: ${st.name}\nจังหวัด: ${st.province_th}\nที่อยู่จากระบบ: ${st.address || 'ไม่มีข้อมูล'}\n\nที่อยู่ที่ถูกต้องควรเป็น:\n`);

async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg || 'คัดลอกลงคลิปบอร์ดแล้ว');
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    showToast(ok ? (successMsg || 'คัดลอกลงคลิปบอร์ดแล้ว') : 'คัดลอกไม่สำเร็จ — เปิดกล่องให้กดคัดลอกเอง');
    return ok;
  }
}

function flashCopied(btn) {
  if (!btn) return;
  const label = $('#copyAddrText', btn);
  if (!btn._origContent) btn._origContent = label ? label.textContent : btn.innerHTML;
  btn.classList.add('is-copied');
  if (label) label.textContent = 'คัดลอกแล้ว ✓';
  else if (btn.classList.contains('sug-copy')) btn.innerHTML = icon.check;
  else btn.textContent = 'คัดลอกแล้ว ✓';
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove('is-copied');
    if (label) label.textContent = btn._origContent;
    else btn.innerHTML = btn._origContent;
  }, 2400);
}

let manualCopyEl = null;
function closeManualCopy() {
  if (!manualCopyEl) return;
  const el = manualCopyEl, restore = el._restore;
  manualCopyEl = null;
  el.remove();
  if (restore && restore.focus) restore.focus();
}

function openManualCopy(text) {
  closeManualCopy();
  const restore = document.activeElement;
  const ov = document.createElement('div');
  ov.className = 'manual-copy';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-labelledby', 'manualCopyTitle');
  ov.innerHTML = `
    <div class="manual-copy-box">
      <div class="manual-copy-head">
        <div><h2 id="manualCopyTitle">คัดลอกที่อยู่ด้วยตนเอง</h2>
        <p>เบราว์เซอร์นี้ไม่อนุญาตให้คัดลอกอัตโนมัติ — กดปุ่มด้านล่างแล้วใช้ Ctrl+C (หรือแตะข้อความค้างแล้วเลือก “คัดลอก”)</p></div>
        <button type="button" class="modal-close" id="manualCopyClose" aria-label="ปิดกล่องคัดลอก">×</button>
      </div>
      <textarea id="manualCopyText" readonly aria-label="ข้อความที่อยู่ที่เลือกไว้แล้ว"></textarea>
      <div class="manual-copy-foot"><button type="button" class="btn btn-primary" id="manualCopySelect">เลือกข้อความอีกครั้ง</button></div>
    </div>`;
  document.body.appendChild(ov);
  manualCopyEl = ov;
  ov._restore = restore;
  const ta = $('#manualCopyText', ov);
  ta.value = text;
  const selectAll = () => { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); };
  $('#manualCopyClose', ov).addEventListener('click', closeManualCopy);
  $('#manualCopySelect', ov).addEventListener('click', selectAll);
  ov.addEventListener('click', (e) => { if (e.target === ov) closeManualCopy(); });
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeManualCopy(); return; }
    if (e.key !== 'Tab') return;
    const first = $('#manualCopyClose', ov), last = $('#manualCopySelect', ov);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  selectAll();
}

async function copyStation(st, btn) {
  if (!st) return false;
  if (!hasAddress(st)) {
    showToast(`${st.name} ยังไม่มีที่อยู่จากต้นทาง — กรุณาแจ้งที่อยู่`);
    return false;
  }
  const text = envelopeCopyText(st);
  const ok = await copyText(text, `คัดลอกที่อยู่ ${st.name} · ${st.province_th} แล้ว`);
  if (ok) { if (btn) flashCopied(btn); }
  else openManualCopy(text);
  return ok;
}

async function shareOrCopy({ title, text, url }) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
    }
  }
  return copyText(url, 'คัดลอกลิงก์สำหรับแชร์แล้ว');
}

function stationShareUrl(st) {
  try {
    const u = new URL(window.location.origin + '/');
    u.searchParams.set('id', String(st.id));
    return u.toString();
  } catch {
    return `?id=${encodeURIComponent(st.id)}`;
  }
}

function jurShareUrl(q, tab = 'jur') {
  try {
    const u = new URL('jurisdiction.html', window.location.href);
    u.search = '';
    u.hash = '';
    if (q) u.searchParams.set('j', q);
    u.searchParams.set('jtab', tab || 'jur');
    return u.toString();
  } catch {
    return `jurisdiction.html?j=${encodeURIComponent(q || '')}&jtab=${encodeURIComponent(tab || 'jur')}`;
  }
}

/* ---------- Icons (for cards / badges) ---------- */
const icon = {
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M4 16V5a2 2 0 0 1 2-2h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

/* ---------- Visitor Counter (D1 via /api/visit) ---------- */
async function trackVisit() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') return;
  try {
    const res = await fetch('/api/visit', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    const viewsEl = $('#statViews'), visEl = $('#statVisitors'), wrap = $('#visitorCounter');
    if (viewsEl && typeof data.views === 'number') viewsEl.textContent = data.views.toLocaleString('th-TH');
    if (visEl && typeof data.visitors === 'number') visEl.textContent = data.visitors.toLocaleString('th-TH');
    if (wrap && typeof data.visitors === 'number') {
      wrap.title = `ผู้เข้าชมไม่ซ้ำรายวัน ${data.visitors.toLocaleString('th-TH')} คน`;
    }
  } catch { /* offline or static host */ }
}

/* ---------- Saved Stations (ps:saved) ---------- */
function saveState() {
  try { localStorage.setItem('ps:saved', JSON.stringify([...state.saved])); } catch { /* private mode */ }
}

function updateSavedUI() {
  const n = state.saved.size;
  const count = $('#savedCount');
  if (count) count.textContent = n;
  const wrap = $('#savedCountWrap');
  if (wrap) wrap.hidden = n === 0 && !state.savedOnly;
  const toggle = $('#toggleSavedOnly');
  if (toggle) toggle.setAttribute('aria-pressed', String(state.savedOnly));
  const idleBtn = $('#idleSavedBtn'), idleCnt = $('#idleSavedCount');
  if (idleCnt) idleCnt.textContent = n;
  if (idleBtn) idleBtn.hidden = n === 0;
}

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
  saveState();
  updateSavedUI();
  if ($('#resultsList') && document.body.classList.contains('has-results')) {
    renderResults();
    if (selected && selected.id === id) selectStation(selected);
  }
}

/* ---------- Province Combobox ---------- */
const comboState = { open: false, active: -1, items: [] };

function updateProvinceLabel() {
  const el = $('#provinceLabel');
  if (!el) return;
  el.textContent = state.province
    ? `${state.province} (${PROVINCES.find(p => p.name === state.province)?.count || 0})`
    : `ทุกจังหวัด (${PROVINCES.length})`;
}

function renderComboList(filterRaw) {
  const fn = norm(filterRaw);
  const opts = [{ value: '', label: 'ทุกจังหวัด', count: STATIONS.length }]
    .concat(PROVINCES.filter(p => !fn || norm(p.name).includes(fn)).map(p => ({ value: p.name, label: p.name, count: p.count })));
  comboState.items = opts;
  comboState.active = -1;
  const list = $('#provinceList');
  const search = $('#provinceSearch');
  if (!list || !search) return;
  search.removeAttribute('aria-activedescendant');
  if (!opts.length) {
    list.innerHTML = '<li class="combo-empty">ไม่พบจังหวัดที่ค้นหา</li>';
    return;
  }
  list.innerHTML = opts.map((o, i) =>
    `<li class="combo-opt" role="option" id="prov-${i}" data-province="${esc(o.value)}" aria-selected="${o.value === state.province}"><span>${esc(o.label)}</span><span class="cnt">${o.count.toLocaleString('th-TH')}</span></li>`
  ).join('');
}

function moveComboActive(delta) {
  const list = $('#provinceList'), search = $('#provinceSearch');
  if (!list || !search) return;
  const rows = $$('.combo-opt', list);
  if (!rows.length) return;
  let next = comboState.active + delta;
  if (next < 0) next = rows.length - 1;
  if (next >= rows.length) next = 0;
  comboState.active = next;
  rows.forEach((r, i) => r.classList.toggle('active', i === next));
  rows[next].scrollIntoView({ block: 'nearest' });
  search.setAttribute('aria-activedescendant', rows[next].id);
}

function openCombo() {
  const pop = $('#provincePop'), btn = $('#provinceBtn'), search = $('#provinceSearch');
  if (!pop || !btn || !search) return;
  comboState.open = true;
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  search.value = '';
  renderComboList('');
  search.focus();
  const sel = $('#provinceList [aria-selected="true"]');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function closeCombo(refocus = true) {
  if (!comboState.open) return;
  comboState.open = false;
  const pop = $('#provincePop'), btn = $('#provinceBtn'), search = $('#provinceSearch');
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (search) search.removeAttribute('aria-activedescendant');
  if (refocus && btn) btn.focus();
}

function setProvince(v) {
  state.province = v;
  updateProvinceLabel();
  closeCombo(true);
  state.page = 1;
  setResultsState(true);
  renderResults();
}

/* ---------- Suggestions (Station Page) ---------- */
let sugState = { items: [], active: -1, total: 0 };

function getSuggestions(raw) {
  const qCtx = prepareQuery(raw);
  if (!qCtx) return { items: [], total: 0 };
  const scored = [];
  for (let i = 0; i < STATIONS.length; i++) {
    const st = STATIONS[i];
    const score = scoreStation(st, qCtx);
    if (score >= 0) scored.push({ st, score });
  }
  /* Strict Exact-First: Tier 0-2 (< 10) always rank above Fuzzy Tier 3 (>= 10) */
  scored.sort((a, b) => a.score - b.score || a.st.name.localeCompare(b.st.name, 'th'));
  return { items: scored.slice(0, 8), total: scored.length };
}

function renderSuggest(raw) {
  const input = $('#searchInput');
  if (!suggestPanel || !input) return;
  const v = String(raw || '').trim();
  if (!v) return closeSuggest();
  const { items, total } = getSuggestions(v);
  sugState = { items, active: -1, total };
  input.removeAttribute('aria-activedescendant');
  if (!items.length) {
    suggestPanel.innerHTML = `<div class="sug-empty">ไม่พบสถานีที่ตรงกับ “${esc(v)}” — ลองใช้คำค้นที่สั้นลง</div>`;
  } else {
    suggestPanel.innerHTML = '<div class="suggest-list">' + items.map((it, i) => {
      const st = it.st;
      const addr = hasAddress(st);
      return `<div class="sug-row" role="option" id="sug-${i}" data-id="${st.id}" aria-selected="false">
        <span class="sug-name">${hl(st.name, v)}</span>
        <span class="sug-phone">${esc(formatPhoneDisplay(st.phone) || '—')}</span>
        <span class="sug-sub">${esc(st.province_th)} · ${esc(REGION_SHORT[st.region] || '-')}${addr ? '' : ' · <b class="na-badge">ไม่มีที่อยู่</b>'}</span>
        ${addr
          ? `<button type="button" class="sug-copy" data-copy="${st.id}" aria-label="คัดลอกที่อยู่ ${esc(st.name)}" title="คัดลอกที่อยู่ · Ctrl+Enter">${icon.copy}</button>`
          : `<span class="sug-copy sug-copy-na" title="ต้นทางยังไม่มีที่อยู่">${icon.copy}</span>`}
      </div>`;
    }).join('') + `</div><div class="sug-foot"><span>จับคู่ได้ ${total.toLocaleString('th-TH')} สถานี</span><button type="button" id="sugAll">ดูผลลัพธ์ทั้งหมด →</button></div>`;
  }
  suggestPanel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  if (capsuleTilt) capsuleTilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
}

function closeSuggest() {
  if (suggestPanel) suggestPanel.hidden = true;
  sugState.active = -1;
  const i = $('#searchInput');
  if (i) { i.setAttribute('aria-expanded', 'false'); i.removeAttribute('aria-activedescendant'); }
}

function moveSug(delta) {
  if (!suggestPanel) return;
  const rows = $$('.sug-row', suggestPanel);
  if (!rows.length) return;
  let next = sugState.active + delta;
  if (next < 0) next = rows.length - 1;
  if (next >= rows.length) next = 0;
  sugState.active = next;
  rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === next)));
  rows[next].scrollIntoView({ block: 'nearest' });
  $('#searchInput')?.setAttribute('aria-activedescendant', rows[next].id);
}

/* ---------- Station Workspace (HUD 2-Column) ---------- */
function setResultsState(on) {
  document.body.classList.toggle('has-results', !!on);
}

function scanStart() {
  document.body.classList.add('is-scanning');
  emitCapsulePulse(0.9, Math.max(width, height) * 0.85);
  clearTimeout(scanStart._t);
  scanStart._t = setTimeout(() => document.body.classList.remove('is-scanning'), 900);
}

function regionCounts() {
  const qCtx = prepareQuery(state.q);
  const counts = { all: 0 };
  for (const r of REGIONS) if (r.id !== 'all') counts[r.id] = 0;
  for (let i = 0; i < STATIONS.length; i++) {
    const st = STATIONS[i];
    if (qCtx && scoreStation(st, qCtx) < 0) continue;
    if (state.province && st.province_th !== state.province) continue;
    if (state.savedOnly && !state.saved.has(st.id)) continue;
    counts.all++;
    counts[st.region] = (counts[st.region] || 0) + 1;
  }
  return counts;
}

function renderRegionChips() {
  const box = $('#regionChips');
  if (!box) return;
  const counts = regionCounts();
  box.innerHTML = REGIONS.map(r =>
    `<button type="button" class="rchip" data-region="${esc(r.id)}" aria-pressed="${r.id === state.region}" title="${esc(r.name)}">${esc(r.short)}<span class="cnt">${(counts[r.id] || 0).toLocaleString('th-TH')}</span></button>`
  ).join('');
}

function renderActiveFilters() {
  const box = $('#activeFilters');
  if (!box) return;
  const tags = [];
  if (state.q) tags.push({ label: `ค้นหา: “${state.q}”`, clear: () => { state.q = ''; const i = $('#searchInput'); if (i) i.value = ''; $('#searchHub')?.classList.remove('has-value'); } });
  if (state.province) tags.push({ label: `จังหวัด: ${state.province}`, clear: () => { state.province = ''; updateProvinceLabel(); } });
  if (state.region !== 'all') tags.push({ label: REGION_NAME[state.region], clear: () => { state.region = 'all'; } });
  if (state.savedOnly) tags.push({ label: 'เฉพาะที่บันทึก', clear: () => { state.savedOnly = false; $('#toggleSavedOnly')?.setAttribute('aria-pressed', 'false'); } });
  box.innerHTML = tags.map((t, i) => `<span class="filter-tag">${esc(t.label)}<button type="button" data-clear="${i}" aria-label="ล้างตัวกรองนี้">✕</button></span>`).join('');
  box.querySelectorAll('[data-clear]').forEach(btn => btn.addEventListener('click', () => {
    tags[+btn.dataset.clear].clear();
    state.page = 1;
    renderResults();
  }));
}

function renderPagination(totalPages, page) {
  const pager = $('#pager');
  if (!pager) return;
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  const pages = [];
  if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
  else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }
  pager.innerHTML = pages.map(p => p === '…'
    ? '<span class="dots">…</span>'
    : `<button type="button" data-page="${p}" aria-current="${p === page ? 'page' : 'false'}" aria-label="หน้า ${p}">${p}</button>`
  ).join('');
}

function selectStation(st) {
  selected = st;
  const chip = $('#activeRegionChip');
  if (chip) chip.textContent = `สังกัด ${REGION_SHORT[st.region] || '-'} · จังหวัด ${st.province_th}`;
  const active = $('#activeStationChip');
  if (active) active.textContent = st.name;

  const box = $('#stationTelemetry');
  if (box) {
    const isMetro = st.region === 'bkk';
    const addrOk = hasAddress(st);
    const saved = state.saved.has(st.id);
    const phoneDigits = String(st.phone || '').replace(/\D/g, '');
    const web = (st.website || '').trim();
    const webLabel = web.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const jq = st.name.replace(/^สภ\.|^สน\./, '').trim();

    box.innerHTML = `
      <div class="tele-badges">
        <span class="badge ${isMetro ? 'badge-metro' : 'badge-phuthon'}">${isMetro ? 'สน. นครบาล' : 'สภ. ภูธร'}</span>
        <span class="badge badge-region">${esc(REGION_SHORT[st.region] || '-')}</span>
        <span class="verified" title="ข้อมูลยืนยันจากสำนักงานตำรวจแห่งชาติ">${icon.check}ยืนยันจาก ตร.</span>
      </div>
      <h2 class="tele-title">${esc(st.name)}</h2>
      <p class="tele-addr">${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</p>
      <div class="tele-grid">
        <div><span>จังหวัด</span><b>${esc(st.province_th)}</b></div>
        <div><span>กองบัญชาการ</span><b>${esc(REGION_NAME[st.region] || '-')}</b></div>
        <div><span>โทรศัพท์</span>${phoneDigits ? `<a class="mono" href="tel:${esc(phoneDigits)}">${esc(formatPhoneDisplay(st.phone))}</a>` : '<b>ไม่มีข้อมูล</b>'}</div>
        <div><span>โทรสาร (แฟกซ์)</span><b class="mono">${esc(formatPhoneDisplay(st.fax) || 'ไม่มีข้อมูล')}</b></div>
        ${web ? `<div style="grid-column:1/-1"><span>เว็บไซต์ทางการ</span><a href="${esc(web)}" target="_blank" rel="noopener">${esc(webLabel)}</a></div>` : ''}
      </div>
      <div class="copy-preview">
        <div class="copy-preview-head">
          <b>ข้อความที่จะคัดลอก (วางลงซอง/หนังสือ)</b>
          <a href="${esc(reportURL(st))}" data-report-id="${st.id}">แจ้งที่อยู่คลาดเคลื่อน</a>
        </div>
        <pre class="copy-pre">${esc(addrOk ? envelopeCopyText(st) : 'ต้นทางยังไม่มีที่อยู่สำหรับสถานีนี้ — กรุณาแจ้งที่อยู่')}</pre>
      </div>
      <div class="tele-actions">
        <button type="button" class="btn btn-primary btn-sm" id="openModalBtn">ดูรายละเอียด / แผนที่</button>
        <a class="btn btn-outline btn-sm" href="${esc(mapsLink(st))}" target="_blank" rel="noopener">นำทาง</a>
        <button type="button" class="btn btn-outline btn-sm" id="printOneBtn">พิมพ์ A4</button>
        <button type="button" class="btn btn-outline btn-sm" id="saveStationBtn" aria-pressed="${saved}">${saved ? 'บันทึกแล้ว ✓' : 'บันทึกสถานี'}</button>
        <a class="btn btn-ghost btn-sm" href="jurisdiction.html?j=${encodeURIComponent(jq)}&jtab=jur">ดูเขตอำนาจ</a>
      </div>`;

    $('#openModalBtn', box)?.addEventListener('click', () => openStationModal(st.id));
    $('#printOneBtn', box)?.addEventListener('click', () => printStation(st));
    $('#saveStationBtn', box)?.addEventListener('click', () => toggleSave(st.id));
    $('[data-report-id]', box)?.addEventListener('click', (e) => {
      if ($('#reportModal')) {
        e.preventDefault();
        openReportModal(st.id);
      }
    });
  }

  const hudCopy = $('#hudCopyBtn');
  if (hudCopy) hudCopy.disabled = !hasAddress(st);
  $$('.result-item').forEach(b => b.classList.toggle('is-selected', +b.dataset.id === st.id));
}

function renderResults() {
  const box = $('#resultsList');
  if (!box) return;
  const list = getFiltered();
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PER_PAGE;
  const pageItems = list.slice(start, start + PER_PAGE);

  const countEl = $('#resultCount');
  if (countEl) countEl.textContent = total.toLocaleString('th-TH');
  const sr = $('#srStatus');
  if (sr) sr.textContent = `พบ ${total.toLocaleString('th-TH')} สถานี` + (totalPages > 1 ? ` · หน้า ${state.page} จาก ${totalPages}` : '');

  renderRegionChips();
  renderActiveFilters();
  updateSavedUI();

  if (!pageItems.length) {
    box.innerHTML = `<div class="sug-empty">ไม่พบสถานีที่ตรงกับเงื่อนไข — ลองล้างตัวกรองแล้วค้นใหม่</div>`;
    selected = null;
    const tele = $('#stationTelemetry');
    if (tele) tele.innerHTML = '<p style="color:var(--muted)">ไม่พบสถานีที่ตรงกับเงื่อนไข — ลองกด “ล้างตัวกรอง”</p>';
    const chip = $('#activeRegionChip'); if (chip) chip.textContent = 'สังกัด — · จังหวัด —';
    const active = $('#activeStationChip'); if (active) active.textContent = 'ไม่มีรายการ';
    const hudCopy = $('#hudCopyBtn'); if (hudCopy) hudCopy.disabled = true;
  } else {
    box.innerHTML = pageItems.map(st => {
      const saved = state.saved.has(st.id);
      return `<button type="button" class="result-item" data-id="${st.id}">
        <span class="result-item-head">
          <b>${hl(st.name, state.q)}</b>
          ${saved ? '<span class="saved-dot">บันทึก</span>' : ''}
        </span>
        <span class="result-item-meta">${esc(st.province_th)} · ${esc(REGION_SHORT[st.region] || '-')}</span>
        <small>${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</small>
      </button>`;
    }).join('');
    if (!selected || !pageItems.some(s => s.id === selected.id)) {
      selectStation(pageItems[0]);
    } else {
      selectStation(selected);
    }
  }

  renderPagination(totalPages, state.page);
  syncURL();
}

function applySearch(raw, pickStation = null) {
  const v = String(raw ?? '');
  state.q = v.trim();
  state.page = 1;
  setResultsState(true);
  closeSuggest();
  scanStart();
  if (pickStation) {
    const list = getFiltered();
    const idx = list.findIndex(s => s.id === pickStation.id);
    if (idx >= 0) {
      state.page = Math.floor(idx / PER_PAGE) + 1;
      selected = pickStation;
    } else {
      state.q = pickStation.name;
      const input = $('#searchInput');
      if (input) input.value = pickStation.name;
      $('#searchHub')?.classList.toggle('has-value', !!pickStation.name);
      selected = pickStation;
    }
  }
  renderResults();
}

function resetFilters() {
  state.q = '';
  state.province = '';
  state.region = 'all';
  state.savedOnly = false;
  state.sort = 'region';
  state.page = 1;
  const input = $('#searchInput'); if (input) input.value = '';
  $('#searchHub')?.classList.remove('has-value');
  updateProvinceLabel();
  closeSuggest();
  closeCombo(false);
  updateSavedUI();
  renderResults();
}

function resetAll() {
  state.q = '';
  state.province = '';
  state.region = 'all';
  state.savedOnly = false;
  state.sort = 'region';
  state.page = 1;
  const input = $('#searchInput'); if (input) input.value = '';
  $('#searchHub')?.classList.remove('has-value');
  closeSuggest();
  closeCombo(false);
  setResultsState(false);
  selected = null;
  updateProvinceLabel();
  updateSavedUI();
  renderRegionChips();
  syncURL();
  const tele = $('#stationTelemetry');
  if (tele) tele.innerHTML = '<p style="color:var(--muted)">เลือกสถานีจากรายการเพื่อแสดงข้อมูล</p>';
  const chip = $('#activeRegionChip'); if (chip) chip.textContent = 'สังกัด — · จังหวัด —';
  const active = $('#activeStationChip'); if (active) active.textContent = 'เลือกสถานีจากรายการ';
  if (input) input.focus();
}

/* ---------- URL Sync & Read ---------- */
let pendingStationId = null;
let activeModalId = null;

function syncURL() {
  try {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.province) p.set('province', state.province);
    if (state.region !== 'all') p.set('region', state.region);
    if (state.sort !== 'region') p.set('sort', state.sort);
    if (state.page > 1) p.set('page', String(state.page));
    if (activeModalId && !$('#jurForm')) p.set('id', String(activeModalId));
    if ($('#jurForm')) {
      if (jurParams.q) p.set('j', jurParams.q);
      if (jurParams.tab !== 'jur') p.set('jtab', jurParams.tab);
    }
    const qs = p.toString();
    history.replaceState(null, '', (qs ? '?' + qs : window.location.pathname) + window.location.hash);
  } catch { /* file:// or sandbox */ }
}

function applyURL() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('q')) {
      state.q = p.get('q');
      const input = $('#searchInput');
      if (input) input.value = state.q;
    }
    if (p.get('province')) {
      const prov = p.get('province');
      if (PROVINCES.some(x => x.name === prov)) { state.province = prov; updateProvinceLabel(); }
    }
    if (p.get('region') && REGIONS.some(r => r.id === p.get('region'))) state.region = p.get('region');
    if (p.get('sort') && ['region', 'name', 'province'].includes(p.get('sort'))) state.sort = p.get('sort');
    const pg = parseInt(p.get('page') || '1', 10);
    if (pg > 0) state.page = pg;
    const rawId = p.get('id');
    if (rawId) {
      const parsedId = parseInt(rawId, 10);
      if (Number.isFinite(parsedId) && ST_BY_ID.has(parsedId)) {
        pendingStationId = parsedId;
      }
    }
  } catch { /* ignore */ }
}

function applyJurURL() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('j')) jurParams.q = p.get('j');
    if (['jur', 'digest', 'ai'].includes(p.get('jtab'))) jurParams.tab = p.get('jtab');
  } catch { /* ignore */ }
}

/* ---------- Station Detail Modal ---------- */
const modal = $('#stationModal');
let lastFocus = null;

function openStationModal(id) {
  const st = ST_BY_ID.get(id);
  if (!st || !modal) return;
  closeSuggest();
  lastFocus = document.activeElement;
  $('#modalRegion').textContent = REGION_NAME[st.region] || '';
  $('#modalTitle').textContent = st.name;
  $('#dAddress').textContent = st.address || 'ไม่มีข้อมูล';
  const dPhone = $('#dPhone');
  dPhone.textContent = formatPhoneDisplay(st.phone) || 'ไม่มีข้อมูล';
  dPhone.href = st.phone ? 'tel:' + st.phone.replace(/\D/g, '') : '#';
  $('#dFax').textContent = formatPhoneDisplay(st.fax) || 'ไม่มีข้อมูล';
  $('#dProvince').textContent = st.province_th;
  $('#dRegion').textContent = REGION_NAME[st.region] || '-';
  const dWeb = $('#dWebsite');
  if (st.website) {
    dWeb.textContent = st.website;
    dWeb.href = st.website;
    dWeb.removeAttribute('aria-disabled');
  } else {
    dWeb.textContent = 'ไม่มีเว็บไซต์ทางการ';
    dWeb.removeAttribute('href');
    dWeb.setAttribute('aria-disabled', 'true');
  }
  $('#dMap').src = mapsEmbed(st);
  $('#dNavigate').href = mapsLink(st);

  const dSave = $('#dSave');
  dSave.setAttribute('aria-pressed', String(state.saved.has(st.id)));
  dSave.textContent = state.saved.has(st.id) ? 'บันทึกแล้ว ✓' : 'บันทึกสถานีนี้';
  dSave.dataset.id = st.id;
  $('#dPrint').dataset.id = st.id;
  const dShare = $('#dShare');
  if (dShare) dShare.dataset.id = st.id;

  const addr = hasAddress(st);
  const copyBtn = $('#dCopy');
  copyBtn.dataset.id = st.id;
  copyBtn.disabled = !addr;
  copyBtn.setAttribute('aria-describedby', 'dCopyPreview');
  $('#dCopyPreview').textContent = addr ? envelopeCopyText(st) : 'ต้นทางยังไม่มีที่อยู่สำหรับสถานีนี้ — กรุณาแจ้งที่อยู่';
  const dReport = $('#dReport');
  if (dReport) {
    dReport.href = reportURL(st);
    dReport.dataset.id = st.id;
  }

  activeModalId = st.id;
  if (!$('#jurForm')) syncURL();

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
  (addr ? copyBtn : $('#modalClose')).focus();
}

function closeStationModal() {
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  document.body.style.overflow = '';
  const dMap = $('#dMap');
  if (dMap) dMap.src = 'about:blank';
  if (activeModalId !== null) {
    activeModalId = null;
    if (!$('#jurForm')) syncURL();
  }
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

/* ---------- Print (A4, no signature block, no source line) ---------- */
function emblemPrintSVG() {
  return '<svg width="46" height="46" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="#7E1F1A"/><circle cx="32" cy="32" r="24.5" fill="none" stroke="#C9A227" stroke-width="1.6"/><path d="M32 12l3.1 6.3 6.9 1-5 4.9 1.2 6.9L32 30.2 25.8 33.5l1.2-6.9-5-4.9 6.9-1L32 12Z" fill="#C9A227"/></svg>';
}

function thaiDate(d = new Date()) {
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function printHeader(title, subtitle) {
  return `<div class="print-sheet">
    <div class="print-emblem-row">${emblemPrintSVG()}<div><div class="ps-name">KADEEHUB</div><div class="ps-sub">สารบบสถานีตำรวจทั่วประเทศ</div></div></div>
    <div class="print-doc-title">${esc(title)}</div>
    <div class="print-doc-sub">${esc(subtitle)}</div>`;
}

function printFooter() {
  return `<div class="print-foot"><span>พิมพ์จาก KadeeHub (kadeehub.online) · วันที่พิมพ์ ${esc(thaiDate())}</span></div></div>`;
}

function printStation(st) {
  $('#print-area').innerHTML =
    printHeader('ใบรายละเอียดสถานีตำรวจ', 'สำหรับใช้ในการปฏิบัติงาน / แนบเอกสารคดี') +
    `<table class="print-table"><tbody>
      <tr><th style="width:32%">ชื่อสถานี</th><td><strong>${esc(st.name)}</strong></td></tr>
      <tr><th>ประเภท / กองบัญชาการ</th><td>${st.region === 'bkk' ? 'สถานีตำรวจนครบาล' : 'สถานีตำรวจภูธร'} — ${esc(REGION_NAME[st.region] || '-')}</td></tr>
      <tr><th>ที่อยู่</th><td>${esc(st.address || '-')}</td></tr>
      <tr><th>จังหวัด</th><td>${esc(st.province_th)}</td></tr>
      <tr><th>โทรศัพท์</th><td>${esc(formatPhoneDisplay(st.phone) || '-')}</td></tr>
      <tr><th>โทรสาร (แฟกซ์)</th><td>${esc(formatPhoneDisplay(st.fax) || '-')}</td></tr>
      <tr><th>เว็บไซต์</th><td>${esc(st.website || '-')}</td></tr>
    </tbody></table>` +
    printFooter();
  window.print();
}

function printFilteredList() {
  const list = getFiltered();
  if (!list.length) { showToast('ไม่มีรายการให้พิมพ์'); return; }
  const rows = list.map((st, i) => `<tr><td>${i + 1}</td><td><strong>${esc(st.name)}</strong></td><td>${esc(st.province_th)}</td><td>${esc(st.address || '-')}</td><td>${esc(formatPhoneDisplay(st.phone) || '-')}</td><td>${esc(formatPhoneDisplay(st.fax) || '-')}</td></tr>`).join('');
  const scope = [
    state.region !== 'all' ? REGION_NAME[state.region] : null,
    state.province ? `จังหวัด${state.province}` : null,
    state.q ? `คำค้น “${state.q}”` : null,
    state.savedOnly ? 'เฉพาะที่บันทึก' : null,
  ].filter(Boolean).join(' · ') || 'ทุกจังหวัดทั่วประเทศ';
  $('#print-area').innerHTML =
    printHeader('บัญชีรายนามสถานีตำรวจ', `ขอบเขต: ${scope} — จำนวน ${list.length} สถานี`) +
    `<table class="print-table"><thead><tr><th>#</th><th>ชื่อสถานี</th><th>จังหวัด</th><th>ที่อยู่</th><th>โทรศัพท์</th><th>แฟกซ์</th></tr></thead><tbody>${rows}</tbody></table>` +
    printFooter();
  window.print();
}

/* ---------- CSV Export (UTF-8 + BOM) ---------- */
function exportCSV() {
  const list = getFiltered();
  if (!list.length) { showToast('ไม่มีรายการให้ดาวน์โหลด'); return; }
  const header = ['ชื่อสถานี', 'ประเภท', 'กองบัญชาการ', 'จังหวัด', 'ที่อยู่', 'โทรศัพท์', 'โทรสาร', 'เว็บไซต์'];
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [header.join(',')].concat(list.map(st => [
    q(st.name),
    q(st.region === 'bkk' ? 'สถานีตำรวจนครบาล' : 'สถานีตำรวจภูธร'),
    q(REGION_NAME[st.region] || ''),
    q(st.province_th),
    q(st.address || ''),
    q(st.phone || ''),
    q(st.fax || ''),
    q(st.website || ''),
  ].join(',')));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ps-locator-stations.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast(`ดาวน์โหลด CSV แล้ว (${list.length} รายการ)`);
}

/* ============================================================
   พื้นที่งาน "เขตอำนาจสอบสวน" (ค้นหาจากชื่อตำบล + ย่อประกาศ)
   ข้อมูล: window.JURISDICTION (data/jurisdictions.js — โหลดแบบ lazy)
   ============================================================ */
const jurState = {
  data: null, loading: null, sug: [], sugActive: -1, results: [],
  digestQ: '', fullText: null, fullBusy: false,
};
const JUR_ADDR = new Map();
const JUR_TABS = [
  { id: 'jur', tab: 'tabJur', panel: 'panelJur' },
  { id: 'digest', tab: 'tabDigest', panel: 'panelDigest' },
  { id: 'ai', tab: 'tabAi', panel: 'panelAi' },
];

function normJur(s) {
  return norm(String(s ?? '')
    .replace(/^\s*(ตำบล|แขวง|อำเภอ|จังหวัด|ต\.|อ\.|จ\.|เขต)\s*/gu, '')
    .replace(/[“”„]/g, ''));
}

function jurKeys(qRaw) {
  const a = normJur(qRaw), b = norm(qRaw);
  return (b && b !== a) ? [a, b] : [a];
}

function buildAddressIndex() {
  for (const st of STATIONS) {
    const a = String(st.address || '');
    const names = new Set();
    let m = a.match(/(?:ต\.|ตำบล)\s*([^\s,/]+)/u);
    if (m) names.add(m[1]);
    m = a.match(/แขวง(?:\/เขต)?\s*([^\s,/]+)/u);
    if (m) names.add(m[1]);
    for (const n of names) {
      const k = normJur(n);
      if (!k) continue;
      if (!JUR_ADDR.has(k)) JUR_ADDR.set(k, []);
      const arr = JUR_ADDR.get(k);
      if (!arr.includes(st.id)) arr.push(st.id);
    }
  }
}

function loadJurisdiction() {
  if (jurState.data) return Promise.resolve(jurState.data);
  if (jurState.loading) return jurState.loading;
  jurState.loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'data/jurisdictions.js';
    s.onload = () => {
      if (!window.JURISDICTION) { reject(new Error('ข้อมูลไม่สมบูรณ์')); return; }
      jurState.data = window.JURISDICTION;
      resolve(jurState.data);
    };
    s.onerror = () => reject(new Error('โหลดข้อมูลไม่สำเร็จ'));
    document.head.appendChild(s);
  });
  return jurState.loading;
}

function afterJurisdictionLoaded() {
  const cov = $('#jurCoverage');
  if (cov) {
    cov.textContent = 'อ้างอิงประกาศสำนักงานตำรวจแห่งชาติ (ราชกิจจานุเบกษา) · โปรดตรวจสอบกับประกาศฉบับจริงก่อนนำไปใช้ทางกฎหมาย';
  }
  renderSources();
  renderDigest();
  if (jurParams.q) {
    $('#jurQ').value = jurParams.q;
    jurSearch(jurParams.q, { silent: true });
  } else {
    renderJurIdle();
  }
}

function jurisLoadFailed() {
  $('#jurCoverage').textContent = 'ไม่สามารถโหลดบัญชีแนบท้ายประกาศได้ — กรุณาเปิดเว็บผ่าน HTTP แล้วโหลดใหม่อีกครั้ง';
  $('#jurResults').innerHTML = `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3><p>ชุดข้อมูลเขตอำนาจยังไม่พร้อมใช้งาน กรุณาตรวจสอบกับสถานีตำรวจโดยตรง หรือเปิดประกาศฉบับเต็ม</p></div>`;
}

function setJurTab(id, focus = false) {
  const t = JUR_TABS.find(x => x.id === id) || JUR_TABS[0];
  jurParams.tab = t.id;
  for (const x of JUR_TABS) {
    const btn = $('#' + x.tab), panel = $('#' + x.panel);
    if (!btn || !panel) continue;
    const on = x.id === t.id;
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
    if (on && focus) btn.focus();
  }
  if (t.id !== 'jur') closeJurSuggest();
  if (t.id === 'digest') renderDigest();
  syncURL();
}

function jurFindCandidates(qRaw) {
  const d = jurState.data;
  const keys = jurKeys(qRaw), qn = keys[0];
  if (!qn || !d) return { hits: [], addrHits: [], exact: false };
  const recByIdx = new Map();
  const add = (i, hitName, kind) => {
    if (!recByIdx.has(i)) recByIdx.set(i, { idx: i, hitName, kind, rank: 9 });
    const o = recByIdx.get(i);
    if (kind === 'exact' && o.rank > 0) { o.rank = 0; o.hitName = hitName; o.kind = kind; }
    else if (kind === 'tambon' && o.rank > 1) { o.rank = 1; o.hitName = hitName; o.kind = kind; }
    else if (kind === 'station' && o.rank > 2) { o.rank = 2; o.hitName = hitName; o.kind = kind; }
  };
  const hasKey = (k) => keys.some(n => n && k.includes(n));
  let exact = false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(d.index, key) && Array.isArray(d.index[key])) {
      exact = true;
      for (const i of d.index[key]) add(i, qRaw.trim(), 'exact');
    }
  }
  /* ถ้ามี exact hit ใน d.index แล้ว กด fuzzy station-name fallback ไว้ เพื่อไม่ให้ผลเพี้ยน */
  if (!exact) {
    let n = 0;
    for (const [k, arr] of Object.entries(d.index)) {
      if (hasKey(k)) {
        for (const i of arr) add(i, k, 'tambon');
        if (++n > 60) break;
      }
    }
    for (let i = 0; i < d.stations.length; i++) {
      const r = d.stations[i];
      const st = ST_BY_ID.get(r.id);
      const hay = [normJur(r.short), normJur(st ? st.name : ''), normJur(r.province), normJur(r.amphoe), normJur('ภ.' + r.region)].join('|');
      if (hasKey(hay)) add(i, r.short, 'station');
    }
  }
  const addrHits = [];
  for (const [k, ids] of JUR_ADDR) {
    const match = exact ? keys.includes(k) : keys.some(n => n && (k === n || k.includes(n)));
    if (!match) continue;
    for (const id of ids) {
      if (!jurState.data.stations.some(r => r.id === id)) addrHits.push({ id, from: k, exact: keys.includes(k) });
    }
  }
  const hits = [...recByIdx.values()].sort((a, b) => a.rank - b.rank ||
    d.stations[a.idx].province.localeCompare(d.stations[b.idx].province, 'th') ||
    d.stations[a.idx].short.localeCompare(d.stations[b.idx].short, 'th'));
  return { hits, addrHits, exact };
}

function renderJurIdle() {
  const d = jurState.data;
  const box = $('#jurResults');
  if (!box) return;
  box.innerHTML = `
    <div class="jur-empty">
      <h3>พิมพ์ชื่อตำบลที่ต้องการตรวจสอบ เพื่อรู้ว่าไปโรงพักไหน</h3>
      <p>รองรับชื่อตำบล แขวง อำเภอ จังหวัด และชื่อ สภ./สน. · ข้อมูลจากบัญชีแนบท้ายประกาศ ${d ? esc(d.meta.sources[0].label) : ''}</p>
      <button class="btn btn-outline btn-sm" type="button" id="jurGoDigest">อ่านสรุปประกาศก่อนก็ได้</button>
    </div>`;
  $('#jurGoDigest')?.addEventListener('click', () => setJurTab('digest', true));
}

function jurSuggest(qRaw) {
  const keys = jurKeys(qRaw);
  if (!keys[0] || !jurState.data) return [];
  const out = [];
  const seen = new Set();
  const idx = jurState.data.index;
  const stations = jurState.data.stations;
  const exactKeys = keys.filter(k => Object.prototype.hasOwnProperty.call(idx, k));
  const useExact = exactKeys.length > 0;

  /* 1) ชื่อตำบลในบัญชีแนบท้าย */
  for (const [k, arr] of Object.entries(idx)) {
    if (useExact ? !exactKeys.includes(k) : !keys.some(n => n && k.includes(n))) continue;
    const r = stations[arr[0]];
    const key = 't|' + k + '|' + r.province;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: k, sub: `${r.province} · ${arr.length} สถานี` });
    if (out.length >= 8) return out;
  }

  /* 2) ชื่อจังหวัด (เช่น พิมพ์ "ระนอง" → แนะนำจังหวัดระนองทันที) */
  if (out.length < 8) {
    const provCounts = new Map();
    for (const r of stations) {
      if (keys.some(n => n && r.province.includes(n))) {
        provCounts.set(r.province, (provCounts.get(r.province) || 0) + 1);
      }
    }
    for (const [prov, cnt] of provCounts.entries()) {
      const key = 'p|' + prov;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: prov, sub: `จังหวัด · ${cnt} สถานี` });
      if (out.length >= 8) return out;
    }
  }

  /* 3) ชื่อ สภ. / อำเภอ ในบัญชีแนบท้าย */
  if (out.length < 8) {
    for (const r of stations) {
      const shortMatch = keys.some(n => n && r.short.includes(n));
      const ampMatch = !shortMatch && keys.some(n => n && r.amphoe && r.amphoe.includes(n));
      if (!shortMatch && !ampMatch) continue;
      const label = shortMatch ? `สภ.${r.short}` : r.amphoe;
      const key = 's|' + label + '|' + r.province;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: shortMatch ? r.short : r.amphoe,
        label,
        sub: shortMatch ? `จ.${r.province} · ${r.tambons.length} ตำบล` : `อำเภอ · จ.${r.province}`
      });
      if (out.length >= 8) return out;
    }
  }

  /* 4) สถานีที่อยู่นอกบัญชีตำบล (เช่น สน. ใน กทม.) */
  if (out.length < 8) {
    const qNorm = norm(qRaw);
    for (const st of STATIONS) {
      if (qNorm && norm(st.name).includes(qNorm)) {
        const key = 'st|' + st.id;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name: st.name, sub: st.province_th });
        if (out.length >= 8) break;
      }
    }
  }

  return out;
}

function renderJurSuggest(rawOverride) {
  const panel = $('#jurSuggest'), input = $('#jurQ');
  if (!panel || !input) return;
  const qRaw = String(rawOverride !== undefined && typeof rawOverride === 'string' ? rawOverride : input.value).trim();
  jurState.sug = qRaw ? jurSuggest(qRaw) : [];
  jurState.sugActive = -1;
  input.removeAttribute('aria-activedescendant');
  if (!qRaw) { closeJurSuggest(); return; }
  panel.innerHTML = jurState.sug.length
    ? jurState.sug.map((s, i) => `<div class="jur-sug-row" role="option" id="jurSug-${i}" data-jur-sug="${esc(s.name)}" aria-selected="false"><b>${hl(s.label || s.name, qRaw)}</b><small>${esc(s.sub)}</small></div>`).join('')
    : `<div class="jur-sug-empty">ไม่พบคำที่ตรงกับ “${esc(qRaw)}” — ลองพิมพ์ชื่อตำบล อำเภอ จังหวัด หรือชื่อ สภ./สน.</div>`;
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function closeJurSuggest() {
  const panel = $('#jurSuggest'), input = $('#jurQ');
  if (panel) panel.hidden = true;
  jurState.sugActive = -1;
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
}

function moveJurSug(delta) {
  const panel = $('#jurSuggest'), input = $('#jurQ');
  if (!panel || !input) return;
  const rows = $$('.jur-sug-row', panel);
  if (!rows.length) return;
  let next = jurState.sugActive + delta;
  if (next < 0) next = rows.length - 1;
  if (next >= rows.length) next = 0;
  jurState.sugActive = next;
  rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === next)));
  rows[next].scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', rows[next].id);
}

function syncJurClear() {
  const qEl = $('#jurQ'), btn = $('#clearJurBtn'), cap = $('#jurCapsule');
  if (!qEl) return;
  const hasVal = qEl.value.length > 0;
  if (btn) btn.hidden = !hasVal;
  if (cap) cap.classList.toggle('has-value', hasVal);
}

function jurSearch(qRaw, opts = {}) {
  if (!jurState.data) { loadJurisdiction().then(() => jurSearch(qRaw, opts)).catch(jurisLoadFailed); return; }
  const q = String(qRaw ?? '').trim();
  jurParams.q = q;
  const input = $('#jurQ');
  if (input) input.value = q;
  syncJurClear();
  closeJurSuggest();
  if (!q) { jurState.results = []; renderJurIdle(); syncURL(); return; }
  const { hits, addrHits, exact } = jurFindCandidates(q);
  jurState.results = { hits, addrHits, q, exact };
  renderJurResults();
  const status = $('#jurStatus');
  if (status) status.textContent = `พบ ${hits.length + addrHits.length} สถานีที่เกี่ยวข้องกับ “${q}”`;
  syncURL();
  emitCapsulePulse(0.75, 560);
  if (!opts.silent) $('#jurResults')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function jurPhoneLink(st) {
  if (!st || !st.phone) return 'ไม่มีข้อมูล';
  const digits = st.phone.replace(/\D/g, '');
  return `<a href="tel:${esc(digits)}">${esc(formatPhoneDisplay(st.phone))}</a>`;
}

function jurNeighborHTML(rec) {
  const all = jurState.data.stations;
  let list = all.filter(r => r.id !== rec.id && r.province === rec.province && r.amphoe === rec.amphoe);
  if (list.length < 4) list = list.concat(all.filter(r => r.id !== rec.id && r.province === rec.province && r.amphoe !== rec.amphoe));
  list = list.slice(0, 6);
  if (!list.length) return '';
  return `<div class="jur-sec-title">เขตเพื่อนบ้าน · สำหรับประสาน / ส่งหมาย (จังหวัดเดียวกัน)</div>
    <div class="jur-neighbors">${list.map(r => {
      const st = ST_BY_ID.get(r.id);
      return `<div class="jur-neighbor"><button type="button" data-jur-jump="${esc(r.short)}"><b>สภ.${esc(r.short)}</b></button>
        <span>${esc(r.amphoe)}</span>${jurPhoneLink(st)}</div>`;
    }).join('')}</div>`;
}

function jurResultCard(item, q) {
  const d = jurState.data, rec = d.stations[item.idx], st = ST_BY_ID.get(rec.id);
  if (!st) return '';
  const missing = rec.count - rec.tambons.length;
  const partialCount = rec.tambons.filter(t => t.partial).length;
  const tambons = rec.tambons.map(t => {
    const hit = normJur(t.name) === normJur(q) || (item.kind !== 'station' && normJur(q) && normJur(t.name).includes(normJur(q)));
    return `<span class="jur-tambon ${hit ? 'hit' : ''} ${t.partial ? 'partial' : ''}" title="${esc(t.note || 'ตามบัญชีแนบท้ายประกาศ')}">${esc(t.name)}${t.partial ? ' · บางส่วน' : ''}</span>`;
  }).join('');
  const warns = [];
  if (missing > 0) warns.push(`ต้องตรวจสอบ: ข้อความในประกาศหน้า ${rec.page} ระบุ ${rec.count} ตำบล แต่ถอดชื่อได้ ${rec.tambons.length} ตำบล — อาจมีชื่อตำบลที่ค้นไม่พบ กรุณาเปิดหน้าประกาศหรือสอบถามสถานีโดยตรงก่อนส่งหมาย / รับแจ้งเหตุ`);
  if (partialCount > 0) warns.push(`มี ${partialCount} ตำบลที่ประกาศระบุ "บางส่วน / เฉพาะหมู่ที่ / แนวเขต" ต้องตรวจสอบแนวเขตจริงในหน้า ${rec.page} ของราชกิจจานุเบกษา`);
  const warn = warns.map(w => `<p class="jur-warn">${esc(w)}</p>`).join('');
  const listTitle = missing > 0
    ? `ตำบลในเขตอำนาจตามประกาศ (ถอดได้ ${rec.tambons.length} จาก ${rec.count} ตำบล · ชื่อที่ตรงคำค้นไฮไลต์)`
    : `ตำบลในเขตอำนาจตามประกาศ (${rec.count} ตำบล · ชื่อที่ตรงคำค้นไฮไลต์)`;
  return `<article class="jur-card">
    <div class="jur-answer"><span class="lead">${esc(q)}</span><span class="arrow">→</span><span class="target">${esc(st.name)}</span></div>
    <div class="jur-meta">
      <span>จังหวัด${esc(rec.province)}</span><span>อำเภอ${esc(rec.amphoe)}</span>
      <span>ตำรวจภูธรภาค ${esc(rec.region)}</span><span>บัญชีแนบท้าย หน้า ${rec.page}</span>
    </div>
    <div class="jur-meta"><span>${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</span>${jurPhoneLink(st)}</div>
    <div class="jur-actions">
      <button class="btn btn-primary btn-sm" type="button" data-jur-detail="${rec.id}">ดูรายละเอียดสถานี</button>
      ${hasAddress(st)
        ? `<button class="btn btn-outline btn-sm" type="button" data-jur-copy="${rec.id}">คัดลอกที่อยู่</button>`
        : `<button class="btn btn-outline btn-sm" type="button" disabled title="ต้นทางยังไม่มีที่อยู่">ไม่มีที่อยู่</button>`}
      <button class="btn btn-outline btn-sm" type="button" data-jur-print="${rec.id}">พิมพ์ใบตรวจสอบเขตอำนาจ</button>
      <a class="btn btn-outline btn-sm" href="${esc(mapsLink(st))}" target="_blank" rel="noopener">นำทางไปโรงพัก</a>
    </div>
    <div class="jur-sec-title">${listTitle}</div>
    <div class="jur-tambons">${tambons || '<span class="jur-tambon">ไม่มีข้อมูล</span>'}</div>
    ${warn}
    ${jurNeighborHTML(rec)}
  </article>`;
}

function jurAddressCard(h, q) {
  const st = ST_BY_ID.get(h.id);
  if (!st) return '';
  return `<article class="jur-card is-address">
    <div class="jur-answer"><span class="lead">${esc(q)}</span><span class="arrow">→</span><span class="target">${esc(st.name)}</span></div>
    <div class="jur-meta"><span>จังหวัด${esc(st.province_th)}</span><span>${esc(REGION_SHORT[st.region] || '')}</span>${jurPhoneLink(st)}</div>
    <div class="jur-meta"><span>${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</span></div>
    <p class="jur-warn">รายการนี้เป็น <b>ตำบล/แขวงที่ตั้งสถานีตามที่อยู่</b> ไม่ใช่บัญชีเขตอำนาจตามประกาศ (ส่วนใหญ่เป็น สน. ในกรุงเทพมหานคร ซึ่งประกาศกำหนดเขตด้วยแนวถนน/คลอง) โปรดตรวจสอบกับสถานีโดยตรงก่อนดำเนินการทางคดี</p>
    <div class="jur-actions">
      <button class="btn btn-primary btn-sm" type="button" data-jur-detail="${st.id}">ดูรายละเอียดสถานี</button>
      ${hasAddress(st)
        ? `<button class="btn btn-outline btn-sm" type="button" data-jur-copy="${st.id}">คัดลอกที่อยู่</button>`
        : `<button class="btn btn-outline btn-sm" type="button" disabled title="ต้นทางยังไม่มีที่อยู่">ไม่มีที่อยู่</button>`}
      <a class="btn btn-outline btn-sm" href="${esc(mapsLink(st))}" target="_blank" rel="noopener">นำทางไปโรงพัก</a>
    </div>
  </article>`;
}

function renderJurResults() {
  const R = jurState.results;
  const box = $('#jurResults');
  if (!box) return;
  if (!R.q) { renderJurIdle(); return; }
  const showHits = R.hits.slice(0, 10);
  const showAddr = R.addrHits.slice(0, 6);
  const more = (R.hits.length + R.addrHits.length) - (showHits.length + showAddr.length);
  const header = `<div class="jur-hints"><span>พบ <b>${R.hits.length + R.addrHits.length}</b> รายการสำหรับ “${esc(R.q)}”</span>
    <button class="btn btn-outline btn-sm" type="button" id="jurShareBtn">แชร์ผลตรวจ</button>
    <button class="icon-btn" type="button" id="jurCsvBtn">ดาวน์โหลด CSV</button>
    <button class="btn btn-ghost btn-sm" type="button" id="jurClearBtn">ล้างคำค้น</button></div>`;
  const body = showHits.map(h => jurResultCard(h, R.q)).join('') + showAddr.map(h => jurAddressCard(h, R.q)).join('');
  const empty = `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3>
    <p>ไม่พบ “${esc(R.q)}” ในบัญชีแนบท้ายประกาศและในที่อยู่สถานี กรุณาตรวจสอบการสะกดชื่อตำบล หรือเปิดประกาศฉบับเต็ม / สอบถามสถานีโดยตรง</p>
    <a href="https://ratchakitcha.soc.go.th/documents/17187.pdf" target="_blank" rel="noopener">เปิดประกาศฉบับจริง (PDF)</a></div>`;
  box.innerHTML = (R.hits.length + R.addrHits.length ? header + body + (more > 0 ? `<p class="jur-note">แสดง ${showHits.length + showAddr.length} รายการจากทั้งหมด ${R.hits.length + R.addrHits.length} รายการ — พิมพ์ชื่อตำบลให้เฉพาะเจาะจงขึ้นเพื่อจำกัดผลลัพธ์</p>` : '') : empty);
  $('#jurShareBtn')?.addEventListener('click', () => {
    const shareUrl = jurShareUrl(jurParams.q || R.q, jurParams.tab || 'jur');
    shareOrCopy({
      title: `เขตอำนาจสอบสวน: ${R.q} — KadeeHub`,
      text: `ผลการตรวจสอบเขตอำนาจสอบสวนสำหรับ “${R.q}” (${R.hits.length + R.addrHits.length} รายการ) — KadeeHub`,
      url: shareUrl,
    });
  });
  $('#jurCsvBtn')?.addEventListener('click', exportJurisdictionCSV);
  $('#jurClearBtn')?.addEventListener('click', () => jurSearch(''));
}

function exportJurisdictionCSV() {
  const R = jurState.results;
  if (!R.q) return;
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['คำค้น', 'ประเภทข้อมูล', 'ตำบล/คำที่พบ', 'สถานีตำรวจ', 'จังหวัด', 'อำเภอ', 'กองบัญชาการ', 'ที่อยู่', 'โทรศัพท์', 'หน้าในประกาศ', 'หมายเหตุ'].join(',')];
  for (const h of R.hits) {
    const rec = jurState.data.stations[h.idx], st = ST_BY_ID.get(rec.id);
    if (!st) continue;
    const missing = rec.count - rec.tambons.length;
    const partial = rec.tambons.filter(t => t.partial).length;
    const notes = [
      missing > 0 ? `ถอดชื่อตำบลได้ ${rec.tambons.length} จาก ${rec.count} ตำบล ต้องตรวจสอบประกาศ` : '',
      partial > 0 ? `มี ${partial} ตำบลระบุบางส่วน/เฉพาะหมู่ที่/แนวเขต` : '',
    ].filter(Boolean).join(' · ');
    lines.push([R.q, 'เขตอำนาจตามประกาศ', h.hitName, st.name, rec.province, rec.amphoe, 'ตำรวจภูธรภาค ' + rec.region,
      st.address, formatPhoneDisplay(st.phone) || '', rec.page, notes].map(q).join(','));
  }
  for (const h of R.addrHits) {
    const st = ST_BY_ID.get(h.id);
    if (!st) continue;
    lines.push([R.q, 'ตำบล/แขวงที่ตั้งสถานีตามที่อยู่', h.from, st.name, st.province_th, '', REGION_NAME[st.region] || '',
      st.address, formatPhoneDisplay(st.phone) || '', '', 'ไม่ใช่บัญชีเขตอำนาจตามประกาศ'].map(q).join(','));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url;
  a.download = 'ps-locator-hettamnat.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('ดาวน์โหลด CSV แล้ว');
}

function printJurisdiction(rec, query) {
  const st = ST_BY_ID.get(rec.id);
  if (!st) return;
  const list = rec.tambons.map(t => t.name + (t.partial ? ' (บางส่วน)' : '')).join(', ') || 'ไม่มีข้อมูล';
  const missing = rec.count - rec.tambons.length;
  const partialCount = rec.tambons.filter(t => t.partial).length;
  const caution = [
    missing > 0 ? `ข้อความประกาศหน้า ${rec.page} ระบุ ${rec.count} ตำบล แต่ถอดชื่อได้ ${rec.tambons.length} ตำบล อาจมีชื่อตำบลขาดไป กรุณาตรวจสอบประกาศฉบับจริงหรือสอบถามสถานีโดยตรง` : '',
    partialCount > 0 ? `มี ${partialCount} ตำบลที่ระบุ "บางส่วน / เฉพาะหมู่ที่ / แนวเขต" ต้องตรวจสอบแนวเขตจริง` : '',
  ].filter(Boolean).join(' · ');
  $('#print-area').innerHTML = printHeader('ใบตรวจสอบเขตอำนาจการรับผิดชอบ', 'สำหรับประกอบการรับแจ้งเหตุ / ส่งหมาย / ประสานคดี') +
    `<table class="print-table"><tbody>
      <tr><th style="width:30%">คำค้น (ตำบล / แขวง)</th><td><strong>${esc(query)}</strong></td></tr>
      <tr><th>สถานีตำรวจที่รับผิดชอบ</th><td><strong>${esc(st.name)}</strong></td></tr>
      <tr><th>จังหวัด / อำเภอ</th><td>${esc(rec.province)} / ${esc(rec.amphoe)}</td></tr>
      <tr><th>กองบัญชาการ</th><td>ตำรวจภูธรภาค ${esc(rec.region)}</td></tr>
      <tr><th>ที่อยู่สถานี</th><td>${esc(st.address || 'ไม่มีข้อมูล')}</td></tr>
      <tr><th>โทรศัพท์</th><td>${esc(formatPhoneDisplay(st.phone) || 'ไม่มีข้อมูล')}</td></tr>
      <tr><th>จำนวนตำบลในเขตอำนาจ</th><td>${rec.count} ตำบล${missing > 0 ? ` (ถอดชื่อได้ ${rec.tambons.length} ตำบล)` : ''}</td></tr>
      <tr><th>รายชื่อตำบลในเขตอำนาจ</th><td>${esc(list)}</td></tr>
      ${caution ? `<tr><th>ข้อควรตรวจสอบ</th><td>${esc(caution)} · ประกาศหน้า ${rec.page}</td></tr>` : ''}
    </tbody></table>` + printFooter();
  window.print();
}

function renderSources() {
  const d = jurState.data, box = $('#jurSources');
  if (!d || !box) return;
  box.innerHTML = d.meta.sources.map(s =>
    `<div class="jur-source"><b>${esc(s.label)}</b><small>${esc(s.gazette)} · ${s.pages} หน้า</small>
      <a href="${esc(s.url)}" target="_blank" rel="noopener">เปิดไฟล์ PDF ต้นฉบับ</a></div>`).join('');
}

function renderDigest() {
  const d = jurState.data, box = $('#digestCards');
  if (!d || !box) return;
  const qn = normJur(jurState.digestQ);
  const cards = d.summary.filter(c => !qn || normJur([c.title, c.text, c.keys].join(' ')).includes(qn));
  box.innerHTML = cards.length
    ? cards.map(c => {
      const src = d.meta.sources.find(s => s.code === c.doc) || d.meta.sources[0];
      return `<article class="jur-summary-card"><h4>${esc(c.title)}</h4><p>${hl(c.text, jurState.digestQ)}</p>
        <small>${esc(src.label)} · หน้า ${c.page} · <a href="${esc(src.url)}#page=${c.page}" target="_blank" rel="noopener">เปิดหน้านั้นใน PDF</a></small></article>`;
    }).join('')
    : `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3><p>ไม่พบหัวข้อที่ตรงกับ “${esc(jurState.digestQ)}” — ลองคำว่าตำบล, ส่งหมาย, แจ้งเหตุ หรือฉบับที่ 2</p></div>`;
}

async function fullTextSearch() {
  const q = $('#digestQ')?.value.trim();
  if (!q) { showToast('พิมพ์คำที่ต้องการค้นหาในประกาศก่อน'); return; }
  if (jurState.fullBusy) return;
  jurState.fullBusy = true;
  $('#fullSearchHint').textContent = 'กำลังค้นหาในข้อความประกาศ…';
  try {
    if (!jurState.fullText) {
      const [a, b] = await Promise.all([
        fetch('docs/gazette/2567.txt').then(r => r.text()),
        fetch('docs/gazette/2568-2.txt').then(r => r.text()),
      ]);
      const pagesOf = (t, code) => t.split('=== PAGE ').slice(1).map(chunk => {
        const n = parseInt(chunk, 10);
        return { code, n, text: chunk.replace(/^\d+\s*===\s*/, '') };
      }).filter(x => isFinite(x.n));
      jurState.fullText = [...pagesOf(a, '2567'), ...pagesOf(b, '2568-2')];
    }
    const needle = q.toLowerCase();
    const rows = [];
    for (const pg of jurState.fullText) {
      const at = pg.text.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      const from = Math.max(0, at - 70), to = Math.min(pg.text.length, at + q.length + 110);
      const snippet = (from ? '…' : '') + pg.text.slice(from, to).replace(/\s+/g, ' ').trim() + (to < pg.text.length ? '…' : '');
      const src = jurState.data.meta.sources.find(s => s.code === pg.code);
      rows.push(`<div class="jur-full-row"><b>${esc(src.label)} · หน้า ${pg.n}</b>
        <p>${hl(snippet, q)}</p><a class="jur-link" href="${esc(src.url)}#page=${pg.n}" target="_blank" rel="noopener">เปิดหน้า ${pg.n} ใน PDF</a></div>`);
      if (rows.length >= 12) break;
    }
    $('#fullResults').innerHTML = rows.length
      ? rows.join('') + `<p class="jur-note">แสดงสูงสุด 12 หน้าแรกที่พบคำค้น · ข้อความถอดจาก PDF เพื่อช่วยค้นหา โปรดตรวจสอบกับไฟล์ต้นฉบับ</p>`
      : `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3><p>ไม่พบคำว่า “${esc(q)}” ในข้อความประกาศที่ถอดไว้</p></div>`;
    $('#fullSearchHint').textContent = `พบ ${rows.length} หน้า · โหลดข้อความประกาศแล้ว`;
  } catch {
    $('#fullResults').innerHTML = `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3><p>โหลดข้อความประกาศไม่สำเร็จ กรุณาเปิดเว็บผ่าน HTTP แล้วลองใหม่ หรือเปิดไฟล์ PDF ต้นฉบับ</p></div>`;
    $('#fullSearchHint').textContent = 'โหลดไม่สำเร็จ';
  } finally {
    jurState.fullBusy = false;
  }
}

function bindJurisdictionEvents() {
  JUR_TABS.forEach((t, i) => {
    $('#' + t.tab)?.addEventListener('click', () => setJurTab(t.id));
    $('#' + t.tab)?.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? JUR_TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + JUR_TABS.length) % JUR_TABS.length;
      setJurTab(JUR_TABS[next].id, true);
    });
  });

  $('#jurForm')?.addEventListener('submit', (e) => { e.preventDefault(); jurSearch($('#jurQ').value); });
  $('#jurQ')?.addEventListener('input', () => { syncJurClear(); loadJurisdiction().then(renderJurSuggest).catch(jurisLoadFailed); });
  $('#clearJurBtn')?.addEventListener('click', () => {
    const qEl = $('#jurQ');
    if (qEl) qEl.value = '';
    syncJurClear();
    closeJurSuggest();
    jurSearch('', { silent: true });
    qEl?.focus();
  });
  $('#jurQ')?.addEventListener('keydown', (e) => {
    const open = !$('#jurSuggest').hidden;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) renderJurSuggest(); else moveJurSug(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) moveJurSug(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && jurState.sugActive >= 0 && jurState.sug[jurState.sugActive]) jurSearch(jurState.sug[jurState.sugActive].name);
      else jurSearch($('#jurQ').value);
    }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); closeJurSuggest(); } }
    else if (e.key === 'Tab') closeJurSuggest();
  });
  $('#jurSuggest')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-jur-sug]');
    if (row) jurSearch(row.dataset.jurSug);
  });
  $('.jur-hints')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jq]');
    if (b) { jurParams.q = b.dataset.jq; $('#jurQ').value = jurParams.q; jurSearch(jurParams.q); }
  });
  $('#jurResults')?.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-jur-copy]');
    if (copy) {
      const st = ST_BY_ID.get(+copy.dataset.jurCopy);
      if (st) copyStation(st, copy);
      return;
    }
    const detail = e.target.closest('[data-jur-detail]');
    if (detail) { openStationModal(+detail.dataset.jurDetail); return; }
    const printBtn = e.target.closest('[data-jur-print]');
    if (printBtn) {
      const rec = jurState.data.stations.find(r => r.id === +printBtn.dataset.jurPrint);
      if (rec) printJurisdiction(rec, jurParams.q || rec.short);
      return;
    }
    const jump = e.target.closest('[data-jur-jump]');
    if (jump) jurSearch(jump.dataset.jurJump);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.jur-field')) closeJurSuggest(); });

  $('#digestQ')?.addEventListener('input', (e) => { jurState.digestQ = e.target.value.trim(); renderDigest(); });
  $('#digestQ')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fullTextSearch(); } });
  $('#fullSearchBtn')?.addEventListener('click', fullTextSearch);

  /* Web Speech API (th-TH) สำหรับค้นหาชื่อตำบล */
  setupVoiceButton({
    btn: $('#jurVoiceBtn'),
    input: $('#jurQ'),
    onInterim: (text) => {
      if ($('#clearJurBtn')) $('#clearJurBtn').hidden = !text;
      syncJurClear();
      loadJurisdiction().then(() => renderJurSuggest(text)).catch(jurisLoadFailed);
    },
    onFinal: (text) => {
      jurSearch(text);
    },
  });

  bindAiAssistantEvents();
}

/* ============================================================
   ผู้ช่วย AI ราชกิจจานุเบกษา (Edge AI Strict Legal RAG + Local Fallback)
   ============================================================ */
const AI_LEGAL_DISCLAIMER =
  'คำเตือนทางกฎหมาย: คำตอบนี้สรุปจากข้อความประกาศสำนักงานตำรวจแห่งชาติในราชกิจจานุเบกษาเท่านั้น ' +
  'อาจมีตำบลบางส่วน/เฉพาะหมู่ที่/แนวเขต หรือ 4 สถานีที่ถอดข้อความไม่ครบ โปรดเปิดไฟล์ PDF ราชกิจจานุเบกษาฉบับจริงและยืนยันกับสถานีตำรวจต้นทางก่อนดำเนินการทางกฎหมาย';

let aiBusy = false;

function syncAiClear() {
  const qEl = $('#aiQ'), btn = $('#clearAiBtn'), cap = $('#aiCapsule');
  if (!qEl) return;
  const hasVal = qEl.value.length > 0;
  if (btn) btn.hidden = !hasVal;
  if (cap) cap.classList.toggle('has-value', hasVal);
}

function extractLocalAiTerms(rawQuery) {
  const cleaned = String(rawQuery || '')
    .normalize('NFC')
    .replace(/เหตุเกิดที่|เกิดเหตุที่|แจ้งความที่|แจ้ง\s*สภ\.?\s*ไหน|สภ\.?\s*ไหน|สน\.?\s*ไหน|โรงพักไหน|เขตอำนาจ|มีข้อยกเว้นหรือไม่|มีข้อยกเว้นไหม|รับผิดชอบบ้าง|รับผิดชอบ|เปลี่ยนแปลงอะไรบ้าง|อยู่ในเขต|พื้นที่|ช่วยตรวจสอบ|ตรวจสอบ/gu, ' ')
    .replace(/[?？!！,،]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const candidates = [];
  const push = (t) => {
    const v = String(t || '').trim();
    if (v.length >= 2 && !candidates.includes(v)) candidates.push(v);
  };

  /* ดึงชื่อหลัง ต./ตำบล/แขวง/อ./อำเภอ/สภ./สน. ก่อน */
  const adminRe = /(?:ต\.|ตำบล|แขวง|อ\.|อำเภอ|สภ\.|สน\.)\s*([ก-๙a-zA-Z0-9.\-]+)/gu;
  let m;
  while ((m = adminRe.exec(rawQuery)) !== null) {
    push(m[1]);
  }
  if (cleaned) {
    push(cleaned);
    for (const part of cleaned.split(/\s+/)) {
      push(stripAdminPrefix(part));
    }
    for (const w of segmentWords(cleaned)) {
      if (w.length >= 3) push(w);
    }
  }
  return candidates;
}

function renderAiCitationsHTML(citations) {
  if (!Array.isArray(citations) || !citations.length) return '';
  return `<div class="ai-sec">
    <div class="jur-sec-title">อ้างอิงราชกิจจานุเบกษา (ตรวจสอบเลขหน้าแล้ว)</div>
    <div class="ai-citations">
      ${citations.map(c => {
        const pageNum = Number(c.page_number) || 1;
        const href = `${c.pdf_url}#page=${pageNum}`;
        return `<a class="btn btn-outline btn-sm ai-cite-btn" href="${esc(href)}" target="_blank" rel="noopener">เปิด PDF ราชกิจจานุเบกษา หน้า ${pageNum} <small>(${esc(c.label || c.doc_code || 'ประกาศ ตร.')})</small></a>`;
      }).join('')}
    </div>
  </div>`;
}

function renderAiStationCardsHTML(stationsList) {
  if (!Array.isArray(stationsList) || !stationsList.length) return '';
  return `<div class="ai-sec">
    <div class="jur-sec-title">สถานีตำรวจที่เกี่ยวข้อง (ยืนยันจากฐานข้อมูล 1,484 แห่ง)</div>
    <div class="ai-station-list">
      ${stationsList.map(item => {
        const st = ST_BY_ID.get(Number(item.id)) || item;
        if (!st || !st.name) return '';
        const phoneHtml = jurPhoneLink(st);
        const regLabel = REGION_SHORT[st.region] || (st.region ? String(st.region) : '-');
        return `<article class="ai-station-card">
          <div class="ai-station-top">
            <div>
              <strong>${esc(st.name)}</strong>
              <div class="jur-meta"><span>จังหวัด${esc(st.province_th || '-')}</span><span>${esc(regLabel)}</span>${phoneHtml}</div>
            </div>
          </div>
          <p class="ai-station-addr">${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</p>
          ${item.note ? `<p class="ai-station-note">${esc(item.note)}</p>` : ''}
          <div class="jur-actions">
            <button class="btn btn-primary btn-sm" type="button" data-ai-detail="${st.id}">ดูรายละเอียดสถานี</button>
            ${hasAddress(st)
              ? `<button class="btn btn-outline btn-sm" type="button" data-ai-copy="${st.id}">คัดลอกที่อยู่</button>`
              : ''}
            <a class="btn btn-outline btn-sm" href="${esc(mapsLink(st))}" target="_blank" rel="noopener">นำทางไปโรงพัก</a>
          </div>
        </article>`;
      }).join('')}
    </div>
  </div>`;
}

function renderAiAnswer(data) {
  const box = $('#aiResults');
  if (!box) return;
  const exceptionsHtml = Array.isArray(data.boundary_exceptions) && data.boundary_exceptions.length
    ? `<div class="ai-sec">
        <div class="jur-sec-title">ข้อยกเว้น / แนวเขตที่ควรตรวจสอบเพิ่มเติม</div>
        <ul class="ai-list">${data.boundary_exceptions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`
    : '';

  const neighborsHtml = Array.isArray(data.neighbors) && data.neighbors.length
    ? `<div class="ai-sec">
        <div class="jur-sec-title">สถานีข้างเคียงสำหรับประสานงาน</div>
        <div class="ai-chips">${data.neighbors.map(n => `<button type="button" class="chip" data-ai-jump="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      </div>`
    : '';

  box.innerHTML = `<article class="jur-card ai-answer-card">
    <div class="ai-mode-badge is-edge">ตอบโดยผู้ช่วย AI ราชกิจจานุเบกษา · ผ่านการยืนยันรหัสสถานีและเลขหน้าแล้ว</div>
    <p class="ai-summary">${esc(data.summary || '')}</p>
    ${renderAiStationCardsHTML(data.stations)}
    ${exceptionsHtml}
    ${neighborsHtml}
    ${renderAiCitationsHTML(data.citations)}
    <p class="jur-warn ai-disclaimer">${esc(data.legal_disclaimer || AI_LEGAL_DISCLAIMER)}</p>
  </article>`;
}

async function runLocalAiFallback(rawQuery, reasonMsg) {
  const box = $('#aiResults');
  if (!box) return;
  const bannerMsg = reasonMsg || 'กำลังใช้โหมดค้นหาความเร็วสูงในเครื่อง (ออฟไลน์/สำรองอัตโนมัติ)';

  let jurData = jurState.data;
  if (!jurData) {
    try { jurData = await loadJurisdiction(); } catch { jurData = null; }
  }

  const terms = extractLocalAiTerms(rawQuery);
  let matchedHits = [];
  let matchedAddr = [];
  let matchedTerm = rawQuery;

  if (jurData) {
    for (const term of terms) {
      const res = jurFindCandidates(term);
      if (res.hits.length || res.addrHits.length) {
        matchedHits = res.hits;
        matchedAddr = res.addrHits;
        matchedTerm = term;
        break;
      }
    }
  }

  /* ค้นในย่อประกาศด้วย (สำหรับคำถามเชิงนโยบาย เช่น ฉบับที่ 2) */
  const digestMatches = jurData && Array.isArray(jurData.summary)
    ? jurData.summary.filter(c => {
        const hay = normJur([c.title, c.text, c.keys].join(' '));
        return terms.some(t => {
          const nt = normJur(t);
          return nt.length >= 2 && hay.includes(nt);
        });
      }).slice(0, 3)
    : [];

  const stationsFound = [];
  const seenSt = new Set();
  const citations = [];
  const seenCite = new Set();
  const warnings = [];
  const doc2567Url = 'https://ratchakitcha.soc.go.th/documents/17187.pdf';

  for (const h of matchedHits.slice(0, 6)) {
    const rec = jurData.stations[h.idx];
    const st = ST_BY_ID.get(rec.id);
    if (!st || seenSt.has(st.id)) continue;
    seenSt.add(st.id);
    const missing = rec.count - rec.tambons.length;
    const partialCount = rec.tambons.filter(t => t.partial).length;
    const noteParts = [`อำเภอ${rec.amphoe} · บัญชีแนบท้าย หน้า ${rec.page}`];
    if (partialCount > 0) {
      noteParts.push(`มี ${partialCount} ตำบลระบุบางส่วน/เฉพาะหมู่ที่/แนวเขต`);
      warnings.push(`${st.name} (หน้า ${rec.page}): มี ${partialCount} ตำบลที่ประกาศระบุ “บางส่วน/เฉพาะหมู่ที่/แนวเขต” ต้องตรวจสอบแนวเขตจริงใน PDF`);
    }
    if (missing > 0) {
      noteParts.push(`ถอดชื่อได้ ${rec.tambons.length}/${rec.count} ตำบล`);
      warnings.push(`${st.name} (หน้า ${rec.page}): ประกาศระบุ ${rec.count} ตำบล แต่ถอดข้อความได้ ${rec.tambons.length} ตำบล ต้องตรวจสอบประกาศฉบับจริง`);
    }
    stationsFound.push({ id: st.id, note: noteParts.join(' · ') });
    if (rec.page && !seenCite.has('2567:' + rec.page)) {
      seenCite.add('2567:' + rec.page);
      citations.push({ doc_code: '2567', label: 'ประกาศ ตร. 22 มี.ค. 2567', page_number: rec.page, pdf_url: doc2567Url });
    }
  }

  for (const ah of matchedAddr.slice(0, 3)) {
    const st = ST_BY_ID.get(ah.id);
    if (!st || seenSt.has(st.id)) continue;
    seenSt.add(st.id);
    stationsFound.push({ id: st.id, note: 'พบจากตำบล/แขวงที่ตั้งสถานีตามที่อยู่ (ไม่ใช่บัญชีเขตอำนาจตามประกาศ — โปรดยืนยันกับสถานี)' });
  }

  /* ถ้ายังไม่พบใน jurisdictions ให้ลองค้นชื่อสถานีจาก STATIONS โดยตรง */
  if (!stationsFound.length && !digestMatches.length) {
    for (const term of terms) {
      const { items } = getSuggestions(term);
      for (const it of items.slice(0, 4)) {
        if (!seenSt.has(it.st.id)) {
          seenSt.add(it.st.id);
          stationsFound.push({ id: it.st.id, note: 'พบจากฐานข้อมูลสถานีตำรวจในเครื่อง' });
        }
      }
      if (stationsFound.length) break;
    }
  }

  for (const dItem of digestMatches) {
    const src = (jurData.meta.sources || []).find(s => s.code === dItem.doc) || { label: 'ประกาศ ตร.', url: doc2567Url };
    const ck = `${dItem.doc}:${dItem.page}`;
    if (!seenCite.has(ck)) {
      seenCite.add(ck);
      citations.push({ doc_code: dItem.doc, label: src.label, page_number: dItem.page, pdf_url: src.url });
    }
  }

  const digestHtml = digestMatches.length
    ? `<div class="ai-sec">
        <div class="jur-sec-title">สรุปสาระสำคัญจากประกาศที่เกี่ยวข้อง</div>
        ${digestMatches.map(c => `<div class="ai-digest-hit"><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div>`).join('')}
      </div>`
    : '';

  const warnHtml = warnings.length
    ? `<div class="ai-sec">
        <div class="jur-sec-title">ข้อควรตรวจสอบแนวเขต / ข้อมูลถอดข้อความ</div>
        <ul class="ai-list">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>`
    : '';

  if (!stationsFound.length && !digestMatches.length) {
    box.innerHTML = `<article class="jur-card ai-answer-card">
      <div class="ai-mode-badge is-fallback">${esc(bannerMsg)}</div>
      <div class="jur-empty">
        <h3>ไม่พบข้อมูลที่ตรงกับ “${esc(rawQuery)}” ในฐานข้อมูลเครื่อง</h3>
        <p>ลองระบุชื่อตำบล แขวง อำเภอ จังหวัด หรือชื่อ สภ./สน. ให้ชัดเจนขึ้น หรือเปิดไฟล์ PDF ราชกิจจานุเบกษาฉบับจริง</p>
        <a class="btn btn-outline btn-sm" href="${doc2567Url}" target="_blank" rel="noopener">เปิดประกาศ ตร. 2567 (PDF)</a>
      </div>
      <p class="jur-warn ai-disclaimer">${esc(AI_LEGAL_DISCLAIMER)}</p>
    </article>`;
    return;
  }

  const summaryText = stationsFound.length
    ? `สลับมาใช้การค้นหาในเครื่องอัตโนมัติ: พบ ${stationsFound.length} สถานีที่เกี่ยวข้องกับ “${matchedTerm}”`
    : `สลับมาใช้การค้นหาในเครื่องอัตโนมัติ: พบ ${digestMatches.length} หัวข้อสรุปประกาศที่เกี่ยวข้องกับคำถามของคุณ`;

  box.innerHTML = `<article class="jur-card ai-answer-card">
    <div class="ai-mode-badge is-fallback">${esc(bannerMsg)}</div>
    <p class="ai-summary">${esc(summaryText)}</p>
    ${renderAiStationCardsHTML(stationsFound)}
    ${digestHtml}
    ${warnHtml}
    ${renderAiCitationsHTML(citations)}
    <p class="jur-warn ai-disclaimer">${esc(AI_LEGAL_DISCLAIMER)}</p>
  </article>`;
}

async function submitAiSearch(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (q.length < 2) {
    showToast('กรุณาพิมพ์คำถามอย่างน้อย 2 ตัวอักษร');
    return;
  }
  if (aiBusy) return;
  aiBusy = true;

  const input = $('#aiQ');
  if (input) input.value = q;
  syncAiClear();

  const submitBtn = $('#aiSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  const box = $('#aiResults');
  if (box) {
    box.innerHTML = `<div class="jur-empty ai-loading"><h3>กำลังค้นหาและตรวจสอบกับราชกิจจานุเบกษา…</h3><p>ระบบกำลังยืนยันรหัสสถานีและเลขหน้าประกาศฉบับจริง</p></div>`;
  }
  emitCapsulePulse(0.85, 620);

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await runLocalAiFallback(q, 'ขณะนี้อยู่ในโหมดออฟไลน์ ระบบสลับมาใช้การค้นหาในเครื่องให้อัตโนมัติ');
      return;
    }

    const res = await fetch('/api/ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });

    if (!res.ok) {
      await runLocalAiFallback(q, 'ไม่สามารถเชื่อมต่อผู้ช่วย AI ได้ในขณะนี้ ระบบสลับมาใช้การค้นหาในเครื่องให้อัตโนมัติ');
      return;
    }

    const data = await res.json();
    if (data && data.ok) {
      renderAiAnswer(data);
    } else {
      await runLocalAiFallback(q, (data && data.message) || 'ระบบสลับมาใช้การค้นหาความเร็วสูงในเครื่องให้อัตโนมัติ');
    }
  } catch {
    await runLocalAiFallback(q, 'ไม่สามารถเชื่อมต่อเครือข่ายได้ ระบบสลับมาใช้การค้นหาในเครื่องให้อัตโนมัติ');
  } finally {
    aiBusy = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

function bindAiAssistantEvents() {
  const form = $('#aiForm');
  const input = $('#aiQ');
  if (!form || !input) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitAiSearch(input.value);
  });

  input.addEventListener('input', syncAiClear);

  $('#clearAiBtn')?.addEventListener('click', () => {
    input.value = '';
    syncAiClear();
    input.focus();
  });

  $('.ai-hints')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-aiq]');
    if (chip) {
      input.value = chip.dataset.aiq;
      syncAiClear();
      submitAiSearch(chip.dataset.aiq);
    }
  });

  $('#aiResults')?.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-ai-copy]');
    if (copy) {
      const st = ST_BY_ID.get(+copy.dataset.aiCopy);
      if (st) copyStation(st, copy);
      return;
    }
    const detail = e.target.closest('[data-ai-detail]');
    if (detail) {
      openStationModal(+detail.dataset.aiDetail);
      return;
    }
    const jump = e.target.closest('[data-ai-jump]');
    if (jump) {
      setJurTab('jur');
      jurSearch(jump.dataset.aiJump);
    }
  });

  /* Web Speech API (th-TH) สำหรับผู้ช่วย AI */
  setupVoiceButton({
    btn: $('#aiVoiceBtn'),
    input,
    onInterim: (text) => {
      if ($('#clearAiBtn')) $('#clearAiBtn').hidden = !text;
      syncAiClear();
    },
    onFinal: (text) => {
      submitAiSearch(text);
    },
  });
}

function initJurisdiction() {
  buildAddressIndex();
  bindJurisdictionEvents();
  if (jurParams.tab === 'digest') setJurTab('digest');
  else if (jurParams.tab === 'ai') setJurTab('ai');
  else setJurTab('jur');
  if (jurParams.q || jurParams.tab !== 'jur') {
    loadJurisdiction().then(afterJurisdictionLoaded).catch(jurisLoadFailed);
  } else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        loadJurisdiction().then(afterJurisdictionLoaded).catch(jurisLoadFailed);
        io.disconnect();
      }
    }, { rootMargin: '400px' });
    io.observe($('#jurisdiction'));
  } else {
    loadJurisdiction().then(afterJurisdictionLoaded).catch(jurisLoadFailed);
  }
}

/* ---------- Events: Station Page ---------- */
function bindStationEvents() {
  const input = $('#searchInput');
  input?.addEventListener('input', (e) => {
    const v = e.target.value;
    $('#searchHub')?.classList.toggle('has-value', !!v);
    if (v.trim()) { emitCapsulePulse(0.7); renderSuggest(v); }
    else closeSuggest();
  });

  input?.addEventListener('keydown', (e) => {
    const open = suggestPanel && !suggestPanel.hidden;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      if (!open && input.value.trim()) renderSuggest(input.value);
      const pick = (sugState.active >= 0 && sugState.items[sugState.active]) || sugState.items[0];
      if (pick) copyStation(pick.st);
      else if (selected) copyStation(selected);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && input.value.trim()) renderSuggest(input.value);
      else moveSug(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) moveSug(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && sugState.active >= 0 && sugState.items[sugState.active]) {
        applySearch(input.value, sugState.items[sugState.active].st);
      } else {
        applySearch(input.value);
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); closeSuggest(); }
      else if (input.value) { e.preventDefault(); e.stopPropagation(); resetAll(); }
    } else if (e.key === 'Tab') {
      closeSuggest();
    }
  });

  $('#searchForm')?.addEventListener('submit', e => { e.preventDefault(); applySearch(input.value); });

  suggestPanel?.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const st = ST_BY_ID.get(+cp.dataset.copy);
      if (st) copyStation(st, cp);
      return;
    }
    if (e.target.closest('#sugAll')) { applySearch(input.value); return; }
    const row = e.target.closest('[data-id]');
    if (row) {
      const st = ST_BY_ID.get(+row.dataset.id);
      if (st) applySearch(input.value, st);
    }
  });

  $('#clearBtn')?.addEventListener('click', resetAll);
  $('#brandHomeLink')?.addEventListener('click', (e) => {
    if (document.body.classList.contains('has-results')) {
      e.preventDefault();
      resetAll();
    }
  });
  $('#browseAllBtn')?.addEventListener('click', () => {
    state.q = '';
    state.province = '';
    state.region = 'all';
    state.savedOnly = false;
    state.page = 1;
    setResultsState(true);
    scanStart();
    renderResults();
  });
  $('#idleSavedBtn')?.addEventListener('click', () => {
    state.q = '';
    state.province = '';
    state.region = 'all';
    state.savedOnly = true;
    state.page = 1;
    setResultsState(true);
    scanStart();
    renderResults();
  });

  $('#resultsList')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) { const st = ST_BY_ID.get(+b.dataset.id); if (st) selectStation(st); }
  });

  $('#hudCopyBtn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (selected) copyStation(selected, btn);
  });

  $('#regionChips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-region]');
    if (!b) return;
    state.region = b.dataset.region;
    state.page = 1;
    renderResults();
  });

  $('#toggleSavedOnly')?.addEventListener('click', () => {
    state.savedOnly = !state.savedOnly;
    updateSavedUI();
    state.page = 1;
    renderResults();
  });

  $('#pager')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.page = +btn.dataset.page;
    renderResults();
    $('#resultsList')?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* Province combobox */
  $('#provinceBtn')?.addEventListener('click', () => { comboState.open ? closeCombo(true) : openCombo(); });
  $('#provinceSearch')?.addEventListener('input', (e) => { renderComboList(e.target.value); });
  $('#provinceSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveComboActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveComboActive(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = comboState.active >= 0 ? comboState.active : 0;
      if (comboState.items[idx]) setProvince(comboState.items[idx].value);
    } else if (e.key === 'Escape') { e.preventDefault(); closeCombo(true); }
    else if (e.key === 'Tab') { closeCombo(false); }
  });
  $('#provinceList')?.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-province]');
    if (opt) setProvince(opt.dataset.province);
  });

  $('#clearFiltersBtn')?.addEventListener('click', resetFilters);
  $('#printListBtn')?.addEventListener('click', printFilteredList);
  $('#exportCsvBtn')?.addEventListener('click', exportCSV);

  document.addEventListener('click', (e) => {
    if (suggestPanel && !suggestPanel.hidden && !e.target.closest('#searchHub')) closeSuggest();
    if (comboState.open && !e.target.closest('#provinceCombo')) closeCombo(false);
  });

  /* Voice search (th-TH) */
  setupVoiceButton({
    btn: $('#voiceBtn'),
    input,
    onInterim: (text) => {
      $('#searchHub')?.classList.toggle('has-value', !!text);
      renderSuggest(text);
    },
    onFinal: (text) => {
      emitCapsulePulse(1, 640);
      applySearch(text);
    },
  });
}

/* ---------- Shared Real-Time Thai Voice Search Helper ---------- */
function setupVoiceButton({ btn, input, onInterim, onFinal }) {
  if (!btn || !input) return;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    btn.style.display = 'none';
    btn.addEventListener('click', () => {
      showToast('เบราว์เซอร์นี้ไม่รองรับการค้นหาด้วยเสียง กรุณาเปิดใน Chrome หรือ Safari');
    });
    return;
  }

  btn.style.display = 'inline-flex';
  btn.setAttribute('aria-pressed', 'false');

  let activeRec = null;
  let isListening = false;
  const origPlaceholder = input.placeholder || '';

  btn.addEventListener('click', () => {
    if (isListening && activeRec) {
      try { activeRec.stop(); } catch { /* ignore */ }
      return;
    }

    const rec = new SpeechRec();
    activeRec = rec;
    rec.lang = 'th-TH';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let latestText = '';
    let finalized = false;

    rec.onstart = () => {
      isListening = true;
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      input.placeholder = 'กำลังฟังเสียงพูด... พูดชื่อสถานี จังหวัด หรือตำบลได้เลย';
      showToast('กำลังฟังเสียงพูดภาษาไทย... พูดได้เลย');
      emitCapsulePulse(0.9, 480);
    };

    rec.onresult = (ev) => {
      const raw = Array.from(ev.results || [])
        .map(r => (r && r[0] && r[0].transcript) || '')
        .join(' ')
        .trim();
      const clean = raw.replace(/[.。]+$/g, '').trim();
      if (clean) {
        latestText = clean;
        input.value = clean;
        if (typeof onInterim === 'function') onInterim(clean);
      }
      const lastRes = ev.results && ev.results[ev.results.length - 1];
      if (lastRes && lastRes.isFinal && latestText) {
        finalized = true;
        if (typeof onFinal === 'function') onFinal(latestText);
      }
    };

    rec.onerror = (ev) => {
      const code = ev && ev.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        showToast('ไม่ได้รับสิทธิ์ใช้ไมโครโฟน — กรุณากดไอคอนหน้าแถบ URL เพื่ออนุญาตไมโครโฟน');
      } else if (code === 'audio-capture') {
        showToast('ไม่พบไมโครโฟนในอุปกรณ์ของคุณ');
      } else if (code === 'no-speech') {
        showToast('ไม่ได้ยินเสียงพูด — ลองกดไมโครโฟนแล้วพูดใหม่อีกครั้ง');
      } else if (code === 'network') {
        showToast('บริการรับเสียงของเบราว์เซอร์ขัดข้อง — กรุณาพิมพ์ค้นหาแทน');
      } else if (code !== 'aborted') {
        showToast('ไม่สามารถรับเสียงพูดได้ในขณะนี้ ลองกดใหม่อีกครั้ง');
      }
    };

    rec.onend = () => {
      isListening = false;
      activeRec = null;
      btn.classList.remove('is-active');
      btn.setAttribute('aria-pressed', 'false');
      input.placeholder = origPlaceholder;
      if (!finalized && latestText) {
        finalized = true;
        if (typeof onFinal === 'function') onFinal(latestText);
      }
    };

    try {
      rec.start();
    } catch {
      isListening = false;
      activeRec = null;
      btn.classList.remove('is-active');
      btn.setAttribute('aria-pressed', 'false');
      input.placeholder = origPlaceholder;
      showToast('ไม่สามารถเริ่มรับเสียงพูดได้ ลองกดไมโครโฟนใหม่อีกครั้ง');
    }
  });
}

/* ---------- Crowdsourced Data Verification Modal (#reportModal) ---------- */
const REPORT_FIELD_LABELS = {
  address: 'ที่อยู่สถานี',
  phone: 'หมายเลขโทรศัพท์',
  fax: 'หมายเลขโทรสาร (แฟกซ์)',
  website: 'เว็บไซต์ทางการ',
  other: 'ข้อมูลอื่นๆ',
};

let reportLastFocus = null;
let reportStation = null;
let reportSubmitting = false;

function getReportCurrentValue(st, fieldType) {
  if (!st) return 'ไม่มีข้อมูล';
  if (fieldType === 'phone') return formatPhoneDisplay(st.phone) || 'ไม่มีข้อมูล';
  if (fieldType === 'fax') return formatPhoneDisplay(st.fax) || 'ไม่มีข้อมูล';
  if (fieldType === 'address') return st.address || 'ไม่มีข้อมูล';
  if (fieldType === 'website') return st.website || 'ไม่มีข้อมูล';
  return 'ระบุรายละเอียดในช่องข้อมูลที่ถูกต้อง';
}

function buildReportMailto(st, fieldType, suggestedVal, sourceRef, reporter) {
  const label = REPORT_FIELD_LABELS[fieldType] || fieldType;
  const currentVal = getReportCurrentValue(st, fieldType);
  const subject = `แจ้งข้อมูลคลาดเคลื่อน (${label}) — ${st.name}`;
  const body = [
    `สถานี: ${st.name} (ID: ${st.id})`,
    `จังหวัด: ${st.province_th}`,
    `ประเภทข้อมูล: ${label}`,
    `ข้อมูลปัจจุบันในระบบ: ${currentVal}`,
    `ข้อมูลที่ถูกต้อง: ${suggestedVal || ''}`,
    sourceRef ? `แหล่งอ้างอิง: ${sourceRef}` : '',
    reporter ? `ผู้แจ้ง: ${reporter}` : '',
  ].filter(Boolean).join('\n');
  return `mailto:akaradje07@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function syncReportCurrentAndMailto() {
  if (!reportStation) return;
  const fieldType = $('#reportFieldType')?.value || 'address';
  const curEl = $('#reportCurrentValue');
  if (curEl) curEl.textContent = getReportCurrentValue(reportStation, fieldType);
  const mailtoBtn = $('#reportMailtoFallback');
  if (mailtoBtn) {
    mailtoBtn.href = buildReportMailto(
      reportStation,
      fieldType,
      $('#reportSuggested')?.value.trim() || '',
      $('#reportSource')?.value.trim() || '',
      $('#reportReporter')?.value.trim() || ''
    );
  }
}

function showReportFeedback(kind, message, mailtoHref) {
  const box = $('#reportFeedback');
  if (!box) return;
  box.hidden = false;
  box.className = `report-feedback is-${kind}`;
  box.innerHTML = esc(message) + (mailtoHref
    ? ` <a class="report-mailto-inline" href="${esc(mailtoHref)}">เปิดแอปอีเมลพร้อมข้อความที่กรอกไว้ →</a>`
    : '');
}

function openReportModal(stationId) {
  const repModal = $('#reportModal');
  const st = ST_BY_ID.get(Number(stationId));
  if (!repModal || !st) return;

  reportStation = st;
  reportLastFocus = document.activeElement;

  const idInput = $('#reportStationId');
  if (idInput) idInput.value = String(st.id);
  const meta = $('#reportStationMeta');
  if (meta) meta.textContent = `${st.name} · จังหวัด${st.province_th}`;
  const title = $('#reportModalTitle');
  if (title) title.textContent = 'แจ้งข้อมูลคลาดเคลื่อน';

  const fieldSel = $('#reportFieldType');
  if (fieldSel) fieldSel.value = 'address';
  const sug = $('#reportSuggested');
  if (sug) sug.value = '';
  const src = $('#reportSource');
  if (src) src.value = '';
  const rep = $('#reportReporter');
  if (rep) rep.value = '';
  const hp = $('#reportHp');
  if (hp) hp.value = '';
  const fb = $('#reportFeedback');
  if (fb) { fb.hidden = true; fb.textContent = ''; }
  const submitBtn = $('#reportSubmitBtn');
  if (submitBtn) submitBtn.disabled = false;

  syncReportCurrentAndMailto();

  repModal.classList.add('open');
  repModal.setAttribute('aria-hidden', 'false');
  repModal.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
  (sug || fieldSel || $('#reportModalClose'))?.focus();
}

function closeReportModal() {
  const repModal = $('#reportModal');
  if (!repModal || !repModal.classList.contains('open')) return;
  repModal.classList.remove('open');
  repModal.setAttribute('aria-hidden', 'true');
  repModal.setAttribute('inert', '');
  if (!modal || !modal.classList.contains('open')) {
    document.body.style.overflow = '';
  }
  if (reportLastFocus && reportLastFocus.focus) reportLastFocus.focus();
}

function bindReportModalEvents() {
  const repModal = $('#reportModal');
  const form = $('#reportForm');
  if (!repModal || !form) return;

  $('#reportModalClose')?.addEventListener('click', closeReportModal);
  $('#reportCancelBtn')?.addEventListener('click', closeReportModal);
  repModal.addEventListener('click', (e) => { if (e.target === repModal) closeReportModal(); });

  repModal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = $$('a[href], button:not([disabled]), input:not([tabindex="-1"]):not([type="hidden"]), select, textarea', repModal)
      .filter(el => el.getClientRects().length);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $('#reportFieldType')?.addEventListener('change', syncReportCurrentAndMailto);
  $('#reportSuggested')?.addEventListener('input', syncReportCurrentAndMailto);
  $('#reportSource')?.addEventListener('input', syncReportCurrentAndMailto);
  $('#reportReporter')?.addEventListener('input', syncReportCurrentAndMailto);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (reportSubmitting || !reportStation) return;

    const fieldType = $('#reportFieldType')?.value || 'address';
    const suggestedVal = ($('#reportSuggested')?.value || '').trim();
    const sourceRef = ($('#reportSource')?.value || '').trim();
    const reporter = ($('#reportReporter')?.value || '').trim();
    const websiteHp = ($('#reportHp')?.value || '').trim();

    if (suggestedVal.length < 2) {
      showReportFeedback('error', 'กรุณากรอกข้อมูลที่ถูกต้องอย่างน้อย 2 ตัวอักษร');
      $('#reportSuggested')?.focus();
      return;
    }

    const mailtoHref = buildReportMailto(reportStation, fieldType, suggestedVal, sourceRef, reporter);
    syncReportCurrentAndMailto();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      showReportFeedback('warn', 'ขณะนี้อยู่ในโหมดออฟไลน์ กรุณาส่งคำแจ้งผ่านอีเมลแทน', mailtoHref);
      return;
    }

    reportSubmitting = true;
    const submitBtn = $('#reportSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station_id: String(reportStation.id),
          field_type: fieldType,
          suggested_value: suggestedVal,
          source_ref: sourceRef,
          reporter,
          website_hp: websiteHp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showReportFeedback('ok', data.message || 'ขอบคุณครับ ข้อมูลของคุณเข้าสู่คิวตรวจสอบของผู้ดูแลแล้ว');
        showToast('ส่งคำแจ้งตรวจสอบเรียบร้อยแล้ว');
        if ($('#reportSuggested')) $('#reportSuggested').value = '';
      } else if (data && data.fallback === 'mailto') {
        showReportFeedback('warn', data.message || 'ระบบรับแจ้งออนไลน์ยังไม่พร้อมใช้งาน กรุณาส่งผ่านอีเมลแทน', mailtoHref);
      } else {
        showReportFeedback('error', (data && data.message) || 'ไม่สามารถส่งคำแจ้งได้ในขณะนี้ กรุณาส่งผ่านอีเมลแทน', mailtoHref);
      }
    } catch {
      showReportFeedback('warn', 'เชื่อมต่อระบบรับแจ้งไม่สำเร็จ กรุณาส่งผ่านอีเมลแทน', mailtoHref);
    } finally {
      reportSubmitting = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

/* ---------- Global Events (Theme, Modal, Keys, Back-to-top) ---------- */
function bindGlobalEvents() {
  $('#themeToggle')?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
    emitCapsulePulse(0.8, 560);
  });
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      let stored = null;
      try { stored = localStorage.getItem('ps:theme'); } catch { /* ignore */ }
      if (!stored) applyTheme(e.matches ? 'dark' : 'light', false);
    });
  } catch { /* older browsers */ }

  /* Modal */
  if (modal) {
    $('#modalClose')?.addEventListener('click', closeStationModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeStationModal(); });
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = $$('a[href], button:not([disabled]), iframe, input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
        .filter(el => el.getClientRects().length);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    $('#dCopy')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const st = ST_BY_ID.get(+btn.dataset.id);
      if (st) copyStation(st, btn);
    });
    $('#dPrint')?.addEventListener('click', (e) => {
      const st = ST_BY_ID.get(+e.currentTarget.dataset.id);
      if (st) printStation(st);
    });
    $('#dShare')?.addEventListener('click', (e) => {
      const st = ST_BY_ID.get(+e.currentTarget.dataset.id);
      if (!st) return;
      const phoneText = formatPhoneDisplay(st.phone) || 'ไม่มีข้อมูล';
      const addrText = st.address || 'ไม่มีข้อมูล';
      shareOrCopy({
        title: `${st.name} — KadeeHub`,
        text: `${st.name} (${st.province_th})\nโทร: ${phoneText}\nที่อยู่: ${addrText}`,
        url: stationShareUrl(st),
      });
    });
    $('#dSave')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const id = +btn.dataset.id;
      toggleSave(id);
      const on = state.saved.has(id);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? 'บันทึกแล้ว ✓' : 'บันทึกสถานีนี้';
    });
    $('#dJurisdiction')?.addEventListener('click', () => {
      const id = +($('#dSave')?.dataset.id || 0);
      if (!id) return;
      const st = ST_BY_ID.get(id);
      const jq = st ? st.name.replace(/^สภ\.|^สน\./, '').trim() : '';
      closeStationModal();
      if ($('#jurForm')) { setJurTab('jur'); jurSearch(jq); }
      else window.location.href = 'jurisdiction.html?j=' + encodeURIComponent(jq) + '&jtab=jur';
    });
    $('#dReport')?.addEventListener('click', (e) => {
      const id = +(e.currentTarget.dataset.id || $('#dSave')?.dataset.id || 0);
      if (id && $('#reportModal')) {
        e.preventDefault();
        openReportModal(id);
      }
    });
  }

  bindReportModalEvents();

  /* Global keyboard shortcuts */
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      const target = $('#searchInput') || $('#jurQ');
      if (target) { target.focus(); target.select(); emitCapsulePulse(1, 640); }
    } else if (e.key === 'Escape') {
      const repModal = $('#reportModal');
      if (repModal && repModal.classList.contains('open')) {
        e.preventDefault();
        closeReportModal();
      } else if (modal && modal.classList.contains('open')) {
        e.preventDefault();
        closeStationModal();
      } else if ($('#searchInput')?.value && document.activeElement !== $('#searchInput') && !$('.manual-copy')) {
        resetAll();
      }
    }
  });

  /* Back to top */
  const toTop = $('#toTop');
  if (toTop) {
    toTop.hidden = false;
    const onScroll = () => toTop.classList.toggle('show', window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }
}

/* ---------- Boot ---------- */
const isStationPage = !!$('#resultsList');
const isJurPage = !!$('#jurForm');

/* ลิงก์เก่าที่ชี้ ?j=… (สมัยที่เขตอำนาจอยู่หน้าเดียวกับสารบบ) → พาไปหน้าเขตอำนาจ */
if (isStationPage) {
  const legacy = new URLSearchParams(window.location.search);
  if (legacy.get('j') || legacy.get('jtab')) {
    window.location.replace('jurisdiction.html' + window.location.search);
  }
}

applyTheme(document.documentElement.dataset.theme || 'dark', false);
bindGlobalEvents();
trackVisit();

if (isJurPage) {
  applyJurURL();
  initJurisdiction();
} else if (isStationPage) {
  const idleCnt = $('#idleStationCount');
  if (idleCnt) idleCnt.textContent = STATIONS.length.toLocaleString('th-TH');
  applyURL();
  updateProvinceLabel();
  updateSavedUI();
  renderRegionChips();
  bindStationEvents();

  if (pendingStationId !== null) {
    const deepSt = ST_BY_ID.get(pendingStationId);
    pendingStationId = null;
    if (deepSt) {
      setResultsState(true);
      if ($('#searchInput')?.value) $('#searchHub')?.classList.add('has-value');
      const list = getFiltered();
      const idx = list.findIndex(s => s.id === deepSt.id);
      if (idx >= 0) {
        state.page = Math.floor(idx / PER_PAGE) + 1;
      }
      selected = deepSt;
      renderResults();
      openStationModal(deepSt.id);
    }
  } else if (state.q || state.province || state.region !== 'all' || state.page > 1 || state.sort !== 'region') {
    setResultsState(true);
    if ($('#searchInput')?.value) $('#searchHub')?.classList.add('has-value');
    renderResults();
  }

  const hint = $('#inlineStatus');
  if (hint) {
    const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
    hint.textContent = mac
      ? 'พิมพ์ชื่อสถานีแล้วกด Enter ดูผล · ⌘+Enter คัดลอกที่อยู่ทันที'
      : 'พิมพ์ชื่อสถานีแล้วกด Enter ดูผล · Ctrl+Enter คัดลอกที่อยู่ทันที';
  }
}
