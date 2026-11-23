/* ============================================================
   PS LOCATOR — Bank & e-Money Directory (banks.html)
   Spatial Minimalist 1:1 + Fast Copy + Fraud Hotlines + A4 Print + CSV BOM
   ============================================================ */
(function () {
  'use strict';

  const BANKS = Array.isArray(window.BANKS) ? window.BANKS : [];
  const BANK_BY_ID = new Map(BANKS.map(b => [b.id, b]));

  const CATEGORIES = [
    { id: 'all', label: 'ทั้งหมด' },
    { id: 'commercial', label: 'ธนาคารพาณิชย์ไทย' },
    { id: 'sfi', label: 'ธนาคารรัฐ' },
    { id: 'digital', label: 'ธนาคารออนไลน์ / Virtual' },
    { id: 'emoney', label: 'e-Money / ชำระเงิน' },
    { id: 'crypto', label: 'คริปโทฯ (ก.ล.ต.)' },
    { id: 'foreign', label: 'ธนาคารต่างประเทศ' },
    { id: 'nonbank', label: 'บัตร / สินเชื่อ / ลีสซิ่ง' }
  ];
  const CAT_LABEL = new Map(CATEGORIES.map(c => [c.id, c.label]));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const htmlEl = document.documentElement;
  const bodyEl = document.body;
  const canvas = $('#spatial-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    q: '',
    cat: 'all',
    savedOnly: false,
    selectedId: null,
    saved: new Set()
  };

  try {
    const raw = JSON.parse(localStorage.getItem('ps:banks-saved') || '[]');
    if (Array.isArray(raw)) raw.forEach(id => { if (BANK_BY_ID.has(+id)) state.saved.add(+id); });
  } catch { /* ignore */ }

  /* ---------- Utilities ---------- */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function norm(s) {
    return String(s || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/ธนาคาร|บริษัท|จำกัด|\(มหาชน\)|[\s\.\-\(\)\/]/g, '');
  }

  function hl(text, q) {
    const s = String(text ?? '');
    const term = String(q ?? '').trim();
    if (!term) return esc(s);
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    let out = '', last = 0, m;
    while ((m = re.exec(s)) !== null) {
      out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
      if (!m[0].length) break;
    }
    return out + esc(s.slice(last));
  }

  function firstDialDigits(raw) {
    if (!raw) return '';
    const part = String(raw).split(/[,;\/หรือ]/)[0].split('กด')[0];
    return part.replace(/\D/g, '');
  }

  function bankCopyText(b) {
    const parts = [b.legal_name || b.name];
    if (b.address) parts.push(b.address);
    if (b.phone) parts.push('โทรศัพท์ ' + b.phone);
    return parts.join('\n');
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function openManualCopy(text, title) {
    const modal = $('#manualCopyModal'), ta = $('#manualCopyText'), h2 = $('#manualCopyTitle');
    if (!modal || !ta) return;
    if (h2) h2.textContent = title || 'คัดลอกที่อยู่สำนักงานใหญ่';
    ta.value = text;
    modal.hidden = false;
    modal.classList.add('open');
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
  }

  function closeManualCopy() {
    const modal = $('#manualCopyModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.hidden = true;
  }

  async function copyText(text, fallbackTitle) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fallback */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch { /* fallback modal */ }
    openManualCopy(text, fallbackTitle);
    return false;
  }

  const COPY_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M4 16V5a2 2 0 0 1 2-2h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  function flashCopied(btn, msg) {
    if (!btn) return;
    if (btn.classList.contains('sug-copy')) {
      btn.classList.add('is-copied');
      btn.innerHTML = '✓';
      if (msg) showToast(msg);
      setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.innerHTML = COPY_ICON;
      }, 1500);
      return;
    }
    const orig = btn.dataset.origLabel || btn.textContent;
    btn.dataset.origLabel = orig;
    btn.classList.add('is-copied');
    btn.textContent = 'คัดลอกแล้ว ✓';
    if (msg) showToast(msg);
    setTimeout(() => {
      btn.classList.remove('is-copied');
      btn.textContent = orig;
    }, 1500);
  }

  /* ---------- Search Index (built once at boot) ---------- */
  const HAY = new Map(BANKS.map(b => [b.id, {
    name: norm(b.name),
    legal: norm(b.legal_name),
    en: norm(b.en),
    code: norm(b.code),
    addr: norm(b.address),
    phone: (b.phone + ' ' + b.fraud_phone).replace(/\D/g, ''),
    note: norm(b.note)
  }]));

  function matchesQuery(b, qRaw) {
    const q = norm(qRaw);
    const qDigits = String(qRaw || '').replace(/\D/g, '');
    if (!q && !qDigits) return true;
    const h = HAY.get(b.id);
    if (q && (h.name.includes(q) || h.legal.includes(q) || h.en.includes(q) || h.code.includes(q) || h.addr.includes(q) || h.note.includes(q))) return true;
    if (qDigits && qDigits.length >= 3 && h.phone.includes(qDigits)) return true;
    return false;
  }

  function getFiltered() {
    return BANKS.filter(b => {
      if (state.cat !== 'all' && b.category !== state.cat) return false;
      if (state.savedOnly && !state.saved.has(b.id)) return false;
      if (state.q && !matchesQuery(b, state.q)) return false;
      return true;
    });
  }

  /* ---------- Canvas Dot-Matrix & Spotlight ---------- */
  const pointer = { x: -9999, y: -9999, active: false };
  const pulses = [];
  let width = 0, height = 0, dpr = 1, gridCols = 0, gridRows = 0;
  const spacing = 38;

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gridCols = Math.ceil(width / spacing) + 1; gridRows = Math.ceil(height / spacing) + 1;
    if (reduceMotion) drawStaticField();
  }

  function emitPulse(x, y, maxR, strength) {
    if (reduceMotion) return;
    pulses.push({ x, y, r: 12, maxR: maxR || Math.max(width, height) * 0.72, strength: strength || 1 });
    if (pulses.length > 5) pulses.shift();
  }

  function emitCapsulePulse(strength, maxR) {
    const cap = $('#searchCapsule');
    if (reduceMotion || !cap) return;
    const rect = cap.getBoundingClientRect();
    emitPulse(rect.left + rect.width / 2, rect.top + rect.height / 2, maxR, strength);
  }

  function palette() {
    const light = htmlEl.dataset.theme === 'light';
    const base = bodyEl.classList.contains('has-results') ? 0.09 : 0.16;
    return light ? { dot: [71, 85, 105], pulse: [2, 132, 199], base } : { dot: [148, 163, 184], pulse: [56, 189, 248], base };
  }

  function drawStaticField() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const p = palette();
    const ox = (width - (gridCols - 1) * spacing) * 0.5, oy = (height - (gridRows - 1) * spacing) * 0.5;
    ctx.fillStyle = `rgba(${p.dot[0]},${p.dot[1]},${p.dot[2]},${p.base})`;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        ctx.beginPath(); ctx.arc(ox + c * spacing, oy + r * spacing, 1.15, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function renderSpatialField() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const p = palette();
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].r += 8.5;
      if (pulses[i].r > pulses[i].maxR) pulses.splice(i, 1);
    }
    const ox = (width - (gridCols - 1) * spacing) * 0.5, oy = (height - (gridRows - 1) * spacing) * 0.5;
    for (let r = 0; r < gridRows; r++) {
      const by = oy + r * spacing;
      for (let c = 0; c < gridCols; c++) {
        const bx = ox + c * spacing;
        let dx = bx, dy = by, alpha = p.base, rad = 1.15, tint = 0;
        if (pointer.active) {
          const rx = bx - pointer.x, ry = by - pointer.y, d2 = rx * rx + ry * ry;
          if (d2 < 36100 && d2 > 0.1) {
            const d = Math.sqrt(d2), f = 1 - d / 190, pull = f * f * 9;
            dx -= (rx / d) * pull; dy -= (ry / d) * pull;
            alpha += f * 0.36; rad += f * 1.1; tint = Math.max(tint, f * 0.85);
          }
        }
        for (let i = 0; i < pulses.length; i++) {
          const pu = pulses[i], pd = Math.hypot(bx - pu.x, by - pu.y), band = Math.abs(pd - pu.r);
          if (band < 46) {
            const w = (1 - band / 46) * (1 - pu.r / pu.maxR) * pu.strength;
            alpha += w * 0.55; rad += w * 1.4; tint = Math.max(tint, w);
          }
        }
        const R = Math.round(p.dot[0] + (p.pulse[0] - p.dot[0]) * tint);
        const G = Math.round(p.dot[1] + (p.pulse[1] - p.dot[1]) * tint);
        const B = Math.round(p.dot[2] + (p.pulse[2] - p.dot[2]) * tint);
        ctx.fillStyle = `rgba(${R},${G},${B},${Math.min(alpha, 0.88).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(dx, dy, rad, 0, Math.PI * 2); ctx.fill();
      }
    }
    requestAnimationFrame(renderSpatialField);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if (!reduceMotion) requestAnimationFrame(renderSpatialField);

  if (!reduceMotion) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
      const cap = $('#searchCapsule'), tilt = $('#capsuleTilt');
      if (!cap || !tilt) return;
      const rect = cap.getBoundingClientRect();
      cap.style.setProperty('--spot-x', (e.clientX - rect.left) + 'px');
      cap.style.setProperty('--spot-y', (e.clientY - rect.top) + 'px');
      const sugOpen = !$('#bankSuggest').hidden;
      if (!bodyEl.classList.contains('has-results') && !sugOpen) {
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        if (Math.hypot(e.clientX - cx, e.clientY - cy) < 360) {
          const rotY = ((e.clientX - cx) / 360) * 3.2;
          const rotX = -((e.clientY - cy) / 360) * 3.2;
          tilt.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
        } else tilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
      } else tilt.style.transform = 'none';
    });
    window.addEventListener('pointerleave', () => {
      pointer.active = false;
      const tilt = $('#capsuleTilt');
      if (tilt) tilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
    });
  }

  /* ---------- Theme (ps:theme) ---------- */
  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    htmlEl.dataset.theme = t;
    const sun = $('#theme-icon-sun'), moon = $('#theme-icon-moon'), btn = $('#themeToggle');
    if (sun) sun.style.display = t === 'dark' ? 'block' : 'none';
    if (moon) moon.style.display = t === 'light' ? 'block' : 'none';
    if (btn) btn.setAttribute('aria-pressed', String(t === 'dark'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'light' ? '#f7f9fc' : '#05070c';
    if (reduceMotion) drawStaticField();
  }
  applyTheme(htmlEl.dataset.theme || 'dark');
  $('#themeToggle')?.addEventListener('click', () => {
    const next = htmlEl.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ps:theme', next); } catch { /* ignore */ }
    applyTheme(next);
    emitCapsulePulse(0.75, 500);
  });

  /* ---------- Saved State ---------- */
  function persistSaved() {
    try { localStorage.setItem('ps:banks-saved', JSON.stringify([...state.saved])); } catch { /* ignore */ }
  }

  function updateSavedUI() {
    const n = state.saved.size;
    const c1 = $('#bankSavedCount'), c2 = $('#idleSavedBankCount');
    if (c1) c1.textContent = n;
    if (c2) c2.textContent = n;
    const b1 = $('#bankSavedOnlyBtn'), b2 = $('#idleSavedBanks');
    if (b1) {
      b1.hidden = n === 0 && !state.savedOnly;
      b1.setAttribute('aria-pressed', String(state.savedOnly));
    }
    if (b2) b2.hidden = n === 0;
  }

  function toggleSave(id) {
    if (state.saved.has(id)) state.saved.delete(id);
    else state.saved.add(id);
    persistSaved();
    updateSavedUI();
    renderWorkspace();
  }

  /* ---------- URL Sync ---------- */
  function syncURL() {
    try {
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.cat && state.cat !== 'all') p.set('cat', state.cat);
      const qs = p.toString();
      history.replaceState(null, '', (qs ? '?' + qs : window.location.pathname) + window.location.hash);
    } catch { /* ignore */ }
  }

  /* ---------- Suggestions ---------- */
  const sugState = { items: [], active: -1 };

  function buildSuggestions(qRaw) {
    const q = norm(qRaw);
    const qDigits = String(qRaw || '').replace(/\D/g, '');
    if (!q && !qDigits) return [];
    const scored = [];
    for (const b of BANKS) {
      const h = HAY.get(b.id);
      let rank = 99;
      if (q && (h.code === q || h.name.startsWith(q) || h.en.startsWith(q))) rank = 0;
      else if (q && (h.name.includes(q) || h.code.includes(q) || h.en.includes(q))) rank = 1;
      else if (q && (h.legal.includes(q) || h.note.includes(q))) rank = 2;
      else if (qDigits && qDigits.length >= 3 && h.phone.includes(qDigits)) rank = 3;
      if (rank < 99) scored.push({ b, rank });
    }
    scored.sort((a, b) => a.rank - b.rank || a.b.id - b.b.id);
    return { items: scored.slice(0, 8), total: scored.length };
  }

  function renderSuggest() {
    const panel = $('#bankSuggest'), input = $('#bankQ');
    if (!panel || !input) return;
    const qRaw = input.value.trim();
    if (!qRaw) { closeSuggest(); return; }
    const { items, total } = buildSuggestions(qRaw);
    sugState.items = items;
    sugState.active = -1;
    input.removeAttribute('aria-activedescendant');

    $('#capsuleTilt').style.transform = 'none';
    if (!items.length) {
      panel.innerHTML = `<div class="sug-empty">ไม่พบธนาคารหรือบริการที่ตรงกับ “${esc(qRaw)}” — ลองใช้คำค้นที่สั้นลง</div>`;
    } else {
      panel.innerHTML = '<div class="suggest-list">' + items.map(({ b }, i) => {
        const phone = b.fraud_phone || b.phone || '—';
        return `<div class="sug-row" role="option" id="bankSug-${i}" data-bank-sug="${b.id}" aria-selected="false">
          <span class="sug-name">${hl(b.name, qRaw)}</span>
          <span class="sug-phone">${esc(phone)}</span>
          <span class="sug-sub">${esc(b.code)} · ${esc(CAT_LABEL.get(b.category) || '')}</span>
          ${b.address
            ? `<button type="button" class="sug-copy" data-sug-copy="${b.id}" aria-label="คัดลอกที่อยู่ ${esc(b.name)}" title="คัดลอกที่อยู่ · Ctrl+Enter">${COPY_ICON}</button>`
            : `<span class="sug-copy sug-copy-na" title="ยังไม่มีข้อมูลที่อยู่">${COPY_ICON}</span>`}
        </div>`;
      }).join('') + `</div><div class="sug-foot"><span>จับคู่ได้ ${total.toLocaleString('th-TH')} แห่ง</span><button type="button" id="bankSugAll">ดูผลลัพธ์ทั้งหมด →</button></div>`;
    }
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeSuggest() {
    const panel = $('#bankSuggest'), input = $('#bankQ');
    if (panel) panel.hidden = true;
    sugState.active = -1;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }

  function moveSug(delta) {
    const rows = $$('.sug-row', $('#bankSuggest'));
    if (!rows.length) return;
    let next = sugState.active + delta;
    if (next < 0) next = rows.length - 1;
    if (next >= rows.length) next = 0;
    sugState.active = next;
    rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === next)));
    rows[next].scrollIntoView({ block: 'nearest' });
    $('#bankQ').setAttribute('aria-activedescendant', rows[next].id);
  }

  /* ---------- Render Category Chips, List & HUD ---------- */
  function renderCatChips() {
    const counts = { all: 0 };
    for (const c of CATEGORIES) counts[c.id] = 0;
    for (const b of BANKS) {
      if (state.savedOnly && !state.saved.has(b.id)) continue;
      if (state.q && !matchesQuery(b, state.q)) continue;
      counts.all++;
      counts[b.category] = (counts[b.category] || 0) + 1;
    }
    $('#bankCatChips').innerHTML = CATEGORIES.map(c =>
      `<button type="button" class="rchip" data-cat="${esc(c.id)}" aria-pressed="${c.id === state.cat}">${esc(c.label)}<span class="cnt">${counts[c.id] || 0}</span></button>`
    ).join('');
  }

  function renderHudDetail(b) {
    const body = $('#bankHudBody'), foot = $('#bankHudFoot'), catChip = $('#hudCatChip');
    if (!b) {
      if (catChip) catChip.textContent = 'สถาบันการเงินในประเทศไทย';
      if (body) body.innerHTML = '<div class="empty-state">ไม่พบข้อมูลที่ตรงกับตัวกรอง ลองเปลี่ยนคำค้นหาหรือประเภทสถาบันการเงิน</div>';
      if (foot) foot.hidden = true;
      return;
    }

    if (catChip) catChip.textContent = `${b.code} · ${CAT_LABEL.get(b.category) || ''}`;
    const fraudDigits = firstDialDigits(b.fraud_phone);
    const phoneDigits = firstDialDigits(b.phone);
    const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((b.legal_name || b.name) + ' ' + b.address);

    body.innerHTML = `
      <div class="bank-hud-head">
        <span class="bank-code-badge">${esc(b.code)}</span>
        <h2>${esc(b.name)}</h2>
        <p class="bank-legal">${esc(b.legal_name)}${b.en ? ' · ' + esc(b.en) : ''}</p>
      </div>

      ${b.fraud_phone ? `
      <div class="bank-fraud-box">
        <span class="bank-fraud-label">สายด่วนแจ้งอายัดบัญชี / ภัยทางการเงิน</span>
        <div class="bank-fraud-val">
          ${fraudDigits ? `<a href="tel:${esc(fraudDigits)}" class="mono">${esc(b.fraud_phone)}</a>` : `<span class="mono">${esc(b.fraud_phone)}</span>`}
        </div>
      </div>` : ''}

      <div class="detail-grid bank-detail-grid">
        <div class="detail-cell full">
          <label>ที่อยู่สำนักงานใหญ่ (สำหรับส่งหนังสือราชการ / หมายเรียก)</label>
          <div class="v">${b.address ? esc(b.address) : '<span class="na">ไม่มีข้อมูล</span>'}</div>
        </div>
        <div class="detail-cell">
          <label>Call Center / โทรศัพท์</label>
          <div class="v">${b.phone ? (phoneDigits ? `<a class="v mono" href="tel:${esc(phoneDigits)}">${esc(b.phone)}</a>` : esc(b.phone)) : '<span class="na">ไม่มีข้อมูล</span>'}</div>
        </div>
        <div class="detail-cell">
          <label>เว็บไซต์ทางการ</label>
          <div class="v">${b.website ? `<a class="v" href="${esc(b.website)}" target="_blank" rel="noopener">${esc(b.website.replace(/^https?:\/\//, ''))}</a>` : '<span class="na">ไม่มีข้อมูล</span>'}</div>
        </div>
        ${b.note ? `
        <div class="detail-cell full">
          <label>หมายเหตุ</label>
          <div class="v" style="font-weight:400; font-size:13.5px">${esc(b.note)}</div>
        </div>` : ''}
      </div>
    `;

    if (foot) {
      foot.hidden = false;
      $('#hudCopyBtn').dataset.id = b.id;
      $('#hudPrintBtn').dataset.id = b.id;
      const saveBtn = $('#hudSaveBtn');
      const isSaved = state.saved.has(b.id);
      saveBtn.dataset.id = b.id;
      saveBtn.setAttribute('aria-pressed', String(isSaved));
      saveBtn.textContent = isSaved ? 'บันทึกแล้ว ✓' : 'บันทึก';
      $('#hudMapBtn').href = mapUrl;
    }
  }

  function renderWorkspace() {
    const list = getFiltered();
    $('#bankResultCount').textContent = list.length.toLocaleString('th-TH');
    $('#bankSrStatus').textContent = `พบ ${list.length} แห่ง`;
    renderCatChips();

    if (!list.length) {
      state.selectedId = null;
      $('#bankResultsList').innerHTML = '<div class="empty-state">ไม่พบธนาคารหรือผู้ให้บริการที่ตรงกับคำค้นหา</div>';
      renderHudDetail(null);
      syncURL();
      return;
    }

    if (!list.some(b => b.id === state.selectedId)) {
      state.selectedId = list[0].id;
    }

    $('#bankResultsList').innerHTML = list.map(b => `
      <div class="bank-row ${b.id === state.selectedId ? 'is-selected' : ''}" data-bank-id="${b.id}" role="button" tabindex="0">
        <div class="bank-row-top">
          <strong class="bank-row-name">${hl(b.name, state.q)}</strong>
          <span class="bank-row-code">${esc(b.code)}</span>
        </div>
        <div class="bank-row-meta">
          <span>${esc(CAT_LABEL.get(b.category) || '')}</span>
          ${b.fraud_phone ? `<span class="bank-row-fraud">อายัด ${esc(b.fraud_phone)}</span>` : (b.phone ? `<span>โทร ${esc(b.phone)}</span>` : '')}
        </div>
        <div class="bank-row-addr">${hl(b.address, state.q)}</div>
      </div>`).join('');

    renderHudDetail(BANK_BY_ID.get(state.selectedId));
    syncURL();
  }

  function enterWorkspace() {
    bodyEl.classList.add('has-results');
    $('#capsuleTilt').style.transform = 'none';
    renderWorkspace();
  }

  function resetToHome() {
    state.q = '';
    state.cat = 'all';
    state.savedOnly = false;
    state.selectedId = null;
    $('#bankQ').value = '';
    $('#searchHub').classList.remove('has-value');
    closeSuggest();
    updateSavedUI();
    bodyEl.classList.remove('has-results');
    syncURL();
    emitCapsulePulse(0.8, 520);
    $('#bankQ').focus();
  }

  /* ---------- A4 Print (no signature / no source line) ---------- */
  function printDateThai() {
    return new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function printBankOne(b) {
    const area = $('#print-area');
    area.innerHTML = `
      <div class="print-sheet">
        <div class="print-emblem-row">
          <div>
            <div class="ps-name">KADEEHUB — สารบบธนาคารและผู้ให้บริการทางการเงิน</div>
            <div class="ps-sub">ข้อมูลสำนักงานใหญ่และช่องทางติดต่อประสานงาน</div>
          </div>
        </div>
        <div class="print-doc-title">${esc(b.legal_name || b.name)}</div>
        <div class="print-doc-sub">${esc(b.code)} · ${esc(CAT_LABEL.get(b.category) || '')}</div>
        <table class="print-table">
          <tr><th style="width:28%">ชื่อเรียก</th><td>${esc(b.name)}${b.en ? ' (' + esc(b.en) + ')' : ''}</td></tr>
          <tr><th>ชื่อนิติบุคคล</th><td>${esc(b.legal_name || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>ที่อยู่สำนักงานใหญ่</th><td>${esc(b.address || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>เบอร์แจ้งอายัดบัญชี</th><td>${esc(b.fraud_phone || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>Call Center / โทรศัพท์</th><td>${esc(b.phone || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>เว็บไซต์ทางการ</th><td>${esc(b.website || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>หมายเหตุ</th><td>${esc(b.note || 'ไม่มีข้อมูล')}</td></tr>
        </table>
        <div class="print-foot"><span>พิมพ์จาก KadeeHub (kadeehub.online) · วันที่พิมพ์ ${esc(printDateThai())}</span></div>
      </div>`;
    window.print();
  }

  function printBankList() {
    const list = getFiltered();
    const area = $('#print-area');
    const rows = list.map((b, idx) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td><b>${esc(b.name)}</b><br><small>${esc(b.code)} · ${esc(CAT_LABEL.get(b.category) || '')}</small></td>
        <td>${esc(b.address || 'ไม่มีข้อมูล')}</td>
        <td>${esc(b.fraud_phone || b.phone || 'ไม่มีข้อมูล')}</td>
      </tr>`).join('');
    area.innerHTML = `
      <div class="print-sheet">
        <div class="print-emblem-row">
          <div>
            <div class="ps-name">KADEEHUB — บัญชีรายชื่อธนาคารและผู้ให้บริการทางการเงิน</div>
            <div class="ps-sub">จำนวน ${list.length} แห่ง</div>
          </div>
        </div>
        <table class="print-table">
          <thead><tr><th style="width:6%">ลำดับ</th><th style="width:26%">สถาบันการเงิน</th><th style="width:46%">ที่อยู่สำนักงานใหญ่</th><th style="width:22%">เบอร์อายัด / โทรศัพท์</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="print-foot"><span>พิมพ์จาก KadeeHub (kadeehub.online) · วันที่พิมพ์ ${esc(printDateThai())}</span></div>
      </div>`;
    window.print();
  }

  /* ---------- CSV Export (UTF-8 BOM) ---------- */
  function exportBanksCSV() {
    const list = getFiltered();
    const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const header = ['รหัส', 'ชื่อสถาบันการเงิน', 'ชื่อนิติบุคคล', 'ประเภท', 'ที่อยู่สำนักงานใหญ่', 'เบอร์แจ้งอายัดบัญชี', 'โทรศัพท์', 'เว็บไซต์', 'หมายเหตุ'];
    const lines = [header.map(cell).join(',')];
    for (const b of list) {
      lines.push([b.code, b.name, b.legal_name, CAT_LABEL.get(b.category) || '', b.address, b.fraud_phone, b.phone, b.website, b.note].map(cell).join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ps-locator-banks.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`ดาวน์โหลด CSV (${list.length} แห่ง) แล้ว`);
  }

  /* ---------- Event Bindings ---------- */
  const qInput = $('#bankQ');

  function syncInputState() {
    $('#searchHub').classList.toggle('has-value', qInput.value.trim().length > 0);
  }

  qInput.addEventListener('input', () => {
    syncInputState();
    emitCapsulePulse(0.45, 280);
    renderSuggest();
    if (bodyEl.classList.contains('has-results')) {
      state.q = qInput.value.trim();
      renderWorkspace();
    }
  });

  qInput.addEventListener('keydown', (e) => {
    const open = !$('#bankSuggest').hidden;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const target = (open && sugState.active >= 0 && sugState.items[sugState.active]?.b) ||
        (open && sugState.items[0]?.b) ||
        BANK_BY_ID.get(state.selectedId) ||
        getFiltered()[0];
      if (target) {
        copyText(bankCopyText(target), target.name).then(ok => ok && showToast(`คัดลอกที่อยู่ ${target.name} แล้ว`));
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) renderSuggest(); else moveSug(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) moveSug(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && sugState.active >= 0 && sugState.items[sugState.active]) {
        const picked = sugState.items[sugState.active].b;
        state.q = picked.name;
        state.selectedId = picked.id;
        qInput.value = picked.name;
        syncInputState();
        closeSuggest();
        enterWorkspace();
      } else {
        state.q = qInput.value.trim();
        closeSuggest();
        enterWorkspace();
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); closeSuggest(); }
    } else if (e.key === 'Tab') {
      closeSuggest();
    }
  });

  $('#bankSearchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = qInput.value.trim();
    closeSuggest();
    enterWorkspace();
  });

  $('#bankSuggest').addEventListener('click', (e) => {
    if (e.target.closest('#bankSugAll')) {
      state.q = qInput.value.trim();
      closeSuggest();
      enterWorkspace();
      return;
    }
    const copyBtn = e.target.closest('[data-sug-copy]');
    if (copyBtn) {
      e.stopPropagation();
      const b = BANK_BY_ID.get(+copyBtn.dataset.sugCopy);
      if (b) copyText(bankCopyText(b), b.name).then(ok => ok && flashCopied(copyBtn, `คัดลอกที่อยู่ ${b.name} แล้ว`));
      return;
    }
    const row = e.target.closest('[data-bank-sug]');
    if (row) {
      const b = BANK_BY_ID.get(+row.dataset.bankSug);
      if (b) {
        state.q = b.name;
        state.selectedId = b.id;
        qInput.value = b.name;
        syncInputState();
        closeSuggest();
        enterWorkspace();
      }
    }
  });

  $('#bankClearBtn').addEventListener('click', resetToHome);
  $('#bankResetBtn').addEventListener('click', resetToHome);
  $('#idleBrowseBanks').addEventListener('click', () => { state.cat = 'all'; state.q = ''; enterWorkspace(); });
  $('#idleEmoneyBtn').addEventListener('click', () => { state.cat = 'emoney'; state.q = ''; enterWorkspace(); });
  $('#idleDigitalBtn').addEventListener('click', () => { state.cat = 'digital'; state.q = ''; enterWorkspace(); });
  $('#idleCryptoBtn')?.addEventListener('click', () => { state.cat = 'crypto'; state.q = ''; enterWorkspace(); });
  $('#idleSavedBanks').addEventListener('click', () => { state.savedOnly = true; updateSavedUI(); enterWorkspace(); });

  $('#bankCatChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.cat = btn.dataset.cat;
    renderWorkspace();
  });

  $('#bankSavedOnlyBtn').addEventListener('click', () => {
    state.savedOnly = !state.savedOnly;
    updateSavedUI();
    renderWorkspace();
  });

  $('#bankPrintListBtn').addEventListener('click', printBankList);
  $('#bankCsvBtn').addEventListener('click', exportBanksCSV);

  $('#bankResultsList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-bank-id]');
    if (!row) return;
    state.selectedId = +row.dataset.bankId;
    renderWorkspace();
  });

  $('#bankResultsList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-bank-id]');
    if (!row) return;
    e.preventDefault();
    state.selectedId = +row.dataset.bankId;
    renderWorkspace();
  });

  $('#hudCopyBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const b = BANK_BY_ID.get(+btn.dataset.id);
    if (b) copyText(bankCopyText(b), b.name).then(ok => ok && flashCopied(btn, `คัดลอกที่อยู่ ${b.name} แล้ว`));
  });

  $('#hudPrintBtn').addEventListener('click', (e) => {
    const b = BANK_BY_ID.get(+e.currentTarget.dataset.id);
    if (b) printBankOne(b);
  });

  $('#hudSaveBtn').addEventListener('click', (e) => {
    const id = +e.currentTarget.dataset.id;
    if (id) toggleSave(id);
  });

  $('#manualCopyClose')?.addEventListener('click', closeManualCopy);
  $('#manualCopyModal')?.addEventListener('click', (e) => {
    if (e.target === $('#manualCopyModal')) closeManualCopy();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#bankSearchForm')) closeSuggest();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      qInput.focus();
      qInput.select();
      emitCapsulePulse(0.6, 360);
    } else if (e.key === 'Escape') {
      if ($('#manualCopyModal') && !$('#manualCopyModal').hidden) { closeManualCopy(); return; }
      if (!$('#bankSuggest').hidden) { closeSuggest(); return; }
      if (bodyEl.classList.contains('has-results') || qInput.value) resetToHome();
    }
  });

  /* ---------- Voice Search (th-TH) ---------- */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    const vBtn = $('#bankVoiceBtn');
    vBtn.style.display = 'inline-flex';
    const rec = new SpeechRec();
    rec.lang = 'th-TH';
    rec.interimResults = false;
    let listening = false;
    vBtn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      try {
        rec.start(); listening = true; vBtn.classList.add('is-active');
        $('#inlineStatus').textContent = 'กำลังฟังเสียงพูดเพื่อค้นหาธนาคาร…';
        $('#inlineStatus').classList.add('visible');
      } catch { listening = false; vBtn.classList.remove('is-active'); }
    });
    rec.addEventListener('result', (ev) => {
      const txt = ev.results[0]?.[0]?.transcript || '';
      if (txt) { qInput.value = txt; state.q = txt.trim(); syncInputState(); enterWorkspace(); }
    });
    rec.addEventListener('end', () => {
      listening = false; vBtn.classList.remove('is-active');
      $('#inlineStatus').classList.remove('visible');
    });
    rec.addEventListener('error', () => {
      listening = false; vBtn.classList.remove('is-active');
      $('#inlineStatus').classList.remove('visible');
    });
  }

  /* ---------- Boot + URL Params + Visitor Counter ---------- */
  const totalEl = $('#idleBankTotal');
  if (totalEl) totalEl.textContent = BANKS.length.toLocaleString('th-TH');
  updateSavedUI();

  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || '';
    const cat = params.get('cat') || 'all';
    if (CATEGORIES.some(c => c.id === cat)) state.cat = cat;
    if (q || state.cat !== 'all') {
      state.q = q;
      qInput.value = q;
      syncInputState();
      enterWorkspace();
    }
  } catch { /* ignore */ }

  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.protocol !== 'file:') {
    fetch('/api/visit', { method: 'POST', credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const vEl = $('#statViews'), wrap = $('#visitorCounter');
        if (vEl && typeof data.views === 'number') vEl.textContent = data.views.toLocaleString('th-TH');
        if (wrap && typeof data.visitors === 'number') wrap.title = `ผู้เข้าชมไม่ซ้ำรายวัน ${data.visitors.toLocaleString('th-TH')} คน`;
      })
      .catch(() => {});
  }
})();
