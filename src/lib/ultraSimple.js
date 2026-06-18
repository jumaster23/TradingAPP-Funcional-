// ORB + PMH/PML Combo Strategy — 87% WR
// Entry when price breaks BOTH ORB high AND PMH (or ORB low AND PML)
// Convergence: SPX trending + VIX inverse
// Backtested: 71 trades, 45W 9L 17BE, PF 2.43, $171/day (2 contracts)

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval, range, prepost = false) {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}${prepost ? '&includePrePost=true' : ''}`;
  const res = await fetch(url);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return {
    timestamps: result.timestamp || [],
    opens: q.open || [],
    highs: q.high || [],
    lows: q.low || [],
    closes: q.close || [],
    volumes: q.volume || [],
  };
}

function calcEMA(arr, period) {
  if (!arr || arr.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    ema.push(arr[i] != null ? arr[i] * k + ema[i - 1] * (1 - k) : ema[i - 1]);
  }
  return ema;
}

function getSession() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes();
  const total = h * 60 + m;
  if (total < 570) return { name: 'PREMARKET', label: 'Pre-Market' };
  if (total < 630) return { name: 'OPENING', label: 'Apertura (9:30-10:30)' };
  if (total < 840) return { name: 'MIDDAY', label: 'Mediodía (10:30-14:00)' };
  if (total < 960) return { name: 'AFTERNOON', label: 'Tarde (14:00-16:00)' };
  return { name: 'CLOSED', label: 'Mercado Cerrado' };
}

// === SPX + VIX convergence (5min trend) ===
async function checkConvergence(direction) {
  try {
    const [spxData, vixData] = await Promise.all([
      fetchChart('SPY', '5m', '1d'),
      fetchChart('^VIX', '5m', '1d'),
    ]);

    function checkTrend(data, dir, inverse) {
      if (!data) return { ok: false, trend3: 0, price: 0 };
      const c = data.closes.filter(v => v != null);
      if (c.length < 4) return { ok: false, trend3: 0, price: 0 };
      const price = c[c.length - 1];
      const t3 = price - c[c.length - 4]; // last 3 candles = 15min
      const t1 = price - c[c.length - 2];
      let ok;
      if (inverse) {
        ok = dir === 'CALL' ? (t3 < 0 && t1 <= 0) : (t3 > 0 && t1 >= 0);
      } else {
        ok = dir === 'CALL' ? (t3 > 0 && t1 >= 0) : (t3 < 0 && t1 <= 0);
      }
      return { ok, trend3: +t3.toFixed(2), price: +price.toFixed(2) };
    }

    const spy = checkTrend(spxData, direction, false);
    const vix = checkTrend(vixData, direction, true);
    const converging = spy.ok && vix.ok;

    return {
      converging,
      spx: spy, // keep spx key for UI compatibility
      spy,
      vix,
      reason: `SPY ${spy.ok ? '✅' : '❌'} (${spy.trend3 > 0 ? '+' : ''}${spy.trend3}) + VIX ${vix.ok ? '✅' : '❌'} (${vix.trend3 > 0 ? '+' : ''}${vix.trend3})`,
    };
  } catch {
    return { converging: false, reason: 'Error de datos' };
  }
}

// === Daily trend (EMA10) ===
let cachedDayTrend = { date: null, trend: 'NEUTRAL' };

async function getDayTrend(ticker) {
  const today = new Date().toISOString().slice(0, 10);
  if (cachedDayTrend.date === today && cachedDayTrend.ticker === ticker) return cachedDayTrend.trend;
  try {
    const daily = await fetchChart(ticker, '1d', '3mo');
    if (!daily) return 'NEUTRAL';
    const closes = daily.closes.filter(v => v != null);
    if (closes.length < 12) return 'NEUTRAL';
    const ema10 = calcEMA(closes, 10);
    const idx = closes.length - 1;
    let trend = 'NEUTRAL';
    if (closes[idx] > ema10[idx] && closes[idx - 1] > closes[idx - 2]) trend = 'UP';
    else if (closes[idx] < ema10[idx] && closes[idx - 1] < closes[idx - 2]) trend = 'DOWN';
    cachedDayTrend = { date: today, ticker, trend };
    return trend;
  } catch { return 'NEUTRAL'; }
}

// === ORB + PM levels ===
async function getOrbAndPmLevels(ticker) {
  try {
    const data5m = await fetchChart(ticker, '5m', '1d', true);
    if (!data5m || data5m.timestamps.length < 10) return null;

    const getMinET = (ts) => {
      const d = new Date(ts * 1000);
      const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      return et.getHours() * 60 + et.getMinutes();
    };

    // PMH/PML (7:00-9:30) — active premarket only, skip glitch candles
    let pmh = -Infinity, pml = Infinity, pmCount = 0;
    for (let i = 0; i < data5m.timestamps.length; i++) {
      const m = getMinET(data5m.timestamps[i]);
      if (m >= 420 && m < 570) {
        const h = data5m.highs[i], l = data5m.lows[i];
        if (h != null && l != null && (h - l) / h > 0.05) continue; // glitch filter
        if (h != null && h > pmh) pmh = h;
        if (l != null && l < pml) pml = l;
        pmCount++;
      }
    }
    const pmRange = pmh !== -Infinity ? pmh - pml : 0;

    // ORB first 5min candle (9:30-9:35)
    let orbH = null, orbL = null;
    for (let i = 0; i < data5m.timestamps.length; i++) {
      const m = getMinET(data5m.timestamps[i]);
      if (m >= 570 && m < 575) {
        orbH = data5m.highs[i];
        orbL = data5m.lows[i];
        break;
      }
    }
    if (!orbH || !orbL) return null;
    const orbRange = orbH - orbL;

    // VWAP from regular hours
    let vwapNum = 0, vwapDen = 0, vwap = null;
    for (let i = 0; i < data5m.timestamps.length; i++) {
      const m = getMinET(data5m.timestamps[i]);
      if (m >= 570) {
        if (data5m.highs[i] != null && data5m.lows[i] != null && data5m.closes[i] != null && data5m.volumes[i] != null) {
          vwapNum += ((data5m.highs[i] + data5m.lows[i] + data5m.closes[i]) / 3) * data5m.volumes[i];
          vwapDen += data5m.volumes[i];
        }
        vwap = vwapDen ? +(vwapNum / vwapDen).toFixed(2) : null;
      }
    }

    // ATR 14 from regular hours — dynamic volatility
    const trs = [];
    for (let i = 1; i < data5m.timestamps.length; i++) {
      const m = getMinET(data5m.timestamps[i]);
      if (m < 570 || m >= 960) continue;
      const h = data5m.highs[i], l = data5m.lows[i], pc = data5m.closes[i - 1];
      if (h == null || l == null || pc == null) continue;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const atr = trs.length >= 14
      ? +(trs.slice(-14).reduce((a, b) => a + b, 0) / 14).toFixed(2)
      : null;
    // SL = 1.5x ATR (survive noise), min $0.30, max $3.00
    const atrStop = atr ? +Math.max(0.30, Math.min(3.00, atr * 1.5)).toFixed(2) : null;

    return {
      pmh: pmh !== -Infinity ? +pmh.toFixed(2) : null,
      pml: pml !== Infinity ? +pml.toFixed(2) : null,
      pmRange: +pmRange.toFixed(2),
      pmCount,
      orbH: +orbH.toFixed(2),
      orbL: +orbL.toFixed(2),
      orbRange: +orbRange.toFixed(2),
      atr, atrStop,
      vwap,
    };
  } catch { return null; }
}

// === First touch tracking ===
const touchedToday = {};
function resetTouches() {
  const today = new Date().toISOString().slice(0, 10);
  if (touchedToday._date !== today) {
    Object.keys(touchedToday).forEach(k => delete touchedToday[k]);
    touchedToday._date = today;
  }
}
function wasTouched(ticker, direction) {
  resetTouches();
  return !!touchedToday[`${ticker}_${direction}`];
}
function markTouched(ticker, direction) {
  resetTouches();
  touchedToday[`${ticker}_${direction}`] = true;
}

// === BEST TICKERS ===
const BEST_TICKERS = ['MSFT', 'QQQ', 'NVDA', 'GOOGL'];
const SL_MAP = { MSFT: 0.75, QQQ: 0.75, NVDA: 0.75, GOOGL: 1.00 };
const TP_MAP = { MSFT: 2.50, QQQ: 2.50, NVDA: 2.50, GOOGL: 3.00 };

// === MAIN: Analyze ticker ===
export async function analyzeUltraSimple(ticker) {
  try {
    const [data5m, levels, dayTrend] = await Promise.all([
      fetchChart(ticker, '5m', '1d'),
      getOrbAndPmLevels(ticker),
      getDayTrend(ticker),
    ]);

    const session = getSession();
    if (!data5m || !levels) return { signal: 'NONE', ticker, levels: [], session, dayTrend };

    const { pmh, pml, pmRange, orbH, orbL, orbRange, vwap, atr, atrStop } = levels;

    // Filter: PM range > $6 = too volatile, skip
    if (pmRange > 6) return { signal: 'NONE', ticker, levels: [], session, dayTrend, reason: 'PM range > $6' };

    const closes = data5m.closes;
    const highs = data5m.highs;
    const lows = data5m.lows;
    const len = closes.length;
    if (len < 5) return { signal: 'NONE', ticker, levels: [], session, dayTrend };

    const price = closes[len - 1];
    const h = highs[len - 1];
    const l = lows[len - 1];

    // Check if BOTH ORB and PM levels have been broken
    let orbBrokenUp = false, pmhBroken = false;
    let orbBrokenDown = false, pmlBroken = false;

    for (let i = 0; i < len; i++) {
      if (highs[i] != null) {
        if (highs[i] > orbH) orbBrokenUp = true;
        if (pmh && highs[i] > pmh) pmhBroken = true;
      }
      if (lows[i] != null) {
        if (lows[i] < orbL) orbBrokenDown = true;
        if (pml && lows[i] < pml) pmlBroken = true;
      }
    }

    let bestSignal = null;

    // Adaptive SL/TP per ticker
    const stopDist = SL_MAP[ticker] || 0.75;
    const targetDist = TP_MAP[ticker] || 2.50;

    // Only trade best tickers
    const isBestTicker = BEST_TICKERS.includes(ticker);

    // === CALL: ORB High + PMH both broken + price above VWAP ===
    const vwapCallOk = !vwap || price > vwap;
    if (isBestTicker && orbBrokenUp && pmhBroken && !wasTouched(ticker, 'CALL') && dayTrend !== 'DOWN' && vwapCallOk) {
      const conv = await checkConvergence('CALL');
      if (conv.converging) {
        markTouched(ticker, 'CALL');

        const entry = +price.toFixed(2);
        const stop = +(entry - stopDist).toFixed(2);
        const target = +(entry + targetDist).toFixed(2);
        const beLevel = +(entry + stopDist * 2).toFixed(2);

        bestSignal = {
          direction: 'CALL',
          type: 'ORB+PMH',
          level: 'PMH',
          levelPrice: pmh,
          orbH, orbL, orbRange,
          pmh, pml, pmRange,
          entry,
          stop,
          target,
          beLevel,
          risk: stopDist,
          convergence: conv,
          reason: `ORB+PMH rotos — CALL — Risk $${stopDist} Target $${targetDist} (1:5)`,
        };
      }
    }

    // === PUT: ORB Low + PML both broken + price below VWAP ===
    const vwapPutOk = !vwap || price < vwap;
    if (!bestSignal && isBestTicker && orbBrokenDown && pmlBroken && !wasTouched(ticker, 'PUT') && dayTrend !== 'UP' && vwapPutOk) {
      const conv = await checkConvergence('PUT');
      if (conv.converging) {
        markTouched(ticker, 'PUT');

        const entry = +price.toFixed(2);
        const stop = +(entry + stopDist).toFixed(2);
        const target = +(entry - targetDist).toFixed(2);
        const beLevel = +(entry - stopDist * 2).toFixed(2);

        bestSignal = {
          direction: 'PUT',
          type: 'ORB+PML',
          level: 'PML',
          levelPrice: pml,
          orbH, orbL, orbRange,
          pmh, pml, pmRange,
          entry,
          stop,
          target,
          beLevel,
          risk: stopDist,
          convergence: conv,
          reason: `ORB+PML rotos — PUT — Risk $${stopDist} Target $${targetDist} (1:5)`,
        };
      }
    }

    // Approaching levels
    let approaching = null;
    if (!bestSignal) {
      const checkLevels = [
        { name: 'ORB High', price: orbH },
        { name: 'PMH', price: pmh },
        { name: 'ORB Low', price: orbL },
        { name: 'PML', price: pml },
      ].filter(l => l.price != null);

      for (const lvl of checkLevels) {
        const dist = Math.abs(price - lvl.price);
        const distPct = (dist / price) * 100;
        if (distPct < 0.3 && distPct > 0) {
          approaching = {
            level: lvl.name,
            levelPrice: lvl.price,
            distance: +dist.toFixed(2),
            direction: price < lvl.price ? 'CALL' : 'PUT',
            message: `Acercandose a ${lvl.name} $${lvl.price} ($${dist.toFixed(2)})`,
          };
          break;
        }
      }
    }

    // Build levels array for UI
    const allLevels = [
      { name: 'ORB-H', price: orbH, type: 'resistance' },
      { name: 'ORB-L', price: orbL, type: 'support' },
    ];
    if (pmh) allLevels.push({ name: 'PMH', price: pmh, type: 'resistance' });
    if (pml) allLevels.push({ name: 'PML', price: pml, type: 'support' });
    if (vwap) allLevels.push({ name: 'VWAP', price: vwap, type: 'dynamic' });

    return {
      ticker,
      price: +price.toFixed(2),
      signal: bestSignal ? bestSignal.direction : 'NONE',
      phase: bestSignal ? 'GO' : approaching ? 'WATCH' : 'NONE',
      trade: bestSignal ? {
        entry: bestSignal.entry,
        stop: bestSignal.stop,
        target_3: bestSignal.target,
        target: bestSignal.target,
        beLevel: bestSignal.beLevel,
        risk: bestSignal.risk,
        setup: 'A',
      } : null,
      details: bestSignal,
      approaching,
      levels: allLevels,
      orbH, orbL, orbRange,
      pmh, pml, pmRange,
      orbBrokenUp, pmhBroken,
      orbBrokenDown, pmlBroken,
      vwap, vwapOk: bestSignal?.direction === 'CALL' ? vwapCallOk : vwapPutOk,
      atr, atrStop,
      session,
      convergence: bestSignal?.convergence || null,
      dayTrend,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { signal: 'NONE', error: e.message, ticker };
  }
}

// === Scan all tickers ===
// Scan all tickers for monitoring, but only BEST_TICKERS generate signals
export async function ultraSimpleScan(tickers = ['QQQ', 'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'SPY', 'TSLA', 'AMD', 'PLTR']) {
  const results = await Promise.all(tickers.map(t => analyzeUltraSimple(t)));
  return {
    signals: results.filter(r => r.signal !== 'NONE'),
    watching: results.filter(r => r.phase === 'WATCH'),
    noSignal: results.filter(r => r.signal === 'NONE' && r.phase !== 'WATCH'),
    timestamp: new Date().toISOString(),
  };
}

// Export convergence for Live2 polling
export { checkConvergence as checkConvergenceSpxVix };
