/**
 * Signal Aggregator — Cross-engine signal scoring
 * Combines signals from ultraSimple (ORB), scalpEngine, and smartMoneyEngine
 * into a unified confidence score and recommendation.
 */

const WEIGHTS = {
  smartMoney: 35,   // Smart money concepts (sweeps, FVG, MSS) — highest weight
  scalp: 25,        // Scalp engine (EMA alignment, momentum)
  orb: 20,          // ORB breakout (PMH/PML structure)
  marketContext: 20, // VIX, SPY trend, breadth alignment
};

/**
 * Normalize any engine signal to a standard format
 */
function normalizeSignal(source, raw) {
  if (!raw) return null;

  switch (source) {
    case 'smartMoney': {
      // smartMoneyEngine returns { signal, phase, score, grade, trade, smartMoney, context, momentum }
      const dir = raw.signal || raw.trade?.direction || 'NEUTRAL';
      return {
        source: 'smartMoney',
        direction: dir,
        score: raw.score || 0,
        grade: raw.grade || 'C',
        confidence: raw.score ? Math.min(100, 48 + raw.score * 0.7) : 0,
        hasEntry: !!raw.trade?.entry,
        entry: raw.trade?.entry || null,
        sl: raw.trade?.sl || null,
        tp: raw.trade?.tp1 || raw.trade?.tp2 || null,
        details: {
          sweep: raw.smartMoney?.sweep?.detected || false,
          fvg: raw.smartMoney?.fvg?.detected || false,
          mss: raw.smartMoney?.mss?.detected || false,
          vwapReclaim: raw.smartMoney?.vwapReclaim?.detected || false,
        },
      };
    }
    case 'scalp': {
      // scalpEngine returns { signal, phase, score, grade, trade, context, momentum }
      const dir = raw.signal || 'NEUTRAL';
      return {
        source: 'scalp',
        direction: dir,
        score: raw.score || 0,
        grade: raw.grade || 'C',
        confidence: raw.score ? Math.min(100, 48 + raw.score * 0.7) : 0,
        hasEntry: !!raw.trade?.entry,
        entry: raw.trade?.entry || null,
        sl: raw.trade?.sl || null,
        tp: raw.trade?.tp1 || raw.trade?.tp2 || null,
        details: {
          bias: raw.context?.bias || 'NEUTRAL',
          rsi: raw.momentum?.rsi || null,
          rvol: raw.momentum?.rvol || null,
        },
      };
    }
    case 'orb': {
      // ultraSimple returns { signal, phase, ticker, pmh, pml, orbH, orbL, trade }
      const dir = raw.signal || 'NEUTRAL';
      return {
        source: 'orb',
        direction: dir,
        score: raw.phase === 'GO' ? 80 : raw.orbBrokenUp ? 50 : 20,
        grade: raw.phase === 'GO' ? 'A' : 'C',
        confidence: raw.phase === 'GO' ? 78 : raw.orbBrokenUp ? 55 : 25,
        hasEntry: !!raw.trade?.entry,
        entry: raw.trade?.entry || null,
        sl: raw.trade?.sl || null,
        tp: raw.trade?.tp || null,
        details: {
          pmh: raw.pmh || null,
          pml: raw.pml || null,
          orbBrokenUp: raw.orbBrokenUp || false,
          pmhBroken: raw.pmhBroken || false,
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Aggregate multiple engine signals into a unified recommendation.
 *
 * @param {Object} signals - { smartMoney, scalp, orb } raw signal objects
 * @param {Object} marketCtx - { bias, vix, spy, session } from MarketContextProvider
 * @returns {Object} Unified signal with consensus direction, confidence, and entry levels
 */
export function aggregateSignals(signals = {}, marketCtx = {}) {
  const normalized = {
    smartMoney: normalizeSignal('smartMoney', signals.smartMoney),
    scalp: normalizeSignal('scalp', signals.scalp),
    orb: normalizeSignal('orb', signals.orb),
  };

  const active = Object.values(normalized).filter(s => s && s.direction !== 'NEUTRAL');

  if (active.length === 0) {
    return {
      consensus: 'NEUTRAL',
      confidence: 0,
      grade: 'C',
      action: 'WAIT',
      reason: 'No hay señales activas de ningún engine',
      signals: normalized,
      marketAlignment: false,
      entry: null,
      sl: null,
      tp: null,
    };
  }

  // Count directional votes (weighted)
  let bullWeight = 0, bearWeight = 0;
  const reasons = [];

  for (const [key, sig] of Object.entries(normalized)) {
    if (!sig || sig.direction === 'NEUTRAL') continue;
    const weight = WEIGHTS[key] || 10;
    const effectiveWeight = weight * (sig.confidence / 100);

    if (sig.direction === 'CALL') {
      bullWeight += effectiveWeight;
      reasons.push(`${key}: CALL (${sig.confidence.toFixed(0)}%)`);
    } else if (sig.direction === 'PUT') {
      bearWeight += effectiveWeight;
      reasons.push(`${key}: PUT (${sig.confidence.toFixed(0)}%)`);
    }
  }

  // Market context alignment bonus
  const marketBias = marketCtx.bias || 'NEUTRAL';
  let marketBonus = 0;
  if (marketBias.includes('BULLISH')) {
    bullWeight += WEIGHTS.marketContext * 0.6;
    marketBonus = bullWeight > bearWeight ? 8 : -5;
    reasons.push(`Market: ${marketBias}`);
  } else if (marketBias.includes('BEARISH')) {
    bearWeight += WEIGHTS.marketContext * 0.6;
    marketBonus = bearWeight > bullWeight ? 8 : -5;
    reasons.push(`Market: ${marketBias}`);
  }

  // VIX penalty for extreme conditions
  const vixValue = marketCtx.vix?.value || 20;
  let vixPenalty = 0;
  if (vixValue > 30) vixPenalty = -15;
  else if (vixValue > 25) vixPenalty = -8;
  reasons.push(`VIX: ${vixValue} (${marketCtx.vix?.regime || 'N/A'})`);

  // Determine consensus
  const totalWeight = bullWeight + bearWeight;
  const consensus = bullWeight > bearWeight * 1.3 ? 'CALL'
    : bearWeight > bullWeight * 1.3 ? 'PUT'
    : 'NEUTRAL';

  // Calculate unified confidence
  const dominantWeight = Math.max(bullWeight, bearWeight);
  const alignmentRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0;
  const engineAgreement = active.filter(s => s.direction === consensus).length / Math.max(active.length, 1);

  let confidence = Math.min(100, Math.round(
    (alignmentRatio * 40) +
    (engineAgreement * 35) +
    (active.length / 3 * 15) +
    marketBonus +
    vixPenalty +
    10 // base
  ));
  confidence = Math.max(0, confidence);

  // Grade
  const grade = confidence >= 80 && engineAgreement >= 0.8 ? 'A+'
    : confidence >= 70 && engineAgreement >= 0.6 ? 'A'
    : confidence >= 60 ? 'B'
    : 'C';

  // Best entry from the highest-confidence engine with an entry
  const bestSignal = active
    .filter(s => s.direction === consensus && s.hasEntry)
    .sort((a, b) => b.confidence - a.confidence)[0];

  // Market alignment check
  const marketAlignment = consensus === 'CALL'
    ? marketBias.includes('BULLISH')
    : consensus === 'PUT'
      ? marketBias.includes('BEARISH')
      : false;

  // Action recommendation
  let action = 'WAIT';
  if (grade === 'A+' || grade === 'A') action = consensus !== 'NEUTRAL' ? `ENTER ${consensus}` : 'WAIT';
  else if (grade === 'B' && marketAlignment) action = `LEAN ${consensus}`;

  // Session filter
  const session = marketCtx.session || 'CLOSED';
  if (session === 'CLOSED' || session === 'AFTERHOURS') {
    action = 'MARKET_CLOSED';
  } else if (session === 'MIDDAY' && grade !== 'A+') {
    action = 'WAIT — midday chop zone';
  }

  return {
    consensus,
    confidence,
    grade,
    action,
    reason: reasons.join(' | '),
    signals: normalized,
    marketAlignment,
    entry: bestSignal?.entry || null,
    sl: bestSignal?.sl || null,
    tp: bestSignal?.tp || null,
    engineAgreement: +(engineAgreement * 100).toFixed(0),
    activeEngines: active.length,
    session,
    vix: { value: vixValue, regime: marketCtx.vix?.regime },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Quick scan: run all engines for a ticker and aggregate
 */
export async function fullTickerScan(ticker, marketCtx = {}) {
  // Dynamic imports to avoid circular deps
  const [ultraMod, scalpMod, smartMod] = await Promise.allSettled([
    import('./ultraSimple.js').then(m => m.analyzeUltraSimple?.(ticker)).catch(() => null),
    import('./scalpEngine.js').then(m => m.analyzeScalp?.(ticker)).catch(() => null),
    import('./smartMoneyEngine.js').then(m => m.analyzeSmartMoney?.(ticker)).catch(() => null),
  ]);

  const signals = {
    orb: ultraMod.status === 'fulfilled' ? ultraMod.value : null,
    scalp: scalpMod.status === 'fulfilled' ? scalpMod.value : null,
    smartMoney: smartMod.status === 'fulfilled' ? smartMod.value : null,
  };

  return aggregateSignals(signals, marketCtx);
}

/**
 * Multi-ticker scan with aggregation
 */
export async function multiTickerScan(tickers, marketCtx = {}) {
  const results = await Promise.allSettled(
    tickers.map(t => fullTickerScan(t, marketCtx))
  );

  return results
    .map((r, i) => ({
      ticker: tickers[i],
      ...(r.status === 'fulfilled' ? r.value : { consensus: 'ERROR', confidence: 0, grade: 'C', action: 'ERROR' }),
    }))
    .filter(r => r.consensus !== 'ERROR')
    .sort((a, b) => b.confidence - a.confidence);
}
