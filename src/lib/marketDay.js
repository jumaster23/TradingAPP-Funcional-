// Market Day Analyzer — Determines if today is tradeable
// Shows market context and recommends max 2 best trades
// User makes final decision based on the context

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval, range) {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
  const res = await fetch(url);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return {
    closes: q.close || [],
    highs: q.high || [],
    lows: q.low || [],
    volumes: q.volume || [],
  };
}

export async function analyzeTradingDay() {
  try {
    const [spyDaily, vixDaily, spyIntra] = await Promise.all([
      fetchChart('SPY', '1d', '1mo'),
      fetchChart('^VIX', '1d', '1mo'),
      fetchChart('SPY', '5m', '1d'),
    ]);

    // VIX
    let vix = 20, vixTrend = 'ESTABLE';
    if (vixDaily) {
      const vc = vixDaily.closes.filter(v => v != null);
      if (vc.length >= 2) {
        vix = vc[vc.length - 1];
        const vixPrev = vc[vc.length - 2];
        vixTrend = vix > vixPrev * 1.05 ? 'SUBIENDO' : vix < vixPrev * 0.95 ? 'BAJANDO' : 'ESTABLE';
      }
    }

    // SPY daily trend
    let spyTrend = 'NEUTRAL', spyClarity = 0;
    if (spyDaily) {
      const sc = spyDaily.closes.filter(v => v != null);
      if (sc.length >= 5) {
        const t5 = ((sc[sc.length - 1] - sc[sc.length - 5]) / sc[sc.length - 5]) * 100;
        const t3 = ((sc[sc.length - 1] - sc[sc.length - 3]) / sc[sc.length - 3]) * 100;
        if (t5 > 0.3 && t3 > 0) { spyTrend = 'UP'; spyClarity = Math.min(Math.abs(t5), 3); }
        else if (t5 < -0.3 && t3 < 0) { spyTrend = 'DOWN'; spyClarity = Math.min(Math.abs(t5), 3); }
        else { spyTrend = 'CHOP'; spyClarity = 0; }
      }
    }

    // Breadth — count tickers trending with SPY
    const TICKERS = ['NVDA', 'META', 'QQQ', 'AMD', 'AMZN', 'GOOGL'];
    let aligned = 0, tickerTrends = {};
    const tickerResults = await Promise.allSettled(
      TICKERS.map(async t => {
        const d = await fetchChart(t, '1d', '1mo');
        if (!d) return { ticker: t, trend: 'UNKNOWN' };
        const c = d.closes.filter(v => v != null);
        if (c.length < 5) return { ticker: t, trend: 'UNKNOWN' };
        const t5 = ((c[c.length - 1] - c[c.length - 5]) / c[c.length - 5]) * 100;
        const t3 = ((c[c.length - 1] - c[c.length - 3]) / c[c.length - 3]) * 100;
        let trend = 'NEUTRAL';
        if (t5 > 0.5 && t3 > 0) trend = 'UP';
        else if (t5 < -0.5 && t3 < 0) trend = 'DOWN';
        return { ticker: t, trend, change5d: +t5.toFixed(1) };
      })
    );

    for (const r of tickerResults) {
      if (r.status === 'fulfilled' && r.value) {
        tickerTrends[r.value.ticker] = r.value;
        if (r.value.trend === spyTrend) aligned++;
      }
    }

    // ORB (first 30 min range)
    let orbRange = 0, spyPrice = 0;
    if (spyIntra) {
      const h = spyIntra.highs.filter(v => v != null);
      const l = spyIntra.lows.filter(v => v != null);
      const c = spyIntra.closes.filter(v => v != null);
      if (h.length >= 6 && l.length >= 6) {
        orbRange = Math.max(...h.slice(0, 6)) - Math.min(...l.slice(0, 6));
      }
      if (c.length) spyPrice = c[c.length - 1];
    }

    // Score the day
    let score = 0;
    const positives = [];
    const negatives = [];

    // VIX
    if (vix >= 14 && vix <= 22) {
      score += 2;
      positives.push(`VIX normal (${vix.toFixed(1)})`);
    } else if (vix > 30) {
      score -= 3;
      negatives.push(`VIX extremo (${vix.toFixed(1)}) — mucha incertidumbre`);
    } else if (vix > 22) {
      score += 1;
      positives.push(`VIX elevado (${vix.toFixed(1)}) — más movimiento`);
    } else {
      score -= 1;
      negatives.push(`VIX bajo (${vix.toFixed(1)}) — poco movimiento esperado`);
    }

    // SPY clarity
    if (spyTrend === 'UP' || spyTrend === 'DOWN') {
      score += 2;
      positives.push(`SPY tendencia clara ${spyTrend === 'UP' ? '📈' : '📉'}`);
    } else {
      score -= 2;
      negatives.push('SPY sin dirección clara (chop)');
    }

    // Breadth
    if (aligned >= 4) {
      score += 2;
      positives.push(`${aligned}/6 tickers alineados con SPY`);
    } else if (aligned >= 2) {
      score += 1;
      positives.push(`${aligned}/6 tickers alineados (parcial)`);
    } else {
      score -= 1;
      negatives.push(`Solo ${aligned}/6 tickers alineados — mercado dividido`);
    }

    // ORB
    if (orbRange > 2) {
      score += 1;
      positives.push(`ORB amplio ($${orbRange.toFixed(2)}) — momentum en apertura`);
    }

    // VIX trend
    if (vixTrend === 'BAJANDO') {
      score += 1;
      positives.push('VIX bajando — miedo disminuye');
    } else if (vixTrend === 'SUBIENDO') {
      score -= 1;
      negatives.push('VIX subiendo — incertidumbre creciente');
    }

    // Determine day quality
    let quality, qualityColor, recommendation;
    if (score >= 5) {
      quality = 'EXCELENTE';
      qualityColor = 'green';
      recommendation = 'Día ideal para tradear. Busca los 2 mejores setups con confianza.';
    } else if (score >= 3) {
      quality = 'BUENO';
      qualityColor = 'green';
      recommendation = 'Día tradeable. Toma los mejores setups, no te fuerces.';
    } else if (score >= 1) {
      quality = 'DIFÍCIL';
      qualityColor = 'yellow';
      recommendation = 'Día complicado. Si tradeas, reduce tamaño de posición y solo el MEJOR setup.';
    } else {
      quality = 'NO TRADEAR';
      qualityColor = 'red';
      recommendation = 'Las condiciones no favorecen. Mejor esperar mañana.';
    }

    return {
      quality,
      qualityColor,
      score,
      recommendation,
      positives,
      negatives,
      vix: +vix.toFixed(1),
      vixTrend,
      spyTrend,
      spyPrice: +spyPrice.toFixed(2),
      breadth: aligned,
      orbRange: +orbRange.toFixed(2),
      tickerTrends,
      maxTrades: quality === 'NO TRADEAR' ? 0 : quality === 'DIFÍCIL' ? 1 : 2,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { quality: 'ERROR', score: 0, recommendation: e.message };
  }
}
