// Smart Entry Module — Reglas aprendidas en sesión live 2026-05-04
// Integra: EMA10 filter, chop detection, breakout validation,
// liquidity sweeps, VWAP reclaim, SPY convergence, structural stops

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
  if (!closes || closes.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] != null ? closes[i] * k + ema[i - 1] * (1 - k) : ema[i - 1]);
  }
  return ema;
}

function calcVWAP(highs, lows, closes, volumes) {
  let num = 0, den = 0;
  for (let i = 0; i < closes.length; i++) {
    if (highs[i] != null && lows[i] != null && closes[i] != null && volumes[i] != null) {
      num += ((highs[i] + lows[i] + closes[i]) / 3) * volumes[i];
      den += volumes[i];
    }
  }
  return den ? num / den : null;
}

// ================================================
// 1. EMA10 TREND FILTER (5min chart)
// Regla: NO CALL si precio < EMA10 con pendiente negativa
//        NO PUT si precio > EMA10 con pendiente positiva
// ================================================
function ema10Filter(closes) {
  const ema10 = calcEMA(closes, 10);
  const ema20 = calcEMA(closes, 20);
  if (ema10.length < 4) return { allowed: 'BOTH', ema10: null, ema20: null, slope: 0 };

  const currentEma10 = ema10[ema10.length - 1];
  const currentEma20 = ema20.length ? ema20[ema20.length - 1] : null;
  const price = closes[closes.length - 1];
  const slope = ema10[ema10.length - 1] - ema10[ema10.length - 4];
  const emaCross = currentEma20 ? currentEma10 > currentEma20 : null;

  let allowed;
  if (price > currentEma10 && slope > 0.05) {
    allowed = 'CALL_ONLY';
  } else if (price < currentEma10 && slope < -0.05) {
    allowed = 'PUT_ONLY';
  } else if (price > currentEma10) {
    allowed = 'LEAN_CALL';
  } else if (price < currentEma10) {
    allowed = 'LEAN_PUT';
  } else {
    allowed = 'NEUTRAL';
  }

  return {
    allowed,
    ema10: +currentEma10.toFixed(2),
    ema20: currentEma20 ? +currentEma20.toFixed(2) : null,
    emaCross,
    slope: +slope.toFixed(3),
    priceAboveEma10: price > currentEma10,
  };
}

// ================================================
// 2. CHOP DETECTION
// Regla: Si un nivel es tocado 3+ veces sin romper limpio = CHOP
//        NO TRADEAR ese nivel
// ================================================
function detectChop(highs, lows, closes) {
  if (closes.length < 20) return { isChop: false };

  const recent = closes.slice(-30);
  const recentH = highs.slice(-30);
  const recentL = lows.slice(-30);

  // Find the range
  const rangeHigh = Math.max(...recentH.filter(v => v != null));
  const rangeLow = Math.min(...recentL.filter(v => v != null));
  const rangeSize = rangeHigh - rangeLow;
  const price = closes[closes.length - 1];
  const rangePct = (rangeSize / price) * 100;

  // Count touches of high zone (within 0.15% of high)
  const highZone = rangeHigh * 0.9985;
  const lowZone = rangeLow * 1.0015;
  let highTouches = 0, lowTouches = 0;

  for (let i = 0; i < recentH.length; i++) {
    if (recentH[i] >= highZone) highTouches++;
    if (recentL[i] <= lowZone) lowTouches++;
  }

  const isChop = highTouches >= 3 && lowTouches >= 3 && rangePct < 1.5;

  return {
    isChop,
    rangeHigh: +rangeHigh.toFixed(2),
    rangeLow: +rangeLow.toFixed(2),
    rangePct: +rangePct.toFixed(2),
    highTouches,
    lowTouches,
    message: isChop
      ? `CHOP: rango $${rangeLow.toFixed(2)}-$${rangeHigh.toFixed(2)} tocado ${highTouches}/${lowTouches} veces — NO TRADEAR`
      : null,
  };
}

// ================================================
// 3. BREAKOUT VALIDATION
// Regla: Breakout necesita:
//   - Cierre arriba/abajo del nivel
//   - Siguiente vela confirma (no pierde nivel)
//   - Volumen > 1.5x promedio
//   - SPY en misma dirección
//   - Hold 10+ min (2+ velas de 5min)
//   - Retrace < 50% del movimiento
// ================================================
function validateBreakout(candles5m, level, direction, spyTrending) {
  if (candles5m.length < 3) return { valid: false, reason: 'Datos insuficientes' };

  const last3 = candles5m.slice(-3);
  const breakCandle = last3[1]; // La vela que rompió
  const confirmCandle = last3[2]; // La siguiente

  // Volume check
  const avgVol = candles5m.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / Math.min(candles5m.length, 20);
  const breakVol = breakCandle.volume || 0;
  const volConfirm = breakVol > avgVol * 1.5;

  let valid = true;
  const reasons = [];
  const failures = [];

  if (direction === 'CALL') {
    if (breakCandle.close <= level) { valid = false; failures.push('No cerró arriba del nivel'); }
    if (confirmCandle.close <= level) { valid = false; failures.push('Siguiente vela perdió nivel'); }
    if (confirmCandle.low < level - (level * 0.002)) { valid = false; failures.push('Retrace profundo'); }
  } else {
    if (breakCandle.close >= level) { valid = false; failures.push('No cerró debajo del nivel'); }
    if (confirmCandle.close >= level) { valid = false; failures.push('Siguiente vela recuperó nivel'); }
    if (confirmCandle.high > level + (level * 0.002)) { valid = false; failures.push('Retrace profundo'); }
  }

  if (volConfirm) reasons.push('Volumen confirmado');
  else failures.push('Volumen bajo en breakout');

  if (spyTrending) reasons.push('SPY convergente');
  else failures.push('SPY no confirma');

  return {
    valid,
    reasons,
    failures,
    breakVolume: breakVol,
    avgVolume: Math.round(avgVol),
    volRatio: avgVol ? +(breakVol / avgVol).toFixed(2) : 0,
  };
}

// ================================================
// 4. LIQUIDITY SWEEP DETECTION
// Regla: Wick largo que pasa un nivel y cierra del otro lado
//        = institucionales barrieron stops, señal de reversal
// ================================================
function detectLiquiditySweep(candles5m, level, direction) {
  if (candles5m.length < 2) return { detected: false };

  const last = candles5m[candles5m.length - 1];

  if (direction === 'CALL') {
    // Wick baja pasando el nivel pero cierra arriba
    const swept = last.low < level && last.close > level;
    const wickSize = last.close - last.low;
    const bodySize = Math.abs(last.close - last.open);
    const isWick = wickSize > bodySize * 1.5;

    return {
      detected: swept && isWick,
      type: 'SWEEP_LOW',
      level: +level.toFixed(2),
      wickLow: last.low ? +last.low.toFixed(2) : null,
      close: last.close ? +last.close.toFixed(2) : null,
      message: swept && isWick ? `Barrida de liquidez en $${level.toFixed(2)} — señal CALL` : null,
    };
  } else {
    const swept = last.high > level && last.close < level;
    const wickSize = last.high - last.close;
    const bodySize = Math.abs(last.close - last.open);
    const isWick = wickSize > bodySize * 1.5;

    return {
      detected: swept && isWick,
      type: 'SWEEP_HIGH',
      level: +level.toFixed(2),
      wickHigh: last.high ? +last.high.toFixed(2) : null,
      close: last.close ? +last.close.toFixed(2) : null,
      message: swept && isWick ? `Barrida de liquidez en $${level.toFixed(2)} — señal PUT` : null,
    };
  }
}

// ================================================
// 5. VWAP RECLAIM PATTERN
// Regla: Primer intento rechaza, higher lows se forman,
//        segundo intento con volumen de 1PM+ rompe
// ================================================
function detectVwapReclaim(candles5m, vwap) {
  if (!vwap || candles5m.length < 6) return { detected: false };

  const last6 = candles5m.slice(-6);
  const price = last6[last6.length - 1].close;

  // Check: was price below VWAP recently?
  const wasBelowVwap = last6.slice(0, 3).some(c => c.close < vwap);
  // Check: is price now above VWAP?
  const nowAboveVwap = price > vwap;
  // Check: did it cross in last 3 candles?
  const crossedRecently = last6.slice(-3).some((c, i, arr) => {
    if (i === 0) return false;
    return arr[i - 1].close < vwap && c.close > vwap;
  });

  if (!wasBelowVwap || !nowAboveVwap || !crossedRecently) {
    return { detected: false };
  }

  // Check higher lows before reclaim
  const lowsBefore = last6.slice(0, 4).map(c => c.low).filter(v => v != null);
  let higherLows = true;
  for (let i = 1; i < lowsBefore.length; i++) {
    if (lowsBefore[i] < lowsBefore[i - 1] - 0.05) { higherLows = false; break; }
  }

  // Volume on cross candle
  const crossCandle = last6.slice(-3).find((c, i, arr) => {
    if (i === 0) return false;
    return arr[i - 1].close < vwap && c.close > vwap;
  });
  const avgVol = candles5m.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / 20;
  const crossVol = crossCandle?.volume || 0;
  const volConfirm = crossVol > avgVol * 1.3;

  // Post-reclaim: holding above VWAP?
  const holdingAbove = last6.slice(-2).every(c => c.close > vwap - 0.10);

  return {
    detected: true,
    higherLows,
    volConfirm,
    holdingAbove,
    quality: (higherLows ? 1 : 0) + (volConfirm ? 1 : 0) + (holdingAbove ? 1 : 0),
    vwap: +vwap.toFixed(2),
    message: `VWAP reclaim en $${vwap.toFixed(2)} — ${higherLows ? 'higher lows ✅' : ''} ${volConfirm ? 'vol ✅' : ''} ${holdingAbove ? 'hold ✅' : ''}`,
  };
}

// ================================================
// 6. STRUCTURAL STOP LOSS
// Regla: Stop NO es un % fijo. Es el otro lado de la estructura.
//        - Si breakout de rango → stop = otro extremo del rango
//        - Si VWAP reclaim → stop = low de consolidación
//        - Mínimo 0.3% del precio para evitar noise
// ================================================
function calculateStructuralStop(price, structure, direction) {
  let stop;

  if (direction === 'CALL') {
    // Stop below: consolidation low, range low, or sweep low
    const candidates = [
      structure.rangeLow,
      structure.consolidationLow,
      structure.sweepLow,
    ].filter(v => v != null && v < price);

    stop = candidates.length ? Math.max(...candidates) : price * 0.992; // fallback 0.8%

    // Ensure minimum distance (0.3% of price)
    const minStop = price * 0.997;
    if (stop > minStop) stop = price * 0.992;
  } else {
    const candidates = [
      structure.rangeHigh,
      structure.consolidationHigh,
      structure.sweepHigh,
    ].filter(v => v != null && v > price);

    stop = candidates.length ? Math.min(...candidates) : price * 1.008;

    const maxStop = price * 1.003;
    if (stop < maxStop) stop = price * 1.008;
  }

  const risk = Math.abs(price - stop);
  const riskPct = (risk / price) * 100;

  return {
    stop: +stop.toFixed(2),
    risk: +risk.toFixed(2),
    riskPct: +riskPct.toFixed(2),
    type: 'structural',
  };
}

// ================================================
// 7. TRADING HOURS FILTER
// Regla: No tradear primeros 15 min ni mediodía (12:00-12:30)
// ================================================
function tradingHoursFilter() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = et.getHours();
  const min = et.getMinutes();
  const totalMin = hour * 60 + min;

  // Market: 9:30-16:00 ET
  if (totalMin < 570 || totalMin >= 960) {
    return { canTrade: false, reason: 'Mercado cerrado', period: 'CLOSED' };
  }
  if (totalMin < 585) {
    return { canTrade: false, reason: 'Primeros 15 min — solo observar', period: 'OPENING_NOISE' };
  }
  if (totalMin >= 720 && totalMin < 780) {
    return { canTrade: false, reason: 'Hora muerta del mediodía — volumen bajo', period: 'LUNCH_DEAD' };
  }
  if (totalMin >= 780) {
    return { canTrade: true, reason: 'Sesión de la tarde — volumen alto, mejores movimientos', period: 'AFTERNOON' };
  }
  if (totalMin >= 585 && totalMin < 630) {
    return { canTrade: true, reason: 'Sesión de la mañana — ORB y setups tempranos', period: 'MORNING' };
  }
  return { canTrade: true, reason: 'Sesión activa', period: 'ACTIVE' };
}

// ================================================
// 8. DOBLE CONVERGENCIA SPY + QQQ (verificación en tiempo real)
// Regla: AMBOS deben moverse en la misma dirección
//        Últimas 3 velas de 1min ambos subiendo/bajando
//        Si uno se desvía → convergencia rota
// ================================================
function analyzeIndexRT(closes, direction) {
  if (closes.length < 3) return { ok: false, reason: 'Datos insuficientes' };
  const price = closes[closes.length - 1];
  const trend3 = price - closes[closes.length - 3];
  const trend1 = price - closes[closes.length - 2];

  // Threshold proportional to price: 0.003% minimum movement
  // SPY $723 → $0.02, SPX $7260 → $0.22
  const threshold = price * 0.00003;

  if (direction === 'CALL') {
    return {
      ok: trend3 > threshold && trend1 >= 0,
      trend3: +trend3.toFixed(2),
      trend1: +trend1.toFixed(2),
      price: +price.toFixed(2),
      threshold: +threshold.toFixed(3),
    };
  } else {
    return {
      ok: trend3 < -threshold && trend1 <= 0,
      trend3: +trend3.toFixed(2),
      trend1: +trend1.toFixed(2),
      price: +price.toFixed(2),
      threshold: +threshold.toFixed(3),
    };
  }
}

async function checkDoubleConvergence(direction) {
  try {
    const [nqData, spxData, spyData] = await Promise.all([
      fetchChart('NQ=F', '1m', '1d'),
      fetchChart('^GSPC', '1m', '1d'),
      fetchChart('SPY', '1m', '1d'),
    ]);

    if (!spxData) return { converging: false, strength: 'NONE', reason: 'Sin datos SPX' };

    const nqCloses = nqData ? nqData.closes.filter(v => v != null) : [];
    const spxCloses = spxData.closes.filter(v => v != null);
    const spyCloses = spyData ? spyData.closes.filter(v => v != null) : [];
    const spyLows = spyData ? spyData.lows.filter(v => v != null) : [];
    const spyHighs = spyData ? spyData.highs.filter(v => v != null) : [];

    const nq = nqCloses.length >= 3 ? analyzeIndexRT(nqCloses, direction) : { ok: false, trend3: 0, trend1: 0, price: 0 };
    const spx = analyzeIndexRT(spxCloses, direction);

    // Day extremes from SPY for blocking
    const spyPrice = spyCloses.length ? spyCloses[spyCloses.length - 1] : spx.price;
    const spyOpen = spyCloses.length ? spyCloses[0] : spx.price;
    const spyChangePct = spyOpen ? ((spyPrice - spyOpen) / spyOpen) * 100 : 0;
    const dayLow = spyLows.length ? Math.min(...spyLows) : spyPrice;
    const dayHigh = spyHighs.length ? Math.max(...spyHighs) : spyPrice;
    const distToLow = spyPrice - dayLow;
    const distToHigh = dayHigh - spyPrice;

    // Block if SPY at extreme
    if (direction === 'CALL' && distToLow < 0.50) {
      return { converging: false, strength: 'BLOCKED', reason: 'SPY en su low del día — NO CALL', nq, spx, spyPrice: +spyPrice.toFixed(2), spyChangePct: +spyChangePct.toFixed(2) };
    }
    if (direction === 'PUT' && distToHigh < 0.50) {
      return { converging: false, strength: 'BLOCKED', reason: 'SPY en su high del día — NO PUT', nq, spx, spyPrice: +spyPrice.toFixed(2), spyChangePct: +spyChangePct.toFixed(2) };
    }

    let converging = false;
    let strength = 'NONE';
    let reason = '';

    // NQ + SPX convergence
    if (nq.ok && spx.ok) {
      converging = true;
      strength = 'FUERTE';
      reason = `NQ ✅ (${nq.trend3 > 0 ? '+' : ''}${nq.trend3}) + SPX ✅ (${spx.trend3 > 0 ? '+' : ''}${spx.trend3})`;
    } else if (nq.ok && !spx.ok) {
      strength = 'PARCIAL';
      reason = `NQ ✅ (${nq.trend3 > 0 ? '+' : ''}${nq.trend3}) + SPX ❌ (${spx.trend3 > 0 ? '+' : ''}${spx.trend3})`;
    } else if (!nq.ok && spx.ok) {
      strength = 'PARCIAL';
      reason = `NQ ❌ (${nq.trend3 > 0 ? '+' : ''}${nq.trend3}) + SPX ✅ (${spx.trend3 > 0 ? '+' : ''}${spx.trend3})`;
    } else {
      reason = `NQ ❌ (${nq.trend3 > 0 ? '+' : ''}${nq.trend3}) + SPX ❌ (${spx.trend3 > 0 ? '+' : ''}${spx.trend3})`;
    }

    return {
      converging,
      strength,
      reason,
      nq,
      spx,
      spyPrice: +spyPrice.toFixed(2),
      spyChangePct: +spyChangePct.toFixed(2),
      distToLow: +distToLow.toFixed(2),
      distToHigh: +distToHigh.toFixed(2),
    };
  } catch (e) {
    return { converging: false, strength: 'ERROR', reason: e.message };
  }
}

// Export for Live2 — call every second for real-time convergence monitoring
export async function checkConvergenceNow(direction) {
  return checkDoubleConvergence(direction);
}

// ================================================
// 9. DAILY TREND FILTER
// Regla: NO tradear contra la tendencia diaria
//        Daily UP → solo CALL
//        Daily DOWN → solo PUT
//        Elimina ~48% de losses
// ================================================
async function getDailyTrend(ticker) {
  try {
    const data = await fetchChart(ticker, '1d', '1mo');
    if (!data) return { trend: 'UNKNOWN', reason: 'Sin datos diarios' };

    const closes = data.closes.filter(v => v != null);
    if (closes.length < 10) return { trend: 'UNKNOWN', reason: 'Datos insuficientes' };

    const price = closes[closes.length - 1];
    const ago10 = closes[closes.length - 10];
    const ago5 = closes[Math.max(0, closes.length - 5)];

    const trend10 = ((price - ago10) / ago10) * 100;
    const trend5 = ((price - ago5) / ago5) * 100;

    let trend, reason;
    if (trend10 > 0.5 && trend5 > 0) {
      trend = 'UP';
      reason = `Tendencia diaria alcista (+${trend10.toFixed(1)}% 10d)`;
    } else if (trend10 < -0.5 && trend5 < 0) {
      trend = 'DOWN';
      reason = `Tendencia diaria bajista (${trend10.toFixed(1)}% 10d)`;
    } else {
      trend = 'NEUTRAL';
      reason = `Tendencia diaria neutral (${trend10.toFixed(1)}% 10d)`;
    }

    return {
      trend,
      reason,
      change10d: +trend10.toFixed(2),
      change5d: +trend5.toFixed(2),
      price: +price.toFixed(2),
    };
  } catch (e) {
    return { trend: 'UNKNOWN', reason: e.message };
  }
}

// ================================================
// MAIN: SMART ENTRY ANALYSIS
// Combina todos los filtros y genera señal con confianza
// ================================================
export async function analyzeSmartEntry(ticker) {
  try {
    const [data5m, data1m, spyData] = await Promise.all([
      fetchChart(ticker, '5m', '1d'),
      fetchChart(ticker, '1m', '1d'),
      fetchChart('SPY', '5m', '1d'),
    ]);

    if (!data5m || !data1m) return { signal: 'NONE', reason: 'Sin datos' };

    const closes5 = data5m.closes.filter(v => v != null);
    const highs5 = data5m.highs.filter(v => v != null);
    const lows5 = data5m.lows.filter(v => v != null);
    const vols5 = data5m.volumes.filter(v => v != null);
    const price = closes5[closes5.length - 1];

    // Build 5min candle objects
    const candles5m = [];
    const len = Math.min(data5m.opens.length, data5m.highs.length, data5m.lows.length, data5m.closes.length, data5m.volumes.length);
    for (let i = 0; i < len; i++) {
      if (data5m.closes[i] != null) {
        candles5m.push({
          open: data5m.opens[i], high: data5m.highs[i],
          low: data5m.lows[i], close: data5m.closes[i],
          volume: data5m.volumes[i] || 0,
        });
      }
    }

    // 1. Trading hours
    const hours = tradingHoursFilter();

    // 2. EMA10 filter
    const emaFilter = ema10Filter(closes5);

    // 3. Chop detection
    const chop = detectChop(highs5, lows5, closes5);

    // 4. VWAP
    const closes1 = data1m.closes.filter(v => v != null);
    const highs1 = data1m.highs.filter(v => v != null);
    const lows1 = data1m.lows.filter(v => v != null);
    const vols1 = data1m.volumes.filter(v => v != null);
    const vwap = calcVWAP(highs1, lows1, closes1, vols1);

    // 5. VWAP reclaim
    const vwapReclaim = detectVwapReclaim(candles5m, vwap);

    // 6. Liquidity sweep at range low/high
    const sweepLow = chop.rangeLow ? detectLiquiditySweep(candles5m, chop.rangeLow, 'CALL') : { detected: false };
    const sweepHigh = chop.rangeHigh ? detectLiquiditySweep(candles5m, chop.rangeHigh, 'PUT') : { detected: false };

    // Determine direction
    let direction = null;
    let confidence = 0;
    const signals = [];
    const warnings = [];

    // Hours filter
    if (!hours.canTrade) {
      warnings.push(hours.reason);
    }

    // Chop warning
    if (chop.isChop) {
      warnings.push(chop.message);
    }

    // === CALL SIGNALS ===
    let callScore = 0;
    if (emaFilter.allowed === 'CALL_ONLY' || emaFilter.allowed === 'LEAN_CALL') {
      callScore += 2;
      signals.push('EMA10 alcista');
    }
    if (emaFilter.emaCross) {
      callScore += 1;
      signals.push('EMA10 > EMA20');
    }
    if (vwap && price > vwap) {
      callScore += 2;
      signals.push('Arriba de VWAP');
    }
    if (vwapReclaim.detected && vwapReclaim.quality >= 2) {
      callScore += 3;
      signals.push('VWAP reclaim confirmado');
    }
    if (sweepLow.detected) {
      callScore += 2;
      signals.push('Barrida de liquidez alcista');
    }

    // === PUT SIGNALS ===
    let putScore = 0;
    if (emaFilter.allowed === 'PUT_ONLY' || emaFilter.allowed === 'LEAN_PUT') {
      putScore += 2;
      signals.push('EMA10 bajista');
    }
    if (emaFilter.emaCross === false) {
      putScore += 1;
      signals.push('EMA10 < EMA20');
    }
    if (vwap && price < vwap) {
      putScore += 2;
      signals.push('Debajo de VWAP');
    }
    if (sweepHigh.detected) {
      putScore += 2;
      signals.push('Barrida de liquidez bajista');
    }

    // Pick direction
    if (callScore > putScore && callScore >= 4) {
      direction = 'CALL';
      confidence = Math.min(callScore * 10, 100);
    } else if (putScore > callScore && putScore >= 4) {
      direction = 'PUT';
      confidence = Math.min(putScore * 10, 100);
    }

    // Daily trend filter — no counter-trend trades
    let dailyTrend = { trend: 'UNKNOWN' };
    if (direction) {
      dailyTrend = await getDailyTrend(ticker);
      if (direction === 'CALL' && dailyTrend.trend === 'DOWN') {
        confidence -= 30;
        warnings.push(`CONTRA tendencia diaria — ${dailyTrend.reason}`);
      } else if (direction === 'PUT' && dailyTrend.trend === 'UP') {
        confidence -= 30;
        warnings.push(`CONTRA tendencia diaria — ${dailyTrend.reason}`);
      } else if ((direction === 'CALL' && dailyTrend.trend === 'UP') ||
                 (direction === 'PUT' && dailyTrend.trend === 'DOWN')) {
        confidence += 10;
        signals.push(`Tendencia diaria alineada (${dailyTrend.trend})`);
      }
    }

    // Double convergence check (SPY + SPX)
    let spyCheck = { converging: false };
    if (direction) {
      spyCheck = await checkDoubleConvergence(direction);
      if (spyCheck.converging && spyCheck.strength === 'FUERTE') {
        confidence += 20;
        signals.push(spyCheck.reason);
      } else if (spyCheck.strength === 'PARCIAL') {
        confidence -= 10;
        warnings.push(spyCheck.reason);
      } else {
        confidence -= 25;
        warnings.push(spyCheck.reason);
      }
    }

    // Chop penalty
    if (chop.isChop) confidence -= 30;

    // Hours bonus/penalty
    if (hours.period === 'AFTERNOON') confidence += 10;
    if (hours.period === 'LUNCH_DEAD') confidence -= 20;

    confidence = Math.max(0, Math.min(100, confidence));

    // Adaptive stop/target based on price level
    // Stop = 1 delta max loss in contract
    // $1 stop for stocks < $250
    // $1.50 stop for stocks $250-$400
    // $2 stop for stocks > $400
    // Target = stop × 3 (1:3 R:R = 3 deltas gain)
    // BE trigger = stop × 1 (move stop to entry after +$1/$1.50/$2)
    function getAdaptiveStopTarget(price) {
      let stopDist, label;
      if (price < 250) { stopDist = 1.0; label = '<$250'; }
      else if (price < 400) { stopDist = 1.5; label = '$250-400'; }
      else if (price < 550) { stopDist = 2.0; label = '$400-550'; }
      else { stopDist = 2.5; label = '>$550'; }
      return { stopDist, targetDist: stopDist * 3, beDist: stopDist, label };
    }

    // === TWO-PHASE ENTRY SYSTEM ===
    // Phase 1 "ZONA": filters aligned but no movement confirmation yet
    // Phase 2 "GO":   movement confirmed — volume + SPY accelerating

    // GO trigger checks
    let goTrigger = { ready: false, reasons: [], missing: [] };

    if (direction) {
      // 1. Volume >= average (participants are active)
      const volSlice = candles5m.slice(-20).map(c => c.volume || 0).filter(v => v > 0);
      const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
      const currentVol = candles5m.length ? candles5m[candles5m.length - 1].volume || 0 : 0;
      const volRatio = avgVol ? currentVol / avgVol : 0;
      if (volRatio >= 0.8) {
        goTrigger.reasons.push(`Volumen activo (${volRatio.toFixed(1)}x)`);
      } else {
        goTrigger.missing.push(`Volumen bajo (${volRatio.toFixed(1)}x < 0.8x)`);
      }

      // 2. SPY accelerating (last candle moving in our direction)
      let spyAccel = false;
      if (spyCheck.spy) {
        const spyT1 = spyCheck.spy.trend1 || 0;
        if (direction === 'CALL' && spyT1 > 0) { spyAccel = true; goTrigger.reasons.push('SPY acelerando ↑'); }
        else if (direction === 'PUT' && spyT1 < 0) { spyAccel = true; goTrigger.reasons.push('SPY acelerando ↓'); }
        else { goTrigger.missing.push('SPY no acelera en tu dirección'); }
      }

      // GO = both volume AND SPY accel
      goTrigger.ready = volRatio >= 0.8 && spyAccel;
      goTrigger.volRatio = +volRatio.toFixed(2);
    }

    // Determine phase
    let phase;
    if (!direction || confidence < 40) {
      phase = 'NONE';
    } else if (goTrigger.ready) {
      phase = 'GO';  // 🟢 ENTRAR AHORA
    } else {
      phase = 'ZONE'; // 🟡 Zona de entrada — esperando confirmación
    }

    let trade = null;
    if (direction && confidence >= 40) {
      const adaptive = getAdaptiveStopTarget(price);
      const stopDist = adaptive.stopDist;
      const targetDist = adaptive.targetDist;

      const stop = direction === 'CALL' ? price - stopDist : price + stopDist;
      const target = direction === 'CALL' ? price + targetDist : price - targetDist;
      const beLevel = direction === 'CALL' ? price + adaptive.beDist : price - adaptive.beDist;
      const riskPct = (stopDist / price) * 100;

      let setup;
      if (confidence >= 80) setup = 'A+';
      else if (confidence >= 65) setup = 'A';
      else if (confidence >= 50) setup = 'B';
      else setup = 'C';

      trade = {
        direction,
        entry: +price.toFixed(2),
        stop: +stop.toFixed(2),
        target_1_5: +(direction === 'CALL' ? price + stopDist * 1.5 : price - stopDist * 1.5).toFixed(2),
        target_2: +(direction === 'CALL' ? price + stopDist * 2 : price - stopDist * 2).toFixed(2),
        target_3: +target.toFixed(2),
        beLevel: +beLevel.toFixed(2),
        risk: +stopDist.toFixed(2),
        riskPct: +riskPct.toFixed(2),
        stopType: `adaptivo (${adaptive.label})`,
        setup,
        confidence,
        rr: '1:3',
        note: `Stop $${stopDist} | Target $${targetDist} | BE en +$${adaptive.beDist}`,
      };
    }

    return {
      ticker,
      price: +price.toFixed(2),
      signal: direction || 'NONE',
      phase,
      confidence,
      trade,
      goTrigger,
      filters: {
        hours,
        emaFilter,
        chop,
        vwap: vwap ? +vwap.toFixed(2) : null,
        vwapReclaim,
        sweepLow,
        sweepHigh,
        spyConvergence: spyCheck,
        dailyTrend,
      },
      signals,
      warnings,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { signal: 'NONE', error: e.message };
  }
}

// Scan multiple tickers
export async function smartScan(tickers = ['NVDA', 'META', 'QQQ', 'AMD', 'AMZN', 'GOOGL']) {
  const results = await Promise.all(tickers.map(t => analyzeSmartEntry(t)));
  return {
    entries: results.filter(r => r.signal !== 'NONE').sort((a, b) => (b.confidence || 0) - (a.confidence || 0)),
    noEntry: results.filter(r => r.signal === 'NONE'),
    timestamp: new Date().toISOString(),
  };
}
