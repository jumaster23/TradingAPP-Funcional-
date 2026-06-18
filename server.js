// ─── IMPORTS Y CONFIGURACIÓN ───────────────────────────────────────────────
import express from 'express';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import cheerio from 'cheerio'; // Para Node.js 20+ y ES Modules: npm install cheerio@^1.0.0-rc.12

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DIST_DIR = path.join(__dirname, 'dist');
const DATASET_FILE = path.join(__dirname, 'dataset.json');
const TRAIN_META_FILE = path.join(__dirname, 'ml', 'train_meta.json');
const TRAIN_MIN_SAMPLES = 20;
const TRAIN_INTERVAL_MS = 1000 * 60 * 10;

// Helpers
async function fileExists(file) {
  try {
    await fs.promises.access(file, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ─── ENDPOINT: Proxy Barchart Options ──────────────────────────────────────
app.get('/api/barchart/options', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker_required' });
  try {
    // URL pública de Barchart para opciones (puedes cambiar por tu API KEY si tienes una)
    const url = `https://www.barchart.com/proxies/core-api/v1/options/get?symbol=${encodeURIComponent(ticker)}&fields=symbol,strikePrice,openInterest,volume,expirationDate,type`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        // 'apikey': process.env.BARCHART_API_KEY, // Si tienes API KEY
      },
    });
    if (!response.ok) throw new Error('barchart_fetch_error');
    const data = await response.json();
    res.json({ ok: true, data: data.data || [], meta: data.meta || {} });
  } catch (err) {
    res.status(500).json({ error: 'barchart_proxy_error', message: String(err?.message || err) });
  }
});

// ─── ENDPOINT: Opciones Yahoo Finance ─────────────────────────────────────
app.get('/api/options/yahoo', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker_required' });
  try {
    // Yahoo Finance options endpoint
    const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) throw new Error('yahoo_fetch_error');
    const data = await response.json();
    // Extraer strikes y open interest
    const result = [];
    const options = data?.optionChain?.result?.[0]?.options || [];
    options.forEach(opt => {
      ['calls', 'puts'].forEach(type => {
        (opt[type] || []).forEach(item => {
          result.push({
            type,
            contractSymbol: item.contractSymbol,
            strike: item.strike,
            expiration: item.expiration,
            openInterest: item.openInterest,
            volume: item.volume,
            lastPrice: item.lastPrice,
          });
        });
      });
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ error: 'yahoo_proxy_error', message: String(err?.message || err) });
  }
});

// ─── ENDPOINT: Opciones Barchart (estructura) ─────────────────────────────
app.get('/api/options/barchart', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker_required' });
  // Aquí deberías implementar la lógica real con tu API Key o scraping
  res.status(501).json({ error: 'not_implemented', message: 'Integración Barchart pendiente. Requiere API Key o scraping.' });
});

// ─── ENDPOINT: Scraping Barchart Opciones y Gamma ─────────────────────────
app.get('/api/options/barchart-scrape', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker_required' });
  try {
    // URL de la tabla de opciones de Barchart (calls y puts)
    const url = `https://www.barchart.com/stocks/quotes/${encodeURIComponent(ticker)}/options`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html',
      },
    });
    if (!response.ok) throw new Error('barchart_scrape_error');
    const html = await response.text();
    const $ = cheerio.load(html);
    const data = [];
    // Scraping de la tabla principal de opciones (calls y puts)
    $('table.bc-table-scrollable tbody tr').each((i, el) => {
      const tds = $(el).find('td');
      if (tds.length > 10) {
        const strike = parseFloat($(tds[10]).text().replace(/[$,]/g, ''));
        const callOpenInterest = parseInt($(tds[5]).text().replace(/,/g, ''));
        const putOpenInterest = parseInt($(tds[16]).text().replace(/,/g, ''));
        data.push({
          strike,
          callOpenInterest: isNaN(callOpenInterest) ? null : callOpenInterest,
          putOpenInterest: isNaN(putOpenInterest) ? null : putOpenInterest,
        });
      }
    });
    // Cálculo de niveles gamma (simplificado: diferencia de OI calls-puts por strike)
    const gammaLevels = data.map(row => ({
      strike: row.strike,
      gamma: (row.callOpenInterest || 0) - (row.putOpenInterest || 0)
    }));
    res.json({ ok: true, data, gammaLevels });
  } catch (err) {
    res.status(500).json({ error: 'barchart_scrape_error', message: String(err?.message || err) });
  }
});

// ─── ENDPOINT: TipRanks (estructura) ───────────────────────────────────────
app.get('/api/tipranks/summary', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker_required' });
  // Aquí deberías implementar la lógica real con scraping o API Key de TipRanks
  res.status(501).json({ error: 'not_implemented', message: 'Integración TipRanks pendiente. Requiere API Key o scraping.' });
});

// ─── ENDPOINT: Finviz (estructura) ─────────────────────────────────────────
app.get('/api/finviz/summary', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker_required' });
  // Aquí deberías implementar la lógica real con scraping o API Key de Finviz
  res.status(501).json({ error: 'not_implemented', message: 'Integración Finviz pendiente. Requiere API Key o scraping.' });
});

// ─── ENDPOINT: Proxy Yahoo Finance Chart (CORS bypass) ─────────────────────
app.get('/api/yahoo/chart/:ticker', async (req, res) => {
  let { ticker } = req.params;
  const { interval = '1m', range = '1d' } = req.query;
  ticker = decodeURIComponent(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener datos de Yahoo', details: err.message });
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

// SPA fallback: solo rutas que NO sean de API
app.get(/^\/(?!api\/).*/, (req, res) => {
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

