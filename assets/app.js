/* ============================================================
   PS Locator — Spatial Minimalist UI (พิมพ์เขียว 1:1)
   Static · dependency-free · ข้อมูลจริง 1,484 สถานี
   ============================================================ */
'use strict';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const REGIONS = [
  { id: 'all', short: 'ทั้งหมด', name: 'ทุกกองบัญชาการ' },
  { id: 'bkk', short: 'บช.น.', name: 'กองบัญชาการตำรวจนครบาล' },
  ...Array.from({ length: 9 }, (_, i) => ({ id: 'p' + (i + 1), short: 'ภ.' + (i + 1), name: 'กองบัญชาการตำรวจภูธรภาค ' + (i + 1) })),
];
const REGION_NAME = Object.fromEntries(REGIONS.map(r => [r.id, r.name]));
const REGION_SHORT = Object.fromEntries(REGIONS.map(r => [r.id, r.short]));
const STATIONS = (window.STATIONS || []).slice();

const state = { q: '', province: '', region: 'all', sort: 'region', saved: new Set() };
try { state.saved = new Set(JSON.parse(localStorage.getItem('ps:saved') || '[]')); } catch { /* ignore */ }

function norm(s) {
  return String(s ?? '').normalize('NFC').toLowerCase()
    .replace(/สถานีตำรวจ/g, '').replace(/สน\.|สภ\./g, '').replace(/[\s\-‐-―.,()\/\\]+/g, '');
}
const HAY = new Map();
for (const st of STATIONS) {
  HAY.set(st.id, {
    name: norm(st.name), addr: norm(st.address), prov: norm(st.province_th),
    phone: norm(st.phone), region: norm(REGION_SHORT[st.region] || ''),
  });
}
const PROVINCES = (() => {
  const m = new Map();
  for (const st of STATIONS) m.set(st.province_th, (m.get(st.province_th) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'th'));
})();

function formatPhoneDisplay(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 9) return d.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{3})(\d{4,5})/, '$1-$2-$3');
  return p;
}
function hl(text, qRaw) {
  const t = String(text ?? ''), qn = norm(qRaw);
  if (!qn) return esc(t);
  const lower = t.toLowerCase();
  const i = lower.indexOf(String(qRaw).toLowerCase());
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + qRaw.length)) + '</mark>' + esc(t.slice(i + qRaw.length));
}

function getFiltered() {
  const qn = norm(state.q);
  let list = STATIONS.filter(st => {
    const h = HAY.get(st.id);
    return (!qn || h.name.includes(qn) || h.addr.includes(qn) || h.prov.includes(qn) || h.phone.includes(qn) || h.region.includes(qn)) &&
      (!state.province || st.province_th === state.province) &&
      (state.region === 'all' || st.region === state.region);
  });
  const order = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));
  list.sort((a, b) => (order[a.region] - order[b.region]) || a.province_th.localeCompare(b.province_th, 'th') || a.name.localeCompare(b.name, 'th'));
  return list;
}
function getSuggestions(raw) {
  const qn = norm(raw);
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

/* ---------- Spatial canvas — ค่าต้นฉบับ 1:1 ---------- */
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
  width = window.innerWidth; height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gridCols = Math.ceil(width / spacing) + 1;
  gridRows = Math.ceil(height / spacing) + 1;
}
function emitCapsulePulse(strength = 0.7, maxRadius) {
  if (reducedMotion.matches || !searchCapsule) return;
  const rect = searchCapsule.getBoundingClientRect();
  pulses.push({
    x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
    r: 12, maxR: maxRadius || Math.max(width, height) * 0.72, strength,
  });
  if (pulses.length > 5) pulses.shift();
}
function renderSpatialField() {
  if (ctx && !document.hidden) {
    ctx.clearRect(0, 0, width, height);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const dot = isLight ? [71, 85, 105] : [148, 163, 184];
    const pulseCol = isLight ? [2, 132, 199] : [56, 189, 248];
    const baseAlpha = document.body.classList.contains('has-results') ? 0.09 : 0.16;

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
            drawX -= dx / dist * pull; drawY -= dy / dist * pull;
            alpha += factor * 0.36; radius += factor * 1.1;
            tint = Math.max(tint, factor * 0.85);
          }
        }
        for (let p = 0; p < pulses.length; p++) {
          const pu = pulses[p];
          const band = Math.abs(Math.hypot(baseX - pu.x, baseY - pu.y) - pu.r);
          if (band < 46) {
            const wave = (1 - band / 46) * (1 - pu.r / pu.maxR) * pu.strength;
            alpha += wave * 0.55; radius += wave * 1.4; tint = Math.max(tint, wave);
          }
        }
        const r = Math.round(dot[0] + (pulseCol[0] - dot[0]) * tint);
        const g = Math.round(dot[1] + (pulseCol[1] - dot[1]) * tint);
        const b = Math.round(dot[2] + (pulseCol[2] - dot[2]) * tint);
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(alpha, 0.88).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(drawX, drawY, radius, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  requestAnimationFrame(renderSpatialField);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(renderSpatialField);

window.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
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

/* ---------- Theme ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ps:theme', t); } catch { /* ignore */ }
  const sun = $('#theme-icon-sun'), moon = $('#theme-icon-moon');
  if (sun && moon) { sun.style.display = t === 'light' ? '' : 'none'; moon.style.display = t === 'dark' ? '' : 'none'; }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#05070c' : '#f7f9fc';
  emitCapsulePulse(0.8, 560);
}

/* ---------- Toast + clipboard ---------- */
let toastTimer;
function showToast(msg) {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
const hasAddress = (st) => !!(st && String(st.address || '').trim());
const envelopeCopyText = (st) => {
  const a = String(st.address || '').trim();
  return a ? `${st.name}\n${a}` : st.name;
};
async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg || 'คัดลอกลงคลิปบอร์ดแล้ว'); return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    showToast(ok ? (successMsg || 'คัดลอกลงคลิปบอร์ดแล้ว') : 'คัดลอกไม่สำเร็จ — เปิดกล่องให้กดคัดลอกเอง');
    return ok;
  }
}
function openManualCopy(text) {
  const ov = document.createElement('div');
  ov.className = 'manual-copy';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'คัดลอกที่อยู่ด้วยตนเอง');
  ov.innerHTML = '<div class="manual-copy-box"><div class="manual-copy-head"><div><h2>คัดลอกที่อยู่ด้วยตนเอง</h2><p>กดปุ่มด้านล่างแล้วใช้ Ctrl+C หรือแตะข้อความค้างแล้วเลือก “คัดลอก”</p></div><button type="button" class="modal-close" id="mcClose" aria-label="ปิด">×</button></div><textarea id="mcText" readonly aria-label="ข้อความที่อยู่"></textarea><div class="manual-copy-foot"><button type="button" class="btn btn-primary" id="mcSelect">เลือกข้อความอีกครั้ง</button></div></div>';
  document.body.appendChild(ov);
  const ta = $('#mcText', ov); ta.value = text;
  const pick = () => { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); };
  $('#mcClose', ov).addEventListener('click', () => ov.remove());
  $('#mcSelect', ov).addEventListener('click', pick);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); ov.remove(); } });
  pick();
}
async function copyStation(st, btn) {
  if (!st) return false;
  if (!hasAddress(st)) { showToast(`${st.name} ยังไม่มีที่อยู่จากต้นทาง`); return false; }
  const text = envelopeCopyText(st);
  const ok = await copyText(text, `คัดลอกที่อยู่ ${st.name} · ${st.province_th} แล้ว`);
  if (ok && btn) {
    const label = $('#copyAddrText', btn) || btn;
    const orig = label.textContent;
    label.textContent = 'คัดลอกแล้ว ✓';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { label.textContent = orig; }, 2400);
  } else if (!ok) openManualCopy(text);
  return ok;
}

/* ---------- Suggestions ---------- */
let sugState = { items: [], active: -1 };
function renderSuggest(raw) {
  const v = String(raw || '').trim();
  if (!v) return closeSuggest();
  const { items, total } = getSuggestions(v);
  sugState = { items, active: -1 };
  if (!items.length) {
    suggestPanel.innerHTML = `<div class="sug-empty">ไม่พบสถานีที่ตรงกับ “${esc(v)}”</div>`;
  } else {
    suggestPanel.innerHTML = '<div class="suggest-list">' + items.map((it, i) => {
      const st = it.st;
      return `<div class="sug-row" role="option" id="sug-${i}" data-id="${st.id}" aria-selected="false">
        <span class="sug-name">${hl(st.name, v)}</span>
        <span class="sug-phone">${esc(formatPhoneDisplay(st.phone) || '—')}</span>
        <span class="sug-sub">${esc(st.province_th)} · ${esc(REGION_SHORT[st.region] || '-')}${hasAddress(st) ? '' : ' · ไม่มีที่อยู่'}</span>
        ${hasAddress(st) ? `<button type="button" class="sug-copy" data-copy="${st.id}" aria-label="คัดลอกที่อยู่ ${esc(st.name)}">⧉</button>` : ''}
      </div>`;
    }).join('') + '</div><div class="sug-foot"><span>จับคู่ได้ ' + total.toLocaleString('th-TH') + ' สถานี</span></div>';
  }
  suggestPanel.hidden = false;
  $('#searchInput').setAttribute('aria-expanded', 'true');
  if (capsuleTilt) capsuleTilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
}
function closeSuggest() {
  if (suggestPanel) suggestPanel.hidden = true;
  sugState.active = -1;
  const i = $('#searchInput'); if (i) i.setAttribute('aria-expanded', 'false');
}
function moveSug(delta) {
  const rows = $$('.sug-row', suggestPanel);
  if (!rows.length) return;
  let next = sugState.active + delta;
  if (next < 0) next = rows.length - 1;
  if (next >= rows.length) next = 0;
  sugState.active = next;
  rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === next)));
  rows[next].scrollIntoView({ block: 'nearest' });
  $('#searchInput').setAttribute('aria-activedescendant', rows[next].id);
}

/* ---------- Search + results ---------- */
function setResultsState(on) { document.body.classList.toggle('has-results', !!on); }
function scanStart() {
  document.body.classList.add('is-scanning');
  emitCapsulePulse(0.9, Math.max(width, height) * 0.85);
  clearTimeout(scanStart._t);
  scanStart._t = setTimeout(() => document.body.classList.remove('is-scanning'), 900);
}
function selectStation(st) {
  selected = st;
  const chip = $('#activeRegionChip');
  if (chip) chip.textContent = `สังกัด ${REGION_SHORT[st.region] || '-'} · จังหวัด ${st.province_th}`;
  const active = $('#activeStationChip');
  if (active) active.textContent = st.name;
  const box = $('#stationTelemetry');
  if (box) {
    box.innerHTML = `<h2 class="tele-title">${esc(st.name)}</h2>
      <p class="tele-addr">${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</p>
      <div class="tele-grid">
        <div><span>จังหวัด</span><b>${esc(st.province_th)}</b></div>
        <div><span>กองบัญชาการ</span><b>${esc(REGION_NAME[st.region] || '-')}</b></div>
        <div><span>โทรศัพท์</span><b>${esc(formatPhoneDisplay(st.phone) || 'ไม่มีข้อมูล')}</b></div>
        <div><span>โทรสาร</span><b>${esc(formatPhoneDisplay(st.fax) || 'ไม่มีข้อมูล')}</b></div>
      </div>
      ${st.website ? `<a class="tele-link" href="${esc(st.website)}" target="_blank" rel="noopener">เว็บไซต์สถานี</a>` : ''}
      <div class="tele-actions">
        <button type="button" class="btn btn-outline btn-sm" id="printOneBtn">พิมพ์รายละเอียด</button>
        <button type="button" class="btn btn-outline btn-sm" id="saveStationBtn" aria-pressed="${state.saved.has(st.id)}">${state.saved.has(st.id) ? 'บันทึกแล้ว ✓' : 'บันทึกสถานี'}</button>
        <a class="btn btn-outline btn-sm" href="jurisdiction.html?j=${encodeURIComponent(st.name.replace(/^สภ\.|^สน\./, '').trim())}&jtab=jur">ดูเขตอำนาจ</a>
      </div>`;
    $('#printOneBtn', box)?.addEventListener('click', () => printStation(st));
    $('#saveStationBtn', box)?.addEventListener('click', (e) => {
      if (state.saved.has(st.id)) state.saved.delete(st.id); else state.saved.add(st.id);
      try { localStorage.setItem('ps:saved', JSON.stringify([...state.saved])); } catch { /* ignore */ }
      e.currentTarget.setAttribute('aria-pressed', String(state.saved.has(st.id)));
      e.currentTarget.textContent = state.saved.has(st.id) ? 'บันทึกแล้ว ✓' : 'บันทึกสถานี';
    });
  }
  const copyBtn = $('#dCopy');
  if (copyBtn) copyBtn.disabled = !hasAddress(st);
  $$('.result-item').forEach(b => b.classList.toggle('is-selected', +b.dataset.id === st.id));
}
function applySearch(raw) {
  const v = String(raw ?? '');
  state.q = v.trim();
  state.province = state.province || '';
  setResultsState(true);
  closeSuggest();
  scanStart();
  renderResults();
  syncURL();
}
function renderResults() {
  const list = getFiltered();
  $('#resultCount').textContent = list.length.toLocaleString('th-TH');
  const box = $('#resultsList');
  if (!list.length) {
    box.innerHTML = '<div class="sug-empty">ไม่พบสถานีที่ตรงกับเงื่อนไข — ลองล้างตัวกรองแล้วค้นใหม่</div>';
    if (selected) { selected = null; }
    return;
  }
  box.innerHTML = list.map(st => `<button type="button" class="result-item" data-id="${st.id}">
      <b>${hl(st.name, state.q)}</b>
      <span>${esc(st.province_th)} · ${esc(REGION_SHORT[st.region] || '-')}</span>
      <small>${esc(st.address || 'ไม่มีข้อมูลที่อยู่')}</small>
    </button>`).join('');
  if (!selected || !list.some(s => s.id === selected.id)) selectStation(list[0]);
}
function resetAll() {
  state.q = ''; state.province = ''; state.region = 'all'; state.sort = 'region';
  const input = $('#searchInput'); if (input) input.value = '';
  const hub = $('#searchHub'); if (hub) hub.classList.remove('has-value');
  closeSuggest(); setResultsState(false); selected = null;
  const label = $('#provinceLabel'); if (label) label.textContent = 'ทุกจังหวัด (77)';
  renderRegionChips(); syncURL();
  const tele = $('#stationTelemetry');
  if (tele) tele.innerHTML = '<p style="color:var(--muted)">เลือกสถานีจากรายการเพื่อล็อกข้อมูล</p>';
  const chip = $('#activeRegionChip'); if (chip) chip.textContent = 'สังกัด — · จังหวัด —';
  const active = $('#activeStationChip'); if (active) active.textContent = 'เลือกสถานีจากรายการเพื่อล็อกข้อมูล';
  if (input) input.focus();
}
function renderRegionChips() {
  const box = $('#regionChips'); if (!box) return;
  box.innerHTML = REGIONS.map(r => `<button type="button" class="rchip" data-region="${r.id}" aria-pressed="${state.region === r.id}">${r.short}</button>`).join('');
}
function syncURL() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.province) p.set('province', state.province);
  if (state.region !== 'all') p.set('region', state.region);
  history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p.toString() : '') + location.hash);
}

/* ---------- Print / CSV (คงเดิม) ---------- */
function emblemPrintSVG() {
  return '<svg width="46" height="46" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="#7E1F1A"/><circle cx="32" cy="32" r="24.5" fill="none" stroke="#C9A227" stroke-width="1.6"/><path d="M32 12l3.1 6.3 6.9 1-5 4.9 1.2 6.9L32 30.2 25.8 33.5l1.2-6.9-5-4.9 6.9-1L32 12Z" fill="#C9A227"/></svg>';
}
function thaiDate(d = new Date()) {
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}
function printHeader(title, subtitle) {
  return `<div class="print-sheet"><div class="print-emblem-row">${emblemPrintSVG()}<div><div class="ps-name">PS LOCATOR</div><div class="ps-sub">สารบบสถานีตำรวจทั่วประเทศ</div></div></div><div class="print-doc-title">${esc(title)}</div><div class="print-doc-sub">${esc(subtitle)}</div>`;
}
function printFooter() { return `<div class="print-foot"><span>พิมพ์จาก PS Locator · วันที่พิมพ์ ${esc(thaiDate())}</span></div></div>`; }
function printStation(st) {
  $('#print-area').innerHTML = printHeader('ใบรายละเอียดสถานีตำรวจ', 'สำหรับใช้ในการปฏิบัติงาน / แนบเอกสารคดี') +
    `<table class="print-table"><tbody>
      <tr><th style="width:32%">ชื่อสถานี</th><td><strong>${esc(st.name)}</strong></td></tr>
      <tr><th>กองบัญชาการ</th><td>${esc(REGION_NAME[st.region] || '-')}</td></tr>
      <tr><th>ที่อยู่</th><td>${esc(st.address || '-')}</td></tr>
      <tr><th>จังหวัด</th><td>${esc(st.province_th)}</td></tr>
      <tr><th>โทรศัพท์</th><td>${esc(formatPhoneDisplay(st.phone) || '-')}</td></tr>
      <tr><th>โทรสาร (แฟกซ์)</th><td>${esc(formatPhoneDisplay(st.fax) || '-')}</td></tr>
      <tr><th>เว็บไซต์</th><td>${esc(st.website || '-')}</td></tr>
    </tbody></table>` + printFooter();
  window.print();
}
function printFilteredList() {
  const list = getFiltered();
  if (!list.length) { showToast('ไม่มีรายการให้พิมพ์'); return; }
  const rows = list.map((st, i) => `<tr><td>${i + 1}</td><td><strong>${esc(st.name)}</strong></td><td>${esc(st.province_th)}</td><td>${esc(st.address || '-')}</td><td>${esc(formatPhoneDisplay(st.phone) || '-')}</td></tr>`).join('');
  $('#print-area').innerHTML = printHeader('บัญชีรายนามสถานีตำรวจ', `จำนวน ${list.length} สถานี`) +
    `<table class="print-table"><thead><tr><th>#</th><th>ชื่อสถานี</th><th>จังหวัด</th><th>ที่อยู่</th><th>โทรศัพท์</th></tr></thead><tbody>${rows}</tbody></table>` + printFooter();
  window.print();
}
function exportCSV() {
  const list = getFiltered();
  if (!list.length) { showToast('ไม่มีรายการให้ดาวน์โหลด'); return; }
  const header = ['ชื่อสถานี', 'ประเภท', 'กองบัญชาการ', 'จังหวัด', 'ที่อยู่', 'โทรศัพท์', 'โทรสาร', 'เว็บไซต์'];
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [header.join(',')].concat(list.map(st => [
    q(st.name), q(st.region === 'bkk' ? 'สถานีตำรวจนครบาล' : 'สถานีตำรวจภูธร'),
    q(REGION_NAME[st.region] || ''), q(st.province_th), q(st.address || ''),
    q(st.phone || ''), q(st.fax || ''), q(st.website || ''),
  ].join(',')));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'ps-locator-stations.csv'; a.click();
  URL.revokeObjectURL(a.href);
  showToast(`ดาวน์โหลด CSV แล้ว (${list.length} รายการ)`);
}

/* ---------- Events ---------- */
const input = $('#searchInput');
input?.addEventListener('input', (e) => {
  const v = e.target.value;
  $('#searchHub').classList.toggle('has-value', !!v);
  if (v.trim()) { emitCapsulePulse(0.7); renderSuggest(v); } else closeSuggest();
});
input?.addEventListener('keydown', (e) => {
  const open = suggestPanel && !suggestPanel.hidden;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); e.stopPropagation();
    const pick = (sugState.active >= 0 && sugState.items[sugState.active]) || sugState.items[0];
    if (pick) copyStation(pick.st);
    return;
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); if (!open && input.value.trim()) renderSuggest(input.value); else moveSug(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) moveSug(-1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (open && sugState.active >= 0 && sugState.items[sugState.active]) selectStation(sugState.items[sugState.active].st);
    applySearch(input.value);
  }
  else if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    if (open) closeSuggest();
    else if (input.value) { input.value = ''; $('#searchHub').classList.remove('has-value'); resetAll(); }
  }
});
$('#searchForm')?.addEventListener('submit', e => { e.preventDefault(); applySearch(input.value); });
suggestPanel?.addEventListener('click', (e) => {
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    const st = STATIONS.find(s => s.id === +cp.dataset.copy);
    if (st) copyStation(st);
    return;
  }
  const row = e.target.closest('[data-id]');
  if (row) {
    const st = STATIONS.find(s => s.id === +row.dataset.id);
    if (st) { selectStation(st); closeSuggest(); }
  }
});
$('#clearBtn')?.addEventListener('click', resetAll);
$('#submitBtn')?.addEventListener('click', () => applySearch(input.value));
$('#theme-toggle')?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#resultsList')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) { const st = STATIONS.find(s => s.id === +b.dataset.id); if (st) selectStation(st); }
});
$('#dCopy')?.addEventListener('click', (e) => { if (selected) copyStation(selected, e.currentTarget); });
$('#regionChips')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-region]'); if (!b) return;
  state.region = b.dataset.region; renderRegionChips(); renderResults(); syncURL();
});
$('#provinceBtn')?.addEventListener('click', () => {
  const pop = $('#provincePop'); if (!pop) return;
  pop.hidden = !pop.hidden;
  $('#provinceBtn').setAttribute('aria-expanded', String(!pop.hidden));
});
$('#provinceSearch')?.addEventListener('input', (e) => {
  const q = norm(e.target.value);
  $('#provinceList').innerHTML = PROVINCES.filter(p => !q || norm(p.name).includes(q))
    .slice(0, 40).map(p => `<li role="option"><button type="button" data-province="${esc(p.name)}">${esc(p.name)} (${p.count})</button></li>`).join('');
});
$('#provinceList')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-province]'); if (!b) return;
  state.province = b.dataset.province;
  $('#provinceLabel').textContent = state.province + ' (' + (PROVINCES.find(p => p.name === state.province)?.count || 0) + ')';
  $('#provincePop').hidden = true;
  renderResults(); syncURL();
});
$('#clearFiltersBtn')?.addEventListener('click', resetAll);
$('#printListBtn')?.addEventListener('click', printFilteredList);
$('#exportCsvBtn')?.addEventListener('click', exportCSV);
document.addEventListener('click', (e) => {
  if (suggestPanel && !suggestPanel.hidden && !e.target.closest('#searchHub')) closeSuggest();
  if (!$('#provincePop')?.hidden && !e.target.closest('#provinceCombo')) {
    $('#provincePop').hidden = true;
    $('#provinceBtn').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault(); input?.focus(); input?.select(); emitCapsulePulse(1, 640);
  } else if (e.key === 'Escape' && input?.value && document.activeElement !== input && !$('.manual-copy')) {
    input.value = ''; $('#searchHub').classList.remove('has-value'); resetAll();
  }
});

/* Voice search */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceBtn = $('#voiceBtn');
if (SpeechRec && voiceBtn) {
  voiceBtn.style.display = 'inline-flex';
  const rec = new SpeechRec();
  rec.lang = 'th-TH'; rec.interimResults = false;
  let listening = false;
  voiceBtn.addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    try { rec.start(); listening = true; voiceBtn.classList.add('is-active'); emitCapsulePulse(0.9, 480); }
    catch { listening = false; voiceBtn.classList.remove('is-active'); }
  });
  rec.addEventListener('result', (ev) => {
    const t = ev.results[0]?.[0]?.transcript || '';
    if (t) { input.value = t; $('#searchHub').classList.add('has-value'); emitCapsulePulse(1, 640); applySearch(t); }
  });
  rec.addEventListener('end', () => { listening = false; voiceBtn.classList.remove('is-active'); });
}

/* ---------- Boot ---------- */
applyTheme(document.documentElement.dataset.theme || 'dark');
renderRegionChips();
try {
  const p = new URLSearchParams(location.search);
  if (p.get('q')) { state.q = p.get('q'); input.value = state.q; }
  if (p.get('province')) state.province = p.get('province');
  if (p.get('region') && REGIONS.some(r => r.id === p.get('region'))) state.region = p.get('region');
  if (p.get('sort') && ['region', 'name', 'province'].includes(p.get('sort'))) state.sort = p.get('sort');
} catch { /* ignore */ }
if (state.q || state.province || state.region !== 'all') {
  setResultsState(true);
  if (input.value) $('#searchHub').classList.add('has-value');
  renderResults();
}
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  fetch('/api/visit', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}
