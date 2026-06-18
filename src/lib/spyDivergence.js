// SPY Divergence Module — Detects divergence between ticker and SPY/SPX
// Relative strength, RSI divergence, intraday spread tracking

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval = '5m', range = '1d') {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
  const res = await fetch(url);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  const ts = result.timestamp || [];
  return {
    timestamps: ts,
    opens: q.open || [],
    highs: q.high || [],
    lows: q.low || [],
    closes: q.close || [],
    volumes: q.volume || [],
    meta: result.meta || {},
  };
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  const valid = closes.filter(v => v != null);
  if (valid.length < period + 1) return null;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = valid[i] - valid[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < valid.length; i++) {
    const diff = valid[i] - valid[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// Intraday divergence: ticker vs SPY in real-time
export async function getSpyDivergence(ticker) {
  try {
    const [tickerData, spyData] = await Promise.all([
      fetchChart(ticker, '5m', '1d'),
      fetchChart('SPY', '5m', '1d'),
    ]);

    if (!tickerData || !spyData) return { error: 'No data available (market closed?)' };

    const tCloses = tickerData.closes.filter(v => v != null);
    const sCloses = spyData.closes.filter(v => v != null);

    if (tCloses.length < 5 || sCloses.length < 5) return { error: 'Insufficient data' };

    // Align to same length
    const len = Math.min(tCloses.length, sCloses.length);
    const tc = tCloses.slice(-len);
    const sc = sCloses.slice(-len);

    // % change from first bar
    const tPct = tc.map(v => ((v / tc[0]) - 1) * 100);
    const sPct = sc.map(v => ((v / sc[0]) - 1) * 100);

    // Current spread
    const currentSpread = tPct[tPct.length - 1] - sPct[sPct.length - 1];

    // Spread trend (last 5 vs previous 5)
    let spreadTrend = 'STABLE';
    if (tPct.length >= 10) {
      const spreads = tPct.map((v, i) => v - sPct[i]);
      const recent5 = spreads.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const prev5 = spreads.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
      if (recent5 - prev5 > 0.1) spreadTrend = 'WIDENING';
      else if (recent5 - prev5 < -0.1) spreadTrend = 'NARROWING';
    }

    // Correlation
    const tMean = tPct.reduce((a, b) => a + b, 0) / tPct.length;
    const sMean = sPct.reduce((a, b) => a + b, 0) / sPct.length;
    let num = 0, denT = 0, denS = 0;
    for (let i = 0; i < tPct.length; i++) {
      const dt = tPct[i] - tMean;
      const ds = sPct[i] - sMean;
      num += dt * ds;
      denT += dt * dt;
      denS += ds * ds;
    }
    const correlation = denT && denS ? num / Math.sqrt(denT * denS) : 0;

    // Status
    let status, implication;
    if (Math.abs(currentSpread) < 0.3) {
      status = 'EN SINCRONÍA';
      implication = 'NEUTRAL — seguir dirección del mercado';
    } else if (currentSpread > 1.0 && spreadTrend === 'WIDENING') {
      status = 'FUERZA RELATIVA FUERTE';
      implication = 'CALL — juego de momentum, fuerte vs mercado';
    } else if (currentSpread < -1.0 && spreadTrend === 'WIDENING') {
      status = 'DEBILIDAD RELATIVA FUERTE';
      implication = 'PUT — juego de ruptura, débil vs mercado';
    } else if (currentSpread > 0.5 && spreadTrend === 'NARROWING') {
      status = 'FUERZA DESVANECIÉNDOSE';
      implication = 'PRECAUCIÓN — agotamiento de momentum';
    } else if (currentSpread < -0.5 && spreadTrend === 'NARROWING') {
      status = 'RECUPERÁNDOSE';
      implication = 'CALL POTENCIAL — juego de rebote';
    } else if (currentSpread > 0.3) {
      status = 'SUPERANDO A SPY';
      implication = 'LEAN CALL';
    } else {
      status = 'REZAGADO VS SPY';
      implication = 'LEAN PUT';
    }

    return {
      ticker,
      tickerChangePct: +tPct[tPct.length - 1].toFixed(2),
      spyChangePct: +sPct[sPct.length - 1].toFixed(2),
      spreadPct: +currentSpread.toFixed(2),
      spreadTrend,
      correlation: +correlation.toFixed(3),
      status,
      implication,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// RSI divergence detection on daily timeframe
export async function getRsiDivergence(ticker) {
  try {
    const data = await fetchChart(ticker, '1d', '3mo');
    if (!data) return { error: 'No data' };

    const closes = data.closes.filter(v => v != null);
    if (closes.length < 20) return { error: 'Insufficient data' };

    const currentRsi = calcRSI(closes);
    const currentPrice = closes[closes.length - 1];

    // Build RSI series for last 20 bars
    const rsiSeries = [];
    for (let i = 15; i <= closes.length; i++) {
      rsiSeries.push(calcRSI(closes.slice(0, i)));
    }

    // Look for divergence in last 20 bars
    const recent = closes.slice(-20);
    const recentRsi = rsiSeries.slice(-20);
    let activeDivergence = null;

    for (let i = 2; i < recent.length - 2; i++) {
      // Local low → bullish divergence
      if (recent[i] < recent[i - 1] && recent[i] < recent[i - 2] &&
          recent[i] < recent[i + 1] && recent[i] < recent[i + 2]) {
        for (let j = Math.max(0, i - 10); j < i - 2; j++) {
          if (recent[j] < recent[j + 1] && (j === 0 || recent[j] < recent[j - 1])) {
            if (recent[i] < recent[j] && recentRsi[i] > recentRsi[j]) {
              activeDivergence = {
                type: 'BULLISH',
                description: 'Precio mínimo más bajo + RSI mínimo más alto',
                barsAgo: recent.length - i - 1,
              };
            }
          }
        }
      }
      // Local high → bearish divergence
      if (recent[i] > recent[i - 1] && recent[i] > recent[i - 2] &&
          recent[i] > recent[i + 1] && recent[i] > recent[i + 2]) {
        for (let j = Math.max(0, i - 10); j < i - 2; j++) {
          if (recent[j] > recent[j + 1] && (j === 0 || recent[j] > recent[j - 1])) {
            if (recent[i] > recent[j] && recentRsi[i] < recentRsi[j]) {
              activeDivergence = {
                type: 'BEARISH',
                description: 'Precio máximo más alto + RSI máximo más bajo',
                barsAgo: recent.length - i - 1,
              };
            }
          }
        }
      }
    }

    return {
      ticker,
      currentPrice: +currentPrice.toFixed(2),
      currentRsi: currentRsi ? +currentRsi.toFixed(1) : null,
      activeDivergence,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Relative strength vs SPY (daily, 1 month)
export async function getRelativeStrength(ticker) {
  try {
    const [tData, sData] = await Promise.all([
      fetchChart(ticker, '1d', '1mo'),
      fetchChart('SPY', '1d', '1mo'),
    ]);

    if (!tData || !sData) return { error: 'No data' };

    const tc = tData.closes.filter(v => v != null);
    const sc = sData.closes.filter(v => v != null);
    const len = Math.min(tc.length, sc.length);
    if (len < 5) return { error: 'Insufficient data' };

    const tSlice = tc.slice(-len);
    const sSlice = sc.slice(-len);

    const tReturn = ((tSlice[tSlice.length - 1] / tSlice[0]) - 1) * 100;
    const sReturn = ((sSlice[sSlice.length - 1] / sSlice[0]) - 1) * 100;

    // RS ratio normalized
    const rsRatio = tSlice.map((v, i) => v / sSlice[i]);
    const rsNorm = rsRatio.map(v => v / rsRatio[0]);
    const rsCurrent = rsNorm[rsNorm.length - 1];

    // RS trend
    const rsSma5 = rsNorm.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const rsTrend = rsCurrent > rsSma5 ? 'RISING' : 'FALLING';

    return {
      ticker,
      tickerReturnPct: +tReturn.toFixed(2),
      spyReturnPct: +sReturn.toFixed(2),
      outperformancePct: +(tReturn - sReturn).toFixed(2),
      rsCurrent: +rsCurrent.toFixed(4),
      rsTrend,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Full divergence report
export async function fullDivergenceReport(ticker) {
  const [spyDiv, rsiDiv, rs] = await Promise.all([
    getSpyDivergence(ticker),
    getRsiDivergence(ticker),
    getRelativeStrength(ticker),
  ]);
  return { spyDivergence: spyDiv, rsiDivergence: rsiDiv, relativeStrength: rs };
}
