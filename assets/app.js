/* ============================================================
   PS Locator — App logic
   Static, dependency-free. Data: window.STATIONS (data/stations.js)
   ============================================================ */
'use strict';

/* ---------- Region metadata (ตร.แบ่ง 10 กองบัญชาการ) ---------- */
const REGIONS = [
  { id: 'all',  short: 'ทั้งหมด', name: 'ทุกกองบัญชาการ' },
  { id: 'bkk',  short: 'บช.น.',   name: 'กองบัญชาการตำรวจนครบาล' },
  { id: 'p1',   short: 'ภ.1',     name: 'กองบัญชาการตำรวจภูธรภาค 1' },
  { id: 'p2',   short: 'ภ.2',     name: 'กองบัญชาการตำรวจภูธรภาค 2' },
  { id: 'p3',   short: 'ภ.3',     name: 'กองบัญชาการตำรวจภูธรภาค 3' },
  { id: 'p4',   short: 'ภ.4',     name: 'กองบัญชาการตำรวจภูธรภาค 4' },
  { id: 'p5',   short: 'ภ.5',     name: 'กองบัญชาการตำรวจภูธรภาค 5' },
  { id: 'p6',   short: 'ภ.6',     name: 'กองบัญชาการตำรวจภูธรภาค 6' },
  { id: 'p7',   short: 'ภ.7',     name: 'กองบัญชาการตำรวจภูธรภาค 7' },
  { id: 'p8',   short: 'ภ.8',     name: 'กองบัญชาการตำรวจภูธรภาค 8' },
  { id: 'p9',   short: 'ภ.9',     name: 'กองบัญชาการตำรวจภูธรภาค 9' },
];
const REGION_NAME = Object.fromEntries(REGIONS.map(r => [r.id, r.name]));
const REGION_SHORT = Object.fromEntries(REGIONS.map(r => [r.id, r.short]));
const REGION_ORDER = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));

const STATIONS = (window.STATIONS || []).slice();
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

/* พารามิเตอร์ของพื้นที่งานเขตอำนาจ — แยกจาก state เดิม
   ใช้คีย์ใหม่ (j, jtab) เพื่อไม่กระทบลิงก์แชร์เดิม q/province/region/sort/page */
const jurParams = { q: '', tab: 'jur' };

/* ---------- Helpers ---------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Normalize Thai text for forgiving search: NFC + remove spacing/punct + strip สน./สภ. prefixes */
function norm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/สถานีตำรวจ/g, '')
    .replace(/สน\.|สภ\./g, '')
    .replace(/[\s\-‐-―.,()\/\\]+/g, '');
}

/* Precomputed normalized haystack per station (built once — keeps typing fast). */
const HAY = new Map();
for (const st of STATIONS) {
  HAY.set(st.id, {
    name: norm(st.name),
    addr: norm(st.address),
    prov: norm(st.province_th),
    phone: norm(st.phone),
    region: norm(REGION_SHORT[st.region] || ''),
  });
}

/* Province list with station counts, sorted ก–ฮ. */
const PROVINCES = (() => {
  const m = new Map();
  for (const st of STATIONS) m.set(st.province_th, (m.get(st.province_th) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'th'));
})();

function stationMatches(st, qNorm) {
  if (!qNorm) return true;
  const h = HAY.get(st.id);
  return h.name.includes(qNorm) || h.addr.includes(qNorm) || h.prov.includes(qNorm) || h.phone.includes(qNorm) || h.region.includes(qNorm);
}

function getFiltered() {
  const qNorm = norm(state.q);
  let list = STATIONS.filter(st =>
    stationMatches(st, qNorm) &&
    (!state.province || st.province_th === state.province) &&
    (state.region === 'all' || st.region === state.region) &&
    (!state.savedOnly || state.saved.has(st.id))
  );
  const regionOrder = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));
  switch (state.sort) {
    case 'name':
      list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      break;
    case 'province':
      list.sort((a, b) => a.province_th.localeCompare(b.province_th, 'th') || a.name.localeCompare(b.name, 'th'));
      break;
    case 'region':
    default:
      list.sort((a, b) => (regionOrder[a.region] - regionOrder[b.region]) || a.province_th.localeCompare(b.province_th, 'th') || a.name.localeCompare(b.name, 'th'));
  }
  return list;
}

function formatPhoneDisplay(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 9) return d.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{3})(\d{4,5})/, '$1-$2-$3');
  return p;
}
const mapsLink = (st) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(st.name + ' ' + st.address);
const mapsEmbed = (st) => 'https://www.google.com/maps?q=' + encodeURIComponent(st.name + ' ' + st.address) + '&output=embed';

/** Escape-safe highlight of the raw query inside a text (exact substring, case-insensitive). */
function hl(text, qRaw) {
  const t = String(text ?? '');
  const needle = String(qRaw ?? '').trim().toLowerCase();
  if (!needle) return esc(t);
  const lower = t.toLowerCase();
  const ranges = [];
  let idx = lower.indexOf(needle);
  while (idx !== -1 && ranges.length < 12) {
    ranges.push([idx, idx + needle.length]);
    idx = lower.indexOf(needle, idx + needle.length);
  }
  if (!ranges.length) return esc(t);
  let out = '', pos = 0;
  for (const [a, b] of ranges) {
    out += esc(t.slice(pos, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>';
    pos = b;
  }
  return out + esc(t.slice(pos));
}

/* ---------- Theme (light / dark) ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ps:theme', t); } catch { /* private mode */ }
  const btn = $('#themeToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.setAttribute('aria-label', t === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด');
    btn.title = t === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด';
  }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0F141B' : '#F7F6F2';
}

/* ---------- Province combobox ---------- */
const comboState = { open: false, active: -1, items: [] };

function renderComboList(filterRaw) {
  const fn = norm(filterRaw);
  const opts = [{ value: '', label: 'ทุกจังหวัด', count: STATIONS.length }]
    .concat(PROVINCES.filter(p => !fn || norm(p.name).includes(fn)).map(p => ({ value: p.name, label: p.name, count: p.count })));
  comboState.items = opts;
  comboState.active = -1;
  const list = $('#provinceList');
  $('#provinceSearch').removeAttribute('aria-activedescendant');
  if (!opts.length) { list.innerHTML = '<li class="combo-empty">ไม่พบจังหวัดที่ค้นหา</li>'; return; }
  list.innerHTML = opts.map((o, i) =>
    `<li class="combo-opt" role="option" id="prov-${i}" data-province="${esc(o.value)}" aria-selected="${o.value === state.province}"><span>${esc(o.label)}</span><span class="cnt">${o.count.toLocaleString('th-TH')}</span></li>`
  ).join('');
}

function moveComboActive(delta) {
  const rows = $$('.combo-opt', $('#provinceList'));
  if (!rows.length) return;
  let next = comboState.active + delta;
  if (next < 0) next = rows.length - 1;
  if (next >= rows.length) next = 0;
  comboState.active = next;
  rows.forEach((r, i) => r.classList.toggle('active', i === next));
  rows[next].scrollIntoView({ block: 'nearest' });
  $('#provinceSearch').setAttribute('aria-activedescendant', rows[next].id);
}

function openCombo() {
  comboState.open = true;
  $('#provincePop').hidden = false;
  $('#provinceBtn').setAttribute('aria-expanded', 'true');
  const s = $('#provinceSearch');
  s.value = '';
  renderComboList('');
  s.focus();
  const sel = $('#provinceList [aria-selected="true"]');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function closeCombo(refocus = true) {
  if (!comboState.open) return;
  comboState.open = false;
  $('#provincePop').hidden = true;
  $('#provinceBtn').setAttribute('aria-expanded', 'false');
  $('#provinceSearch').removeAttribute('aria-activedescendant');
  if (refocus) $('#provinceBtn').focus();
}

function setProvince(v) {
  state.province = v;
  updateProvinceLabel();
  closeCombo(true);
  state.page = 1;
  renderResults();
}

/* ---------- Populate controls ---------- */
function updateProvinceLabel() {
  const el = $('#provinceLabel');
  if (!el) return;
  el.textContent = state.province || `ทุกจังหวัด (${PROVINCES.length})`;
}

function regionCounts() {
  const qn = norm(state.q);
  const counts = { all: 0 };
  for (const r of REGIONS) if (r.id !== 'all') counts[r.id] = 0;
  for (const st of STATIONS) {
    if (!stationMatches(st, qn)) continue;
    if (state.province && st.province_th !== state.province) continue;
    if (state.savedOnly && !state.saved.has(st.id)) continue;
    counts.all++;
    counts[st.region] = (counts[st.region] || 0) + 1;
  }
  return counts;
}

function renderRegionChips() {
  const counts = regionCounts();
  $('#regionChips').innerHTML = REGIONS.map(r =>
    `<button class="rchip" type="button" data-region="${esc(r.id)}" aria-pressed="${r.id === state.region}" title="${esc(r.name)}">${esc(r.short)}<span class="cnt">${(counts[r.id] || 0).toLocaleString('th-TH')}</span></button>`
  ).join('');
}

function renderStats() {
  const stationsEl = $('#statStations');
  if (!stationsEl) return;
  stationsEl.textContent = STATIONS.length.toLocaleString('th-TH');
  $('#statProvinces').textContent = PROVINCES.length;
}

function syncSearchClear() {
  const qEl = $('#q'), btn = $('#clearSearchBtn'), kbd = $('#searchKbd');
  if (!qEl || !btn) return;
  const hasVal = qEl.value.length > 0;
  btn.hidden = !hasVal;
  if (kbd) kbd.hidden = hasVal;
}

async function trackVisit() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') return;
  try {
    const res = await fetch('/api/visit', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    const visEl = $('#statVisitors'), viewsEl = $('#statViews');
    if (visEl && typeof data.visitors === 'number') visEl.textContent = data.visitors.toLocaleString('th-TH');
    if (viewsEl && typeof data.views === 'number') viewsEl.textContent = data.views.toLocaleString('th-TH');
  } catch { /* offline or static host */ }
}

/* ---------- Rendering cards ---------- */
function saveState() {
  try { localStorage.setItem('ps:saved', JSON.stringify([...state.saved])); } catch { /* private mode */ }
}

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
  saveState();
  updateSavedUI();
  renderResults();
}
function updateSavedUI() {
  const count = $('#savedCount');
  if (count) count.textContent = state.saved.size;
  const wrap = $('#savedCountWrap');
  if (wrap) wrap.hidden = state.saved.size === 0 && !state.savedOnly;
  const toggle = $('#toggleSavedOnly');
  if (toggle) toggle.setAttribute('aria-pressed', String(state.savedOnly));
}

const icon = {
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" stroke-width="1.6"/></svg>',
  phone: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  fax: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-3m-14 0h14v5H7v-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  web: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" stroke="currentColor" stroke-width="1.4"/></svg>',
  nav: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2 4 22l8-4 8 4-8-20Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 16V5a2 2 0 0 1 2-2h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  bookmark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21V3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  print: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 8V3h10v5M7 17H3v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7h-4m-14 0h14a2 2 0 0 1 2 2v3H5v-3a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function cardHTML(st, i) {
  const isMetro = st.region === 'bkk';
  const saved = state.saved.has(st.id);
  const typeBadge = isMetro
    ? '<span class="badge badge-metro">สน. นครบาล</span>'
    : '<span class="badge badge-phuthon">สภ. ภูธร</span>';
  const web = (st.website || '').trim();
  const webLabel = web.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const phone = formatPhoneDisplay(st.phone);
  const fax = formatPhoneDisplay(st.fax);
  return `
  <article class="card ${isMetro ? 'card-type-metro' : ''}" data-id="${st.id}" style="--i:${Math.min(i, 17)}">
    <div class="card-main">
      <div class="card-toprow">
        <h3><button class="card-title-btn" type="button" data-open-detail="${st.id}">${hl(st.name, state.q)}</button></h3>
        ${typeBadge}
        <span class="badge badge-region">${esc(REGION_SHORT[st.region] || '-')}</span>
        <span class="verified" title="ข้อมูลยืนยันจากสำนักงานตำรวจแห่งชาติ">${icon.check}ยืนยัน</span>
      </div>
      <p class="card-addr">${icon.pin}<span>${hl(st.address || 'ไม่มีข้อมูลที่อยู่', state.q)}</span></p>
      <div class="card-meta">
        ${st.phone
          ? `<a class="meta-item" href="tel:${esc(st.phone.replace(/\D/g, ''))}">${icon.phone}<b>${esc(phone)}</b></a>`
          : `<span class="meta-item na">${icon.phone}ไม่มีเบอร์โทร</span>`}
        ${st.fax
          ? `<span class="meta-item">${icon.fax}แฟกซ์ <b>${esc(fax)}</b></span>`
          : `<span class="meta-item na">${icon.fax}ไม่มีแฟกซ์</span>`}
        ${web
          ? `<a class="meta-item" href="${esc(web)}" target="_blank" rel="noopener" title="${esc(web)}">${icon.web}<b>${esc(webLabel.slice(0, 42))}</b></a>`
          : `<span class="meta-item na">${icon.web}ไม่มีเว็บไซต์</span>`}
      </div>
    </div>
    <div class="card-actions">
      <a class="icon-btn icon-btn-primary" href="${esc(mapsLink(st))}" target="_blank" rel="noopener">${icon.nav}นำทาง</a>
      ${hasAddress(st)
        ? `<button class="icon-btn" type="button" data-copy="${st.id}">${icon.copy}คัดลอก</button>`
        : `<button class="icon-btn" type="button" disabled title="ต้นทางยังไม่มีที่อยู่ — เปิดรายละเอียดเพื่อแจ้ง">${icon.copy}ไม่มีที่อยู่</button>`}
      <button class="icon-btn" type="button" data-print-one="${st.id}">${icon.print}พิมพ์</button>
      <button class="icon-btn ${saved ? 'is-saved' : ''}" type="button" data-save="${st.id}" aria-pressed="${saved}" aria-label="${saved ? 'เลิกบันทึก' : 'บันทึก'} ${esc(st.name)}">${icon.bookmark}${saved ? 'บันทึกแล้ว' : 'บันทึก'}</button>
    </div>
  </article>`;
}

function renderPagination(totalPages, page) {
  const pager = $('#pager');
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  const pages = [];
  const push = (p) => pages.push(p);
  if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) push(i); }
  else {
    push(1);
    if (page > 3) push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) push(i);
    if (page < totalPages - 2) push('…');
    push(totalPages);
  }
  pager.innerHTML = pages.map(p => p === '…'
    ? '<span class="dots">…</span>'
    : `<button type="button" data-page="${p}" aria-current="${p === page ? 'page' : 'false'}" aria-label="หน้า ${p}">${p}</button>`
  ).join('');
}

function renderActiveFilters() {
  const box = $('#activeFilters');
  const tags = [];
  if (state.q) tags.push({ label: `ค้นหา: “${state.q}”`, clear: () => { state.q = ''; $('#q').value = ''; $('#qMini').value = ''; } });
  if (state.province) tags.push({ label: `จังหวัด: ${state.province}`, clear: () => { state.province = ''; updateProvinceLabel(); } });
  if (state.region !== 'all') tags.push({ label: REGION_NAME[state.region], clear: () => { state.region = 'all'; } });
  if (state.savedOnly) tags.push({ label: 'เฉพาะที่บันทึก', clear: () => { state.savedOnly = false; $('#toggleSavedOnly').setAttribute('aria-pressed', 'false'); } });
  box.innerHTML = tags.map((t, i) => `<span class="filter-tag">${esc(t.label)}<button type="button" data-clear="${i}" aria-label="ล้างตัวกรองนี้">✕</button></span>`).join('');
  box.querySelectorAll('[data-clear]').forEach(btn => btn.addEventListener('click', () => {
    tags[+btn.dataset.clear].clear();
    state.page = 1;
    renderResults();
  }));
}

function syncURL() {
  try {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.province) p.set('province', state.province);
    if (state.region !== 'all') p.set('region', state.region);
    if (state.sort !== 'region') p.set('sort', state.sort);
    if (state.page > 1) p.set('page', String(state.page));
    if ($('#jurForm')) {
      if (jurParams.q) p.set('j', jurParams.q);
      if (jurParams.tab !== 'jur') p.set('jtab', jurParams.tab);
    }
    const qs = p.toString();
    /* คง hash ไว้เสมอ เพื่อไม่ให้ลิงก์ #results / #howto หายตอนซิงก์พารามิเตอร์ */
    history.replaceState(null, '', (qs ? '?' + qs : window.location.pathname) + window.location.hash);
  } catch { /* file:// or sandbox */ }
  syncSearchClear();
}

function applyURL() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('q')) {
      state.q = p.get('q');
      const qEl = $('#q'), qMiniEl = $('#qMini');
      if (qEl) qEl.value = state.q;
      if (qMiniEl) qMiniEl.value = state.q;
    }
    if (p.get('province')) {
      const prov = p.get('province');
      if (PROVINCES.some(x => x.name === prov)) { state.province = prov; updateProvinceLabel(); }
    }
    if (p.get('region') && REGIONS.some(r => r.id === p.get('region'))) state.region = p.get('region');
    /* ตัวเลือกเรียงลำดับถูกเอาออกจากหน้าเว็บแล้ว แต่ยังอ่านพารามิเตอร์ sort เดิม
       เพื่อให้ลิงก์แชร์เก่ายังแสดงลำดับเดิมได้ (ไม่เปลี่ยนพารามิเตอร์ตามกติกาโปรเจกต์) */
    if (p.get('sort') && ['region', 'name', 'province'].includes(p.get('sort'))) {
      state.sort = p.get('sort');
      const sortSel = $('#sortBy');
      if (sortSel) sortSel.value = state.sort;
    }
    const pg = parseInt(p.get('page') || '1', 10);
    if (pg > 0) state.page = pg;
  } catch { /* ignore */ }
}

/* พารามิเตอร์ของหน้าเขตอำนาจ (j, jtab) — แยกอ่านเฉพาะหน้านั้น
   คงชื่อพารามิเตอร์เดิมไว้เพื่อให้ลิงก์แชร์เก่ายังเปิดได้ */
function applyJurURL() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('j')) jurParams.q = p.get('j');
    if (['jur', 'digest'].includes(p.get('jtab'))) jurParams.tab = p.get('jtab');
  } catch { /* ignore */ }
}

/* ---------- Live search suggestions ---------- */
const sugState = { items: [], active: -1, total: 0 };

function getSuggestions(qRaw) {
  const qn = norm(qRaw);
  if (!qn) return { items: [], total: 0 };
  const scored = [];
  let total = 0;
  for (const st of STATIONS) {
    const h = HAY.get(st.id);
    let score = -1;
    if (h.name.startsWith(qn)) score = 0;
    else if (h.name.includes(qn)) score = 1;
    else if (h.prov.includes(qn)) score = 2;
    else if (h.addr.includes(qn)) score = 3;
    else if (h.phone.includes(qn) || h.region.includes(qn)) score = 4;
    if (score >= 0) { scored.push({ st, score }); total++; }
  }
  scored.sort((a, b) => a.score - b.score || a.st.name.localeCompare(b.st.name, 'th'));
  return { items: scored.slice(0, 8), total };
}

function renderSuggest() {
  const qRaw = $('#q').value.trim();
  const panel = $('#suggestPanel');
  const input = $('#q');
  if (!qRaw) { closeSuggest(); return; }
  const { items, total } = getSuggestions(qRaw);
  sugState.items = items;
  sugState.total = total;
  sugState.active = -1;
  input.removeAttribute('aria-activedescendant');
  if (!items.length) {
    panel.innerHTML = `<div class="sug-empty">ไม่พบสถานีที่ตรงกับ “${esc(qRaw)}” — ลองใช้คำค้นที่สั้นลง</div>`;
  } else {
    const rows = items.map((it, i) => {
      const st = it.st;
      const addr = hasAddress(st);
      return `<div class="sug-row" role="option" id="sug-${i}" data-sug="${st.id}" aria-selected="false">
        <span class="sug-name">${hl(st.name, qRaw)}</span>
        <span class="sug-phone">${esc(formatPhoneDisplay(st.phone) || '—')}</span>
        ${addr
          ? `<button class="sug-copy" type="button" data-sug-copy="${st.id}" aria-label="คัดลอกที่อยู่ ${esc(st.name)}" title="คัดลอกที่อยู่ ${esc(st.name)} · Ctrl+Enter">${icon.copy}</button>`
          : `<span class="sug-copy sug-copy-na" title="ต้นทางยังไม่มีที่อยู่">${icon.copy}</span>`}
        <span class="sug-sub">${esc(st.province_th)} · ${esc(REGION_SHORT[st.region] || '-')}${addr ? '' : ' · <b class="na-badge">ไม่มีที่อยู่</b>'}</span>
      </div>`;
    }).join('');
    panel.innerHTML = `<div class="suggest-list">${rows}</div>
      <div class="sug-foot"><span>จับคู่ได้ ${total.toLocaleString('th-TH')} สถานี</span><button type="button" id="sugAll">ดูผลลัพธ์ทั้งหมด →</button></div>`;
  }
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function closeSuggest() {
  const panel = $('#suggestPanel');
  if (panel) panel.hidden = true;
  sugState.active = -1;
  const q = $('#q');
  if (q) { q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant'); }
}

function moveSugActive(delta) {
  const rows = $$('.sug-row', $('#suggestPanel'));
  if (!rows.length) return;
  let next = sugState.active + delta;
  if (next < 0) next = rows.length - 1;
  if (next >= rows.length) next = 0;
  sugState.active = next;
  rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === next)));
  rows[next].scrollIntoView({ block: 'nearest' });
  $('#q').setAttribute('aria-activedescendant', rows[next].id);
}

function applySearch(qRaw) {
  const v = String(qRaw ?? '');
  state.q = v.trim();
  const qEl = $('#q'), qMiniEl = $('#qMini');
  if (qEl) qEl.value = v;
  if (qMiniEl) qMiniEl.value = v;
  state.page = 1;
  closeSuggest();
  renderResults();
  $('#results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Results ---------- */
function renderResults() {
  if (!$('#resultsList')) return;   /* หน้าเขตอำนาจไม่มีรายการสถานี */
  const list = getFiltered();
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PER_PAGE;
  const pageItems = list.slice(start, start + PER_PAGE);

  $('#resultCount').textContent = total.toLocaleString('th-TH');
  $('#srStatus').textContent = `พบ ${total.toLocaleString('th-TH')} สถานี` + (totalPages > 1 ? ` · หน้า ${state.page} จาก ${totalPages}` : '');
  renderRegionChips();
  renderActiveFilters();

  const container = $('#resultsList');
  container.classList.remove('animate');
  if (!pageItems.length) {
    container.innerHTML = `
      <div class="empty">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="margin:0 auto;color:var(--faint)"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/><path d="m20 20-3.8-3.8M8.5 11h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <h3>ไม่พบสถานีตำรวจที่ตรงกับเงื่อนไข</h3>
        <p>ลองใช้คำค้นที่สั้นลง หรือล้างตัวกรอง แล้วค้นหาใหม่อีกครั้ง</p>
        <button class="btn btn-primary" type="button" id="emptyReset">ล้างตัวกรองทั้งหมด</button>
      </div>`;
    $('#emptyReset')?.addEventListener('click', resetFilters);
  } else {
    container.innerHTML = pageItems.map((st, i) => cardHTML(st, i)).join('');
  }
  void container.offsetWidth;
  container.classList.add('animate');
  renderPagination(totalPages, state.page);
  syncURL();
}

function resetFilters() {
  state.q = ''; state.province = ''; state.region = 'all'; state.savedOnly = false; state.page = 1;
  /* ไม่มีตัวเลือกเรียงลำดับบนหน้าเว็บแล้ว — "ล้างตัวกรองทั้งหมด" คือทางกลับสู่ลำดับปกติ
     สำหรับคนที่เปิดลิงก์เก่าที่มี sort=name / sort=province */
  state.sort = 'region';
  $('#q').value = ''; $('#qMini').value = '';
  updateProvinceLabel();
  closeSuggest();
  closeCombo(false);
  $('#toggleSavedOnly').setAttribute('aria-pressed', 'false');
  renderResults();
}

/* ---------- Clipboard / toast ---------- */
let toastTimer;
function showToast(msg) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

/* ข้อมูลที่อยู่จากต้นทางเป็นข้อความยาวบรรทัดเดียว — ใช้ตามเดิม ไม่ตัดคำ ไม่เดารหัสไปรษณีย์
   (รหัสไปรษณีย์เป็นเลขอารบิกอยู่ท้ายข้อความอยู่แล้ว) · ไม่ใส่ลิงก์/ที่มา/อีโมจิ/เบอร์โทร
   เพื่อให้วางลงแม่แบบซองหรือหนังสือแล้วใช้ได้เลย */
const hasAddress = (st) => !!(st && String(st.address || '').trim());
function envelopeCopyText(st) {
  const addr = String(st.address || '').trim();
  return addr ? `${st.name}\n${addr}` : st.name;
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
    /* ทางสำรองสำหรับเบราว์เซอร์ในแอป (เช่น เปิดลิงก์จาก LINE) หรือเบราว์เซอร์รุ่นเก่า */
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

/* เรียกตรงจากเหตุการณ์คลิก/คีย์ — ไม่ await งานอื่นก่อนคัดลอก (Safari นับว่าผู้ใช้เป็นคนกด) */
async function copyStation(st, btn) {
  if (!st) return false;
  if (!hasAddress(st)) {
    showToast(`${st.name} ยังไม่มีที่อยู่จากต้นทาง — กรุณาแจ้งที่อยู่`);
    return false;
  }
  const ok = await copyText(envelopeCopyText(st), `คัดลอกที่อยู่ ${st.name} · ${st.province_th} แล้ว`);
  if (ok) { if (btn) flashCopied(btn); }
  else openManualCopy(envelopeCopyText(st));
  return ok;
}

function flashCopied(btn) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.classList.add('is-copied');
  btn.innerHTML = icon.check + 'คัดลอกแล้ว';
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => { btn.classList.remove('is-copied'); btn.innerHTML = orig; }, 2400);
}

/* ทางสำรองสุดท้าย: เปิดกล่องที่มีข้อความเลือกไว้แล้ว ให้กด Ctrl+C หรือแตะค้างเอง
   ห้ามแจ้งว่า "คัดลอกแล้ว" ถ้าทั้ง navigator.clipboard และ execCommand ล้มเหลว */
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

/* ---------- Modal ---------- */
const modal = $('#stationModal');
let lastFocus = null;

function openStationModal(id) {
  const st = STATIONS.find(s => s.id === id);
  if (!st) return;
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
  if (st.website) { dWeb.textContent = st.website; dWeb.href = st.website; dWeb.removeAttribute('aria-disabled'); }
  else { dWeb.textContent = 'ไม่มีเว็บไซต์ทางการ'; dWeb.removeAttribute('href'); }
  $('#dMap').src = mapsEmbed(st);
  $('#dNavigate').href = mapsLink(st);
  const dSave = $('#dSave');
  dSave.setAttribute('aria-pressed', String(state.saved.has(st.id)));
  dSave.textContent = state.saved.has(st.id) ? 'บันทึกแล้ว ✓' : 'บันทึกสถานีนี้';
  dSave.dataset.id = st.id;
  $('#dPrint').dataset.id = st.id;
  const addr = hasAddress(st);
  const copyBtn = $('#dCopy');
  copyBtn.dataset.id = st.id;
  copyBtn.disabled = !addr;
  copyBtn.setAttribute('aria-describedby', 'dCopyPreview');
  /* ตัวอย่างต้องตรงกับข้อความที่จะคัดลอกทุกตัวอักษร */
  $('#dCopyPreview').textContent = addr ? envelopeCopyText(st) : 'ต้นทางยังไม่มีที่อยู่สำหรับสถานีนี้ — กรุณาแจ้งที่อยู่';
  $('#dReport').href = reportURL(st);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
  /* งานหลักคือคัดลอกที่อยู่ → กด Enter อีกครั้งได้เลย (ถ้าไม่มีที่อยู่ ให้โฟกัสปุ่มปิด) */
  (addr ? copyBtn : $('#modalClose')).focus();
}
function closeStationModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  document.body.style.overflow = '';
  $('#dMap').src = 'about:blank';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

/* ---------- Print ---------- */
function emblemPrintSVG() {
  return '<svg width="46" height="46" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="#7E1F1A"/><circle cx="32" cy="32" r="24.5" fill="none" stroke="#C9A227" stroke-width="1.6"/><path d="M32 12l3.1 6.3 6.9 1-5 4.9 1.2 6.9L32 30.2 25.8 33.5l1.2-6.9-5-4.9 6.9-1L32 12Z" fill="#C9A227"/></svg>';
}
function thaiDate(d = new Date()) {
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}
function printHeader(title, subtitle) {
  return `<div class="print-sheet">
    <div class="print-emblem-row">${emblemPrintSVG()}<div><div class="ps-name">PS LOCATOR</div><div class="ps-sub">สารบบสถานีตำรวจทั่วประเทศ</div></div></div>
    <div class="print-doc-title">${esc(title)}</div>
    <div class="print-doc-sub">${esc(subtitle)}</div>`;
}
function printFooter() {
  return `<div class="print-foot"><span>พิมพ์จาก PS Locator · วันที่พิมพ์ ${esc(thaiDate())}</span></div>
  </div>`;
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
  ].filter(Boolean).join(' · ') || 'ทุกจังหวัดทั่วประเทศ';
  $('#print-area').innerHTML =
    printHeader('บัญชีรายนามสถานีตำรวจ', `ขอบเขต: ${scope} — จำนวน ${list.length} สถานี`) +
    `<table class="print-table"><thead><tr><th>#</th><th>ชื่อสถานี</th><th>จังหวัด</th><th>ที่อยู่</th><th>โทรศัพท์</th><th>แฟกซ์</th></tr></thead><tbody>${rows}</tbody></table>` +
    printFooter();
  window.print();
}

/* ---------- CSV export ---------- */
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
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ps-locator-stations.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast(`ดาวน์โหลด CSV แล้ว (${list.length} รายการ)`);
}

/* ---------- Scroll UI: mini-search + back-to-top ---------- */
function initScrollUI() {
  const header = $('.header');
  const field = $('#searchField');
  if ('IntersectionObserver' in window && field && header) {
    const io = new IntersectionObserver(([entry]) => {
      header.classList.toggle('searching', !entry.isIntersecting);
    }, { rootMargin: '-72px 0px 0px 0px', threshold: 0 });
    io.observe(field);
  }
  const toTop = $('#toTop');
  if (!toTop) return;
  toTop.hidden = false;
  const onScroll = () => toTop.classList.toggle('show', window.scrollY > 600);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ---------- Events ---------- */
let searchDebounce;

/* หน้าสารบบสถานีเท่านั้น */
function bindStationEvents() {
  const q = $('#q');
  const qMini = $('#qMini');

  q.addEventListener('input', (e) => {
    const v = e.target.value;
    qMini.value = v;
    syncSearchClear();
    renderSuggest();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.q = v.trim(); state.page = 1; renderResults(); }, 140);
  });
  qMini.addEventListener('input', (e) => {
    const v = e.target.value;
    q.value = v;
    syncSearchClear();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.q = v.trim(); state.page = 1; renderResults(); }, 140);
  });
  $('#clearSearchBtn')?.addEventListener('click', () => {
    q.value = '';
    qMini.value = '';
    syncSearchClear();
    closeSuggest();
    state.q = '';
    state.page = 1;
    renderResults();
    q.focus();
  });

  q.addEventListener('keydown', (e) => {
    const panel = $('#suggestPanel');
    const open = !panel.hidden;
    /* Ctrl+Enter / ⌘+Enter — คัดลอกแถวที่ไฮไลต์อยู่ (ถ้ายังไม่ได้กด ↑↓ ให้เอาอันดับแรก) */
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!open && q.value.trim()) renderSuggest();
      const pick = (sugState.active >= 0 && sugState.items[sugState.active]) || sugState.items[0];
      if (pick) copyStation(pick.st);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) renderSuggest(); else moveSugActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) moveSugActive(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && sugState.active >= 0 && sugState.items[sugState.active]) openStationModal(sugState.items[sugState.active].st.id);
      else applySearch(q.value);
    }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); closeSuggest(); } }
    else if (e.key === 'Tab') { closeSuggest(); }
  });

  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); applySearch(q.value); });

  $('#suggestPanel').addEventListener('click', (e) => {
    const cp = e.target.closest('[data-sug-copy]');
    if (cp) { const st = STATIONS.find(s => s.id === +cp.dataset.sugCopy); if (st) copyStation(st, cp); return; }
    const row = e.target.closest('[data-sug]');
    if (row) { openStationModal(+row.dataset.sug); return; }
    if (e.target.closest('#sugAll')) applySearch(q.value);
  });

  /* Province combobox */
  $('#provinceBtn').addEventListener('click', () => { comboState.open ? closeCombo(true) : openCombo(); });
  $('#provinceSearch').addEventListener('input', (e) => { renderComboList(e.target.value); });
  $('#provinceSearch').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveComboActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveComboActive(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = comboState.active >= 0 ? comboState.active : 0;
      if (comboState.items[idx]) setProvince(comboState.items[idx].value);
    }
    else if (e.key === 'Escape') { e.preventDefault(); closeCombo(true); }
    else if (e.key === 'Tab') { closeCombo(false); }
  });
  $('#provinceList').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-province]');
    if (opt) setProvince(opt.dataset.province);
  });

  $('#sortBy')?.addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; renderResults(); });
  $('#regionChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    state.region = btn.dataset.region;
    state.page = 1;
    renderResults();
  });
  $('#quickChips')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-q]');
    if (btn) applySearch(btn.dataset.q);
  });
  $('#clearFiltersBtn').addEventListener('click', resetFilters);
  $('#exportCsvBtn').addEventListener('click', exportCSV);
  $('#printListBtn').addEventListener('click', printFilteredList);
  $('#toggleSavedOnly').addEventListener('click', () => {
    state.savedOnly = !state.savedOnly;
    $('#toggleSavedOnly').setAttribute('aria-pressed', String(state.savedOnly));
    state.page = 1;
    renderResults();
  });
  $('#pager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.page = +btn.dataset.page;
    renderResults();
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#resultsList').addEventListener('click', (e) => {
    const detailBtn = e.target.closest('[data-open-detail]');
    if (detailBtn) return openStationModal(+detailBtn.dataset.openDetail);
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) { const st = STATIONS.find(s => s.id === +copyBtn.dataset.copy); if (st) copyStation(st, copyBtn); return; }
    const printBtn = e.target.closest('[data-print-one]');
    if (printBtn) { const st = STATIONS.find(s => s.id === +printBtn.dataset.printOne); if (st) printStation(st); return; }
    const saveBtn = e.target.closest('[data-save]');
    if (saveBtn) { toggleSave(+saveBtn.dataset.save); return; }
  });
}

/* ใช้ร่วมทั้งสองหน้า: ธีม · โมดัลรายละเอียดสถานี · คีย์ลัด */
function bindGlobalEvents() {
  /* Theme */
  $('#themeToggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      let stored = null; try { stored = localStorage.getItem('ps:theme'); } catch { /* ignore */ }
      if (!stored) applyTheme(e.matches ? 'dark' : 'light');
    });
  } catch { /* older browsers */ }

  /* Modal */
  $('#modalClose').addEventListener('click', closeStationModal);
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
  $('#dCopy').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const st = STATIONS.find(s => s.id === +btn.dataset.id);
    if (st) copyStation(st, btn);
  });
  $('#dPrint').addEventListener('click', (e) => {
    const st = STATIONS.find(s => s.id === +e.currentTarget.dataset.id);
    if (st) printStation(st);
  });
  $('#dSave').addEventListener('click', (e) => {
    const id = +e.currentTarget.dataset.id;
    toggleSave(id);
    const on = state.saved.has(id);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'บันทึกแล้ว ✓' : 'บันทึกสถานีนี้';
  });

  /* ดูเขตอำนาจของสถานีนี้ — อยู่หน้าสารบบให้ข้ามไปหน้าเขตอำนาจ อยู่หน้าเขตอำนาจให้ค้นทันที */
  $('#dJurisdiction').addEventListener('click', () => {
    const id = +($('#dSave')?.dataset.id || 0);
    if (!id) return;
    const st = ST_BY_ID.get(id);
    const jq = st ? st.name.replace(/^สภ\.|^สน\./, '').trim() : '';
    closeStationModal();
    if ($('#jurForm')) { setJurTab('jur'); jurSearch(jq); }
    else window.location.href = 'jurisdiction.html?j=' + encodeURIComponent(jq) + '&jtab=jur';
  });

  /* Global keys */
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      const header = $('.header');
      const search = $('.header') && header.classList.contains('searching') ? $('#qMini') : $('#q');
      const target = search || $('#jurQ');
      if (target) { target.focus(); target.select(); }
    } else if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeStationModal();
      /* กลับไปช่องค้นหาพร้อมเลือกคำเดิมไว้ — พิมพ์ชื่อสถานีต่อได้ทันทีโดยไม่ต้องลบ */
      const q = $('#q');
      if (q) { q.focus(); q.select(); }
    }
  });

  /* ปิดแผงคำแนะนำเมื่อคลิกนอกช่องค้นหา (หน้าสารบบเท่านั้น) */
  if ($('#searchField')) {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#searchField')) closeSuggest();
      if (comboState.open && !e.target.closest('#provinceCombo')) closeCombo(false);
    });
  }
}

/* ============================================================
   พื้นที่งาน "เขตอำนาจสอบสวน" (ค้นหาจากชื่อตำบล + ย่อประกาศ)
   ข้อมูล: window.JURISDICTION (data/jurisdictions.js — โหลดเมื่อต้องการใช้)
   ============================================================ */
const ST_BY_ID = new Map(STATIONS.map(s => [s.id, s]));
const jurState = {
  data: null, loading: null, sug: [], sugActive: -1, results: [],
  digestQ: '', fullText: null, fullBusy: false,
};
const JUR_ADDR = new Map();   /* ตำบล/แขวงจากที่อยู่สถานี → id สถานี (ใช้เฉพาะกรณีไม่มีบัญชีประกาศ) */
const JUR_TABS = [
  { id: 'jur', tab: 'tabJur', panel: 'panelJur' },
  { id: 'digest', tab: 'tabDigest', panel: 'panelDigest' },
];

/** ตัดคำนำหน้าตำบล/แขวง/อำเภอเพื่อให้พิมพ์ "ต.หันคา" หรือ "หันคา" เจอเหมือนกัน */
function normJur(s) {
  return norm(String(s ?? '')
    .replace(/^\s*(ตำบล|แขวง|อำเภอ|จังหวัด|ต\.|อ\.|จ\.|เขต)\s*/gu, '')
    .replace(/[“”„]/g, ''));
}

/** คีย์สำหรับเทียบกับดัชนี: แบบตัดคำนำหน้า + แบบไม่ตัด
 *  จำเป็นเพราะมีชื่อตำบลจริงที่ขึ้นต้นด้วย "จ." เช่น "จ. ป. ร" (จ.ระนอง)
 *  ซึ่งคำนำหน้าจังหวัดจะไปทับชื่อตำบลได้ */
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
  const d = jurState.data;
  const c = d.coverage;
  $('#jurCoverage').textContent =
    `บัญชีแนบท้ายประกาศ หน้า 113–344 · ถอดได้ ${c.stations.toLocaleString('th-TH')} สถานี / ${c.tambonNames.toLocaleString('th-TH')} ชื่อตำบล ใน ${c.provinces} จังหวัด · ` +
    `มี ${c.stationsNeedVerify} สถานีที่ข้อความในประกาศระบุตำบลไม่ครบตามจำนวน (แสดงป้าย "ต้องตรวจสอบ") · ` +
    `อีก ${(c.allStations - c.stations).toLocaleString('th-TH')} สถานียังไม่มีบัญชีตำบล (ส่วนใหญ่เป็น สน. ใน กทม.) — แสดง "ตำบล/แขวงที่ตั้งสถานีจากที่อยู่" พร้อมป้ายกำกับแทน`;
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

/* ---------- แท็บ (role=tablist) ---------- */
function setJurTab(id, focus = false) {
  const t = JUR_TABS.find(x => x.id === id) || JUR_TABS[0];
  jurParams.tab = t.id;
  for (const x of JUR_TABS) {
    const btn = $('#' + x.tab), panel = $('#' + x.panel);
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

/* ---------- ค้นหาเขตอำนาจจากชื่อตำบล ---------- */
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
  /* ถ้าเจอชื่อตำบลตรงตัวในบัญชีประกาศแล้ว ต้องไม่เอาการค้นแบบ "มีคำนี้อยู่ในชื่อสถานี"
     มาปนผล (เช่น "จ.ป.ร." ตัดคำนำหน้าเหลือ "ปร" จะไปติดชื่อ สภ. "ประ..." เป็นสิบแห่ง) */
  if (!exact) {
    let n = 0;
    for (const [k, arr] of Object.entries(d.index)) {
      if (hasKey(k)) {
        for (const i of arr) add(i, k, 'tambon');
        if (++n > 60) break;
      }
    }
    /* ค้นด้วยชื่อสถานี / จังหวัด / อำเภอ / ภาค */
    for (let i = 0; i < d.stations.length; i++) {
      const r = d.stations[i];
      const st = ST_BY_ID.get(r.id);
      const hay = [normJur(r.short), normJur(st ? st.name : ''), normJur(r.province), normJur(r.amphoe), normJur('ภ.' + r.region)].join('|');
      if (hasKey(hay)) add(i, r.short, 'station');
    }
  }
  /* ตำบล/แขวงที่ตั้งสถานีจากที่อยู่ (สำหรับสถานีที่ไม่มีบัญชีตำบลในประกาศ) */
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
  $('#jurResults').innerHTML = `
    <div class="jur-empty">
      <h3>พิมพ์ชื่อตำบลที่ต้องการตรวจสอบ เพื่อรู้ว่าไปโรงพักไหน</h3>
      <p>รองรับชื่อตำบล แขวง อำเภอ จังหวัด และชื่อ สภ./สน. · ข้อมูลจากบัญชีแนบท้ายประกาศ ${d ? d.meta.sources[0].label : ''}</p>
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
  /* ถ้ามีชื่อตำบลตรงตัวแล้ว ให้แนะนำเฉพาะชื่อนั้น ไม่แนะนำคำที่คล้ายกันจนสับสน */
  const exactKeys = keys.filter(k => Object.prototype.hasOwnProperty.call(idx, k));
  const useExact = exactKeys.length > 0;
  for (const [k, arr] of Object.entries(idx)) {
    if (useExact ? !exactKeys.includes(k) : !keys.some(n => n && k.includes(n))) continue;
    const r = jurState.data.stations[arr[0]];
    const key = k + '|' + r.province;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: k, province: r.province, count: arr.length });
    if (out.length >= 8) break;
  }
  return out;
}

function renderJurSuggest() {
  const panel = $('#jurSuggest'), input = $('#jurQ');
  const qRaw = input.value.trim();
  jurState.sug = qRaw ? jurSuggest(qRaw) : [];
  jurState.sugActive = -1;
  input.removeAttribute('aria-activedescendant');
  if (!qRaw) { closeJurSuggest(); return; }
  panel.innerHTML = jurState.sug.length
    ? jurState.sug.map((s, i) => `<div class="jur-sug-row" role="option" id="jurSug-${i}" data-jur-sug="${esc(s.name)}" aria-selected="false"><b>${hl(s.name, qRaw)}</b><small>${esc(s.province)} · ${s.count} สถานี</small></div>`).join('')
    : `<div class="jur-sug-empty">ไม่พบชื่อตำบลที่ตรงกับ “${esc(qRaw)}” ในบัญชีแนบท้ายประกาศ — ลองพิมพ์ชื่อจังหวัดหรือชื่อสถานี</div>`;
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
function closeJurSuggest() {
  $('#jurSuggest').hidden = true;
  jurState.sugActive = -1;
  $('#jurQ').setAttribute('aria-expanded', 'false');
  $('#jurQ').removeAttribute('aria-activedescendant');
}
function moveJurSug(delta) {
  const rows = $$('.jur-sug-row', $('#jurSuggest'));
  if (!rows.length) return;
  let next = jurState.sugActive + delta;
  if (next < 0) next = rows.length - 1;
  if (next >= rows.length) next = 0;
  jurState.sugActive = next;
  rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === next)));
  rows[next].scrollIntoView({ block: 'nearest' });
  $('#jurQ').setAttribute('aria-activedescendant', rows[next].id);
}

function syncJurClear() {
  const qEl = $('#jurQ'), btn = $('#clearJurBtn');
  if (qEl && btn) btn.hidden = qEl.value.length === 0;
}

function jurSearch(qRaw, opts = {}) {
  if (!jurState.data) { loadJurisdiction().then(() => jurSearch(qRaw, opts)).catch(jurisLoadFailed); return; }
  const q = String(qRaw ?? '').trim();
  jurParams.q = q;
  $('#jurQ').value = q;
  syncJurClear();
  closeJurSuggest();
  if (!q) { jurState.results = []; renderJurIdle(); syncURL(); return; }
  const { hits, addrHits, exact } = jurFindCandidates(q);
  jurState.results = { hits, addrHits, q, exact };
  renderJurResults();
  $('#jurStatus').textContent = `พบ ${hits.length + addrHits.length} สถานีที่เกี่ยวข้องกับ “${q}”`;
  syncURL();
  if (!opts.silent) $('#jurisdiction').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      return `<div class="jur-neighbor"><button class="card-title-btn" type="button" data-jur-jump="${esc(r.short)}"><b>สภ.${esc(r.short)}</b></button>
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
  /* แยก "ถอดชื่อตำบลไม่ครบ" ออกจาก "มีหมายเหตุแนวเขต" เพื่อไม่ให้เข้าใจผิดว่าข้อมูลครบแล้ว */
  const warns = [];
  if (missing > 0) warns.push(`ข้อความในประกาศหน้า ${rec.page} ระบุ ${rec.count} ตำบล แต่ถอดชื่อได้ ${rec.tambons.length} ตำบล — อาจมีชื่อตำบลที่ค้นไม่พบ กรุณาเปิดหน้าประกาศหรือสอบถามสถานีโดยตรงก่อนส่งหมาย / รับแจ้งเหตุ`);
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
  if (!R.q) { renderJurIdle(); return; }
  const showHits = R.hits.slice(0, 10);
  const showAddr = R.addrHits.slice(0, 6);
  const more = (R.hits.length + R.addrHits.length) - (showHits.length + showAddr.length);
  const header = `<div class="jur-hints"><span>พบ <b>${R.hits.length + R.addrHits.length}</b> รายการสำหรับ “${esc(R.q)}”</span>
    <button class="icon-btn" type="button" id="jurCsvBtn">ดาวน์โหลด CSV</button>
    <button class="btn btn-ghost btn-sm" type="button" id="jurClearBtn">ล้างคำค้น</button></div>`;
  const body = showHits.map(h => jurResultCard(h, R.q)).join('') + showAddr.map(h => jurAddressCard(h, R.q)).join('');
  const empty = `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3>
    <p>ไม่พบ “${esc(R.q)}” ในบัญชีแนบท้ายประกาศและในที่อยู่สถานี กรุณาตรวจสอบการสะกดชื่อตำบล หรือเปิดประกาศฉบับเต็ม / สอบถามสถานีโดยตรง</p>
    <a href="https://ratchakitcha.soc.go.th/documents/17187.pdf" target="_blank" rel="noopener">เปิดประกาศ 427 หน้า (PDF)</a></div>`;
  box.innerHTML = (R.hits.length + R.addrHits.length ? header + body + (more > 0 ? `<p class="jur-note">แสดง ${showHits.length + showAddr.length} รายการจากทั้งหมด ${R.hits.length + R.addrHits.length} รายการ — พิมพ์ชื่อตำบลให้เฉพาะเจาะจงขึ้นเพื่อจำกัดผลลัพธ์</p>` : '') : empty);
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
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'ps-locator-hettamnat.csv'; a.click();
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


/* ---------- ย่อประกาศ + ค้นหาในฉบับเต็ม ---------- */
function renderSources() {
  const d = jurState.data;
  if (!d) return;
  $('#jurSources').innerHTML = d.meta.sources.map(s =>
    `<div class="jur-source"><b>${esc(s.label)}</b><small>${esc(s.gazette)} · ${s.pages} หน้า</small>
      <a href="${esc(s.url)}" target="_blank" rel="noopener">เปิดไฟล์ PDF ต้นฉบับ</a></div>`).join('');
}

function renderDigest() {
  const d = jurState.data;
  if (!d) return;
  const qn = normJur(jurState.digestQ);
  const cards = d.summary.filter(c => !qn || normJur([c.title, c.text, c.keys].join(' ')).includes(qn));
  $('#digestCards').innerHTML = cards.length
    ? cards.map(c => {
      const src = d.meta.sources.find(s => s.code === c.doc) || d.meta.sources[0];
      return `<article class="jur-summary-card"><h4>${esc(c.title)}</h4><p>${hl(c.text, jurState.digestQ)}</p>
        <small>${esc(src.label)} · หน้า ${c.page} · <a href="${esc(src.url)}#page=${c.page}" target="_blank" rel="noopener">เปิดหน้านั้นใน PDF</a></small></article>`;
    }).join('')
    : `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3><p>ไม่พบหัวข้อที่ตรงกับ “${esc(jurState.digestQ)}” — ลองคำว่าตำบล, ส่งหมาย, แจ้งเหตุ หรือฉบับที่ 2</p></div>`;
}

async function fullTextSearch() {
  const q = $('#digestQ').value.trim();
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


/* ---------- เหตุการณ์ของพื้นที่งานเขตอำนาจ ---------- */
function bindJurisdictionEvents() {
  /* แท็บ */
  JUR_TABS.forEach((t, i) => {
    $('#' + t.tab).addEventListener('click', () => setJurTab(t.id));
    $('#' + t.tab).addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? JUR_TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + JUR_TABS.length) % JUR_TABS.length;
      setJurTab(JUR_TABS[next].id, true);
    });
  });

  /* ค้นหาเขตอำนาจ */
  $('#jurForm').addEventListener('submit', (e) => { e.preventDefault(); jurSearch($('#jurQ').value); });
  $('#jurQ').addEventListener('input', () => { syncJurClear(); loadJurisdiction().then(renderJurSuggest).catch(jurisLoadFailed); });
  $('#clearJurBtn')?.addEventListener('click', () => {
    $('#jurQ').value = '';
    syncJurClear();
    closeJurSuggest();
    jurSearch('', { silent: true });
    $('#jurQ').focus();
  });
  $('#jurQ').addEventListener('keydown', (e) => {
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
  $('#jurSuggest').addEventListener('click', (e) => {
    const row = e.target.closest('[data-jur-sug]');
    if (row) jurSearch(row.dataset.jurSug);
  });
  $('.jur-hints').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jq]');
    if (b) { jurParams.q = b.dataset.jq; $('#jurQ').value = jurParams.q; jurSearch(jurParams.q); }
  });
  $('#jurResults').addEventListener('click', (e) => {
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

  /* ย่อประกาศ */
  $('#digestQ').addEventListener('input', (e) => { jurState.digestQ = e.target.value.trim(); renderDigest(); });
  $('#digestQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fullTextSearch(); } });
  $('#fullSearchBtn').addEventListener('click', fullTextSearch);
}

function initJurisdiction() {
  buildAddressIndex();
  bindJurisdictionEvents();
  if (jurParams.tab === 'digest') setJurTab('digest');
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

/* ---------- Boot ---------- */
const isStationPage = !!$('#resultsList');
const isJurPage = !!$('#jurForm');

/* ลิงก์เก่าที่ชี้ ?j=… (สมัยที่เขตอำนาจอยู่หน้าเดียวกับสารบบ) → พาไปหน้าเขตอำนาจ */
if (isStationPage) {
  const legacy = new URLSearchParams(window.location.search);
  if (legacy.get('j') || legacy.get('jtab')) window.location.replace('jurisdiction.html' + window.location.search);
}

applyTheme(document.documentElement.dataset.theme || 'light');
bindGlobalEvents();
initScrollUI();
trackVisit();

if (isJurPage) {
  applyJurURL();
  initJurisdiction();
} else if (isStationPage) {
  applyURL();
  updateProvinceLabel();
  renderStats();
  updateSavedUI();
  bindStationEvents();
  renderResults();
  const hint = $('#searchHint');
  if (hint) {
    const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
    hint.textContent = mac
      ? 'กด Enter ดูรายละเอียด · ⌘+Enter คัดลอกที่อยู่เลย'
      : 'กด Enter ดูรายละเอียด · Ctrl+Enter คัดลอกที่อยู่เลย';
  }
  /* เดสก์ท็อป: ช่องค้นหาพร้อมพิมพ์ตั้งแต่เปิดหน้า (ข้ามกรณีมี hash เพื่อไม่ให้เลื่อนตำแหน่ง) */
  if (!window.location.hash && matchMedia('(min-width: 900px)').matches) {
    $('#q').focus();
    if (new URLSearchParams(window.location.search).get('q')) $('#q').select();
  }
}
