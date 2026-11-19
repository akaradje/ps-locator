/* ============================================================
   PS LOCATOR — Lazy WebGL Vector Map (MapLibre GL) + Smart Clustering
                + Citizen SOS Mode + Nearest Police Stations + Jurisdiction
   Uses data/stations.js (read-only), lazy data/jurisdictions.js (read-only),
   lazy data/station-coords.json (read-only), OSM Nominatim, and MapLibre GL JS.
   ============================================================ */
(function () {
  'use strict';

  const STATIONS = Array.isArray(window.STATIONS) ? window.STATIONS : [];
  const ST_BY_ID = new Map(STATIONS.map(function (s) { return [String(s.id), s]; }));

  const MAPLIBRE_VERSION = '4.7.1';
  const MAPLIBRE_CSS_URL = 'https://unpkg.com/maplibre-gl@' + MAPLIBRE_VERSION + '/dist/maplibre-gl.css';
  const MAPLIBRE_JS_URL = 'https://unpkg.com/maplibre-gl@' + MAPLIBRE_VERSION + '/dist/maplibre-gl.js';
  const GLYPHS_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

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
  const idleSosBtn = document.getElementById('idleSosBtn');
  const idleExploreMapBtn = document.getElementById('idleExploreMapBtn');
  const sosBtn = document.getElementById('sosBtn');
  const inlineStatus = document.getElementById('inline-status');

  const resultsLabel = document.getElementById('results-label');
  const sourceBadge = document.getElementById('source-badge');
  const sosPanel = document.getElementById('sosPanel');
  const mapJurBox = document.getElementById('mapJurBox');
  const nearbyStationsBox = document.getElementById('nearbyStationsBox');
  const neighborStationsBox = document.getElementById('neighborStationsBox');
  const resultsList = document.getElementById('results-list');
  const mapContainer = document.getElementById('locator-map');
  const activeCoordChip = document.getElementById('active-coord-chip');
  const activePlaceChip = document.getElementById('active-place-chip');
  const copyCoordBtn = document.getElementById('copy-coord-btn');
  const copyCoordText = document.getElementById('copy-coord-text');
  const openGmapsBtn = document.getElementById('open-gmaps-btn');

  let currentResults = [];
  let selectedItem = null;
  let mapInstance = null;
  let mapReady = false;
  let mapLibrePromise = null;
  let mapInitPromise = null;
  let activeMarker = null;
  let activePopup = null;
  let activeSearchController = null;
  let activeDetailController = null;
  let copyTimer = null;

  let jurData = window.JURISDICTION || null;
  let jurPromise = null;

  /* Read-only verified coordinates registry + runtime OSM cache */
  const STATION_COORDS = new Map();
  const OSM_COORD_CACHE = new Map();
  let coordsLoadPromise = null;
  let osmCacheHydrated = false;
  let currentNearbyFeatures = [];
  let lastOriginCoords = null;

  /* Citizen SOS Mode state */
  let sosActive = false;
  let sosState = {
    status: 'idle',
    statusText: '',
    lat: null,
    lon: null,
    accuracy: null,
    nearest: [],
    hasCoords: false,
    jurResult: null,
    jurAreaLabel: '',
    admin: null
  };

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
      .replace(/metropolitan\s+police\s+station|provincial\s+police\s+station|police\s+station|police\s+box|pol\.?\s*sta\.?/gi, '')
      .replace(/สถานีตำรวจภูธร|สถานีตำรวจนครบาล|สถานีตำรวจ|สภ\.|สน\.|จว\.|จังหวัด|จ\.|[\s\.\-\(\)\/,]/g, '');
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

  function phoneDigits(raw) {
    if (!raw) return '';
    return String(raw).split(/[,;\/]/)[0].replace(/\D/g, '');
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

  function getTambonName(tb) {
    return typeof tb === 'string' ? tb : (tb && (tb.name || tb.n)) || '';
  }

  function isTambonPartial(tb) {
    return Boolean(tb && typeof tb === 'object' && (tb.partial || tb.p));
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

  /* ---------- Read-Only Station Coords + IndexedDB Cache ---------- */
  function openCoordsIDB() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('No IDB')); return; }
      try {
        const req = indexedDB.open('ps-locator-db', 1);
        req.onupgradeneeded = function (ev) {
          try {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains('stations')) db.createObjectStore('stations', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('jurisdictions')) db.createObjectStore('jurisdictions', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
          } catch (_) {}
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('IDB error')); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function hydrateOsmCoordCache() {
    if (osmCacheHydrated) return Promise.resolve();
    osmCacheHydrated = true;
    return openCoordsIDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction('meta', 'readonly');
          const req = tx.objectStore('meta').get('osm_coords_cache');
          req.onsuccess = function () {
            const rec = req.result;
            if (rec && rec.entries && typeof rec.entries === 'object') {
              Object.keys(rec.entries).forEach(function (k) {
                const v = rec.entries[k];
                if (Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1])) {
                  OSM_COORD_CACHE.set(String(k), [Number(v[0]), Number(v[1])]);
                }
              });
            }
            try { db.close(); } catch (_) {}
            resolve();
          };
          req.onerror = function () { try { db.close(); } catch (_) {} resolve(); };
        } catch (_) {
          try { db.close(); } catch (_) {}
          resolve();
        }
      });
    }).catch(function () {});
  }

  function persistOsmCoordCache() {
    if (!OSM_COORD_CACHE.size) return;
    const entries = {};
    let count = 0;
    OSM_COORD_CACHE.forEach(function (val, key) {
      if (count < 200) { entries[key] = val; count++; }
    });
    openCoordsIDB().then(function (db) {
      try {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key: 'osm_coords_cache', entries: entries, updatedAt: Date.now() });
        tx.oncomplete = function () { try { db.close(); } catch (_) {} };
        tx.onerror = function () { try { db.close(); } catch (_) {} };
      } catch (_) {
        try { db.close(); } catch (_) {}
      }
    }).catch(function () {});
  }

  function loadStationCoords() {
    if (coordsLoadPromise) return coordsLoadPromise;
    coordsLoadPromise = Promise.all([
      hydrateOsmCoordCache(),
      fetch('./data/station-coords.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.coords && typeof data.coords === 'object') {
            Object.keys(data.coords).forEach(function (id) {
              const pair = data.coords[id];
              if (Array.isArray(pair) && pair.length >= 2 && isFinite(pair[0]) && isFinite(pair[1])) {
                STATION_COORDS.set(String(id), [Number(pair[0]), Number(pair[1])]);
              }
            });
          }
        })
        .catch(function () {})
    ]).then(function () {
      refreshStationClusterSource();
      return STATION_COORDS;
    });
    return coordsLoadPromise;
  }

  /* Match an OSM police POI name against official STATIONS (Zero Hallucination) */
  function thaiConsonantKey(s) {
    const clean = normStation(s).replace(/ำ/g, 'ม').replace(/[^ก-ฮ]/g, '');
    if (!clean) return '';
    const map = {
      'ก':'k','ข':'k','ฃ':'k','ค':'k','ฅ':'k','ฆ':'k',
      'ง':'ng',
      'จ':'c','ฉ':'c','ช':'c','ซ':'s','ฌ':'c',
      'ญ':'y','ฎ':'d','ฏ':'t','ฐ':'t','ฑ':'t','ฒ':'t','ณ':'n',
      'ด':'d','ต':'t','ถ':'t','ท':'t','ธ':'t','น':'n',
      'บ':'b','ป':'p','ผ':'p','ฝ':'f','พ':'p','ฟ':'f','ภ':'p','ม':'m',
      'ย':'y','ร':'r','ล':'l','ว':'w',
      'ศ':'s','ษ':'s','ส':'s','ห':'h','ฬ':'l','อ':'','ฮ':'h'
    };
    let out = '';
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      /* Final ร/ล/ญ/ณ in Thai syllables often romanize as 'n' (e.g., ชุมพร -> chumphon) */
      if (i === clean.length - 1 && (ch === 'ร' || ch === 'ล' || ch === 'ญ' || ch === 'ณ')) {
        out += 'n';
      } else {
        out += map[ch] || '';
      }
    }
    return out.replace(/(.)\1+/g, '$1');
  }

  function latinConsonantKey(s) {
    const stripped = String(s || '')
      .toLowerCase()
      .replace(/metropolitan\s+police\s+station|provincial\s+police\s+station|police\s+station|police\s+box|pol\.?\s*sta\.?|police/gi, ' ')
      .replace(/[^a-z]+/g, ' ')
      .trim();
    if (!stripped) return '';
    const norm = stripped
      .replace(/ph/g, 'p')
      .replace(/th/g, 't')
      .replace(/kh/g, 'k')
      .replace(/ch/g, 'c')
      .replace(/ng/g, 'NG')
      .replace(/[aeiouy\s]/g, '')
      .replace(/j/g, 'c')
      .replace(/g/g, 'k')
      .replace(/v/g, 'w')
      .replace(/z/g, 's')
      .replace(/NG/g, 'ng')
      .replace(/r$/g, 'n');
    return norm.replace(/(.)\1+/g, '$1');
  }

  const ST_INDEX = STATIONS.map(function (st) {
    return {
      st: st,
      key: normStation(st.name),
      cKey: thaiConsonantKey(st.name),
      prov: normAdmin(st.province_th)
    };
  });

  function isSameProvince(entryProv, pHint) {
    if (!pHint || !entryProv) return false;
    return entryProv === pHint || entryProv.includes(pHint) || pHint.includes(entryProv);
  }

  function scoreOfficialMatch(rawName, pHint) {
    const raw = String(rawName || '').trim();
    if (!raw) return null;
    const keys = [];
    const fullKey = normStation(raw);
    if (fullKey && fullKey.length >= 2) keys.push(fullKey);
    const thaiOnly = normStation(raw.replace(/[A-Za-z]+/g, ' '));
    if (thaiOnly && thaiOnly.length >= 2 && keys.indexOf(thaiOnly) === -1) keys.push(thaiOnly);
    if (pHint && fullKey === 'เมือง') keys.push('เมือง' + pHint);
    if (pHint && thaiOnly === 'เมือง' && keys.indexOf('เมือง' + pHint) === -1) keys.push('เมือง' + pHint);

    let best = null;
    let bestScore = 0;
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      for (let i = 0; i < ST_INDEX.length; i++) {
        const entry = ST_INDEX[i];
        const sameProv = isSameProvince(entry.prov, pHint);
        let score = 0;
        if (entry.key === key) {
          score = 100;
        } else if (!pHint || sameProv) {
          /* Restrict substring matching to same province when provinceHint is known (prevents cross-province false positives) */
          if (entry.key.length >= 3 && key.includes(entry.key)) score = 75;
          else if (key.length >= 3 && key !== 'เมือง' && entry.key.includes(key)) score = 60;
        }
        if (!score) continue;
        if (sameProv) score += 30;
        if (score > bestScore) { bestScore = score; best = entry.st; }
      }
    }

    /* English/Latin OSM name fallback (strictly within same province & exact consonant skeleton) */
    if (!best && pHint && /[A-Za-z]{3,}/.test(raw)) {
      const lKey = latinConsonantKey(raw);
      if (lKey && lKey.length >= 4) {
        for (let i = 0; i < ST_INDEX.length; i++) {
          const entry = ST_INDEX[i];
          if (!isSameProvince(entry.prov, pHint) || !entry.cKey) continue;
          if (entry.cKey === lKey) {
            best = entry.st;
            bestScore = 95;
            break;
          }
        }
      }
    }

    return bestScore >= 60 ? { st: best, score: bestScore } : null;
  }

  function matchOfficialStation(poiName, provinceHint) {
    const pHint = normAdmin(provinceHint || '');
    if (Array.isArray(poiName)) {
      let best = null;
      let bestScore = 0;
      for (let i = 0; i < poiName.length; i++) {
        const res = scoreOfficialMatch(poiName[i], pHint);
        if (res && res.score > bestScore) {
          bestScore = res.score;
          best = res.st;
        }
      }
      return best;
    }
    const res = scoreOfficialMatch(poiName, pHint);
    return res ? res.st : null;
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
  if (!reduceMotion && searchCapsule && capsuleTilt) {
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
     3. Theme Toggle (synced with ps:theme + MapLibre Dual Theme)
  ===================================================================== */
  function syncMapTheme(theme) {
    if (!mapInstance || !mapReady) return;
    const isLight = theme === 'light';
    try {
      if (mapInstance.getLayer('bg-layer')) {
        mapInstance.setPaintProperty('bg-layer', 'background-color', isLight ? '#f1f5f9' : '#0b101b');
      }
      if (mapInstance.getLayer('osm-tiles')) {
        mapInstance.setPaintProperty('osm-tiles', 'raster-saturation', isLight ? -0.15 : -0.35);
        mapInstance.setPaintProperty('osm-tiles', 'raster-brightness-min', isLight ? 0 : 0.05);
        mapInstance.setPaintProperty('osm-tiles', 'raster-brightness-max', isLight ? 1 : 0.88);
        mapInstance.setPaintProperty('osm-tiles', 'raster-contrast', isLight ? 0 : 0.12);
      }
      if (mapInstance.getLayer('clusters')) {
        mapInstance.setPaintProperty('clusters', 'circle-color', [
          'step', ['get', 'point_count'],
          isLight ? '#0284c7' : '#38bdf8',
          10, isLight ? '#4f46e5' : '#818cf8',
          30, isLight ? '#d97706' : '#f59e0b'
        ]);
        mapInstance.setPaintProperty('clusters', 'circle-stroke-color', isLight ? '#ffffff' : '#0f172a');
      }
      if (mapInstance.getLayer('unclustered-point')) {
        mapInstance.setPaintProperty('unclustered-point', 'circle-color', isLight ? '#d97706' : '#f59e0b');
        mapInstance.setPaintProperty('unclustered-point', 'circle-stroke-color', '#ffffff');
      }
    } catch (_) {}
  }

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    htmlEl.dataset.theme = t;
    if (iconSun) iconSun.style.display = t === 'dark' ? 'block' : 'none';
    if (iconMoon) iconMoon.style.display = t === 'light' ? 'block' : 'none';
    if (themeToggle) themeToggle.setAttribute('aria-pressed', String(t === 'dark'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'light' ? '#f7f9fc' : '#05070c';
    if (reduceMotion) drawStaticField();
    syncMapTheme(t);
  }
  applyTheme(htmlEl.dataset.theme || 'dark');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      const nextTheme = htmlEl.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('ps:theme', nextTheme); } catch (_) {}
      applyTheme(nextTheme);
      emitCapsulePulse(0.75, 500);
    });
  }

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
      if (sosActive) {
        deactivateSOSMode();
      } else if (bodyEl.classList.contains('has-results') || searchInput.value) {
        resetToMinimalHome();
      }
    }
  });

  function showStatus(text) {
    inlineStatus.textContent = text || '';
    inlineStatus.classList.toggle('visible', Boolean(text));
  }

  function resetToMinimalHome() {
    if (activeSearchController) { activeSearchController.abort(); activeSearchController = null; }
    if (activeDetailController) { activeDetailController.abort(); activeDetailController = null; }
    sosActive = false;
    bodyEl.classList.remove('is-scanning', 'has-results', 'is-sos-mode');
    if (sosBtn) sosBtn.setAttribute('aria-pressed', 'false');
    searchInput.value = '';
    syncInputState();
    showStatus('');
    currentResults = [];
    selectedItem = null;
    currentNearbyFeatures = [];
    lastOriginCoords = null;
    resultsList.innerHTML = '';
    if (sosPanel) { sosPanel.innerHTML = ''; sosPanel.hidden = true; }
    if (mapJurBox) { mapJurBox.innerHTML = ''; mapJurBox.hidden = true; }
    if (nearbyStationsBox) { nearbyStationsBox.innerHTML = ''; nearbyStationsBox.hidden = true; }
    if (neighborStationsBox) { neighborStationsBox.innerHTML = ''; neighborStationsBox.hidden = true; }
    if (activePopup) { try { activePopup.remove(); } catch (_) {} activePopup = null; }
    if (activeMarker) { try { activeMarker.remove(); } catch (_) {} activeMarker = null; }
    refreshStationClusterSource();
    if (openGmapsBtn) openGmapsBtn.hidden = true;
    emitCapsulePulse(0.8, 520);
    searchInput.focus();
  }
  if (clearBtn) clearBtn.addEventListener('click', resetToMinimalHome);

  /* =====================================================================
     5. Dynamic Lazy-Loaded MapLibre GL JS (WebGL + Smart Clustering + Fallback)
  ===================================================================== */
  function isWebGLSupported() {
    try {
      const testCanvas = document.createElement('canvas');
      if (!testCanvas) return false;
      const gl =
        testCanvas.getContext('webgl2') ||
        testCanvas.getContext('webgl') ||
        testCanvas.getContext('experimental-webgl');
      return Boolean(gl);
    } catch (_) {
      return false;
    }
  }

  function showMapFallback(reasonText) {
    if (!mapContainer) return;
    if (sourceBadge) sourceBadge.textContent = 'FALLBACK · LIST';
    const msg = reasonText ||
      'ไม่สามารถโหลดแผนที่ WebGL (ออฟไลน์หรือไม่รองรับ WebGL) — ยังสามารถดูรายการ สภ.ใกล้เคียง โทรออก และนำทาง Google Maps ได้ด้านซ้าย';
    mapContainer.innerHTML =
      '<div class="map-fallback-box" role="status">' +
        '<div class="map-fallback-icon" aria-hidden="true">' +
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>' +
            '<line x1="8" y1="2" x2="8" y2="18"></line>' +
            '<line x1="16" y1="6" x2="16" y2="22"></line>' +
          '</svg>' +
        '</div>' +
        '<p class="map-fallback-title">โหมดแสดงผลสำรอง (ไม่ใช้แผนที่ WebGL)</p>' +
        '<p class="map-fallback-desc">' + esc(msg) + '</p>' +
        '<button type="button" class="map-mini-btn map-mini-primary" id="retryMapBtn">ลองโหลดแผนที่อีกครั้ง</button>' +
      '</div>';
    const retryBtn = mapContainer.querySelector('#retryMapBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        mapLibrePromise = null;
        mapInitPromise = null;
        mapInstance = null;
        mapReady = false;
        mapContainer.innerHTML = '';
        ensureMapInitialized().then(function (m) {
          if (m && lastOriginCoords) {
            setMapActivePin(lastOriginCoords.lat, lastOriginCoords.lon, sosActive);
            flyMapTo(lastOriginCoords.lat, lastOriginCoords.lon, 14);
          }
        });
      });
    }
  }

  function loadMapLibre() {
    if (!isWebGLSupported()) {
      return Promise.reject(Object.assign(new Error('WebGL unsupported'), { code: 'NO_WEBGL' }));
    }
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mapLibrePromise) return mapLibrePromise;

    mapLibrePromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-ps-maplibre="css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = MAPLIBRE_CSS_URL;
        link.setAttribute('data-ps-maplibre', 'css');
        document.head.appendChild(link);
      }

      const script = document.createElement('script');
      script.src = MAPLIBRE_JS_URL;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-ps-maplibre', 'js');

      const timer = setTimeout(function () {
        mapLibrePromise = null;
        reject(Object.assign(new Error('MapLibre CDN timeout'), { code: 'CDN_TIMEOUT' }));
      }, 12000);

      script.onload = function () {
        clearTimeout(timer);
        if (window.maplibregl) resolve(window.maplibregl);
        else {
          mapLibrePromise = null;
          reject(Object.assign(new Error('MapLibre missing after load'), { code: 'LOAD_ERROR' }));
        }
      };
      script.onerror = function () {
        clearTimeout(timer);
        mapLibrePromise = null;
        reject(Object.assign(new Error('Failed to load MapLibre CDN'), { code: 'CDN_ERROR' }));
      };
      document.head.appendChild(script);
    });
    return mapLibrePromise;
  }

  function buildMapStyle(theme) {
    const isLight = theme === 'light';
    return {
      version: 8,
      glyphs: GLYPHS_URL,
      sources: {
        'osm-raster': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© OpenStreetMap'
        }
      },
      layers: [
        {
          id: 'bg-layer',
          type: 'background',
          paint: { 'background-color': isLight ? '#f1f5f9' : '#0b101b' }
        },
        {
          id: 'osm-tiles',
          type: 'raster',
          source: 'osm-raster',
          paint: {
            'raster-saturation': isLight ? -0.15 : -0.35,
            'raster-brightness-min': isLight ? 0 : 0.05,
            'raster-brightness-max': isLight ? 1 : 0.88,
            'raster-contrast': isLight ? 0 : 0.12
          }
        }
      ]
    };
  }

  function buildStationsGeoJSON() {
    const features = [];
    const seen = new Set();

    function pushFeature(id, name, province, phone, lat, lon, distKm) {
      const key = id ? 'id:' + id : 'n:' + normStation(name) + ':' + lat.toFixed(4) + ',' + lon.toFixed(4);
      if (seen.has(key)) return;
      seen.add(key);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          id: id || '',
          name: name || 'สถานีตำรวจ',
          province: province || '',
          phone: phone || '',
          distKm: typeof distKm === 'number' && isFinite(distKm) ? Number(distKm.toFixed(2)) : -1
        }
      });
    }

    /* 1. Nearby / active search station pins (with real distances) */
    for (let i = 0; i < currentNearbyFeatures.length; i++) {
      const it = currentNearbyFeatures[i];
      if (!isFinite(it.lat) || !isFinite(it.lon)) continue;
      const st = it.official;
      pushFeature(
        st ? String(st.id) : '',
        it.name,
        st ? st.province_th : '',
        st && st.phone ? st.phone : '',
        it.lat,
        it.lon,
        it.distKm
      );
    }

    /* 2. Verified read-only coordinate registry (data/station-coords.json) */
    STATION_COORDS.forEach(function (pair, id) {
      const st = ST_BY_ID.get(String(id));
      if (!st) return;
      const dist = lastOriginCoords
        ? haversineKm(lastOriginCoords.lat, lastOriginCoords.lon, pair[0], pair[1])
        : -1;
      pushFeature(String(st.id), st.name, st.province_th, st.phone || '', pair[0], pair[1], dist);
    });

    /* 3. Cached OSM coordinates discovered during this session / IDB */
    OSM_COORD_CACHE.forEach(function (pair, id) {
      const st = ST_BY_ID.get(String(id));
      if (!st) return;
      const dist = lastOriginCoords
        ? haversineKm(lastOriginCoords.lat, lastOriginCoords.lon, pair[0], pair[1])
        : -1;
      pushFeature(String(st.id), st.name, st.province_th, st.phone || '', pair[0], pair[1], dist);
    });

    return { type: 'FeatureCollection', features: features };
  }

  function refreshStationClusterSource() {
    if (!mapInstance || !mapReady) return;
    try {
      const src = mapInstance.getSource('stations-source');
      if (src) src.setData(buildStationsGeoJSON());
    } catch (_) {}
  }

  function buildStationPopupHTML(props, lat, lon) {
    const name = props.name || 'สถานีตำรวจ';
    const province = props.province || '';
    const rawPhone = props.phone || '';
    const phoneDisplay = formatPhone(rawPhone);
    const digits = phoneDigits(rawPhone);
    const dist = Number(props.distKm);
    const distHtml = isFinite(dist) && dist >= 0
      ? '<span class="map-popup-dist">ห่าง ' + dist.toFixed(1) + ' กม.</span>'
      : '';
    const navUrl = lastOriginCoords
      ? 'https://www.google.com/maps/dir/?api=1&origin=' +
          encodeURIComponent(lastOriginCoords.lat.toFixed(5) + ',' + lastOriginCoords.lon.toFixed(5)) +
          '&destination=' + encodeURIComponent(lat.toFixed(5) + ',' + lon.toFixed(5))
      : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat.toFixed(5) + ',' + lon.toFixed(5));

    return (
      '<div class="map-popup-card">' +
        '<div class="map-popup-head">' +
          '<strong>' + esc(name) + '</strong>' +
          distHtml +
        '</div>' +
        (province ? '<div class="map-popup-meta">จังหวัด' + esc(province) + '</div>' : '') +
        '<div class="map-popup-meta">โทร: ' + esc(phoneDisplay) + '</div>' +
        '<div class="map-popup-actions">' +
          (digits ? '<a class="map-mini-btn map-mini-primary" href="tel:' + esc(digits) + '">โทร</a>' : '') +
          '<a class="map-mini-btn" href="' + esc(navUrl) + '" target="_blank" rel="noopener">นำทาง Google Maps</a>' +
          '<a class="map-mini-btn" href="index.html?q=' + encodeURIComponent(name) + '">ดูรายละเอียด</a>' +
        '</div>' +
      '</div>'
    );
  }

  function openStationPopup(lat, lon, props) {
    if (!mapInstance || !window.maplibregl) return;
    if (activePopup) { try { activePopup.remove(); } catch (_) {} }
    activePopup = new window.maplibregl.Popup({ closeButton: true, maxWidth: '280px', offset: 12 })
      .setLngLat([lon, lat])
      .setHTML(buildStationPopupHTML(props, lat, lon))
      .addTo(mapInstance);
  }

  function ensureMapInitialized() {
    if (mapInstance && mapReady) return Promise.resolve(mapInstance);
    if (mapInitPromise) return mapInitPromise;

    loadStationCoords();

    mapInitPromise = loadMapLibre()
      .then(function (maplibregl) {
        if (!mapContainer) return null;
        mapContainer.innerHTML = '';
        const theme = htmlEl.dataset.theme || 'dark';
        const isLight = theme === 'light';

        const map = new maplibregl.Map({
          container: 'locator-map',
          style: buildMapStyle(theme),
          center: [100.5018, 13.7563],
          zoom: 12,
          attributionControl: false
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
        mapInstance = map;

        return new Promise(function (resolve) {
          map.on('load', function () {
            mapReady = true;
            if (sourceBadge) sourceBadge.textContent = 'WEBGL · OSM';

            map.addSource('stations-source', {
              type: 'geojson',
              data: buildStationsGeoJSON(),
              cluster: true,
              clusterMaxZoom: 12,
              clusterRadius: 48
            });

            map.addLayer({
              id: 'clusters',
              type: 'circle',
              source: 'stations-source',
              filter: ['has', 'point_count'],
              paint: {
                'circle-color': [
                  'step', ['get', 'point_count'],
                  isLight ? '#0284c7' : '#38bdf8',
                  10, isLight ? '#4f46e5' : '#818cf8',
                  30, isLight ? '#d97706' : '#f59e0b'
                ],
                'circle-radius': [
                  'step', ['get', 'point_count'],
                  18, 10, 23, 30, 28
                ],
                'circle-stroke-width': 2.5,
                'circle-stroke-color': isLight ? '#ffffff' : '#0f172a'
              }
            });

            map.addLayer({
              id: 'cluster-count',
              type: 'symbol',
              source: 'stations-source',
              filter: ['has', 'point_count'],
              layout: {
                'text-field': ['get', 'point_count_abbreviated'],
                'text-font': ['Open Sans Regular'],
                'text-size': 12
              },
              paint: {
                'text-color': '#ffffff'
              }
            });

            map.addLayer({
              id: 'unclustered-point',
              type: 'circle',
              source: 'stations-source',
              filter: ['!', ['has', 'point_count']],
              paint: {
                'circle-color': isLight ? '#d97706' : '#f59e0b',
                'circle-radius': 7.5,
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#ffffff'
              }
            });

            /* Click cluster -> smooth zoom expansion */
            map.on('click', 'clusters', function (ev) {
              const features = map.queryRenderedFeatures(ev.point, { layers: ['clusters'] });
              if (!features || !features.length) return;
              const clusterId = features[0].properties.cluster_id;
              const coords = features[0].geometry.coordinates;
              const src = map.getSource('stations-source');
              if (!src || !src.getClusterExpansionZoom) return;
              const zoomRes = src.getClusterExpansionZoom(clusterId);
              if (zoomRes && typeof zoomRes.then === 'function') {
                zoomRes.then(function (zoom) {
                  map.easeTo({ center: coords, zoom: zoom, duration: reduceMotion ? 0 : 450 });
                }).catch(function () {});
              }
            });

            /* Click unclustered station pin -> show official info popup */
            map.on('click', 'unclustered-point', function (ev) {
              const feat = ev.features && ev.features[0];
              if (!feat) return;
              const coords = feat.geometry.coordinates.slice();
              openStationPopup(coords[1], coords[0], feat.properties || {});
            });

            map.on('mouseenter', 'clusters', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'clusters', function () { map.getCanvas().style.cursor = ''; });
            map.on('mouseenter', 'unclustered-point', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'unclustered-point', function () { map.getCanvas().style.cursor = ''; });

            /* Click empty map area -> lock coordinate & inspect jurisdiction */
            map.on('click', function (ev) {
              const hit = map.queryRenderedFeatures(ev.point, { layers: ['clusters', 'unclustered-point'] });
              if (hit && hit.length) return;
              const coordStr = ev.lngLat.lat.toFixed(5) + ', ' + ev.lngLat.lng.toFixed(5);
              searchInput.value = coordStr;
              syncInputState();
              executeSearch(coordStr);
            });

            syncMapTheme(htmlEl.dataset.theme || 'dark');
            refreshStationClusterSource();
            resolve(map);
          });

          map.on('error', function () {
            /* Keep map running even if a single tile fails offline */
          });
        });
      })
      .catch(function (err) {
        mapInitPromise = null;
        mapInstance = null;
        mapReady = false;
        const isNoWebGL = err && err.code === 'NO_WEBGL';
        const reason = isNoWebGL
          ? 'อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ WebGL — ยังสามารถดูรายการ สภ.ใกล้เคียง โทรออก และนำทาง Google Maps ได้ด้านซ้าย'
          : 'ไม่สามารถโหลดแผนที่ WebGL (ออฟไลน์หรือเชื่อมต่อ CDN ไม่สำเร็จ) — ยังสามารถดูรายการ สภ.ใกล้เคียง โทรออก และนำทาง Google Maps ได้ด้านซ้าย';
        showMapFallback(reason);
        return null;
      });

    return mapInitPromise;
  }

  function setMapActivePin(lat, lon, isSos) {
    if (!mapInstance || !mapReady || !window.maplibregl) return;
    try {
      if (activeMarker) { activeMarker.remove(); activeMarker = null; }
      const el = document.createElement('div');
      el.className = isSos ? 'ps-pin ps-pin-sos' : 'ps-pin';
      el.setAttribute('aria-label', isSos ? 'ตำแหน่งฉุกเฉินปัจจุบันของคุณ' : 'ตำแหน่งที่เลือก');
      activeMarker = new window.maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(mapInstance);
    } catch (_) {}
  }

  function flyMapTo(lat, lon, zoom) {
    if (!mapInstance || !mapReady) return;
    try {
      mapInstance.resize();
      if (reduceMotion) {
        mapInstance.jumpTo({ center: [lon, lat], zoom: zoom || 14 });
      } else {
        mapInstance.flyTo({ center: [lon, lat], zoom: zoom || 14, duration: 850 });
      }
    } catch (_) {}
  }

  /* =====================================================================
     6. Admin / Jurisdiction Lookup + Neighbor Police Network
  ===================================================================== */
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
      if (!allowSameAsProv && !explicitTambon && cleaned === province) return;
      if (tambons.indexOf(cleaned) === -1) tambons.push(cleaned);
    };
    if (displayName) {
      const matches = displayName.matchAll(/(?:ตำบล|แขวง)\s*([^\s,]+)/g);
      for (const m of matches) {
        if (m[1]) pushTambon(m[1], true);
      }
    }
    const primaryFields = [a.suburb, a.quarter, a.city, a.town, a.municipality, a.city_district];
    for (let i = 0; i < primaryFields.length; i++) {
      pushTambon(primaryFields[i], false);
    }
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
      let recs = idxList.map(function (idx) { return jurData.stations[idx]; }).filter(function (rec) {
        return rec && byProv(rec);
      });
      if (!recs.length) continue;
      const ampRecs = recs.filter(byAmphoe);
      if (ampRecs.length) recs = ampRecs;
      if (recs.length > 1) {
        const isFull = function (rec) {
          const tb = rec.tambons.find(function (x) { return normAdmin(getTambonName(x)) === t; });
          return tb && !isTambonPartial(tb);
        };
        const fullOnly = recs.filter(isFull);
        if (fullOnly.length === 1) recs = fullOnly;
      }
      return { matchedTambon: t, recs: recs };
    }

    if (admin.amphoe && admin.province) {
      const recs = jurData.stations.filter(function (rec) { return byProv(rec) && byAmphoe(rec); });
      if (recs.length) {
        const mainRec = recs.find(function (r) {
          return normAdmin(r.short) === admin.amphoe || normAdmin(r.short) === 'เมือง' + admin.province;
        }) || recs[0];
        return { matchedTambon: admin.amphoe, recs: [mainRec], byAmphoeOnly: true };
      }
    }
    return { matchedTambon: admin.tambons[0] || '', recs: [] };
  }

  function buildJurisdictionWarnings(rec, matchedTambon, byAmphoeOnly) {
    const warnParts = [];
    const matchedT = rec.tambons.find(function (tb) {
      return normAdmin(getTambonName(tb)) === matchedTambon;
    });
    const isPartial = isTambonPartial(matchedT);
    const partialCount = rec.tambons.filter(isTambonPartial).length;
    const missing = (typeof rec.count === 'number' ? rec.count : rec.tambons.length) - rec.tambons.length;

    if (isPartial) {
      warnParts.push('ตำบลนี้เป็นเขตบางส่วน / เฉพาะหมู่ที่ / แนวเขต (หน้า ' + rec.page + ')');
    } else if (partialCount > 0) {
      warnParts.push('สถานีนี้มี ' + partialCount + ' ตำบลที่เป็นเขตบางส่วน/เฉพาะหมู่ที่/แนวเขต');
    }
    if (missing > 0 || rec.verify) {
      warnParts.push('โปรดตรวจสอบ: ประกาศระบุ ' + rec.count + ' ตำบล ถอดชื่อได้ ' + rec.tambons.length + ' ตำบล (1 ใน 4 สถานีถอดไม่ครบ)');
    }
    if (byAmphoeOnly) {
      warnParts.push('จับคู่จากระดับอำเภอ (ไม่พบชื่อตำบลตรง)');
    }
    return warnParts;
  }

  function renderNeighborStations(primaryRec, originLat, originLon) {
    if (!neighborStationsBox) return;
    if (!primaryRec || !jurData || !Array.isArray(jurData.stations)) {
      neighborStationsBox.hidden = true;
      neighborStationsBox.innerHTML = '';
      return;
    }

    let list = [];
    if (Array.isArray(primaryRec.neighbors) && primaryRec.neighbors.length) {
      list = primaryRec.neighbors
        .map(function (nid) {
          return jurData.stations.find(function (r) { return String(r.id) === String(nid) || r.short === nid; });
        })
        .filter(Boolean);
    }
    if (!list.length) {
      const all = jurData.stations;
      list = all.filter(function (r) {
        return r.id !== primaryRec.id && r.province === primaryRec.province && r.amphoe === primaryRec.amphoe;
      });
      if (list.length < 4) {
        list = list.concat(all.filter(function (r) {
          return r.id !== primaryRec.id && r.province === primaryRec.province && r.amphoe !== primaryRec.amphoe;
        }));
      }
    }
    list = list.slice(0, 6);

    if (!list.length) {
      neighborStationsBox.hidden = true;
      neighborStationsBox.innerHTML = '';
      return;
    }

    const cards = list.map(function (r) {
      const st = ST_BY_ID.get(String(r.id));
      const fullName = st ? st.name : 'สภ.' + r.short;
      const phone = st && st.phone ? formatPhone(st.phone) : 'ไม่มีข้อมูล';
      const digits = st && st.phone ? phoneDigits(st.phone) : '';
      const navUrl = 'https://www.google.com/maps/dir/?api=1&origin=' +
        encodeURIComponent(originLat.toFixed(5) + ',' + originLon.toFixed(5)) +
        '&destination=' + encodeURIComponent(fullName + ' ' + r.province);
      return (
        '<div class="map-neighbor-card">' +
          '<div class="map-jur-top">' +
            '<strong>' + esc(fullName) + '</strong>' +
            '<span class="map-badge">' + esc(r.amphoe ? 'อ.' + r.amphoe : 'จ.' + r.province) + '</span>' +
          '</div>' +
          '<div class="map-jur-sub">โทร ' + esc(phone) + '</div>' +
          '<div class="map-card-actions">' +
            (digits ? '<a class="map-mini-btn map-mini-primary" href="tel:' + esc(digits) + '">โทร</a>' : '') +
            '<a class="map-mini-btn" href="' + esc(navUrl) + '" target="_blank" rel="noopener">นำทาง</a>' +
            '<a class="map-mini-btn" href="jurisdiction.html?j=' + encodeURIComponent(r.short) + '&jtab=jur">เขตอำนาจ</a>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    neighborStationsBox.hidden = false;
    neighborStationsBox.innerHTML =
      '<div class="map-sec-head">' +
        '<span>เครือข่ายสถานีตำรวจข้างเคียง</span>' +
        '<small>จ.' + esc(primaryRec.province) + ' · ประสาน / ส่งหมาย</small>' +
      '</div>' +
      cards;
  }

  function renderJurisdictionBox(admin, lat, lon) {
    if (!mapJurBox) return Promise.resolve(null);
    if (!admin.province && !admin.tambons.length) {
      mapJurBox.hidden = true;
      mapJurBox.innerHTML = '';
      if (neighborStationsBox) { neighborStationsBox.hidden = true; neighborStationsBox.innerHTML = ''; }
      return Promise.resolve(null);
    }

    mapJurBox.hidden = false;
    mapJurBox.innerHTML = '<div class="map-sec-head"><span>เขตอำนาจสอบสวนของตำแหน่งนี้</span></div><div class="map-sec-loading">กำลังตรวจสอบเขตอำนาจสอบสวน…</div>';

    return loadJurisdiction().then(function () {
      const found = findJurisdictionForAdmin(admin);
      const displayTambon = found.recs.length && !found.byAmphoeOnly ? found.matchedTambon : admin.tambons[0];
      const areaLabel = [
        displayTambon ? (admin.province === 'กรุงเทพมหานคร' ? 'แขวง' : 'ต.') + displayTambon : '',
        admin.amphoe ? (admin.province === 'กรุงเทพมหานคร' ? 'เขต' : 'อ.') + admin.amphoe : '',
        admin.province ? (admin.province === 'กรุงเทพมหานคร' ? admin.province : 'จ.' + admin.province) : ''
      ].filter(Boolean).join(' · ');

      if (found.recs.length) {
        const cards = found.recs.map(function (rec) {
          const st = ST_BY_ID.get(String(rec.id));
          const fullName = st ? st.name : 'สภ.' + rec.short;
          const phone = st && st.phone ? formatPhone(st.phone) : 'ไม่มีข้อมูล';
          const digits = st && st.phone ? phoneDigits(st.phone) : '';
          const warnParts = buildJurisdictionWarnings(rec, found.matchedTambon, found.byAmphoeOnly);
          const warnHtml = warnParts.length
            ? '<div class="map-jur-warn">' + esc(warnParts.join(' · ')) + '</div>'
            : '';
          const navUrl = 'https://www.google.com/maps/dir/?api=1&origin=' +
            encodeURIComponent(lat.toFixed(5) + ',' + lon.toFixed(5)) +
            '&destination=' + encodeURIComponent(fullName + ' ' + rec.province);
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

        renderNeighborStations(found.recs[0], lat, lon);
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
        if (neighborStationsBox) { neighborStationsBox.hidden = true; neighborStationsBox.innerHTML = ''; }
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
        if (neighborStationsBox) { neighborStationsBox.hidden = true; neighborStationsBox.innerHTML = ''; }
      }

      if (sosActive) {
        sosState.jurResult = found;
        sosState.jurAreaLabel = areaLabel;
        sosState.admin = admin;
        renderSOSPanel();
      }
      return { found: found, areaLabel: areaLabel };
    }).catch(function () {
      mapJurBox.hidden = true;
      return null;
    });
  }

  /* =====================================================================
     7. Nearby Police Stations (Multi-Source: Overpass + Nominatim + Jurisdiction-First)
  ===================================================================== */
  function createTimeoutSignal(ms, parentSignal) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms);
    const onParentAbort = function () { clearTimeout(timer); ctrl.abort(); };
    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timer);
        ctrl.abort();
      } else {
        parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }
    }
    return {
      signal: ctrl.signal,
      cleanup: function () {
        clearTimeout(timer);
        if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
      }
    };
  }

  function fetchOverpassPolice(lat, lon, parentSignal) {
    const q =
      '[out:json][timeout:6];' +
      'nwr["amenity"="police"](around:20000,' + lat.toFixed(5) + ',' + lon.toFixed(5) + ');' +
      'out center 40;';
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ];

    const tryEndpoint = function (idx) {
      if (idx >= endpoints.length) return Promise.reject(new Error('Overpass unavailable'));
      const t = createTimeoutSignal(idx === 0 ? 5500 : 4500, parentSignal);
      return fetch(endpoints[idx], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'data=' + encodeURIComponent(q),
        signal: t.signal
      })
        .then(function (r) { if (!r.ok) throw new Error('Overpass HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          t.cleanup();
          const els = data && Array.isArray(data.elements) ? data.elements : [];
          const out = [];
          for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const pLat = typeof el.lat === 'number' ? el.lat : (el.center && typeof el.center.lat === 'number' ? el.center.lat : NaN);
            const pLon = typeof el.lon === 'number' ? el.lon : (el.center && typeof el.center.lon === 'number' ? el.center.lon : NaN);
            if (!isFinite(pLat) || !isFinite(pLon)) continue;
            const tags = el.tags || {};
            const names = [tags['name:th'], tags.name, tags.official_name, tags.short_name, tags.alt_name, tags['name:en']].filter(Boolean);
            if (!names.length) continue;
            out.push({ lat: pLat, lon: pLon, names: names, rawName: names[0], isOverpass: true });
          }
          return out;
        })
        .catch(function (err) {
          t.cleanup();
          if (parentSignal && parentSignal.aborted) throw err;
          return tryEndpoint(idx + 1);
        });
    };
    return tryEndpoint(0);
  }

  function fetchNominatimPolice(lat, lon, queryText, parentSignal, deltaOverride) {
    const t = createTimeoutSignal(6000, parentSignal);
    const delta = deltaOverride || 0.18;
    const viewbox = [
      (lon - delta).toFixed(4),
      (lat + delta).toFixed(4),
      (lon + delta).toFixed(4),
      (lat - delta).toFixed(4)
    ].join(',');
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&accept-language=th,en&bounded=1&limit=15&viewbox=' +
      encodeURIComponent(viewbox) +
      '&q=' + encodeURIComponent(queryText);
    return fetch(url, { signal: t.signal })
      .then(function (r) { if (!r.ok) throw new Error('Nominatim police lookup failed'); return r.json(); })
      .then(function (list) {
        const els = Array.isArray(list) ? list : [];
        const out = [];
        for (let i = 0; i < els.length; i++) {
          const el = els[i];
          const pLat = Number(el.lat), pLon = Number(el.lon);
          if (!isFinite(pLat) || !isFinite(pLon)) continue;
          const firstPart = el.display_name ? el.display_name.split(',')[0].trim() : '';
          const rawName = (el.name || firstPart || '').trim();
          if (!rawName || el.class === 'highway' || /^(ซอย|ถนน|แยก|ป้ายรถ|สะพาน)/.test(rawName)) continue;
          const isPoliceAmenity = el.type === 'police' || (el.class === 'amenity' && /police/i.test(el.type || ''));
          const hasPoliceKeyword = /(สถานีตำรวจ|สภ\.|สน\.|police\s+station)/i.test(rawName);
          if (!isPoliceAmenity && !hasPoliceKeyword) continue;
          const names = [el.name, firstPart].filter(Boolean);
          out.push({ lat: pLat, lon: pLon, names: names, rawName: rawName, isOverpass: false });
        }
        return out;
      })
      .finally(t.cleanup);
  }

  function lookupOfficialStationCoord(st, originLat, originLon, parentSignal) {
    if (!st) return Promise.resolve(null);
    const id = String(st.id);
    if (STATION_COORDS.has(id)) {
      const p = STATION_COORDS.get(id);
      return Promise.resolve({ lat: p[0], lon: p[1], st: st });
    }
    if (OSM_COORD_CACHE.has(id)) {
      const p = OSM_COORD_CACHE.get(id);
      return Promise.resolve({ lat: p[0], lon: p[1], st: st });
    }
    const prov = st.province_th || '';
    const expanded = st.name
      .replace(/^สภ\./, 'สถานีตำรวจภูธร')
      .replace(/^สน\./, 'สถานีตำรวจนครบาล');
    const queries = [st.name + (prov ? ' ' + prov : '')];
    if (expanded !== st.name) queries.push(expanded + (prov ? ' ' + prov : ''));

    const tryQuery = function (idx) {
      if (idx >= queries.length) return Promise.resolve(null);
      const t = createTimeoutSignal(6000, parentSignal);
      const url =
        'https://nominatim.openstreetmap.org/search?format=json&accept-language=th,en&countrycodes=th&limit=5&q=' +
        encodeURIComponent(queries[idx]);
      return fetch(url, { signal: t.signal })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (list) {
          t.cleanup();
          const els = Array.isArray(list) ? list : [];
          for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const pLat = Number(el.lat), pLon = Number(el.lon);
            if (!isFinite(pLat) || !isFinite(pLon)) continue;
            if (haversineKm(originLat, originLon, pLat, pLon) > 80) continue;
            const firstPart = el.display_name ? el.display_name.split(',')[0].trim() : '';
            const matched = matchOfficialStation([el.name, firstPart].filter(Boolean), prov);
            /* Strictly accept only if the OSM result actually matches this exact official station */
            if (matched && String(matched.id) === id) {
              return { lat: pLat, lon: pLon, st: st };
            }
          }
          return tryQuery(idx + 1);
        })
        .catch(function () {
          t.cleanup();
          return tryQuery(idx + 1);
        });
    };
    return tryQuery(0);
  }

  function collectLocalCoordCandidates(lat, lon) {
    const items = [];
    const seen = new Set();

    function addFromMap(mapRef) {
      mapRef.forEach(function (pair, id) {
        if (seen.has(id)) return;
        const st = ST_BY_ID.get(String(id));
        if (!st) return;
        const dist = haversineKm(lat, lon, pair[0], pair[1]);
        if (dist <= 45) {
          seen.add(id);
          items.push({
            name: st.name,
            lat: pair[0],
            lon: pair[1],
            distKm: dist,
            official: st,
            isJurisdiction: false
          });
        }
      });
    }
    addFromMap(STATION_COORDS);
    addFromMap(OSM_COORD_CACHE);
    return items;
  }

  function renderNearbyStations(lat, lon, admin, signal, jurPromise) {
    if (!nearbyStationsBox) return Promise.resolve();
    nearbyStationsBox.hidden = false;
    nearbyStationsBox.innerHTML =
      '<div class="map-sec-head"><span>สภ./สน. ใกล้ตำแหน่งนี้</span><small>กำลังค้นหาสถานีตำรวจใกล้เคียง…</small></div>';

    return Promise.all([
      loadStationCoords(),
      Promise.resolve(jurPromise).catch(function () { return null; })
    ]).then(function (bootResults) {
      if (signal && signal.aborted) return;
      const jurRes = bootResults[1];
      const jurStations = [];
      const jurIdSet = new Set();
      if (jurRes && jurRes.found && Array.isArray(jurRes.found.recs)) {
        jurRes.found.recs.forEach(function (rec) {
          const st = ST_BY_ID.get(String(rec.id));
          if (st && !jurIdSet.has(String(st.id))) {
            jurIdSet.add(String(st.id));
            jurStations.push(st);
          }
        });
      }

      const localCandidates = collectLocalCoordCandidates(lat, lon);
      const isBkk = admin.province === 'กรุงเทพมหานคร';
      const shortPrefix = isBkk ? 'สน.' : 'สภ.';
      const urbanDelta = isBkk ? 0.08 : 0.18;
      const primaryJur = jurStations[0] || null;
      const needDirectJurLookup = Boolean(
        primaryJur &&
        !STATION_COORDS.has(String(primaryJur.id)) &&
        !OSM_COORD_CACHE.has(String(primaryJur.id))
      );

      const tasks = [
        fetchOverpassPolice(lat, lon, signal),
        fetchNominatimPolice(lat, lon, 'police', signal, urbanDelta),
        fetchNominatimPolice(lat, lon, 'สถานีตำรวจ', signal, urbanDelta),
        fetchNominatimPolice(lat, lon, shortPrefix, signal, urbanDelta),
        needDirectJurLookup ? lookupOfficialStationCoord(primaryJur, lat, lon, signal) : Promise.resolve(null)
      ];

      return Promise.allSettled(tasks).then(function (settled) {
        if (signal && signal.aborted) return;

        const byKey = new Map();
        let addedToCache = false;

        function upsertItem(entry) {
          const key = entry.official ? 'id:' + entry.official.id : 'n:' + normStation(entry.name);
          if (!key || key === 'n:') return;
          const prev = byKey.get(key);
          if (!prev) {
            byKey.set(key, entry);
            return;
          }
          const prevHasCoord = isFinite(prev.lat) && isFinite(prev.lon);
          const nextHasCoord = isFinite(entry.lat) && isFinite(entry.lon);
          const mergedJur = Boolean(prev.isJurisdiction || entry.isJurisdiction);
          if (!prevHasCoord && nextHasCoord) {
            byKey.set(key, Object.assign({}, entry, { isJurisdiction: mergedJur }));
          } else if (prevHasCoord && nextHasCoord && entry.distKm < prev.distKm) {
            byKey.set(key, Object.assign({}, entry, { isJurisdiction: mergedJur }));
          } else {
            prev.isJurisdiction = mergedJur;
            if (!prev.official && entry.official) prev.official = entry.official;
          }
        }

        /* 1. Local registry & cached OSM coordinates */
        for (let i = 0; i < localCandidates.length; i++) {
          const c = localCandidates[i];
          c.isJurisdiction = Boolean(c.official && jurIdSet.has(String(c.official.id)));
          upsertItem(c);
        }

        /* 2. Overpass + Nominatim multi-source POIs */
        for (let tIdx = 0; tIdx < 4; tIdx++) {
          if (settled[tIdx].status !== 'fulfilled' || !Array.isArray(settled[tIdx].value)) continue;
          const pois = settled[tIdx].value;
          for (let i = 0; i < pois.length; i++) {
            const poi = pois[i];
            const official = matchOfficialStation(poi.names, admin.province);
            /* Filter out generic police booths / non-station POIs if not matched to official STATIONS */
            if (!official) {
              const joined = poi.names.join(' ');
              if (!/(สถานีตำรวจ|สภ\.|สน\.|police\s+station)/i.test(joined)) continue;
            }
            const displayName = official ? official.name : poi.rawName;
            const distKm = haversineKm(lat, lon, poi.lat, poi.lon);
            if (official && !STATION_COORDS.has(String(official.id)) && !OSM_COORD_CACHE.has(String(official.id))) {
              OSM_COORD_CACHE.set(String(official.id), [poi.lat, poi.lon]);
              addedToCache = true;
            }
            upsertItem({
              name: displayName,
              lat: poi.lat,
              lon: poi.lon,
              distKm: distKm,
              official: official,
              isJurisdiction: Boolean(official && jurIdSet.has(String(official.id)))
            });
          }
        }

        /* 3. Direct coordinate lookup result for primary jurisdiction station */
        const directJurRes = settled[4].status === 'fulfilled' ? settled[4].value : null;
        if (directJurRes && directJurRes.st && isFinite(directJurRes.lat) && isFinite(directJurRes.lon)) {
          const st = directJurRes.st;
          if (!STATION_COORDS.has(String(st.id)) && !OSM_COORD_CACHE.has(String(st.id))) {
            OSM_COORD_CACHE.set(String(st.id), [directJurRes.lat, directJurRes.lon]);
            addedToCache = true;
          }
          upsertItem({
            name: st.name,
            lat: directJurRes.lat,
            lon: directJurRes.lon,
            distKm: haversineKm(lat, lon, directJurRes.lat, directJurRes.lon),
            official: st,
            isJurisdiction: true
          });
        }

        /* 4. Jurisdiction-First Guarantee: ensure every jurisdiction station is present */
        const noCoordJurItems = [];
        for (let i = 0; i < jurStations.length; i++) {
          const st = jurStations[i];
          const key = 'id:' + st.id;
          const existing = byKey.get(key);
          if (existing) {
            existing.isJurisdiction = true;
          } else {
            const pair = STATION_COORDS.get(String(st.id)) || OSM_COORD_CACHE.get(String(st.id));
            if (pair && isFinite(pair[0]) && isFinite(pair[1])) {
              upsertItem({
                name: st.name,
                lat: pair[0],
                lon: pair[1],
                distKm: haversineKm(lat, lon, pair[0], pair[1]),
                official: st,
                isJurisdiction: true
              });
            } else {
              noCoordJurItems.push({
                name: st.name,
                lat: NaN,
                lon: NaN,
                distKm: NaN,
                official: st,
                isJurisdiction: true
              });
            }
          }
        }

        if (addedToCache) persistOsmCoordCache();

        const withCoords = [];
        byKey.forEach(function (val) {
          if (isFinite(val.lat) && isFinite(val.lon) && isFinite(val.distKm)) {
            withCoords.push(val);
          }
        });
        withCoords.sort(function (a, b) { return a.distKm - b.distKm; });

        /* Build final top list: unlocated jurisdiction station(s) pinned at #1, then distance-sorted */
        let top = noCoordJurItems.concat(withCoords).slice(0, 6);

        /* If a located jurisdiction station fell outside top 6, include it without losing nearest */
        for (let i = 0; i < withCoords.length; i++) {
          if (withCoords[i].isJurisdiction && top.indexOf(withCoords[i]) === -1) {
            top = top.slice(0, 5).concat([withCoords[i]]);
          }
        }

        if (top.length) {
          const hasAnyCoords = top.some(function (it) { return isFinite(it.lat) && isFinite(it.lon); });
          drawNearbyStationList(top, lat, lon, hasAnyCoords);
        } else {
          drawFallbackAreaStations(admin, lat, lon);
        }
      });
    });
  }

  function drawNearbyStationList(items, originLat, originLon, hasCoords) {
    const coordItems = items.filter(function (it) { return isFinite(it.lat) && isFinite(it.lon); });
    currentNearbyFeatures = coordItems;
    refreshStationClusterSource();

    if (sosActive) {
      sosState.nearest = items.slice(0, 3);
      sosState.hasCoords = Boolean(hasCoords || coordItems.length);
      renderSOSPanel();
    }

    nearbyStationsBox.innerHTML =
      '<div class="map-sec-head">' +
        '<span>สภ./สน. ใกล้ตำแหน่งนี้</span>' +
        '<small>' + (coordItems.length ? 'เรียงตามระยะทางจริง' : 'ในพื้นที่เดียวกัน') + '</small>' +
      '</div>';

    items.forEach(function (it) {
      const card = document.createElement('div');
      card.className = 'map-station-card' + (it.isJurisdiction ? ' is-jurisdiction' : '');
      const st = it.official;
      const phone = st && st.phone ? formatPhone(st.phone) : 'ไม่มีข้อมูล';
      const digits = st && st.phone ? phoneDigits(st.phone) : '';
      const shortName = it.name.replace(/^สภ\.|^สน\./, '').trim();
      const itemHasCoord = isFinite(it.lat) && isFinite(it.lon) && typeof it.distKm === 'number' && isFinite(it.distKm);
      const navDest = itemHasCoord
        ? it.lat.toFixed(5) + ',' + it.lon.toFixed(5)
        : (st ? (st.name + (st.address ? ' ' + st.address : ' ' + st.province_th)) : it.name);
      const navUrl = 'https://www.google.com/maps/dir/?api=1&origin=' +
        encodeURIComponent(originLat.toFixed(5) + ',' + originLon.toFixed(5)) +
        '&destination=' + encodeURIComponent(navDest);

      const badgesHtml =
        '<div class="map-badges-wrap">' +
          (it.isJurisdiction ? '<span class="map-badge map-badge-jur">เขตอำนาจพื้นที่นี้</span>' : '') +
          (itemHasCoord ? '<span class="map-dist">' + it.distKm.toFixed(1) + ' กม.</span>' : '') +
        '</div>';

      card.innerHTML =
        '<div class="map-jur-top">' +
          '<button type="button" class="map-st-focus">' + esc(it.name) + '</button>' +
          badgesHtml +
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
      if (focusBtn && itemHasCoord) {
        focusBtn.addEventListener('click', function () {
          ensureMapInitialized().then(function (m) {
            if (!m) return;
            flyMapTo(it.lat, it.lon, 15.5);
            openStationPopup(it.lat, it.lon, {
              id: st ? String(st.id) : '',
              name: it.name,
              province: st ? st.province_th : '',
              phone: st && st.phone ? st.phone : '',
              distKm: it.distKm
            });
          });
        });
      }
      nearbyStationsBox.appendChild(card);
    });
  }

  function drawFallbackAreaStations(admin, originLat, originLon) {
    if (!admin.province) {
      nearbyStationsBox.hidden = true;
      if (sosActive) {
        sosState.nearest = [];
        sosState.hasCoords = false;
        renderSOSPanel();
      }
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
      return { name: st.name, official: st, lat: NaN, lon: NaN, distKm: NaN, isJurisdiction: false };
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
      const jurTask = renderJurisdictionBox(admin, latNum, lonNum);
      renderNearbyStations(latNum, lonNum, admin, signal, jurTask);
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
    lastOriginCoords = { lat: latNum, lon: lonNum };
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

    ensureMapInitialized().then(function (m) {
      if (!m) return;
      setTimeout(function () {
        setMapActivePin(latNum, lonNum, sosActive);
        flyMapTo(latNum, lonNum, 14);
      }, 60);
    });

    copyCoordBtn.dataset.coords = coordFormatted;
    enrichLocationContext(item, latNum, lonNum);
  }

  /* =====================================================================
     8. Citizen SOS Mode (โหมดเร่งด่วนสำหรับประชาชนและเจ้าหน้าที่ภาคสนาม)
  ===================================================================== */
  function renderSOSPanel() {
    if (!sosPanel) return;
    if (!sosActive) {
      sosPanel.hidden = true;
      sosPanel.innerHTML = '';
      return;
    }

    sosPanel.hidden = false;
    const hasPos = typeof sosState.lat === 'number' && typeof sosState.lon === 'number';
    const coordStr = hasPos ? sosState.lat.toFixed(5) + ', ' + sosState.lon.toFixed(5) : '';
    const accText = typeof sosState.accuracy === 'number' && isFinite(sosState.accuracy)
      ? 'ความแม่นยำ ±' + Math.round(sosState.accuracy) + ' เมตร'
      : '';

    let coordHtml = '';
    if (hasPos) {
      coordHtml =
        '<div class="sos-coord-row">' +
          '<div>' +
            '<div class="sos-coord-val mono">' + esc(coordStr) + '</div>' +
            (accText ? '<div class="sos-coord-acc">' + esc(accText) + '</div>' : '') +
          '</div>' +
          '<button type="button" class="sos-copy-btn" id="sosCopyBtn" data-coords="' + esc(coordStr) + '">คัดลอกพิกัด</button>' +
        '</div>';
    } else if (sosState.statusText) {
      coordHtml = '<div class="sos-status-msg" role="status" aria-live="polite">' + esc(sosState.statusText) + '</div>';
    }

    /* Top 3 nearest stations */
    let nearestHtml = '';
    if (hasPos) {
      if (sosState.nearest && sosState.nearest.length) {
        const cards = sosState.nearest.slice(0, 3).map(function (it, idx) {
          const st = it.official;
          const phone = st && st.phone ? formatPhone(st.phone) : 'ไม่มีข้อมูล';
          const digits = st && st.phone ? phoneDigits(st.phone) : '';
          const itemHasCoord = isFinite(it.lat) && isFinite(it.lon) && typeof it.distKm === 'number' && isFinite(it.distKm);
          const navDest = itemHasCoord
            ? it.lat.toFixed(5) + ',' + it.lon.toFixed(5)
            : (st ? (st.name + (st.address ? ' ' + st.address : ' ' + st.province_th)) : it.name);
          const navUrl = 'https://www.google.com/maps/dir/?api=1&origin=' +
            encodeURIComponent(coordStr) +
            '&destination=' + encodeURIComponent(navDest);
          const badges =
            '<div class="map-badges-wrap">' +
              (it.isJurisdiction ? '<span class="map-badge map-badge-jur">เขตอำนาจพื้นที่นี้</span>' : '') +
              (itemHasCoord
                ? '<span class="map-dist">' + it.distKm.toFixed(1) + ' กม.</span>'
                : (!it.isJurisdiction ? '<span class="map-badge">พื้นที่ใกล้เคียง</span>' : '')) +
            '</div>';
          return (
            '<div class="sos-station-item' + (it.isJurisdiction ? ' is-jurisdiction' : '') + '">' +
              '<div class="sos-station-top">' +
                '<span class="sos-rank">' + (idx + 1) + '</span>' +
                '<div class="sos-station-info">' +
                  '<strong>' + esc(it.name) + '</strong>' +
                  '<div class="sos-station-sub">' + esc(st ? st.province_th + ' · โทร ' + phone : 'สถานีตำรวจจาก OSM') + '</div>' +
                '</div>' +
                badges +
              '</div>' +
              '<div class="sos-station-actions">' +
                (digits
                  ? '<a class="sos-act-btn sos-act-call" href="tel:' + esc(digits) + '">โทรด่วน ' + esc(phone) + '</a>'
                  : '<span class="sos-act-btn sos-act-disabled">ไม่มีเบอร์โทร</span>') +
                '<a class="sos-act-btn sos-act-nav" href="' + esc(navUrl) + '" target="_blank" rel="noopener">นำทางทันที</a>' +
              '</div>' +
            '</div>'
          );
        }).join('');

        nearestHtml =
          '<div class="sos-block">' +
            '<div class="sos-block-title">สถานีตำรวจที่ใกล้ที่สุด (สูงสุด 3 อันดับ)</div>' +
            cards +
          '</div>';
      } else {
        nearestHtml =
          '<div class="sos-block">' +
            '<div class="sos-block-title">สถานีตำรวจที่ใกล้ที่สุด</div>' +
            '<div class="map-sec-loading">กำลังคำนวณระยะทางไปยังสถานีตำรวจใกล้คุณ…</div>' +
          '</div>';
      }
    }

    /* Jurisdiction summary inside SOS panel */
    let jurHtml = '';
    if (hasPos && sosState.jurResult) {
      const found = sosState.jurResult;
      if (found.recs && found.recs.length) {
        const rec = found.recs[0];
        const st = ST_BY_ID.get(String(rec.id));
        const fullName = st ? st.name : 'สภ.' + rec.short;
        const warns = buildJurisdictionWarnings(rec, found.matchedTambon, found.byAmphoeOnly);
        jurHtml =
          '<div class="sos-block sos-jur-block">' +
            '<div class="sos-block-title">เขตอำนาจสอบสวนของตำแหน่งปัจจุบัน</div>' +
            '<div class="sos-jur-name">' + esc(fullName) + (sosState.jurAreaLabel ? ' <small>(' + esc(sosState.jurAreaLabel) + ')</small>' : '') + '</div>' +
            (warns.length ? '<div class="map-jur-warn">' + esc(warns.join(' · ')) + '</div>' : '') +
            '<p class="map-jur-note">โปรดยืนยันเขตอำนาจกับสถานีต้นทางและประกาศราชกิจจานุเบกษาก่อนดำเนินการทางกฎหมาย</p>' +
          '</div>';
      } else if (sosState.admin && sosState.admin.province === 'กรุงเทพมหานคร') {
        jurHtml =
          '<div class="sos-block sos-jur-block">' +
            '<div class="sos-block-title">เขตอำนาจสอบสวน (กรุงเทพมหานคร)</div>' +
            '<div class="sos-station-sub">พื้นที่ กทม. กำหนดเขตตามแนวถนน/คลอง กรุณาติดต่อ สน.ใกล้ที่สุดด้านบนหรือโทร 191 เพื่อยืนยันเขตรับผิดชอบ</div>' +
          '</div>';
      }
    }

    sosPanel.innerHTML =
      '<div class="sos-card">' +
        '<div class="sos-header">' +
          '<div class="sos-title-wrap">' +
            '<span class="sos-pulse-dot" aria-hidden="true"></span>' +
            '<strong>โหมดเร่งด่วน (SOS)</strong>' +
          '</div>' +
          '<button type="button" class="sos-close-btn" id="sosCloseBtn" aria-label="ออกจากโหมดเร่งด่วน">ปิดโหมด SOS</button>' +
        '</div>' +
        '<div class="sos-hotlines" aria-label="สายด่วนฉุกเฉิน 1 คลิก">' +
          '<a class="sos-hotline-btn sos-hotline-191" href="tel:191">' +
            '<strong>โทร 191</strong><span>เหตุด่วนเหตุร้าย</span>' +
          '</a>' +
          '<a class="sos-hotline-btn sos-hotline-1599" href="tel:1599">' +
            '<strong>โทร 1599</strong><span>สายด่วน ตร.</span>' +
          '</a>' +
        '</div>' +
        coordHtml +
        nearestHtml +
        jurHtml +
      '</div>';

    const closeBtn = sosPanel.querySelector('#sosCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', deactivateSOSMode);

    const sosCopyBtn = sosPanel.querySelector('#sosCopyBtn');
    if (sosCopyBtn) {
      sosCopyBtn.addEventListener('click', function (ev) {
        const btn = ev.currentTarget;
        const text = btn.dataset.coords;
        if (!text) return;
        copyCoords(text).then(function (ok) {
          btn.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ';
          setTimeout(function () { btn.textContent = 'คัดลอกพิกัด'; }, 1600);
        });
      });
    }
  }

  function deactivateSOSMode() {
    sosActive = false;
    bodyEl.classList.remove('is-sos-mode');
    if (sosBtn) sosBtn.setAttribute('aria-pressed', 'false');
    if (sosPanel) { sosPanel.hidden = true; sosPanel.innerHTML = ''; }
    if (lastOriginCoords) setMapActivePin(lastOriginCoords.lat, lastOriginCoords.lon, false);
  }

  function activateSOSMode() {
    sosActive = true;
    bodyEl.classList.add('has-results', 'is-sos-mode');
    if (capsuleTilt) capsuleTilt.style.transform = 'none';
    if (sosBtn) sosBtn.setAttribute('aria-pressed', 'true');

    sosState = {
      status: 'locating',
      statusText: 'กำลังระบุพิกัด GPS ความแม่นยำสูง…',
      lat: null,
      lon: null,
      accuracy: null,
      nearest: [],
      hasCoords: false,
      jurResult: null,
      jurAreaLabel: '',
      admin: null
    };
    renderSOSPanel();
    ensureMapInitialized();

    if (!navigator.geolocation) {
      sosState.status = 'error';
      sosState.statusText = 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS — สามารถโทร 191 / 1599 หรือพิมพ์ชื่อตำบล/สถานที่ในช่องค้นหาได้ทันที';
      renderSOSPanel();
      return;
    }

    bodyEl.classList.add('is-scanning');
    showStatus('โหมดเร่งด่วน SOS: กำลังรับสัญญาณพิกัดปัจจุบัน…');
    emitCapsulePulse(1, 680);

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        bodyEl.classList.remove('is-scanning');
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        sosState.status = 'ready';
        sosState.statusText = '';
        sosState.lat = lat;
        sosState.lon = lon;
        sosState.accuracy = pos.coords.accuracy;
        renderSOSPanel();

        const coordStr = lat.toFixed(5) + ', ' + lon.toFixed(5);
        searchInput.value = coordStr;
        syncInputState();
        showStatus('');
        executeSearch(coordStr);
      },
      function (err) {
        bodyEl.classList.remove('is-scanning');
        sosState.status = 'error';
        if (err && err.code === 1) {
          sosState.statusText = 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง GPS — กรุณาอนุญาตสิทธิ์ตำแหน่ง หรือกดโทร 191 / พิมพ์ชื่อสถานที่ในช่องค้นหา';
        } else if (err && err.code === 3) {
          sosState.statusText = 'หมดเวลารับสัญญาณ GPS — ลองกดโหมดเร่งด่วนอีกครั้ง หรือคลิกตำแหน่งของคุณบนแผนที่โดยตรง';
        } else {
          sosState.statusText = 'สัญญาณ GPS ขัดข้องในขณะนี้ — สามารถโทร 191 / 1599 หรือคลิกตำแหน่งบนแผนที่เพื่อหา สภ.ใกล้เคียงได้';
        }
        showStatus(sosState.statusText);
        renderSOSPanel();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  if (idleSosBtn) idleSosBtn.addEventListener('click', activateSOSMode);
  if (sosBtn) {
    sosBtn.addEventListener('click', function () {
      if (sosActive) deactivateSOSMode();
      else activateSOSMode();
    });
  }

  if (idleExploreMapBtn) {
    idleExploreMapBtn.addEventListener('click', function () {
      bodyEl.classList.add('has-results');
      if (capsuleTilt) capsuleTilt.style.transform = 'none';
      activePlaceChip.textContent = 'คลิกจุดใดก็ได้บนแผนที่เพื่อตรวจเขตอำนาจและหา สภ.ใกล้เคียง';
      ensureMapInitialized().then(function (m) {
        if (m) flyMapTo(13.7563, 100.5018, 5.5);
      });
    });
  }

  /* =====================================================================
     9. Copy Coordinates Helper
  ===================================================================== */
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
  if (copyCoordBtn) {
    copyCoordBtn.addEventListener('click', function () {
      const coords = copyCoordBtn.dataset.coords;
      if (!coords) return;
      copyCoords(coords).then(function (ok) {
        copyCoordText.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(function () { copyCoordText.textContent = 'คัดลอกพิกัด'; }, 1600);
      });
    });
  }

  /* =====================================================================
     10. Live Geocoding & Coordinate Parsing (OSM Nominatim)
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
    if (capsuleTilt) capsuleTilt.style.transform = 'none';

    if (sourceBadge && mapReady) sourceBadge.textContent = 'WEBGL · OSM';
    resultsLabel.textContent = 'สภ./สน. ใกล้ตำแหน่งนี้ & เขตอำนาจ';
    resultsList.innerHTML = '';

    if (!currentResults.length) {
      if (mapJurBox) { mapJurBox.innerHTML = ''; mapJurBox.hidden = true; }
      if (nearbyStationsBox) { nearbyStationsBox.innerHTML = ''; nearbyStationsBox.hidden = true; }
      if (neighborStationsBox) { neighborStationsBox.innerHTML = ''; neighborStationsBox.hidden = true; }
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
      if (capsuleTilt) {
        capsuleTilt.classList.remove('shake');
        void capsuleTilt.offsetWidth;
        capsuleTilt.classList.add('shake');
      }
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
     11. GPS Live Position Trigger ("สภ./สน. ใกล้ฉัน")
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
  if (gpsBtn) gpsBtn.addEventListener('click', triggerGPS);
  if (idleGpsBtn) idleGpsBtn.addEventListener('click', triggerGPS);

  /* =====================================================================
     12. Voice Search Trigger (Web Speech API — Real-Time Thai)
  ===================================================================== */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (voiceBtn && searchInput) {
    if (!SpeechRec) {
      voiceBtn.style.display = 'none';
      voiceBtn.addEventListener('click', function () {
        showStatus('เบราว์เซอร์นี้ไม่รองรับการค้นหาด้วยเสียง กรุณาเปิดใน Chrome หรือ Safari');
      });
    } else {
      voiceBtn.style.display = 'inline-flex';
      voiceBtn.setAttribute('aria-pressed', 'false');
      let activeRec = null;
      let isListening = false;
      const origPlaceholder = searchInput.placeholder || '';

      voiceBtn.addEventListener('click', function () {
        if (isListening && activeRec) {
          try { activeRec.stop(); } catch (_) {}
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

        rec.onstart = function () {
          isListening = true;
          voiceBtn.classList.add('is-active');
          voiceBtn.setAttribute('aria-pressed', 'true');
          searchInput.placeholder = 'กำลังฟังเสียงพูด... พูดชื่อสถานที่ ตำบล หรือสถานีได้เลย';
          showStatus('กำลังฟังเสียงพูดภาษาไทย... พูดชื่อสถานที่ ตำบล หรือสถานีได้เลย');
          emitCapsulePulse(0.9, 480);
        };

        rec.onresult = function (ev) {
          const raw = Array.from(ev.results || [])
            .map(function (r) { return (r && r[0] && r[0].transcript) || ''; })
            .join(' ')
            .trim();
          const clean = raw.replace(/[.。]+$/g, '').trim();
          if (clean) {
            latestText = clean;
            searchInput.value = clean;
            syncInputState();
          }
          const lastRes = ev.results && ev.results[ev.results.length - 1];
          if (lastRes && lastRes.isFinal && latestText) {
            finalized = true;
            executeSearch(latestText);
          }
        };

        rec.onerror = function (ev) {
          const code = ev && ev.error;
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            showStatus('ไม่ได้รับสิทธิ์ใช้ไมโครโฟน — กรุณากดไอคอนหน้าแถบ URL เพื่ออนุญาตไมโครโฟน');
          } else if (code === 'audio-capture') {
            showStatus('ไม่พบไมโครโฟนในอุปกรณ์ของคุณ');
          } else if (code === 'no-speech') {
            showStatus('ไม่ได้ยินเสียงพูด — ลองกดไมโครโฟนแล้วพูดใหม่อีกครั้ง');
          } else if (code === 'network') {
            showStatus('บริการรับเสียงของเบราว์เซอร์ขัดข้อง — กรุณาพิมพ์ค้นหาแทน');
          } else if (code !== 'aborted') {
            showStatus('ไม่สามารถรับเสียงพูดได้ในขณะนี้ ลองกดใหม่อีกครั้ง');
          }
        };

        rec.onend = function () {
          isListening = false;
          activeRec = null;
          voiceBtn.classList.remove('is-active');
          voiceBtn.setAttribute('aria-pressed', 'false');
          searchInput.placeholder = origPlaceholder;
          if (inlineStatus.textContent.indexOf('กำลังฟัง') !== -1) showStatus('');
          if (!finalized && latestText) {
            finalized = true;
            executeSearch(latestText);
          }
        };

        try {
          rec.start();
        } catch (_) {
          isListening = false;
          activeRec = null;
          voiceBtn.classList.remove('is-active');
          voiceBtn.setAttribute('aria-pressed', 'false');
          searchInput.placeholder = origPlaceholder;
          showStatus('ไม่สามารถเริ่มรับเสียงพูดได้ ลองกดไมโครโฟนใหม่อีกครั้ง');
        }
      });
    }
  }

  /* =====================================================================
     13. URL param (?q= / ?sos=1) + Real Visitor Counter (/api/visit)
  ===================================================================== */
  try {
    const params = new URLSearchParams(window.location.search);
    const initialQ = params.get('q');
    const initialSos = params.get('sos');
    if (initialSos === '1') {
      activateSOSMode();
    } else if (initialQ) {
      searchInput.value = initialQ;
      syncInputState();
      executeSearch(initialQ);
    }
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
