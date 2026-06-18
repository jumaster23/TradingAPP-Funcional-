import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DATASET_FILE = path.resolve(process.cwd(), 'dataset.json');
const TRAIN_META_FILE = path.resolve(process.cwd(), '.ml-train-meta.json');
const TRAIN_MIN_SAMPLES = 500;
const TRAIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk || '');
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON invalido'));
      }
    });
    req.on('error', reject);
  });
}

function runSimpleTrainModel() {
  return execFileSync('python', ['train_model.py'], { encoding: 'utf-8' });
}

function runSimplePredict(features) {
  const input = JSON.stringify(features || {});
  const raw = execFileSync('python', ['predict.py', input], { encoding: 'utf-8' }).trim();
  const prob = Number.parseFloat(raw);
  if (!Number.isFinite(prob)) throw new Error(`Salida de predict.py invalida: ${raw}`);
  return prob;
}

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'info', // Show server info, URLs, and errors
  plugins: [
    react(),
    {
      name: 'barchart-options-session-proxy',
      configureServer(server) {
        server.middlewares.use('/api/barchart/options', async (req, res) => {
          try {
            const reqUrl = new URL(req.url || '', 'http://localhost');
            const ticker = String(reqUrl.searchParams.get('ticker') || '').toUpperCase().trim();
            if (!ticker) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'ticker requerido' }));
              return;
            }

            const pageUrl = `https://www.barchart.com/stocks/quotes/${encodeURIComponent(ticker)}/options`;
            const commonHeaders = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
            };

            const pageRes = await fetch(pageUrl, { headers: commonHeaders });
            if (!pageRes.ok) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `barchart_page_${pageRes.status}` }));
              return;
            }

            const pageHtml = await pageRes.text();
            const csrf = extractCsrfToken(pageHtml);
            const setCookies = pageRes.headers.getSetCookie?.() || [];
            const cookieHeader = buildCookieHeader(setCookies);

            const apiUrl = new URL('https://www.barchart.com/proxies/core-api/v1/options/get');
            apiUrl.searchParams.set('baseSymbol', ticker);
            apiUrl.searchParams.set('groupBy', 'optionType');
            apiUrl.searchParams.set('expirationDate', 'nearest');
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
            res.statusCode = apiRes.ok ? 200 : 502;
            res.setHeader('Content-Type', 'application/json');
            if (!apiRes.ok) {
              res.end(JSON.stringify({ error: `barchart_api_${apiRes.status}`, body: body.slice(0, 300) }));
              return;
            }
            res.end(body);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'barchart_proxy_error', message: String(err?.message || err) }));
          }
        });

        server.middlewares.use('/api/ml/dataset/append', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
          }

          try {
            const sample = await readRequestBody(req);
            if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid_payload' }));
              return;
            }

            const rows = await readJsonFile(DATASET_FILE, []);
            const dataset = Array.isArray(rows) ? rows : [];
            const sampleId = String(sample?.id ?? '');
            const sampleTs = String(sample?.timestamp ?? '');
            const exists = dataset.some((row) => String(row?.id ?? '') === sampleId && String(row?.timestamp ?? '') === sampleTs);
            if (!exists) dataset.push(sample);
            await writeJsonFile(DATASET_FILE, dataset);

            let trained = false;
            let trainInfo = null;
            const labeledCount = dataset.filter((row) => row && (Number(row.result) === 0 || Number(row.result) === 1)).length;
            if (labeledCount >= TRAIN_MIN_SAMPLES) {
              const meta = await readJsonFile(TRAIN_META_FILE, { lastTrainedAt: 0 });
              const lastTrainedAt = Number(meta?.lastTrainedAt || 0);
              const shouldTrain = Date.now() - lastTrainedAt >= TRAIN_INTERVAL_MS;
              if (shouldTrain) {
                const output = runSimpleTrainModel();
                trained = true;
                trainInfo = { output: String(output || '').trim() };
                await writeJsonFile(TRAIN_META_FILE, { lastTrainedAt: Date.now(), labeledCount });
              }
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              inserted: !exists,
              dataset_size: dataset.length,
              labeled_size: labeledCount,
              trained,
              train_info: trainInfo,
            }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'ml_dataset_append_error', message: String(err?.message || err) }));
          }
        });

        server.middlewares.use('/api/ml/status', async (req, res) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
          }

          try {
            const rows = await readJsonFile(DATASET_FILE, []);
            const dataset = Array.isArray(rows) ? rows : [];
            const labeledCount = dataset.filter((row) => row && (Number(row.result) === 0 || Number(row.result) === 1)).length;
            const meta = await readJsonFile(TRAIN_META_FILE, { lastTrainedAt: 0 });
            const hasModel = await fileExists(path.resolve(process.cwd(), 'model.pkl'));

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              dataset_size: dataset.length,
              labeled_size: labeledCount,
              train_min_samples: TRAIN_MIN_SAMPLES,
              last_trained_at: Number(meta?.lastTrainedAt || 0),
              has_model: hasModel,
            }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'ml_status_error', message: String(err?.message || err) }));
          }
        });

        server.middlewares.use('/api/ml/train', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
          }
          try {
            const rows = await readJsonFile(DATASET_FILE, []);
            const dataset = Array.isArray(rows) ? rows : [];
            const labeledCount = dataset.filter((row) => row && (Number(row.result) === 0 || Number(row.result) === 1)).length;
            if (labeledCount === 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: 'dataset_empty',
                message: 'dataset.json no tiene muestras etiquetadas (result=0/1). Guarda/cierra trades en Journal para poblar el dataset.',
                dataset_size: dataset.length,
                labeled_size: labeledCount,
              }));
              return;
            }

            const output = runSimpleTrainModel();
            await writeJsonFile(TRAIN_META_FILE, { lastTrainedAt: Date.now(), labeledCount });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, output: String(output || '').trim() }));
          } catch (err) {
            const message = String(err?.message || err);
            const isDatasetEmpty = message.includes('dataset.json esta vacio') || message.includes('No hay trades etiquetados');
            res.statusCode = isDatasetEmpty ? 400 : 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: isDatasetEmpty ? 'dataset_empty' : 'ml_train_error', message }));
          }
        });

        server.middlewares.use('/api/ml/predict', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
          }
          try {
            const payload = await readRequestBody(req);
            const features = payload?.features && typeof payload.features === 'object' ? payload.features : payload;
            const probability = runSimplePredict(features);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, probability }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'ml_predict_error', message: String(err?.message || err) }));
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/yahoo/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
      '/api/price/yahoo': {
        target: 'http://localhost:4173',
        changeOrigin: true,
      },
      '/api/cboe': {
        target: 'https://cdn.cboe.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/cboe/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.cboe.com/',
          'Origin': 'https://www.cboe.com',
          'Accept': 'application/json',
        },
      },
      '/api/alpaca': {
        target: 'https://data.alpaca.markets',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/alpaca/, ''),
      },
      '/api/news/google': {
        target: 'https://news.google.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/news\/google/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      },
      '/api/news/yahoo': {
        target: 'https://feeds.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/news\/yahoo/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      },
      '/api/news/mw': {
        target: 'https://feeds.content.dowjones.io',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/news\/mw/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      },
      '/api/news/ff': {
        target: 'https://nfs.faireconomy.media',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/news\/ff/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      },
    },
  },
});