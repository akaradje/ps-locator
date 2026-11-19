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

let cachedStations = null;
let cachedStationsById = null;

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
  if (cachedStations && cachedStationsById) {
    return { list: cachedStations, byId: cachedStationsById };
  }
  try {
    const assetUrl = new URL('/data/stations.json', requestUrl);
    const res = await env.ASSETS.fetch(new Request(assetUrl.toString()));
    if (!res || !res.ok) return { list: [], byId: new Map() };
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    const byId = new Map();
    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      if (st && st.id !== undefined && st.id !== null) {
        byId.set(String(st.id), st);
      }
    }
    cachedStations = list;
    cachedStationsById = byId;
    return { list, byId };
  } catch {
    return { list: [], byId: new Map() };
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
      (request.method === 'GET' || request.method === 'HEAD') &&
      HTML_META_PATHS.has(url.pathname) &&
      (url.searchParams.has('id') || url.searchParams.has('q') || url.searchParams.has('j'))
    ) {
      return handleHtmlMetaRewrite(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};
