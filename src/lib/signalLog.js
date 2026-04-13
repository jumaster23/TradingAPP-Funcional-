import { base44 } from '@/api/base44Client';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSignal(signal) {
  const s = String(signal || '').toUpperCase();
  return s === 'CALL' || s === 'PUT' ? s : null;
}

function buildCandidate({ ticker, analysisType, timeframe, source, savedAnalysisId }) {
  const signal = normalizeSignal(source?.signal);
  const entry = toNumber(source?.entry ?? source?.entry_price);
  const sl = toNumber(source?.sl ?? source?.stop_loss);
  const tp = toNumber(source?.tp ?? source?.take_profit);

  if (!signal || entry == null || sl == null || tp == null) return null;

  return {
    ticker: String(ticker || '').toUpperCase(),
    analysis_type: analysisType || 'unknown',
    source_window: analysisType || 'unknown',
    timeframe: timeframe || 'general',
    signal,
    entry_price: entry,
    stop_loss: sl,
    take_profit: tp,
    status: 'PENDING',
    progress_pct: 0,
    max_progress_pct: 0,
    reached_level_price: entry,
    current_price: entry,
    last_checked_at: null,
    analysis_id: savedAnalysisId || null,
  };
}

function uniqueByKey(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [
      row.ticker,
      row.analysis_type,
      row.timeframe,
      row.signal,
      row.entry_price,
      row.stop_loss,
      row.take_profit,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function saveSignalsFromAnalysis({ ticker, analysisType, analysisResult, savedAnalysisId }) {
  if (!analysisResult || !ticker) return [];

  const candidates = [];

  const scalp = buildCandidate({
    ticker,
    analysisType,
    timeframe: 'scalp',
    source: analysisResult?.scalp,
    savedAnalysisId,
  });
  if (scalp) candidates.push(scalp);

  const intraday = buildCandidate({
    ticker,
    analysisType,
    timeframe: 'intraday',
    source: analysisResult?.intraday,
    savedAnalysisId,
  });
  if (intraday) candidates.push(intraday);

  const primary = buildCandidate({
    ticker,
    analysisType,
    timeframe: 'primary',
    source: analysisResult,
    savedAnalysisId,
  });
  if (primary) candidates.push(primary);

  const rows = uniqueByKey(candidates);
  if (!rows.length) return [];

  const created = [];
  for (const row of rows) {
    const saved = await base44.entities.SignalLog.create(row);
    created.push(saved);
  }
  return created;
}

export function evaluateSignalProgress(log, currentPrice) {
  const signal = normalizeSignal(log?.signal);
  const entry = toNumber(log?.entry_price);
  const sl = toNumber(log?.stop_loss);
  const tp = toNumber(log?.take_profit);
  const px = toNumber(currentPrice);

  if (!signal || entry == null || sl == null || tp == null || px == null) {
    return null;
  }

  let status = 'PENDING';
  let progress = 0;

  if (signal === 'CALL') {
    if (px >= tp) {
      status = 'TP_HIT';
      progress = 100;
    } else if (px <= sl) {
      status = 'SL_HIT';
      progress = 0;
    } else {
      const denom = tp - entry;
      progress = denom > 0 ? ((px - entry) / denom) * 100 : 0;
      progress = Math.max(0, Math.min(100, progress));
      status = progress > 0 ? 'IN_PROGRESS' : 'PENDING';
    }
  } else {
    if (px <= tp) {
      status = 'TP_HIT';
      progress = 100;
    } else if (px >= sl) {
      status = 'SL_HIT';
      progress = 0;
    } else {
      const denom = entry - tp;
      progress = denom > 0 ? ((entry - px) / denom) * 100 : 0;
      progress = Math.max(0, Math.min(100, progress));
      status = progress > 0 ? 'IN_PROGRESS' : 'PENDING';
    }
  }

  return {
    status,
    progress_pct: Number(progress.toFixed(2)),
    reached_level_price: px,
  };
}

export async function refreshSignalLogExecution(log) {
  const ticker = String(log?.ticker || '').toUpperCase();
  if (!ticker) return log;

  const quote = await base44.functions.invoke('getStockPrice', { ticker });
  const px = toNumber(quote?.data?.current_price);
  const evalResult = evaluateSignalProgress(log, px);
  if (!evalResult) return log;

  const maxProgress = Math.max(toNumber(log?.max_progress_pct) ?? 0, evalResult.progress_pct);

  return base44.entities.SignalLog.update(log.id, {
    status: evalResult.status,
    progress_pct: evalResult.progress_pct,
    max_progress_pct: Number(maxProgress.toFixed(2)),
    reached_level_price: evalResult.reached_level_price,
    current_price: evalResult.reached_level_price,
    last_checked_at: new Date().toISOString(),
  });
}
