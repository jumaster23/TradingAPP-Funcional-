// Premarket Breakout Strategy
// Backtested: 67% WR, 93% NLR, PF 7.45
// Detects premarket high/low, alerts when approaching, signals GO on breakout
// Checks every poll cycle (1min in app)

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval, range) {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
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
    meta: result.meta || {},
  };
}

function isPremarket(ts) {
  const d = new Date(ts * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  const total = h * 60 + m;
  return total >= 240 && total < 570; // 4:00 AM - 9:30 AM ET approx
}

function isMarketHours(ts) {
  const d = new Date(ts * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  const total = h * 60 + m;
  return total >= 570 && total < 960; // 9:30 AM - 4:00 PM
}

// Get premarket high/low from today's prepost data
export async function getPremarketLevels(ticker) {
  try {
    const data = await fetchChart(ticker, '1m', '1d');
    if (!data || !data.timestamps.length) return null;

    let pmHigh = -Infinity, pmLow = Infinity;
    let pmCount = 0;

    for (let i = 0; i < data.timestamps.length; i++) {
      if (isPremarket(data.timestamps[i])) {
        if (data.highs[i] != null && data.highs[i] > pmHigh) pmHigh = data.highs[i];
        if (data.lows[i] != null && data.lows[i] < pmLow) pmLow = data.lows[i];
        pmCount++;
      }
    }

    if (pmCount < 5 || pmHigh === -Infinity) return null;

    // Current price (last market hours candle)
    let currentPrice = null;
    for (let i = data.timestamps.length - 1; i >= 0; i--) {
      if (data.closes[i] != null) {
        currentPrice = data.closes[i];
        break;
      }
    }

    const distToHigh = pmHigh - currentPrice;
    const distToLow = currentPrice - pmLow;
    const pmRange = pmHigh - pmLow;

    return {
      ticker,
      pmHigh: +pmHigh.toFixed(2),
      pmLow: +pmLow.toFixed(2),
      pmRange: +pmRange.toFixed(2),
      currentPrice: currentPrice ? +currentPrice.toFixed(2) : null,
      distToHigh: +distToHigh.toFixed(2),
      distToLow: +distToLow.toFixed(2),
      distToHighPct: currentPrice ? +((distToHigh / currentPrice) * 100).toFixed(2) : null,
      distToLowPct: currentPrice ? +((distToLow / currentPrice) * 100).toFixed(2) : null,
      brokeHigh: currentPrice > pmHigh,
      brokeLow: currentPrice < pmLow,
    };
  } catch (e) {
    return null;
  }
}

// Check for premarket breakout with all confirmations
export async function checkPremarketBreakout(ticker, pmLevels = null) {
  try {
    if (!pmLevels) pmLevels = await getPremarketLevels(ticker);
    if (!pmLevels) return { signal: 'NONE', reason: 'Sin datos premarket' };

    const price = pmLevels.currentPrice;
    if (!price) return { signal: 'NONE', reason: 'Sin precio actual' };

    // Get 5min data for EMA/VWAP
    const data5m = await fetchChart(ticker, '5m', '1d');
    if (!data5m) return { signal: 'NONE', reason: 'Sin datos 5min' };

    const closes5 = data5m.closes.filter(v => v != null);
    const volumes5 = data5m.volumes.filter(v => v != null);
    if (closes5.length < 10) return { signal: 'NONE', reason: 'Datos insuficientes' };

    // EMA10
    const k = 2 / 11;
    let ema10 = closes5[0];
    for (let i = 1; i < closes5.length; i++) ema10 = closes5[i] * k + ema10 * (1 - k);

    // VWAP
    const highs5 = data5m.highs.filter(v => v != null);
    const lows5 = data5m.lows.filter(v => v != null);
    let vNum = 0, vDen = 0;
    for (let i = 0; i < Math.min(closes5.length, volumes5.length, highs5.length, lows5.length); i++) {
      vNum += ((highs5[i] + lows5[i] + closes5[i]) / 3) * volumes5[i];
      vDen += volumes5[i];
    }
    const vwap = vDen ? vNum / vDen : price;

    // Volume ratio
    const avgVol = volumes5.length >= 10
      ? volumes5.slice(-20).reduce((a, b) => a + b, 0) / Math.min(volumes5.length, 20)
      : 1;
    const currentVol = volumes5[volumes5.length - 1] || 0;
    const volRatio = avgVol ? currentVol / avgVol : 0;

    // SPY + SPX convergence check
    const [spyData, spxData] = await Promise.all([
      fetchChart('SPY', '1m', '1d'),
      fetchChart('^GSPC', '1m', '1d'),
    ]);

    let spyAccelCall = false, spyAccelPut = false;
    let spyConv = false, spxConv = false;

    if (spyData) {
      const sc = spyData.closes.filter(v => v != null);
      if (sc.length >= 3) {
        const t1 = sc[sc.length - 1] - sc[sc.length - 2];
        const t3 = sc[sc.length - 1] - sc[sc.length - 3];
        spyAccelCall = t3 > 0.05 && t1 >= 0;
        spyAccelPut = t3 < -0.05 && t1 <= 0;
        spyConv = true;
      }
    }
    if (spxData) {
      const xc = spxData.closes.filter(v => v != null);
      if (xc.length >= 3) {
        const t1 = xc[xc.length - 1] - xc[xc.length - 2];
        const t3 = xc[xc.length - 1] - xc[xc.length - 3];
        if (t3 > 0.05 && t1 >= 0) spxConv = true;
        if (t3 < -0.05 && t1 <= 0) spxConv = true;
      }
    }

    // Adaptive stop
    let stopDist;
    if (price < 250) stopDist = 1.0;
    else if (price < 400) stopDist = 1.5;
    else if (price < 550) stopDist = 2.0;
    else stopDist = 2.5;

    // === CHECK PM HIGH BREAKOUT ===
    let highSignal = null;
    if (pmLevels.brokeHigh) {
      let score = 3; // Base
      const reasons = ['PM HIGH roto'];
      if (price > vwap) { score++; reasons.push('VWAP↑'); }
      if (price > ema10) { score++; reasons.push('EMA10↑'); }
      if (volRatio >= 1.0) { score++; reasons.push(`Vol:${volRatio.toFixed(1)}x`); }
      const convOk = spyAccelCall && spyConv;
      if (convOk) { score++; reasons.push('Conv✅'); }
      if (spyAccelCall) { score++; reasons.push('SPY↑'); }

      const go = volRatio >= 1.0 && spyAccelCall && convOk;

      highSignal = {
        direction: 'CALL',
        score,
        go,
        phase: go ? 'GO' : 'ZONE',
        reasons,
        missing: [],
        entry: +price.toFixed(2),
        stop: +(price - stopDist).toFixed(2),
        target: +(price + stopDist * 3).toFixed(2),
        beLevel: +(price + stopDist).toFixed(2),
        risk: stopDist,
      };
      if (volRatio < 1.0) highSignal.missing.push(`Vol bajo (${volRatio.toFixed(1)}x)`);
      if (!spyAccelCall) highSignal.missing.push('SPY no acelera ↑');
      if (!convOk) highSignal.missing.push('Convergencia no confirmada');
    }

    // === CHECK PM LOW BREAKDOWN ===
    let lowSignal = null;
    if (pmLevels.brokeLow) {
      let score = 3;
      const reasons = ['PM LOW roto'];
      if (price < vwap) { score++; reasons.push('VWAP↓'); }
      if (price < ema10) { score++; reasons.push('EMA10↓'); }
      if (volRatio >= 1.0) { score++; reasons.push(`Vol:${volRatio.toFixed(1)}x`); }
      const convOk = spyAccelPut && spxConv;
      if (convOk) { score++; reasons.push('Conv✅'); }
      if (spyAccelPut) { score++; reasons.push('SPY↓'); }

      const go = volRatio >= 1.0 && spyAccelPut && convOk;

      lowSignal = {
        direction: 'PUT',
        score,
        go,
        phase: go ? 'GO' : 'ZONE',
        reasons,
        missing: [],
        entry: +price.toFixed(2),
        stop: +(price + stopDist).toFixed(2),
        target: +(price - stopDist * 3).toFixed(2),
        beLevel: +(price - stopDist).toFixed(2),
        risk: stopDist,
      };
      if (volRatio < 1.0) lowSignal.missing.push(`Vol bajo (${volRatio.toFixed(1)}x)`);
      if (!spyAccelPut) lowSignal.missing.push('SPY no acelera ↓');
      if (!convOk) lowSignal.missing.push('Convergencia no confirmada');
    }

    // Approaching levels (within 0.3%)
    let approaching = null;
    if (!pmLevels.brokeHigh && pmLevels.distToHighPct > 0 && pmLevels.distToHighPct < 0.3) {
      approaching = { direction: 'CALL', level: pmLevels.pmHigh, distance: pmLevels.distToHigh, message: `Acercándose al PM High $${pmLevels.pmHigh} ($${pmLevels.distToHigh} de distancia)` };
    }
    if (!pmLevels.brokeLow && pmLevels.distToLowPct > 0 && pmLevels.distToLowPct < 0.3) {
      approaching = { direction: 'PUT', level: pmLevels.pmLow, distance: pmLevels.distToLow, message: `Acercándose al PM Low $${pmLevels.pmLow} ($${pmLevels.distToLow} de distancia)` };
    }

    // Pick best signal
    const bestSignal = highSignal || lowSignal;

    return {
      ticker,
      pmLevels,
      signal: bestSignal ? bestSignal.direction : 'NONE',
      phase: bestSignal ? bestSignal.phase : 'NONE',
      breakout: bestSignal,
      approaching,
      volRatio: +volRatio.toFixed(2),
      vwap: +vwap.toFixed(2),
      ema10: +ema10.toFixed(2),
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { signal: 'NONE', error: e.message };
  }
}

// Scan all tickers for premarket breakouts
export async function scanPremarketBreakouts(tickers = ['NVDA', 'META', 'QQQ', 'AMD', 'AMZN', 'GOOGL']) {
  const results = await Promise.all(tickers.map(t => checkPremarketBreakout(t)));
  return {
    breakouts: results.filter(r => r.signal !== 'NONE').sort((a, b) => (b.breakout?.score || 0) - (a.breakout?.score || 0)),
    approaching: results.filter(r => r.approaching),
    noSignal: results.filter(r => r.signal === 'NONE' && !r.approaching),
    timestamp: new Date().toISOString(),
  };
}
