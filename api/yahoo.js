export default async function handler(req, res) {
  const targetBase = 'https://query1.finance.yahoo.com';
  const path = req.url.replace(/^\/api\/yahoo/, '') || '/';

  try {
    const targetUrl = `${targetBase}${path}`;
    const forwardHeaders = {};
    const hopByHop = new Set([
      'host', 'connection', 'keep-alive', 'proxy-authenticate',
      'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
    ]);
    for (const [key, value] of Object.entries(req.headers)) {
      if (!hopByHop.has(key.toLowerCase())) {
        forwardHeaders[key] = value;
      }
    }

    const proxyRes = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...forwardHeaders,
      },
    });

    const body = await proxyRes.arrayBuffer();
    const ct = proxyRes.headers.get('content-type') || 'application/octet-stream';
    res.status(proxyRes.status).setHeader('Content-Type', ct).send(Buffer.from(body));
  } catch (err) {
    res.status(502).json({ error: 'proxy_error', message: String(err?.message || err) });
  }
}