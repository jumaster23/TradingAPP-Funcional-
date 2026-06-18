// Order Flow + VWAP + EMA20 Module
// Approximates order flow from candle direction + volume
// Shows VWAP as dynamic support/resistance level
// EMA20 as trend confirmation level

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

export async function getOrderFlow(ticker) {
  try {
    const [data1m, data5m] = await Promise.all([
      fetchChart(ticker, '1m', '1d'),
      fetchChart(ticker, '5m', '1d'),
    ]);

    if (!data5m) return { error: 'Sin datos' };

    const closes = data5m.closes;
    const opens = data5m.opens;
    const highs = data5m.highs;
    const lows = data5m.lows;
    const volumes = data5m.volumes;

    const price = closes.filter(v => v != null).slice(-1)[0] || 0;

    // === EMA20 ===
    const validCloses = closes.filter(v => v != null);
    let ema20 = validCloses[0] || 0;
    const k20 = 2 / 21;
    for (let i = 1; i < validCloses.length; i++) {
      ema20 = validCloses[i] * k20 + ema20 * (1 - k20);
    }
    const ema20Dist = price - ema20;
    const ema20Pct = price ? (ema20Dist / price) * 100 : 0;
    const ema20Role = price > ema20 ? 'SOPORTE' : 'RESISTENCIA';

    // === VWAP ===
    let vwapNum = 0, vwapDen = 0;
    for (let i = 0; i < Math.min(closes.length, volumes.length, highs.length, lows.length); i++) {
      if (closes[i] != null && highs[i] != null && lows[i] != null && volumes[i] != null) {
        vwapNum += ((highs[i] + lows[i] + closes[i]) / 3) * volumes[i];
        vwapDen += volumes[i];
      }
    }
    const vwap = vwapDen ? vwapNum / vwapDen : price;
    const vwapDist = price - vwap;
    const vwapPct = price ? (vwapDist / price) * 100 : 0;
    const vwapRole = price > vwap ? 'SOPORTE' : 'RESISTENCIA';

    // === ORDER FLOW (approximation) ===
    // Buy volume = volume on green candles (close > open)
    // Sell volume = volume on red candles (close < open)
    let buyVol = 0, sellVol = 0;
    let buyCount = 0, sellCount = 0;
    let buyVol5 = 0, sellVol5 = 0; // Last 5 candles
    let buyVol10 = 0, sellVol10 = 0; // Last 10 candles

    const len = Math.min(opens.length, closes.length, volumes.length);
    for (let i = 0; i < len; i++) {
      if (opens[i] == null || closes[i] == null || volumes[i] == null) continue;
      const vol = volumes[i];
      if (closes[i] >= opens[i]) {
        buyVol += vol;
        buyCount++;
        if (i >= len - 5) buyVol5 += vol;
        if (i >= len - 10) buyVol10 += vol;
      } else {
        sellVol += vol;
        sellCount++;
        if (i >= len - 5) sellVol5 += vol;
        if (i >= len - 10) sellVol10 += vol;
      }
    }

    const totalVol = buyVol + sellVol;
    const buyPct = totalVol ? (buyVol / totalVol) * 100 : 50;
    const sellPct = totalVol ? (sellVol / totalVol) * 100 : 50;
    const delta = buyVol - sellVol;
    const deltaPct = totalVol ? (delta / totalVol) * 100 : 0;

    // Recent flow (last 5 and 10 candles)
    const totalVol5 = buyVol5 + sellVol5;
    const buyPct5 = totalVol5 ? (buyVol5 / totalVol5) * 100 : 50;
    const delta5 = buyVol5 - sellVol5;

    const totalVol10 = buyVol10 + sellVol10;
    const buyPct10 = totalVol10 ? (buyVol10 / totalVol10) * 100 : 50;
    const delta10 = buyVol10 - sellVol10;

    // Flow pressure
    let pressure, pressureColor;
    if (buyPct5 >= 65) { pressure = 'COMPRADORES DOMINAN'; pressureColor = 'green'; }
    else if (buyPct5 >= 55) { pressure = 'PRESIÓN COMPRADORA'; pressureColor = 'green'; }
    else if (sellPct >= 65) { pressure = 'VENDEDORES DOMINAN'; pressureColor = 'red'; }
    else if (sellPct >= 55) { pressure = 'PRESIÓN VENDEDORA'; pressureColor = 'red'; }
    else { pressure = 'EQUILIBRADO'; pressureColor = 'yellow'; }

    // Flow trend (is buying increasing or decreasing?)
    let flowTrend;
    if (buyPct5 > buyPct10 + 5) flowTrend = 'COMPRA ACELERANDO';
    else if (buyPct5 < buyPct10 - 5) flowTrend = 'COMPRA FRENANDO';
    else if (sellPct > 60 && buyPct5 < buyPct10) flowTrend = 'VENTA ACELERANDO';
    else flowTrend = 'ESTABLE';

    // Absorption detection: high volume but price didn't move much
    const last5Candles = [];
    for (let i = Math.max(0, len - 5); i < len; i++) {
      if (opens[i] != null && closes[i] != null && volumes[i] != null) {
        last5Candles.push({
          body: Math.abs(closes[i] - opens[i]),
          range: (highs[i] || closes[i]) - (lows[i] || closes[i]),
          volume: volumes[i],
          bullish: closes[i] >= opens[i],
        });
      }
    }

    let absorption = false;
    const avgBody = last5Candles.length ? last5Candles.reduce((s, c) => s + c.body, 0) / last5Candles.length : 0;
    const avgVol5c = last5Candles.length ? last5Candles.reduce((s, c) => s + c.volume, 0) / last5Candles.length : 0;
    // High volume + small body = absorption (someone absorbing the selling/buying)
    if (last5Candles.length >= 3) {
      const lastCandle = last5Candles[last5Candles.length - 1];
      if (lastCandle.volume > avgVol5c * 1.5 && lastCandle.body < avgBody * 0.5) {
        absorption = true;
      }
    }

    return {
      ticker,
      price: +price.toFixed(2),
      // VWAP
      vwap: +vwap.toFixed(2),
      vwapDist: +vwapDist.toFixed(2),
      vwapPct: +vwapPct.toFixed(2),
      vwapRole,
      priceVsVwap: price > vwap ? 'ARRIBA' : 'ABAJO',
      // EMA20
      ema20: +ema20.toFixed(2),
      ema20Dist: +ema20Dist.toFixed(2),
      ema20Pct: +ema20Pct.toFixed(2),
      ema20Role,
      priceVsEma20: price > ema20 ? 'ARRIBA' : 'ABAJO',
      // Order Flow
      buyVol: Math.round(buyVol),
      sellVol: Math.round(sellVol),
      buyPct: +buyPct.toFixed(0),
      sellPct: +sellPct.toFixed(0),
      delta: Math.round(delta),
      deltaPct: +deltaPct.toFixed(1),
      // Recent flow
      buyPct5: +buyPct5.toFixed(0),
      buyPct10: +buyPct10.toFixed(0),
      delta5: Math.round(delta5),
      delta10: Math.round(delta10),
      // Interpretation
      pressure,
      pressureColor,
      flowTrend,
      absorption,
      absorptionNote: absorption ? 'Absorción detectada — volumen alto con movimiento pequeño' : null,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { error: e.message };
  }
}
