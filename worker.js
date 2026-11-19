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
