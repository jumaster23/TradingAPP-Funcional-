// Estrategia: Zonas de Demanda para DayTrading
// Basado en lógica proporcionada (adaptado de Python a JS)

// ================================
// 📊 ATR
// ================================
export function calculateATR(data, period = 14) {
  return data.map((row, i, arr) => {
    if (i === 0) return { ...row, ATR: null };
    const prevClose = arr[i - 1].Close;
    const hl = row.High - row.Low;
    const hpc = Math.abs(row.High - prevClose);
    const lpc = Math.abs(row.Low - prevClose);
    const tr = Math.max(hl, hpc, lpc);
    // ATR: media móvil simple
    let atr = null;
    if (i >= period) {
      const trs = arr.slice(i - period + 1, i + 1).map(r => {
        const prevC = arr[arr.indexOf(r) - 1]?.Close ?? r.Close;
        return Math.max(r.High - r.Low, Math.abs(r.High - prevC), Math.abs(r.Low - prevC));
      });
      atr = trs.reduce((a, b) => a + b, 0) / period;
    }
    return { ...row, ATR: atr };
  });
}

// ================================
// 📍 ZONAS
// ================================
export function detectZones(data) {
  const zones = [];
  for (let i = 5; i < data.length - 1; i++) {
    const move = Math.abs(data[i + 1].Close - data[i].Close);
    const atr = data[i].ATR;
    if (atr && move > atr * 1.5) {
      zones.push({
        low: data[i].Low,
        high: data[i].High,
        index: i
      });
    }
  }
  return zones;
}

// ================================
// ⚡ CONFIRMACIÓN
// ================================
export function confirmation(data) {
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  if (!last || !prev) return null;
  if (last.Low < prev.Low && last.Close > prev.Close) return 'BUY';
  if (last.High > prev.High && last.Close < prev.Close) return 'SELL';
  return null;
}

// ================================
// 🌊 LIQUIDITY SWEEP
// ================================
export function detectLiquiditySweep(data) {
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  if (!last || !prev) return null;
  if (last.Low < prev.Low && last.Close > prev.Low) return 'BUY';
  if (last.High > prev.High && last.Close < prev.High) return 'SELL';
  return null;
}

// ================================
// 🎯 ENTRADA
// ================================
export function entryLogic(data1m, data5m) {
  const zones = detectZones(data5m);
  const price = data1m[data1m.length - 1]?.Close;
  let zone = null;
  let inZone = false;
  for (const z of zones) {
    if (z.low <= price && price <= z.high) {
      zone = z;
      inZone = true;
    }
  }
  const direction = confirmation(data1m);
  const sweep = detectLiquiditySweep(data1m);
  return { direction, sweep, price, zone, inZone };
}

// ================================
// 🛑 SL
// ================================
export function calculateSL(zone, atr, direction, price) {
  if (zone) {
    if (direction === 'BUY') return zone.low - atr * 0.3;
    else return zone.high + atr * 0.3;
  } else {
    return direction === 'BUY' ? price - atr : price + atr;
  }
}

// ================================
// 💰 TP
// ================================
export function calculateTP(entry, sl, direction, rr = 3) {
  if (direction === 'BUY') {
    const risk = entry - sl;
    return entry + risk * rr;
  } else {
    const risk = sl - entry;
    return entry - risk * rr;
  }
}

// ================================
// 🧠 SCORE AVANZADO
// ================================
export function calculateScore(direction, sweep, inZone, atrOk, market, mag7, spyConvergence = null) {
  let score = 0;
  if (atrOk) score += 2;
  if (inZone) score += 2;
  if (direction) score += 2;
  if (sweep) score += 2;
  if ((direction === 'BUY' && market === 'BULLISH') || (direction === 'SELL' && market === 'BEARISH')) score += 2;
  if ((direction === 'BUY' && mag7 === 'BULLISH') || (direction === 'SELL' && mag7 === 'BEARISH')) score += 2;
  // SPY convergence bonus: +2 if ticker direction matches SPY direction
  if (spyConvergence) {
    const spyBull = spyConvergence.spyChangePct > 0.1;
    const spyBear = spyConvergence.spyChangePct < -0.1;
    if ((direction === 'BUY' && spyBull) || (direction === 'SELL' && spyBear)) score += 2;
  }
  return score;
}

// ATR validation — checks if ATR is reasonable for the timeframe
export function validateATR(data5m) {
  if (!data5m || data5m.length < 6) return false;
  const last = data5m[data5m.length - 1];
  if (!last || !last.ATR || last.ATR <= 0) return false;
  // ATR should be at least 0.1% of price to be meaningful
  const price = last.Close || 1;
  return last.ATR / price > 0.001;
}

// ================================
// 🏆 SETUP
// ================================
export function classifySetup(score) {
  if (score >= 10) return 'A+';
  if (score >= 8) return 'A';
  if (score >= 6) return 'B';
  return 'C';
}

// ================================
// ⚠️ RIESGO
// ================================
export function riskLevel(score) {
  if (score >= 10) return 'BAJO';
  if (score >= 6) return 'MEDIO';
  return 'ALTO';
}

// ================================
// 💸 POSITION SIZE
// ================================
export function positionSize(balance, riskPercent, entry, sl) {
  const riskAmount = balance * (riskPercent / 100);
  const riskPerShare = Math.abs(entry - sl);
  if (riskPerShare === 0) return 0;
  return Math.round((riskAmount / riskPerShare) * 100) / 100;
}
