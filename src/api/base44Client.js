const LOCAL_ENTITY_KEY = '__trading_bot_local_entities_v1__';
const LLM_BLOCK_UNTIL_KEY = '__trading_bot_llm_block_until__';
const OPTIONS_BLOCK_UNTIL_KEY = '__trading_bot_options_block_until__';
const YAHOO_OPTIONS_BLOCK_UNTIL_KEY = '__trading_bot_yahoo_options_block_until__';
let optionsFetchBlockedUntil = 0;
let yahooOptionsBlockedUntil = 0;
let llmBlockedUntil = 0;

function readBlockUntil(key) {
  try {
    const raw = localStorage.getItem(key);
    const ts = Number(raw || 0);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeBlockUntil(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore storage errors
  }
}

function setLlmBlock(ms) {
  llmBlockedUntil = Date.now() + ms;
  writeBlockUntil(LLM_BLOCK_UNTIL_KEY, llmBlockedUntil);
}

function setOptionsBlock(ms) {
  optionsFetchBlockedUntil = Date.now() + ms;
  writeBlockUntil(OPTIONS_BLOCK_UNTIL_KEY, optionsFetchBlockedUntil);
}

function setYahooOptionsBlock(ms) {
  yahooOptionsBlockedUntil = Date.now() + ms;
  writeBlockUntil(YAHOO_OPTIONS_BLOCK_UNTIL_KEY, yahooOptionsBlockedUntil);
}

function buildLocalLlmFallback() {
  return {
    _is_fallback: true,
    signal: 'NEUTRAL',
    success_probability: 50,
    analysis_summary: 'No se pudo consultar el modelo de IA en este momento. Se muestra un fallback local.',
    market_context: 'Fallback local activo por indisponibilidad temporal de OpenRouter.',
  };
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getStore() {
  const raw = localStorage.getItem(LOCAL_ENTITY_KEY);
  return raw ? safeJsonParse(raw, {}) : {};
}

function saveStore(store) {
  localStorage.setItem(LOCAL_ENTITY_KEY, JSON.stringify(store));
}

function getCollection(name) {
  const store = getStore();
  if (!Array.isArray(store[name])) store[name] = [];
  saveStore(store);
  return store[name];
}

function setCollection(name, records) {
  const store = getStore();
  store[name] = records;
  saveStore(store);
}

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toNum(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toLooseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseOccExpiryFromSymbol(symbol) {
  const s = String(symbol || '');
  const m = s.match(/(\d{6})[CP]/i);
  if (!m) return null;
  const yy = Number(m[1].slice(0, 2));
  const mm = Number(m[1].slice(2, 4));
  const dd = Number(m[1].slice(4, 6));
  if (!yy || !mm || !dd) return null;
  const year = 2000 + yy;
  const dt = new Date(Date.UTC(year, mm - 1, dd, 20, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function pickOptionGamma(opt, spotPrice, strictRealGamma = false) {
  const direct = toLooseNumber(opt?.gamma)
    ?? toLooseNumber(opt?.greeks?.gamma)
    ?? toLooseNumber(opt?.optionGreeks?.gamma)
    ?? toLooseNumber(opt?.gamma_value);
  if (direct != null && direct >= 0) return { gamma: direct, estimated: false };
  if (strictRealGamma) return { gamma: null, estimated: true };

  const strike = toLooseNumber(opt?.strike_price ?? opt?.strike);
  const iv = toLooseNumber(opt?.impliedVolatility)
    ?? toLooseNumber(opt?.iv)
    ?? toLooseNumber(opt?.volatility)
    ?? 0.25;
  const spot = toLooseNumber(spotPrice);
  if (!strike || !spot || spot <= 0) return { gamma: null, estimated: true };

  const moneyness = Math.abs((strike - spot) / spot);
  const nearAtmFactor = Math.exp(-Math.pow(moneyness / 0.12, 2));
  const ivFactor = Math.max(0.2, Math.min(2, (iv || 0.25) / 0.25));
  const proxyGamma = 0.01 * nearAtmFactor * ivFactor;
  return { gamma: Number(proxyGamma.toFixed(6)), estimated: true };
}

function getWallsFromOptionRows(optionRows = []) {
  const callOI = {};
  const putOI = {};
  optionRows.forEach((opt) => {
    const type = String(opt?.type || '').toLowerCase();
    const code = String(opt?.option || '');
    const isCall = type === 'call' || type === 'c' || /C\d{6,}/.test(code);
    const isPut = type === 'put' || type === 'p' || /P\d{6,}/.test(code);
    const strike = toLooseNumber(opt?.strike_price ?? opt?.strike);
    const oi = toLooseNumber(opt?.open_interest);
    if (!strike || !oi) return;
    if (isCall) callOI[strike] = (callOI[strike] || 0) + oi;
    if (isPut) putOI[strike] = (putOI[strike] || 0) + oi;
  });

  const callKeys = Object.keys(callOI);
  const putKeys = Object.keys(putOI);
  const callWall = callKeys.length
    ? Number(callKeys.reduce((a, b) => (callOI[a] > callOI[b] ? a : b)))
    : null;
  const putWall = putKeys.length
    ? Number(putKeys.reduce((a, b) => (putOI[a] > putOI[b] ? a : b)))
    : null;
  return { callWall, putWall };
}

function calculateInstitutionalGex(optionRows = [], spotPrice, strictRealGamma = false) {
  const spot = toLooseNumber(spotPrice);
  if (!spot || spot <= 0) {
    return {
      totalGex: null,
      volGex: null,
      deltaExposure: null,
      gexByStrike: {},
      gammaFlip: null,
      cumulativeByStrike: {},
      gexEstimatedCount: 0,
      gexDirectCount: 0,
      gex0dte: null,
      gexEx0dte: null,
    };
  }

  let totalGex = 0;
  let volGex = 0;
  let deltaExposure = 0;
  let gexEstimatedCount = 0;
  let gexDirectCount = 0;
  let gex0dte = 0;
  let gexEx0dte = 0;
  const gexByStrikeMap = {};

  const now = Date.now();
  const endOfTodayUtc = new Date();
  endOfTodayUtc.setUTCHours(23, 59, 59, 999);

  optionRows.forEach((opt) => {
    const strike = toLooseNumber(opt?.strike_price ?? opt?.strike);
    const oi = toLooseNumber(opt?.open_interest);
    if (!strike || !oi) return;

    const type = String(opt?.type || '').toLowerCase();
    const code = String(opt?.option || '');
    const isPut = type === 'put' || type === 'p' || /P\d{6,}/.test(code);
    const isCall = type === 'call' || type === 'c' || /C\d{6,}/.test(code);
    if (!isPut && !isCall) return;

    const { gamma, estimated } = pickOptionGamma(opt, spot, strictRealGamma);
    if (gamma == null) return;

    let gex = gamma * oi * 100 * spot * spot;
    if (isPut) gex *= -1;
    totalGex += gex;

    const iv = toLooseNumber(opt?.impliedVolatility)
      ?? toLooseNumber(opt?.iv)
      ?? toLooseNumber(opt?.volatility)
      ?? 0.25;
    volGex += gex * iv;

    let delta = toLooseNumber(opt?.delta)
      ?? toLooseNumber(opt?.greeks?.delta)
      ?? toLooseNumber(opt?.optionGreeks?.delta)
      ?? null;
    if (delta == null) {
      const m = (strike - spot) / spot;
      delta = isCall ? (m <= 0 ? 0.6 : 0.35) : (m >= 0 ? -0.6 : -0.35);
    }
    deltaExposure += delta * oi * 100 * spot;

    const key = Number(strike).toFixed(2);
    gexByStrikeMap[key] = (gexByStrikeMap[key] || 0) + gex;

    if (estimated) gexEstimatedCount += 1;
    else gexDirectCount += 1;

    const expiry = parseOccExpiryFromSymbol(opt?.option);
    if (expiry) {
      if (expiry.getTime() >= now && expiry.getTime() <= endOfTodayUtc.getTime()) gex0dte += gex;
      else gexEx0dte += gex;
    }
  });

  const sortedStrikes = Object.keys(gexByStrikeMap).map(Number).sort((a, b) => a - b);
  let cumulative = 0;
  let gammaFlip = null;
  const cumulativeByStrike = {};
  sortedStrikes.forEach((s) => {
    const k = Number(s).toFixed(2);
    cumulative += gexByStrikeMap[k] || 0;
    cumulativeByStrike[k] = cumulative;
    if (gammaFlip == null && cumulative > 0) gammaFlip = Number(s);
  });

  return {
    totalGex: Number(totalGex.toFixed(2)),
    volGex: Number(volGex.toFixed(2)),
    deltaExposure: Number(deltaExposure.toFixed(2)),
    gexByStrike: gexByStrikeMap,
    gammaFlip,
    cumulativeByStrike,
    gexEstimatedCount,
    gexDirectCount,
    gex0dte: Number(gex0dte.toFixed(2)),
    gexEx0dte: Number(gexEx0dte.toFixed(2)),
  };
}

function getEtParts(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = f.formatToParts(d).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const minutesSinceMidnight = Number(parts.hour || '0') * 60 + Number(parts.minute || '0');
  return { dateKey, minutesSinceMidnight };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options).catch(() => null);
  if (res?.ok) return res.json();
  const status = res?.status || 'network';
  throw new Error(`No se pudo consultar endpoint (${status}): ${url}`);
}

function calcEMA(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i += 1) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return Number(ema.toFixed(2));
}

function calcRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - (100 / (1 + rs))).toFixed(2));
}

function calcBollingerBands(closes, period = 20, mult = 2) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const recent = closes.slice(-period);
  const mean = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + mult * stdDev;
  const lower = mean - mult * stdDev;
  const lastPrice = closes[closes.length - 1];
  const pctB = upper !== lower ? (lastPrice - lower) / (upper - lower) : 0.5;
  const bandwidth = ((upper - lower) / mean) * 100;

  // Squeeze: bandwidth < 2% indicates low volatility / potential breakout
  const squeeze = bandwidth < 2;
  // Expansion: bandwidth > 5% indicates strong trend
  const expansion = bandwidth > 5;

  let signal = 'NEUTRAL';
  let interpretation = '';
  let strategy = '';

  if (pctB >= 1.0) {
    signal = 'OVERBOUGHT';
    interpretation = 'Precio sobre la banda superior — sobrecomprado. Posible retroceso.';
    strategy = 'Buscar PUT con confirmación: RSI sobrecomprado, volumen bajista, confluencia VIX/Gamma. NO entrar solo por tocar la banda.';
  } else if (pctB <= 0.0) {
    signal = 'OVERSOLD';
    interpretation = 'Precio bajo la banda inferior — sobrevendido. Posible rebote.';
    strategy = 'Buscar CALL con confirmación: RSI sobrevendido, volumen alcista, confluencia VIX/Gamma. NO entrar solo por tocar la banda.';
  } else if (squeeze) {
    signal = 'SQUEEZE';
    interpretation = 'Bandas muy juntas — baja volatilidad. Se espera movimiento fuerte próximamente.';
    strategy = 'ESPERAR ruptura confirmada del ORB o banda. Entrar en la dirección del breakout con volumen. Evitar operar dentro del rango.';
  } else if (expansion) {
    signal = 'TRENDING';
    interpretation = 'Bandas expandidas — mercado en tendencia fuerte. El precio puede caminar por la banda.';
    strategy = 'Seguir la tendencia, NO ir en contra. Si camina por banda superior → CALL en pullbacks. Si camina por banda inferior → PUT en rebotes.';
  } else if (pctB > 0.6) {
    signal = 'NEAR_UPPER';
    interpretation = 'Precio acercándose a banda superior — monitorear.';
    strategy = 'Esperar toque o perforación de banda superior con confirmación para evaluar PUT.';
  } else if (pctB < 0.4) {
    signal = 'NEAR_LOWER';
    interpretation = 'Precio acercándose a banda inferior — monitorear.';
    strategy = 'Esperar toque o perforación de banda inferior con confirmación para evaluar CALL.';
  } else {
    signal = 'NEUTRAL';
    interpretation = 'Precio dentro de las bandas en zona media — sin señal clara de BB.';
    strategy = 'Esperar que el precio se acerque a una banda o que ocurra un squeeze antes de actuar.';
  }

  return {
    upper: parseFloat(upper.toFixed(2)),
    middle: parseFloat(mean.toFixed(2)),
    lower: parseFloat(lower.toFixed(2)),
    bandwidth: parseFloat(bandwidth.toFixed(2)),
    pct_b: parseFloat(pctB.toFixed(3)),
    std_dev: parseFloat(stdDev.toFixed(2)),
    squeeze,
    expansion,
    signal,
    interpretation,
    strategy,
  };
}

async function fetchYahooChart(ticker, interval, range, includePrePost = false) {
  let url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  if (includePrePost) url += '&includePrePost=true';
  const json = await fetchJson(url, {
    headers: { Accept: 'application/json' },
  });
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo sin datos para ${ticker}`);
  return result;
}

async function invokeGetStockPrice({ ticker }) {
  const t = String(ticker || '').toUpperCase();
  if (!t) throw new Error('Ticker requerido');

  const [daily, intraday] = await Promise.all([
    fetchYahooChart(t, '1d', '5d'),
    fetchYahooChart(t, '1m', '1d', true).catch(() => null),
  ]);

  const quote = daily?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];
  const validCloses = closes.filter((v) => v != null);

  const prev_close = validCloses.length >= 2 ? Number(validCloses[validCloses.length - 2].toFixed(2)) : toNum(daily?.meta?.previousClose);
  const marketState = String(daily?.meta?.marketState || '').toUpperCase();
  const intradayCloses = intraday?.indicators?.quote?.[0]?.close || [];
  const intradayTimestamps = intraday?.timestamp || [];
  let latestIntradayClose = null;
  let latestIntradayTs = null;
  for (let i = intradayCloses.length - 1; i >= 0; i -= 1) {
    if (intradayCloses[i] != null) {
      latestIntradayClose = Number(intradayCloses[i].toFixed(2));
      latestIntradayTs = intradayTimestamps[i] || null;
      break;
    }
  }

  const regularPrice = toNum(daily?.meta?.regularMarketPrice);
  const dailyLastClose = validCloses.length ? Number(validCloses[validCloses.length - 1].toFixed(2)) : null;
  const preferIntraday = marketState && marketState !== 'REGULAR';
  const current_price = preferIntraday
    ? (latestIntradayClose ?? regularPrice ?? dailyLastClose)
    : (regularPrice ?? latestIntradayClose ?? dailyLastClose);
  const today_high = highs.filter((v) => v != null).slice(-1)[0] ?? toNum(daily?.meta?.regularMarketDayHigh);
  const today_low = lows.filter((v) => v != null).slice(-1)[0] ?? toNum(daily?.meta?.regularMarketDayLow);
  const volume = volumes.filter((v) => v != null).slice(-1)[0] ?? toNum(daily?.meta?.regularMarketVolume);

  let today_open = toNum(daily?.meta?.regularMarketOpen);
  if (intraday) {
    const iTs = intraday.timestamp || [];
    const iOpen = intraday?.indicators?.quote?.[0]?.open || [];
    for (let i = 0; i < iTs.length; i += 1) {
      const mins = getEtParts(iTs[i]).minutesSinceMidnight;
      if (mins === 570 && iOpen[i] != null) {
        today_open = Number(iOpen[i].toFixed(2));
        break;
      }
    }
  }

  return {
    ticker: t,
    source: 'yahoo_finance',
    market_state: marketState || null,
    price_timestamp: latestIntradayTs,
    prev_close,
    today_open,
    today_high: today_high != null ? Number(today_high.toFixed(2)) : null,
    today_low: today_low != null ? Number(today_low.toFixed(2)) : null,
    current_price,
    volume: volume != null ? Math.round(volume) : null,
  };
}

async function invokeGetTrendProfile({ ticker }) {
  const t = String(ticker || '').toUpperCase();
  if (!t) throw new Error('Ticker requerido');

  const [daily, weekly, monthly] = await Promise.all([
    fetchYahooChart(t, '1d', '1y'),
    fetchYahooChart(t, '1wk', '5y').catch(() => fetchYahooChart(t, '1d', '2y')),
    fetchYahooChart(t, '1mo', '10y').catch(() => fetchYahooChart(t, '1wk', '10y')),
  ]);

  const buildFrame = (result) => {
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
    if (closes.length === 0) {
      return {
        price: null,
        ema20: null,
        ema50: null,
        ema200: null,
        rsi: null,
        momentum_20: null,
        trend: 'NEUTRAL',
        price_above_ema20: null,
        price_above_ema50: null,
        price_above_ema200: null,
      };
    }

    const price = Number(closes[closes.length - 1].toFixed(2));
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes, 200);
    const rsi = calcRSI(closes, 14);
    const reference = closes.length > 20 ? closes[closes.length - 21] : null;
    const momentum20 = reference ? Number((((price - reference) / reference) * 100).toFixed(2)) : null;

    let trend = 'NEUTRAL';
    if (ema20 != null && ema50 != null) {
      if (price > ema20 && ema20 > ema50) trend = 'BULLISH';
      else if (price < ema20 && ema20 < ema50) trend = 'BEARISH';
    } else if (ema50 != null) {
      trend = price > ema50 ? 'BULLISH' : price < ema50 ? 'BEARISH' : 'NEUTRAL';
    }

    return {
      price,
      ema20,
      ema50,
      ema200,
      rsi,
      momentum_20: momentum20,
      trend,
      price_above_ema20: ema20 != null ? price > ema20 : null,
      price_above_ema50: ema50 != null ? price > ema50 : null,
      price_above_ema200: ema200 != null ? price > ema200 : null,
    };
  };

  return {
    ticker: t,
    source: 'yahoo_finance',
    daily: buildFrame(daily),
    weekly: buildFrame(weekly),
    monthly: buildFrame(monthly),
  };
}

function extractFirstCandle(result, minutesWindow) {
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0] || {};
  const opens = q.open || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const closes = q.close || [];

  const buckets = {};
  for (let i = 0; i < ts.length; i += 1) {
    const p = getEtParts(ts[i]);
    if (p.minutesSinceMidnight < 570 || p.minutesSinceMidnight >= 570 + minutesWindow) continue;
    if (!buckets[p.dateKey]) buckets[p.dateKey] = [];
    buckets[p.dateKey].push(i);
  }
  const days = Object.keys(buckets).sort();
  const day = days[days.length - 1];
  if (!day || !buckets[day]?.length) return null;
  const idxs = buckets[day];
  const first = idxs[0];
  const highsArr = idxs.map((i) => highs[i]).filter((v) => v != null);
  const lowsArr = idxs.map((i) => lows[i]).filter((v) => v != null);
  return {
    open: opens[first] != null ? Number(opens[first].toFixed(2)) : null,
    high: highsArr.length ? Number(Math.max(...highsArr).toFixed(2)) : null,
    low: lowsArr.length ? Number(Math.min(...lowsArr).toFixed(2)) : null,
    close: closes[idxs[idxs.length - 1]] != null ? Number(closes[idxs[idxs.length - 1]].toFixed(2)) : null,
  };
}

async function invokeGetIntradayData({ ticker }) {
  const t = String(ticker || '').toUpperCase();
  if (!t) throw new Error('Ticker requerido');
  const [r1mRes, r5mRes, r15mRes, r1hRes] = await Promise.allSettled([
    fetchYahooChart(t, '1m', '1d'),
    fetchYahooChart(t, '5m', '5d'),
    fetchYahooChart(t, '15m', '5d').catch(() => null),
    fetchYahooChart(t, '1h', '1mo').catch(() => null),
  ]);
  const r1m = r1mRes.status === 'fulfilled' ? r1mRes.value : null;
  const r5m = r5mRes.status === 'fulfilled' ? r5mRes.value : null;
  const r15m = r15mRes.status === 'fulfilled' ? r15mRes.value : null;
  const r1h = r1hRes.status === 'fulfilled' ? r1hRes.value : null;
  if (!r1m && !r5m) throw new Error(`Yahoo sin datos para ${t}`);

  const q1 = r1m?.indicators?.quote?.[0] || {};
  const q5 = r5m?.indicators?.quote?.[0] || {};
  // 15m and 1h may be null if those fetches failed — graceful degradation
  const has15m = r15m != null;
  const has1h = r1h != null;
  const c1 = (q1.close || []).filter((v) => v != null);
  const c5 = (q5.close || []).filter((v) => v != null);
  const l1 = (q1.low || []).filter((v) => v != null);
  const v1 = (q1.volume || []).filter((v) => v != null);
  const o1arr = (q1.open || []).filter((v) => v != null);
  const h1arr = (q1.high || []).filter((v) => v != null);

  // 15min and 1h candle data (may be empty if fetch failed)
  const q15 = has15m ? (r15m?.indicators?.quote?.[0] || {}) : {};
  const q1h = has1h ? (r1h?.indicators?.quote?.[0] || {}) : {};
  const c15 = (q15.close || []).filter((v) => v != null);
  const h15 = (q15.high || []).filter((v) => v != null);
  const l15 = (q15.low || []).filter((v) => v != null);
  const o15 = (q15.open || []).filter((v) => v != null);
  const v15 = (q15.volume || []).filter((v) => v != null);
  const c1h = (q1h.close || []).filter((v) => v != null);
  const h1h = (q1h.high || []).filter((v) => v != null);
  const l1h = (q1h.low || []).filter((v) => v != null);
  const o1h = (q1h.open || []).filter((v) => v != null);
  const v1h = (q1h.volume || []).filter((v) => v != null);

  const ema9_1m = calcEMA(c1, 9);
  const ema20_1m = calcEMA(c1, 20);
  const ema50_1m = calcEMA(c1, 50);
  const ema9_5m = calcEMA(c5, 9);
  const ema20_5m = calcEMA(c5, 20);
  const ema50_5m = calcEMA(c5, 50);

  // Multi-timeframe EMAs for strategies
  const ema9_15m = calcEMA(c15, 9);
  const ema20_15m = calcEMA(c15, 20);
  const ema50_15m = calcEMA(c15, 50);
  const ema9_1h = calcEMA(c1h, 9);
  const ema20_1h = calcEMA(c1h, 20);
  const ema50_1h = calcEMA(c1h, 50);

  // Build 4H candles by aggregating last 1h candles in groups of 4
  const candles4h = [];
  if (o1h.length >= 4) {
    const count = Math.floor(o1h.length / 4);
    for (let i = o1h.length - count * 4; i < o1h.length; i += 4) {
      const end = Math.min(i + 4, o1h.length);
      const grpH = h1h.slice(i, end);
      const grpL = l1h.slice(i, end);
      candles4h.push({
        open: o1h[i] ?? null,
        high: grpH.length ? Math.max(...grpH) : null,
        low: grpL.length ? Math.min(...grpL) : null,
        close: c1h[end - 1] ?? null,
      });
    }
  }
  const c4h = candles4h.map(c => c.close).filter(v => v != null);
  const ema20_4h = calcEMA(c4h, 20);
  const ema50_4h = calcEMA(c4h, 50);

  // Build recent candle arrays for strategy detection (OHLCV)
  const buildCandles = (opens, highs, lows, closes, volumes, count) => {
    const len = Math.min(opens.length, highs.length, lows.length, closes.length);
    const start = Math.max(0, len - count);
    const arr = [];
    for (let i = start; i < len; i++) {
      arr.push({
        open: opens[i], high: highs[i], low: lows[i],
        close: closes[i], volume: volumes[i] ?? 0,
      });
    }
    return arr;
  };
  const candles15m = buildCandles(o15, h15, l15, c15, v15, 120);
  const candles1h = buildCandles(o1h, h1h, l1h, c1h, v1h, 60);

  // Detect support/resistance from 1h candles (recent swing highs/lows)
  const detectSR = (candles, tolerance = 0.002) => {
    if (candles.length < 5) return { supports: [], resistances: [] };
    const swingHighs = [], swingLows = [];
    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];
      if (c.high >= candles[i-1].high && c.high >= candles[i-2].high &&
          c.high >= candles[i+1].high && c.high >= candles[i+2].high) {
        swingHighs.push(c.high);
      }
      if (c.low <= candles[i-1].low && c.low <= candles[i-2].low &&
          c.low <= candles[i+1].low && c.low <= candles[i+2].low) {
        swingLows.push(c.low);
      }
    }
    // Cluster nearby levels
    const cluster = (levels) => {
      if (!levels.length) return [];
      levels.sort((a, b) => a - b);
      const clusters = [[levels[0]]];
      for (let i = 1; i < levels.length; i++) {
        const prev = clusters[clusters.length - 1];
        const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
        if (Math.abs(levels[i] - avg) / avg < tolerance) {
          prev.push(levels[i]);
        } else {
          clusters.push([levels[i]]);
        }
      }
      return clusters.map(cl => ({
        level: parseFloat((cl.reduce((a, b) => a + b, 0) / cl.length).toFixed(2)),
        touches: cl.length,
      })).sort((a, b) => b.touches - a.touches);
    };
    return { supports: cluster(swingLows), resistances: cluster(swingHighs) };
  };
  const sr1h = detectSR(candles1h);

  // Detect equal highs/lows (liquidity zones) from 1h and 4h candles
  const detectEqualLevels = (candles, tolerance = 0.001) => {
    const highs = [], lows = [];
    for (let i = 0; i < candles.length; i++) {
      for (let j = i + 1; j < candles.length; j++) {
        if (Math.abs(candles[i].high - candles[j].high) / candles[i].high < tolerance) {
          const avg = (candles[i].high + candles[j].high) / 2;
          highs.push(parseFloat(avg.toFixed(2)));
        }
        if (Math.abs(candles[i].low - candles[j].low) / candles[i].low < tolerance) {
          const avg = (candles[i].low + candles[j].low) / 2;
          lows.push(parseFloat(avg.toFixed(2)));
        }
      }
    }
    // Deduplicate
    const dedup = (arr) => {
      const set = new Set();
      return arr.filter(v => { const k = v.toFixed(2); if (set.has(k)) return false; set.add(k); return true; });
    };
    return { equal_highs: dedup(highs), equal_lows: dedup(lows) };
  };
  const liqZones1h = detectEqualLevels(candles1h);
  const liqZones4h = detectEqualLevels(candles4h);

  // Detect engulfing candles on 15m (for entry confirmation)
  const detectEngulfing = (candles) => {
    if (candles.length < 2) return null;
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];
    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    if (currBody > prevBody * 1.0) {
      if (curr.close > curr.open && prev.close < prev.open &&
          curr.close > prev.open && curr.open <= prev.close) {
        return 'BULLISH_ENGULFING';
      }
      if (curr.close < curr.open && prev.close > prev.open &&
          curr.close < prev.open && curr.open >= prev.close) {
        return 'BEARISH_ENGULFING';
      }
    }
    return null;
  };
  const engulfing15m = detectEngulfing(candles15m);

  const last1 = c1[c1.length - 1] ?? null;
  const last5 = c5[c5.length - 1] ?? null;
  const last15 = c15[c15.length - 1] ?? null;
  const last1h = c1h[c1h.length - 1] ?? null;
  const last4h = c4h[c4h.length - 1] ?? null;

  const avgVol = v1.length > 20 ? v1.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : null;
  const lastVol = v1[v1.length - 1] ?? null;
  const avgVol15 = v15.length > 10 ? v15.slice(-11, -1).reduce((a, b) => a + b, 0) / 10 : null;
  const lastVol15 = v15[v15.length - 1] ?? null;

  let ema50_bounce = false;
  if (ema50_1m && c1.length >= 5 && l1.length >= 5) {
    const recentC = c1.slice(-5);
    const recentL = l1.slice(-5);
    ema50_bounce = recentL.some((l, i) => l <= ema50_1m * 1.002 && recentC[i] > ema50_1m);
  }

  return {
    ticker: t,
    source: 'yahoo_finance',
    ema9_1m, ema20_1m, ema50_1m,
    ema9_5m, ema20_5m, ema50_5m,
    ema9_15m, ema20_15m, ema50_15m,
    ema9_1h, ema20_1h, ema50_1h,
    ema20_4h, ema50_4h,
    ema9_above_20_1m: ema9_1m != null && ema20_1m != null ? ema9_1m > ema20_1m : null,
    price_above_ema20_1m: last1 != null && ema20_1m != null ? last1 > ema20_1m : null,
    ema50_bounce,
    volume_confirms: avgVol != null && lastVol != null ? lastVol > avgVol * 1.2 : false,
    volume_confirms_15m: avgVol15 != null && lastVol15 != null ? lastVol15 > avgVol15 * 1.3 : false,
    current_price_1m: last1 ? parseFloat(last1.toFixed(2)) : null,
    current_price_5m: last5 ? parseFloat(last5.toFixed(2)) : null,
    current_price_15m: last15 ? parseFloat(last15.toFixed(2)) : null,
    current_price_1h: last1h ? parseFloat(last1h.toFixed(2)) : null,
    current_price_4h: last4h ? parseFloat(last4h.toFixed(2)) : null,
    candles1m: c1.length,
    candles5m: c5.length,
    candles15m: c15.length,
    candles1h: c1h.length,
    candles4h: candles4h.length,
    bb_1m: calcBollingerBands(c1, 20, 2),
    bb_5m: calcBollingerBands(c5, 20, 2),
    first_candle_1m: extractFirstCandle(r1m, 1),
    first_candle_5m: extractFirstCandle(r1m, 5),
    first_candle_15m: extractFirstCandle(r1m, 15),
    first_candle_30m: extractFirstCandle(r1m, 30),
    first_candle_1h: extractFirstCandle(r1m, 60),
    // Multi-timeframe strategy data
    sr_1h: sr1h,
    liquidity_zones_1h: liqZones1h,
    liquidity_zones_4h: liqZones4h,
    engulfing_15m: engulfing15m,
    candles_1m: buildCandles(o1arr, h1arr, l1, c1, v1, 15), // last 15 1min candles for tf_3min/2min pattern
    candles_15m: candles15m.slice(-120),
    candles_1h: candles1h.slice(-40),
    candles_4h: candles4h.slice(-6),
    // Trend flags for higher timeframes
    trend_4h: ema20_4h && ema50_4h && last4h
      ? (ema20_4h > ema50_4h && last4h > ema20_4h ? 'BULLISH'
        : ema20_4h < ema50_4h && last4h < ema20_4h ? 'BEARISH' : 'NEUTRAL')
      : null,
    trend_1h: ema20_1h && ema50_1h && last1h
      ? (ema20_1h > ema50_1h && last1h > ema20_1h ? 'BULLISH'
        : ema20_1h < ema50_1h && last1h < ema20_1h ? 'BEARISH' : 'NEUTRAL')
      : null,
    trend_15m: ema20_15m && ema50_15m && last15
      ? (ema20_15m > ema50_15m && last15 > ema20_15m ? 'BULLISH'
        : ema20_15m < ema50_15m && last15 < ema20_15m ? 'BEARISH' : 'NEUTRAL')
      : null,
  };
}

async function invokeGetPremarketData({ ticker }) {
  const t = String(ticker || '').toUpperCase();
  if (!t) throw new Error('Ticker requerido');
  // Fetch 1m candles WITH premarket/after-hours
  const result = await fetchYahooChart(t, '1m', '1d', true);
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0] || {};
  const opens = q.open || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const closes = q.close || [];
  const volumes = q.volume || [];

  // Premarket = 4:00 AM (240 min) to 9:29 AM (569 min) ET
  let pmHighs = [];
  let pmLows = [];
  let pmVols = [];
  let pmCloses = [];
  let pmOpens = [];
  for (let i = 0; i < ts.length; i++) {
    const { minutesSinceMidnight } = getEtParts(ts[i]);
    if (minutesSinceMidnight >= 240 && minutesSinceMidnight < 570) {
      if (highs[i] != null) pmHighs.push(highs[i]);
      if (lows[i] != null) pmLows.push(lows[i]);
      if (volumes[i] != null) pmVols.push(volumes[i]);
      if (closes[i] != null) pmCloses.push(closes[i]);
      if (opens[i] != null) pmOpens.push(opens[i]);
    }
  }

  if (pmHighs.length === 0) {
    return { ticker: t, available: false, note: 'No hay datos de premarket disponibles' };
  }

  const pmHigh = Math.max(...pmHighs);
  const pmLow = Math.min(...pmLows);
  const pmOpen = pmOpens[0] ?? null;
  const pmClose = pmCloses[pmCloses.length - 1] ?? null;
  const pmTotalVol = pmVols.reduce((a, b) => a + b, 0);
  const prevClose = toNum(result?.meta?.previousClose) ?? toNum(result?.meta?.regularMarketPreviousClose);

  let direction = 'NEUTRAL';
  if (pmClose && prevClose) {
    if (pmClose > prevClose * 1.001) direction = 'BULLISH';
    else if (pmClose < prevClose * 0.999) direction = 'BEARISH';
  }

  return {
    ticker: t,
    available: true,
    premarket_high: parseFloat(pmHigh.toFixed(2)),
    premarket_low: parseFloat(pmLow.toFixed(2)),
    premarket_open: pmOpen ? parseFloat(pmOpen.toFixed(2)) : null,
    premarket_close: pmClose ? parseFloat(pmClose.toFixed(2)) : null,
    premarket_volume: pmTotalVol,
    premarket_candles: pmHighs.length,
    premarket_direction: direction,
    premarket_range: parseFloat((pmHigh - pmLow).toFixed(2)),
    prev_close: prevClose ? parseFloat(prevClose.toFixed(2)) : null,
  };
}

async function invokeGetVix() {
  const result = await fetchYahooChart('^VIX', '1d', '2d');
  const meta = result?.meta || {};
  const close = result?.indicators?.quote?.[0]?.close || [];
  const vix = toNum(meta.regularMarketPrice);
  const prev = toNum(close.find((v) => v != null)) ?? toNum(meta.regularMarketPreviousClose);
  const diff = vix != null && prev != null ? vix - prev : null;
  const diffPct = diff != null && prev ? (diff / prev) * 100 : null;

  let regime = 'MODERATE';
  let regime_es = 'Moderado';
  let orb_probability_adjustment = 0;
  let impact_note = 'Volatilidad normal.';
  if (vix != null && vix < 15) {
    regime = 'LOW';
    regime_es = 'Bajo';
    orb_probability_adjustment = 10;
    impact_note = 'Mercado tranquilo, tendencia mas limpia.';
  } else if (vix != null && vix < 20) {
    regime = 'MODERATE';
    regime_es = 'Moderado';
    orb_probability_adjustment = 0;
    impact_note = 'Volatilidad normal para day trading.';
  } else if (vix != null && vix < 25) {
    regime = 'ELEVATED';
    regime_es = 'Elevado';
    orb_probability_adjustment = -8;
    impact_note = 'Aumenta el ruido y los falsos rompimientos.';
  } else if (vix != null && vix < 30) {
    regime = 'HIGH';
    regime_es = 'Alto';
    orb_probability_adjustment = -15;
    impact_note = 'Mercado nervioso, reducir riesgo por operacion.';
  } else if (vix != null) {
    regime = 'EXTREME';
    regime_es = 'Extremo';
    orb_probability_adjustment = -22;
    impact_note = 'Volatilidad extrema, operar solo setups de alta conviccion.';
  }

  return {
    vix,
    prev_vix: prev,
    vix_change: diff != null ? Number(diff.toFixed(2)) : null,
    vix_change_pct: diffPct != null ? Number(diffPct.toFixed(2)) : null,
    regime,
    regime_es,
    impact_note,
    orb_probability_adjustment,
  };
}

async function invokeGetGammaOI({ ticker, force_refresh, forceRefresh, expiration_mode, expirationMode, gamma_calculation_mode, gammaCalculationMode, strict_real_gamma, strictRealGamma } = {}) {
  const t = String(ticker || '').toUpperCase();
  if (!t) throw new Error('Ticker requerido');
  const force = Boolean(force_refresh || forceRefresh);
  const requestedExpirationMode = String(expiration_mode || expirationMode || 'nearest').toLowerCase() === 'all'
    ? 'all'
    : 'nearest';
  const requestedGammaCalculationMode = String(gamma_calculation_mode || gammaCalculationMode || 'institutional').toLowerCase() === 'near_open'
    ? 'near_open'
    : 'institutional';
  const strictGammaOnly = Boolean(strict_real_gamma || strictRealGamma);

  if (!force) {
    if (!optionsFetchBlockedUntil) optionsFetchBlockedUntil = readBlockUntil(OPTIONS_BLOCK_UNTIL_KEY);
    if (!yahooOptionsBlockedUntil) yahooOptionsBlockedUntil = readBlockUntil(YAHOO_OPTIONS_BLOCK_UNTIL_KEY);
  }

  if (!force && Date.now() < optionsFetchBlockedUntil) {
    return {
      ticker: t,
      source: 'unavailable',
      gamma_calculation_mode: requestedGammaCalculationMode,
      strict_real_gamma: strictGammaOnly,
      requested_expiration_mode: requestedExpirationMode,
      call_wall: null,
      put_wall: null,
      gamma_level: null,
      max_pain: null,
      open_interest_total: 0,
      total_call_oi: 0,
      total_put_oi: 0,
      total_call_volume: 0,
      total_put_volume: 0,
      key_strikes: [],
      oi_call_dominant: false,
      put_call_ratio: null,
      strikes_analyzed: 0,
    };
  }
  const barchartUrl = `/api/barchart/options?ticker=${encodeURIComponent(t)}&expiration=${requestedExpirationMode}`;
  const symbol = t.startsWith('^') ? t : `_${t}`;
  const cboeUrl = `/api/cboe/api/global/delayed_quotes/options/${symbol}.json`;

  let options = [];
  let source = 'barchart';
  let cboeStatus = null;
  let optionsExpiration = null;
  try {
    const bcRes = await fetch(barchartUrl, { headers: { Accept: 'application/json' } }).catch(() => null);
    if (bcRes?.ok) {
      const bcJson = await bcRes.json();
      const callRows = Array.isArray(bcJson?.data?.Call) ? bcJson.data.Call : [];
      const putRows = Array.isArray(bcJson?.data?.Put) ? bcJson.data.Put : [];
      const bcExp = bcJson?.meta?.expirations;
      if (Array.isArray(bcExp)) {
        optionsExpiration = bcExp[0] || null;
      } else if (bcExp && typeof bcExp === 'object') {
        const weeklyFirst = Array.isArray(bcExp.weekly) ? bcExp.weekly[0] : null;
        const monthlyFirst = Array.isArray(bcExp.monthly) ? bcExp.monthly[0] : null;
        optionsExpiration = weeklyFirst || monthlyFirst || null;
      } else {
        optionsExpiration = null;
      }
      options = [
        ...callRows.map((o) => ({
          open_interest: toLooseNumber(o?.openInterest) ?? 0,
          volume: toLooseNumber(o?.volume) ?? 0,
          strike_price: toLooseNumber(o?.strikePrice) ?? 0,
          type: 'call',
          option: String(o?.symbol || ''),
        })),
        ...putRows.map((o) => ({
          open_interest: toLooseNumber(o?.openInterest) ?? 0,
          volume: toLooseNumber(o?.volume) ?? 0,
          strike_price: toLooseNumber(o?.strikePrice) ?? 0,
          type: 'put',
          option: String(o?.symbol || ''),
        })),
      ];
      if (options.length === 0) throw new Error('barchart_empty');
    } else {
      throw new Error('barchart_blocked');
    }
  } catch {
    // Fallback 1: CBOE
    source = 'cboe';
    try {
      const cboeRes = await fetch(cboeUrl, { headers: { Accept: 'application/json' } }).catch(() => null);
      if (cboeRes?.ok) {
        const json = await cboeRes.json();
        options = (json?.data?.options || []).map((o) => ({
          ...o,
          volume: Number(o?.volume || 0),
        }));
      } else {
        cboeStatus = cboeRes?.status || null;
        throw new Error('cboe_blocked');
      }
    } catch {
      // Fallback 2: Yahoo options
      source = 'yahoo_options';
      if (!force && Date.now() < yahooOptionsBlockedUntil) {
        source = 'unavailable';
        setOptionsBlock(24 * 60 * 60 * 1000);
      }
      try {
        if (source === 'unavailable') throw new Error('yahoo_options_cooldown');
        const yUrl = `/api/yahoo/v7/finance/options/${encodeURIComponent(t)}`;
        const yRes = await fetch(yUrl, { headers: { Accept: 'application/json' } }).catch(() => null);
        if (!yRes?.ok) {
          if (yRes?.status === 401 || yRes?.status === 403) {
            // Yahoo options is frequently blocked/unauthorized; avoid repeated noisy retries.
            setYahooOptionsBlock(24 * 60 * 60 * 1000);
          }
          throw new Error('yahoo_options_blocked');
        }
        const yJson = await yRes.json();
        const chain = yJson?.optionChain?.result?.[0]?.options?.[0] || {};
        const calls = (chain.calls || []).map((c) => ({ ...c, type: 'call' }));
        const puts = (chain.puts || []).map((p) => ({ ...p, type: 'put' }));
        options = [...calls, ...puts].map((o) => ({
          open_interest: o.openInterest,
          volume: o.volume,
          strike_price: o.strike,
          type: o.type,
        }));
      } catch {
        // All providers failed — return empty but valid structure
        source = 'unavailable';
        const longCooldown = cboeStatus === 403 ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
        setOptionsBlock(longCooldown);
      }
    }
  }

  let callWallInstitutional = null;
  let putWallInstitutional = null;
  let maxCall = -1;
  let maxPut = -1;
  let totalCall = 0;
  let totalPut = 0;
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  for (const opt of options) {
    const oi = toLooseNumber(opt?.open_interest) ?? 0;
    const vol = toLooseNumber(opt?.volume) ?? 0;
    const strike = toLooseNumber(opt?.strike_price ?? opt?.strike) ?? 0;
    if (!strike) continue;
    const type = (opt?.type || '').toLowerCase();
    const code = String(opt?.option || '');
    const isCall = type === 'call' || type === 'c' || /C\d{6,}/.test(code);
    const isPut = type === 'put' || type === 'p' || /P\d{6,}/.test(code);
    if (isCall) {
      totalCall += oi;
      totalCallVolume += vol;
      if (oi > maxCall) {
        maxCall = oi;
        callWallInstitutional = strike;
      }
    }
    if (isPut) {
      totalPut += oi;
      totalPutVolume += vol;
      if (oi > maxPut) {
        maxPut = oi;
        putWallInstitutional = strike;
      }
    }
  }

  const institutionalWalls = getWallsFromOptionRows(options);
  callWallInstitutional = institutionalWalls.callWall ?? callWallInstitutional;
  putWallInstitutional = institutionalWalls.putWall ?? putWallInstitutional;

  const gammaLevelInstitutional = callWallInstitutional && putWallInstitutional
    ? Number(((callWallInstitutional + putWallInstitutional) / 2).toFixed(2))
    : null;

  // Key strikes by total OI (call + put)
  const strikeMap = new Map();
  for (const opt of options) {
    const strike = toLooseNumber(opt?.strike_price ?? opt?.strike) ?? 0;
    const oi = toLooseNumber(opt?.open_interest) ?? 0;
    const vol = toLooseNumber(opt?.volume) ?? 0;
    if (!strike || (!oi && !vol)) continue;

    const code = String(opt?.option || '');
    const type = String(opt?.type || '').toLowerCase();
    const isCall = type === 'call' || type === 'c' || /C\d{6,}/.test(code);
    const isPut = type === 'put' || type === 'p' || /P\d{6,}/.test(code);

    if (!strikeMap.has(strike)) {
      strikeMap.set(strike, {
        strike,
        call_oi: 0,
        put_oi: 0,
        total_oi: 0,
        call_volume: 0,
        put_volume: 0,
        total_volume: 0,
      });
    }

    const row = strikeMap.get(strike);
    if (isCall) {
      row.call_oi += oi;
      row.call_volume += vol;
    }
    if (isPut) {
      row.put_oi += oi;
      row.put_volume += vol;
    }
    row.total_oi = row.call_oi + row.put_oi;
    row.total_volume = row.call_volume + row.put_volume;
  }

  // Key strikes nearest to current price at analysis time (with OI tie-breaker).
  const allStrikeRows = Array.from(strikeMap.values());
  const structural_key_strikes = allStrikeRows
    .slice()
    .sort((a, b) => (b.total_oi || 0) - (a.total_oi || 0))
    .slice(0, 7)
    .sort((a, b) => a.strike - b.strike);
  const spotNow = await invokeGetStockPrice({ ticker: t }).catch(() => null);
  const spotRef = toNum(spotNow?.current_price);
  const marketOpenRef = toLooseNumber(spotNow?.today_open ?? spotNow?.open);
  const ref = spotRef || gammaLevelInstitutional || (callWallInstitutional && putWallInstitutional ? (callWallInstitutional + putWallInstitutional) / 2 : null);
  let key_strikes;
  if (ref && allStrikeRows.length > 0) {
    key_strikes = allStrikeRows
      .sort((a, b) => {
        const distA = Math.abs(a.strike - ref);
        const distB = Math.abs(b.strike - ref);
        if (distA !== distB) return distA - distB;
        return (b.total_oi || 0) - (a.total_oi || 0);
      })
      .slice(0, 7)
      .sort((a, b) => a.strike - b.strike); // display order: ascending by strike
  } else {
    key_strikes = allStrikeRows
      .sort((a, b) => b.total_oi - a.total_oi)
      .slice(0, 7);
  }

  const nearOpenRef = marketOpenRef ?? spotRef;
  const callOpenCandidates = allStrikeRows.filter((row) => Number(row.call_oi || 0) > 0);
  const putOpenCandidates = allStrikeRows.filter((row) => Number(row.put_oi || 0) > 0);
  const callWallNearOpen = nearOpenRef != null && callOpenCandidates.length > 0
    ? callOpenCandidates
      .slice()
      .sort((a, b) => {
        const distA = Math.abs(a.strike - nearOpenRef);
        const distB = Math.abs(b.strike - nearOpenRef);
        if (distA !== distB) return distA - distB;
        return (b.call_oi || 0) - (a.call_oi || 0);
      })[0]?.strike ?? null
    : null;
  const putWallNearOpen = nearOpenRef != null && putOpenCandidates.length > 0
    ? putOpenCandidates
      .slice()
      .sort((a, b) => {
        const distA = Math.abs(a.strike - nearOpenRef);
        const distB = Math.abs(b.strike - nearOpenRef);
        if (distA !== distB) return distA - distB;
        return (b.put_oi || 0) - (a.put_oi || 0);
      })[0]?.strike ?? null
    : null;
  const gammaLevelNearOpen = callWallNearOpen && putWallNearOpen
    ? Number(((callWallNearOpen + putWallNearOpen) / 2).toFixed(2))
    : null;

  let selectedCallWall = callWallInstitutional;
  let selectedPutWall = putWallInstitutional;
  let selectedGammaLevel = gammaLevelInstitutional;
  if (requestedGammaCalculationMode === 'near_open' && callWallNearOpen && putWallNearOpen && gammaLevelNearOpen) {
    selectedCallWall = callWallNearOpen;
    selectedPutWall = putWallNearOpen;
    selectedGammaLevel = gammaLevelNearOpen;
  }

  const netOi = totalCall + totalPut;
  const gexBias = totalCall - totalPut;
  const gexPct = netOi > 0 ? Number(((gexBias / netOi) * 100).toFixed(1)) : 0;
  const gamma_exposure = netOi > 0
    ? `${gexBias >= 0 ? '+' : ''}${gexPct}% (estimado por OI neto)`
    : 'N/A';

  const institutionalGex = calculateInstitutionalGex(options, spotRef, strictGammaOnly);
  const gexTotal = institutionalGex.totalGex;
  const gammaFlip = institutionalGex.gammaFlip;
  const gexRegime = gexTotal == null
    ? 'UNKNOWN'
    : gexTotal >= 0
      ? 'POSITIVE_GEX_RANGE'
      : 'NEGATIVE_GEX_TREND';
  const marketRegimeByFlip = gammaFlip == null || spotRef == null || gexTotal == null
    ? 'UNKNOWN'
    : (spotRef > gammaFlip && gexTotal > 0)
      ? 'RANGE'
      : (spotRef < gammaFlip && gexTotal < 0)
        ? 'TREND'
        : 'MIXED';

  // If options providers are blocked, synthesize levels from spot price so UI never stays empty.
  if ((!selectedCallWall || !selectedPutWall || !selectedGammaLevel) && options.length === 0) {
    const spot = await invokeGetStockPrice({ ticker: t }).catch(() => null);
    const px = toNum(spot?.current_price);
    if (px != null) {
      const step = px < 30 ? 1 : px < 100 ? 2.5 : px < 250 ? 5 : 10;
      const baseStrike = Math.round(px / step) * step;
      const callEst = Number((baseStrike + step).toFixed(2));
      const putEst = Number((baseStrike - step).toFixed(2));
      const gLvl = Number(baseStrike.toFixed(2));
      const estStrikes = [-2, -1, 0, 1, 2].map((k) => {
        const s = Number((baseStrike + (k * step)).toFixed(2));
        return {
          strike: s,
          call_oi: 0,
          put_oi: 0,
          total_oi: 0,
          call_volume: 0,
          put_volume: 0,
          total_volume: 0,
        };
      });

      return {
        ticker: t,
        source: 'estimated_from_spot',
        gamma_calculation_mode: requestedGammaCalculationMode,
        strict_real_gamma: strictGammaOnly,
        requested_expiration_mode: requestedExpirationMode,
        options_expiration: null,
        call_wall: callEst,
        put_wall: putEst,
        gamma_level: gLvl,
        call_wall_institutional: callEst,
        put_wall_institutional: putEst,
        gamma_level_institutional: gLvl,
        call_wall_near_open: callEst,
        put_wall_near_open: putEst,
        gamma_level_near_open: gLvl,
        gamma_flip: gLvl,
        gex_total: null,
        gex_total_by_formula: null,
        gex_by_strike: {},
        cumulative_gex_by_strike: {},
        gex_regime: 'UNKNOWN',
        gex_market_mode: 'UNKNOWN',
        vol_gex: null,
        delta_exposure: null,
        gex_0dte: null,
        gex_ex_0dte: null,
        gex_estimated_gamma_count: 0,
        gex_direct_gamma_count: 0,
        max_pain: gLvl,
        gamma_exposure: 'N/A (fuentes de opciones bloqueadas)',
        open_interest_total: 0,
        key_strikes: estStrikes,
        structural_key_strikes: estStrikes,
        total_call_oi: 0,
        total_put_oi: 0,
        total_call_volume: 0,
        total_put_volume: 0,
        oi_call_dominant: false,
        put_call_ratio: null,
        strikes_analyzed: 0,
      };
    }
  }

  // Max pain: find strike that minimizes total loss for option writers
  const callOpts = options.filter((o) => {
    const s = String(o?.option || '');
    return (o?.type || '').toLowerCase() === 'call' || /C\d{6,}/.test(s);
  });
  const putOpts = options.filter((o) => {
    const s = String(o?.option || '');
    return (o?.type || '').toLowerCase() === 'put' || (/P\d{6,}/.test(s) && !/C\d{6,}/.test(s));
  });
  const allStrikes = [...new Set(options.map((o) => toLooseNumber(o?.strike_price ?? o?.strike)).filter((s) => Number.isFinite(s) && s > 0))].sort((a, b) => a - b);
  let max_pain = null;
  if (allStrikes.length > 0) {
    let minLoss = Infinity;
    allStrikes.forEach((testStrike) => {
      let loss = 0;
      callOpts.forEach((c) => {
        const cStrike = toLooseNumber(c?.strike_price ?? c?.strike) ?? 0;
        if (cStrike > 0 && cStrike < testStrike) loss += (c.open_interest ?? 0) * (testStrike - cStrike);
      });
      putOpts.forEach((p) => {
        const pStrike = toLooseNumber(p?.strike_price ?? p?.strike) ?? 0;
        if (pStrike > 0 && pStrike > testStrike) loss += (p.open_interest ?? 0) * (pStrike - testStrike);
      });
      if (loss < minLoss) { minLoss = loss; max_pain = testStrike; }
    });
  }

  return {
    ticker: t,
    source,
    gamma_calculation_mode: requestedGammaCalculationMode,
    strict_real_gamma: strictGammaOnly,
    requested_expiration_mode: requestedExpirationMode,
    options_expiration: optionsExpiration,
    call_wall: selectedCallWall,
    put_wall: selectedPutWall,
    gamma_level: selectedGammaLevel,
    call_wall_institutional: callWallInstitutional,
    put_wall_institutional: putWallInstitutional,
    gamma_level_institutional: gammaLevelInstitutional,
    call_wall_near_open: callWallNearOpen,
    put_wall_near_open: putWallNearOpen,
    gamma_level_near_open: gammaLevelNearOpen,
    market_open_reference: nearOpenRef,
    gamma_flip: gammaFlip,
    gex_total: gexTotal,
    gex_total_by_formula: gexTotal,
    gex_by_strike: institutionalGex.gexByStrike,
    cumulative_gex_by_strike: institutionalGex.cumulativeByStrike,
    gex_regime: gexRegime,
    gex_market_mode: marketRegimeByFlip,
    vol_gex: institutionalGex.volGex,
    delta_exposure: institutionalGex.deltaExposure,
    gex_0dte: institutionalGex.gex0dte,
    gex_ex_0dte: institutionalGex.gexEx0dte,
    gex_estimated_gamma_count: institutionalGex.gexEstimatedCount,
    gex_direct_gamma_count: institutionalGex.gexDirectCount,
    max_pain: max_pain ?? selectedGammaLevel,
    gamma_exposure,
    open_interest_total: netOi,
    key_strikes,
    structural_key_strikes,
    total_call_oi: totalCall,
    total_put_oi: totalPut,
    total_call_volume: totalCallVolume,
    total_put_volume: totalPutVolume,
    oi_call_dominant: totalCall > totalPut,
    put_call_ratio: totalCall ? Number((totalPut / totalCall).toFixed(2)) : null,
    strikes_analyzed: options.length,
  };
}

async function invokeGetHistoricalStats({ ticker }) {
  const t = String(ticker || '').toUpperCase();
  if (!t) throw new Error('Ticker requerido');

  // Fetch all data in parallel: ticker daily, ticker intraday 5m, VIX daily, SPY daily
  const [daily, intra, vixDaily, spyDaily] = await Promise.all([
    fetchYahooChart(t, '1d', '1y'),
    fetchYahooChart(t, '5m', '5d').catch(() => null),
    fetchYahooChart('^VIX', '1d', '1y').catch(() => null),
    fetchYahooChart('SPY', '1d', '1y').catch(() => null),
  ]);

  const quote = daily?.indicators?.quote?.[0] || {};
  const timestamps = daily?.timestamp || [];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  // Build VIX lookup by date
  const vixByDate = {};
  if (vixDaily) {
    const vTs = vixDaily.timestamp || [];
    const vCloses = vixDaily.indicators?.quote?.[0]?.close || [];
    for (let i = 0; i < vTs.length; i++) {
      if (vCloses[i] == null) continue;
      const d = new Date(vTs[i] * 1000).toISOString().slice(0, 10);
      vixByDate[d] = vCloses[i];
    }
  }

  // Build SPY lookup by date (open, close, high, low for trend detection)
  const spyByDate = {};
  if (spyDaily) {
    const sTs = spyDaily.timestamp || [];
    const sq = spyDaily.indicators?.quote?.[0] || {};
    for (let i = 0; i < sTs.length; i++) {
      if (sq.close?.[i] == null) continue;
      const d = new Date(sTs[i] * 1000).toISOString().slice(0, 10);
      spyByDate[d] = {
        open: sq.open?.[i], close: sq.close?.[i],
        high: sq.high?.[i], low: sq.low?.[i],
        prevClose: i > 0 ? sq.close?.[i - 1] : null,
      };
    }
  }

  // ═══ GAP FILL ANALYSIS (multifactor) ═══
  // Compute 20-day rolling average volume
  const avgVolWindow = 20;
  let sample = 0, fill25 = 0, fill50 = 0, fill75 = 0, fill100 = 0;
  // By size class
  const gapBySize = { small: { total: 0, f100: 0 }, moderate: { total: 0, f100: 0 }, medium: { total: 0, f100: 0 }, large: { total: 0, f100: 0 }, extreme: { total: 0, f100: 0 } };
  // By VIX regime
  const gapByVix = { low: { total: 0, f100: 0 }, normal: { total: 0, f100: 0 }, high: { total: 0, f100: 0 } };
  // By volume
  const gapByVol = { high: { total: 0, f100: 0 }, normal: { total: 0, f100: 0 } };
  // By SPY trend alignment
  const gapByTrend = { aligned: { total: 0, f100: 0 }, opposed: { total: 0, f100: 0 } };
  // By direction
  const gapByDir = { up: { total: 0, f100: 0, f50: 0 }, down: { total: 0, f100: 0, f50: 0 } };

  for (let i = 1; i < closes.length; i++) {
    const prevClose = toNum(closes[i - 1]);
    const open = toNum(opens[i]);
    const high2 = toNum(highs[i]);
    const low2 = toNum(lows[i]);
    const vol = toNum(volumes[i]);
    if (prevClose == null || open == null || high2 == null || low2 == null) continue;
    const gap = open - prevClose;
    if (Math.abs(gap) < 0.0001) continue;
    const gapSize = Math.abs(gap);
    const gapPct = (gapSize / prevClose) * 100;
    const filled = gap > 0 ? open - low2 : high2 - open;
    const p = Math.max(0, Math.min(100, (filled / gapSize) * 100));
    sample++;
    if (p >= 25) fill25++;
    if (p >= 50) fill50++;
    if (p >= 75) fill75++;
    if (p >= 100) fill100++;

    // Size classification
    const sizeClass = gapPct < 0.5 ? 'small' : gapPct < 1 ? 'moderate' : gapPct < 2 ? 'medium' : gapPct < 5 ? 'large' : 'extreme';
    gapBySize[sizeClass].total++;
    if (p >= 100) gapBySize[sizeClass].f100++;

    // Direction
    const dir = gap > 0 ? 'up' : 'down';
    gapByDir[dir].total++;
    if (p >= 100) gapByDir[dir].f100++;
    if (p >= 50) gapByDir[dir].f50++;

    // VIX context
    const dateStr = timestamps[i] ? new Date(timestamps[i] * 1000).toISOString().slice(0, 10) : null;
    if (dateStr && vixByDate[dateStr] != null) {
      const vix = vixByDate[dateStr];
      const vixCat = vix <= 15 ? 'low' : vix <= 25 ? 'normal' : 'high';
      gapByVix[vixCat].total++;
      if (p >= 100) gapByVix[vixCat].f100++;
    }

    // Volume context (vs 20-day avg)
    const volSlice = volumes.slice(Math.max(0, i - avgVolWindow), i).filter(v => v != null);
    const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;
    if (vol && avgVol > 0) {
      const volCat = vol > avgVol * 1.5 ? 'high' : 'normal';
      gapByVol[volCat].total++;
      if (p >= 100) gapByVol[volCat].f100++;
    }

    // SPY trend alignment
    if (dateStr && spyByDate[dateStr]) {
      const spy = spyByDate[dateStr];
      const spyDir = spy.close > spy.open ? 'up' : 'down';
      const gapDir = gap > 0 ? 'up' : 'down';
      // Gap fill means price moves OPPOSITE to gap. So if SPY moves opposite to gap = aligned with fill
      const fillAligned = spyDir !== gapDir;
      if (fillAligned) { gapByTrend.aligned.total++; if (p >= 100) gapByTrend.aligned.f100++; }
      else { gapByTrend.opposed.total++; if (p >= 100) gapByTrend.opposed.f100++; }
    }
  }

  const pct = (v) => (sample ? Number(((v / sample) * 100).toFixed(1)) : 0);
  const safePct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : null);

  // ═══ ORB EMPIRICAL ANALYSIS (multifactor) ═══
  let orbStats = {};
  try {
    const iQuote = intra?.indicators?.quote?.[0] || {};
    const iTs = intra?.timestamp || [];
    const iOpens = iQuote.open || [];
    const iHighs = iQuote.high || [];
    const iLows = iQuote.low || [];
    const iCloses = iQuote.close || [];
    const iVolumes = iQuote.volume || [];

    // Group candles by trading day (ET timezone)
    const dayBuckets = {};
    for (let i = 0; i < iTs.length; i++) {
      if (iOpens[i] == null || iCloses[i] == null) continue;
      const { dateKey, minutesSinceMidnight } = getEtParts(iTs[i]);
      if (minutesSinceMidnight < 570 || minutesSinceMidnight >= 960) continue;
      if (!dayBuckets[dateKey]) dayBuckets[dateKey] = [];
      dayBuckets[dateKey].push({
        min: minutesSinceMidnight,
        o: iOpens[i], h: iHighs[i], l: iLows[i], c: iCloses[i],
        v: iVolumes[i] || 0,
      });
    }

    // Also link each day to daily data for gap + context
    // Build daily lookup by date for the ticker
    const dailyByDate = {};
    for (let i = 0; i < timestamps.length; i++) {
      const d = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      dailyByDate[d] = {
        open: toNum(opens[i]), high: toNum(highs[i]), low: toNum(lows[i]),
        close: toNum(closes[i]), volume: toNum(volumes[i]),
        prevClose: i > 0 ? toNum(closes[i - 1]) : null,
      };
    }

    const orbTimeframes = [
      { key: '5', endMin: 575 },
      { key: '15', endMin: 585 },
      { key: '30', endMin: 600 },
      { key: '1h', endMin: 630 },
    ];

    // Counters per timeframe
    const counters = {};
    for (const tf of orbTimeframes) {
      counters[tf.key] = {
        total: 0, single: 0, double: 0, consol: 0,
        breakUp: 0, breakDown: 0,
        clean: 0, failed: 0, totalBreaks: 0,
        smallRange: { total: 0, broke: 0 }, largeRange: { total: 0, broke: 0 },
        highVol: { total: 0, broke: 0 }, lowVol: { total: 0, broke: 0 },
        lowVix: { total: 0, broke: 0 }, highVix: { total: 0, broke: 0 },
        gapDay: { total: 0, broke: 0 }, noGapDay: { total: 0, broke: 0 },
        gapConfluence: { total: 0, broke: 0 },
        spyTrending: { total: 0, broke: 0 }, spyRanging: { total: 0, broke: 0 },
        spyConfirm: { total: 0, broke: 0 },
      };
    }

    for (const [dateKey, dayCandles] of Object.entries(dayBuckets)) {
      if (dayCandles.length < 10) continue;
      dayCandles.sort((a, b) => a.min - b.min);

      // Average volume for the day (all candles)
      const totalVolArr = dayCandles.map(c => c.v).filter(v => v > 0);
      const avgDayVol = totalVolArr.length > 0 ? totalVolArr.reduce((a, b) => a + b, 0) / totalVolArr.length : 0;

      // Context for the day
      const dd = dailyByDate[dateKey];
      const dayGapPct = dd && dd.prevClose ? Math.abs((dd.open - dd.prevClose) / dd.prevClose) * 100 : 0;
      const dayGapDir = dd && dd.prevClose ? (dd.open > dd.prevClose ? 'up' : 'down') : null;
      const isGapDay = dayGapPct > 0.5;

      const vix = vixByDate[dateKey] ?? null;
      const spy = spyByDate[dateKey] ?? null;
      const spyChange = spy ? Math.abs((spy.close - spy.open) / spy.open) * 100 : 0;
      const spyDir = spy ? (spy.close > spy.open ? 'up' : 'down') : null;
      const spyTrending = spyChange > 0.3;

      for (const tf of orbTimeframes) {
        const orbCandles = dayCandles.filter(c => c.min < tf.endMin);
        const afterCandles = dayCandles.filter(c => c.min >= tf.endMin);
        if (orbCandles.length === 0 || afterCandles.length < 3) continue;

        const orbHigh = Math.max(...orbCandles.map(c => c.h));
        const orbLow = Math.min(...orbCandles.map(c => c.l));
        const orbMid = (orbHigh + orbLow) / 2;
        const orbRange = orbMid > 0 ? (orbHigh - orbLow) / orbMid : 0;

        let brokeHigh = false, brokeLow = false;
        let firstBreakDir = null;
        let breakCandleVol = 0;
        for (const c of afterCandles) {
          if (!brokeHigh && c.h > orbHigh) {
            brokeHigh = true;
            if (!firstBreakDir) { firstBreakDir = 'up'; breakCandleVol = c.v; }
          }
          if (!brokeLow && c.l < orbLow) {
            brokeLow = true;
            if (!firstBreakDir) { firstBreakDir = 'down'; breakCandleVol = c.v; }
          }
        }

        const ct = counters[tf.key];
        ct.total++;

        // Classify break
        const isBroke = brokeHigh || brokeLow;
        if (brokeHigh && brokeLow) { ct.double++; }
        else if (brokeHigh) { ct.single++; ct.breakUp++; }
        else if (brokeLow) { ct.single++; ct.breakDown++; }
        else { ct.consol++; }

        // Clean vs failed (for single breaks: did last candle close outside ORB?)
        if (isBroke && !(brokeHigh && brokeLow)) {
          ct.totalBreaks++;
          const lastCandle = afterCandles[afterCandles.length - 1];
          const isClean = brokeHigh ? lastCandle.c > orbHigh : lastCandle.c < orbLow;
          if (isClean) ct.clean++; else ct.failed++;
        }

        // ORB range size
        const isSmall = orbRange < 0.003;
        const isLarge = orbRange > 0.01;
        if (isSmall) { ct.smallRange.total++; if (isBroke) ct.smallRange.broke++; }
        if (isLarge) { ct.largeRange.total++; if (isBroke) ct.largeRange.broke++; }

        // Volume confirmation
        if (avgDayVol > 0 && breakCandleVol > 0) {
          if (breakCandleVol > avgDayVol * 1.5) { ct.highVol.total++; if (isBroke) ct.highVol.broke++; }
          else { ct.lowVol.total++; if (isBroke) ct.lowVol.broke++; }
        }

        // VIX context
        if (vix != null) {
          if (vix <= 15) { ct.lowVix.total++; if (isBroke) ct.lowVix.broke++; }
          else if (vix > 25) { ct.highVix.total++; if (isBroke) ct.highVix.broke++; }
        }

        // Gap day influence
        if (isGapDay) {
          ct.gapDay.total++; if (isBroke) ct.gapDay.broke++;
          // Gap confluence: break in same direction as gap
          if (firstBreakDir && firstBreakDir === dayGapDir) {
            ct.gapConfluence.total++; if (isBroke) ct.gapConfluence.broke++;
          }
        } else {
          ct.noGapDay.total++; if (isBroke) ct.noGapDay.broke++;
        }

        // SPY trend / confirmation
        if (spyDir) {
          if (spyTrending) { ct.spyTrending.total++; if (isBroke) ct.spyTrending.broke++; }
          else { ct.spyRanging.total++; if (isBroke) ct.spyRanging.broke++; }
          if (firstBreakDir && firstBreakDir === spyDir) {
            ct.spyConfirm.total++; if (isBroke) ct.spyConfirm.broke++;
          }
        }
      }
    }

    // Aggregate stats per timeframe
    for (const tf of orbTimeframes) {
      const ct = counters[tf.key];
      const tot = ct.total || 1;
      orbStats[`orb${tf.key}_single_break`] = Number(((ct.single / tot) * 100).toFixed(1));
      orbStats[`orb${tf.key}_double_break`] = Number(((ct.double / tot) * 100).toFixed(1));
      orbStats[`orb${tf.key}_consolidation`] = Number(((ct.consol / tot) * 100).toFixed(1));
      orbStats[`orb${tf.key}_break_up`] = Number(((ct.breakUp / tot) * 100).toFixed(1));
      orbStats[`orb${tf.key}_break_down`] = Number(((ct.breakDown / tot) * 100).toFixed(1));
      // Clean / failed (% of breaks)
      orbStats[`orb${tf.key}_clean_break_prob`] = safePct(ct.clean, ct.totalBreaks);
      orbStats[`orb${tf.key}_failed_break_prob`] = safePct(ct.failed, ct.totalBreaks);
      // Range size conditional
      orbStats[`orb${tf.key}_small_range_break`] = safePct(ct.smallRange.broke, ct.smallRange.total);
      orbStats[`orb${tf.key}_large_range_break`] = safePct(ct.largeRange.broke, ct.largeRange.total);
      // Volume boost (difference between high-vol break rate and overall break rate)
      const overallBreakRate = (ct.single + ct.double) / tot * 100;
      const highVolRate = safePct(ct.highVol.broke, ct.highVol.total);
      orbStats[`orb${tf.key}_vol_confirm_boost`] = highVolRate != null ? Number((highVolRate - overallBreakRate).toFixed(1)) : null;
      // VIX influence
      const lowVixRate = safePct(ct.lowVix.broke, ct.lowVix.total);
      const highVixRate = safePct(ct.highVix.broke, ct.highVix.total);
      orbStats[`orb${tf.key}_low_vix_boost`] = lowVixRate != null ? Number((lowVixRate - overallBreakRate).toFixed(1)) : null;
      orbStats[`orb${tf.key}_high_vix_penalty`] = highVixRate != null ? Number((overallBreakRate - highVixRate).toFixed(1)) : null;
      // Gap influence
      const gapDayRate = safePct(ct.gapDay.broke, ct.gapDay.total);
      orbStats[`orb${tf.key}_large_gap_day_penalty`] = gapDayRate != null ? Number((overallBreakRate - gapDayRate).toFixed(1)) : null;
      const gapConfRate = safePct(ct.gapConfluence.broke, ct.gapConfluence.total);
      orbStats[`orb${tf.key}_gap_confluence_boost`] = gapConfRate != null ? Number((gapConfRate - overallBreakRate).toFixed(1)) : null;
      // SPY trending vs ranging
      orbStats[`orb${tf.key}_trending_market_break`] = safePct(ct.spyTrending.broke, ct.spyTrending.total);
      orbStats[`orb${tf.key}_ranging_market_break`] = safePct(ct.spyRanging.broke, ct.spyRanging.total);
      // Index confirmation boost
      const spyConfirmRate = safePct(ct.spyConfirm.broke, ct.spyConfirm.total);
      orbStats[`orb${tf.key}_index_confirm_boost`] = spyConfirmRate != null ? Number((spyConfirmRate - overallBreakRate).toFixed(1)) : null;
      // Gamma wall boost: not computable from Yahoo — leave null
      orbStats[`orb${tf.key}_gamma_wall_boost`] = null;
    }
    orbStats._orb_sample_days = Object.keys(dayBuckets).length;
  } catch (e) {
    console.warn('ORB intraday computation failed, using defaults:', e.message);
    orbStats = {
      orb5_single_break: 60, orb5_double_break: 20, orb5_consolidation: 20,
      orb15_single_break: 55, orb15_double_break: 18, orb15_consolidation: 27,
      orb30_single_break: 50, orb30_double_break: 15, orb30_consolidation: 35,
      orb1h_single_break: 45, orb1h_double_break: 12, orb1h_consolidation: 43,
    };
  }

  return {
    ticker: t,
    source: 'yahoo_finance_empirical',
    gap_fill_25: pct(fill25),
    gap_fill_50: pct(fill50),
    gap_fill_75: pct(fill75),
    gap_fill_100: pct(fill100),
    // Gap multifactor breakdown
    gap_small_fill100: safePct(gapBySize.small.f100, gapBySize.small.total),
    gap_moderate_fill100: safePct(gapBySize.moderate.f100, gapBySize.moderate.total),
    gap_medium_fill100: safePct(gapBySize.medium.f100, gapBySize.medium.total),
    gap_large_fill100: safePct(gapBySize.large.f100, gapBySize.large.total),
    gap_extreme_fill100: safePct(gapBySize.extreme.f100, gapBySize.extreme.total),
    gap_up_fill100: safePct(gapByDir.up.f100, gapByDir.up.total),
    gap_up_fill50: safePct(gapByDir.up.f50, gapByDir.up.total),
    gap_down_fill100: safePct(gapByDir.down.f100, gapByDir.down.total),
    gap_down_fill50: safePct(gapByDir.down.f50, gapByDir.down.total),
    gap_low_vix_fill100: safePct(gapByVix.low.f100, gapByVix.low.total),
    gap_high_vix_fill100: safePct(gapByVix.high.f100, gapByVix.high.total),
    gap_high_vol_fill100: safePct(gapByVol.high.f100, gapByVol.high.total),
    gap_trend_aligned_fill100: safePct(gapByTrend.aligned.f100, gapByTrend.aligned.total),
    gap_trend_opposed_fill100: safePct(gapByTrend.opposed.f100, gapByTrend.opposed.total),
    gap_sample_count: sample,
    ...orbStats,
    sample_count: sample,
    orb_sample_days: orbStats._orb_sample_days || 0,
    last_analyzed: new Date().toISOString(),
  };
}

async function invokeRefreshHistoricalStats() {
  // Batch refresh: iterate all unique tickers in Analysis, update TickerStats if stale (>7d)
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const analyses = getCollection('Analysis');
  const tickers = [...new Set(analyses.map((a) => a.ticker).filter(Boolean))];
  if (tickers.length === 0) return { message: 'No tickers found', tickers_processed: 0, updated: 0 };

  let updated = 0;
  for (const ticker of tickers) {
    try {
      const existing = getCollection('TickerStats').filter((s) => s.ticker === ticker);
      const stats = existing[0];
      if (stats && Date.now() - new Date(stats.last_analyzed).getTime() < TTL) continue;

      const data = await invokeGetHistoricalStats({ ticker });
      const row = { ...data, ticker, last_analyzed: new Date().toISOString() };
      const rows = getCollection('TickerStats');
      const idx = rows.findIndex((r) => r.ticker === ticker);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...row, updated_date: new Date().toISOString() };
      } else {
        rows.push({ id: uid(), created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...row });
      }
      setCollection('TickerStats', rows);
      updated++;
    } catch (e) {
      console.error(`refreshHistoricalStats failed for ${ticker}:`, e.message);
    }
  }
  return { message: 'Done', tickers_processed: tickers.length, updated };
}

async function invokeAlpacaProxy(payload) {
  const { ticker, timeframe = '1Min', limit = 120, apiKey, apiSecret } = payload || {};
  if (!ticker) throw new Error('ticker required');
  const feed = 'iex';
  const url = `/api/alpaca/v2/stocks/${encodeURIComponent(ticker)}/bars?timeframe=${timeframe}&limit=${limit}&feed=${feed}&adjustment=raw`;
  const headers = { Accept: 'application/json' };
  const envApiKey = import.meta.env.VITE_ALPACA_API_KEY;
  const envApiSecret = import.meta.env.VITE_ALPACA_SECRET_KEY;
  const finalApiKey = apiKey || envApiKey;
  const finalApiSecret = apiSecret || envApiSecret;

  if (finalApiKey && finalApiSecret) {
    headers['APCA-API-KEY-ID'] = finalApiKey;
    headers['APCA-API-SECRET-KEY'] = finalApiSecret;

    const alpaca = await fetch(url, { headers }).catch(() => null);
    if (alpaca?.ok) {
      const data = await alpaca.json();
      const bars = (data?.bars || []).map((b) => ({
        t: Math.floor(new Date(b.t).getTime() / 1000),
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
      }));
      return { bars, source: 'alpaca' };
    }
  }

  const intervalMap = { '1Min': '1m', '2Min': '2m', '5Min': '5m', '15Min': '15m', '30Min': '30m', '1Hour': '60m' };
  const rangeMap = { '1Min': '1d', '2Min': '1d', '5Min': '1d', '15Min': '5d', '30Min': '5d', '1Hour': '5d' };
  const y = await fetchYahooChart(String(ticker).toUpperCase(), intervalMap[timeframe] || '5m', rangeMap[timeframe] || '1d');
  const ts = y?.timestamp || [];
  const q = y?.indicators?.quote?.[0] || {};
  const bars = ts.map((tVal, i) => ({
    t: tVal,
    o: q.open?.[i],
    h: q.high?.[i],
    l: q.low?.[i],
    c: q.close?.[i],
    v: q.volume?.[i],
  })).filter((b) => b.o != null && b.c != null).slice(-limit);
  return { bars, source: 'yahoo' };
}

function getEntityApi(entityName) {
  return {
    async list(order, limit) {
      let rows = [...getCollection(entityName)];
      if (typeof order === 'string' && order.trim()) {
        const desc = order.startsWith('-');
        const field = desc ? order.slice(1) : order;
        rows.sort((a, b) => {
          const av = a?.[field] ?? '';
          const bv = b?.[field] ?? '';
          if (av === bv) return 0;
          return av > bv ? (desc ? -1 : 1) : (desc ? 1 : -1);
        });
      }
      if (typeof limit === 'number') rows = rows.slice(0, limit);
      return rows;
    },
    async filter(query = {}) {
      const rows = getCollection(entityName);
      return rows.filter((r) => Object.entries(query).every(([k, v]) => r?.[k] === v));
    },
    async create(data = {}) {
      const now = new Date().toISOString();
      const row = { id: uid(), created_date: now, updated_date: now, ...data };
      const rows = getCollection(entityName);
      rows.push(row);
      setCollection(entityName, rows);
      return row;
    },
    async update(id, patch = {}) {
      const rows = getCollection(entityName);
      const idx = rows.findIndex((r) => String(r.id) === String(id));
      if (idx === -1) throw new Error(`${entityName} no encontrado: ${id}`);
      const updated = { ...rows[idx], ...patch, id: rows[idx].id, updated_date: new Date().toISOString() };
      rows[idx] = updated;
      setCollection(entityName, rows);
      return updated;
    },
  };
}

async function invokeLLM(payload = {}) {
  const prompt = String(payload?.prompt || '').trim();
  if (!prompt) throw new Error('Prompt vacio');

  if (!llmBlockedUntil) llmBlockedUntil = readBlockUntil(LLM_BLOCK_UNTIL_KEY);

  if (Date.now() < llmBlockedUntil) {
    return buildLocalLlmFallback();
  }

  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Falta VITE_OPENROUTER_API_KEY para reemplazar InvokeLLM sin Base44.');
  }

  const modelMap = {
    gemini_3_flash: 'google/gemini-2.5-flash',
    gpt_4o_mini: 'openai/gpt-4o-mini',
  };
  const primaryModel = modelMap[payload?.model] || payload?.model || 'openai/gpt-4o-mini';

  // Free OpenRouter models used when primary model returns 402 (no credits).
  // These models are free and don't require credits on OpenRouter.
  const FREE_MODELS_DEFAULT = [
    'google/gemini-2.0-flash-exp:free',
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
  ];
  const FREE_FALLBACKS_ENV = String(import.meta.env.VITE_OPENROUTER_FALLBACK_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Use env-defined list if provided, otherwise use the hardcoded free models
  const FREE_FALLBACKS = FREE_FALLBACKS_ENV.length > 0 ? FREE_FALLBACKS_ENV : FREE_MODELS_DEFAULT;

  const schemaHint = '\nResponde SOLO con JSON valido. No incluyas markdown, comentarios ni texto fuera del JSON.';

  // Estimate max_tokens based on schema complexity
  let maxTokens = 4096;
  if (payload?.response_json_schema) {
    const schemaStr = JSON.stringify(payload.response_json_schema);
    const propCount = (schemaStr.match(/"type"/g) || []).length;
    if (propCount > 80) maxTokens = 6144;
    else if (propCount > 50) maxTokens = 5120;
    else if (propCount > 20) maxTokens = 4096;
  }

  // Try primary model, then free fallbacks on 402
  const modelsToTry = [primaryModel, ...FREE_FALLBACKS];

  for (let mi = 0; mi < modelsToTry.length; mi++) {
    const currentModel = modelsToTry[mi];
    const isFallback = mi > 0;

    const body = {
      model: currentModel,
      messages: [
        { role: 'system', content: 'Eres un analista cuantitativo. Responde estrictamente en JSON valido, sin markdown.' },
        { role: 'user', content: `${prompt}${schemaHint}` },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    let res;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') throw new Error('LLM timeout: la respuesta tardó más de 90 segundos. Intenta de nuevo.');
      throw e;
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const txt = await res.text();
      // 402 = out of credits on paid model — try free models immediately, no block.
      if (res.status === 402 && mi < modelsToTry.length - 1) {
        console.warn(`[LLM] 402 sin créditos con ${currentModel} — probando modelo gratuito: ${modelsToTry[mi + 1]}`);
        continue;
      }
      if (res.status === 402) {
        // All models exhausted (shouldn't happen with free fallbacks, but keep app alive)
        console.warn('[LLM] 402 sin créditos en todos los modelos. Usando fallback local.');
        return buildLocalLlmFallback();
      }
      // 400 can happen for unsupported params/model constraints — try next model
      if (res.status === 400 && mi < modelsToTry.length - 1) {
        console.warn(`[LLM] 400 en ${currentModel} — probando siguiente: ${modelsToTry[mi + 1]}`);
        continue;
      }
      // 429/503 on free model — try next fallback
      if ((res.status === 429 || res.status === 503) && mi < modelsToTry.length - 1) {
        console.warn(`[LLM] ${res.status} en ${currentModel} — probando siguiente: ${modelsToTry[mi + 1]}`);
        continue;
      }
      // 404 can happen if a model id is temporarily unavailable/retired
      if (res.status === 404 && mi < modelsToTry.length - 1) {
        console.warn(`[LLM] 404 en ${currentModel} — probando siguiente: ${modelsToTry[mi + 1]}`);
        continue;
      }
      if (res.status === 404 || res.status === 429 || res.status === 503 || res.status === 401 || res.status === 403) {
        setLlmBlock(10 * 60 * 1000);
        console.warn(`[LLM] ${res.status} en ${currentModel}. Activando fallback local por 10 minutos.`);
        return buildLocalLlmFallback();
      }

      // Last model failed (or non-retriable status): keep app usable via local fallback.
      setLlmBlock(10 * 60 * 1000);
      console.warn(`[LLM] ${res.status} en ${currentModel}. Activando fallback local por 10 minutos.`);
      return buildLocalLlmFallback();
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    const finishReason = json?.choices?.[0]?.finish_reason;
    if (!content) {
      if (mi < modelsToTry.length - 1) { console.warn(`[LLM] Sin contenido de ${currentModel}, probando siguiente`); continue; }
      throw new Error('LLM sin contenido de salida');
    }
    if (isFallback) console.info(`[LLM] Usando modelo gratuito: ${currentModel}`);
    if (finishReason === 'length') {
      console.warn('LLM respuesta truncada por max_tokens — intentando reparar JSON');
    }

    // Try to parse the response content
    const parsed = safeJsonParse(content, null);
    if (parsed) return parsed;

    // If parse failed, try to repair truncated JSON
    let repaired = content;
    // Remove trailing incomplete string values (truncated mid-string)
    repaired = repaired.replace(/,\s*"[^"]*":\s*"[^"]*$/, '');
    // Remove trailing incomplete key-value
    repaired = repaired.replace(/,\s*"[^"]*":\s*$/, '');
    // Remove trailing comma
    repaired = repaired.replace(/,\s*$/, '');
    // Close open strings
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) repaired += '"';
    // Close open brackets
    const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
    if (openBrackets > 0) repaired += ']'.repeat(openBrackets);
    // Close open braces
    const openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
    if (openBraces > 0) repaired += '}'.repeat(openBraces);

    const repairedParsed = safeJsonParse(repaired, null);
    if (repairedParsed) {
      console.warn('LLM JSON truncado — reparado automáticamente');
      return repairedParsed;
    }

    // If this model's JSON was invalid, try next model
    if (mi < modelsToTry.length - 1) {
      console.warn(`[LLM] JSON inválido de ${currentModel}, probando siguiente modelo`);
      continue;
    }

    console.error('LLM devolvió JSON inválido:', content.substring(0, 500));
    throw new Error('LLM devolvió JSON inválido. Intenta de nuevo.');
  } // end for loop

  setLlmBlock(10 * 60 * 1000);
  console.warn('[LLM] Todos los modelos fallaron; usando fallback local por 10 minutos para no bloquear la app.');
  return buildLocalLlmFallback();
}

const functionHandlers = {
  getStockPrice: invokeGetStockPrice,
  getTrendProfile: invokeGetTrendProfile,
  getIntradayData: invokeGetIntradayData,
  getPremarketData: invokeGetPremarketData,
  getVix: invokeGetVix,
  getGammaOI: invokeGetGammaOI,
  getHistoricalStats: invokeGetHistoricalStats,
  refreshHistoricalStats: invokeRefreshHistoricalStats,
  alpacaProxy: invokeAlpacaProxy,
};

export const base44 = {
  auth: {
    async me() {
      return {
        id: 'local-user',
        email: 'local@offline.dev',
        role: 'admin',
        provider: 'local',
      };
    },
    logout() {
      return;
    },
    redirectToLogin() {
      return;
    },
  },
  functions: {
    async invoke(name, payload = {}) {
      const handler = functionHandlers[name];
      if (!handler) {
        throw new Error(`Funcion no implementada en modo local: ${name}`);
      }
      const data = await handler(payload);
      return { data };
    },
  },
  integrations: {
    Core: {
      async InvokeLLM(payload) {
        return invokeLLM(payload);
      },
    },
  },
  entities: {
    Analysis: getEntityApi('Analysis'),
    BotSettings: getEntityApi('BotSettings'),
    JournalEntry: getEntityApi('JournalEntry'),
    MLTradeDataset: getEntityApi('MLTradeDataset'),
    SignalLog: getEntityApi('SignalLog'),
    TickerStats: getEntityApi('TickerStats'),
  },
};

// Utility to clear all API blocks (for manual reset from UI)
export function clearAllBlocks() {
  llmBlockedUntil = 0;
  optionsFetchBlockedUntil = 0;
  yahooOptionsBlockedUntil = 0;
  try {
    localStorage.removeItem(LLM_BLOCK_UNTIL_KEY);
    localStorage.removeItem(OPTIONS_BLOCK_UNTIL_KEY);
    localStorage.removeItem(YAHOO_OPTIONS_BLOCK_UNTIL_KEY);
  } catch { /* ignore */ }
}
