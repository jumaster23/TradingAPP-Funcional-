/**
 * server.js — Servidor de producción para Trading Bot Híbrido
 *
 * Reemplaza los middlewares/proxies de Vite que solo funcionan en modo dev.
 * Sirve el build estático (dist/) + maneja todas las rutas /api/*.
 *
 * Uso:
 *   npm run build
 *   node server.js            (puerto 4173 por defecto)
 *   PORT=8080 node server.js  (puerto custom)
 */

import express from 'express';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const DATASET_FILE = path.join(__dirname, 'dataset.json');
const TRAIN_META_FILE = path.join(__dirname, '.ml-train-meta.json');
const TRAIN_MIN_SAMPLES = 500;
const TRAIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Puerto: Render/Vercel usan PORT, fallback a 4173 para localhost
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 4173);
const NODE_ENV = process.env.NODE_ENV || 'development';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function fileExists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function buildCookieHeader(setCookieValues = []) {
  if (!Array.isArray(setCookieValues) || setCookieValues.length === 0) return '';
  return setCookieValues
    .map((v) => String(v || '').split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function extractCsrfToken(html) {
  const match = String(html || '').match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i);
  return match?.[1] || '';
}

function runSimpleTrainModel() {
  return execFileSync('python', ['train_model.py'], { encoding: 'utf-8', cwd: __dirname });
}

function runSimplePredict(features) {
  const input = JSON.stringify(features || {});
  const raw = execFileSync('python', ['predict.py', input], {
    encoding: 'utf-8',
    cwd: __dirname,
  }).trim();
  const prob = Number.parseFloat(raw);
  if (!Number.isFinite(prob)) throw new Error(`Output de predict.py inválido: ${raw}`);
  return prob;
}

/**
 * Proxy genérico: reescribe la URL, reenvía todos los headers del cliente
 * más los headers extra indicados, y devuelve la respuesta tal cual.
 */
async function genericProxy(req, res, targetBase, pathRewriteFn, extraHeaders = {}) {
  try {
    const originalUrl = req.url || '/';
    const [rawPath, rawQuery] = originalUrl.split('?');
    const rewrittenPath = pathRewriteFn(rawPath);
    const targetUrl = `${targetBase}${rewrittenPath}${rawQuery ? `?${rawQuery}` : ''}`;

    // Construir headers seguros para reenviar (evitar headers hop-by-hop)
    const hopByHop = new Set([
      'host', 'connection', 'keep-alive', 'proxy-authenticate',
      'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
    ]);
    const forwardHeaders = {};
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
        ...extraHeaders,
      },
    });

    const body = await proxyRes.arrayBuffer();
    const ct = proxyRes.headers.get('content-type') || 'application/octet-stream';
    res.status(proxyRes.status).setHeader('Content-Type', ct).send(Buffer.from(body));
  } catch (err) {
    res.status(502).json({ error: 'proxy_error', message: String(err?.message || err) });
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));

// ─── Proxy: Yahoo Finance ─────────────────────────────────────────────────────

app.use('/api/yahoo', (req, res) => {
  genericProxy(req, res, 'https://query1.finance.yahoo.com',
    (p) => p.replace(/^\/api\/yahoo/, ''));
});

// ─── Proxy: CBOE ─────────────────────────────────────────────────────────────

app.use('/api/cboe', (req, res) => {
  genericProxy(req, res, 'https://cdn.cboe.com',
    (p) => p.replace(/^\/api\/cboe/, ''), {
      'Referer': 'https://www.cboe.com/',
      'Origin': 'https://www.cboe.com',
      'Accept': 'application/json',
    });
});

// ─── Proxy: Alpaca ────────────────────────────────────────────────────────────

app.use('/api/alpaca', (req, res) => {
  // Los headers de auth Alpaca (APCA-API-KEY-ID / APCA-API-SECRET-KEY)
  // se envían desde el cliente (base44Client.js) y se reenvían aquí.
  genericProxy(req, res, 'https://data.alpaca.markets',
    (p) => p.replace(/^\/api\/alpaca/, ''));
});

// ─── Proxy: Noticias ─────────────────────────────────────────────────────────

app.use('/api/news/google', (req, res) => {
  genericProxy(req, res, 'https://news.google.com',
    (p) => p.replace(/^\/api\/news\/google/, ''));
});

app.use('/api/news/yahoo', (req, res) => {
  genericProxy(req, res, 'https://feeds.finance.yahoo.com',
    (p) => p.replace(/^\/api\/news\/yahoo/, ''));
});

app.use('/api/news/mw', (req, res) => {
  genericProxy(req, res, 'https://feeds.content.dowjones.io',
    (p) => p.replace(/^\/api\/news\/mw/, ''));
});

app.use('/api/news/ff', (req, res) => {
  genericProxy(req, res, 'https://nfs.faireconomy.media',
    (p) => p.replace(/^\/api\/news\/ff/, ''));
});

// ─── Barchart Options (scraper personalizado) ─────────────────────────────────

app.get('/api/barchart/options', async (req, res) => {
  try {
    const ticker = String(req.query.ticker || '').toUpperCase().trim();
    const expiration = String(req.query.expiration || 'nearest').toLowerCase() === 'all' ? 'all' : 'nearest';
    if (!ticker) {
      return res.status(400).json({ error: 'ticker requerido' });
    }

    const pageUrl = `https://www.barchart.com/stocks/quotes/${encodeURIComponent(ticker)}/options`;
    const commonHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const pageRes = await fetch(pageUrl, { headers: commonHeaders });
    if (!pageRes.ok) {
      return res.status(502).json({ error: `barchart_page_${pageRes.status}` });
    }

    const pageHtml = await pageRes.text();
    const csrf = extractCsrfToken(pageHtml);
    const setCookies = pageRes.headers.getSetCookie?.() || [];
    const cookieHeader = buildCookieHeader(setCookies);

    const apiUrl = new URL('https://www.barchart.com/proxies/core-api/v1/options/get');
    apiUrl.searchParams.set('baseSymbol', ticker);
    apiUrl.searchParams.set('groupBy', 'optionType');
    apiUrl.searchParams.set('expirationDate', expiration);
    apiUrl.searchParams.set('orderBy', 'strikePrice');
    apiUrl.searchParams.set('orderDir', 'asc');
    apiUrl.searchParams.set('meta', 'field.shortName,expirations');
    apiUrl.searchParams.set('fields', 'symbol,baseSymbol,strikePrice,optionType,volume,openInterest,tradeTime');

    const apiRes = await fetch(apiUrl.toString(), {
      headers: {
        ...commonHeaders,
        Accept: 'application/json, text/plain, */*',
        Referer: pageUrl,
        'X-Requested-With': 'XMLHttpRequest',
        ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    const body = await apiRes.text();
    res
      .status(apiRes.ok ? 200 : 502)
      .setHeader('Content-Type', 'application/json')
      .send(body);
  } catch (err) {
    res.status(500).json({ error: 'barchart_proxy_error', message: String(err?.message || err) });
  }
});

// ─── ML: Dataset append ───────────────────────────────────────────────────────

app.post('/api/ml/dataset/append', async (req, res) => {
  try {
    const sample = req.body;
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const rows = await readJsonFile(DATASET_FILE, []);
    const dataset = Array.isArray(rows) ? rows : [];

    const sampleId = String(sample?.id ?? '');
    const sampleTs = String(sample?.timestamp ?? '');
    const exists = dataset.some(
      (row) => String(row?.id ?? '') === sampleId && String(row?.timestamp ?? '') === sampleTs,
    );
    if (!exists) dataset.push(sample);
    await writeJsonFile(DATASET_FILE, dataset);

    let trained = false;
    let trainInfo = null;
    const labeledCount = dataset.filter(
      (row) => row && (Number(row.result) === 0 || Number(row.result) === 1),
    ).length;

    if (labeledCount >= TRAIN_MIN_SAMPLES) {
      const meta = await readJsonFile(TRAIN_META_FILE, { lastTrainedAt: 0 });
      const lastTrainedAt = Number(meta?.lastTrainedAt || 0);
      if (Date.now() - lastTrainedAt >= TRAIN_INTERVAL_MS) {
        const output = runSimpleTrainModel();
        trained = true;
        trainInfo = { output: String(output || '').trim() };
        await writeJsonFile(TRAIN_META_FILE, { lastTrainedAt: Date.now(), labeledCount });
      }
    }

    res.json({
      ok: true,
      inserted: !exists,
      dataset_size: dataset.length,
      labeled_size: labeledCount,
      trained,
      train_info: trainInfo,
    });
  } catch (err) {
    res.status(500).json({ error: 'ml_dataset_append_error', message: String(err?.message || err) });
  }
});

// ─── ML: Status ───────────────────────────────────────────────────────────────

app.get('/api/ml/status', async (req, res) => {
  try {
    const rows = await readJsonFile(DATASET_FILE, []);
    const dataset = Array.isArray(rows) ? rows : [];
    const labeledCount = dataset.filter(
      (row) => row && (Number(row.result) === 0 || Number(row.result) === 1),
    ).length;
    const meta = await readJsonFile(TRAIN_META_FILE, { lastTrainedAt: 0 });
    const hasModel = await fileExists(path.join(__dirname, 'model.pkl'));

    res.json({
      ok: true,
      dataset_size: dataset.length,
      labeled_size: labeledCount,
      train_min_samples: TRAIN_MIN_SAMPLES,
      last_trained_at: Number(meta?.lastTrainedAt || 0),
      has_model: hasModel,
    });
  } catch (err) {
    res.status(500).json({ error: 'ml_status_error', message: String(err?.message || err) });
  }
});

// ─── ML: Entrenar ─────────────────────────────────────────────────────────────

app.post('/api/ml/train', async (req, res) => {
  try {
    const rows = await readJsonFile(DATASET_FILE, []);
    const dataset = Array.isArray(rows) ? rows : [];
    const labeledCount = dataset.filter(
      (row) => row && (Number(row.result) === 0 || Number(row.result) === 1),
    ).length;

    if (labeledCount === 0) {
      return res.status(400).json({
        error: 'dataset_empty',
        message: 'dataset.json no tiene muestras etiquetadas (result=0/1).',
        dataset_size: dataset.length,
        labeled_size: labeledCount,
      });
    }

    const output = runSimpleTrainModel();
    await writeJsonFile(TRAIN_META_FILE, { lastTrainedAt: Date.now(), labeledCount });
    res.json({ ok: true, output: String(output || '').trim() });
  } catch (err) {
    res.status(500).json({ error: 'ml_train_error', message: String(err?.message || err) });
  }
});

// ─── ML: Predecir ─────────────────────────────────────────────────────────────

app.post('/api/ml/predict', async (req, res) => {
  try {
    const payload = req.body;
    const features =
      payload?.features && typeof payload.features === 'object'
        ? payload.features
        : payload;
    const probability = runSimplePredict(features);
    res.json({ ok: true, probability });
  } catch (err) {
    res.status(500).json({ error: 'ml_predict_error', message: String(err?.message || err) });
  }
});

// ─── Archivos estáticos (SPA) ─────────────────────────────────────────────────

// Verificar que el dist existe
if (!(await fileExists(DIST_DIR))) {
  console.error('\n❌ No se encontró la carpeta "dist/".');
  console.error('   Ejecuta primero: npm run build\n');
  process.exit(1);
}

app.use(express.static(DIST_DIR));

// SPA fallback: cualquier ruta no-API devuelve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────

// Manejo de señales para graceful shutdown (importante en Render/Vercel)
const server = app.listen(PORT, '0.0.0.0', () => {
  const isDev = NODE_ENV === 'development';
  const url = isDev ? `http://localhost:${PORT}` : `puerto ${PORT}`;
  console.log(`\n✅ Trading Bot arrancado en ${url}\n`);
  if (isDev) console.log('   Para detener: Ctrl+C\n');
});

process.on('SIGTERM', () => {
  console.log('\n⏹  SIGTERM recibido, cerrando servidor gracefully...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  if (NODE_ENV === 'development') {
    console.log('\n⏹  Ctrl+C - Cerrando...');
    server.close(() => process.exit(0));
  }
});
