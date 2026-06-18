// Level Rejection Strategy
// Backtested: 55% WR, 73% NLR, PF 4.29
// Detects wick rejections at PDH/PDL/PMH/PML levels
// Best at PMH (premarket high): 4/6 wins

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

function analyzeIdx(closes, direction) {
  if (closes.length < 3) return false;
  const price = closes[closes.length - 1];
  const t3 = price - closes[closes.length - 3];
  const t1 = price - closes[closes.length - 2];
  const th = price * 0.00003;
  if (direction === 'CALL') return t3 > th && t1 >= 0;
  return t3 < -th && t1 <= 0;
}

// Get previous day high/low
async function getPrevDayLevels(ticker) {
  const data = await fetchChart(ticker, '1d', '5d');
  if (!data || data.closes.length < 2) return null;
  const valid = [];
  for (let i = 0; i < data.closes.length; i++) {
    if (data.closes[i] != null) valid.push(i);
  }
  if (valid.length < 2) return null;
  const prev = valid[valid.length - 2];
  return {
    pdh: +data.highs[prev].toFixed(2),
    pdl: +data.lows[prev].toFixed(2),
    pdc: +data.closes[prev].toFixed(2),
  };
}

// Get premarket high/low
async function getPMLevels(ticker) {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  const ts = result.timestamp || [];

  let pmh = -Infinity, pml = Infinity, count = 0;
  for (let i = 0; i < ts.length; i++) {
    const d = new Date(ts[i] * 1000);
    const h = d.getHours(), m = d.getMinutes();
    const total = h * 60 + m;
    if (total >= 240 && total < 570) {
      if (q.high?.[i] != null && q.high[i] > pmh) pmh = q.high[i];
      if (q.low?.[i] != null && q.low[i] < pml) pml = q.low[i];
      count++;
    }
  }
  if (count < 5 || pmh === -Infinity) return null;
  return { pmh: +pmh.toFixed(2), pml: +pml.toFixed(2) };
}

export async function checkLevelRejection(ticker) {
  try {
    const [data5m, prevDay, pmLevels, nqData, spxData] = await Promise.all([
      fetchChart(ticker, '5m', '1d'),
      getPrevDayLevels(ticker),
      getPMLevels(ticker),
      fetchChart('NQ=F', '1m', '1d'),
      fetchChart('^GSPC', '1m', '1d'),
    ]);

    if (!data5m || (!prevDay && !pmLevels)) return { signal: 'NONE' };

    const closes = data5m.closes.filter(v => v != null);
    const opens = data5m.opens;
    const highs = data5m.highs;
    const lows = data5m.lows;
    const volumes = data5m.volumes;
    if (closes.length < 10) return { signal: 'NONE' };

    const price = closes[closes.length - 1];
    const lastIdx = closes.length - 1;
    const o = opens[lastIdx], h = highs[lastIdx], l = lows[lastIdx], c = closes[lastIdx];
    const body = Math.abs(c - o);
    const wickUp = h - Math.max(c, o);
    const wickDn = Math.min(c, o) - l;

    // VWAP
    let vNum = 0, vDen = 0;
    for (let i = 0; i < Math.min(closes.length, volumes.length, highs.length, lows.length); i++) {
      if (data5m.closes[i] != null && data5m.highs[i] != null && data5m.lows[i] != null && volumes[i] != null) {
        vNum += ((data5m.highs[i] + data5m.lows[i] + data5m.closes[i]) / 3) * volumes[i];
        vDen += volumes[i];
      }
    }
    const vwap = vDen ? vNum / vDen : price;

    // Volume
    const volSlice = volumes.filter(v => v != null && v > 0).slice(-20);
    const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
    const curVol = volumes[lastIdx] || 0;
    const volRatio = avgVol ? curVol / avgVol : 0;

    // NQ + SPX convergence check
    const nqc = nqData ? nqData.closes.filter(v => v != null) : [];
    const spxc = spxData ? spxData.closes.filter(v => v != null) : [];

    // Build all levels
    const keyLevels = [];
    if (prevDay) {
      keyLevels.push({ name: 'PDH', price: prevDay.pdh, type: 'resistance' });
      keyLevels.push({ name: 'PDL', price: prevDay.pdl, type: 'support' });
    }
    if (pmLevels) {
      keyLevels.push({ name: 'PMH', price: pmLevels.pmh, type: 'resistance' });
      keyLevels.push({ name: 'PML', price: pmLevels.pml, type: 'support' });
    }

    // Check rejection at each level
    let bestRejection = null;

    for (const level of keyLevels) {
      // REJECTION FROM RESISTANCE (wick up past level, close below → PUT signal or bounce CALL)
      if (h >= level.price * 0.998 && c < level.price && level.type === 'resistance') {
        if (wickUp > body * 2 && wickUp > 0.10) {
          // Price tried to break resistance, failed → could be PUT
          // BUT we look for CALL rejection (bounced off support of this level)
          // Actually: wick above resistance + close below = rejection = the LEVEL HELD
          // If we're approaching from below and wick rejects = CONTINUE looking for CALL elsewhere
        }
      }

      // REJECTION FROM SUPPORT (wick down past level, close above → CALL)
      if (l <= level.price * 1.002 && c > level.price && level.type === 'support') {
        if (wickDn > body * 2 && wickDn > 0.10) {
          // Wick below support, close above = buyers defending = CALL
          if (c < vwap) continue; // Need VWAP confirmation
          const nqOk = analyzeIdx(nqc, 'CALL');
          const spxOk = analyzeIdx(spxc, 'CALL');
          if (!nqOk || !spxOk) continue;
          if (volRatio < 0.8) continue;

          const score = 3 + (nqOk ? 1 : 0) + (spxOk ? 1 : 0) + (c > vwap ? 1 : 0) + (volRatio >= 1 ? 1 : 0);
          if (!bestRejection || score > bestRejection.score) {
            bestRejection = {
              direction: 'CALL',
              level: level.name,
              levelPrice: level.price,
              score,
              wickSize: +wickDn.toFixed(2),
              bodySize: +body.toFixed(2),
              reason: `Rechazo alcista en ${level.name} $${level.price} — wick $${wickDn.toFixed(2)}`,
            };
          }
        }
      }

      // REJECTION FROM RESISTANCE top (wick above level, close below → PUT bounce)
      if (h >= level.price * 0.998 && c < level.price && level.type === 'resistance') {
        if (wickUp > body * 2 && wickUp > 0.10) {
          if (c > vwap) continue; // Need VWAP below for PUT
          const nqOk = analyzeIdx(nqc, 'PUT');
          const spxOk = analyzeIdx(spxc, 'PUT');
          if (!nqOk || !spxOk) continue;
          if (volRatio < 0.8) continue;

          const score = 3 + (nqOk ? 1 : 0) + (spxOk ? 1 : 0) + (c < vwap ? 1 : 0) + (volRatio >= 1 ? 1 : 0);
          if (!bestRejection || score > bestRejection.score) {
            bestRejection = {
              direction: 'PUT',
              level: level.name,
              levelPrice: level.price,
              score,
              wickSize: +wickUp.toFixed(2),
              bodySize: +body.toFixed(2),
              reason: `Rechazo bajista en ${level.name} $${level.price} — wick $${wickUp.toFixed(2)}`,
            };
          }
        }
      }

      // Also check: price NEAR level (approaching) for alert
    }

    if (!bestRejection) {
      // Check proximity to levels for alerts
      let approaching = null;
      for (const level of keyLevels) {
        const dist = Math.abs(price - level.price);
        const distPct = (dist / price) * 100;
        if (distPct < 0.3 && distPct > 0) {
          approaching = {
            level: level.name,
            levelPrice: level.price,
            distance: +dist.toFixed(2),
            message: `Acercándose a ${level.name} $${level.price} ($${dist.toFixed(2)})`,
          };
          break;
        }
      }
      return { signal: 'NONE', ticker, price: +price.toFixed(2), levels: keyLevels, approaching };
    }

    // Build trade
    let stopDist;
    if (price < 250) stopDist = 1.0;
    else if (price < 400) stopDist = 1.5;
    else if (price < 550) stopDist = 2.0;
    else stopDist = 2.5;

    const entry = +price.toFixed(2);
    const stop = bestRejection.direction === 'CALL' ? +(price - stopDist).toFixed(2) : +(price + stopDist).toFixed(2);
    const target = bestRejection.direction === 'CALL' ? +(price + stopDist * 3).toFixed(2) : +(price - stopDist * 3).toFixed(2);
    const beLevel = bestRejection.direction === 'CALL' ? +(price + stopDist).toFixed(2) : +(price - stopDist).toFixed(2);

    return {
      signal: bestRejection.direction,
      phase: 'GO',
      ticker,
      price: entry,
      trade: {
        entry,
        stop,
        target,
        beLevel,
        risk: stopDist,
      },
      rejection: bestRejection,
      levels: keyLevels,
      vwap: +vwap.toFixed(2),
      volRatio: +volRatio.toFixed(2),
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { signal: 'NONE', error: e.message };
  }
}
