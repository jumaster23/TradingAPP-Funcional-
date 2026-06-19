/**
 * ORB + Institutional Levels — Enhanced ORB signals
 * Adds gamma flip, call/put walls, max pain as filters to the ORB strategy.
 *
 * FLOW:
 * 1. Run analyzeUltraSimple(ticker) — get ORB signal
 * 2. Fetch options data for institutional levels
 * 3. Filter/enhance the signal based on institutional alignment
 * 4. Return enhanced signal with institutional context
 */

import { analyzeUltraSimple, ultraSimpleScan } from './ultraSimple.js';
import { fetchOptionsChain, calcGEXByStrike, calcOIDistribution, calcMaxPainCurve } from './optionsAnalytics.js';

// Cache institutional levels for 5 minutes (they don't change intraday meaningfully)
let instCache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getInstitutionalLevels(ticker) {
  const now = Date.now();
  if (instCache[ticker] && now - instCache[ticker].ts < CACHE_TTL) {
    return instCache[ticker].data;
  }

  try {
    const chain = await fetchOptionsChain(ticker);
    if (!chain || !chain.calls || !chain.puts) return null;

    const spot = chain.spot;
    // fetchOptionsChain returns expDate (Unix timestamp), convert to days
    const expDays = chain.expDate
      ? Math.max(1, Math.round((chain.expDate * 1000 - Date.now()) / 86_400_000))
      : 30;

    const gex = calcGEXByStrike(chain.calls, chain.puts, spot, expDays);
    const oi  = calcOIDistribution(chain.calls, chain.puts, spot);
    const mp  = calcMaxPainCurve(chain.calls, chain.puts);

    // calcOIDistribution returns callWall/putWall as raw strike numbers (not objects)
    const data = {
      gammaFlip: gex?.gammaFlip ?? null,
      gexRegime:  gex?.regime   ?? null,
      callWall:   oi?.callWall  ?? null,   // number | null
      putWall:    oi?.putWall   ?? null,   // number | null
      maxPain:    mp?.maxPainStrike ?? null,
      pcr:        oi?.pcr       ?? null,
      spot,
    };

    instCache[ticker] = { data, ts: now };
    return data;
  } catch (e) {
    console.warn(`[orbInstitutional] Failed to fetch levels for ${ticker}:`, e.message);
    return null;
  }
}

/**
 * Enhanced ORB analysis with institutional filtering
 */
export async function analyzeORBWithInstitutional(ticker) {
  // Run ORB analysis and institutional fetch in parallel
  const [orbSignal, instLevels] = await Promise.all([
    analyzeUltraSimple(ticker),
    getInstitutionalLevels(ticker),
  ]);

  if (!orbSignal) return null;

  // If no institutional data, return original signal with unknown alignment
  if (!instLevels) {
    return {
      ...orbSignal,
      institutional: null,
      institutionalAlignment: 'UNKNOWN',
      enhancedConfidence: orbSignal.phase === 'GO' ? 70 : 0,
    };
  }

  const price = orbSignal.price;
  const { gammaFlip, callWall, putWall, maxPain, pcr, gexRegime } = instLevels;

  // Calculate institutional alignment
  let alignmentScore = 0;
  const alignmentReasons = [];

  if (orbSignal.signal === 'CALL' || orbSignal.signal === 'PUT') {
    const isCall = orbSignal.signal === 'CALL';

    // 1. Gamma Flip alignment (+25 / -15 points)
    if (gammaFlip != null) {
      if (isCall && price > gammaFlip) {
        alignmentScore += 25;
        alignmentReasons.push(`Sobre Gamma Flip $${gammaFlip.toFixed(2)} ✅`);
      } else if (!isCall && price < gammaFlip) {
        alignmentScore += 25;
        alignmentReasons.push(`Bajo Gamma Flip $${gammaFlip.toFixed(2)} ✅`);
      } else {
        alignmentScore -= 15;
        alignmentReasons.push(`${isCall ? 'Bajo' : 'Sobre'} Gamma Flip $${gammaFlip.toFixed(2)} ⚠️`);
      }
    }

    // 2. Wall alignment (+20 / -10 points)
    if (isCall && callWall != null) {
      const distToWall = ((callWall - price) / price) * 100;
      if (distToWall > 1 && distToWall < 5) {
        alignmentScore += 20;
        alignmentReasons.push(`Espacio al Call Wall $${callWall} (${distToWall.toFixed(1)}%) ✅`);
      } else if (distToWall <= 1) {
        alignmentScore -= 10;
        alignmentReasons.push(`Muy cerca del Call Wall $${callWall} — resistencia ⚠️`);
      }
    }
    if (!isCall && putWall != null) {
      const distToWall = ((price - putWall) / price) * 100;
      if (distToWall > 1 && distToWall < 5) {
        alignmentScore += 20;
        alignmentReasons.push(`Espacio al Put Wall $${putWall} (${distToWall.toFixed(1)}%) ✅`);
      } else if (distToWall <= 1) {
        alignmentScore -= 10;
        alignmentReasons.push(`Muy cerca del Put Wall $${putWall} — soporte ⚠️`);
      }
    }

    // 3. GEX regime (+15 / +10 points)
    if (gexRegime) {
      if (gexRegime.includes('POSITIVE')) {
        // Positive GEX = dampened moves = less ideal for breakout but more predictable
        alignmentScore += 10;
        alignmentReasons.push('GEX positivo — movimiento contenido');
      } else {
        // Negative GEX = amplified moves = good for breakout
        alignmentScore += 15;
        alignmentReasons.push('GEX negativo — movimiento amplificado ✅');
      }
    }

    // 4. Max Pain alignment (+10 points)
    if (maxPain != null) {
      if (isCall && price < maxPain) {
        alignmentScore += 10;
        alignmentReasons.push(`Bajo Max Pain $${maxPain} — magneto alcista ✅`);
      } else if (!isCall && price > maxPain) {
        alignmentScore += 10;
        alignmentReasons.push(`Sobre Max Pain $${maxPain} — magneto bajista ✅`);
      }
    }

    // 5. PCR alignment (+10 points)
    if (pcr != null) {
      if (isCall && pcr > 1.0) {
        alignmentScore += 10;
        alignmentReasons.push(`PCR ${pcr.toFixed(2)} — miedo = contrarian CALL ✅`);
      } else if (!isCall && pcr < 0.7) {
        alignmentScore += 10;
        alignmentReasons.push(`PCR ${pcr.toFixed(2)} — codicia = contrarian PUT ✅`);
      }
    }
  }

  // Determine alignment grade
  let institutionalAlignment;
  if (alignmentScore >= 50)      institutionalAlignment = 'STRONG';
  else if (alignmentScore >= 25) institutionalAlignment = 'MODERATE';
  else if (alignmentScore >= 0)  institutionalAlignment = 'WEAK';
  else                           institutionalAlignment = 'AGAINST';

  // Enhanced confidence: ORB base + institutional bonus
  const orbBase   = orbSignal.phase === 'GO' ? 75 : orbSignal.phase === 'WATCH' ? 40 : 10;
  const instBonus = Math.max(-15, Math.min(20, alignmentScore * 0.3));
  const enhancedConfidence = Math.max(0, Math.min(100, Math.round(orbBase + instBonus)));

  // FILTER: block trades that go AGAINST institutional levels
  let filtered = false;
  let filterReason = null;
  if (orbSignal.phase === 'GO' && institutionalAlignment === 'AGAINST') {
    filtered = true;
    filterReason = `Señal ORB bloqueada — niveles institucionales en contra (score: ${alignmentScore})`;
  }

  return {
    ...orbSignal,
    // Override signal if filtered
    signal: filtered ? 'NONE' : orbSignal.signal,
    phase:  filtered ? 'FILTERED' : orbSignal.phase,
    filtered,
    filterReason,
    institutional: {
      ...instLevels,
      alignmentScore,
      alignmentReasons,
      alignment: institutionalAlignment,
    },
    institutionalAlignment,
    enhancedConfidence,
  };
}

/**
 * Enhanced scan — all tickers with institutional overlay
 */
export async function enhancedORBScan(tickers) {
  const results = await Promise.all(tickers.map(t => analyzeORBWithInstitutional(t)));
  return {
    signals:  results.filter(r => r && r.signal !== 'NONE' && !r.filtered),
    filtered: results.filter(r => r && r.filtered),
    watching: results.filter(r => r && r.phase === 'WATCH'),
    all:      results.filter(r => r != null),
  };
}

/**
 * Pre-market prep: fetch institutional levels for watchlist
 * Call this at 9:00 AM ET to prepare the day's levels
 */
export async function premarketPrep(tickers = ['QQQ', 'SPY', 'NVDA', 'MSFT', 'AAPL', 'META', 'GOOGL', 'AMD', 'TSLA']) {
  const results = [];
  for (const ticker of tickers) {
    const levels = await getInstitutionalLevels(ticker);
    if (levels) {
      results.push({ ticker, ...levels });
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

/**
 * Clear the institutional level cache (call when market opens for fresh data)
 */
export function clearInstCache() {
  instCache = {};
}
