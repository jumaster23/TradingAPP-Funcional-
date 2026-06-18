// Daily Plan — Pre-market analysis for all tickers
// Shows levels, possible entries, and best setups before market opens

const YAHOO_PROXY = '/api/yahoo';

const ALL_TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

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

function getStop(price) {
  if (price < 100) return 0.50;
  if (price < 250) return 1.0;
  if (price < 400) return 1.5;
  if (price < 550) return 2.0;
  return 2.5;
}

export async function generateDailyPlan(tickers = ALL_TICKERS) {
  const plans = [];

  for (const ticker of tickers) {
    try {
      const [daily, prepost] = await Promise.all([
        fetchChart(ticker, '1d', '5d'),
        fetchChart(ticker, '1m', '1d', true),
      ]);

      if (!daily) continue;
      const closes = daily.closes.filter(v => v != null);
      const highs = daily.highs.filter(v => v != null);
      const lows = daily.lows.filter(v => v != null);
      if (closes.length < 2) continue;

      const price = closes[closes.length - 1];
      const pdh = highs[highs.length - 1];
      const pdl = lows[lows.length - 1];
      const pdc = closes[closes.length - 1];

      // Premarket levels
      let pmh = null, pml = null;
      if (prepost) {
        let pmHigh = -Infinity, pmLow = Infinity, count = 0;
        for (let i = 0; i < prepost.timestamps.length; i++) {
          const d = new Date(prepost.timestamps[i] * 1000);
          const total = d.getHours() * 60 + d.getMinutes();
          if (total >= 240 && total < 570) {
            if (prepost.highs[i] != null && prepost.highs[i] > pmHigh) pmHigh = prepost.highs[i];
            if (prepost.lows[i] != null && prepost.lows[i] < pmLow) pmLow = prepost.lows[i];
            count++;
          }
        }
        if (count >= 3 && pmHigh !== -Infinity) {
          pmh = +pmHigh.toFixed(2);
          pml = +pmLow.toFixed(2);
        }
      }

      // Trend
      const t5 = closes.length >= 5 ? ((closes[closes.length-1] - closes[closes.length-5]) / closes[closes.length-5]) * 100 : 0;
      const trend = t5 > 0.5 ? 'UP' : t5 < -0.5 ? 'DOWN' : 'FLAT';

      // Position in range
      const range = pdh - pdl;
      const pos = range > 0 ? ((price - pdl) / range) * 100 : 50;

      // Stop
      const sd = getStop(price);

      // All levels
      const levels = [
        { name: 'PDH', price: +pdh.toFixed(2), type: 'resistance' },
        { name: 'PDL', price: +pdl.toFixed(2), type: 'support' },
      ];
      if (pmh) levels.push({ name: 'PMH', price: pmh, type: 'resistance' });
      if (pml) levels.push({ name: 'PML', price: pml, type: 'support' });

      // Distances to each level
      const distances = levels.map(l => ({
        ...l,
        distance: +Math.abs(price - l.price).toFixed(2),
        distancePct: +((Math.abs(price - l.price) / price) * 100).toFixed(2),
        direction: price < l.price ? 'CALL' : 'PUT',
      })).sort((a, b) => a.distance - b.distance);

      // Best setup = closest level
      const closest = distances[0];

      // CALL entry (at nearest resistance above)
      const callLevel = distances.find(d => d.direction === 'CALL');
      const callEntry = callLevel ? {
        level: callLevel.name,
        entry: callLevel.price,
        sl: +(callLevel.price - sd).toFixed(2),
        tp: +(callLevel.price + sd * 3).toFixed(2),
        be: +(callLevel.price + sd).toFixed(2),
        distance: callLevel.distance,
        distancePct: callLevel.distancePct,
      } : null;

      // PUT entry (at nearest support below)
      const putLevel = distances.find(d => d.direction === 'PUT');
      const putEntry = putLevel ? {
        level: putLevel.name,
        entry: putLevel.price,
        sl: +(putLevel.price + sd).toFixed(2),
        tp: +(putLevel.price - sd * 3).toFixed(2),
        be: +(putLevel.price - sd).toFixed(2),
        distance: putLevel.distance,
        distancePct: putLevel.distancePct,
      } : null;

      // Score
      let score = 0;
      if (closest.distancePct < 0.5) score += 3;
      else if (closest.distancePct < 1.0) score += 2;
      else if (closest.distancePct < 2.0) score += 1;
      if ((closest.direction === 'CALL' && trend === 'UP') || (closest.direction === 'PUT' && trend === 'DOWN')) score += 2;
      if (Math.abs(t5) > 2) score += 1;
      if (pos > 80 || pos < 20) score += 1;

      // What to expect
      let expectation;
      if (pos > 75) expectation = 'Cerró cerca del máximo. Probable: sigue subiendo → buscar CALL en PDH';
      else if (pos < 25) expectation = 'Cerró cerca del mínimo. Probable: sigue bajando → buscar PUT en PDL';
      else if (pos > 40 && pos < 60) expectation = 'Cerró en medio del rango. Esperar dirección del premarket';
      else if (closest.direction === 'CALL') expectation = `Más cerca del máximo. Buscar CALL si rompe $${closest.price}`;
      else expectation = `Más cerca del mínimo. Buscar PUT si pierde $${closest.price}`;

      plans.push({
        ticker,
        price: +price.toFixed(2),
        pdh: +pdh.toFixed(2),
        pdl: +pdl.toFixed(2),
        pmh, pml,
        range: +range.toFixed(2),
        pos: +pos.toFixed(0),
        trend,
        trendPct: +t5.toFixed(1),
        sd,
        levels,
        distances,
        closest,
        callEntry,
        putEntry,
        score,
        expectation,
      });
    } catch (e) {
      console.error(`Plan error for ${ticker}:`, e);
    }
  }

  plans.sort((a, b) => b.score - a.score);

  return {
    plans,
    topPicks: plans.slice(0, 3),
    timestamp: new Date().toISOString(),
    rule: 'Esperar que el precio toque el nivel. NQ + SPX confirman. Entrar. Max 2 trades.',
  };
}

export { ALL_TICKERS };
