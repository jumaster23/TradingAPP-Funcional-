// 0DTE Scalping Engine — Smart Money + VWAP + Momentum
// 6 Modules: Context, Smart Money, Momentum, Entry, Risk, Scoring
// Tickers: QQQ, SPY | Hours: 9:35-11:00, 14:00-15:30

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval, range) {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return {
    timestamps: result.timestamp || [], opens: q.open || [],
    highs: q.high || [], lows: q.low || [],
    closes: q.close || [], volumes: q.volume || [],
  };
}

// ═══ INDICATORS ═══

function calcEMA(arr, period) {
  if (!arr || arr.length < period) return [];
  const k = 2 / (period + 1); const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) ema.push(arr[i] != null ? arr[i] * k + ema[i - 1] * (1 - k) : ema[i - 1]);
  return ema;
}

function calcRSI(closes, period = 5) {
  if (closes.length < period + 1) return [];
  const rsi = new Array(closes.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = (closes[i] || 0) - (closes[i - 1] || 0);
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
  for (let i = period + 1; i < closes.length; i++) {
    const d = (closes[i] || 0) - (closes[i - 1] || 0);
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
  }
  return rsi;
}

function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
  const emaFast = calcEMA(closes, fast), emaSlow = calcEMA(closes, slow);
  if (emaFast.length < slow || emaSlow.length < slow) return { macd: [], signal: [], histogram: [] };
  const macdLine = emaFast.map((v, i) => emaSlow[i] != null ? +(v - emaSlow[i]).toFixed(4) : null);
  const signalLine = calcEMA(macdLine.filter(v => v != null), sig);
  const padded = new Array(macdLine.length - signalLine.length).fill(null).concat(signalLine);
  const histogram = macdLine.map((v, i) => v != null && padded[i] != null ? +(v - padded[i]).toFixed(4) : null);
  return { macd: macdLine, signal: padded, histogram };
}

function calcATR(highs, lows, closes, period = 14) {
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    if (h == null || l == null || pc == null) { trs.push(null); continue; }
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atr = new Array(closes.length).fill(null);
  const valid = trs.filter(v => v != null);
  if (valid.length < period) return atr;
  let sum = valid.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atr[period] = +sum.toFixed(4);
  for (let i = period; i < trs.length; i++) {
    if (trs[i] != null) { sum = (sum * (period - 1) + trs[i]) / period; atr[i + 1] = +sum.toFixed(4); }
  }
  return atr;
}

function calcVWAP(highs, lows, closes, volumes) {
  const vwaps = []; let num = 0, den = 0;
  for (let i = 0; i < closes.length; i++) {
    if (highs[i] != null && lows[i] != null && closes[i] != null && volumes[i] != null) {
      num += ((highs[i] + lows[i] + closes[i]) / 3) * volumes[i]; den += volumes[i];
    }
    vwaps.push(den ? +(num / den).toFixed(2) : null);
  }
  return vwaps;
}

function getMinET(ts) {
  const d = new Date(ts * 1000);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

function isScalpHour(ts) {
  const m = getMinET(ts);
  return m >= 575 && m < 955; // 9:35 to 3:55 — full session
}

function getSessionLabel() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const m = et.getHours() * 60 + et.getMinutes();
  if (m < 570) return 'PREMARKET';
  if (m >= 575 && m <= 660) return 'MORNING';
  if (m > 660 && m < 840) return 'MIDDAY';
  if (m >= 840 && m <= 930) return 'POWER_HOUR';
  if (m > 930 && m < 960) return 'CLOSE';
  return 'CLOSED';
}

// ═══ MODULE 1: MARKET CONTEXT (5min) ═══

function analyzeContext(data5m) {
  const c = data5m.closes, h = data5m.highs, l = data5m.lows, v = data5m.volumes;
  const len = c.length;
  if (len < 30) return { bias: 'NO_DATA', canTrade: false };

  const vwaps = calcVWAP(h, l, c, v);
  const ema9 = calcEMA(c, 9), ema21 = calcEMA(c, 21), ema200 = calcEMA(c, 200);
  const atr = calcATR(h, l, c, 14);
  const price = c[len - 1], vwap = vwaps[len - 1];
  const e9 = ema9[len - 1], e21 = ema21[len - 1], e200 = ema200.length >= len ? ema200[len - 1] : null;
  const curATR = atr[len - 1];

  // Chop detection: tight range + low ATR
  const rangePct = price ? (curATR / price) * 100 : 0;
  const isChop = rangePct < 0.08;

  // EMAs crossing constantly (last 10 candles, count crosses)
  let emaCrosses = 0;
  for (let i = Math.max(0, len - 10); i < len - 1; i++) {
    if (ema9[i] && ema21[i] && ema9[i + 1] && ema21[i + 1]) {
      if ((ema9[i] > ema21[i]) !== (ema9[i + 1] > ema21[i + 1])) emaCrosses++;
    }
  }

  let bias = 'NEUTRAL';
  if (price > vwap && e9 > e21) bias = 'BULLISH';
  else if (price < vwap && e9 < e21) bias = 'BEARISH';

  const canTrade = !isChop && emaCrosses < 3 && curATR > 0;

  return {
    bias, canTrade, price: +price?.toFixed(2),
    vwap, ema9: +e9?.toFixed(2), ema21: +e21?.toFixed(2), ema200: e200 ? +e200.toFixed(2) : null,
    atr: curATR ? +curATR.toFixed(2) : null, rangePct: +rangePct.toFixed(2),
    isChop, emaCrosses,
    reason: !canTrade ? (isChop ? 'ATR bajo — consolidacion' : emaCrosses >= 3 ? 'EMAs cruzandose — chop' : 'Sin data') : null,
  };
}

// ═══ MODULE 2: SMART MONEY DETECTOR ═══

function detectSmartMoney(data1m, vwap5m) {
  const c = data1m.closes, h = data1m.highs, l = data1m.lows, o = data1m.opens, v = data1m.volumes;
  const len = c.length;
  if (len < 20) return { sweep: null, fvg: null, vwapReclaim: null, orderBlock: null };

  // --- Liquidity Sweep ---
  let sweep = null;
  // Find recent swing high/low (last 20 candles)
  let swingH = -Infinity, swingL = Infinity;
  for (let i = Math.max(0, len - 20); i < len - 1; i++) {
    if (h[i] != null && h[i] > swingH) swingH = h[i];
    if (l[i] != null && l[i] < swingL) swingL = l[i];
  }
  const last = len - 1;
  if (c[last] != null && o[last] != null && h[last] != null && l[last] != null) {
    const body = Math.abs(c[last] - o[last]);
    const wickDown = Math.min(c[last], o[last]) - l[last];
    const wickUp = h[last] - Math.max(c[last], o[last]);
    // Bullish sweep: broke swing low with wick, closed above
    if (l[last] < swingL && c[last] > swingL && wickDown > body * 2) {
      sweep = { type: 'BULLISH_SWEEP', level: +swingL.toFixed(2), wick: +wickDown.toFixed(2) };
    }
    // Bearish sweep: broke swing high with wick, closed below
    if (h[last] > swingH && c[last] < swingH && wickUp > body * 2) {
      sweep = { type: 'BEARISH_SWEEP', level: +swingH.toFixed(2), wick: +wickUp.toFixed(2) };
    }
  }

  // --- Fair Value Gap (FVG) ---
  let fvg = null;
  if (len >= 3) {
    const i = len - 2; // middle candle
    // Bullish FVG: gap between candle[i-1].high and candle[i+1].low
    if (h[i - 1] != null && l[i + 1] != null && l[i + 1] > h[i - 1]) {
      const gapSize = l[i + 1] - h[i - 1];
      if (gapSize > 0.05) fvg = { type: 'BULLISH_FVG', top: +l[i + 1].toFixed(2), bottom: +h[i - 1].toFixed(2), size: +gapSize.toFixed(2) };
    }
    // Bearish FVG: gap between candle[i+1].high and candle[i-1].low
    if (l[i - 1] != null && h[i + 1] != null && h[i + 1] < l[i - 1]) {
      const gapSize = l[i - 1] - h[i + 1];
      if (gapSize > 0.05) fvg = { type: 'BEARISH_FVG', top: +l[i - 1].toFixed(2), bottom: +h[i + 1].toFixed(2), size: +gapSize.toFixed(2) };
    }
  }

  // --- VWAP Reclaim ---
  let vwapReclaim = null;
  if (vwap5m && len >= 6) {
    const wasBelowVwap = c[len - 4] < vwap5m && c[len - 3] < vwap5m;
    const nowAboveVwap = c[last] > vwap5m;
    const crossedUp = wasBelowVwap && nowAboveVwap;
    if (crossedUp) {
      // Check volume on reclaim candle
      const avgVol = v.slice(Math.max(0, len - 20), len).filter(x => x != null && x > 0).reduce((a, b) => a + b, 0) / 20;
      const reclaimVol = v[last] || 0;
      vwapReclaim = { detected: true, vwap: vwap5m, volume: reclaimVol > avgVol * 1.3 ? 'STRONG' : 'WEAK' };
    }
  }

  // --- Order Block ---
  let orderBlock = null;
  if (len >= 5) {
    // Look for last contrary candle before impulse
    const impulse = c[last] - c[len - 3];
    if (Math.abs(impulse) > 0.30) {
      for (let i = len - 4; i >= Math.max(0, len - 10); i--) {
        if (c[i] != null && o[i] != null) {
          const bullishImpulse = impulse > 0 && c[i] < o[i]; // bearish candle before bull impulse
          const bearishImpulse = impulse < 0 && c[i] > o[i]; // bullish candle before bear impulse
          if (bullishImpulse) { orderBlock = { type: 'BULLISH_OB', high: +h[i].toFixed(2), low: +l[i].toFixed(2) }; break; }
          if (bearishImpulse) { orderBlock = { type: 'BEARISH_OB', high: +h[i].toFixed(2), low: +l[i].toFixed(2) }; break; }
        }
      }
    }
  }

  return { sweep, fvg, vwapReclaim, orderBlock };
}

// ═══ MODULE 3: MOMENTUM ENGINE (1min) ═══

function analyzeMomentum(data1m) {
  const c = data1m.closes, v = data1m.volumes;
  const len = c.length;
  if (len < 30) return { rsi: null, macdExpanding: false, rvol: 0, confirmed: null };

  const rsi = calcRSI(c, 5);
  const macd = calcMACD(c, 12, 26, 9);
  const currentRSI = rsi[len - 1];
  const hist = macd.histogram;
  const macdExpanding = hist[len - 1] != null && hist[len - 2] != null && Math.abs(hist[len - 1]) > Math.abs(hist[len - 2]);

  // RVOL
  const avgVol = v.slice(Math.max(0, len - 20), len).filter(x => x != null && x > 0);
  const avg = avgVol.length ? avgVol.reduce((a, b) => a + b, 0) / avgVol.length : 1;
  const rvol = avg ? +((v[len - 1] || 0) / avg).toFixed(2) : 0;

  let confirmed = null;
  if (currentRSI > 55 && macdExpanding && rvol > 1.5) confirmed = 'LONG';
  else if (currentRSI < 45 && macdExpanding && rvol > 1.5) confirmed = 'SHORT';

  return {
    rsi: currentRSI, macdHist: hist[len - 1], macdExpanding,
    rvol, confirmed,
    details: {
      rsiOk: currentRSI > 55 ? 'LONG' : currentRSI < 45 ? 'SHORT' : 'NEUTRAL',
      macdOk: macdExpanding,
      rvolOk: rvol > 1.5,
    },
  };
}

// ═══ MODULE 4: ENTRY CONFIRMATION ═══

function confirmEntry(context, smartMoney, momentum) {
  if (!context.canTrade) return { signal: 'NONE', reason: context.reason || 'Sin contexto' };

  const { sweep, fvg, vwapReclaim } = smartMoney;
  const hasSMSignal = sweep || fvg || vwapReclaim;

  // LONG
  if (context.bias === 'BULLISH' && hasSMSignal) {
    const smBullish = (sweep?.type === 'BULLISH_SWEEP') || (fvg?.type === 'BULLISH_FVG') || vwapReclaim?.detected;
    if (smBullish && (momentum.confirmed === 'LONG' || (momentum.rsi > 50 && momentum.rvol > 1.2))) {
      return { signal: 'CALL', reason: buildReason('CALL', sweep, fvg, vwapReclaim, momentum) };
    }
  }

  // SHORT
  if (context.bias === 'BEARISH' && hasSMSignal) {
    const smBearish = (sweep?.type === 'BEARISH_SWEEP') || (fvg?.type === 'BEARISH_FVG');
    if (smBearish && (momentum.confirmed === 'SHORT' || (momentum.rsi < 50 && momentum.rvol > 1.2))) {
      return { signal: 'PUT', reason: buildReason('PUT', sweep, fvg, vwapReclaim, momentum) };
    }
  }

  // Why no signal
  let reason = '';
  if (!hasSMSignal) reason = 'Sin Smart Money (sweep/FVG/VWAP reclaim)';
  else if (!momentum.confirmed) reason = `Momentum no confirma (RSI ${momentum.rsi}, RVOL ${momentum.rvol})`;
  else reason = `Contexto ${context.bias} no alinea con Smart Money`;

  return { signal: 'NONE', reason };
}

function buildReason(dir, sweep, fvg, vwapReclaim, momentum) {
  const parts = [];
  if (sweep) parts.push(sweep.type.replace('_', ' '));
  if (fvg) parts.push(fvg.type.replace('_', ' '));
  if (vwapReclaim?.detected) parts.push('VWAP Reclaim ' + vwapReclaim.volume);
  parts.push(`RSI ${momentum.rsi}`);
  parts.push(`RVOL ${momentum.rvol}x`);
  return parts.join(' + ');
}

// ═══ MODULE 5: RISK MANAGEMENT ═══

function calculateRisk(price, atr1m, direction) {
  const slDist = Math.min(1.50, Math.max(0.20, (atr1m || 0.50) * 1.2));
  const tp1Dist = slDist;       // 1R
  const tp2Dist = slDist * 2;   // 2R

  if (direction === 'CALL') {
    return {
      entry: +price.toFixed(2),
      sl: +(price - slDist).toFixed(2),
      tp1: +(price + tp1Dist).toFixed(2),
      tp2: +(price + tp2Dist).toFixed(2),
      risk: +slDist.toFixed(2),
      rr: '1:2',
      riskDollars: +(slDist * 40).toFixed(0),
      tp1Dollars: +(tp1Dist * 40).toFixed(0),
      tp2Dollars: +(tp2Dist * 40).toFixed(0),
    };
  } else {
    return {
      entry: +price.toFixed(2),
      sl: +(price + slDist).toFixed(2),
      tp1: +(price - tp1Dist).toFixed(2),
      tp2: +(price - tp2Dist).toFixed(2),
      risk: +slDist.toFixed(2),
      rr: '1:2',
      riskDollars: +(slDist * 40).toFixed(0),
      tp1Dollars: +(tp1Dist * 40).toFixed(0),
      tp2Dollars: +(tp2Dist * 40).toFixed(0),
    };
  }
}

// ═══ MODULE 6: SCORING ═══

function calculateScore(context, smartMoney, momentum, timestamp) {
  let score = 0;
  const breakdown = {};

  // VWAP alignment (20pts)
  if ((context.bias === 'BULLISH' && context.price > context.vwap) ||
      (context.bias === 'BEARISH' && context.price < context.vwap)) {
    score += 20; breakdown.vwap = 20;
  } else { breakdown.vwap = 0; }

  // Liquidity Sweep (20pts)
  if (smartMoney.sweep) { score += 20; breakdown.sweep = 20; }
  else { breakdown.sweep = 0; }

  // FVG (15pts)
  if (smartMoney.fvg) { score += 15; breakdown.fvg = 15; }
  else if (smartMoney.vwapReclaim?.detected) { score += 12; breakdown.fvg = 12; }
  else { breakdown.fvg = 0; }

  // RVOL (15pts)
  if (momentum.rvol >= 2.0) { score += 15; breakdown.rvol = 15; }
  else if (momentum.rvol >= 1.5) { score += 10; breakdown.rvol = 10; }
  else { breakdown.rvol = 0; }

  // RSI (10pts)
  if (momentum.rsi > 55 || momentum.rsi < 45) { score += 10; breakdown.rsi = 10; }
  else if (momentum.rsi > 50 || momentum.rsi < 50) { score += 5; breakdown.rsi = 5; }
  else { breakdown.rsi = 0; }

  // EMA alignment (10pts)
  if (context.ema9 && context.ema21) {
    if ((context.bias === 'BULLISH' && context.ema9 > context.ema21) ||
        (context.bias === 'BEARISH' && context.ema9 < context.ema21)) {
      score += 10; breakdown.ema = 10;
    } else { breakdown.ema = 0; }
  } else { breakdown.ema = 0; }

  // Time window (10pts) — best hours get full, midday gets partial
  if (timestamp) {
    const m = getMinET(timestamp);
    if ((m >= 575 && m <= 660) || (m >= 840 && m <= 930)) { score += 10; breakdown.time = 10; } // morning + power hour
    else if (m >= 660 && m < 840) { score += 5; breakdown.time = 5; } // midday partial
    else if (m >= 575) { score += 7; breakdown.time = 7; } // rest of session
    else { breakdown.time = 0; }
  } else { breakdown.time = 0; }

  let grade = 'C';
  if (score >= 75) grade = 'A+';
  else if (score >= 60) grade = 'B';

  return { score, grade, breakdown };
}

// ═══ CIRCUIT BREAKER ═══
let consecutiveLosses = 0;
let circuitBroken = false;

export function resetCircuitBreaker() { consecutiveLosses = 0; circuitBroken = false; }
export function reportLoss() { consecutiveLosses++; if (consecutiveLosses >= 2) circuitBroken = true; }
export function reportWin() { consecutiveLosses = 0; }

// ═══ MAIN: ANALYZE SCALP ═══

export async function analyzeScalp(ticker) {
  try {
    const [data5m, data1m] = await Promise.all([
      fetchChart(ticker, '5m', '1d'),
      fetchChart(ticker, '1m', '1d'),
    ]);
    if (!data5m || !data1m) return { signal: 'NONE', ticker, reason: 'Sin datos' };

    const session = getSessionLabel();
    const lastTs = data1m.timestamps[data1m.timestamps.length - 1];

    // Module 1: Context
    const context = analyzeContext(data5m);

    // Module 2: Smart Money
    const smartMoney = detectSmartMoney(data1m, context.vwap);

    // Module 3: Momentum
    const momentum = analyzeMomentum(data1m);

    // Module 4: Entry
    const entry = confirmEntry(context, smartMoney, momentum);

    // Module 5: Risk — always calculate potential trade
    const atr1m = calcATR(data1m.highs, data1m.lows, data1m.closes, 14);
    const curATR1m = atr1m[atr1m.length - 1];
    const tradeDir = entry.signal !== 'NONE' ? entry.signal : (context.bias === 'BULLISH' ? 'CALL' : context.bias === 'BEARISH' ? 'PUT' : 'CALL');
    const trade = calculateRisk(context.price, curATR1m, tradeDir);

    // Module 6: Score
    const scoring = calculateScore(context, smartMoney, momentum, lastTs);

    // Circuit breaker
    if (circuitBroken) {
      return {
        ticker, price: context.price, signal: 'NONE',
        phase: 'CIRCUIT_BREAKER', score: 0, grade: 'X',
        reason: '2 losses consecutivas — bot detenido. Resetear manualmente.',
        session, context, smartMoney, momentum, timestamp: new Date().toISOString(),
      };
    }

    // Time filter
    const inWindow = lastTs && isScalpHour(lastTs);

    // Final decision
    let signal = 'NONE', phase = 'WAIT';
    if (entry.signal !== 'NONE' && scoring.grade !== 'C' && inWindow) {
      signal = entry.signal;
      phase = scoring.grade === 'A+' ? 'GO' : 'ZONE';
    } else if (entry.signal !== 'NONE' && scoring.grade !== 'C') {
      phase = 'ZONE'; // signal but wrong time
    }

    return {
      ticker, price: context.price, signal, phase,
      score: scoring.score, grade: scoring.grade,
      trade, context, smartMoney, momentum,
      entry: entry, scoring: scoring.breakdown,
      session, inWindow,
      potentialDir: tradeDir,
      reason: signal === 'NONE' ? entry.reason : entry.reason,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { signal: 'NONE', ticker, error: e.message };
  }
}

// ═══ SCAN ═══

export async function scalpScan(tickers = ['QQQ', 'SPY']) {
  const results = await Promise.all(tickers.map(t => analyzeScalp(t)));
  return {
    signals: results.filter(r => r.signal !== 'NONE'),
    noSignal: results.filter(r => r.signal === 'NONE'),
    circuitBroken,
    timestamp: new Date().toISOString(),
  };
}
