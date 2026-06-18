// Market Context Module — Dynamic market bias calculation
// Replaces hardcoded market='BULLISH' with real-time data
// VIX regime, SPY trend, sector breadth, MAG7 direction

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval = '1d', range = '1mo') {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
  const res = await fetch(url);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return {
    closes: (q.close || []).filter(v => v != null),
    highs: (q.high || []).filter(v => v != null),
    lows: (q.low || []).filter(v => v != null),
    volumes: (q.volume || []).filter(v => v != null),
    meta: result.meta || {},
  };
}

function calcEMA(arr, period) {
  if (!arr || arr.length < period) return null;
  const k = 2 / (period + 1);
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return +ema.toFixed(2);
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(1);
}

// VIX analysis
export async function getVixContext() {
  try {
    const data = await fetchChart('^VIX', '1d', '1mo');
    if (!data || !data.closes.length) return { error: 'No VIX data' };

    const current = data.closes[data.closes.length - 1];
    const prev = data.closes.length > 1 ? data.closes[data.closes.length - 2] : current;
    const sma10 = data.closes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(data.closes.length, 10);

    let regime;
    if (current < 15) regime = 'BAJO';
    else if (current < 20) regime = 'NORMAL';
    else if (current < 25) regime = 'ELEVADO';
    else if (current < 30) regime = 'ALTO';
    else regime = 'EXTREMO';

    let trend;
    if (current > sma10 * 1.05) trend = 'SUBIENDO';
    else if (current < sma10 * 0.95) trend = 'BAJANDO';
    else trend = 'ESTABLE';

    return {
      vix: +current.toFixed(2),
      change: +(current - prev).toFixed(2),
      changePct: +((current - prev) / prev * 100).toFixed(2),
      sma10: +sma10.toFixed(2),
      regime,
      trend,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// SPY trend context
export async function getSpyContext() {
  try {
    const data = await fetchChart('SPY', '1d', '3mo');
    if (!data || data.closes.length < 20) return { error: 'No SPY data' };

    const price = data.closes[data.closes.length - 1];
    const sma20 = data.closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = data.closes.length >= 50
      ? data.closes.slice(-50).reduce((a, b) => a + b, 0) / 50
      : null;
    const ema9 = calcEMA(data.closes, 9);
    const rsi = calcRSI(data.closes);

    let trend;
    if (sma50 && price > sma20 && sma20 > sma50) trend = 'BULLISH';
    else if (price > sma20) trend = 'LEAN BULLISH';
    else if (sma50 && price < sma20 && sma20 < sma50) trend = 'BEARISH';
    else if (price < sma20) trend = 'LEAN BEARISH';
    else trend = 'NEUTRAL';

    return {
      price: +price.toFixed(2),
      trend,
      rsi,
      ema9,
      sma20: +sma20.toFixed(2),
      sma50: sma50 ? +sma50.toFixed(2) : null,
      aboveSma20: price > sma20,
      aboveSma50: sma50 ? price > sma50 : null,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Sector breadth — how many sectors green vs red
export async function getSectorBreadth() {
  const sectors = {
    XLK: 'Tech', XLF: 'Financials', XLV: 'Healthcare',
    XLE: 'Energy', XLI: 'Industrials', XLY: 'Consumer Disc',
    XLP: 'Consumer Staples', XLU: 'Utilities', XLRE: 'Real Estate',
    XLC: 'Communication', XLB: 'Materials',
  };

  const results = {};
  let green = 0, red = 0;

  const settled = await Promise.allSettled(
    Object.entries(sectors).map(async ([etf, name]) => {
      const data = await fetchChart(etf, '5m', '1d');
      if (!data || !data.closes.length) return null;
      const first = data.closes[0];
      const last = data.closes[data.closes.length - 1];
      const change = ((last - first) / first) * 100;
      return { name, change: +change.toFixed(2) };
    })
  );

  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) {
      results[s.value.name] = s.value.change;
      if (s.value.change > 0) green++;
      else red++;
    }
  }

  const total = green + red;
  let breadth;
  if (green >= 8) breadth = 'RALLY AMPLIO';
  else if (green >= 5) breadth = 'SELECTIVO';
  else breadth = 'CAÍDA AMPLIA';

  return { sectors: results, greenCount: green, redCount: red, breadth, breadthPct: total ? Math.round(green / total * 100) : 0 };
}

// MAG7 direction — replaces hardcoded mag7='BULLISH'
export async function getMag7Direction() {
  const mag7 = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA'];
  let bull = 0, bear = 0;

  const settled = await Promise.allSettled(
    mag7.map(async ticker => {
      const data = await fetchChart(ticker, '5m', '1d');
      if (!data || data.closes.length < 2) return 'NEUTRAL';
      const first = data.closes[0];
      const last = data.closes[data.closes.length - 1];
      const pct = ((last - first) / first) * 100;
      if (pct > 0.15) return 'BULLISH';
      if (pct < -0.15) return 'BEARISH';
      return 'NEUTRAL';
    })
  );

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      if (s.value === 'BULLISH') bull++;
      else if (s.value === 'BEARISH') bear++;
    }
  }

  return {
    direction: bull > bear ? 'BULLISH' : bear > bull ? 'BEARISH' : 'NEUTRAL',
    bullCount: bull,
    bearCount: bear,
    aligned: Math.max(bull, bear) >= 5,
  };
}

// Full market context — replaces hardcoded values
export async function getFullMarketContext() {
  const [vix, spy, breadth, mag7] = await Promise.all([
    getVixContext(),
    getSpyContext(),
    getSectorBreadth(),
    getMag7Direction(),
  ]);

  // Calculate overall bias
  let bullSignals = 0, bearSignals = 0;

  if (spy.trend?.includes('BULLISH')) bullSignals++;
  if (spy.trend?.includes('BEARISH')) bearSignals++;

  if (spy.rsi > 60) bullSignals++;
  else if (spy.rsi < 40) bearSignals++;

  if (vix.vix < 18) bullSignals++;
  else if (vix.vix > 25) bearSignals++;

  if (breadth.greenCount >= 7) bullSignals++;
  else if (breadth.redCount >= 7) bearSignals++;

  if (mag7.direction === 'BULLISH') bullSignals++;
  else if (mag7.direction === 'BEARISH') bearSignals++;

  let marketBias;
  if (bullSignals >= 4) marketBias = 'BULLISH';
  else if (bearSignals >= 4) marketBias = 'BEARISH';
  else if (bullSignals > bearSignals) marketBias = 'LEAN BULLISH';
  else if (bearSignals > bullSignals) marketBias = 'LEAN BEARISH';
  else marketBias = 'NEUTRAL';

  return {
    marketBias,
    vix,
    spy,
    breadth,
    mag7,
    timestamp: new Date().toISOString(),
  };
}
