const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|twitterbot/i;

const REGION_SHORT = {
  bkk: 'บช.น.',
  p1: 'ภ.1',
  p2: 'ภ.2',
  p3: 'ภ.3',
  p4: 'ภ.4',
  p5: 'ภ.5',
  p6: 'ภ.6',
  p7: 'ภ.7',
  p8: 'ภ.8',
  p9: 'ภ.9',
};

const REGION_NAME = {
  bkk: 'กองบัญชาการตำรวจนครบาล',
  p1: 'กองบัญชาการตำรวจภูธรภาค 1',
  p2: 'กองบัญชาการตำรวจภูธรภาค 2',
  p3: 'กองบัญชาการตำรวจภูธรภาค 3',
  p4: 'กองบัญชาการตำรวจภูธรภาค 4',
  p5: 'กองบัญชาการตำรวจภูธรภาค 5',
  p6: 'กองบัญชาการตำรวจภูธรภาค 6',
  p7: 'กองบัญชาการตำรวจภูธรภาค 7',
  p8: 'กองบัญชาการตำรวจภูธรภาค 8',
  p9: 'กองบัญชาการตำรวจภูธรภาค 9',
};

const OG_FOOTER = 'PS Locator · สารบบสถานีตำรวจทั่วประเทศ · โปรดยืนยันกับสถานีก่อนดำเนินการทางกฎหมาย';
const HTML_META_PATHS = new Set(['/', '/index.html', '/jurisdiction', '/jurisdiction.html']);

const GAZETTE_DOC_MAP = {
  '2567': {
    label: 'ประกาศ ตร. 22 มี.ค. 2567',
    pdf_url: 'https://ratchakitcha.soc.go.th/documents/17187.pdf',
  },
  '2568-2': {
    label: 'ประกาศ ตร. ฉบับที่ 2 · 22 ต.ค. 2568',
    pdf_url: 'https://ratchakitcha.soc.go.th/documents/91341.pdf',
  },
};

const ALLOWED_REPORT_FIELDS = new Set(['phone', 'address', 'website', 'fax', 'other']);

const LEGAL_DISCLAIMER =
  'คำเตือนทางกฎหมาย: คำตอบนี้สรุปจากข้อความประกาศสำนักงานตำรวจแห่งชาติในราชกิจจานุเบกษาที่ดึงมาได้เท่านั้น ' +
  'อาจมีตำบลบางส่วน/เฉพาะหมู่ที่/แนวเขต หรือ 4 สถานีที่ถอดข้อความไม่ครบ โปรดเปิดไฟล์ PDF ราชกิจจานุเบกษาฉบับจริงและยืนยันกับสถานีตำรวจต้นทางก่อนดำเนินการทางกฎหมาย';

const SITE_ORIGIN = 'https://ps-locator.prajamwan.workers.dev';
const SITEMAP_LASTMOD = '2026-11-19';
const REGION_ORDER = ['bkk', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
const SSR_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';
const SITEMAP_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

let cachedStations = null;
let cachedStationsById = null;
let cachedStationsByProvince = null;
let cachedProvincesByRegion = null;

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normStation(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/สถานีตำรวจ/g, '')
    .replace(/สภ\.อ\.|สน\.|สภ\./g, '')
    .replace(/[\s\-‐-―.,()\/\\]+/g, '');
}

function formatPhone(p) {
  const raw = String(p || '').trim();
  if (!raw) return 'ไม่มีข้อมูล';
  const d = raw.replace(/\D/g, '');
  if (d.length === 9) return d.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{3})(\d{4,5})/, '$1-$2-$3');
  return raw;
}

function wrapThaiText(text, maxChars = 48, maxLines = 2) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return ['ไม่มีข้อมูล'];
  if (clean.length <= maxChars) return [clean];

  const lines = [];
  let rest = clean;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      rest = '';
      break;
    }
    if (lines.length === maxLines - 1) {
      let cut = rest.slice(0, maxChars - 1);
      const sp = cut.lastIndexOf(' ');
      if (sp > maxChars * 0.55) cut = cut.slice(0, sp);
      lines.push(cut.trimEnd() + '…');
      rest = '';
      break;
    }
    let cutIdx = rest.lastIndexOf(' ', maxChars);
    if (cutIdx < Math.floor(maxChars * 0.55)) cutIdx = maxChars;
    lines.push(rest.slice(0, cutIdx).trimEnd());
    rest = rest.slice(cutIdx).trimStart();
  }
  return lines;
}

async function getStations(env, requestUrl) {
  if (cachedStations && cachedStationsById && cachedStationsByProvince && cachedProvincesByRegion) {
    return {
      list: cachedStations,
      byId: cachedStationsById,
      byProvince: cachedStationsByProvince,
      provincesByRegion: cachedProvincesByRegion,
    };
  }
  try {
    const assetUrl = new URL('/data/stations.json', requestUrl);
    const res = await env.ASSETS.fetch(new Request(assetUrl.toString()));
    if (!res || !res.ok) {
      return { list: [], byId: new Map(), byProvince: new Map(), provincesByRegion: new Map() };
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    const byId = new Map();
    const byProvince = new Map();
    const provRegion = new Map();

    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      if (!st) continue;
      if (st.id !== undefined && st.id !== null) {
        byId.set(String(st.id), st);
      }
      const prov = String(st.province_th || '').trim();
      if (prov) {
        let bucket = byProvince.get(prov);
        if (!bucket) {
          bucket = [];
          byProvince.set(prov, bucket);
        }
        bucket.push(st);
        if (!provRegion.has(prov) && st.region) {
          provRegion.set(prov, st.region);
        }
      }
    }

    const provincesByRegion = new Map();
    for (const r of REGION_ORDER) provincesByRegion.set(r, []);
    for (const [prov, bucket] of byProvince.entries()) {
      const reg = provRegion.get(prov) || 'p1';
      if (!provincesByRegion.has(reg)) provincesByRegion.set(reg, []);
      provincesByRegion.get(reg).push({ province: prov, count: bucket.length });
    }
    for (const items of provincesByRegion.values()) {
      items.sort((a, b) => a.province.localeCompare(b.province, 'th'));
    }

    cachedStations = list;
    cachedStationsById = byId;
    cachedStationsByProvince = byProvince;
    cachedProvincesByRegion = provincesByRegion;
    return { list, byId, byProvince, provincesByRegion };
  } catch {
    return { list: [], byId: new Map(), byProvince: new Map(), provincesByRegion: new Map() };
  }
}

function findStationByQuery(list, rawQ) {
  const qNorm = normStation(rawQ);
  if (!qNorm || !list.length) return null;

  let best = null;
  let bestScore = 99;
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    const name = normStation(st.name);
    let score = 99;
    if (name === qNorm) score = 0;
    else if (name.startsWith(qNorm)) score = 1;
    else if (name.includes(qNorm)) score = 2;
    else if (normStation(st.province_th).includes(qNorm)) score = 3;
    else if (normStation(st.address).includes(qNorm)) score = 4;
    else if (normStation(st.phone).includes(qNorm)) score = 5;

    if (score < bestScore) {
      bestScore = score;
      best = st;
      if (score === 0) break;
    }
  }
  return bestScore < 99 ? best : null;
}

function renderOgFrame(bodySvg) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="PS Locator">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B101B"/>
      <stop offset="100%" stop-color="#111A2E"/>
    </linearGradient>
    <linearGradient id="crimsonBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7E1F1A"/>
      <stop offset="100%" stop-color="#5F1410"/>
    </linearGradient>
    <linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#C9A227" stop-opacity="0.15"/>
      <stop offset="18%" stop-color="#C9A227" stop-opacity="1"/>
      <stop offset="82%" stop-color="#C9A227" stop-opacity="1"/>
      <stop offset="100%" stop-color="#C9A227" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect x="0" y="0" width="1200" height="18" fill="url(#crimsonBar)"/>
  <rect x="0" y="18" width="1200" height="3" fill="url(#goldLine)"/>
  <rect x="44" y="44" width="1112" height="542" rx="22" fill="#0F172A" fill-opacity="0.72" stroke="#C9A227" stroke-opacity="0.34" stroke-width="1.5"/>
  <rect x="44" y="44" width="14" height="542" rx="7" fill="#7E1F1A"/>
  <!-- Emblem -->
  <g transform="translate(92, 76)">
    <circle cx="30" cy="30" r="28" fill="#7E1F1A" stroke="#C9A227" stroke-width="2.2"/>
    <path d="M30 12l3.1 6.3 6.9 1-5 4.9 1.2 6.9L30 27.8 23.8 31.1l1.2-6.9-5-4.9 6.9-1L30 12Z" fill="#C9A227"/>
    <path d="M19 41h22M23 45.5h14" stroke="#F7F6F2" stroke-width="2" stroke-linecap="round"/>
  </g>
  <text x="172" y="101" fill="#C9A227" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="20" font-weight="700" letter-spacing="2.4">PS LOCATOR · ROYAL THAI POLICE DIRECTORY</text>
  <text x="172" y="130" fill="#CBD5E1" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="21" font-weight="500">สารบบสถานีตำรวจทั่วประเทศ 1,484 แห่ง ครบ 77 จังหวัด</text>
  <rect x="92" y="156" width="1024" height="2" fill="url(#goldLine)"/>
  ${bodySvg}
  <rect x="92" y="518" width="1024" height="1.5" fill="#C9A227" fill-opacity="0.32"/>
  <text x="92" y="556" fill="#94A3B8" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="20" font-weight="500">${escapeXml(OG_FOOTER)}</text>
</svg>`;
}

function renderStationOgSvg(st) {
  const name = escapeXml(st.name || 'สถานีตำรวจ');
  const regionShort = REGION_SHORT[st.region] || '';
  const regionFull = REGION_NAME[st.region] || regionShort || 'สำนักงานตำรวจแห่งชาติ';
  const subline = escapeXml(`จังหวัด${st.province_th || '-'} · ${regionFull}`);
  const phone = escapeXml(formatPhone(st.phone));
  const addrLines = wrapThaiText(st.address || 'ไม่มีข้อมูล', 52, 2);
  const addrSvg = addrLines
    .map((line, i) => `<text x="120" y="${436 + i * 34}" fill="#E2E8F0" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="25" font-weight="400">${escapeXml(line)}</text>`)
    .join('\n  ');

  const body = `
  <rect x="92" y="182" width="186" height="36" rx="18" fill="#7E1F1A" stroke="#C9A227" stroke-width="1.2"/>
  <text x="185" y="206" text-anchor="middle" fill="#F8FAFC" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="18" font-weight="700">${escapeXml(st.region === 'bkk' ? 'นครบาล · ' + regionShort : 'ภูธร · ' + regionShort)}</text>
  <text x="92" y="276" fill="#FFFFFF" font-family="Noto Serif Thai, Sarabun, sans-serif" font-size="52" font-weight="800">${name}</text>
  <text x="92" y="320" fill="#7DD3FC" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="26" font-weight="600">${subline}</text>
  <rect x="92" y="346" width="1024" height="148" rx="14" fill="#0B101B" stroke="#334155" stroke-width="1.2"/>
  <text x="120" y="388" fill="#C9A227" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="23" font-weight="700">โทรศัพท์:</text>
  <text x="232" y="388" fill="#F8FAFC" font-family="IBM Plex Mono, Sarabun, monospace" font-size="26" font-weight="600">${phone}</text>
  ${addrSvg}`;
  return renderOgFrame(body);
}

function renderJurisdictionOgSvg(rawJ) {
  const jLines = wrapThaiText(rawJ, 28, 2);
  const titleSvg = jLines
    .map((line, i) => `<text x="92" y="${292 + i * 62}" fill="#FFFFFF" font-family="Noto Serif Thai, Sarabun, sans-serif" font-size="52" font-weight="800">${escapeXml(line)}</text>`)
    .join('\n  ');

  const body = `
  <rect x="92" y="182" width="248" height="38" rx="19" fill="#7E1F1A" stroke="#C9A227" stroke-width="1.2"/>
  <text x="216" y="207" text-anchor="middle" fill="#F8FAFC" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="19" font-weight="700">ตรวจเขตอำนาจสอบสวน</text>
  ${titleSvg}
  <rect x="92" y="408" width="1024" height="86" rx="14" fill="#451A03" fill-opacity="0.55" stroke="#C9A227" stroke-opacity="0.7" stroke-width="1.4"/>
  <text x="120" y="445" fill="#FCD34D" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="22" font-weight="700">คำเตือนทางกฎหมาย: ข้อมูลถอดจากประกาศสำนักงานตำรวจแห่งชาติในราชกิจจานุเบกษา</text>
  <text x="120" y="478" fill="#FDE68A" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="20" font-weight="400">โปรดตรวจสอบประกาศฉบับจริงและยืนยันกับสถานีตำรวจต้นทางก่อนดำเนินการทางคดี</text>`;
  return renderOgFrame(body);
}

function renderDefaultOgSvg(queryHint) {
  const sub = queryHint
    ? `ผลการค้นหา: ${wrapThaiText(queryHint, 42, 1)[0]}`
    : 'ค้นหาที่อยู่ เบอร์โทร แผนที่นำทาง และเขตอำนาจสอบสวน';
  const body = `
  <rect x="92" y="188" width="232" height="38" rx="19" fill="#7E1F1A" stroke="#C9A227" stroke-width="1.2"/>
  <text x="208" y="213" text-anchor="middle" fill="#F8FAFC" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="19" font-weight="700">สารบบสถานีตำรวจ</text>
  <text x="92" y="294" fill="#FFFFFF" font-family="Noto Serif Thai, Sarabun, sans-serif" font-size="56" font-weight="800">PS Locator</text>
  <text x="92" y="352" fill="#7DD3FC" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="30" font-weight="600">${escapeXml(sub)}</text>
  <text x="92" y="416" fill="#CBD5E1" font-family="Sarabun, Noto Sans Thai, sans-serif" font-size="24" font-weight="400">ครบทั้ง 1,484 สถานี · 77 จังหวัด · 10 กองบัญชาการ · รองรับพิมพ์ A4 และใช้งานออฟไลน์</text>`;
  return renderOgFrame(body);
}

async function handleOgRequest(request, env, url) {
  const idParam = (url.searchParams.get('id') || '').trim();
  const qParam = (url.searchParams.get('q') || '').trim();
  const jParam = (url.searchParams.get('j') || '').trim();

  let svg;
  if (jParam) {
    svg = renderJurisdictionOgSvg(jParam);
  } else if (idParam || qParam) {
    const { list, byId } = await getStations(env, request.url);
    let st = idParam ? byId.get(idParam) : null;
    if (!st && qParam) st = findStationByQuery(list, qParam);
    svg = st ? renderStationOgSvg(st) : renderDefaultOgSvg(qParam);
  } else {
    svg = renderDefaultOgSvg('');
  }

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function buildDynamicMeta(request, env, url) {
  const idParam = (url.searchParams.get('id') || '').trim();
  const qParam = (url.searchParams.get('q') || '').trim();
  const jParam = (url.searchParams.get('j') || '').trim();

  if (jParam) {
    return {
      title: `ตรวจเขตอำนาจสอบสวน: ${jParam} | PS Locator`,
      description: `ตรวจสอบ สภ./สน. ผู้รับผิดชอบสำหรับ “${jParam}” จากประกาศสำนักงานตำรวจแห่งชาติ (โปรดยืนยันกับประกาศฉบับจริงและสถานีต้นทางก่อนดำเนินการทางกฎหมาย)`,
      ogImage: `${url.origin}/og?j=${encodeURIComponent(jParam)}`,
      ogUrl: url.toString(),
    };
  }

  if (idParam || qParam) {
    const { list, byId } = await getStations(env, request.url);
    let st = idParam ? byId.get(idParam) : null;
    if (!st && qParam) st = findStationByQuery(list, qParam);
    if (st) {
      const phone = formatPhone(st.phone);
      const addr = (st.address || '').trim() || 'ไม่มีข้อมูล';
      const region = REGION_NAME[st.region] || REGION_SHORT[st.region] || '';
      return {
        title: `${st.name} (${st.province_th}) | PS Locator`,
        description: `ที่อยู่: ${addr} · โทรศัพท์: ${phone}${region ? ' · ' + region : ''}`,
        ogImage: `${url.origin}/og?id=${encodeURIComponent(st.id)}`,
        ogUrl: url.toString(),
      };
    }
    if (qParam) {
      return {
        title: `ค้นหา “${qParam}” — สารบบสถานีตำรวจทั่วประเทศ | PS Locator`,
        description: `ผลการค้นหาสถานีตำรวจสำหรับ “${qParam}” จากฐานข้อมูล 1,484 แห่ง 77 จังหวัด`,
        ogImage: `${url.origin}/og?q=${encodeURIComponent(qParam)}`,
        ogUrl: url.toString(),
      };
    }
  }

  return null;
}

function rewriteHtmlMetaString(html, meta) {
  const safeTitle = escapeXml(meta.title);
  const safeDesc = escapeXml(meta.description);
  const safeImg = escapeXml(meta.ogImage);
  const safeUrl = escapeXml(meta.ogUrl);

  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
  const replaceMeta = (attrName, attrVal, contentVal) => {
    const re = new RegExp(`(<meta\\s+[^>]*${attrName}=["']${attrVal}["'][^>]*content=)["'][^"']*["']`, 'i');
    out = out.replace(re, `$1"${contentVal}"`);
  };
  replaceMeta('property', 'og:title', safeTitle);
  replaceMeta('property', 'og:description', safeDesc);
  replaceMeta('property', 'og:image', safeImg);
  replaceMeta('property', 'og:url', safeUrl);
  replaceMeta('name', 'twitter:title', safeTitle);
  replaceMeta('name', 'twitter:description', safeDesc);
  replaceMeta('name', 'twitter:image', safeImg);
  return out;
}

async function handleHtmlMetaRewrite(request, env, url) {
  const meta = await buildDynamicMeta(request, env, url);
  const assetRes = await env.ASSETS.fetch(request);
  if (!meta || !assetRes || !assetRes.ok) return assetRes;

  const ct = assetRes.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().includes('text/html')) return assetRes;

  if (typeof HTMLRewriter !== 'undefined') {
    const rewriter = new HTMLRewriter()
      .on('title', {
        element(el) {
          el.setInnerContent(meta.title);
        },
      })
      .on('meta[property="og:title"]', {
        element(el) {
          el.setAttribute('content', meta.title);
        },
      })
      .on('meta[property="og:description"]', {
        element(el) {
          el.setAttribute('content', meta.description);
        },
      })
      .on('meta[property="og:image"]', {
        element(el) {
          el.setAttribute('content', meta.ogImage);
        },
      })
      .on('meta[property="og:url"]', {
        element(el) {
          el.setAttribute('content', meta.ogUrl);
        },
      })
      .on('meta[name="twitter:title"]', {
        element(el) {
          el.setAttribute('content', meta.title);
        },
      })
      .on('meta[name="twitter:description"]', {
        element(el) {
          el.setAttribute('content', meta.description);
        },
      })
      .on('meta[name="twitter:image"]', {
        element(el) {
          el.setAttribute('content', meta.ogImage);
        },
      });
    return rewriter.transform(assetRes);
  }

  const html = await assetRes.text();
  const updated = rewriteHtmlMetaString(html, meta);
  const headers = new Headers(assetRes.headers);
  headers.delete('Content-Length');
  return new Response(updated, { status: assetRes.status, statusText: assetRes.statusText, headers });
}

async function readStats(db) {
  const { results } = await db
    .prepare("SELECT k, v FROM site_stats WHERE k IN ('views', 'visitors')")
    .all();
  const out = { views: 0, visitors: 0 };
  for (const row of results || []) {
    if (row.k === 'views') out.views = Number(row.v) || 0;
    if (row.k === 'visitors') out.visitors = Number(row.v) || 0;
  }
  return out;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function thaiTodayISO() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function checkAndIncrementAiQuota(db, limit) {
  if (!db) return { allowed: true, used: 0, limit };
  const day = thaiTodayISO();
  try {
    const row = await db
      .prepare('SELECT count FROM ai_quota_daily WHERE day = ?')
      .bind(day)
      .first();
    const used = Number(row && row.count) || 0;
    if (used >= limit) {
      return { allowed: false, used, limit };
    }
    await db
      .prepare(
        'INSERT INTO ai_quota_daily (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1'
      )
      .bind(day)
      .run();
    return { allowed: true, used: used + 1, limit };
  } catch {
    /* Graceful fallback if ai_quota_daily table is not yet migrated */
    return { allowed: true, used: 0, limit };
  }
}

function extractEmbeddingVector(embedRes) {
  if (!embedRes) return null;
  if (Array.isArray(embedRes.data) && Array.isArray(embedRes.data[0])) return embedRes.data[0];
  if (Array.isArray(embedRes) && Array.isArray(embedRes[0])) return embedRes[0];
  if (Array.isArray(embedRes.vector)) return embedRes.vector;
  return null;
}

function parseLlmJson(rawOutput) {
  if (rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
    if (typeof rawOutput.response === 'string') {
      return parseLlmJson(rawOutput.response);
    }
    if (rawOutput.response && typeof rawOutput.response === 'object') {
      return rawOutput.response;
    }
    if (typeof rawOutput.summary === 'string' || Array.isArray(rawOutput.stations)) {
      return rawOutput;
    }
  }
  const text = String(rawOutput || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function verifyAiRagResult(parsed, matches, stationsById) {
  /* Build allowed citations strictly from Vectorize matches */
  const allowedCitations = new Map();
  const allowedStationIds = new Set();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i] || {};
    const md = m.metadata || {};
    const docCode = String(md.doc_code || '').trim();
    const pageNum = Number(md.page_number);
    if (!docCode || !Number.isInteger(pageNum) || pageNum <= 0) continue;
    const docInfo = GAZETTE_DOC_MAP[docCode];
    const pdfUrl = docInfo ? docInfo.pdf_url : (typeof md.pdf_url === 'string' && md.pdf_url.startsWith('https://ratchakitcha.soc.go.th/') ? md.pdf_url : '');
    if (!pdfUrl) continue;
    const key = `${docCode}:${pageNum}`;
    if (!allowedCitations.has(key)) {
      allowedCitations.set(key, {
        doc_code: docCode,
        label: (docInfo && docInfo.label) || String(md.label || docCode),
        page_number: pageNum,
        pdf_url: pdfUrl,
      });
    }
    if (Array.isArray(md.station_ids)) {
      for (const sid of md.station_ids) {
        allowedStationIds.add(String(sid));
      }
    }
  }

  /* Strictly filter LLM citations against Vectorize matches */
  const verifiedCitations = [];
  const seenCite = new Set();
  const rawCites = Array.isArray(parsed && parsed.citations) ? parsed.citations : [];
  for (let i = 0; i < rawCites.length; i++) {
    const c = rawCites[i] || {};
    const docCode = String(c.doc_code || '').trim();
    const pageNum = Number(c.page_number);
    const key = `${docCode}:${pageNum}`;
    if (allowedCitations.has(key) && !seenCite.has(key)) {
      seenCite.add(key);
      verifiedCitations.push(allowedCitations.get(key));
    }
  }
  if (!verifiedCitations.length) {
    for (const cite of allowedCitations.values()) {
      verifiedCitations.push(cite);
      if (verifiedCitations.length >= 4) break;
    }
  }

  /* Strictly filter LLM stations against real data/stations.json (Zero Hallucination) */
  const verifiedStations = [];
  const seenStation = new Set();
  const rawStations = Array.isArray(parsed && parsed.stations) ? parsed.stations : [];
  for (let i = 0; i < rawStations.length; i++) {
    const item = rawStations[i];
    const rawId = item && typeof item === 'object' ? (item.id ?? item.station_id) : item;
    if (rawId === undefined || rawId === null) continue;
    const sid = String(rawId).trim();
    if (!sid || seenStation.has(sid)) continue;
    const real = stationsById.get(sid);
    if (!real) continue;
    seenStation.add(sid);
    verifiedStations.push({
      id: real.id,
      name: real.name,
      province_th: real.province_th,
      region: real.region,
      phone: real.phone || '',
      address: real.address || '',
      note: item && typeof item === 'object' && typeof item.note === 'string' ? item.note.trim().slice(0, 240) : '',
    });
  }

  /* Fallback: if LLM returned no valid station IDs, attach verified IDs extracted from matched chunks */
  if (!verifiedStations.length && allowedStationIds.size > 0) {
    for (const sid of allowedStationIds) {
      const real = stationsById.get(sid);
      if (!real) continue;
      verifiedStations.push({
        id: real.id,
        name: real.name,
        province_th: real.province_th,
        region: real.region,
        phone: real.phone || '',
        address: real.address || '',
        note: '',
      });
      if (verifiedStations.length >= 5) break;
    }
  }

  const boundaryExceptions = Array.isArray(parsed && parsed.boundary_exceptions)
    ? parsed.boundary_exceptions
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const neighbors = Array.isArray(parsed && parsed.neighbors)
    ? parsed.neighbors
        .map((x) => (typeof x === 'string' ? x.trim() : (x && x.name ? String(x.name).trim() : '')))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const summary = typeof (parsed && parsed.summary) === 'string' && parsed.summary.trim()
    ? parsed.summary.trim().slice(0, 1200)
    : 'พบข้อมูลที่เกี่ยวข้องในประกาศสำนักงานตำรวจแห่งชาติ (กรุณาตรวจสอบรายละเอียดจากหน้าราชกิจจานุเบกษาที่อ้างอิงด้านล่าง)';

  return {
    summary,
    stations: verifiedStations,
    boundary_exceptions: boundaryExceptions,
    neighbors,
    citations: verifiedCitations,
    legal_disclaimer: LEGAL_DISCLAIMER,
  };
}

async function handleAiSearch(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json', message: 'รูปแบบคำขอไม่ถูกต้อง' }, 400);
  }

  const query = String((body && body.query) || '').trim();
  if (query.length < 2 || query.length > 300) {
    return jsonResponse(
      { ok: false, error: 'invalid_query', message: 'กรุณาพิมพ์คำถามความยาว 2 ถึง 300 ตัวอักษร' },
      400
    );
  }

  if (!env.AI || !env.VECTORIZE) {
    return jsonResponse({
      ok: false,
      fallback: true,
      reason: 'ai_unconfigured',
      message: 'กำลังใช้โหมดค้นหาความเร็วสูงในเครื่อง',
    });
  }

  const dailyLimit = Number(env.AI_DAILY_LIMIT) || 250;
  const quota = await checkAndIncrementAiQuota(env.DB, dailyLimit);
  if (!quota.allowed) {
    return jsonResponse({
      ok: false,
      fallback: true,
      reason: 'quota_exceeded',
      message: 'โควตาผู้ช่วย AI รายวันเต็มแล้ว ระบบสลับไปใช้การค้นหาในเครื่องให้อัตโนมัติ',
    });
  }

  try {
    const embedRes = await env.AI.run('@cf/baai/bge-m3', { text: [query] });
    const vector = extractEmbeddingVector(embedRes);
    if (!vector || !vector.length) {
      return jsonResponse({
        ok: false,
        fallback: true,
        reason: 'ai_error',
        message: 'ไม่สามารถสร้างเวกเตอร์ค้นหาได้ ระบบสลับไปใช้การค้นหาในเครื่องให้อัตโนมัติ',
      });
    }

    const vecRes = await env.VECTORIZE.query(vector, { topK: 6, returnMetadata: 'all' });
    const matches = Array.isArray(vecRes && vecRes.matches) ? vecRes.matches : [];
    if (!matches.length) {
      return jsonResponse({
        ok: false,
        fallback: true,
        reason: 'no_context',
        message: 'ไม่พบข้อความอ้างอิงที่ตรงกันในราชกิจจานุเบกษา ระบบสลับไปใช้การค้นหาในเครื่องให้อัตโนมัติ',
      });
    }

    const contextBlocks = matches
      .map((m, idx) => {
        const md = m.metadata || {};
        const docCode = md.doc_code || '2567';
        const pageNum = md.page_number || '?';
        const stIds = Array.isArray(md.station_ids) && md.station_ids.length ? ` | station_ids: ${md.station_ids.join(',')}` : '';
        const txt = String(md.text || '').slice(0, 1100);
        return `[บริบท ${idx + 1} | doc_code: ${docCode} | page_number: ${pageNum}${stIds}]\n${txt}`;
      })
      .join('\n\n');

    const systemPrompt =
      'คุณคือผู้ช่วยตรวจสอบเขตอำนาจสอบสวนของระบบ PS Locator ตอบเป็นภาษาไทยเท่านั้น และตอบเป็น JSON วัตถุเดียวโดยเคร่งครัด ' +
      'ห้ามเดาหรือแต่งเติมข้อมูลที่ไม่มีอยู่ในบริบทที่ให้มาเด็ดขาด ' +
      'โครงสร้าง JSON ต้องประกอบด้วยคีย์: ' +
      '{"summary": string, "stations": [{"id": string, "note": string}], "boundary_exceptions": [string], "neighbors": [string], "citations": [{"doc_code": string, "page_number": number}]} ' +
      'โดย stations.id ต้องใช้เฉพาะรหัสที่มีในบริบท และ citations ต้องอ้าง doc_code กับ page_number ที่มีในบริบทเท่านั้น หากมีคำว่าบางส่วน/เฉพาะหมู่ที่/แนวเขต ให้ระบุใน boundary_exceptions';

    const userPrompt = `คำถาม: ${query}\n\nข้อความอ้างอิงจากราชกิจจานุเบกษา:\n${contextBlocks}\n\nโปรดตอบเป็น JSON เท่านั้น:`;

    const llmRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 650,
      temperature: 0.1,
    });

    const parsed = parseLlmJson(llmRes);
    if (!parsed) {
      return jsonResponse({
        ok: false,
        fallback: true,
        reason: 'ai_error',
        message: 'คำตอบจาก AI ไม่อยู่ในรูปแบบที่ตรวจสอบได้ ระบบสลับไปใช้การค้นหาในเครื่องให้อัตโนมัติ',
      });
    }

    const { byId } = await getStations(env, request.url);
    const verified = verifyAiRagResult(parsed, matches, byId);

    return jsonResponse({
      ok: true,
      mode: 'edge_ai_rag',
      query,
      ...verified,
    });
  } catch {
    return jsonResponse({
      ok: false,
      fallback: true,
      reason: 'ai_error',
      message: 'ผู้ช่วย AI ไม่สามารถให้บริการได้ชั่วคราว ระบบสลับไปใช้การค้นหาในเครื่องให้อัตโนมัติ',
    });
  }
}

async function handleCorrectionReport(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json', message: 'รูปแบบคำขอไม่ถูกต้อง' }, 400);
  }

  /* Honeypot anti-bot check */
  const hp = String((body && body.website_hp) || '').trim();
  if (hp) {
    return jsonResponse({ ok: false, error: 'invalid_submission', message: 'ไม่สามารถส่งคำแจ้งนี้ได้' }, 400);
  }

  const stationId = String((body && body.station_id) ?? '').trim();
  const fieldType = String((body && body.field_type) || '').trim();
  const suggestedValue = String((body && body.suggested_value) || '').trim();
  const sourceRef = String((body && body.source_ref) || '').trim().slice(0, 300);
  const reporter = String((body && body.reporter) || '').trim().slice(0, 120);

  if (!ALLOWED_REPORT_FIELDS.has(fieldType)) {
    return jsonResponse({ ok: false, error: 'invalid_field_type', message: 'ประเภทข้อมูลที่แจ้งไม่ถูกต้อง' }, 400);
  }

  if (suggestedValue.length < 2 || suggestedValue.length > 500) {
    return jsonResponse(
      { ok: false, error: 'invalid_suggested_value', message: 'กรุณากรอกข้อมูลที่ถูกต้องความยาว 2 ถึง 500 ตัวอักษร' },
      400
    );
  }

  const { byId } = await getStations(env, request.url);
  const st = stationId ? byId.get(stationId) : null;
  if (!st) {
    return jsonResponse({ ok: false, error: 'invalid_station_id', message: 'ไม่พบรหัสสถานีตำรวจในฐานข้อมูล' }, 400);
  }

  const currentValue = fieldType === 'other' ? '' : String(st[fieldType] || '');
  if (!env.DB) {
    return jsonResponse({
      ok: false,
      fallback: 'mailto',
      message: 'ระบบรับแจ้งออนไลน์ยังไม่พร้อมใช้งาน กรุณาส่งอีเมลแจ้งผู้ดูแลแทน',
    });
  }

  try {
    const createdAt = new Date().toISOString();
    await env.DB
      .prepare(
        'INSERT INTO correction_reports (station_id, station_name, field_type, current_value, suggested_value, source_ref, reporter, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        String(st.id),
        String(st.name || ''),
        fieldType,
        currentValue,
        suggestedValue,
        sourceRef,
        reporter,
        'pending',
        createdAt
      )
      .run();

    return jsonResponse(
      {
        ok: true,
        status: 'pending',
        station_id: String(st.id),
        station_name: st.name,
        message: 'ได้รับข้อมูลแจ้งแก้ไขแล้ว รายการจะเข้าคิวรอผู้ดูแลตรวจสอบก่อนปรับปรุงฐานข้อมูล',
      },
      201
    );
  } catch {
    return jsonResponse({
      ok: false,
      fallback: 'mailto',
      message: 'ไม่สามารถบันทึกลงระบบคิวออนไลน์ได้ในขณะนี้ กรุณาส่งอีเมลแจ้งผู้ดูแลแทน',
    });
  }
}

function safeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function sanitizeWebsiteUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '-' || s === 'ไม่มีข้อมูล') return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+(?:\/[^\s"'<>]*)?$/i.test(s)) {
    return 'https://' + s;
  }
  return '';
}

function phoneTelHref(raw) {
  const first = String(raw || '').split(/[,/]|หรือ/)[0] || '';
  const digits = first.replace(/[^0-9+]/g, '');
  return digits.length >= 4 ? `tel:${digits}` : '';
}

const SSR_STYLES = `
:root{--bg:#05070c;--surface:#0c1220;--surface2:#111a2e;--border:rgba(148,163,184,.2);--text:#f1f5f9;--muted:#94a3b8;--accent:#38bdf8;--accent-bg:rgba(56,189,248,.12);--crimson:#9f2a24;--gold:#d4af37;--warn-bg:rgba(245,158,11,.12);--warn-border:rgba(245,158,11,.42);--warn-text:#fcd34d}
html[data-theme="light"]{--bg:#f7f9fc;--surface:#ffffff;--surface2:#f1f5f9;--border:rgba(15,23,42,.12);--text:#0f172a;--muted:#475569;--accent:#0369a1;--accent-bg:rgba(3,105,161,.08);--crimson:#7e1f1a;--gold:#9a7411;--warn-bg:#fffbeb;--warn-border:#f59e0b;--warn-text:#92400e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Sarabun',system-ui,-apple-system,sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.ssr-head{position:sticky;top:0;z-index:20;background:var(--surface);border-bottom:1px solid var(--border);backdrop-filter:blur(10px)}
.ssr-head-in{max-width:1040px;margin:0 auto;padding:12px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ssr-brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.08em;color:var(--text);text-decoration:none;font-size:.95rem}
.ssr-nav{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ssr-nav a,.ssr-theme-btn{padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.9rem;font-family:inherit;cursor:pointer;text-decoration:none}
.ssr-nav a[aria-current="page"]{border-color:var(--accent);background:var(--accent-bg);color:var(--accent);font-weight:600}
.ssr-wrap{max-width:1040px;margin:0 auto;padding:24px 18px 48px}
.ssr-bc{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:.9rem;color:var(--muted);margin:0 0 18px;padding:0;list-style:none}
.ssr-bc li::after{content:'/';margin-left:6px;opacity:.5}
.ssr-bc li:last-child::after{content:'';margin:0}
.ssr-bc li:last-child{color:var(--text);font-weight:600}
.ssr-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;margin-bottom:20px}
.ssr-kicker{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--accent-bg);border:1px solid var(--border);color:var(--accent);font-size:.82rem;font-weight:600;margin-bottom:8px}
h1{margin:0 0 8px;font-family:'Noto Serif Thai','Sarabun',serif;font-size:clamp(1.45rem,3vw,2.05rem);line-height:1.3}
h2{margin:0 0 12px;font-family:'Noto Serif Thai','Sarabun',serif;font-size:1.2rem}
.ssr-sub{margin:0;color:var(--muted);font-size:1rem}
.ssr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
.ssr-cell{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.ssr-cell.full{grid-column:1/-1}
.ssr-cell label{display:block;font-size:.82rem;color:var(--muted);margin-bottom:4px}
.ssr-cell .val{font-size:1.05rem;font-weight:600;word-break:break-word}
.ssr-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.ssr-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-weight:600;font-size:.95rem;text-decoration:none}
.ssr-btn.primary{background:var(--accent);border-color:var(--accent);color:#04101b}
html[data-theme="light"] .ssr-btn.primary{color:#ffffff}
.ssr-btn:hover{filter:brightness(1.06);text-decoration:none}
.ssr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;padding:0;margin:0;list-style:none}
.ssr-list a{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 13px;border-radius:10px;background:var(--surface2);border:1px solid var(--border);color:var(--text);text-decoration:none}
.ssr-list a:hover{border-color:var(--accent)}
.ssr-badge{font-size:.82rem;color:var(--muted);white-space:nowrap}
.ssr-table-wrap{overflow-x:auto}
table.ssr-table{width:100%;border-collapse:collapse;font-size:.95rem}
.ssr-table th,.ssr-table td{padding:11px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
.ssr-table th{color:var(--muted);font-weight:600;font-size:.86rem;white-space:nowrap}
.ssr-warn{background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);border-radius:12px;padding:13px 16px;font-size:.92rem;margin-top:20px}
.ssr-foot{border-top:1px solid var(--border);padding:20px 18px;text-align:center;color:var(--muted);font-size:.88rem}
.ssr-foot-links{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:8px}
@media (max-width:680px){.ssr-grid{grid-template-columns:1fr}}
`;

function renderSsrLayout({
  title,
  description,
  canonical,
  ogImage,
  jsonLd,
  robots = 'index, follow, max-snippet:-1, max-image-preview:large',
  currentNav = '',
  bodyHtml,
}) {
  const safeTitle = escapeXml(title);
  const safeDesc = escapeXml(description);
  const safeCanonical = escapeXml(canonical);
  const safeOgImage = escapeXml(ogImage || `${SITE_ORIGIN}/assets/ps-locator-poster.png`);
  const safeRobots = escapeXml(robots);
  const jsonLdScript = jsonLd
    ? `<script type="application/ld+json">${safeJsonLd(jsonLd)}</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#05070c">
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">
<meta name="robots" content="${safeRobots}">
<link rel="canonical" href="${safeCanonical}">
<link rel="alternate" hreflang="th" href="${safeCanonical}">
<link rel="alternate" hreflang="x-default" href="${safeCanonical}">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&family=Noto+Serif+Thai:wght@600;700&display=swap" rel="stylesheet">
<script>
(function(){var t='dark';try{t=localStorage.getItem('ps:theme')||'dark';}catch(e){}document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==='dark'?'#05070c':'#f7f9fc';})();
</script>
<meta property="og:type" content="website">
<meta property="og:locale" content="th_TH">
<meta property="og:site_name" content="PS Locator">
<meta property="og:url" content="${safeCanonical}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:image" content="${safeOgImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${safeOgImage}">
${jsonLdScript}
<style>${SSR_STYLES}</style>
</head>
<body>
<header class="ssr-head">
  <div class="ssr-head-in">
    <a class="ssr-brand" href="/">
      <img src="/assets/favicon.svg" width="24" height="24" alt="" aria-hidden="true">
      <span>PS LOCATOR</span>
    </a>
    <nav class="ssr-nav" aria-label="เมนูหลัก">
      <a href="/"${currentNav === 'home' ? ' aria-current="page"' : ''}>สารบบสถานี</a>
      <a href="/provinces"${currentNav === 'provinces' ? ' aria-current="page"' : ''}>77 จังหวัด</a>
      <a href="/jurisdiction"${currentNav === 'jurisdiction' ? ' aria-current="page"' : ''}>เขตอำนาจ</a>
      <a href="/map"${currentNav === 'map' ? ' aria-current="page"' : ''}>แผนที่</a>
      <button type="button" id="ssrThemeBtn" class="ssr-theme-btn" aria-label="สลับโหมดสีหน้าจอ">สลับธีม</button>
    </nav>
  </div>
</header>
<main class="ssr-wrap">
${bodyHtml}
</main>
<footer class="ssr-foot">
  <div>PS Locator — สารบบสถานีตำรวจทั่วประเทศ 1,484 แห่ง ครบ 77 จังหวัด · ข้อมูลอ้างอิงจากสำนักงานตำรวจแห่งชาติ</div>
  <div class="ssr-foot-links">
    <a href="/">หน้าหลักค้นหาสถานี</a>
    <a href="/provinces">สารบบ 77 จังหวัด</a>
    <a href="/jurisdiction">ตรวจเขตอำนาจสอบสวน</a>
    <a href="/map">แผนที่ สภ.ใกล้ฉัน</a>
    <a href="/sitemap.xml">Sitemap</a>
  </div>
</footer>
<script>
(function(){var b=document.getElementById('ssrThemeBtn');if(!b)return;b.addEventListener('click',function(){var cur=document.documentElement.dataset.theme==='light'?'light':'dark';var next=cur==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('ps:theme',next);}catch(e){}var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=next==='dark'?'#05070c':'#f7f9fc';});})();
</script>
</body>
</html>`;
}

function htmlResponse(html, method, status = 200, cacheControl = SSR_CACHE_CONTROL) {
  return new Response(method === 'HEAD' ? null : html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': status === 200 ? cacheControl : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function xmlResponse(xml, method) {
  return new Response(method === 'HEAD' ? null : xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': SITEMAP_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function renderNotFoundPage(method, heading, detail) {
  const html = renderSsrLayout({
    title: `${heading} | PS Locator`,
    description: detail,
    canonical: `${SITE_ORIGIN}/`,
    robots: 'noindex, follow',
    bodyHtml: `
  <section class="ssr-card">
    <span class="ssr-kicker">404 · ไม่พบหน้านี้</span>
    <h1>${escapeXml(heading)}</h1>
    <p class="ssr-sub">${escapeXml(detail)}</p>
    <div class="ssr-actions">
      <a class="ssr-btn primary" href="/">กลับหน้าหลักค้นหาสถานี</a>
      <a class="ssr-btn" href="/provinces">ดูสารบบ 77 จังหวัด</a>
      <a class="ssr-btn" href="/jurisdiction">ตรวจเขตอำนาจสอบสวน</a>
    </div>
  </section>`,
  });
  return htmlResponse(html, method, 404);
}

async function handleStationPage(request, env, rawId) {
  const id = String(rawId || '').trim();
  const { byId, byProvince } = await getStations(env, request.url);
  const st = id ? byId.get(id) : null;
  if (!st) {
    return renderNotFoundPage(
      request.method,
      'ไม่พบข้อมูลสถานีตำรวจที่ระบุ',
      'ไม่พบรหัสสถานีตำรวจนี้ในฐานข้อมูล 1,484 แห่งของ PS Locator กรุณาค้นหาใหม่จากหน้าหลักหรือเลือกจากสารบบ 77 จังหวัด'
    );
  }

  const prov = String(st.province_th || '').trim();
  const regionShort = REGION_SHORT[st.region] || '';
  const regionFull = REGION_NAME[st.region] || regionShort || 'สำนักงานตำรวจแห่งชาติ';
  const addrRaw = String(st.address || '').trim();
  const phoneRaw = String(st.phone || '').trim();
  const faxRaw = String(st.fax || '').trim();
  const websiteSafe = sanitizeWebsiteUrl(st.website);

  const addrDisplay = addrRaw || 'ไม่มีข้อมูล';
  const phoneDisplay = phoneRaw ? formatPhone(phoneRaw) : 'ไม่มีข้อมูล';
  const faxDisplay = faxRaw ? formatPhone(faxRaw) : 'ไม่มีข้อมูล';
  const telHref = phoneRaw ? phoneTelHref(phoneRaw) : '';

  const canonical = `${SITE_ORIGIN}/station/${encodeURIComponent(st.id)}`;
  const provinceUrl = `${SITE_ORIGIN}/province/${encodeURIComponent(prov)}`;
  const ogImage = `${SITE_ORIGIN}/og?id=${encodeURIComponent(st.id)}`;

  const title = `ที่อยู่ เบอร์โทร ${st.name} (${prov}) | PS Locator`;
  const description = `${st.name} จังหวัด${prov} สังกัด${regionFull} · ที่อยู่: ${addrDisplay} · โทรศัพท์: ${phoneDisplay} · พร้อมนำทาง Google Maps และพิมพ์แนบเอกสารคดี A4`;

  /* Zero Hallucination JSON-LD: omit empty fields strictly */
  const postalAddress = {
    '@type': 'PostalAddress',
    addressRegion: prov,
    addressCountry: 'TH',
  };
  if (addrRaw) postalAddress.streetAddress = addrRaw;

  const policeNode = {
    '@type': ['PoliceStation', 'GovernmentOffice'],
    '@id': canonical,
    name: st.name,
    address: postalAddress,
    areaServed: prov,
  };
  if (phoneRaw) policeNode.telephone = phoneDisplay;
  if (faxRaw) policeNode.faxNumber = faxDisplay;
  if (websiteSafe) policeNode.url = websiteSafe;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      policeNode,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'สารบบสถานีตำรวจ', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: '77 จังหวัด', item: `${SITE_ORIGIN}/provinces` },
          { '@type': 'ListItem', position: 3, name: `จังหวัด${prov}`, item: provinceUrl },
          { '@type': 'ListItem', position: 4, name: st.name, item: canonical },
        ],
      },
    ],
  };

  const sameProvince = (byProvince.get(prov) || [])
    .filter((s) => String(s.id) !== String(st.id))
    .slice(0, 12);

  const relatedHtml = sameProvince.length
    ? `<section class="ssr-card">
    <h2>สถานีตำรวจอื่นในจังหวัด${escapeXml(prov)}</h2>
    <ul class="ssr-list">
      ${sameProvince
        .map(
          (s) =>
            `<li><a href="/station/${encodeURIComponent(s.id)}"><span>${escapeXml(s.name)}</span><span class="ssr-badge">${escapeXml(s.phone ? formatPhone(s.phone) : 'ดูข้อมูล')}</span></a></li>`
        )
        .join('\n      ')}
    </ul>
    <div class="ssr-actions">
      <a class="ssr-btn" href="/province/${encodeURIComponent(prov)}">ดูครบทุกสถานีในจังหวัด${escapeXml(prov)}</a>
      <a class="ssr-btn" href="/provinces">ดูสารบบ 77 จังหวัด</a>
    </div>
  </section>`
    : '';

  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${st.name} ${prov}`)}`;
  const phoneHtml = telHref
    ? `<a href="${escapeXml(telHref)}">${escapeXml(phoneDisplay)}</a>`
    : escapeXml(phoneDisplay);
  const websiteHtml = websiteSafe
    ? `<a href="${escapeXml(websiteSafe)}" target="_blank" rel="noopener nofollow">${escapeXml(websiteSafe)}</a>`
    : 'ไม่มีข้อมูล';

  const bodyHtml = `
  <nav aria-label="เส้นทางหน้า">
    <ol class="ssr-bc">
      <li><a href="/">สารบบสถานีตำรวจ</a></li>
      <li><a href="/provinces">77 จังหวัด</a></li>
      <li><a href="/province/${encodeURIComponent(prov)}">จังหวัด${escapeXml(prov)}</a></li>
      <li aria-current="page">${escapeXml(st.name)}</li>
    </ol>
  </nav>

  <article class="ssr-card">
    <span class="ssr-kicker">${escapeXml(regionShort ? `${regionShort} · ${regionFull}` : regionFull)}</span>
    <h1>${escapeXml(st.name)}</h1>
    <p class="ssr-sub">จังหวัด${escapeXml(prov)} · สารบบสถานีตำรวจทั่วประเทศ สำนักงานตำรวจแห่งชาติ</p>

    <div class="ssr-grid">
      <div class="ssr-cell full">
        <label>ที่อยู่สถานี</label>
        <div class="val">${escapeXml(addrDisplay)}</div>
      </div>
      <div class="ssr-cell">
        <label>หมายเลขโทรศัพท์</label>
        <div class="val">${phoneHtml}</div>
      </div>
      <div class="ssr-cell">
        <label>โทรสาร (แฟกซ์)</label>
        <div class="val">${escapeXml(faxDisplay)}</div>
      </div>
      <div class="ssr-cell">
        <label>จังหวัด</label>
        <div class="val"><a href="/province/${encodeURIComponent(prov)}">จังหวัด${escapeXml(prov)}</a></div>
      </div>
      <div class="ssr-cell">
        <label>กองบัญชาการ</label>
        <div class="val">${escapeXml(regionFull)}</div>
      </div>
      <div class="ssr-cell full">
        <label>เว็บไซต์ทางการ</label>
        <div class="val">${websiteHtml}</div>
      </div>
    </div>

    <div class="ssr-actions">
      <a class="ssr-btn primary" href="/?id=${encodeURIComponent(st.id)}">เปิดในแอปหลัก / พิมพ์ A4</a>
      <a class="ssr-btn" href="${escapeXml(gmapsUrl)}" target="_blank" rel="noopener">นำทาง Google Maps</a>
      <a class="ssr-btn" href="/jurisdiction?j=${encodeURIComponent(st.name)}">ตรวจเขตอำนาจสอบสวน</a>
      <a class="ssr-btn" href="/map?q=${encodeURIComponent(`${st.name} ${prov}`)}">ค้นหาบนแผนที่</a>
    </div>

    <div class="ssr-warn" role="note">
      <strong>คำเตือนทางกฎหมาย:</strong> ข้อมูลนี้รวบรวมจากฐานข้อมูลสาธารณะของสำนักงานตำรวจแห่งชาติ เพื่ออำนวยความสะดวกในการค้นหาเบื้องต้น โปรดยืนยันที่อยู่ เบอร์โทรศัพท์ และเขตอำนาจสอบสวนกับสถานีตำรวจต้นทางก่อนดำเนินการทางกฎหมายหรือส่งเอกสารทางคดี
    </div>
  </article>

  ${relatedHtml}`;

  const html = renderSsrLayout({
    title,
    description,
    canonical,
    ogImage,
    jsonLd,
    bodyHtml,
  });
  return htmlResponse(html, request.method, 200);
}

async function handleProvincePage(request, env, rawProv) {
  let prov;
  try {
    prov = decodeURIComponent(String(rawProv || '')).trim();
  } catch {
    return renderNotFoundPage(
      request.method,
      'รูปแบบชื่อจังหวัดไม่ถูกต้อง',
      'ไม่สามารถอ่านชื่อจังหวัดจาก URL ได้ กรุณาเลือกจังหวัดจากหน้าสารบบ 77 จังหวัด'
    );
  }

  const { byProvince, provincesByRegion } = await getStations(env, request.url);
  const list = prov ? byProvince.get(prov) : null;
  if (!list || !list.length) {
    return renderNotFoundPage(
      request.method,
      'ไม่พบข้อมูลจังหวัดที่ระบุ',
      'ไม่พบรายชื่อจังหวัดนี้ในสารบบสถานีตำรวจ 77 จังหวัด กรุณาเลือกจังหวัดจากรายการด้านล่าง'
    );
  }

  const regionCode = list[0].region || '';
  const regionFull = REGION_NAME[regionCode] || REGION_SHORT[regionCode] || 'สำนักงานตำรวจแห่งชาติ';
  const canonical = `${SITE_ORIGIN}/province/${encodeURIComponent(prov)}`;
  const title = `สถานีตำรวจจังหวัด${prov} (${list.length} แห่ง) — ที่อยู่ เบอร์โทร สภ./สน. | PS Locator`;
  const description = `รวมรายชื่อสถานีตำรวจในจังหวัด${prov} ครบ ${list.length} แห่ง สังกัด${regionFull} พร้อมที่อยู่ เบอร์โทรศัพท์ โทรสาร แผนที่นำทาง และตรวจเขตอำนาจสอบสวน`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        url: canonical,
        name: title,
        inLanguage: 'th',
        description,
      },
      {
        '@type': 'ItemList',
        name: `รายชื่อสถานีตำรวจจังหวัด${prov}`,
        numberOfItems: list.length,
        itemListElement: list.map((st, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: st.name,
          url: `${SITE_ORIGIN}/station/${encodeURIComponent(st.id)}`,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'สารบบสถานีตำรวจ', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: '77 จังหวัด', item: `${SITE_ORIGIN}/provinces` },
          { '@type': 'ListItem', position: 3, name: `จังหวัด${prov}`, item: canonical },
        ],
      },
    ],
  };

  const rowsHtml = list
    .map((st, idx) => {
      const addr = String(st.address || '').trim() || 'ไม่มีข้อมูล';
      const phoneRaw = String(st.phone || '').trim();
      const phoneDisplay = phoneRaw ? formatPhone(phoneRaw) : 'ไม่มีข้อมูล';
      const telHref = phoneRaw ? phoneTelHref(phoneRaw) : '';
      const phoneCell = telHref
        ? `<a href="${escapeXml(telHref)}">${escapeXml(phoneDisplay)}</a>`
        : escapeXml(phoneDisplay);
      return `<tr>
        <td>${idx + 1}</td>
        <td><a href="/station/${encodeURIComponent(st.id)}"><strong>${escapeXml(st.name)}</strong></a></td>
        <td>${escapeXml(addr)}</td>
        <td style="white-space:nowrap">${phoneCell}</td>
      </tr>`;
    })
    .join('\n      ');

  const siblingProvinces = (provincesByRegion.get(regionCode) || []).filter((p) => p.province !== prov);
  const siblingsHtml = siblingProvinces.length
    ? `<section class="ssr-card">
    <h2>จังหวัดอื่นในสังกัด${escapeXml(regionFull)}</h2>
    <ul class="ssr-list">
      ${siblingProvinces
        .map(
          (p) =>
            `<li><a href="/province/${encodeURIComponent(p.province)}"><span>จังหวัด${escapeXml(p.province)}</span><span class="ssr-badge">${p.count} แห่ง</span></a></li>`
        )
        .join('\n      ')}
    </ul>
  </section>`
    : '';

  const bodyHtml = `
  <nav aria-label="เส้นทางหน้า">
    <ol class="ssr-bc">
      <li><a href="/">สารบบสถานีตำรวจ</a></li>
      <li><a href="/provinces">77 จังหวัด</a></li>
      <li aria-current="page">จังหวัด${escapeXml(prov)}</li>
    </ol>
  </nav>

  <section class="ssr-card">
    <span class="ssr-kicker">${escapeXml(regionFull)}</span>
    <h1>สถานีตำรวจจังหวัด${escapeXml(prov)} (${list.length} แห่ง)</h1>
    <p class="ssr-sub">รายชื่อ ที่อยู่ และเบอร์โทรศัพท์ สภ./สน. ครบทุกแห่งในจังหวัด${escapeXml(prov)} คลิกชื่อสถานีเพื่อดูรายละเอียด แผนที่ และพิมพ์เอกสาร A4</p>
    <div class="ssr-actions">
      <a class="ssr-btn primary" href="/?province=${encodeURIComponent(prov)}">เปิดกรองจังหวัด${escapeXml(prov)}ในแอปหลัก</a>
      <a class="ssr-btn" href="/jurisdiction?j=${encodeURIComponent(prov)}">ตรวจเขตอำนาจจังหวัด${escapeXml(prov)}</a>
      <a class="ssr-btn" href="/provinces">ดูครบ 77 จังหวัด</a>
    </div>
  </section>

  <section class="ssr-card">
    <h2>บัญชีรายชื่อสถานีตำรวจจังหวัด${escapeXml(prov)}</h2>
    <div class="ssr-table-wrap">
      <table class="ssr-table">
        <thead>
          <tr>
            <th>#</th>
            <th>ชื่อสถานีตำรวจ</th>
            <th>ที่อยู่</th>
            <th>โทรศัพท์</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  </section>

  ${siblingsHtml}`;

  const html = renderSsrLayout({
    title,
    description,
    canonical,
    jsonLd,
    bodyHtml,
  });
  return htmlResponse(html, request.method, 200);
}

async function handleProvincesPage(request, env) {
  const { list, byProvince, provincesByRegion } = await getStations(env, request.url);
  const canonical = `${SITE_ORIGIN}/provinces`;
  const title = `สารบบสถานีตำรวจ 77 จังหวัด (${list.length.toLocaleString('th-TH')} แห่ง) | PS Locator`;
  const description = `รวมรายชื่อสถานีตำรวจทั่วประเทศไทยครบทั้ง 77 จังหวัด ${list.length} แห่ง จัดกลุ่มตาม 10 กองบัญชาการ (บช.น. และ ภ.1–ภ.9) พร้อมที่อยู่และเบอร์โทรศัพท์`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        url: canonical,
        name: title,
        inLanguage: 'th',
        description,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'สารบบสถานีตำรวจ', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'สารบบ 77 จังหวัด', item: canonical },
        ],
      },
    ],
  };

  const sectionsHtml = REGION_ORDER.map((reg) => {
    const provs = provincesByRegion.get(reg) || [];
    if (!provs.length) return '';
    const regTotal = provs.reduce((sum, p) => sum + p.count, 0);
    const items = provs
      .map(
        (p) =>
          `<li><a href="/province/${encodeURIComponent(p.province)}"><span>${escapeXml(p.province)}</span><span class="ssr-badge">${p.count} สถานี</span></a></li>`
      )
      .join('\n      ');
    return `<section class="ssr-card">
    <h2>${escapeXml(REGION_NAME[reg] || reg)} (${escapeXml(REGION_SHORT[reg] || reg)}) · ${provs.length} จังหวัด · ${regTotal} แห่ง</h2>
    <ul class="ssr-list">
      ${items}
    </ul>
  </section>`;
  })
    .filter(Boolean)
    .join('\n  ');

  const bodyHtml = `
  <nav aria-label="เส้นทางหน้า">
    <ol class="ssr-bc">
      <li><a href="/">สารบบสถานีตำรวจ</a></li>
      <li aria-current="page">สารบบ 77 จังหวัด</li>
    </ol>
  </nav>

  <section class="ssr-card">
    <span class="ssr-kicker">HTML Sitemap · 10 กองบัญชาการ</span>
    <h1>สารบบสถานีตำรวจครบ 77 จังหวัด (${list.length.toLocaleString('th-TH')} แห่ง)</h1>
    <p class="ssr-sub">เลือกจังหวัดเพื่อดูรายชื่อ ที่อยู่ และเบอร์โทรศัพท์ของ สภ./สน. ครบทั้ง ${byProvince.size} จังหวัดทั่วประเทศไทย</p>
    <div class="ssr-actions">
      <a class="ssr-btn primary" href="/">ค้นหาสถานีแบบรวดเร็ว</a>
      <a class="ssr-btn" href="/jurisdiction">ตรวจเขตอำนาจจากชื่อตำบล</a>
      <a class="ssr-btn" href="/map">ค้นหา สภ.ใกล้ฉันบนแผนที่</a>
    </div>
  </section>

  ${sectionsHtml}`;

  const html = renderSsrLayout({
    title,
    description,
    canonical,
    jsonLd,
    currentNav: 'provinces',
    bodyHtml,
  });
  return htmlResponse(html, request.method, 200);
}

function handleSitemapIndex(request) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE_ORIGIN}/sitemap-core.xml</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_ORIGIN}/sitemap-provinces.xml</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_ORIGIN}/sitemap-stations.xml</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </sitemap>
</sitemapindex>`;
  return xmlResponse(xml, request.method);
}

function handleSitemapCore(request) {
  const entries = [
    { loc: `${SITE_ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE_ORIGIN}/jurisdiction`, changefreq: 'monthly', priority: '0.9' },
    { loc: `${SITE_ORIGIN}/map`, changefreq: 'monthly', priority: '0.9' },
    { loc: `${SITE_ORIGIN}/provinces`, changefreq: 'monthly', priority: '0.9' },
    { loc: `${SITE_ORIGIN}/qr-poster.html`, changefreq: 'monthly', priority: '0.5' },
  ];
  const body = entries
    .map(
      (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
  return xmlResponse(xml, request.method);
}

async function handleSitemapProvinces(request, env) {
  const { byProvince } = await getStations(env, request.url);
  const provinces = Array.from(byProvince.keys()).sort((a, b) => a.localeCompare(b, 'th'));
  const body = provinces
    .map(
      (prov) => `  <url>
    <loc>${escapeXml(`${SITE_ORIGIN}/province/${encodeURIComponent(prov)}`)}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
  return xmlResponse(xml, request.method);
}

async function handleSitemapStations(request, env) {
  const { list } = await getStations(env, request.url);
  const body = list
    .map(
      (st) => `  <url>
    <loc>${escapeXml(`${SITE_ORIGIN}/station/${encodeURIComponent(st.id)}`)}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
  return xmlResponse(xml, request.method);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/visit') {
      const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      if (request.method === 'POST') {
        const ua = request.headers.get('User-Agent') || '';
        const isBot = BOT_RE.test(ua);
        const cookie = request.headers.get('Cookie') || '';
        const hasVisitorCookie = /(?:^|;\s*)ps_v=1(?:;|$)/.test(cookie);

        if (!isBot) {
          const stmts = [
            env.DB.prepare(
              "INSERT INTO site_stats (k, v) VALUES ('views', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1"
            )
          ];
          if (!hasVisitorCookie) {
            stmts.push(
              env.DB.prepare(
                "INSERT INTO site_stats (k, v) VALUES ('visitors', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1"
              )
            );
            headers.append(
              'Set-Cookie',
              'ps_v=1; Path=/; Max-Age=86400; SameSite=Lax; Secure; HttpOnly'
            );
          }
          await env.DB.batch(stmts);
        }
        const stats = await readStats(env.DB);
        return new Response(JSON.stringify(stats), { status: 200, headers });
      }

      if (request.method === 'GET') {
        const stats = await readStats(env.DB);
        return new Response(JSON.stringify(stats), { status: 200, headers });
      }

      return new Response('Method Not Allowed', { status: 405, headers });
    }

    if (url.pathname === '/api/ai-search') {
      return handleAiSearch(request, env);
    }

    if (url.pathname === '/api/report') {
      return handleCorrectionReport(request, env);
    }

    if (url.pathname === '/og') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return handleOgRequest(request, env, url);
    }

    if (
      url.pathname === '/sitemap.xml' ||
      url.pathname === '/sitemap-core.xml' ||
      url.pathname === '/sitemap-provinces.xml' ||
      url.pathname === '/sitemap-stations.xml'
    ) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      if (url.pathname === '/sitemap.xml') return handleSitemapIndex(request);
      if (url.pathname === '/sitemap-core.xml') return handleSitemapCore(request);
      if (url.pathname === '/sitemap-provinces.xml') return handleSitemapProvinces(request, env);
      return handleSitemapStations(request, env);
    }

    if (url.pathname === '/provinces' || url.pathname === '/provinces/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return handleProvincesPage(request, env);
    }

    if (url.pathname.startsWith('/province/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const rawProv = url.pathname.slice('/province/'.length).replace(/\/+$/, '');
      return handleProvincePage(request, env, rawProv);
    }

    if (url.pathname.startsWith('/station/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const rawId = url.pathname.slice('/station/'.length).replace(/\/+$/, '');
      return handleStationPage(request, env, rawId);
    }

    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      HTML_META_PATHS.has(url.pathname) &&
      (url.searchParams.has('id') || url.searchParams.has('q') || url.searchParams.has('j'))
    ) {
      return handleHtmlMetaRewrite(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};
