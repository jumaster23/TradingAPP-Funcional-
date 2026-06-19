// Yahoo Finance Proxy — handles crumb/cookie auth for v7 endpoints
// v8/chart works without auth; v7/options requires crumb+cookie

let cachedCrumb = null;
let cachedCookie = null;
let crumbExpiry = 0;
const CRUMB_TTL = 30 * 60 * 1000; // 30 minutes

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function getYahooCrumb() {
  const now = Date.now();
  if (cachedCrumb && cachedCookie && now < crumbExpiry) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  // Step 1: Get consent cookie
  const consentRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const setCookies = consentRes.headers.getSetCookie?.() || [];
  const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: Get crumb using cookie
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': UA,
      'Cookie': cookieStr,
    },
  });

  if (!crumbRes.ok) {
    // Fallback: try without crumb (works for v8 endpoints)
    return { crumb: null, cookie: null };
  }

  const crumb = await crumbRes.text();

  // Validate crumb is not JSON error
  if (crumb.startsWith('{') || crumb.startsWith('<')) {
    return { crumb: null, cookie: null };
  }

  cachedCrumb = crumb;
  cachedCookie = cookieStr;
  crumbExpiry = now + CRUMB_TTL;

  return { crumb, cookie: cookieStr };
}

export default async function handler(req, res) {
  const targetBase = 'https://query1.finance.yahoo.com';
  let path = req.url.replace(/^\/api\/yahoo/, '') || '/';

  // /chart/:ticker → /v8/finance/chart/:ticker (compat)
  path = path.replace(/^\/chart\//, '/v8/finance/chart/');

  try {
    // Check if this is a v7 endpoint that needs crumb
    const needsCrumb = path.includes('/v7/') || path.includes('/v6/');

    let targetUrl = `${targetBase}${path}`;
    const headers = { 'User-Agent': UA };

    if (needsCrumb) {
      const { crumb, cookie } = await getYahooCrumb();
      if (crumb) {
        // Append crumb to URL
        const sep = targetUrl.includes('?') ? '&' : '?';
        targetUrl += `${sep}crumb=${encodeURIComponent(crumb)}`;
        headers['Cookie'] = cookie;
      }
    }

    const proxyRes = await fetch(targetUrl, { method: req.method, headers });
    const body = await proxyRes.arrayBuffer();
    const ct = proxyRes.headers.get('content-type') || 'application/octet-stream';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(proxyRes.status).setHeader('Content-Type', ct).send(Buffer.from(body));
  } catch (err) {
    res.status(502).json({ error: 'proxy_error', message: String(err?.message || err) });
  }
}
