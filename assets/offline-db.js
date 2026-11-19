/* ============================================================
   PS Locator — Offline-First PWA & IndexedDB Sync (Non-Blocking)
   - Registers ./sw.js during idle after window load
   - Syncs window.STATIONS & window.JURISDICTION to IndexedDB (ps-locator-db)
   - Shows compact Thai offline status pill & SW update banner
   - Zero external dependencies; never throws uncaught exceptions
   ============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'ps-locator-db';
  const DB_VERSION = 1;
  const SW_URL = './sw.js';

  function scheduleIdle(fn) {
    try {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(fn, { timeout: 2500 });
      } else {
        window.setTimeout(fn, 800);
      }
    } catch {
      try { window.setTimeout(fn, 800); } catch { /* ignore */ }
    }
  }

  /* ---------- IndexedDB Wrapper ---------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = (ev) => {
        try {
          const db = ev.target.result;
          if (!db.objectStoreNames.contains('stations')) {
            db.createObjectStore('stations', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('jurisdictions')) {
            db.createObjectStore('jurisdictions', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' });
          }
        } catch { /* ignore */ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
    });
  }

  function idbGet(db, storeName, key) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  function idbPut(db, storeName, value) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  function computeStationsSignature(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const first = list[0];
    const last = list[list.length - 1];
    return `${list.length}:${first && first.id}:${last && last.id}:${last && last.name}`;
  }

  async function syncStations(db) {
    const stations = window.STATIONS;
    if (!Array.isArray(stations) || !stations.length) return;
    const sig = computeStationsSignature(stations);
    const prev = await idbGet(db, 'meta', 'stations_sig');
    if (prev && prev.value === sig) return;

    await new Promise((resolve) => {
      try {
        const tx = db.transaction(['stations', 'meta'], 'readwrite');
        const store = tx.objectStore('stations');
        for (let i = 0; i < stations.length; i++) {
          store.put(stations[i]);
        }
        tx.objectStore('meta').put({
          key: 'stations_sig',
          value: sig,
          count: stations.length,
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async function syncJurisdictions(db) {
    const jur = window.JURISDICTION;
    if (!jur || typeof jur !== 'object') return;
    const count = Array.isArray(jur.stations) ? jur.stations.length : 0;
    const sig = `jur:${count}:${jur.meta && jur.meta.generatedAt || ''}`;
    const prev = await idbGet(db, 'meta', 'jurisdictions_sig');
    if (prev && prev.value === sig) return;

    await idbPut(db, 'jurisdictions', {
      key: 'default',
      data: jur,
      updatedAt: Date.now(),
    });
    await idbPut(db, 'meta', {
      key: 'jurisdictions_sig',
      value: sig,
      count,
      updatedAt: Date.now(),
    });
  }

  async function syncAllData() {
    let db = null;
    try {
      db = await openDB();
      await syncStations(db);
      await syncJurisdictions(db);
    } catch {
      /* Private mode, quota exceeded, or unsupported */
    } finally {
      try { if (db) db.close(); } catch { /* ignore */ }
    }
  }

  /* ---------- UI: Offline Status Pill ---------- */
  let offlinePillEl = null;

  function ensureOfflinePill() {
    if (offlinePillEl) return offlinePillEl;
    const el = document.createElement('div');
    el.className = 'ps-offline-pill';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    el.innerHTML =
      '<span class="ps-offline-dot" aria-hidden="true"></span>' +
      '<span>โหมดออฟไลน์ · ค้นหาสถานีและเบอร์โทรได้ครบ 1,484 แห่ง</span>';
    document.body.appendChild(el);
    offlinePillEl = el;
    return el;
  }

  function updateOnlineStatus() {
    try {
      const online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
      if (!online) {
        ensureOfflinePill().hidden = false;
      } else if (offlinePillEl) {
        offlinePillEl.hidden = true;
      }
    } catch { /* ignore */ }
  }

  /* ---------- UI: Service Worker Update Banner ---------- */
  let updateBannerEl = null;

  function showUpdateBanner(waitingWorker) {
    if (!waitingWorker) return;
    try {
      if (updateBannerEl) {
        updateBannerEl.hidden = false;
        return;
      }
      const el = document.createElement('div');
      el.className = 'ps-sw-update';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'การอัปเดตแอปพลิเคชัน');
      el.innerHTML =
        '<span class="ps-sw-update-text">มีเวอร์ชันใหม่ของ PS Locator พร้อมใช้งาน</span>' +
        '<div class="ps-sw-update-actions">' +
          '<button type="button" class="ps-sw-btn-primary" id="psSwRefreshBtn">รีเฟรชเพื่ออัปเดต</button>' +
          '<button type="button" class="ps-sw-btn-dismiss" id="psSwDismissBtn" aria-label="ปิดการแจ้งเตือน">ไว้ทีหลัง</button>' +
        '</div>';
      document.body.appendChild(el);
      updateBannerEl = el;

      const refreshBtn = el.querySelector('#psSwRefreshBtn');
      const dismissBtn = el.querySelector('#psSwDismissBtn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          refreshBtn.disabled = true;
          refreshBtn.textContent = 'กำลังอัปเดต…';
          try { waitingWorker.postMessage({ type: 'SKIP_WAITING' }); } catch { window.location.reload(); }
        });
      }
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => { el.hidden = true; });
      }
    } catch { /* ignore */ }
  }

  /* ---------- Service Worker Registration ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const isSecure = window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!isSecure) return;

    let refreshing = false;
    try {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'DATA_UPDATED') {
          scheduleIdle(syncAllData);
        }
      });

      navigator.serviceWorker.register(SW_URL, { scope: './' })
        .then((reg) => {
          if (reg.waiting && navigator.serviceWorker.controller) {
            showUpdateBanner(reg.waiting);
          }
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner(newWorker);
              }
            });
          });
        })
        .catch(() => { /* SW registration failed or blocked */ });
    } catch { /* ignore */ }
  }

  /* ---------- Boot (Non-Blocking) ---------- */
  function initOffline() {
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    registerSW();
    syncAllData();

    /* If jurisdiction data loads lazily later, sync once when available */
    if (!window.JURISDICTION && document.getElementById('jurForm')) {
      let tries = 0;
      const timer = window.setInterval(() => {
        tries++;
        if (window.JURISDICTION) {
          window.clearInterval(timer);
          scheduleIdle(syncAllData);
        } else if (tries >= 15) {
          window.clearInterval(timer);
        }
      }, 2000);
    }
  }

  if (document.readyState === 'complete') {
    scheduleIdle(initOffline);
  } else {
    window.addEventListener('load', () => scheduleIdle(initOffline), { once: true });
  }
})();
