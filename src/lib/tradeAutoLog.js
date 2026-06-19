/**
 * Trade Auto-Logger — automatically saves signals and trade outcomes to DB
 * Uses the /api/db/signals and /api/db/trades endpoints
 */

const DB_BASE = '/api/db';

/**
 * Log a signal when it's generated
 */
export async function logSignal({
  ticker,
  signal_type, // 'ORB', 'SCALP', 'SMART_MONEY', 'CONSENSUS'
  signal, // 'CALL', 'PUT', 'NEUTRAL'
  entry,
  sl,
  tp,
  probability,
  score,
  setup_grade,
  institutional_alignment,
  gex_regime,
  vix_value,
  notes,
}) {
  try {
    const res = await fetch(`${DB_BASE}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        signal_type,
        signal,
        entry_price: entry,
        stop_loss: sl,
        take_profit: tp,
        probability,
        score,
        setup_grade,
        institutional_alignment,
        gex_regime,
        vix_value,
        notes,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[tradeAutoLog] Failed to log signal:', e.message);
    return null;
  }
}

/**
 * Log a completed trade (entry + exit)
 */
export async function logTrade({
  ticker,
  signal, // 'CALL' or 'PUT'
  entry_price,
  exit_price,
  stop_loss,
  take_profit,
  result, // 'WIN', 'LOSS', 'BREAKEVEN'
  pnl,
  signal_type,
  setup_grade,
  session, // 'MORNING_KZ', 'MIDDAY', etc.
  notes,
}) {
  try {
    const res = await fetch(`${DB_BASE}/trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        signal,
        entry_price,
        exit_price,
        stop_loss,
        take_profit,
        result,
        pnl,
        signal_type,
        setup_grade,
        session,
        notes,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[tradeAutoLog] Failed to log trade:', e.message);
    return null;
  }
}

/**
 * Log daily metrics summary
 */
export async function logDailyMetrics({ date, trade_count, wins, losses, total_rr }) {
  try {
    const res = await fetch(`${DB_BASE}/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, trade_count, wins, losses, total_rr }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[tradeAutoLog] Failed to log metrics:', e.message);
    return null;
  }
}
