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
  $('#provinceLabel').textContent = state.province || `ทุกจังหวัด (${PROVINCES.length})`;
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
  $('#statStations').textContent = STATIONS.length.toLocaleString('th-TH');
  $('#statProvinces').textContent = PROVINCES.length;
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
  $('#savedCount').textContent = state.saved.size;
  $('#savedCountWrap').hidden = state.saved.size === 0 && !state.savedOnly;
  $('#toggleSavedOnly').setAttribute('aria-pressed', String(state.savedOnly));
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
      <button class="icon-btn" type="button" data-copy="${st.id}">${icon.copy}คัดลอก</button>
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
    const qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  } catch { /* file:// or sandbox */ }
}

function applyURL() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('q')) { state.q = p.get('q'); $('#q').value = state.q; $('#qMini').value = state.q; }
    if (p.get('province')) {
      const prov = p.get('province');
      if (PROVINCES.some(x => x.name === prov)) { state.province = prov; updateProvinceLabel(); }
    }
    if (p.get('region') && REGIONS.some(r => r.id === p.get('region'))) state.region = p.get('region');
    if (p.get('sort') && ['region', 'name', 'province'].includes(p.get('sort'))) { state.sort = p.get('sort'); $('#sortBy').value = state.sort; }
    const pg = parseInt(p.get('page') || '1', 10);
    if (pg > 0) state.page = pg;
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
      return `<div class="sug-row" role="option" id="sug-${i}" data-sug="${st.id}" aria-selected="false">
        <span class="sug-name">${hl(st.name, qRaw)}</span>
        <span class="sug-phone">${esc(formatPhoneDisplay(st.phone) || '—')}</span>
        <span class="sug-sub">${esc(st.province_th)} · ${esc(REGION_SHORT[st.region] || '-')}</span>
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
  panel.hidden = true;
  sugState.active = -1;
  $('#q').setAttribute('aria-expanded', 'false');
  $('#q').removeAttribute('aria-activedescendant');
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
  $('#q').value = v;
  $('#qMini').value = v;
  state.page = 1;
  closeSuggest();
  renderResults();
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Results ---------- */
function renderResults() {
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
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast('คัดลอกลงคลิปบอร์ดแล้ว'); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); showToast(ok ? 'คัดลอกลงคลิปบอร์ดแล้ว' : 'คัดลอกไม่สำเร็จ'); } catch { showToast('คัดลอกไม่สำเร็จ'); }
    ta.remove();
    return ok;
  }
}
function flashCopied(btn) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.classList.add('is-copied');
  btn.innerHTML = icon.check + 'คัดลอกแล้ว';
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => { btn.classList.remove('is-copied'); btn.innerHTML = orig; }, 1600);
}
const stationCopyText = (st) => `${st.name}\n${st.address}\nโทร ${formatPhoneDisplay(st.phone) || '-'} | แฟกซ์ ${formatPhoneDisplay(st.fax) || '-'}`;

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
  $('#dCopy').dataset.id = st.id;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
  $('#modalClose').focus();
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
  return `<div class="print-sign">
      <div><div class="line">ผู้พิมพ์ / ผู้สอบสวน</div>ลงชื่อ ................................................ วันที่ ${esc(thaiDate())}</div>
      <div><div class="line">ผู้ตรวจสอบ / ผู้บังคับบัญชา</div>ลงชื่อ ................................................ วันที่ ${esc(thaiDate())}</div>
    </div>
    <div class="print-foot"><span>พิมพ์จาก ps-locator · ข้อมูล ณ ${esc(thaiDate())} อ้างอิงสำนักงานตำรวจแห่งชาติ (royalthaipolice.go.th)</span><span>หน้า 1 / 1</span></div>
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
      <tr><th>แหล่งข้อมูล</th><td>www.royalthaipolice.go.th — เมนู “ข้อมูลสถานีตำรวจ” สำนักงานตำรวจแห่งชาติ (เข้าถึง ${esc(thaiDate())})</td></tr>
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
  if ('IntersectionObserver' in window && field) {
    const io = new IntersectionObserver(([entry]) => {
      header.classList.toggle('searching', !entry.isIntersecting);
    }, { rootMargin: '-72px 0px 0px 0px', threshold: 0 });
    io.observe(field);
  }
  const toTop = $('#toTop');
  toTop.hidden = false;
  const onScroll = () => toTop.classList.toggle('show', window.scrollY > 600);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ---------- Events ---------- */
let searchDebounce;
function bindEvents() {
  const q = $('#q');
  const qMini = $('#qMini');

  q.addEventListener('input', (e) => {
    const v = e.target.value;
    qMini.value = v;
    renderSuggest();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.q = v.trim(); state.page = 1; renderResults(); }, 140);
  });
  qMini.addEventListener('input', (e) => {
    const v = e.target.value;
    q.value = v;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.q = v.trim(); state.page = 1; renderResults(); }, 140);
  });

  q.addEventListener('keydown', (e) => {
    const panel = $('#suggestPanel');
    const open = !panel.hidden;
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

  $('#sortBy').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; renderResults(); });
  $('#regionChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    state.region = btn.dataset.region;
    state.page = 1;
    renderResults();
  });
  $('#quickChips').addEventListener('click', (e) => {
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
    if (copyBtn) { const st = STATIONS.find(s => s.id === +copyBtn.dataset.copy); if (st) copyText(stationCopyText(st)).then(ok => ok && flashCopied(copyBtn)); return; }
    const printBtn = e.target.closest('[data-print-one]');
    if (printBtn) { const st = STATIONS.find(s => s.id === +printBtn.dataset.printOne); if (st) printStation(st); return; }
    const saveBtn = e.target.closest('[data-save]');
    if (saveBtn) { toggleSave(+saveBtn.dataset.save); return; }
  });

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
    const st = STATIONS.find(s => s.id === +e.currentTarget.dataset.id);
    if (st) copyText(stationCopyText(st)).then(ok => ok && flashCopied(e.currentTarget));
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

  /* Global keys + outside clicks */
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      const target = $('.header').classList.contains('searching') ? qMini : q;
      target.focus(); target.select();
    } else if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeStationModal();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#searchField')) closeSuggest();
    if (comboState.open && !e.target.closest('#provinceCombo')) closeCombo(false);
  });
}

/* ---------- Boot ---------- */
applyTheme(document.documentElement.dataset.theme || 'light');
updateProvinceLabel();
applyURL();
renderStats();
updateSavedUI();
bindEvents();
initScrollUI();
renderResults();
