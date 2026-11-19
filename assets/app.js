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

/** Normalize Thai text for forgiving search: NFC + strip สน./สภ. prefixes + strip punctuation/whitespace */
function norm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/สถานีตำรวจ/g, '')
    .replace(/สน\.|สภ\./g, '')
    .replace(/[\s\-‐-―.,()\/\\]+/g, '');
}

/* Precomputed normalized haystack per station (built once at boot). */
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
  const list = STATIONS.filter(st =>
    stationMatches(st, qNorm) &&
    (!state.province || st.province_th === state.province) &&
    (state.region === 'all' || st.region === state.region) &&
    (!state.savedOnly || state.saved.has(st.id))
  );
  switch (state.sort) {
    case 'name':
      list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      break;
    case 'province':
      list.sort((a, b) => a.province_th.localeCompare(b.province_th, 'th') || a.name.localeCompare(b.name, 'th'));
      break;
    case 'region':
    default:
      list.sort((a, b) => (REGION_ORDER[a.region] - REGION_ORDER[b.region]) || a.province_th.localeCompare(b.province_th, 'th') || a.name.localeCompare(b.name, 'th'));
  }
  return list;
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
  const qn = norm(raw);
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
          <a href="${esc(reportURL(st))}">แจ้งที่อยู่คลาดเคลื่อน</a>
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
  } catch { /* ignore */ }
}

function applyJurURL() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('j')) jurParams.q = p.get('j');
    if (['jur', 'digest'].includes(p.get('jtab'))) jurParams.tab = p.get('jtab');
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

  const addr = hasAddress(st);
  const copyBtn = $('#dCopy');
  copyBtn.dataset.id = st.id;
  copyBtn.disabled = !addr;
  copyBtn.setAttribute('aria-describedby', 'dCopyPreview');
  $('#dCopyPreview').textContent = addr ? envelopeCopyText(st) : 'ต้นทางยังไม่มีที่อยู่สำหรับสถานีนี้ — กรุณาแจ้งที่อยู่';
  $('#dReport').href = reportURL(st);

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
    <div class="print-emblem-row">${emblemPrintSVG()}<div><div class="ps-name">PS LOCATOR</div><div class="ps-sub">สารบบสถานีตำรวจทั่วประเทศ</div></div></div>
    <div class="print-doc-title">${esc(title)}</div>
    <div class="print-doc-sub">${esc(subtitle)}</div>`;
}

function printFooter() {
  return `<div class="print-foot"><span>พิมพ์จาก PS Locator · วันที่พิมพ์ ${esc(thaiDate())}</span></div></div>`;
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

function renderJurSuggest() {
  const panel = $('#jurSuggest'), input = $('#jurQ');
  if (!panel || !input) return;
  const qRaw = input.value.trim();
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
    <button class="icon-btn" type="button" id="jurCsvBtn">ดาวน์โหลด CSV</button>
    <button class="btn btn-ghost btn-sm" type="button" id="jurClearBtn">ล้างคำค้น</button></div>`;
  const body = showHits.map(h => jurResultCard(h, R.q)).join('') + showAddr.map(h => jurAddressCard(h, R.q)).join('');
  const empty = `<div class="jur-empty"><h3>ไม่มีข้อมูล</h3>
    <p>ไม่พบ “${esc(R.q)}” ในบัญชีแนบท้ายประกาศและในที่อยู่สถานี กรุณาตรวจสอบการสะกดชื่อตำบล หรือเปิดประกาศฉบับเต็ม / สอบถามสถานีโดยตรง</p>
    <a href="https://ratchakitcha.soc.go.th/documents/17187.pdf" target="_blank" rel="noopener">เปิดประกาศฉบับจริง (PDF)</a></div>`;
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
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = $('#voiceBtn');
  if (SpeechRec && voiceBtn && input) {
    voiceBtn.style.display = 'inline-flex';
    const rec = new SpeechRec();
    rec.lang = 'th-TH';
    rec.interimResults = false;
    let listening = false;
    voiceBtn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      try { rec.start(); listening = true; voiceBtn.classList.add('is-active'); emitCapsulePulse(0.9, 480); }
      catch { listening = false; voiceBtn.classList.remove('is-active'); }
    });
    rec.addEventListener('result', (ev) => {
      const t = ev.results[0]?.[0]?.transcript || '';
      if (t) {
        input.value = t;
        $('#searchHub')?.classList.add('has-value');
        emitCapsulePulse(1, 640);
        applySearch(t);
      }
    });
    rec.addEventListener('end', () => { listening = false; voiceBtn.classList.remove('is-active'); });
  }
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
  }

  /* Global keyboard shortcuts */
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      const target = $('#searchInput') || $('#jurQ');
      if (target) { target.focus(); target.select(); emitCapsulePulse(1, 640); }
    } else if (e.key === 'Escape') {
      if (modal && modal.classList.contains('open')) {
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

  if (state.q || state.province || state.region !== 'all' || state.page > 1 || state.sort !== 'region') {
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
