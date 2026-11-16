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

function stationMatches(st, qNorm) {
  if (!qNorm) return true;
  const hay = norm(st.name) + '|' + norm(st.address) + '|' + norm(st.province_th) + '|' + norm(st.phone) + '|' + norm(REGION_SHORT[st.region] || '');
  return hay.includes(qNorm);
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

/* ---------- Populate controls ---------- */
function populateProvinces() {
  const sel = $('#provinceFilter');
  const provinces = [...new Set(STATIONS.map(s => s.province_th))].sort((a, b) => a.localeCompare(b, 'th'));
  const first = sel.options[0];
  if (first) first.textContent = `ทุกจังหวัด (${provinces.length})`;
  for (const p of provinces) {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  }
}

function renderRegionChips() {
  const box = $('#regionChips');
  box.innerHTML = REGIONS.map(r =>
    `<button class="rchip" type="button" data-region="${esc(r.id)}" aria-pressed="${r.id === state.region}" title="${esc(r.name)}">${esc(r.short)}</button>`
  ).join('');
}

function renderStats() {
  $('#statStations').textContent = STATIONS.length.toLocaleString('th-TH');
  $('#statProvinces').textContent = new Set(STATIONS.map(s => s.province_th)).size;
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

function cardHTML(st) {
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
  <article class="card ${isMetro ? 'card-type-metro' : ''}" data-id="${st.id}">
    <div class="card-main">
      <div class="card-toprow">
        <h3><button class="card-title-btn" data-open-detail="${st.id}" style="all:unset; cursor:pointer; font:inherit; color:inherit">${esc(st.name)}</button></h3>
        ${typeBadge}
        <span class="badge badge-region">${esc(REGION_SHORT[st.region] || '-')}</span>
        <span class="verified" title="ข้อมูลยืนยันจากสำนักงานตำรวจแห่งชาติ">${icon.check}ยืนยัน</span>
      </div>
      <p class="card-addr">${icon.pin}<span>${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</span></p>
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
  if (state.q) tags.push({ label: `ค้นหา: “${state.q}”`, clear: () => { state.q = ''; $('#q').value = ''; } });
  if (state.province) tags.push({ label: `จังหวัด: ${state.province}`, clear: () => { state.province = ''; $('#provinceFilter').value = ''; } });
  if (state.region !== 'all') tags.push({ label: REGION_NAME[state.region], clear: () => { state.region = 'all'; renderRegionChips(); } });
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
    if (p.get('q')) { state.q = p.get('q'); $('#q').value = state.q; }
    if (p.get('province')) {
      const prov = p.get('province');
      if ([...$('#provinceFilter').options].some(o => o.value === prov)) { state.province = prov; $('#provinceFilter').value = prov; }
    }
    if (p.get('region') && REGIONS.some(r => r.id === p.get('region'))) state.region = p.get('region');
    if (p.get('sort') && ['region', 'name', 'province'].includes(p.get('sort'))) { state.sort = p.get('sort'); $('#sortBy').value = state.sort; }
    const pg = parseInt(p.get('page') || '1', 10);
    if (pg > 0) state.page = pg;
  } catch { /* ignore */ }
}

function renderResults() {
  const list = getFiltered();
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PER_PAGE;
  const pageItems = list.slice(start, start + PER_PAGE);

  $('#resultCount').textContent = total.toLocaleString('th-TH');
  renderActiveFilters();

  const container = $('#resultsList');
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
    container.innerHTML = pageItems.map(cardHTML).join('');
  }
  renderPagination(totalPages, state.page);
  syncURL();
}

function resetFilters() {
  state.q = ''; state.province = ''; state.region = 'all'; state.savedOnly = false; state.page = 1;
  $('#q').value = ''; $('#provinceFilter').value = ''; $('#toggleSavedOnly').setAttribute('aria-pressed', 'false');
  renderRegionChips();
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
  try { await navigator.clipboard.writeText(text); showToast('คัดลอกลงคลิปบอร์ดแล้ว'); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('คัดลอกลงคลิปบอร์ดแล้ว'); } catch { showToast('คัดลอกไม่สำเร็จ'); }
    ta.remove();
  }
}

/* ---------- Modal ---------- */
const modal = $('#stationModal');
let lastFocus = null;

function openStationModal(id) {
  const st = STATIONS.find(s => s.id === id);
  if (!st) return;
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

/* ---------- Events ---------- */
let searchDebounce;
function bindEvents() {
  $('#q').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; renderResults(); }, 120);
  });
  $('#provinceFilter').addEventListener('change', (e) => { state.province = e.target.value; state.page = 1; renderResults(); });
  $('#sortBy').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; renderResults(); });
  $('#regionChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    state.region = btn.dataset.region;
    state.page = 1;
    renderRegionChips();
    renderResults();
  });
  $('#quickChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-q]');
    if (!btn) return;
    $('#q').value = btn.dataset.q;
    state.q = btn.dataset.q;
    state.page = 1;
    renderResults();
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (copyBtn) { const st = STATIONS.find(s => s.id === +copyBtn.dataset.copy); if (st) copyText(`${st.name}\n${st.address}\nโทร ${formatPhoneDisplay(st.phone) || '-'} | แฟกซ์ ${formatPhoneDisplay(st.fax) || '-'}`); return; }
    const printBtn = e.target.closest('[data-print-one]');
    if (printBtn) { const st = STATIONS.find(s => s.id === +printBtn.dataset.printOne); if (st) printStation(st); return; }
    const saveBtn = e.target.closest('[data-save]');
    if (saveBtn) { toggleSave(+saveBtn.dataset.save); return; }
  });

  $('#modalClose').addEventListener('click', closeStationModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeStationModal(); });
  $('#dCopy').addEventListener('click', (e) => {
    const st = STATIONS.find(s => s.id === +e.currentTarget.dataset.id);
    if (st) copyText(`${st.name}\n${st.address}\nโทร ${formatPhoneDisplay(st.phone) || '-'} | แฟกซ์ ${formatPhoneDisplay(st.fax) || '-'}`);
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

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); $('#q').focus();
    } else if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeStationModal();
    }
  });
}

/* ---------- Boot ---------- */
populateProvinces();
applyURL();
renderRegionChips();
renderStats();
updateSavedUI();
bindEvents();
renderResults();
