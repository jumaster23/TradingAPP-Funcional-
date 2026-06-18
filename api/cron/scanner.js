// Cron Scanner — Runs every 5 minutes during market hours
// Scans all tickers, saves GO signals as trades, updates open trades
import { sql } from '../lib/db.js';

const YAHOO_BASE = 'https://query1.finance.yahoo.com';
const TICKERS = ['NVDA', 'META', 'QQQ', 'AMD', 'AMZN', 'GOOGL'];

async function fetchYahoo(path) {
  const res = await fetch(`${YAHOO_BASE}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return res.json();
}

async function getPrice(ticker) {
  const data = await fetchYahoo(`/v8/finance/chart/${ticker}?interval=5m&range=1d`);
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  const closes = (q.close || []).filter(v => v != null);
  const volumes = (q.volume || []).filter(v => v != null);
  const highs = (q.high || []).filter(v => v != null);
  const lows = (q.low || []).filter(v => v != null);
  const opens = (q.open || []).filter(v => v != null);
  if (!closes.length) return null;
  return { closes, volumes, highs, lows, opens, price: closes[closes.length - 1] };
}

function calcEMA(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function getAdaptiveStop(price) {
  if (price < 250) return 1.0;
  if (price < 400) return 1.5;
  if (price < 550) return 2.0;
  return 2.5;
}

async function checkConvergence(direction) {
  try {
    const [nqData, spxData] = await Promise.all([
      fetchYahoo('/v8/finance/chart/NQ=F?interval=1m&range=1d'),
      fetchYahoo('/v8/finance/chart/^GSPC?interval=1m&range=1d'),
    ]);
    for (const data of [nqData, spxData]) {
      const result = data?.chart?.result?.[0];
      if (!result) return false;
      const closes = (result.indicators?.quote?.[0]?.close || []).filter(v => v != null);
      if (closes.length < 3) return false;
      const price = closes[closes.length - 1];
      const t3 = price - closes[closes.length - 3];
      const t1 = price - closes[closes.length - 2];
      const th = price * 0.00003;
      if (direction === 'CALL' && !(t3 > th && t1 >= 0)) return false;
      if (direction === 'PUT' && !(t3 < -th && t1 <= 0)) return false;
    }
    return true;
  } catch { return false; }
}

async function scanTicker(ticker) {
  const data = await getPrice(ticker);
  if (!data) return null;

  const { closes, volumes, highs, lows, opens, price } = data;
  const ema10 = calcEMA(closes, 10);
  const ema20 = calcEMA(closes, 20);
  if (!ema10 || !ema20) return null;

  // VWAP
  let vNum = 0, vDen = 0;
  for (let i = 0; i < Math.min(closes.length, volumes.length, highs.length, lows.length); i++) {
    vNum += ((highs[i] + lows[i] + closes[i]) / 3) * volumes[i];
    vDen += volumes[i];
  }
  const vwap = vDen ? vNum / vDen : price;

  // EMA slope
  const ema10arr = [];
  const k = 2 / 11;
  let e = closes[0];
  for (let i = 0; i < closes.length; i++) { e = closes[i] * k + e * (1 - k); ema10arr.push(e); }
  const slope = ema10arr.length >= 4 ? ema10arr[ema10arr.length - 1] - ema10arr[ema10arr.length - 4] : 0;

  // Volume
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(volumes.length, 20);
  const curVol = volumes[volumes.length - 1] || 0;
  const volRatio = avgVol ? curVol / avgVol : 0;

  // Score
  let callScore = 0, putScore = 0;
  if (price > ema10 && slope > 0.05) callScore += 2;
  if (ema10 > ema20) callScore += 1;
  if (price > vwap) callScore += 2;
  if (price < ema10 && slope < -0.05) putScore += 2;
  if (ema10 < ema20) putScore += 1;
  if (price < vwap) putScore += 2;

  let direction = null, score = 0;
  if (callScore >= 5 && callScore > putScore) { direction = 'CALL'; score = callScore; }
  else if (putScore >= 5) { direction = 'PUT'; score = putScore; }
  if (!direction) return null;

  const setup = score >= 8 ? 'A+' : score >= 6 ? 'A' : 'B';
  if (setup === 'B') return null;

  // Convergence
  const conv = await checkConvergence(direction);
  if (!conv) return null;

  // GO trigger
  const spyData = await getPrice('SPY');
  if (!spyData) return null;
  const spyCloses = spyData.closes;
  const spyT1 = spyCloses.length >= 2 ? spyCloses[spyCloses.length - 1] - spyCloses[spyCloses.length - 2] : 0;
  const spyAccel = (direction === 'CALL' && spyT1 > 0) || (direction === 'PUT' && spyT1 < 0);
  if (!(volRatio >= 0.8 && spyAccel)) return null;

  const stopDist = getAdaptiveStop(price);
  const stop = direction === 'CALL' ? price - stopDist : price + stopDist;
  const target = direction === 'CALL' ? price + stopDist * 3 : price - stopDist * 3;

  return {
    ticker,
    signal: direction,
    entry: +price.toFixed(2),
    sl: +stop.toFixed(2),
    tp: +target.toFixed(2),
    score,
    setupGrade: setup,
    volRatio: +volRatio.toFixed(2),
  };
}

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = et.getHours();
    const min = et.getMinutes();
    const totalMin = hour * 60 + min;

    // Only run during market hours (9:45 - 15:55 ET)
    if (totalMin < 585 || totalMin >= 955) {
      return res.json({ ok: true, message: 'Fuera de horario de mercado', time: et.toLocaleTimeString() });
    }

    // Skip lunch dead zone
    if (totalMin >= 720 && totalMin < 780) {
      return res.json({ ok: true, message: 'Hora muerta mediodía', time: et.toLocaleTimeString() });
    }

    // Count today's trades
    const today = now.toISOString().slice(0, 10);
    const todayTrades = await sql`SELECT COUNT(*) as count FROM trades WHERE opened_at::date = ${today}`;
    const tradeCount = parseInt(todayTrades[0]?.count || 0);

    if (tradeCount >= 2) {
      // Update open trades only
      await updateOpenTrades();
      return res.json({ ok: true, message: `Max 2 trades alcanzado (${tradeCount})`, time: et.toLocaleTimeString() });
    }

    // Scan tickers
    const results = [];
    for (const ticker of TICKERS) {
      const signal = await scanTicker(ticker);
      if (signal) results.push(signal);
    }

    // Sort by score, take top (2 - existing trades)
    results.sort((a, b) => b.score - a.score);
    const slotsLeft = 2 - tradeCount;
    const toSave = results.slice(0, slotsLeft);

    // Save new trades
    const saved = [];
    for (const trade of toSave) {
      // Check no duplicate for same ticker today
      const existing = await sql`SELECT id FROM trades WHERE ticker = ${trade.ticker} AND opened_at::date = ${today}`;
      if (existing.length > 0) continue;

      const [row] = await sql`
        INSERT INTO trades (ticker, signal, entry, sl, tp, score, setup_grade, session)
        VALUES (${trade.ticker}, ${trade.signal}, ${trade.entry}, ${trade.sl}, ${trade.tp}, ${trade.score}, ${trade.setupGrade}, ${today})
        RETURNING *
      `;
      saved.push(row);
    }

    // Update open trades
    await updateOpenTrades();

    return res.json({
      ok: true,
      time: et.toLocaleTimeString(),
      scanned: TICKERS.length,
      signalsFound: results.length,
      saved: saved.length,
      todayTotal: tradeCount + saved.length,
      trades: saved,
    });
  } catch (err) {
    return res.status(500).json({ error: 'scanner_error', message: String(err?.message || err) });
  }
}

async function updateOpenTrades() {
  // Find open trades (no exit_price)
  const openTrades = await sql`SELECT * FROM trades WHERE exit_price IS NULL AND opened_at::date = CURRENT_DATE`;

  for (const trade of openTrades) {
    const data = await getPrice(trade.ticker);
    if (!data) continue;

    const { price, highs, lows } = data;
    const entry = parseFloat(trade.entry);
    const sl = parseFloat(trade.sl);
    const tp = parseFloat(trade.tp);
    const stopDist = Math.abs(entry - sl);

    // Check if SL or TP was hit in recent candles
    const recentHighs = highs.slice(-6);
    const recentLows = lows.slice(-6);

    let result = null, exitPrice = null;

    if (trade.signal === 'CALL') {
      const hitSL = recentLows.some(l => l <= sl);
      const hitTP = recentHighs.some(h => h >= tp);
      // Check BE (if price went +stopDist then came back)
      const maxFav = Math.max(...recentHighs) - entry;
      const beTriggered = maxFav >= stopDist;

      if (hitTP) { result = 'TARGET'; exitPrice = tp; }
      else if (hitSL && !beTriggered) { result = 'STOP'; exitPrice = sl; }
      else if (hitSL && beTriggered) { result = 'BE'; exitPrice = entry; }
    } else {
      const hitSL = recentHighs.some(h => h >= sl);
      const hitTP = recentLows.some(l => l <= tp);
      const maxFav = entry - Math.min(...recentLows);
      const beTriggered = maxFav >= stopDist;

      if (hitTP) { result = 'TARGET'; exitPrice = tp; }
      else if (hitSL && !beTriggered) { result = 'STOP'; exitPrice = sl; }
      else if (hitSL && beTriggered) { result = 'BE'; exitPrice = entry; }
    }

    // Check EOD (after 3:50 PM)
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (et.getHours() >= 15 && et.getMinutes() >= 50 && !result) {
      result = price > entry ? 'WIN_EOD' : 'LOSS_EOD';
      exitPrice = price;
    }

    if (result && exitPrice) {
      await sql`
        UPDATE trades SET exit_price = ${+exitPrice.toFixed(2)}, result = ${result}, closed_at = NOW()
        WHERE id = ${trade.id}
      `;
    }
  }
}
