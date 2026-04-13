import { base44 } from '@/api/base44Client';

export const ML_FEATURE_VERSION = 'ml_v1';
let mlSettingsCache = { threshold: 0.7, enabled: true, ts: 0 };

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstNumber(values) {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function boolToNumber(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function clamp(value, min, max) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function normalizeSourceWindow(sourceWindow) {
  if (sourceWindow === 'scalp' || sourceWindow === 'intraday' || sourceWindow === 'daytrading') return 'daytrading';
  if (sourceWindow === 'probability' || sourceWindow === 'probabilities') return 'probabilities';
  if (sourceWindow === 'swing') return 'swing';
  if (sourceWindow === 'institutional') return 'institutional';
  return 'unknown';
}

function directionToNumber(value) {
  if (['CALL', 'BULLISH', 'READY_CALL', 'BUYING', 'INCREASING'].includes(value)) return 1;
  if (['PUT', 'BEARISH', 'READY_PUT', 'SELLING', 'DECREASING'].includes(value)) return -1;
  return 0;
}

function gradeToScore(value) {
  if (value === 'A+') return 1;
  if (value === 'B+') return 0.8;
  if (value === 'B') return 0.6;
  if (value === 'C') return 0.25;
  return null;
}

function sizeToScore(value) {
  if (value === 'large') return 1;
  if (value === 'normal') return 0.6;
  if (value === 'small') return 0.25;
  return null;
}

function vixRegimeToScore(value) {
  if (value === 'LOW') return 1;
  if (value === 'MODERATE') return 0.7;
  if (value === 'HIGH') return 0.35;
  if (value === 'EXTREME') return 0;
  return null;
}

function orbStatusToScore(value) {
  if (value === 'single_break_up') return 1;
  if (value === 'single_break_down') return -1;
  if (value === 'double_break') return 0;
  if (value === 'consolidating') return 0.25;
  return 0;
}

function getAnalysisPayload(analysisRecord) {
  if (!analysisRecord) return null;
  if (typeof analysisRecord.analysis_data === 'string') return safeJsonParse(analysisRecord.analysis_data, null);
  return analysisRecord.analysis_data || analysisRecord;
}

function getCurrentPrice(payload) {
  return firstNumber([
    payload?.current_price,
    payload?._current_price,
    payload?.key_levels?.current_price,
    payload?.entry_price,
    payload?.scalp?.entry,
    payload?.intraday?.entry,
  ]);
}

function getPrimarySection(payload, sourceWindow) {
  if (sourceWindow === 'daytrading') {
    if (payload?.scalp?.signal) return payload.scalp;
    return payload?.intraday || payload?.scalp || null;
  }
  if (sourceWindow === 'swing') return payload?.swing_methodology || payload;
  return payload;
}

function buildDistance(currentPrice, level, normalizer) {
  if (currentPrice == null || level == null || !normalizer) return null;
  return Number(((currentPrice - level) / normalizer).toFixed(4));
}

function compactNumericFeatures(features) {
  return Object.fromEntries(
    Object.entries(features).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
  );
}

async function getConfiguredMlSettings() {
  const now = Date.now();
  if (now - mlSettingsCache.ts < 60000) return mlSettingsCache;

  try {
    const settings = await base44.entities.BotSettings.list('-created_date', 1);
    const latest = settings?.[0] || {};
    const thresholdVal = Number(latest?.ml_filter_threshold);
    const enabledVal = typeof latest?.ml_filter_enabled === 'boolean' ? latest.ml_filter_enabled : true;
    mlSettingsCache = {
      threshold: Number.isFinite(thresholdVal) && thresholdVal > 0 && thresholdVal < 1 ? thresholdVal : 0.7,
      enabled: enabledVal,
      ts: now,
    };
    return mlSettingsCache;
  } catch {
    mlSettingsCache = { threshold: 0.7, enabled: true, ts: now };
    return mlSettingsCache;
  }
}

export function extractMlFeaturesFromAnalysisRecord(analysisRecord) {
  const payload = getAnalysisPayload(analysisRecord);
  if (!payload) return null;

  const sourceWindow = normalizeSourceWindow(payload?.analysis_meta?.source_window || analysisRecord?.type || 'unknown');
  const meta = payload?.analysis_meta || {};
  const section = getPrimarySection(payload, sourceWindow) || {};
  const signal = meta.overall_signal || analysisRecord?.signal || payload?.signal || payload?.scalp?.signal || payload?.intraday?.signal || 'NEUTRAL';
  const currentPrice = getCurrentPrice(payload);
  const entry = firstNumber([payload?.entry_price, section?.entry, payload?.scalp?.entry, payload?.intraday?.entry]);
  const stopLoss = firstNumber([payload?.stop_loss, section?.sl, payload?.scalp?.sl, payload?.intraday?.sl]);
  const takeProfit = firstNumber([payload?.take_profit, section?.tp, payload?.scalp?.tp, payload?.intraday?.tp]);
  const plannedRisk = entry != null && stopLoss != null ? Math.abs(entry - stopLoss) : null;
  const normalizer = firstNumber([
    payload?.strategies?.volume_profile_reversion?.atr_15m,
    plannedRisk,
    currentPrice != null ? currentPrice * 0.005 : null,
    1,
  ]);

  const gammaLevel = firstNumber([payload?.gamma_level, payload?.key_levels?.gamma_level, payload?.scalp?.gamma_level, payload?.intraday?.gamma_level]);
  const callWall = firstNumber([payload?.call_wall, payload?.key_levels?.call_wall, payload?.scalp?.call_wall, payload?.intraday?.call_wall]);
  const putWall = firstNumber([payload?.put_wall, payload?.key_levels?.put_wall, payload?.scalp?.put_wall, payload?.intraday?.put_wall]);
  const vixLevel = firstNumber([payload?.vix_level, payload?._vix, payload?.vix_value, payload?.scalp?.vix_value, payload?.intraday?.vix_value]);
  const vixRegime = payload?.vix_regime || payload?.window_consensus?.market_regime || payload?.scalp?.vix_regime || payload?.intraday?.vix_regime || null;
  const bbPct = firstNumber([payload?.bollinger?.bb_1m?.pct_b, payload?.bollinger?.bb_5m?.pct_b]);
  const ema9 = firstNumber([section?.ema9, section?.ema9_5min]);
  const ema20 = firstNumber([section?.ema20, section?.ema20_5min, payload?.ema20_1h, payload?.ema20_15m]);
  const ema50 = firstNumber([section?.ema50, section?.ema50_5min, payload?.ema50_1h, payload?.ema50_15m]);
  const vp = payload?.strategies?.volume_profile_reversion || {};
  const orb5 = payload?.orb_5min || {};
  const orb15 = payload?.orb_15min || {};
  const orb30 = payload?.orb_30min || {};
  const successProbability = firstNumber([payload?.success_probability, section?.success_prob, payload?.scalp?.success_prob, payload?.intraday?.success_prob]);
  const rrPlanned = plannedRisk && entry != null && takeProfit != null ? Math.abs(takeProfit - entry) / plannedRisk : null;
  const totalCallOi = firstNumber([payload?._total_call_oi]);
  const totalPutOi = firstNumber([payload?._total_put_oi]);
  const callOiDominance = totalCallOi != null && totalPutOi != null && (totalCallOi + totalPutOi) > 0
    ? (totalCallOi - totalPutOi) / (totalCallOi + totalPutOi)
    : null;
  const gammaAlignment = (() => {
    if (signal === 'CALL') {
      if (currentPrice != null && putWall != null && currentPrice >= putWall) return 1;
      if (currentPrice != null && callWall != null && currentPrice >= callWall) return -1;
    }
    if (signal === 'PUT') {
      if (currentPrice != null && callWall != null && currentPrice <= callWall) return 1;
      if (currentPrice != null && putWall != null && currentPrice <= putWall) return -1;
    }
    return 0;
  })();

  const features = compactNumericFeatures({
    signal_direction: directionToNumber(signal),
    success_probability: successProbability != null ? Number((successProbability / 100).toFixed(4)) : null,
    setup_grade_score: gradeToScore(meta.setup_grade || payload?.setup_grade),
    size_tier_score: sizeToScore(meta.size_tier || meta.execution_tier || payload?.window_consensus?.size_tier),
    vix_level: vixLevel,
    vix_regime_score: vixRegimeToScore(vixRegime),
    spx_trend: directionToNumber(section?.spx_direction || section?.spx_confirm || payload?.index_confluence?.market_direction),
    nq_trend: directionToNumber(section?.nq_direction || section?.nq_confirm),
    nasdaq_trend: directionToNumber(section?.nasdaq100_direction || section?.nasdaq_confirm),
    gamma_signal_alignment: gammaAlignment,
    price_to_gamma_atr: buildDistance(currentPrice, gammaLevel, normalizer),
    price_to_call_wall_atr: buildDistance(currentPrice, callWall, normalizer),
    price_to_put_wall_atr: buildDistance(currentPrice, putWall, normalizer),
    bollinger_position: bbPct,
    ema20_distance_atr: buildDistance(currentPrice, ema20, normalizer),
    ema50_distance_atr: buildDistance(currentPrice, ema50, normalizer),
    ema_stack_bullish: ema9 != null && ema20 != null && ema50 != null ? boolToNumber(ema9 > ema20 && ema20 > ema50) : null,
    ema_stack_bearish: ema9 != null && ema20 != null && ema50 != null ? boolToNumber(ema9 < ema20 && ema20 < ema50) : null,
    volume_spike: boolToNumber(section?.volume_confirms || vp?.volume_impulse),
    fake_breakout_flag: boolToNumber(section?.fake_breakout_risk === 'HIGH' || vp?.setup_type === 'fake_breakout_trap'),
    rejection_candle: boolToNumber(payload?.strategies?.liquidity_sweep?.wick_rejection || vp?.setup_type === 'fake_breakout_trap'),
    liquidity_sweep_detected: boolToNumber(payload?.strategies?.liquidity_sweep?.detected),
    breakout_ready: boolToNumber(payload?.strategies?.breakout_retest?.trade_ready || payload?.strategies?.breakout_retest?.valid_breakout || vp?.setup_type === 'real_breakout_continuation'),
    orb5_position: orb5?.high != null && orb5?.low != null && currentPrice != null && orb5.high !== orb5.low ? clamp((currentPrice - orb5.low) / (orb5.high - orb5.low), 0, 1) : null,
    orb15_position: orb15?.high != null && orb15?.low != null && currentPrice != null && orb15.high !== orb15.low ? clamp((currentPrice - orb15.low) / (orb15.high - orb15.low), 0, 1) : null,
    orb30_position: orb30?.high != null && orb30?.low != null && currentPrice != null && orb30.high !== orb30.low ? clamp((currentPrice - orb30.low) / (orb30.high - orb30.low), 0, 1) : null,
    orb5_status_score: orbStatusToScore(orb5?.status),
    orb15_status_score: orbStatusToScore(orb15?.status),
    orb30_status_score: orbStatusToScore(orb30?.status),
    price_to_poc_atr: buildDistance(currentPrice, vp?.poc, normalizer),
    price_to_vah_atr: buildDistance(currentPrice, vp?.vah, normalizer),
    price_to_val_atr: buildDistance(currentPrice, vp?.val, normalizer),
    vp_setup_value_reversion: boolToNumber(vp?.setup_type === 'value_reversion'),
    vp_setup_breakout: boolToNumber(vp?.setup_type === 'real_breakout_continuation'),
    vp_setup_fake_breakout: boolToNumber(vp?.setup_type === 'fake_breakout_trap'),
    index_confluence_votes: firstNumber([Number(String(vp?.index_confluence || '').split('/')[0]), payload?.index_confluence?.aligned ? 3 : null]),
    put_call_ratio: firstNumber([payload?._put_call_ratio]),
    call_oi_dominance: callOiDominance,
    rr_planned: rrPlanned != null ? Number(rrPlanned.toFixed(4)) : null,
    current_vs_entry_atr: buildDistance(currentPrice, entry, normalizer),
    premarket_direction: directionToNumber(section?.premarket_direction),
    market_bias: directionToNumber(payload?.intraday_bias || payload?.window_consensus?.overall_signal),
    tf_daily_trend: directionToNumber(payload?.window_consensus?.daily_trend),
    tf_4h_trend: directionToNumber(payload?.window_consensus?.tf4h_trend),
    tf_1h_ready: boolToNumber(payload?.window_consensus?.tf1h_ready),
  });

  return {
    analysis_id: analysisRecord?.id || null,
    ticker: String(analysisRecord?.ticker || '').toUpperCase(),
    source_window: sourceWindow,
    signal,
    setup_grade: meta.setup_grade || payload?.setup_grade || null,
    size_tier: meta.size_tier || meta.execution_tier || payload?.window_consensus?.size_tier || null,
    success_probability: successProbability,
    captured_at: analysisRecord?.created_date || new Date().toISOString(),
    feature_version: ML_FEATURE_VERSION,
    feature_count: Object.keys(features).length,
    features,
    summary: payload?.analysis_summary || payload?.summary || payload?.scalp?.summary || payload?.intraday?.summary || null,
  };
}

export function extractMlFeaturesFromPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const { sourceWindow = 'unknown', ticker = '' } = options;
  return extractMlFeaturesFromAnalysisRecord({
    analysis_data: payload,
    type: sourceWindow,
    ticker,
  });
}

function computeSimilarity(currentFeatures, sampleFeatures) {
  const currentKeys = Object.keys(currentFeatures || {});
  let overlap = 0;
  let accDistance = 0;

  for (const key of currentKeys) {
    if (typeof sampleFeatures?.[key] !== 'number') continue;
    const a = currentFeatures[key];
    const b = sampleFeatures[key];
    const denom = Math.abs(a) + Math.abs(b) + 1;
    const d = Math.abs(a - b) / denom;
    overlap += 1;
    accDistance += d;
  }

  if (overlap < 8) return null;
  const meanDistance = accDistance / overlap;
  const similarity = 1 / (1 + meanDistance);
  return { similarity, overlap };
}

export async function inferMlProbabilityFromPayload(payload, options = {}) {
  const { sourceWindow = 'unknown', ticker = '', threshold = null } = options;
  const configured = await getConfiguredMlSettings();
  const activeThreshold = Number.isFinite(Number(threshold)) ? Number(threshold) : configured.threshold;
  const extracted = extractMlFeaturesFromPayload(payload, { sourceWindow, ticker });
  if (!extracted?.features || !Object.keys(extracted.features).length) return null;

  if (!configured.enabled) {
    return {
      ml_probability: null,
      threshold: activeThreshold,
      pass_filter: true,
      samples_used: 0,
      confidence_tier: 'LOW',
      note: 'Filtro ML desactivado en BotSettings.',
    };
  }

  const rows = await base44.entities.MLTradeDataset.list('-created_date', 5000);
  const labeled = rows.filter((row) => row?.dataset_status === 'labeled' && (row?.label === 0 || row?.label === 1));
  if (!labeled.length) return {
    ml_probability: null,
    threshold: activeThreshold,
    pass_filter: null,
    samples_used: 0,
    confidence_tier: 'LOW',
    note: 'Sin muestras etiquetadas suficientes para inferencia ML.',
  };

  const normalizedWindow = normalizeSourceWindow(sourceWindow);
  const windowRows = labeled.filter((row) => normalizeSourceWindow(row?.source_window) === normalizedWindow);
  const pool = windowRows.length >= 40 ? windowRows : labeled;

  const scored = [];
  for (const row of pool) {
    const features = safeJsonParse(row?.features_json, null);
    if (!features || typeof features !== 'object') continue;
    const sim = computeSimilarity(extracted.features, features);
    if (!sim) continue;
    scored.push({
      similarity: sim.similarity,
      overlap: sim.overlap,
      label: Number(row.label),
    });
  }

  if (!scored.length) {
    return {
      ml_probability: null,
      threshold: activeThreshold,
      pass_filter: null,
      samples_used: 0,
      confidence_tier: 'LOW',
      note: 'No hay overlap de features con el dataset etiquetado.',
    };
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, Math.min(120, scored.length));
  const weighted = top.reduce((acc, item) => {
    acc.w += item.similarity;
    acc.y += item.similarity * item.label;
    return acc;
  }, { w: 0, y: 0 });

  const mlProb = weighted.w > 0 ? Number((weighted.y / weighted.w).toFixed(4)) : null;
  const confidenceTier = top.length >= 250 ? 'HIGH' : top.length >= 100 ? 'MEDIUM' : 'LOW';

  return {
    ml_probability: mlProb,
    threshold: activeThreshold,
    pass_filter: mlProb != null ? mlProb >= activeThreshold : null,
    samples_used: top.length,
    confidence_tier: confidenceTier,
    note: mlProb == null
      ? 'No se pudo calcular probabilidad ML.'
      : `Probabilidad ML estimada con ${top.length} muestras etiquetadas${windowRows.length >= 40 ? ` de ${normalizedWindow}` : ''}.`,
  };
}

export async function upsertMlTradeSampleFromAnalysis(analysisRecord) {
  const extracted = extractMlFeaturesFromAnalysisRecord(analysisRecord);
  if (!extracted?.analysis_id) return null;

  const existing = await base44.entities.MLTradeDataset.filter({ analysis_id: extracted.analysis_id });
  const current = existing?.[0] || null;
  const patch = {
    analysis_id: extracted.analysis_id,
    ticker: extracted.ticker,
    source_window: extracted.source_window,
    signal: extracted.signal,
    setup_grade: extracted.setup_grade,
    size_tier: extracted.size_tier,
    success_probability: extracted.success_probability,
    feature_version: extracted.feature_version,
    feature_count: extracted.feature_count,
    features_json: JSON.stringify(extracted.features),
    summary: extracted.summary,
    captured_at: extracted.captured_at,
    dataset_status: current?.dataset_status || 'pending_outcome',
    label: current?.label ?? null,
    profit: current?.profit ?? null,
    journal_entry_id: current?.journal_entry_id ?? null,
    closed_at: current?.closed_at ?? null,
  };

  if (current) return base44.entities.MLTradeDataset.update(current.id, patch);
  return base44.entities.MLTradeDataset.create(patch);
}

export async function syncMlTradeSampleWithJournalEntry(journalEntry, analysisRecord = null) {
  if (!journalEntry) return null;

  const linkedAnalysis = analysisRecord || null;
  const analysisId = journalEntry.analysis_id || linkedAnalysis?.id || null;
  let current = null;

  if (analysisId) {
    current = (await base44.entities.MLTradeDataset.filter({ analysis_id: analysisId }))?.[0] || null;
  }
  if (!current && journalEntry.id) {
    current = (await base44.entities.MLTradeDataset.filter({ journal_entry_id: journalEntry.id }))?.[0] || null;
  }
  if (!current && linkedAnalysis) {
    current = await upsertMlTradeSampleFromAnalysis(linkedAnalysis);
  }
  if (!current) return null;

  return base44.entities.MLTradeDataset.update(current.id, {
    journal_entry_id: journalEntry.id,
    dataset_status: 'labeled',
    label: journalEntry.result === 'win' ? 1 : 0,
    profit: Number(journalEntry.pnl || 0),
    closed_at: new Date().toISOString(),
  });
}

export async function appendLabeledSampleToSimpleDataset(journalEntry, mlSample) {
  if (!journalEntry || !mlSample) return null;
  const label = Number(mlSample?.label);
  if (!(label === 0 || label === 1)) return null;

  const payload = buildSimpleDatasetPayload(journalEntry, mlSample);
  if (!payload) return null;

  const response = await fetch('/api/ml/dataset/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ml_dataset_append_failed: ${errText}`);
  }

  return response.json();
}

export function buildSimpleDatasetPayload(journalEntry, mlSample) {
  if (!journalEntry || !mlSample) return null;
  const label = Number(mlSample?.label);
  if (!(label === 0 || label === 1)) return null;

  const parsedFeatures = safeJsonParse(mlSample?.features_json, {}) || {};
  const numericFeatures = Object.fromEntries(
    Object.entries(parsedFeatures).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
  );

  return {
    id: mlSample?.analysis_id || journalEntry?.analysis_id || journalEntry?.id || null,
    timestamp: journalEntry?.date ? `${journalEntry.date}T${journalEntry.entry_time || '12:00'}:00` : new Date().toISOString(),
    result: label,
    profit: Number(journalEntry?.pnl ?? mlSample?.profit ?? 0),
    ml_probability: toNumber(journalEntry?.ml_probability),
    ml_pass_filter: boolToNumber(journalEntry?.ml_pass_filter),
    ...numericFeatures,
  };
}

function getMinutesBetween(date, fromTime, toTime) {
  if (!date || !fromTime || !toTime) return null;
  const start = new Date(`${date}T${fromTime}:00`);
  const end = new Date(`${date}T${toTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, (end.getTime() - start.getTime()) / 60000);
}

function buildSimpleDatasetPayloadFromJournalEntry(journalEntry) {
  if (!journalEntry) return null;
  const pnl = Number(journalEntry?.pnl ?? 0);
  const resultRaw = journalEntry?.result;
  const result = resultRaw === 'win' ? 1 : resultRaw === 'loss' ? 0 : (pnl >= 0 ? 1 : 0);
  if (!(result === 0 || result === 1)) return null;

  const entryPrice = Number(journalEntry?.entry_price ?? 0);
  const stopLoss = Number(journalEntry?.stop_loss ?? 0);
  const takeProfit = Number(journalEntry?.take_profit ?? 0);
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  const rrPlanned = risk > 0 ? reward / risk : 0;
  const holdMinutes = getMinutesBetween(journalEntry?.date, journalEntry?.entry_time, journalEntry?.exit_time);

  return {
    id: journalEntry?.analysis_id || journalEntry?.id || null,
    timestamp: journalEntry?.date ? `${journalEntry.date}T${journalEntry.entry_time || '12:00'}:00` : new Date().toISOString(),
    result,
    profit: pnl,
    ml_probability: toNumber(journalEntry?.ml_probability),
    ml_pass_filter: boolToNumber(journalEntry?.ml_pass_filter),
    direction_signal: journalEntry?.direction === 'CALL' ? 1 : journalEntry?.direction === 'PUT' ? -1 : 0,
    entry_price: Number.isFinite(entryPrice) ? entryPrice : 0,
    stop_loss: Number.isFinite(stopLoss) ? stopLoss : 0,
    take_profit: Number.isFinite(takeProfit) ? takeProfit : 0,
    risk_distance: Number.isFinite(risk) ? risk : 0,
    rr_planned: Number.isFinite(rrPlanned) ? rrPlanned : 0,
    hold_minutes: Number.isFinite(holdMinutes) ? holdMinutes : null,
    analysis_setup_grade_score:
      journalEntry?.analysis_setup_grade === 'A+' ? 1
        : journalEntry?.analysis_setup_grade === 'B+' ? 0.8
          : journalEntry?.analysis_setup_grade === 'B' ? 0.6
            : journalEntry?.analysis_setup_grade === 'C' ? 0.25
              : null,
    analysis_source_window_score:
      journalEntry?.analysis_source_window === 'daytrading' ? 1
        : journalEntry?.analysis_source_window === 'probabilities' ? 0.75
          : journalEntry?.analysis_source_window === 'swing' ? 0.5
            : journalEntry?.analysis_source_window === 'institutional' ? 0.25
              : 0,
  };
}

async function appendPayloadToSimpleDataset(payload) {
  if (!payload) return { inserted: false };
  const response = await fetch('/api/ml/dataset/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return { inserted: false };
  return response.json();
}

export async function appendLabeledSamplesBatchToSimpleDataset(journalEntries = [], mlSamples = []) {
  const entryById = new Map((journalEntries || []).map((entry) => [String(entry?.id), entry]));
  const labeled = (mlSamples || []).filter((row) => Number(row?.label) === 0 || Number(row?.label) === 1);
  let inserted = 0;

  for (const sample of labeled) {
    const journalEntry = entryById.get(String(sample?.journal_entry_id));
    if (!journalEntry) continue;
    const payload = buildSimpleDatasetPayload(journalEntry, sample);
    if (!payload) continue;
    const data = await appendPayloadToSimpleDataset(payload);
    if (data?.inserted) inserted += 1;
  }

  // Fallback: usa JournalEntry directamente cuando no hay MLTradeDataset suficiente.
  for (const entry of (journalEntries || [])) {
    const payload = buildSimpleDatasetPayloadFromJournalEntry(entry);
    if (!payload) continue;
    const data = await appendPayloadToSimpleDataset(payload);
    if (data?.inserted) inserted += 1;
  }

  return { inserted, total_labeled: labeled.length };
}

function signalStatusToLabel(status) {
  if (status === 'TP_HIT') return 1;
  if (status === 'SL_HIT') return 0;
  return null;
}

function sourceWindowToScore(value) {
  const windowName = normalizeSourceWindow(value);
  if (windowName === 'daytrading') return 1;
  if (windowName === 'probabilities') return 0.75;
  if (windowName === 'swing') return 0.5;
  if (windowName === 'institutional') return 0.25;
  return 0;
}

function timeframeToScore(value) {
  const tf = String(value || '').toLowerCase();
  if (tf === 'scalp') return 0.25;
  if (tf === 'intraday') return 0.6;
  if (tf === 'primary') return 0.8;
  if (tf === 'swing') return 1;
  return 0;
}

function buildSimpleDatasetPayloadFromSignalLog(signalLog) {
  if (!signalLog) return null;

  const label = signalStatusToLabel(signalLog.status);
  if (!(label === 0 || label === 1)) return null;

  const entry = Number(signalLog.entry_price);
  const sl = Number(signalLog.stop_loss);
  const tp = Number(signalLog.take_profit);
  const risk = Number.isFinite(entry) && Number.isFinite(sl) ? Math.abs(entry - sl) : 0;
  const reward = Number.isFinite(entry) && Number.isFinite(tp) ? Math.abs(tp - entry) : 0;
  const rrPlanned = risk > 0 ? reward / risk : 0;
  const progress = Number(signalLog.progress_pct);
  const maxProgress = Number(signalLog.max_progress_pct);
  const currentPrice = Number(signalLog.current_price);

  return {
    id: `signal_log_${String(signalLog.id || '')}`,
    timestamp: signalLog.created_date || new Date().toISOString(),
    result: label,
    profit: label === 1 ? reward : -risk,
    direction_signal: signalLog.signal === 'CALL' ? 1 : signalLog.signal === 'PUT' ? -1 : 0,
    entry_price: Number.isFinite(entry) ? entry : 0,
    stop_loss: Number.isFinite(sl) ? sl : 0,
    take_profit: Number.isFinite(tp) ? tp : 0,
    risk_distance: Number.isFinite(risk) ? risk : 0,
    rr_planned: Number.isFinite(rrPlanned) ? rrPlanned : 0,
    progress_pct: Number.isFinite(progress) ? progress : 0,
    max_progress_pct: Number.isFinite(maxProgress) ? maxProgress : 0,
    current_price: Number.isFinite(currentPrice) ? currentPrice : null,
    source_window_score: sourceWindowToScore(signalLog.source_window || signalLog.analysis_type),
    timeframe_score: timeframeToScore(signalLog.timeframe),
  };
}

export async function appendSignalLogsBatchToSimpleDataset(signalLogs = []) {
  const rows = Array.isArray(signalLogs) ? signalLogs : [];
  let inserted = 0;
  let totalLabeled = 0;

  for (const signalLog of rows) {
    const payload = buildSimpleDatasetPayloadFromSignalLog(signalLog);
    if (!payload) continue;
    totalLabeled += 1;
    const data = await appendPayloadToSimpleDataset(payload);
    if (data?.inserted) inserted += 1;
  }

  return { inserted, total_labeled: totalLabeled };
}