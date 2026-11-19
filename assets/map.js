/* ============================================================
   PS LOCATOR — Spatial Map Search + Nearest Police Stations + Jurisdiction Link
   Uses data/stations.js (read-only), lazy data/jurisdictions.js (read-only),
   OSM Nominatim (geocoding/reverse), and Overpass API (nearby amenity=police)
   ============================================================ */
(function () {
  'use strict';

  const STATIONS = Array.isArray(window.STATIONS) ? window.STATIONS : [];
  const ST_BY_ID = new Map(STATIONS.map(s => [s.id, s]));

  const htmlEl = document.documentElement;
  const bodyEl = document.body;
  const canvas = document.getElementById('spatial-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  const themeToggle = document.getElementById('theme-toggle');
  const iconSun = document.getElementById('theme-icon-sun');
  const iconMoon = document.getElementById('theme-icon-moon');

  const searchHub = document.getElementById('search-hub');
  const searchForm = document.getElementById('search-form');
  const capsuleTilt = document.getElementById('capsule-tilt');
  const searchCapsule = document.getElementById('search-capsule');
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-btn');
  const voiceBtn = document.getElementById('voice-btn');
  const gpsBtn = document.getElementById('gps-btn');
  const idleGpsBtn = document.getElementById('idleGpsBtn');
  const inlineStatus = document.getElementById('inline-status');

  const resultsLabel = document.getElementById('results-label');
  const sourceBadge = document.getElementById('source-badge');
  const mapJurBox = document.getElementById('mapJurBox');
  const nearbyStationsBox = document.getElementById('nearbyStationsBox');
  const resultsList = document.getElementById('results-list');
  const activeCoordChip = document.getElementById('active-coord-chip');
  const activePlaceChip = document.getElementById('active-place-chip');
  const copyCoordBtn = document.getElementById('copy-coord-btn');
  const copyCoordText = document.getElementById('copy-coord-text');
  const openGmapsBtn = document.getElementById('open-gmaps-btn');

  let currentResults = [];
  let selectedItem = null;
  let mapInstance = null;
  let activeMarker = null;
  let stationLayer = null;
  let activeSearchController = null;
  let activeDetailController = null;
  let copyTimer = null;
  let jurData = window.JURISDICTION || null;
  let jurPromise = null;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Utilities ---------- */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normStation(s) {
    return String(s || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/สถานีตำรวจภูธร|สถานีตำรวจนครบาล|สถานีตำรวจ|สภ\.|สน\.|จว\.|จังหวัด|จ\.|[\s\.\-\(\)\/]/g, '');
  }

  function normAdmin(s) {
    return String(s || '')
      .normalize('NFC')
      .trim()
      .replace(/^(เทศบาลนคร|เทศบาลเมือง|เทศบาลตำบล|องค์การบริหารส่วนตำบล|อบต\.|ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.)\s*/g, '')
      .replace(/\s+/g, '');
  }

  function formatPhone(raw) {
    if (!raw) return 'ไม่มีข้อมูล';
    return String(raw).split(/[,;\/]/)[0].trim() || 'ไม่มีข้อมูล';
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function loadJurisdiction() {
    if (jurData) return Promise.resolve(jurData);
    if (window.JURISDICTION) { jurData = window.JURISDICTION; return Promise.resolve(jurData); }
    if (jurPromise) return jurPromise;
    jurPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'data/jurisdictions.js';
      s.onload = function () {
        if (window.JURISDICTION) { jurData = window.JURISDICTION; resolve(jurData); }
        else reject(new Error('Missing JURISDICTION'));
      };
      s.onerror = function () { jurPromise = null; reject(new Error('Failed loading jurisdictions.js')); };
      document.head.appendChild(s);
    });
    return jurPromise;
  }

  /* Match an OSM police POI name against official STATIONS */
  const ST_INDEX = STATIONS.map(function (st) {
    return { st: st, key: normStation(st.name), prov: normAdmin(st.province_th) };
  });

  function matchOfficialStation(poiName, provinceHint) {
    const key = normStation(poiName);
    if (!key || key.length < 2) return null;
    const pHint = normAdmin(provinceHint || '');
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < ST_INDEX.length; i++) {
      const entry = ST_INDEX[i];
      let score = 0;
      if (entry.key === key) score = 100;
      else if (entry.key.length >= 3 && key.includes(entry.key)) score = 75;
      else if (key.length >= 3 && entry.key.includes(key)) score = 60;
      if (!score) continue;
      if (pHint && entry.prov && (entry.prov === pHint || entry.prov.includes(pHint) || pHint.includes(entry.prov))) {
        score += 30;
      }
      if (score > bestScore) { bestScore = score; best = entry.st; }
    }
    return bestScore >= 60 ? best : null;
  }

  /* =====================================================================
     1. Interactive Spatial Dot-Matrix & Sonic Pulse Canvas
  ===================================================================== */
  const pointer = { x: -9999, y: -9999, active: false };
  const pulses = [];
  let width = 0, height = 0, dpr = 1, gridCols = 0, gridRows = 0;
  const spacing = 38;

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
    if (reduceMotion) drawStaticField();
  }

  function emitPulse(originX, originY, maxRadius, strength) {
    if (reduceMotion) return;
    pulses.push({ x: originX, y: originY, r: 12, maxR: maxRadius || Math.max(width, height) * 0.72, strength: strength || 1 });
    if (pulses.length > 5) pulses.shift();
  }

  function emitCapsulePulse(strength, maxRadius) {
    if (reduceMotion || !searchCapsule) return;
    const rect = searchCapsule.getBoundingClientRect();
    emitPulse(rect.left + rect.width / 2, rect.top + rect.height / 2, maxRadius, strength);
  }

  function getThemeColors() {
    const isLight = htmlEl.getAttribute('data-theme') === 'light';
    return isLight
      ? { dot: [71, 85, 105], pulse: [2, 132, 199], baseAlpha: 0.16 }
      : { dot: [148, 163, 184], pulse: [56, 189, 248], baseAlpha: 0.16 };
  }

  function drawStaticField() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const palette = getThemeColors();
    const offsetX = (width - (gridCols - 1) * spacing) * 0.5;
    const offsetY = (height - (gridRows - 1) * spacing) * 0.5;
    ctx.fillStyle = 'rgba(' + palette.dot[0] + ',' + palette.dot[1] + ',' + palette.dot[2] + ',' + palette.baseAlpha + ')';
    for (let row = 0; row < gridRows; row++) {
      const y = offsetY + row * spacing;
      for (let col = 0; col < gridCols; col++) {
        ctx.beginPath();
        ctx.arc(offsetX + col * spacing, y, 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function renderSpatialField() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const palette = getThemeColors();
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
        let drawX = baseX, drawY = baseY, alpha = palette.baseAlpha, radius = 1.15, usePulseTint = 0;
        if (pointer.active) {
          const dx = baseX - pointer.x, dy = baseY - pointer.y, distSq = dx * dx + dy * dy;
          if (distSq < 36100 && distSq > 0.1) {
            const dist = Math.sqrt(distSq), factor = 1 - dist / 190, pull = factor * factor * 9;
            drawX -= (dx / dist) * pull; drawY -= (dy / dist) * pull;
            alpha += factor * 0.36; radius += factor * 1.1; usePulseTint = Math.max(usePulseTint, factor * 0.85);
          }
        }
        for (let p = 0; p < pulses.length; p++) {
          const pulse = pulses[p], pDist = Math.hypot(baseX - pulse.x, baseY - pulse.y), band = Math.abs(pDist - pulse.r);
          if (band < 46) {
            const wave = (1 - band / 46) * (1 - pulse.r / pulse.maxR) * pulse.strength;
            alpha += wave * 0.55; radius += wave * 1.4; usePulseTint = Math.max(usePulseTint, wave);
          }
        }
        const r = Math.round(palette.dot[0] + (palette.pulse[0] - palette.dot[0]) * usePulseTint);
        const g = Math.round(palette.dot[1] + (palette.pulse[1] - palette.dot[1]) * usePulseTint);
        const b = Math.round(palette.dot[2] + (palette.pulse[2] - palette.dot[2]) * usePulseTint);
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + Math.min(alpha, 0.88).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    requestAnimationFrame(renderSpatialField);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if (!reduceMotion) requestAnimationFrame(renderSpatialField);

  /* =====================================================================
     2. Capsule Spotlight & 3D Micro-Parallax
  ===================================================================== */
  if (!reduceMotion) {
    window.addEventListener('pointermove', function (e) {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
      const rect = searchCapsule.getBoundingClientRect();
      searchCapsule.style.setProperty('--spot-x', (e.clientX - rect.left) + 'px');
      searchCapsule.style.setProperty('--spot-y', (e.clientY - rect.top) + 'px');
      if (!bodyEl.classList.contains('has-results')) {
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        if (Math.hypot(e.clientX - cx, e.clientY - cy) < 360) {
          const rotY = ((e.clientX - cx) / 360) * 3.2;
          const rotX = -((e.clientY - cy) / 360) * 3.2;
          capsuleTilt.style.transform = 'rotateX(' + rotX.toFixed(2) + 'deg) rotateY(' + rotY.toFixed(2) + 'deg)';
        } else capsuleTilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
      } else capsuleTilt.style.transform = 'none';
    });
    window.addEventListener('pointerleave', function () {
      pointer.active = false;
      capsuleTilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
    });
  }

  /* =====================================================================
     3. Theme Toggle (synced with ps:theme)
  ===================================================================== */
  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    htmlEl.dataset.theme = t;
    if (iconSun) iconSun.style.display = t === 'dark' ? 'block' : 'none';
    if (iconMoon) iconMoon.style.display = t === 'light' ? 'block' : 'none';
    if (themeToggle) themeToggle.setAttribute('aria-pressed', String(t === 'dark'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'light' ? '#f7f9fc' : '#05070c';
    if (reduceMotion) drawStaticField();
  }
  applyTheme(htmlEl.dataset.theme || 'dark');
  themeToggle.addEventListener('click', function () {
    const nextTheme = htmlEl.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ps:theme', nextTheme); } catch (_) {}
    applyTheme(nextTheme);
    emitCapsulePulse(0.75, 500);
  });

  /* =====================================================================
     4. Input Micro-Interactions & Shortcuts
  ===================================================================== */
  function syncInputState() {
    searchHub.classList.toggle('has-value', searchInput.value.trim().length > 0);
  }
  searchInput.addEventListener('input', function () { syncInputState(); emitCapsulePulse(0.45, 280); });
  window.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault(); searchInput.focus(); emitCapsulePulse(0.6, 360);
    } else if (e.key === 'Escape') {
      if (bodyEl.classList.contains('has-results') || searchInput.value) resetToMinimalHome();
    }
  });

  function showStatus(text) {
    inlineStatus.textContent = text || '';
    inlineStatus.classList.toggle('visible', Boolean(text));
  }

  function resetToMinimalHome() {
    if (activeSearchController) { activeSearchController.abort(); activeSearchController = null; }
    if (activeDetailController) { activeDetailController.abort(); activeDetailController = null; }
    bodyEl.classList.remove('is-scanning', 'has-results');
    searchInput.value = '';
    syncInputState();
    showStatus('');
    currentResults = [];
    selectedItem = null;
    resultsList.innerHTML = '';
    if (mapJurBox) { mapJurBox.innerHTML = ''; mapJurBox.hidden = true; }
    if (nearbyStationsBox) { nearbyStationsBox.innerHTML = ''; nearbyStationsBox.hidden = true; }
    if (stationLayer) stationLayer.clearLayers();
    if (openGmapsBtn) openGmapsBtn.hidden = true;
    emitCapsulePulse(0.8, 520);
    searchInput.focus();
  }
  clearBtn.addEventListener('click', resetToMinimalHome);

  /* =====================================================================
     5. Leaflet Spatial Map + Station Markers
  ===================================================================== */
  function ensureMapInitialized() {
    if (mapInstance || typeof window.L === 'undefined') return;
    mapInstance = window.L.map('locator-map', { zoomControl: false, attributionControl: false }).setView([13.7563, 100.5018], 13);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstance);
    window.L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);
    stationLayer = window.L.layerGroup().addTo(mapInstance);

    mapInstance.on('click', function (ev) {
      const coordStr = ev.latlng.lat.toFixed(5) + ', ' + ev.latlng.lng.toFixed(5);
      searchInput.value = coordStr;
      syncInputState();
      executeSearch(coordStr);
    });
  }

  function extractAdminFromAddress(addr, displayName) {
    const a = addr || {};
    const rawProv = a.province || a.state || '';
    let province = normAdmin(rawProv);
    if (/bangkok|krung\s*thep/i.test(rawProv) || /กรุงเทพ/.test(rawProv) || /กรุงเทพ/.test(displayName || '')) {
      province = 'กรุงเทพมหานคร';
    }
    const amphoe = normAdmin(a.county || a.city_district || a.district || a.municipality || '');
    const tambons = [];
    const pushTambon = function (val, allowSameAsProv) {
      if (!val) return;
      const raw = String(val).trim();
      const explicitTambon = /^(ตำบล|ต\.|แขวง)/.test(raw);
      const cleaned = normAdmin(raw);
      if (!cleaned) return;
      /* ตำบลที่เป็นชื่อเดียวกับจังหวัด (เช่น ต.ประจวบคีรีขันธ์, ต.ชุมพร) ต้องเก็บไว้ด้วยเมื่อระบุชัดเจน */
      if (!allowSameAsProv && !explicitTambon && cleaned === province) return;
      if (tambons.indexOf(cleaned) === -1) tambons.push(cleaned);
    };
    /* ให้ความสำคัญสูงสุดกับคำหลัง "ตำบล" หรือ "แขวง" ใน display_name */
    if (displayName) {
      const matches = displayName.matchAll(/(?:ตำบล|แขวง)\s*([^\s,]+)/g);
      for (const m of matches) {
        if (m[1]) pushTambon(m[1], true);
      }
    }
    /* ใน OSM ประเทศไทย ชื่อตำบลมักอยู่ใน suburb, city, town หรือ municipality */
    const primaryFields = [a.suburb, a.quarter, a.city, a.town, a.municipality, a.city_district];
    for (let i = 0; i < primaryFields.length; i++) {
      pushTambon(primaryFields[i], false);
    }
    /* หมู่บ้าน (village/hamlet) ไว้ลำดับท้ายสุดเพื่อไม่ให้ทับชื่อตำบลจริง */
    const secondaryFields = [a.neighbourhood, a.village, a.hamlet];
    for (let i = 0; i < secondaryFields.length; i++) {
      pushTambon(secondaryFields[i], false);
    }
    return { tambons: tambons, amphoe: amphoe, province: province };
  }

  function findJurisdictionForAdmin(admin) {
    if (!jurData || !jurData.index) return { matchedTambon: '', recs: [] };
    const byProv = function (rec) {
      if (!admin.province) return true;
      return normAdmin(rec.province) === admin.province;
    };
    const byAmphoe = function (rec) {
      if (!admin.amphoe) return false;
      const ra = normAdmin(rec.amphoe);
      return ra === admin.amphoe || ra.includes(admin.amphoe) || admin.amphoe.includes(ra);
    };

    for (let i = 0; i < admin.tambons.length; i++) {
      const t = admin.tambons[i];
      const idxList = jurData.index[t];
      if (!idxList || !idxList.length) continue;
      /* ห้ามข้ามจังหวัดเมื่อทราบจังหวัดแล้ว เพื่อป้องกันชื่อตำบลซ้ำกันข้ามจังหวัด */
      let recs = idxList.map(function (idx) { return jurData.stations[idx]; }).filter(function (rec) {
        return rec && byProv(rec);
      });
      if (!recs.length) continue;
      const ampRecs = recs.filter(byAmphoe);
      if (ampRecs.length) recs = ampRecs;
      /* ถ้ามีทั้งสถานีที่ครอบคลุมเต็มตำบลและสถานีที่รับเฉพาะบางส่วน ให้เรียงเต็มตำบลขึ้นก่อน */
      if (recs.length > 1) {
        const isFull = function (rec) {
          const tb = rec.tambons.find(function (x) { return normAdmin(typeof x === 'string' ? x : x.n) === t; });
          return tb && (typeof tb === 'string' || !tb.p);
        };
        const fullOnly = recs.filter(isFull);
        if (fullOnly.length === 1) recs = fullOnly;
      }
      return { matchedTambon: t, recs: recs };
    }

    /* ถ้าไม่พบชื่อตำบลตรง ให้จับคู่เฉพาะสถานีหลักของอำเภอ+จังหวัดเดียวกัน (ไม่แสดงซ้ำหลาย สภ.) */
    if (admin.amphoe && admin.province) {
      const recs = jurData.stations.filter(function (rec) { return byProv(rec) && byAmphoe(rec); });
      if (recs.length) {
        const mainRec = recs.find(function (r) { return normAdmin(r.short) === admin.amphoe || normAdmin(r.short) === 'เมือง' + admin.province; }) || recs[0];
        return { matchedTambon: admin.amphoe, recs: [mainRec], byAmphoeOnly: true };
      }
    }
    return { matchedTambon: admin.tambons[0] || '', recs: [] };
  }

  function renderJurisdictionBox(admin, lat, lon) {
    if (!mapJurBox) return;
    if (!admin.province && !admin.tambons.length) {
      mapJurBox.hidden = true;
      mapJurBox.innerHTML = '';
      return;
    }

    mapJurBox.hidden = false;
    mapJurBox.innerHTML = '<div class="map-sec-head"><span>เขตอำนาจสอบสวนของตำแหน่งนี้</span></div><div class="map-sec-loading">กำลังตรวจสอบเขตอำนาจสอบสวน…</div>';

    loadJurisdiction().then(function () {
      const found = findJurisdictionForAdmin(admin);
      const displayTambon = found.recs.length && !found.byAmphoeOnly ? found.matchedTambon : admin.tambons[0];
      const areaLabel = [
        displayTambon ? (admin.province === 'กรุงเทพมหานคร' ? 'แขวง' : 'ต.') + displayTambon : '',
        admin.amphoe ? (admin.province === 'กรุงเทพมหานคร' ? 'เขต' : 'อ.') + admin.amphoe : '',
        admin.province ? (admin.province === 'กรุงเทพมหานคร' ? admin.province : 'จ.' + admin.province) : ''
      ].filter(Boolean).join(' · ');

      if (found.recs.length) {
        const cards = found.recs.map(function (rec) {
          const st = ST_BY_ID.get(rec.id);
          const fullName = st ? st.name : 'สภ.' + rec.short;
          const phone = st && st.phone ? formatPhone(st.phone) : 'ไม่มีข้อมูล';
          const digits = st && st.phone ? String(st.phone).split(/[,;\/]/)[0].replace(/\D/g, '') : '';
          const matchedT = rec.tambons.find(function (tb) {
            const name = typeof tb === 'string' ? tb : tb.n;
            return normAdmin(name) === found.matchedTambon;
          });
          const isPartial = matchedT && typeof matchedT === 'object' && matchedT.p;
          const warnParts = [];
          if (isPartial) warnParts.push('เขตบางส่วน/เฉพาะบางหมู่ที่');
          if (rec.verify) warnParts.push('โปรดตรวจรายชื่อตำบลกับประกาศฉบับจริง');
          if (found.byAmphoeOnly) warnParts.push('จับคู่จากระดับอำเภอ (ไม่พบชื่อตำบลตรง)');
          const warnHtml = warnParts.length
            ? '<div class="map-jur-warn">' + esc(warnParts.join(' · ')) + '</div>'
            : '';
          const navUrl = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(lat.toFixed(5) + ',' + lon.toFixed(5)) + '&destination=' + encodeURIComponent(fullName + ' ' + rec.province);
          return (
            '<div class="map-jur-card">' +
              '<div class="map-jur-top">' +
                '<strong>' + esc(fullName) + '</strong>' +
              '</div>' +
              '<div class="map-jur-sub">' + esc(rec.amphoe ? 'อ.' + rec.amphoe + ' · ' : '') + 'จ.' + esc(rec.province) + ' · โทร ' + esc(phone) + '</div>' +
              warnHtml +
              '<div class="map-card-actions">' +
                (digits ? '<a class="map-mini-btn map-mini-primary" href="tel:' + esc(digits) + '">โทร</a>' : '') +
                '<a class="map-mini-btn" href="jurisdiction.html?j=' + encodeURIComponent(found.matchedTambon || rec.short) + '&jtab=jur">ดูเขตอำนาจเต็ม</a>' +
                '<a class="map-mini-btn" href="index.html?q=' + encodeURIComponent(fullName) + '">ดูในสารบบ</a>' +
                '<a class="map-mini-btn" href="' + esc(navUrl) + '" target="_blank" rel="noopener">นำทาง</a>' +
              '</div>' +
            '</div>'
          );
        }).join('');

        mapJurBox.innerHTML =
          '<div class="map-sec-head">' +
            '<span>เขตอำนาจสอบสวนของตำแหน่งนี้</span>' +
            (areaLabel ? '<small>' + esc(areaLabel) + '</small>' : '') +
          '</div>' +
          cards +
          '<p class="map-jur-note">โปรดตรวจสอบประกาศราชกิจจานุเบกษาฉบับจริงก่อนนำไปใช้ทางกฎหมาย</p>';
      } else if (admin.province === 'กรุงเทพมหานคร') {
        const bkkQuery = admin.tambons[0] || admin.amphoe || 'กรุงเทพ';
        mapJurBox.innerHTML =
          '<div class="map-sec-head">' +
            '<span>พื้นที่เขตอำนาจ (กทม.)</span>' +
            (areaLabel ? '<small>' + esc(areaLabel) + '</small>' : '') +
          '</div>' +
          '<div class="map-jur-card">' +
            '<div class="map-jur-sub">พื้นที่กรุงเทพมหานครกำหนดเขตตามแนวถนน/คลอง ดู สน. ใกล้เคียงด้านล่างหรือตรวจสอบเพิ่มเติมในหน้าเขตอำนาจ</div>' +
            '<div class="map-card-actions">' +
              '<a class="map-mini-btn map-mini-primary" href="jurisdiction.html?j=' + encodeURIComponent(bkkQuery) + '&jtab=jur">ตรวจในหน้าเขตอำนาจ</a>' +
              '<a class="map-mini-btn" href="index.html?q=' + encodeURIComponent(bkkQuery) + '">ค้นในสารบบ สน.</a>' +
            '</div>' +
          '</div>';
      } else {
        mapJurBox.innerHTML =
          '<div class="map-sec-head">' +
            '<span>เขตอำนาจสอบสวนของตำแหน่งนี้</span>' +
            (areaLabel ? '<small>' + esc(areaLabel) + '</small>' : '') +
          '</div>' +
          '<div class="map-jur-card">' +
            '<div class="map-jur-sub">ไม่พบชื่อตำบลตรงในบัญชีแนบท้าย ลองค้นหาด้วยชื่อตำบลหรือ สภ. ในหน้าเขตอำนาจ</div>' +
            '<div class="map-card-actions">' +
              '<a class="map-mini-btn" href="jurisdiction.html?j=' + encodeURIComponent(admin.tambons[0] || admin.amphoe || admin.province) + '&jtab=jur">เปิดหน้าเขตอำนาจ</a>' +
            '</div>' +
          '</div>';
      }
    }).catch(function () {
      mapJurBox.hidden = true;
    });
  }

  function renderNearbyStations(lat, lon, admin, signal) {
    if (!nearbyStationsBox) return;
    nearbyStationsBox.hidden = false;
    nearbyStationsBox.innerHTML =
      '<div class="map-sec-head"><span>สภ./สน. ใกล้ตำแหน่งนี้</span><small>กำลังค้นหาสถานีตำรวจใกล้เคียง…</small></div>';

    if (stationLayer) stationLayer.clearLayers();

    /* ใช้ Nominatim viewbox (~18 กม.) เป็นแหล่งหลักที่เสถียรกว่า Overpass เพื่อหาสถานีตำรวจพร้อมพิกัดจริง */
    const delta = 0.18;
    const viewbox = [
      (lon - delta).toFixed(4),
      (lat + delta).toFixed(4),
      (lon + delta).toFixed(4),
      (lat - delta).toFixed(4)
    ].join(',');
    const nomUrl =
      'https://nominatim.openstreetmap.org/search?format=json&accept-language=th,en&bounded=1&limit=12&viewbox=' +
      encodeURIComponent(viewbox) +
      '&q=' + encodeURIComponent('สถานีตำรวจ');

    fetch(nomUrl, { signal: signal })
      .then(function (r) { if (!r.ok) throw new Error('Nominatim police lookup failed'); return r.json(); })
      .then(function (list) {
        const els = Array.isArray(list) ? list : [];
        const seen = new Set();
        const items = [];
        for (let i = 0; i < els.length; i++) {
          const el = els[i];
          const pLat = Number(el.lat), pLon = Number(el.lon);
          if (!isFinite(pLat) || !isFinite(pLon)) continue;
          const rawName = el.name || (el.display_name ? el.display_name.split(',')[0] : '');
          if (!rawName || el.class === 'highway' || /^(ซอย|ถนน|แยก|ป้ายรถ)/.test(rawName)) continue;
          const official = matchOfficialStation(rawName, admin.province);
          const displayName = official ? official.name : rawName;
          const dedupKey = official ? 'id:' + official.id : 'n:' + normStation(rawName);
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          items.push({
            name: displayName,
            lat: pLat,
            lon: pLon,
            distKm: haversineKm(lat, lon, pLat, pLon),
            official: official
          });
        }
        items.sort(function (a, b) { return a.distKm - b.distKm; });
        const top = items.slice(0, 6);
        if (top.length) {
          drawNearbyStationList(top, lat, lon, true);
        } else {
          drawFallbackAreaStations(admin, lat, lon);
        }
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        drawFallbackAreaStations(admin, lat, lon);
      });
  }

  function drawNearbyStationList(items, originLat, originLon, hasCoords) {
    if (stationLayer && mapInstance && typeof window.L !== 'undefined' && hasCoords) {
      stationLayer.clearLayers();
      const stIcon = window.L.divIcon({
        className: '',
        html: '<div class="ps-station-pin" title="สถานีตำรวจ"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      items.forEach(function (it) {
        const phoneTxt = it.official && it.official.phone ? '<br>โทร ' + esc(formatPhone(it.official.phone)) : '';
        const marker = window.L.marker([it.lat, it.lon], { icon: stIcon })
          .bindPopup('<strong>' + esc(it.name) + '</strong><br>ห่าง ' + it.distKm.toFixed(1) + ' กม.' + phoneTxt);
        marker.addTo(stationLayer);
        it._marker = marker;
      });
    }

    nearbyStationsBox.innerHTML =
      '<div class="map-sec-head">' +
        '<span>สภ./สน. ใกล้ตำแหน่งนี้</span>' +
        '<small>' + (hasCoords ? 'เรียงตามระยะทางจริง' : 'ในพื้นที่เดียวกัน') + '</small>' +
      '</div>';

    items.forEach(function (it) {
      const card = document.createElement('div');
      card.className = 'map-station-card';
      const st = it.official;
      const phone = st && st.phone ? formatPhone(st.phone) : 'ไม่มีข้อมูล';
      const digits = st && st.phone ? String(st.phone).split(/[,;\/]/)[0].replace(/\D/g, '') : '';
      const shortName = it.name.replace(/^สภ\.|^สน\./, '').trim();
      const navDest = hasCoords
        ? it.lat.toFixed(5) + ',' + it.lon.toFixed(5)
        : it.name + (st ? ' ' + st.province_th : '');
      const navUrl = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(originLat.toFixed(5) + ',' + originLon.toFixed(5)) + '&destination=' + encodeURIComponent(navDest);

      card.innerHTML =
        '<div class="map-jur-top">' +
          '<button type="button" class="map-st-focus">' + esc(it.name) + '</button>' +
          (hasCoords ? '<span class="map-dist">' + it.distKm.toFixed(1) + ' กม.</span>' : '') +
        '</div>' +
        '<div class="map-jur-sub">' +
          (st ? (esc(st.province_th) + ' · โทร ' + esc(phone)) : 'ตำแหน่งสถานีตำรวจจาก OpenStreetMap') +
        '</div>' +
        '<div class="map-card-actions">' +
          (digits ? '<a class="map-mini-btn map-mini-primary" href="tel:' + esc(digits) + '">โทร</a>' : '') +
          '<a class="map-mini-btn" href="jurisdiction.html?j=' + encodeURIComponent(shortName) + '&jtab=jur">เขตอำนาจ</a>' +
          (st ? '<a class="map-mini-btn" href="index.html?q=' + encodeURIComponent(st.name) + '">สารบบ</a>' : '') +
          '<a class="map-mini-btn" href="' + esc(navUrl) + '" target="_blank" rel="noopener">นำทาง</a>' +
        '</div>';

      const focusBtn = card.querySelector('.map-st-focus');
      if (focusBtn && hasCoords && mapInstance) {
        focusBtn.addEventListener('click', function () {
          mapInstance.flyTo([it.lat, it.lon], 16, { duration: reduceMotion ? 0 : 0.7 });
          if (it._marker) it._marker.openPopup();
        });
      }
      nearbyStationsBox.appendChild(card);
    });
  }

  function drawFallbackAreaStations(admin, originLat, originLon) {
    if (!admin.province) {
      nearbyStationsBox.hidden = true;
      return;
    }
    const provMatches = STATIONS.filter(function (s) {
      return normAdmin(s.province_th) === admin.province;
    });
    let list = provMatches;
    if (admin.amphoe) {
      const ampMatches = provMatches.filter(function (s) {
        return normAdmin(s.address).includes(admin.amphoe) || normStation(s.name).includes(admin.amphoe);
      });
      if (ampMatches.length) list = ampMatches;
    }
    const top = list.slice(0, 5).map(function (st) {
      return { name: st.name, official: st, distKm: 0 };
    });
    if (top.length) {
      drawNearbyStationList(top, originLat, originLon, false);
    } else {
      nearbyStationsBox.hidden = true;
    }
  }

  function enrichLocationContext(item, latNum, lonNum) {
    if (activeDetailController) activeDetailController.abort();
    activeDetailController = new AbortController();
    const signal = activeDetailController.signal;

    const handleAdmin = function (addrObj, displayName) {
      const admin = extractAdminFromAddress(addrObj, displayName);
      renderJurisdictionBox(admin, latNum, lonNum);
      renderNearbyStations(latNum, lonNum, admin, signal);
    };

    if (item.address) {
      handleAdmin(item.address, item.display_name);
      return;
    }

    fetch(
      'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&accept-language=th,en&lat=' +
        encodeURIComponent(latNum) + '&lon=' + encodeURIComponent(lonNum),
      { signal: signal }
    )
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.address) {
          item.address = data.address;
          handleAdmin(data.address, data.display_name || item.display_name);
        } else {
          handleAdmin({}, item.display_name);
        }
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        handleAdmin({}, item.display_name);
      });
  }

  function focusLocationOnViewport(item) {
    selectedItem = item;
    const latNum = Number(item.lat);
    const lonNum = Number(item.lon);
    const coordFormatted = latNum.toFixed(5) + ', ' + lonNum.toFixed(5);

    activeCoordChip.textContent = 'LAT ' + latNum.toFixed(5) + ' · LON ' + lonNum.toFixed(5);
    activePlaceChip.textContent = item.name || item.display_name;

    if (openGmapsBtn) {
      openGmapsBtn.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(coordFormatted);
      openGmapsBtn.hidden = false;
    }

    const buttons = resultsList.querySelectorAll('.map-result-item');
    buttons.forEach(function (btn, idx) {
      btn.classList.toggle('is-selected', currentResults[idx] === item);
    });

    ensureMapInitialized();
    if (mapInstance && typeof window.L !== 'undefined') {
      setTimeout(function () {
        mapInstance.invalidateSize();
        mapInstance.flyTo([latNum, lonNum], 14, { duration: reduceMotion ? 0 : 0.9 });
        const pinIcon = window.L.divIcon({
          className: '',
          html: '<div class="ps-pin"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        if (activeMarker) activeMarker.setLatLng([latNum, lonNum]);
        else activeMarker = window.L.marker([latNum, lonNum], { icon: pinIcon }).addTo(mapInstance);
      }, 80);
    }

    copyCoordBtn.dataset.coords = coordFormatted;
    enrichLocationContext(item, latNum, lonNum);
  }

  function copyCoords(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }
  copyCoordBtn.addEventListener('click', function () {
    const coords = copyCoordBtn.dataset.coords;
    if (!coords) return;
    copyCoords(coords).then(function (ok) {
      copyCoordText.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { copyCoordText.textContent = 'คัดลอกพิกัด'; }, 1600);
    });
  });

  /* =====================================================================
     6. Live Geocoding & Coordinate Parsing (OSM Nominatim)
  ===================================================================== */
  function parseDirectCoordinates(raw) {
    const match = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const lat = parseFloat(match[1]), lon = parseFloat(match[2]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat: lat, lon: lon };
  }

  function renderResults(items) {
    currentResults = items || [];
    bodyEl.classList.add('has-results');
    capsuleTilt.style.transform = 'none';

    sourceBadge.textContent = 'LIVE · OSM';
    resultsLabel.textContent = 'สภ./สน. ใกล้ตำแหน่งนี้ & เขตอำนาจ';
    resultsList.innerHTML = '';

    if (!currentResults.length) {
      if (mapJurBox) { mapJurBox.innerHTML = ''; mapJurBox.hidden = true; }
      if (nearbyStationsBox) { nearbyStationsBox.innerHTML = ''; nearbyStationsBox.hidden = true; }
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent = 'ไม่พบตำแหน่งที่ตรงกับคำค้นหา ลองระบุชื่อสถานที่ ตำบล เขต หรือพิกัดละติจูด, ลองจิจูด (เช่น 13.7563, 100.5018)';
      resultsList.appendChild(emptyDiv);
      activeCoordChip.textContent = 'LAT — · LON —';
      activePlaceChip.textContent = 'ไม่พบพิกัดที่ตรงกัน';
      if (openGmapsBtn) openGmapsBtn.hidden = true;
      return;
    }

    if (currentResults.length > 1) {
      const head = document.createElement('div');
      head.className = 'map-sec-head';
      head.innerHTML = '<span>ตำแหน่งที่ตรงกับคำค้น (' + currentResults.length + ')</span>';
      resultsList.appendChild(head);
    }

    currentResults.forEach(function (item, index) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-result-item' + (index === 0 ? ' is-selected' : '');

      const title = document.createElement('div');
      title.className = 'result-title';
      title.textContent = item.name || (item.display_name ? item.display_name.split(',')[0] : 'ตำแหน่งที่ค้นพบ');

      const address = document.createElement('div');
      address.className = 'result-address';
      address.textContent = item.display_name || '';

      const coords = document.createElement('div');
      coords.className = 'result-coords';
      coords.textContent = Number(item.lat).toFixed(5) + ', ' + Number(item.lon).toFixed(5);

      btn.appendChild(title);
      btn.appendChild(address);
      btn.appendChild(coords);
      btn.addEventListener('click', function () { focusLocationOnViewport(item); });
      resultsList.appendChild(btn);
    });

    focusLocationOnViewport(currentResults[0]);
  }

  async function executeSearch(queryText) {
    const trimmed = queryText.trim();
    if (!trimmed) {
      capsuleTilt.classList.remove('shake');
      void capsuleTilt.offsetWidth;
      capsuleTilt.classList.add('shake');
      searchInput.focus();
      return;
    }

    if (activeSearchController) activeSearchController.abort();
    activeSearchController = new AbortController();
    const timeoutId = setTimeout(function () { if (activeSearchController) activeSearchController.abort(); }, 9000);

    bodyEl.classList.add('is-scanning');
    showStatus('');
    emitCapsulePulse(1, Math.max(width, height) * 0.9);

    const directCoords = parseDirectCoordinates(trimmed);

    try {
      if (directCoords) {
        const revUrl =
          'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&accept-language=th,en&lat=' +
          encodeURIComponent(directCoords.lat) + '&lon=' + encodeURIComponent(directCoords.lon);
        const resp = await fetch(revUrl, { signal: activeSearchController.signal });
        if (!resp.ok) throw new Error('Reverse lookup failed');
        const data = await resp.json();
        renderResults([{
          name: data.name || 'พิกัดที่ระบุ (' + directCoords.lat.toFixed(4) + ', ' + directCoords.lon.toFixed(4) + ')',
          display_name: data.display_name || 'พิกัดละติจูด ' + directCoords.lat + ', ลองจิจูด ' + directCoords.lon,
          lat: directCoords.lat,
          lon: directCoords.lon,
          address: data.address || null
        }]);
      } else {
        const base = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&accept-language=th,en&limit=6&q=' + encodeURIComponent(trimmed);
        let resp = await fetch(base + '&countrycodes=th', { signal: activeSearchController.signal });
        if (!resp.ok) throw new Error('Search lookup failed');
        let list = await resp.json();
        if (!Array.isArray(list) || list.length === 0) {
          resp = await fetch(base, { signal: activeSearchController.signal });
          if (resp.ok) list = await resp.json();
        }
        renderResults(Array.isArray(list) ? list : []);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (directCoords) {
        renderResults([{
          name: 'พิกัด ' + directCoords.lat.toFixed(5) + ', ' + directCoords.lon.toFixed(5),
          display_name: 'พิกัดที่คุณป้อนโดยตรง (ไม่สามารถดึงชื่อสถานที่จากเครือข่ายได้ในขณะนี้)',
          lat: directCoords.lat,
          lon: directCoords.lon
        }]);
      } else {
        showStatus('ไม่สามารถเชื่อมต่อบริการค้นหาพิกัดสดได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือระบุพิกัด ละติจูด, ลองจิจูด โดยตรง');
      }
    } finally {
      clearTimeout(timeoutId);
      bodyEl.classList.remove('is-scanning');
    }
  }

  searchForm.addEventListener('submit', function (e) { e.preventDefault(); executeSearch(searchInput.value); });

  /* =====================================================================
     7. GPS Live Position Trigger ("สภ./สน. ใกล้ฉัน")
  ===================================================================== */
  function triggerGPS() {
    if (!navigator.geolocation) {
      showStatus('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS');
      return;
    }
    gpsBtn.classList.add('is-active');
    bodyEl.classList.add('is-scanning');
    showStatus('กำลังรับสัญญาณพิกัดปัจจุบันเพื่อหา สภ./สน. ใกล้คุณ…');
    emitCapsulePulse(1, 620);

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        gpsBtn.classList.remove('is-active');
        const coordStr = pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5);
        searchInput.value = coordStr;
        syncInputState();
        executeSearch(coordStr);
      },
      function () {
        gpsBtn.classList.remove('is-active');
        bodyEl.classList.remove('is-scanning');
        showStatus('ไม่สามารถเข้าถึง GPS ได้ สามารถพิมพ์ชื่อตำบล สถานที่ หรือพิกัดเพื่อหา สภ./สน. ใกล้เคียงแทนได้');
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  }
  gpsBtn.addEventListener('click', triggerGPS);
  if (idleGpsBtn) idleGpsBtn.addEventListener('click', triggerGPS);

  /* =====================================================================
     8. Voice Search Trigger (Web Speech API)
  ===================================================================== */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    voiceBtn.style.display = 'inline-flex';
    const recognition = new SpeechRec();
    recognition.lang = 'th-TH';
    recognition.interimResults = false;
    let isListening = false;

    voiceBtn.addEventListener('click', function () {
      if (isListening) { recognition.stop(); return; }
      try {
        recognition.start();
        isListening = true;
        voiceBtn.classList.add('is-active');
        showStatus('กำลังฟังเสียงพูดเพื่อค้นหาสถานที่…');
        emitCapsulePulse(0.9, 480);
      } catch (_) {
        isListening = false;
        voiceBtn.classList.remove('is-active');
      }
    });
    recognition.addEventListener('result', function (event) {
      const transcript = event.results[0] && event.results[0][0] ? event.results[0][0].transcript : '';
      if (transcript) { searchInput.value = transcript; syncInputState(); executeSearch(transcript); }
    });
    recognition.addEventListener('end', function () {
      isListening = false;
      voiceBtn.classList.remove('is-active');
      if (inlineStatus.textContent.indexOf('กำลังฟัง') !== -1) showStatus('');
    });
    recognition.addEventListener('error', function () {
      isListening = false;
      voiceBtn.classList.remove('is-active');
      showStatus('ไม่สามารถรับเสียงพูดได้ในขณะนี้ ลองพิมพ์คำค้นหาแทน');
    });
  }

  /* =====================================================================
     9. URL param (?q=) + Real Visitor Counter (/api/visit)
  ===================================================================== */
  try {
    const initialQ = new URLSearchParams(window.location.search).get('q');
    if (initialQ) { searchInput.value = initialQ; syncInputState(); executeSearch(initialQ); }
  } catch (_) {}

  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.protocol !== 'file:') {
    fetch('/api/visit', { method: 'POST', credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) return;
        const viewsEl = document.getElementById('statViews');
        const wrap = document.getElementById('visitorCounter');
        if (viewsEl && typeof data.views === 'number') viewsEl.textContent = data.views.toLocaleString('th-TH');
        if (wrap && typeof data.visitors === 'number') {
          wrap.title = 'ผู้เข้าชมไม่ซ้ำรายวัน ' + data.visitors.toLocaleString('th-TH') + ' คน';
        }
      })
      .catch(function () {});
  }
})();
