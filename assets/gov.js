/* ============================================================
   PS LOCATOR — Thai Government Agencies Directory (gov.html)
   Data source: DGA Open Government Data (data/gov.js — 458 agencies)
   Spatial Minimalist 1:1 + Fast Copy + Ministry Filter + A4 Print + CSV BOM
   ============================================================ */
(function () {
  'use strict';

  const GOVS = Array.isArray(window.GOV_AGENCIES) ? window.GOV_AGENCIES : [];
  const GOV_BY_ID = new Map(GOVS.map(g => [g.id, g]));

  const CATEGORIES = [
    { id: 'all', label: 'ทั้งหมด' },
    { id: 'ministry', label: 'กระทรวง / กรม' },
    { id: 'local', label: 'ท้องถิ่น (อบจ./เทศบาล/อบต./เขต)' },
    { id: 'soe', label: 'รัฐวิสาหกิจ' },
    { id: 'public_org', label: 'องค์การมหาชน' },
    { id: 'university', label: 'สถาบันอุดมศึกษา' },
    { id: 'independent', label: 'ศาล / อัยการ / องค์กรอิสระ' },
    { id: 'other', label: 'หน่วยงานอื่นของรัฐ' }
  ];
  const CAT_LABEL = new Map(CATEGORIES.map(c => [c.id, c.label]));
  const PER_PAGE = 25;

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
    ministry: 'all',
    page: 1,
    savedOnly: false,
    selectedId: null,
    saved: new Set()
  };

  try {
    const raw = JSON.parse(localStorage.getItem('ps:gov-saved') || '[]');
    if (Array.isArray(raw)) raw.forEach(id => { if (GOV_BY_ID.has(+id)) state.saved.add(+id); });
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
      .replace(/สำนักงาน|กรม|กระทรวง|บริษัท|จำกัด|\(มหาชน\)|[\s\.\-\(\)\/]/g, '');
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
    const part = String(raw).split(/[,;\/หรือ]/)[0].split('ต่อ')[0];
    return part.replace(/\D/g, '');
  }

  function govCopyText(g) {
    const parts = [g.name];
    if (g.address) parts.push(g.address);
    if (g.phone) parts.push('โทรศัพท์ ' + g.phone);
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
    if (h2) h2.textContent = title || 'คัดลอกที่อยู่หน่วยงาน';
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
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch { /* modal */ }
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
      setTimeout(() => { btn.classList.remove('is-copied'); btn.innerHTML = COPY_ICON; }, 1500);
      return;
    }
    const orig = btn.dataset.origLabel || btn.textContent;
    btn.dataset.origLabel = orig;
    btn.classList.add('is-copied');
    btn.textContent = 'คัดลอกแล้ว ✓';
    if (msg) showToast(msg);
    setTimeout(() => { btn.classList.remove('is-copied'); btn.textContent = orig; }, 1500);
  }

  /* ---------- Search Index (built once at boot) ---------- */
  const HAY = new Map(GOVS.map(g => [g.id, {
    rawName: String(g.name || '').toLowerCase(),
    name: norm(g.name),
    en: norm(g.en),
    abbr: norm(g.abbr),
    ministry: norm(g.ministry),
    addr: norm(g.address),
    phone: String(g.phone || '').replace(/\D/g, ''),
    email: String(g.email || '').toLowerCase()
  }]));

  function matchesQuery(g, qRaw) {
    const raw = String(qRaw || '').trim().toLowerCase();
    const q = norm(qRaw);
    const qDigits = raw.replace(/\D/g, '');
    if (!raw && !q) return true;
    const h = HAY.get(g.id);
    if (raw && (h.rawName.includes(raw) || h.email.includes(raw))) return true;
    if (q && (h.name.includes(q) || h.abbr.includes(q) || h.en.includes(q) || h.ministry.includes(q) || h.addr.includes(q))) return true;
    if (qDigits && qDigits.length >= 3 && h.phone.includes(qDigits)) return true;
    return false;
  }

  function getFiltered() {
    return GOVS.filter(g => {
      if (state.cat !== 'all' && g.category !== state.cat) return false;
      if (state.ministry !== 'all' && g.ministry !== state.ministry) return false;
      if (state.savedOnly && !state.saved.has(g.id)) return false;
      if (state.q && !matchesQuery(g, state.q)) return false;
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
      const sugOpen = !$('#govSuggest').hidden;
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
    try { localStorage.setItem('ps:gov-saved', JSON.stringify([...state.saved])); } catch { /* ignore */ }
  }

  function updateSavedUI() {
    const n = state.saved.size;
    const c1 = $('#govSavedCount'), c2 = $('#idleSavedGovCount');
    if (c1) c1.textContent = n;
    if (c2) c2.textContent = n;
    const b1 = $('#govSavedOnlyBtn'), b2 = $('#idleSavedGov');
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

  /* ---------- Ministry Dropdown ---------- */
  function buildMinistrySelect() {
    const counts = new Map();
    for (const g of GOVS) counts.set(g.ministry, (counts.get(g.ministry) || 0) + 1);
    const list = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'));
    const sel = $('#govMinistrySel');
    if (!sel) return;
    sel.innerHTML = `<option value="all">ทุกกระทรวง / สังกัด (${list.length})</option>` +
      list.map(([m, cnt]) => `<option value="${esc(m)}">${esc(m)} (${cnt})</option>`).join('');
  }

  /* ---------- URL Sync ---------- */
  function syncURL() {
    try {
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.cat && state.cat !== 'all') p.set('cat', state.cat);
      if (state.ministry && state.ministry !== 'all') p.set('ministry', state.ministry);
      if (state.page > 1) p.set('page', String(state.page));
      const qs = p.toString();
      history.replaceState(null, '', (qs ? '?' + qs : window.location.pathname) + window.location.hash);
    } catch { /* ignore */ }
  }

  /* ---------- Suggestions ---------- */
  const sugState = { items: [], active: -1 };

  function buildSuggestions(qRaw) {
    const raw = String(qRaw || '').trim().toLowerCase();
    const q = norm(qRaw);
    const qDigits = raw.replace(/\D/g, '');
    if (!raw && !q) return [];
    const scored = [];
    for (const g of GOVS) {
      const h = HAY.get(g.id);
      let rank = 99;
      if ((q && (h.abbr === q || h.name.startsWith(q))) || (raw && h.rawName.startsWith(raw))) rank = 0;
      else if ((raw && h.rawName.includes(raw)) || (q && (h.name.includes(q) || h.abbr.includes(q) || h.en.includes(q)))) rank = 1;
      else if (q && h.ministry.includes(q)) rank = 2;
      else if ((q && h.addr.includes(q)) || (qDigits && qDigits.length >= 3 && h.phone.includes(qDigits))) rank = 3;
      if (rank < 99) scored.push({ g, rank });
    }
    scored.sort((a, b) => a.rank - b.rank || a.g.id - b.g.id);
    return { items: scored.slice(0, 8), total: scored.length };
  }

  function renderSuggest() {
    const panel = $('#govSuggest'), input = $('#govQ');
    if (!panel || !input) return;
    const qRaw = input.value.trim();
    if (!qRaw) { closeSuggest(); return; }
    const { items, total } = buildSuggestions(qRaw);
    sugState.items = items;
    sugState.active = -1;
    input.removeAttribute('aria-activedescendant');

    $('#capsuleTilt').style.transform = 'none';
    if (!items.length) {
      panel.innerHTML = `<div class="sug-empty">ไม่พบหน่วยงานที่ตรงกับ “${esc(qRaw)}” — ลองใช้คำค้นที่สั้นลง</div>`;
    } else {
      panel.innerHTML = '<div class="suggest-list">' + items.map(({ g }, i) => `
        <div class="sug-row" role="option" id="govSug-${i}" data-gov-sug="${g.id}" aria-selected="false">
          <span class="sug-name">${hl(g.name, qRaw)}</span>
          <span class="sug-phone">${esc(g.phone || '—')}</span>
          <span class="sug-sub">${esc(g.ministry)}${g.abbr ? ' · ' + esc(g.abbr) : ''}${g.address ? '' : ' · <b class="na-badge">ไม่มีที่อยู่</b>'}</span>
          ${g.address
            ? `<button type="button" class="sug-copy" data-sug-copy="${g.id}" aria-label="คัดลอกที่อยู่ ${esc(g.name)}" title="คัดลอกที่อยู่ · Ctrl+Enter">${COPY_ICON}</button>`
            : `<span class="sug-copy sug-copy-na" title="ยังไม่มีข้อมูลที่อยู่">${COPY_ICON}</span>`}
        </div>`).join('') + `</div><div class="sug-foot"><span>จับคู่ได้ ${total.toLocaleString('th-TH')} หน่วยงาน</span><button type="button" id="govSugAll">ดูผลลัพธ์ทั้งหมด →</button></div>`;
    }
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeSuggest() {
    const panel = $('#govSuggest'), input = $('#govQ');
    if (panel) panel.hidden = true;
    sugState.active = -1;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }

  function moveSug(delta) {
    const rows = $$('.sug-row', $('#govSuggest'));
    if (!rows.length) return;
    let next = sugState.active + delta;
    if (next < 0) next = rows.length - 1;
    if (next >= rows.length) next = 0;
    sugState.active = next;
    rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === next)));
    rows[next].scrollIntoView({ block: 'nearest' });
    $('#govQ').setAttribute('aria-activedescendant', rows[next].id);
  }

  /* ---------- Render Category Chips, List, Pager & HUD ---------- */
  function renderCatChips() {
    const counts = { all: 0 };
    for (const c of CATEGORIES) counts[c.id] = 0;
    for (const g of GOVS) {
      if (state.ministry !== 'all' && g.ministry !== state.ministry) continue;
      if (state.savedOnly && !state.saved.has(g.id)) continue;
      if (state.q && !matchesQuery(g, state.q)) continue;
      counts.all++;
      counts[g.category] = (counts[g.category] || 0) + 1;
    }
    $('#govCatChips').innerHTML = CATEGORIES.map(c =>
      `<button type="button" class="rchip" data-cat="${esc(c.id)}" aria-pressed="${c.id === state.cat}">${esc(c.label)}<span class="cnt">${counts[c.id] || 0}</span></button>`
    ).join('');
  }

  function renderHudDetail(g) {
    const body = $('#govHudBody'), foot = $('#govHudFoot'), catChip = $('#hudGovCatChip');
    if (!g) {
      if (catChip) catChip.textContent = 'หน่วยงานของรัฐในประเทศไทย';
      if (body) body.innerHTML = '<div class="empty-state">ไม่พบหน่วยงานที่ตรงกับตัวกรอง ลองเปลี่ยนคำค้นหาหรือสังกัดกระทรวง</div>';
      if (foot) foot.hidden = true;
      return;
    }

    if (catChip) catChip.textContent = (g.abbr ? g.abbr + ' · ' : '') + (CAT_LABEL.get(g.category) || g.law_cat);
    const phoneDigits = firstDialDigits(g.phone);
    const firstEmail = g.email ? g.email.split(/[;,\s]+/)[0].trim() : '';
    const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(g.name + ' ' + g.address);

    body.innerHTML = `
      <div class="bank-hud-head">
        <span class="bank-code-badge">${esc(g.abbr || CAT_LABEL.get(g.category) || 'หน่วยงานของรัฐ')}</span>
        <h2>${esc(g.name)}</h2>
        <p class="bank-legal">${esc(g.ministry)}${g.en ? ' · ' + esc(g.en) : ''}</p>
      </div>

      <div class="detail-grid bank-detail-grid">
        <div class="detail-cell full">
          <label>ที่อยู่สำหรับส่งหนังสือราชการ</label>
          <div class="v">${g.address ? esc(g.address) : '<span class="na">ไม่มีข้อมูล</span>'}</div>
        </div>
        <div class="detail-cell">
          <label>โทรศัพท์</label>
          <div class="v">${g.phone ? (phoneDigits ? `<a class="v mono" href="tel:${esc(phoneDigits)}">${esc(g.phone)}</a>` : esc(g.phone)) : '<span class="na">ไม่มีข้อมูล</span>'}</div>
        </div>
        <div class="detail-cell">
          <label>อีเมลสารบรรณ</label>
          <div class="v">${firstEmail ? `<a class="v" href="mailto:${esc(firstEmail)}">${esc(g.email)}</a>` : '<span class="na">ไม่มีข้อมูล</span>'}</div>
        </div>
        <div class="detail-cell">
          <label>เว็บไซต์ทางการ</label>
          <div class="v">${g.website ? `<a class="v" href="${esc(g.website)}" target="_blank" rel="noopener">${esc(g.website.replace(/^https?:\/\//, ''))}</a>` : '<span class="na">ไม่มีข้อมูล</span>'}</div>
        </div>
        <div class="detail-cell">
          <label>ประเภทตามกฎหมาย</label>
          <div class="v">${esc(g.law_cat || 'หน่วยงานของรัฐ')}</div>
        </div>
        ${g.mission ? `
        <div class="detail-cell full">
          <label>ภารกิจหลัก</label>
          <div class="v" style="font-weight:400; font-size:13.5px">${esc(g.mission)}</div>
        </div>` : ''}
      </div>
    `;

    if (foot) {
      foot.hidden = false;
      $('#hudGovCopyBtn').dataset.id = g.id;
      $('#hudGovPrintBtn').dataset.id = g.id;
      const saveBtn = $('#hudGovSaveBtn');
      const isSaved = state.saved.has(g.id);
      saveBtn.dataset.id = g.id;
      saveBtn.setAttribute('aria-pressed', String(isSaved));
      saveBtn.textContent = isSaved ? 'บันทึกแล้ว ✓' : 'บันทึก';
      $('#hudGovMapBtn').href = mapUrl;
    }
  }

  function renderPager(totalPages) {
    const pager = $('#govPager');
    if (!pager) return;
    if (totalPages <= 1) { pager.innerHTML = ''; return; }
    pager.innerHTML = `
      <button type="button" class="tool-btn" data-gpage="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>← ก่อนหน้า</button>
      <span class="mono" style="font-size:12px; color:var(--muted-strong)">หน้า ${state.page} / ${totalPages}</span>
      <button type="button" class="tool-btn" data-gpage="${state.page + 1}" ${state.page >= totalPages ? 'disabled' : ''}>ถัดไป →</button>
    `;
  }

  function renderWorkspace() {
    const list = getFiltered();
    $('#govResultCount').textContent = list.length.toLocaleString('th-TH');
    $('#govSrStatus').textContent = `พบ ${list.length} หน่วยงาน`;
    renderCatChips();

    if (!list.length) {
      state.selectedId = null;
      $('#govResultsList').innerHTML = '<div class="empty-state">ไม่พบหน่วยงานราชการที่ตรงกับคำค้นหา</div>';
      renderPager(0);
      renderHudDetail(null);
      syncURL();
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const slice = list.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);

    if (!list.some(g => g.id === state.selectedId)) {
      state.selectedId = slice[0].id;
    }

    $('#govResultsList').innerHTML = slice.map(g => `
      <div class="bank-row ${g.id === state.selectedId ? 'is-selected' : ''}" data-gov-id="${g.id}" role="button" tabindex="0">
        <div class="bank-row-top">
          <strong class="bank-row-name">${hl(g.name, state.q)}</strong>
          ${g.abbr ? `<span class="bank-row-code">${esc(g.abbr)}</span>` : ''}
        </div>
        <div class="bank-row-meta">
          <span>${esc(g.ministry)}</span>
          ${g.phone ? `<span class="mono">โทร ${esc(g.phone)}</span>` : ''}
        </div>
        <div class="bank-row-addr">${hl(g.address || 'ไม่มีข้อมูลที่อยู่', state.q)}</div>
      </div>`).join('');

    renderPager(totalPages);
    renderHudDetail(GOV_BY_ID.get(state.selectedId));
    syncURL();
  }

  function enterWorkspace() {
    bodyEl.classList.add('has-results');
    $('#capsuleTilt').style.transform = 'none';
    renderWorkspace();
  }

  function resetToHome() {
    state.q = ''; state.cat = 'all'; state.ministry = 'all'; state.page = 1; state.savedOnly = false; state.selectedId = null;
    $('#govQ').value = '';
    if ($('#govMinistrySel')) $('#govMinistrySel').value = 'all';
    $('#searchHub').classList.remove('has-value');
    closeSuggest();
    updateSavedUI();
    bodyEl.classList.remove('has-results');
    syncURL();
    emitCapsulePulse(0.8, 520);
    $('#govQ').focus();
  }

  /* ---------- A4 Print (no signature / no source line) ---------- */
  function printDateThai() {
    return new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function printGovOne(g) {
    $('#print-area').innerHTML = `
      <div class="print-sheet">
        <div class="print-emblem-row">
          <div>
            <div class="ps-name">PS LOCATOR — สารบบหน่วยงานของรัฐในประเทศไทย</div>
            <div class="ps-sub">ข้อมูลสถานที่ตั้งและช่องทางติดต่อราชการ</div>
          </div>
        </div>
        <div class="print-doc-title">${esc(g.name)}</div>
        <div class="print-doc-sub">${g.abbr ? esc(g.abbr) + ' · ' : ''}${esc(g.ministry)}</div>
        <table class="print-table">
          <tr><th style="width:26%">ชื่อหน่วยงาน</th><td>${esc(g.name)}${g.en ? ' (' + esc(g.en) + ')' : ''}</td></tr>
          <tr><th>สังกัด</th><td>${esc(g.ministry)}</td></tr>
          <tr><th>ประเภท</th><td>${esc(g.law_cat || CAT_LABEL.get(g.category) || 'หน่วยงานของรัฐ')}</td></tr>
          <tr><th>ที่อยู่</th><td>${esc(g.address || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>โทรศัพท์</th><td>${esc(g.phone || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>อีเมลสารบรรณ</th><td>${esc(g.email || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>เว็บไซต์</th><td>${esc(g.website || 'ไม่มีข้อมูล')}</td></tr>
          <tr><th>ภารกิจหลัก</th><td>${esc(g.mission || 'ไม่มีข้อมูล')}</td></tr>
        </table>
        <div class="print-foot"><span>พิมพ์จาก PS Locator · วันที่พิมพ์ ${esc(printDateThai())}</span></div>
      </div>`;
    window.print();
  }

  function printGovList() {
    const list = getFiltered();
    const MAX_PRINT = 500;
    const truncated = list.length > MAX_PRINT;
    const shown = truncated ? list.slice(0, MAX_PRINT) : list;
    const rows = shown.map((g, idx) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td><b>${esc(g.name)}</b><br><small>${esc(g.ministry)}</small></td>
        <td>${esc(g.address || 'ไม่มีข้อมูล')}</td>
        <td>${esc(g.phone || 'ไม่มีข้อมูล')}</td>
      </tr>`).join('');
    $('#print-area').innerHTML = `
      <div class="print-sheet">
        <div class="print-emblem-row">
          <div>
            <div class="ps-name">PS LOCATOR — บัญชีรายชื่อหน่วยงานของรัฐในประเทศไทย</div>
            <div class="ps-sub">จำนวน ${list.length.toLocaleString('th-TH')} หน่วยงาน${truncated ? ` (พิมพ์เฉพาะ ${MAX_PRINT.toLocaleString('th-TH')} รายการแรก — กรุณากรองจังหวัด/สังกัดหรือส่งออก CSV เพื่อดูทั้งหมด)` : ''}</div>
          </div>
        </div>
        <table class="print-table">
          <thead><tr><th style="width:6%">ลำดับ</th><th style="width:28%">หน่วยงาน / สังกัด</th><th style="width:46%">ที่อยู่</th><th style="width:20%">โทรศัพท์</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="print-foot"><span>พิมพ์จาก PS Locator · วันที่พิมพ์ ${esc(printDateThai())}</span></div>
      </div>`;
    window.print();
  }

  /* ---------- CSV Export (UTF-8 BOM) ---------- */
  function exportGovCSV() {
    const list = getFiltered();
    const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const header = ['ชื่อหน่วยงาน', 'ชื่อย่อ', 'ชื่อภาษาอังกฤษ', 'สังกัดกระทรวง', 'ประเภท', 'ที่อยู่', 'จังหวัด', 'โทรศัพท์', 'อีเมลสารบรรณ', 'เว็บไซต์', 'ภารกิจหลัก'];
    const lines = [header.map(cell).join(',')];
    for (const g of list) {
      lines.push([g.name, g.abbr, g.en, g.ministry, g.law_cat, g.address, g.province, g.phone, g.email, g.website, g.mission].map(cell).join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ps-locator-gov-agencies.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`ดาวน์โหลด CSV (${list.length} หน่วยงาน) แล้ว`);
  }

  /* ---------- Event Bindings ---------- */
  const qInput = $('#govQ');
  function syncInputState() { $('#searchHub').classList.toggle('has-value', qInput.value.trim().length > 0); }

  let debTimer = null;
  qInput.addEventListener('input', () => {
    syncInputState();
    emitCapsulePulse(0.45, 280);
    renderSuggest();
    if (bodyEl.classList.contains('has-results')) {
      clearTimeout(debTimer);
      debTimer = setTimeout(() => { state.q = qInput.value.trim(); state.page = 1; renderWorkspace(); }, 120);
    }
  });

  qInput.addEventListener('keydown', (e) => {
    const open = !$('#govSuggest').hidden;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const target = (open && sugState.active >= 0 && sugState.items[sugState.active]?.g) ||
        (open && sugState.items[0]?.g) ||
        GOV_BY_ID.get(state.selectedId) ||
        getFiltered()[0];
      if (target) copyText(govCopyText(target), target.name).then(ok => ok && showToast(`คัดลอกที่อยู่ ${target.name} แล้ว`));
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) renderSuggest(); else moveSug(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) moveSug(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && sugState.active >= 0 && sugState.items[sugState.active]) {
        const picked = sugState.items[sugState.active].g;
        state.q = picked.name; state.selectedId = picked.id; state.page = 1;
        qInput.value = picked.name; syncInputState(); closeSuggest(); enterWorkspace();
      } else {
        state.q = qInput.value.trim(); state.page = 1; closeSuggest(); enterWorkspace();
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); closeSuggest(); }
    } else if (e.key === 'Tab') closeSuggest();
  });

  $('#govSearchForm').addEventListener('submit', (e) => {
    e.preventDefault(); state.q = qInput.value.trim(); state.page = 1; closeSuggest(); enterWorkspace();
  });

  $('#govSuggest').addEventListener('click', (e) => {
    if (e.target.closest('#govSugAll')) {
      state.q = qInput.value.trim(); state.page = 1; closeSuggest(); enterWorkspace();
      return;
    }
    const copyBtn = e.target.closest('[data-sug-copy]');
    if (copyBtn) {
      e.stopPropagation();
      const g = GOV_BY_ID.get(+copyBtn.dataset.sugCopy);
      if (g) copyText(govCopyText(g), g.name).then(ok => ok && flashCopied(copyBtn, `คัดลอกที่อยู่ ${g.name} แล้ว`));
      return;
    }
    const row = e.target.closest('[data-gov-sug]');
    if (row) {
      const g = GOV_BY_ID.get(+row.dataset.govSug);
      if (g) {
        state.q = g.name; state.selectedId = g.id; state.page = 1;
        qInput.value = g.name; syncInputState(); closeSuggest(); enterWorkspace();
      }
    }
  });

  $('#govClearBtn').addEventListener('click', resetToHome);
  $('#govResetBtn').addEventListener('click', resetToHome);
  $('#idleBrowseGov').addEventListener('click', () => { state.cat = 'all'; state.ministry = 'all'; state.q = ''; state.page = 1; enterWorkspace(); });
  $('#idleMinistryBtn').addEventListener('click', () => { state.cat = 'ministry'; state.q = ''; state.page = 1; enterWorkspace(); });
  $('#idleLocalBtn')?.addEventListener('click', () => { state.cat = 'local'; state.q = ''; state.page = 1; enterWorkspace(); });
  $('#idleSoeBtn').addEventListener('click', () => { state.cat = 'soe'; state.q = ''; state.page = 1; enterWorkspace(); });
  $('#idlePublicOrgBtn').addEventListener('click', () => { state.cat = 'public_org'; state.q = ''; state.page = 1; enterWorkspace(); });
  $('#idleIndepBtn').addEventListener('click', () => { state.cat = 'independent'; state.q = ''; state.page = 1; enterWorkspace(); });
  $('#idleSavedGov').addEventListener('click', () => { state.savedOnly = true; state.page = 1; updateSavedUI(); enterWorkspace(); });

  $('#govCatChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.cat = btn.dataset.cat; state.page = 1; renderWorkspace();
  });

  $('#govMinistrySel').addEventListener('change', (e) => {
    state.ministry = e.target.value; state.page = 1; renderWorkspace();
  });

  $('#govSavedOnlyBtn').addEventListener('click', () => {
    state.savedOnly = !state.savedOnly; state.page = 1; updateSavedUI(); renderWorkspace();
  });

  $('#govPrintListBtn').addEventListener('click', printGovList);
  $('#govCsvBtn').addEventListener('click', exportGovCSV);

  $('#govPager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gpage]');
    if (!btn || btn.disabled) return;
    state.page = +btn.dataset.gpage;
    renderWorkspace();
    $('#govResultsList').scrollTop = 0;
  });

  $('#govResultsList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-gov-id]');
    if (!row) return;
    state.selectedId = +row.dataset.govId;
    renderWorkspace();
  });

  $('#govResultsList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-gov-id]');
    if (!row) return;
    e.preventDefault(); state.selectedId = +row.dataset.govId; renderWorkspace();
  });

  $('#hudGovCopyBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const g = GOV_BY_ID.get(+btn.dataset.id);
    if (g) copyText(govCopyText(g), g.name).then(ok => ok && flashCopied(btn, `คัดลอกที่อยู่ ${g.name} แล้ว`));
  });

  $('#hudGovPrintBtn').addEventListener('click', (e) => {
    const g = GOV_BY_ID.get(+e.currentTarget.dataset.id);
    if (g) printGovOne(g);
  });

  $('#hudGovSaveBtn').addEventListener('click', (e) => {
    const id = +e.currentTarget.dataset.id;
    if (id) toggleSave(id);
  });

  $('#manualCopyClose')?.addEventListener('click', closeManualCopy);
  $('#manualCopyModal')?.addEventListener('click', (e) => {
    if (e.target === $('#manualCopyModal')) closeManualCopy();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#govSearchForm')) closeSuggest(); });

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); qInput.focus(); qInput.select(); emitCapsulePulse(0.6, 360);
    } else if (e.key === 'Escape') {
      if ($('#manualCopyModal') && !$('#manualCopyModal').hidden) { closeManualCopy(); return; }
      if (!$('#govSuggest').hidden) { closeSuggest(); return; }
      if (bodyEl.classList.contains('has-results') || qInput.value) resetToHome();
    }
  });

  /* ---------- Voice Search (th-TH) ---------- */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    const vBtn = $('#govVoiceBtn');
    vBtn.style.display = 'inline-flex';
    const rec = new SpeechRec();
    rec.lang = 'th-TH'; rec.interimResults = false;
    let listening = false;
    vBtn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      try {
        rec.start(); listening = true; vBtn.classList.add('is-active');
        $('#inlineStatus').textContent = 'กำลังฟังเสียงพูดเพื่อค้นหาหน่วยงานราชการ…';
        $('#inlineStatus').classList.add('visible');
      } catch { listening = false; vBtn.classList.remove('is-active'); }
    });
    rec.addEventListener('result', (ev) => {
      const txt = ev.results[0]?.[0]?.transcript || '';
      if (txt) { qInput.value = txt; state.q = txt.trim(); state.page = 1; syncInputState(); enterWorkspace(); }
    });
    rec.addEventListener('end', () => { listening = false; vBtn.classList.remove('is-active'); $('#inlineStatus').classList.remove('visible'); });
    rec.addEventListener('error', () => { listening = false; vBtn.classList.remove('is-active'); $('#inlineStatus').classList.remove('visible'); });
  }

  /* ---------- Boot + URL Params + Visitor Counter ---------- */
  const totalEl = $('#idleGovTotal');
  if (totalEl) totalEl.textContent = GOVS.length.toLocaleString('th-TH');
  buildMinistrySelect();
  updateSavedUI();

  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || '';
    const cat = params.get('cat') || 'all';
    const min = params.get('ministry') || 'all';
    const pg = parseInt(params.get('page') || '1', 10);
    if (CATEGORIES.some(c => c.id === cat)) state.cat = cat;
    if (min !== 'all') { state.ministry = min; if ($('#govMinistrySel')) $('#govMinistrySel').value = min; }
    if (pg > 1) state.page = pg;
    if (q || state.cat !== 'all' || state.ministry !== 'all') {
      state.q = q; qInput.value = q; syncInputState(); enterWorkspace();
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
