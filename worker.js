const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|twitterbot/i;

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

    return env.ASSETS.fetch(request);
  }
};
