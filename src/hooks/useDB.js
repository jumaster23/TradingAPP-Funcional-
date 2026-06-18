// DB hook — persiste en Neon, fallback a localStorage si la API falla

const BASE = '/api/db';

async function dbFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`DB error ${res.status}`);
  return res.json();
}

// ── Trades ────────────────────────────────────────────────────────────────────

export async function saveTrade(trade) {
  try {
    const result = await dbFetch('/trades', {
      method: 'POST',
      body: JSON.stringify({
        ticker:     trade.ticker,
        signal:     trade.signal,
        entry:      trade.entry,
        sl:         trade.sl,
        tp:         trade.tp,
        score:      trade.score,
        setupGrade: trade.setupGrade,
        atrUsed:    trade.atrUsedPct,
        volumeZone: trade.volumeZone,
        session:    trade.session,
      }),
    });
    return result.data;
  } catch {
    // fallback: persist id as timestamp
    return { id: Date.now(), ...trade };
  }
}

export async function closeTrade(id, exitPrice, result) {
  try {
    await dbFetch('/trades', {
      method: 'PATCH',
      body: JSON.stringify({ id, exitPrice, result, closedAt: new Date().toISOString() }),
    });
  } catch {
    // silent fallback — localStorage still updated by caller
  }
}

export async function getTrades(ticker, limit = 50) {
  try {
    const params = new URLSearchParams({ limit });
    if (ticker) params.set('ticker', ticker);
    const result = await dbFetch(`/trades?${params}`);
    return result.data || [];
  } catch {
    const saved = localStorage.getItem('trading_history');
    return saved ? JSON.parse(saved) : [];
  }
}

// ── Analyses ──────────────────────────────────────────────────────────────────

export async function saveAnalysis(analysis) {
  try {
    const result = await dbFetch('/analyses', {
      method: 'POST',
      body: JSON.stringify({
        ticker:        analysis.activo,
        setup:         analysis.setup,
        tendencia:     analysis.tendencia,
        precioEntrada: analysis.precioEntrada,
        stopLoss:      analysis.stopLoss,
        takeProfit:    analysis.takeProfit,
        riesgo:        analysis.riesgo,
        resultado:     analysis.resultado,
        rr:            analysis.rr,
        duracion:      analysis.duracion,
        volumen:       analysis.volumen,
        volatilidad:   analysis.volatilidad,
        nota:          analysis.nota,
        score:         analysis.score,
        clasificacion: analysis.clasificacion,
        mlProb:        analysis.mlProb,
      }),
    });
    return result.data;
  } catch {
    return null;
  }
}

export async function getAnalyses(ticker, limit = 100) {
  try {
    const params = new URLSearchParams({ limit });
    if (ticker) params.set('ticker', ticker);
    const result = await dbFetch(`/analyses?${params}`);
    return result.data || [];
  } catch {
    const saved = localStorage.getItem('live2_analisis');
    return saved ? JSON.parse(saved) : [];
  }
}

// ── Signals ───────────────────────────────────────────────────────────────────

export async function saveSignal(ticker, analysis) {
  if (!analysis || analysis.signal === 'WAIT') return;
  try {
    await dbFetch('/signals', {
      method: 'POST',
      body: JSON.stringify({
        ticker,
        signalType:   analysis.signal,
        entry:        analysis.entry,
        sl:           analysis.sl,
        tp:           analysis.tp,
        probability:  analysis.probability,
        score:        analysis.score,
        setupGrade:   analysis.setupGrade,
        atrUsedPct:   analysis.atrUsedPct,
        atrRemaining: analysis.atrRemaining,
        regime:       analysis.regime,
        volumeZone:   analysis.volumeZone,
        session:      analysis.session,
        reason:       analysis.reason,
      }),
    });
  } catch {
    // silent — signal logging is best-effort
  }
}

export async function getSignals(ticker, limit = 50) {
  try {
    const params = new URLSearchParams({ limit });
    if (ticker) params.set('ticker', ticker);
    const result = await dbFetch(`/signals?${params}`);
    return result.data || [];
  } catch {
    return [];
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export async function getMetrics(days = 30) {
  try {
    const result = await dbFetch(`/metrics?days=${days}`);
    return result;
  } catch {
    return { data: [], summary: null, todayCount: 0 };
  }
}

export async function getTodayTradeCount() {
  try {
    const result = await dbFetch('/metrics?days=1');
    return result.todayCount || 0;
  } catch {
    const saved = localStorage.getItem('daily_trade_count');
    if (!saved) return 0;
    try {
      const parsed = JSON.parse(saved);
      const today = new Date().toISOString().slice(0, 10);
      return parsed.date === today ? parsed.count : 0;
    } catch { return 0; }
  }
}
