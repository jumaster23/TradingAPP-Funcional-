/**
 * Options Analytics Engine
 * Browser-side ES module — Black-Scholes Greeks, GEX, DEX, IV surface, Max Pain, Flow Score.
 * Fetches data through /api/yahoo proxy (Yahoo Finance v7).
 */

const YAHOO_PROXY = '/api/yahoo';
const RISK_FREE_RATE = 0.05;

// ─── Yahoo Data Fetching ────────────────────────────────────────────────────

export async function fetchOptionsChain(ticker, expiration) {
  let url = `${YAHOO_PROXY}/v7/finance/options/${ticker}`;
  if (expiration != null) url += `?date=${expiration}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo fetch failed: ${res.status} ${res.statusText}`);

  const json = await res.json();
  const result = json.optionChain?.result?.[0];
  if (!result) throw new Error(`No options data for ${ticker}`);

  const calls = result.options?.[0]?.calls ?? [];
  const puts = result.options?.[0]?.puts ?? [];
  const expirations = result.expirationDates ?? [];
  const spot = result.quote?.regularMarketPrice;
  const expDate = result.options?.[0]?.expirationDate;

  return { calls, puts, expirations, spot, expDate };
}

// ─── Black-Scholes Helpers ──────────────────────────────────────────────────

/**
 * Standard normal CDF using Abramowitz & Stegun rational approximation (7.1.26).
 * Max error ~1.5e-7.
 */
export function normalCDF(x) {
  if (x === 0) return 0.5;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1.0 - poly * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal PDF.
 */
export function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes Greeks.
 * @param {number} S - Spot price
 * @param {number} K - Strike price
 * @param {number} T - Time to expiration in years
 * @param {number} r - Risk-free rate
 * @param {number} sigma - Implied volatility (annualized)
 * @param {'call'|'put'} type
 * @returns {{ delta: number, gamma: number, theta: number, vega: number }}
 */
export function calcGreeks(S, K, T, r, sigma, type) {
  const zeros = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return zeros;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const nd1 = normalCDF(d1);
  const npd1 = normalPDF(d1);

  const gamma = npd1 / (S * sigma * sqrtT);

  // Vega: same for calls and puts (per 1% move → divide by 100)
  const vega = S * npd1 * sqrtT * 0.01;

  let delta, theta;

  if (type === 'call') {
    delta = nd1;
    // Theta per calendar day
    theta = (-(S * npd1 * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365;
  } else {
    delta = nd1 - 1;
    // Theta per calendar day
    theta = (-(S * npd1 * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365;
  }

  return { delta, gamma, theta, vega };
}

// ─── GEX (Gamma Exposure) ───────────────────────────────────────────────────

/**
 * Gamma Exposure by strike.
 * Dealer positioning model: dealers are short calls (positive gamma) and long puts (negative gamma from dealer perspective).
 * @param {Array} calls
 * @param {Array} puts
 * @param {number} spot
 * @param {number} expDays - days to expiration
 */
export function calcGEXByStrike(calls, puts, spot, expDays) {
  const T = expDays / 365;
  const lowerBound = spot * 0.85;
  const upperBound = spot * 1.15;

  // Index puts by strike for quick lookup
  const putMap = new Map();
  for (const p of puts) {
    if (p.strike >= lowerBound && p.strike <= upperBound) {
      putMap.set(p.strike, p);
    }
  }

  const strikeSet = new Set();
  const callMap = new Map();
  for (const c of calls) {
    if (c.strike >= lowerBound && c.strike <= upperBound) {
      callMap.set(c.strike, c);
      strikeSet.add(c.strike);
    }
  }
  for (const strike of putMap.keys()) strikeSet.add(strike);

  const strikes = [...strikeSet].sort((a, b) => a - b);
  const data = [];
  let totalGEX = 0;

  for (const strike of strikes) {
    const call = callMap.get(strike);
    const put = putMap.get(strike);

    let callGEX = 0;
    let putGEX = 0;

    if (call) {
      const iv = call.impliedVolatility ?? 0;
      const oi = call.openInterest ?? 0;
      const { gamma } = calcGreeks(spot, strike, T, RISK_FREE_RATE, iv, 'call');
      callGEX = gamma * oi * 100 * spot * spot * 0.01;
    }

    if (put) {
      const iv = put.impliedVolatility ?? 0;
      const oi = put.openInterest ?? 0;
      const { gamma } = calcGreeks(spot, strike, T, RISK_FREE_RATE, iv, 'put');
      putGEX = gamma * oi * 100 * spot * spot * 0.01;
    }

    // Dealer model: short calls → positive gamma exposure, short puts → negative
    const netGEX = callGEX - putGEX;
    totalGEX += netGEX;

    data.push({ strike, callGEX, putGEX, netGEX });
  }

  // Gamma flip: strike where netGEX crosses zero
  let gammaFlip = null;
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1].netGEX;
    const curr = data[i].netGEX;
    if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
      // Linear interpolation
      const frac = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr));
      gammaFlip = data[i - 1].strike + frac * (data[i].strike - data[i - 1].strike);
      break;
    }
  }

  const regime = totalGEX > 0
    ? 'POSITIVE \u2014 dealers dampen moves'
    : 'NEGATIVE \u2014 dealers amplify moves';

  return { data, totalGEX, gammaFlip, regime };
}

// ─── DEX (Delta Exposure) ───────────────────────────────────────────────────

/**
 * Delta Exposure by strike.
 */
export function calcDEXByStrike(calls, puts, spot, expDays) {
  const T = expDays / 365;
  const lowerBound = spot * 0.85;
  const upperBound = spot * 1.15;

  const putMap = new Map();
  for (const p of puts) {
    if (p.strike >= lowerBound && p.strike <= upperBound) {
      putMap.set(p.strike, p);
    }
  }

  const strikeSet = new Set();
  const callMap = new Map();
  for (const c of calls) {
    if (c.strike >= lowerBound && c.strike <= upperBound) {
      callMap.set(c.strike, c);
      strikeSet.add(c.strike);
    }
  }
  for (const strike of putMap.keys()) strikeSet.add(strike);

  const strikes = [...strikeSet].sort((a, b) => a - b);
  const data = [];
  let totalDEX = 0;

  for (const strike of strikes) {
    const call = callMap.get(strike);
    const put = putMap.get(strike);

    let callDEX = 0;
    let putDEX = 0;

    if (call) {
      const iv = call.impliedVolatility ?? 0;
      const oi = call.openInterest ?? 0;
      const { delta } = calcGreeks(spot, strike, T, RISK_FREE_RATE, iv, 'call');
      callDEX = delta * oi * 100 * spot;
    }

    if (put) {
      const iv = put.impliedVolatility ?? 0;
      const oi = put.openInterest ?? 0;
      const { delta } = calcGreeks(spot, strike, T, RISK_FREE_RATE, iv, 'put');
      putDEX = delta * oi * 100 * spot; // put delta is already negative
    }

    const netDEX = callDEX + putDEX;
    totalDEX += netDEX;

    data.push({ strike, netDEX });
  }

  return { data, totalDEX };
}

// ─── IV Term Structure ──────────────────────────────────────────────────────

/**
 * ATM IV across expirations.
 * Fetches first 8 expirations with 300ms delay between requests.
 */
export async function calcIVTermStructure(ticker) {
  const { expirations, spot } = await fetchOptionsChain(ticker);
  const sliced = expirations.slice(0, 8);
  const result = [];

  for (let i = 0; i < sliced.length; i++) {
    if (i > 0) await delay(300);

    const expUnix = sliced[i];
    const { calls, puts } = await fetchOptionsChain(ticker, expUnix);

    // Find 4 strikes nearest to spot
    const allStrikes = new Set();
    for (const c of calls) allStrikes.add(c.strike);
    for (const p of puts) allStrikes.add(p.strike);

    const sorted = [...allStrikes].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
    const atmStrikes = sorted.slice(0, 4);

    // Average IV of ATM options
    let ivSum = 0;
    let ivCount = 0;

    for (const strike of atmStrikes) {
      const call = calls.find(c => c.strike === strike);
      const put = puts.find(p => p.strike === strike);
      if (call?.impliedVolatility) { ivSum += call.impliedVolatility; ivCount++; }
      if (put?.impliedVolatility) { ivSum += put.impliedVolatility; ivCount++; }
    }

    const atmIV = ivCount > 0 ? ivSum / ivCount : 0;
    const now = Date.now() / 1000;
    const dte = Math.max(0, Math.round((expUnix - now) / 86400));
    const expDate = new Date(expUnix * 1000).toISOString().slice(0, 10);

    result.push({ expDate, dte, atmIV });
  }

  // Detect contango vs backwardation
  if (result.length >= 2) {
    const frontIV = result[0].atmIV;
    const backIV = result[result.length - 1].atmIV;
    const structure = frontIV < backIV ? 'contango' : 'backwardation';
    return { data: result, structure };
  }

  return { data: result, structure: 'insufficient_data' };
}

// ─── IV Skew ────────────────────────────────────────────────────────────────

/**
 * IV smile/skew by strike near ATM.
 */
export function calcIVSkew(calls, puts, spot) {
  const lowerBound = spot * 0.90;
  const upperBound = spot * 1.10;

  const callMap = new Map();
  for (const c of calls) {
    if (c.strike >= lowerBound && c.strike <= upperBound && c.impliedVolatility) {
      callMap.set(c.strike, c.impliedVolatility);
    }
  }

  const putMap = new Map();
  for (const p of puts) {
    if (p.strike >= lowerBound && p.strike <= upperBound && p.impliedVolatility) {
      putMap.set(p.strike, p.impliedVolatility);
    }
  }

  const strikeSet = new Set([...callMap.keys(), ...putMap.keys()]);
  const strikes = [...strikeSet].sort((a, b) => a - b);

  const data = [];
  for (const strike of strikes) {
    const callIV = callMap.get(strike) ?? null;
    const putIV = putMap.get(strike) ?? null;
    const skew = (putIV != null && callIV != null) ? putIV - callIV : null;
    data.push({ strike, callIV, putIV, skew });
  }

  // Approximate 25-delta skew: ~5% OTM on each side
  const putOTMStrike = spot * 0.95;
  const callOTMStrike = spot * 1.05;

  const nearestPutOTM = findNearest(strikes, putOTMStrike);
  const nearestCallOTM = findNearest(strikes, callOTMStrike);

  const putIV25d = putMap.get(nearestPutOTM) ?? null;
  const callIV25d = callMap.get(nearestCallOTM) ?? null;
  const skew25d = (putIV25d != null && callIV25d != null) ? putIV25d - callIV25d : null;

  return { data, skew25d };
}

// ─── Max Pain ───────────────────────────────────────────────────────────────

/**
 * Max Pain calculation.
 * For each candidate strike P, compute total pain (intrinsic value * OI) across all options.
 */
export function calcMaxPainCurve(calls, puts) {
  // Collect all unique strikes
  const strikeSet = new Set();
  for (const c of calls) strikeSet.add(c.strike);
  for (const p of puts) strikeSet.add(p.strike);
  const strikes = [...strikeSet].sort((a, b) => a - b);

  if (strikes.length === 0) return { data: [], maxPainStrike: null };

  const data = [];
  let minPain = Infinity;
  let maxPainStrike = strikes[0];

  for (const P of strikes) {
    let callPain = 0;
    let putPain = 0;

    // For calls: if P > K, call holders gain (P - K) * OI * 100
    for (const c of calls) {
      const intrinsic = Math.max(0, P - c.strike);
      callPain += intrinsic * (c.openInterest ?? 0) * 100;
    }

    // For puts: if K > P, put holders gain (K - P) * OI * 100
    for (const p of puts) {
      const intrinsic = Math.max(0, p.strike - P);
      putPain += intrinsic * (p.openInterest ?? 0) * 100;
    }

    const totalPain = callPain + putPain;
    data.push({ strike: P, totalPain });

    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = P;
    }
  }

  return { data, maxPainStrike };
}

// ─── OI Distribution ────────────────────────────────────────────────────────

/**
 * Open Interest distribution by strike.
 */
export function calcOIDistribution(calls, puts, spot) {
  const lowerBound = spot * 0.85;
  const upperBound = spot * 1.15;

  const filteredCalls = calls.filter(c => c.strike >= lowerBound && c.strike <= upperBound);
  const filteredPuts = puts.filter(p => p.strike >= lowerBound && p.strike <= upperBound);

  const strikeSet = new Set();
  const callOIMap = new Map();
  const putOIMap = new Map();

  for (const c of filteredCalls) {
    callOIMap.set(c.strike, (c.openInterest ?? 0));
    strikeSet.add(c.strike);
  }
  for (const p of filteredPuts) {
    putOIMap.set(p.strike, (p.openInterest ?? 0));
    strikeSet.add(p.strike);
  }

  const strikes = [...strikeSet].sort((a, b) => a - b);
  const data = [];
  let maxCallOI = 0, callWall = null;
  let maxPutOI = 0, putWall = null;
  let totalCallOI = 0, totalPutOI = 0;

  for (const strike of strikes) {
    const callOI = callOIMap.get(strike) ?? 0;
    const putOI = putOIMap.get(strike) ?? 0;
    data.push({ strike, callOI, putOI });

    totalCallOI += callOI;
    totalPutOI += putOI;

    if (callOI > maxCallOI) { maxCallOI = callOI; callWall = strike; }
    if (putOI > maxPutOI) { maxPutOI = putOI; putWall = strike; }
  }

  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  return { data, callWall, putWall, pcr };
}

// ─── Flow Score ─────────────────────────────────────────────────────────────

/**
 * Options flow approximation — detects unusual activity and buyer/seller aggression.
 */
export function calcFlowScore(calls, puts) {
  const unusualActivity = [];
  let callVolume = 0, putVolume = 0;
  let bullishFlow = 0, bearishFlow = 0;

  const processOption = (opt, type) => {
    const vol = opt.volume ?? 0;
    const oi = opt.openInterest ?? 0;
    const ratio = oi > 0 ? vol / oi : 0;

    if (type === 'call') callVolume += vol;
    else putVolume += vol;

    // Unusual activity: volume/OI > 3
    if (ratio > 3 && vol > 0) {
      unusualActivity.push({
        strike: opt.strike,
        type,
        volume: vol,
        oi,
        ratio: Math.round(ratio * 100) / 100,
      });
    }

    // Buyer aggression: last price closer to ask = buyer
    const mid = ((opt.bid ?? 0) + (opt.ask ?? 0)) / 2;
    const last = opt.lastPrice ?? 0;
    if (mid > 0 && last > 0) {
      const isBuyer = last >= mid;
      const dollarFlow = vol * last * 100;

      if (type === 'call') {
        if (isBuyer) bullishFlow += dollarFlow;
        else bearishFlow += dollarFlow;
      } else {
        // Put buying = bearish, put selling = bullish
        if (isBuyer) bearishFlow += dollarFlow;
        else bullishFlow += dollarFlow;
      }
    }
  };

  for (const c of calls) processOption(c, 'call');
  for (const p of puts) processOption(p, 'put');

  const totalFlow = bullishFlow + bearishFlow;
  const score = totalFlow > 0 ? Math.round((bullishFlow / totalFlow) * 100) : 50;

  const totalVolume = callVolume + putVolume;
  let tilt = 'neutral';
  if (totalVolume > 0) {
    const callPct = callVolume / totalVolume;
    if (callPct > 0.6) tilt = 'bullish';
    else if (callPct < 0.4) tilt = 'bearish';
  }

  const pcr = callVolume > 0 ? putVolume / callVolume : 0;

  // Sort unusual activity by ratio descending
  unusualActivity.sort((a, b) => b.ratio - a.ratio);

  return { score, tilt, pcr, unusualActivity: unusualActivity.slice(0, 20) };
}

// ─── Full Report ────────────────────────────────────────────────────────────

/**
 * Full options analytics report for a ticker.
 * Combines all calculations. IV term structure runs sequentially (rate-limited).
 */
export async function fullOptionsReport(ticker) {
  // Fetch nearest expiration chain
  const chain = await fetchOptionsChain(ticker);
  const { calls, puts, spot, expDate } = chain;

  const now = Date.now() / 1000;
  const expDays = Math.max(1, Math.round((expDate - now) / 86400));

  // Run non-async calculations in parallel
  const [gex, dex, ivSkew, maxPain, oiDist, flow] = [
    calcGEXByStrike(calls, puts, spot, expDays),
    calcDEXByStrike(calls, puts, spot, expDays),
    calcIVSkew(calls, puts, spot),
    calcMaxPainCurve(calls, puts),
    calcOIDistribution(calls, puts, spot),
    calcFlowScore(calls, puts),
  ];

  // IV term structure — sequential due to Yahoo rate limiting
  const ivTermStructure = await calcIVTermStructure(ticker);

  return {
    ticker,
    spot,
    expDate: new Date(expDate * 1000).toISOString().slice(0, 10),
    expDays,
    gex,
    dex,
    ivSkew,
    ivTermStructure,
    maxPain,
    oiDistribution: oiDist,
    flow,
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findNearest(sortedArr, target) {
  if (sortedArr.length === 0) return null;
  let best = sortedArr[0];
  let bestDist = Math.abs(best - target);
  for (const val of sortedArr) {
    const dist = Math.abs(val - target);
    if (dist < bestDist) { best = val; bestDist = dist; }
  }
  return best;
}
