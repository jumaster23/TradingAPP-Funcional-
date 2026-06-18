// Previous Day Breakout Strategy
// Backtested: 64% WR, +$16.41 P&L, Avg Win +$3.39, Avg Loss -$1.83
// Best entries: 10:10-10:50 AM
//
// Rules:
// - CALL when price breaks above previous day's high with confirmation
// - PUT when price breaks below previous day's low with confirmation
// - Stop: 0.5% of price
// - Target: 1% of price (R:R 1:2)
// - Min score: 4/8 confirmations
// - Filter: daily trend alignment + SPY convergence

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval, range) {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
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

function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] != null) ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// Get previous day's key levels from daily data
export async function getPrevDayLevels(ticker) {
  try {
    const data = await fetchChart(ticker, '1d', '5d');
    if (!data || data.closes.length < 2) return null;

    // Filter nulls and get last 2 complete days
    const validIdx = [];
    for (let i = 0; i < data.closes.length; i++) {
      if (data.closes[i] != null) validIdx.push(i);
    }
    if (validIdx.length < 2) return null;

    const prevIdx = validIdx[validIdx.length - 2];
    const lastIdx = validIdx[validIdx.length - 1];

    const prevHigh = data.highs[prevIdx];
    const prevLow = data.lows[prevIdx];
    const prevClose = data.closes[prevIdx];
    const prevOpen = data.opens[prevIdx];
    const todayOpen = data.opens[lastIdx];
    const currentPrice = data.closes[lastIdx];

    // Pivot points
    const pivot = (prevHigh + prevLow + prevClose) / 3;
    const r1 = 2 * pivot - prevLow;
    const s1 = 2 * pivot - prevHigh;

    // 5-day high/low
    const last5H = data.highs.filter(v => v != null).slice(-5);
    const last5L = data.lows.filter(v => v != null).slice(-5);

    return {
      prevHigh: +prevHigh.toFixed(2),
      prevLow: +prevLow.toFixed(2),
      prevClose: +prevClose.toFixed(2),
      prevRange: +(prevHigh - prevLow).toFixed(2),
      prevRangePct: +((prevHigh - prevLow) / prevClose * 100).toFixed(2),
      pivot: +pivot.toFixed(2),
      r1: +r1.toFixed(2),
      s1: +s1.toFixed(2),
      high5d: last5H.length ? +Math.max(...last5H).toFixed(2) : null,
      low5d: last5L.length ? +Math.min(...last5L).toFixed(2) : null,
      todayOpen: todayOpen ? +todayOpen.toFixed(2) : null,
      currentPrice: currentPrice ? +currentPrice.toFixed(2) : null,
    };
  } catch (e) {
    return null;
  }
}

// Get daily trend from 30min data
async function getDailyTrend(ticker) {
  try {
    const data = await fetchChart(ticker, '30m', '1mo');
    if (!data) return 'NEUTRAL';
    const closes = data.closes.filter(v => v != null);
    if (closes.length < 20) return 'NEUTRAL';
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const price = closes[closes.length - 1];
    if (ema9 > ema21 && price > ema9) return 'BULLISH';
    if (ema9 < ema21 && price < ema9) return 'BEARISH';
    return 'NEUTRAL';
  } catch {
    return 'NEUTRAL';
  }
}

// Get current intraday data with indicators
async function getIntradayContext(ticker) {
  try {
    const data = await fetchChart(ticker, '5m', '1d');
    if (!data) return null;

    const closes = data.closes.filter(v => v != null);
    const volumes = data.volumes.filter(v => v != null);
    if (closes.length < 15) return null;

    const price = closes[closes.length - 1];
    const open = closes[0];

    // VWAP approximation
    let vwapNum = 0, vwapDen = 0;
    for (let i = 0; i < Math.min(closes.length, volumes.length); i++) {
      if (data.highs[i] != null && data.lows[i] != null && closes[i] != null && volumes[i] != null) {
        const typical = (data.highs[i] + data.lows[i] + closes[i]) / 3;
        vwapNum += typical * volumes[i];
        vwapDen += volumes[i];
      }
    }
    const vwap = vwapDen ? vwapNum / vwapDen : price;

    // EMAs
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);

    // Volume average
    const recentVols = volumes.slice(-20);
    const avgVol = recentVols.length ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : 0;
    const currentVol = volumes[volumes.length - 1] || 0;
    const relVolume = avgVol ? currentVol / avgVol : 1;

    // Previous candle pattern
    const len = closes.length;
    const prevCandleBullish = len >= 2 ? closes[len - 2] > (data.opens[len - 2] || closes[len - 3] || closes[len - 2]) : false;

    return {
      price: +price.toFixed(2),
      open: +open.toFixed(2),
      changePct: +((price - open) / open * 100).toFixed(2),
      vwap: +vwap.toFixed(2),
      aboveVwap: price > vwap,
      ema9: ema9 ? +ema9.toFixed(2) : null,
      ema21: ema21 ? +ema21.toFixed(2) : null,
      emaBullish: ema9 && ema21 ? ema9 > ema21 : null,
      relVolume: +relVolume.toFixed(2),
      highVolume: relVolume > 1.5,
    };
  } catch {
    return null;
  }
}

// Score a potential breakout
function scoreBreakout(direction, levels, intraday, spyPct, dailyTrend) {
  let score = 0;
  const reasons = [];

  // Base: breakout itself = 3 points (strong signal)
  if (direction === 'CALL' && intraday.price > levels.prevHigh) {
    score += 3;
    reasons.push('rompe_máx_anterior');
  } else if (direction === 'PUT' && intraday.price < levels.prevLow) {
    score += 3;
    reasons.push('rompe_mín_anterior');
  } else {
    return { score: 0, reasons: ['sin_rompimiento'] };
  }

  // VWAP alignment
  if ((direction === 'CALL' && intraday.aboveVwap) || (direction === 'PUT' && !intraday.aboveVwap)) {
    score += 1;
    reasons.push('vwap_alineado');
  }

  // EMA alignment
  if ((direction === 'CALL' && intraday.emaBullish) || (direction === 'PUT' && intraday.emaBullish === false)) {
    score += 1;
    reasons.push('ema_alineado');
  }

  // Volume confirmation
  if (intraday.highVolume) {
    score += 2;
    reasons.push('volumen_confirmado');
  }

  // Daily trend alignment
  if ((direction === 'CALL' && dailyTrend !== 'BEARISH') || (direction === 'PUT' && dailyTrend !== 'BULLISH')) {
    score += 1;
    reasons.push('tendencia_alineada');
  }

  // SPY convergence
  if ((direction === 'CALL' && spyPct > 0.1) || (direction === 'PUT' && spyPct < -0.1)) {
    score += 1;
    reasons.push('spy_convergente');
  }

  return { score, reasons };
}

// Main: Check for breakout signal
export async function checkBreakoutSignal(ticker) {
  try {
    const [levels, intraday, dailyTrend, spyIntraday] = await Promise.all([
      getPrevDayLevels(ticker),
      getIntradayContext(ticker),
      getDailyTrend(ticker),
      getIntradayContext('SPY'),
    ]);

    if (!levels || !intraday) {
      return { signal: 'NONE', reason: 'No data available' };
    }

    const spyPct = spyIntraday?.changePct || 0;
    const price = intraday.price;
    const stopPct = 0.5;
    const rr = 2;

    // Check CALL breakout
    const callScore = scoreBreakout('CALL', levels, intraday, spyPct, dailyTrend);

    // Check PUT breakout
    const putScore = scoreBreakout('PUT', levels, intraday, spyPct, dailyTrend);

    // Pick the stronger signal (min score 4)
    let bestSignal = null;
    let bestScoreData = null;

    if (callScore.score >= 4 && callScore.score >= putScore.score) {
      bestSignal = 'CALL';
      bestScoreData = callScore;
    } else if (putScore.score >= 4) {
      bestSignal = 'PUT';
      bestScoreData = putScore;
    }

    if (!bestSignal) {
      // Check proximity to levels (pre-breakout alert)
      const distToHigh = ((levels.prevHigh - price) / price) * 100;
      const distToLow = ((price - levels.prevLow) / price) * 100;

      let watchAlert = null;
      if (distToHigh > 0 && distToHigh < 0.3) {
        watchAlert = { direction: 'CALL', level: levels.prevHigh, distance: +distToHigh.toFixed(2), message: `Acercándose al máximo del día anterior $${levels.prevHigh} (${distToHigh.toFixed(2)}% de distancia)` };
      } else if (distToLow > 0 && distToLow < 0.3) {
        watchAlert = { direction: 'PUT', level: levels.prevLow, distance: +distToLow.toFixed(2), message: `Acercándose al mínimo del día anterior $${levels.prevLow} (${distToLow.toFixed(2)}% de distancia)` };
      }

      return {
        signal: 'NONE',
        ticker,
        price,
        levels,
        intraday,
        dailyTrend,
        spyPct: +spyPct.toFixed(2),
        watchAlert,
        callScore: callScore.score,
        putScore: putScore.score,
      };
    }

    // Build trade
    const stopAmt = price * (stopPct / 100);
    const targetAmt = stopAmt * rr;

    const entry = price;
    const sl = bestSignal === 'CALL' ? entry - stopAmt : entry + stopAmt;
    const tp = bestSignal === 'CALL' ? entry + targetAmt : entry - targetAmt;
    const riskPct = stopPct;
    const rewardPct = +(stopPct * rr).toFixed(2);

    // Setup grade
    const score = bestScoreData.score;
    const setup = score >= 7 ? 'A+' : score >= 6 ? 'A' : score >= 5 ? 'B' : 'C';
    const risk = score >= 6 ? 'LOW' : score >= 4 ? 'MEDIUM' : 'HIGH';

    return {
      signal: bestSignal,
      ticker,
      price: +entry.toFixed(2),
      entry: +entry.toFixed(2),
      sl: +sl.toFixed(2),
      tp: +tp.toFixed(2),
      riskPct,
      rewardPct,
      rr: `1:${rr}`,
      score,
      setup,
      risk,
      reasons: bestScoreData.reasons,
      levels,
      dailyTrend,
      spyPct: +spyPct.toFixed(2),
      intraday,
      breakoutLevel: bestSignal === 'CALL' ? levels.prevHigh : levels.prevLow,
      breakoutType: bestSignal === 'CALL' ? 'Rompimiento del Máximo del Día Anterior' : 'Rompimiento del Mínimo del Día Anterior',
    };
  } catch (e) {
    return { signal: 'NONE', error: e.message };
  }
}

// Scan all tickers for breakout signals
export async function scanBreakouts(tickers = ['NVDA', 'META', 'QQQ', 'AMD', 'AMZN', 'GOOGL']) {
  const results = await Promise.all(tickers.map(t => checkBreakoutSignal(t)));
  const signals = results.filter(r => r.signal !== 'NONE');
  const watches = results.filter(r => r.signal === 'NONE' && r.watchAlert);

  return {
    signals: signals.sort((a, b) => (b.score || 0) - (a.score || 0)),
    watches,
    noSignal: results.filter(r => r.signal === 'NONE' && !r.watchAlert),
    timestamp: new Date().toISOString(),
  };
}
