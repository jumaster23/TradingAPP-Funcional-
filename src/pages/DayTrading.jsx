import React, { useState, useReducer, useCallback, useEffect, useRef } from 'react';
import TickerInput from '../components/trading/TickerInput';
import ScalpModule from '../components/daytrading/ScalpModule';
import IntradayModule from '../components/daytrading/IntradayModule';
import BacktestModal from '../components/trading/BacktestModal';
import StructurePatterns from '../components/daytrading/StructurePatterns';
import RiskRulesModule from '../components/daytrading/RiskRulesModule';
import NoTradeAlert from '../components/daytrading/NoTradeAlert';
import TradingHours from '../components/daytrading/TradingHours';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import DayTradingChart from '../components/daytrading/DayTradingChart';
import ChartErrorBoundary from '../components/daytrading/ChartErrorBoundary';
import LivePriceBadge from '../components/trading/LivePriceBadge';
import ConsensusPanel from '../components/trading/ConsensusPanel';
import TradeLevels from '../components/trading/TradeLevels';
import ProbabilityBar from '../components/trading/ProbabilityBar';
import { useLivePrice } from '@/hooks/useLivePrice';
import { hasBase44Config, getBase44ConfigError, isNotFoundError, getReadableError } from '@/lib/backendGuard';
import { appendSignalLogsBatchToSimpleDataset, inferMlProbabilityFromPayload, upsertMlTradeSampleFromAnalysis } from '@/lib/mlDataset';
import { saveSignalsFromAnalysis } from '@/lib/signalLog';

const scalpSchema = {
  type: 'object',
  properties: {
    signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
    entry: { type: 'number' },
    sl: { type: 'number' },
    tp: { type: 'number' },
    success_prob: { type: 'number' },
    summary: { type: 'string' },
    detail: { type: 'string' },
    // 5-timeframe structure
    tf_15min_trend: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    tf_5min_confirm: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    tf_3min_pattern: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    tf_2min_confirm: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    entry_precision_note: { type: 'string' },
    // EMAs on 1min
    ema9: { type: 'number' },
    ema20: { type: 'number' },
    ema50: { type: 'number' },
    ema9_above_20: { type: 'boolean' },
    price_above_ema20: { type: 'boolean' },
    ema50_bounce: { type: 'boolean' },
    // Volume & fake breakout
    volume_confirms: { type: 'boolean' },
    key_level_type: { type: 'string' },
    key_level_price: { type: 'number' },
    fake_breakout_risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    // Gamma / OI
    call_wall: { type: 'number' },
    put_wall: { type: 'number' },
    gamma_level: { type: 'number' },
    gamma_context: { type: 'string' },
    // Index confluence
    spx_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    nq_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    nasdaq100_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    index_confluence_summary: { type: 'string' },
    // VIX
    vix_value: { type: 'number' },
    vix_regime: { type: 'string', enum: ['LOW', 'MODERATE', 'HIGH', 'EXTREME'] },
    vix_context: { type: 'string' },
    // Premarket
    premarket_high: { type: 'number' },
    premarket_low: { type: 'number' },
    premarket_volume: { type: 'string' },
    premarket_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    premarket_note: { type: 'string' },
  }
};

const intradaySchema = {
  type: 'object',
  properties: {
    signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
    entry: { type: 'number' },
    sl: { type: 'number' },
    tp: { type: 'number' },
    success_prob: { type: 'number' },
    summary: { type: 'string' },
    detail: { type: 'string' },
    // 4-timeframe structure
    tf_1h_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    tf_30min_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    tf_15min_structure: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    tf_5min_signal: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    // ORB context
    orb_context: { type: 'string' },
    // Index confluences
    spx_confirm: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    nq_confirm: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    nasdaq_confirm: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    index_confluence: { type: 'string' },
    // VIX
    vix_value: { type: 'number' },
    vix_regime: { type: 'string', enum: ['LOW', 'MODERATE', 'HIGH', 'EXTREME'] },
    vix_context: { type: 'string' },
    // Gamma / OI
    call_wall: { type: 'number' },
    put_wall: { type: 'number' },
    gamma_level: { type: 'number' },
    // EMAs 5min
    ema9_5min: { type: 'number' },
    ema20_5min: { type: 'number' },
    ema50_5min: { type: 'number' },
  }
};

const riskSchema = {
  type: 'object',
  properties: {
    max_risk_pct: { type: 'number' },
    rr_ratio: { type: 'string' },
    position_suggestion: { type: 'string' }
  }
};

const riskRulesSchema = {
  type: 'object',
  properties: {
    breakeven_trigger: { type: 'string' },
    breakeven_action: { type: 'string' },
    partial_profit_trigger: { type: 'string' },
    partial_profit_action: { type: 'string' },
    full_exit_trigger: { type: 'string' },
    full_exit_action: { type: 'string' },
    hold_trigger: { type: 'string' },
    hold_action: { type: 'string' },
    invalidation_trigger: { type: 'string' },
    invalidation_action: { type: 'string' },
    general_note: { type: 'string' }
  }
};

const structureSchema = {
  type: 'object',
  properties: {
    liquidity_sweep: {
      type: 'object',
      properties: {
        detected: { type: 'boolean' },
        swept_level: { type: 'number' },
        swept_level_type: { type: 'string' },
        sweep_type: { type: 'string', enum: ['SWEEP_HIGH', 'SWEEP_LOW'] },
        direction: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
        entry: { type: 'number' },
        sl: { type: 'number' },
        tp: { type: 'number' },
        success_prob: { type: 'number' },
        volume_confirms: { type: 'boolean' },
        wick_rejection: { type: 'boolean' },
        structure_shift: { type: 'boolean' },
        gamma_confluence: { type: 'boolean' },
        vix_regime: { type: 'string' },
        timeframe_detected: { type: 'string' },
        summary: { type: 'string' }
      }
    },
    pullback_trend: {
      type: 'object',
      properties: {
        detected: { type: 'boolean' },
        trend_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
        trend_tf: { type: 'string' },
        pullback_level: { type: 'number' },
        pullback_level_type: { type: 'string' },
        ema_trend_4h: { type: 'string' },
        pullback_1h: { type: 'string' },
        entry_trigger_15m: { type: 'string' },
        volume_on_pullback: { type: 'string' },
        gamma_confluence: { type: 'boolean' },
        vix_regime: { type: 'string' },
        breakeven_rule: { type: 'string' },
        direction: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
        entry: { type: 'number' },
        sl: { type: 'number' },
        tp: { type: 'number' },
        success_prob: { type: 'number' },
        summary: { type: 'string' }
      }
    },
    breakout_retest: {
      type: 'object',
      properties: {
        detected: { type: 'boolean' },
        breakout_level: { type: 'number' },
        breakout_level_type: { type: 'string' },
        volume_on_breakout: { type: 'boolean' },
        second_candle_confirms: { type: 'boolean' },
        retest_occurred: { type: 'boolean' },
        retest_held: { type: 'boolean' },
        false_breakout_filter: { type: 'boolean' },
        gamma_confluence: { type: 'boolean' },
        vix_regime: { type: 'string' },
        direction: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
        entry: { type: 'number' },
        sl: { type: 'number' },
        tp: { type: 'number' },
        success_prob: { type: 'number' },
        summary: { type: 'string' }
      }
    }
  }
};

const noTradeSchema = {
  type: 'object',
  properties: {
    alerts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['news', 'sideways', 'low_volume'] },
          severity: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          label: { type: 'string' },
          reason: { type: 'string' },
          wait_until: { type: 'string' }
        }
      }
    }
  }
};

const fullSchema = {
  type: 'object',
  properties: {
    scalp: scalpSchema,
    intraday: intradaySchema,
    risk: riskSchema,
    risk_rules: riskRulesSchema,
    no_trade: noTradeSchema
  }
};

const LIVE_SCALP_UNIVERSE = ['NVDA', 'AMD', 'AAPL', 'MSFT', 'META', 'NFLX', 'TSLA', 'GOOGL', 'AMZN', 'QQQ', 'SPY'];
const MAG7_UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA'];

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function getPriceDirection(priceData) {
  const px = Number(priceData?.current_price);
  const prev = Number(priceData?.prev_close);
  if (!Number.isFinite(px) || !Number.isFinite(prev) || prev <= 0) {
    return { direction: 'NEUTRAL', pctChange: 0 };
  }
  const pct = ((px - prev) / prev) * 100;
  if (pct > 0.15) return { direction: 'BULLISH', pctChange: pct };
  if (pct < -0.15) return { direction: 'BEARISH', pctChange: pct };
  return { direction: 'NEUTRAL', pctChange: pct };
}

function deriveThreeMinuteDirection(candles1m = []) {
  if (!Array.isArray(candles1m) || candles1m.length < 3) return 'NEUTRAL';
  const c = candles1m.slice(-3);
  const first = Number(c[0]?.close);
  const last = Number(c[c.length - 1]?.close);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 'NEUTRAL';
  if (last > first * 1.001) return 'BULLISH';
  if (last < first * 0.999) return 'BEARISH';
  return 'NEUTRAL';
}

function deriveThirtyMinuteDirection(intraday) {
  const trend15 = intraday?.trend_15m || 'NEUTRAL';
  const candles15 = Array.isArray(intraday?.candles_15m) ? intraday.candles_15m : [];
  if (candles15.length < 2) return trend15;
  const a = Number(candles15[candles15.length - 2]?.close);
  const b = Number(candles15[candles15.length - 1]?.close);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return trend15;
  if (trend15 === 'BULLISH' && b > a) return 'BULLISH';
  if (trend15 === 'BEARISH' && b < a) return 'BEARISH';
  return 'NEUTRAL';
}

function buildQuickScalpLevels(signal, intraday) {
  const price = Number(intraday?.current_price_1m ?? intraday?.current_price_5m ?? intraday?.current_price_15m);
  if (!Number.isFinite(price) || (signal !== 'CALL' && signal !== 'PUT')) {
    return { entry: null, sl: null, tp: null };
  }

  const candles1m = Array.isArray(intraday?.candles_1m) ? intraday.candles_1m : [];
  const recentRanges = candles1m.slice(-6).map((c) => {
    const h = Number(c?.high);
    const l = Number(c?.low);
    return Number.isFinite(h) && Number.isFinite(l) ? Math.max(0, h - l) : 0;
  }).filter((n) => n > 0);
  const avgRange = recentRanges.length
    ? recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length
    : price * 0.0015;
  const risk = Math.max(0.05, Math.min(price * 0.004, avgRange * 1.2));
  const reward = risk * 1.45;

  if (signal === 'CALL') {
    return {
      entry: Number(price.toFixed(2)),
      sl: Number((price - risk).toFixed(2)),
      tp: Number((price + reward).toFixed(2)),
    };
  }
  return {
    entry: Number(price.toFixed(2)),
    sl: Number((price + risk).toFixed(2)),
    tp: Number((price - reward).toFixed(2)),
  };
}

function scoreLiveCandidate({ ticker, intraday, priceData, vixRegime, nasdaqDirection, mag7Direction, mag7Aligned, minProbability = 68 }) {
  const oneMinDir = intraday?.ema9_above_20_1m === true && intraday?.price_above_ema20_1m === true
    ? 'BULLISH'
    : intraday?.ema9_above_20_1m === false && intraday?.price_above_ema20_1m === false
      ? 'BEARISH'
      : 'NEUTRAL';
  const threeMinDir = deriveThreeMinuteDirection(intraday?.candles_1m || []);
  const fiveMinDir = intraday?.ema9_5m && intraday?.ema20_5m && intraday?.current_price_5m
    ? (intraday.ema9_5m > intraday.ema20_5m && intraday.current_price_5m > intraday.ema20_5m
      ? 'BULLISH'
      : intraday.ema9_5m < intraday.ema20_5m && intraday.current_price_5m < intraday.ema20_5m
        ? 'BEARISH'
        : 'NEUTRAL')
    : 'NEUTRAL';
  const fifteenMinDir = intraday?.trend_15m || 'NEUTRAL';
  const thirtyMinDir = deriveThirtyMinuteDirection(intraday);
  const oneHourDir = intraday?.trend_1h || 'NEUTRAL';

  const bullishVotes = [oneMinDir, threeMinDir, fiveMinDir, fifteenMinDir].filter((d) => d === 'BULLISH').length;
  const bearishVotes = [oneMinDir, threeMinDir, fiveMinDir, fifteenMinDir].filter((d) => d === 'BEARISH').length;
  const signal = bullishVotes >= 3 ? 'CALL' : bearishVotes >= 3 ? 'PUT' : 'NEUTRAL';

  const higherTrendAligned = signal === 'CALL'
    ? (thirtyMinDir === 'BULLISH' && oneHourDir === 'BULLISH')
    : signal === 'PUT'
      ? (thirtyMinDir === 'BEARISH' && oneHourDir === 'BEARISH')
      : false;

  const oneFiveFifteenAligned = signal === 'CALL'
    ? (oneMinDir === 'BULLISH' && fiveMinDir === 'BULLISH' && fifteenMinDir === 'BULLISH')
    : signal === 'PUT'
      ? (oneMinDir === 'BEARISH' && fiveMinDir === 'BEARISH' && fifteenMinDir === 'BEARISH')
      : false;

  const qqqAligned = signal === 'CALL' ? nasdaqDirection === 'BULLISH' : signal === 'PUT' ? nasdaqDirection === 'BEARISH' : false;
  const mag7AlignedWithSignal = signal === 'CALL' ? mag7Direction === 'BULLISH' : signal === 'PUT' ? mag7Direction === 'BEARISH' : false;

  const bb1 = intraday?.bb_1m;
  const bb5 = intraday?.bb_5m;
  const strongConsolidation = (bb1?.squeeze === true && bb5?.squeeze === true) ||
    ((Number(bb1?.bandwidth) || 0) < 1.0 && (Number(bb5?.bandwidth) || 0) < 1.0);

  const { pctChange } = getPriceDirection(priceData);
  const breakoutStrong = intraday?.volume_confirms_15m === true && Math.abs(pctChange) >= 0.6;
  const highVolatility = ['HIGH', 'EXTREME'].includes(String(vixRegime || '').toUpperCase()) || Math.abs(pctChange) >= 1.2;
  const contextClear = mag7Aligned && qqqAligned && !strongConsolidation;

  let score = 0;
  if (higherTrendAligned) score += 25;
  if (oneFiveFifteenAligned) score += 22;
  if (qqqAligned) score += 15;
  if (mag7AlignedWithSignal && mag7Aligned) score += 15;
  if (!strongConsolidation) score += 10;
  if (intraday?.volume_confirms) score += 6;
  if (breakoutStrong) score += 4;
  if (highVolatility) score += 3;

  const probability = clampPercent(48 + score * 0.7);
  const setupGrade = probability >= 80 && score >= 75 ? 'A' : probability >= 68 && score >= 60 ? 'B' : 'C';
  const pass = (setupGrade === 'A' || setupGrade === 'B') && probability >= Number(minProbability || 68) && contextClear && higherTrendAligned && signal !== 'NEUTRAL';

  const levels = buildQuickScalpLevels(signal, intraday);
  const strategyMode = highVolatility || breakoutStrong ? 'SCALP' : 'WAIT_CONTEXT';

  return {
    ticker,
    signal,
    setupGrade,
    probability: Number(probability.toFixed(2)),
    entry: levels.entry,
    sl: levels.sl,
    tp: levels.tp,
    pass,
    strategyMode,
    contextClear,
    reasons: {
      higherTrendAligned,
      oneFiveFifteenAligned,
      qqqAligned,
      mag7AlignedWithSignal,
      mag7Aligned,
      strongConsolidation,
      highVolatility,
      breakoutStrong,
    },
    timeframeSummary: {
      tf_1m: oneMinDir,
      tf_3m: threeMinDir,
      tf_5m: fiveMinDir,
      tf_15m: fifteenMinDir,
      tf_30m: thirtyMinDir,
      tf_1h: oneHourDir,
    },
  };
}

function LiveUniverseScannerCard({
  rows,
  isLoading,
  onScan,
  lastRunAt,
  marketMeta,
  onPickTicker,
  minProbability,
  onChangeMinProbability,
  onSaveSetupsA,
  isSavingSetupsA,
  includeSetupB,
  onToggleIncludeSetupB,
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Filtro Live Multi-Stock (Scalp Rápido)</h3>
          <p className="text-xs text-muted-foreground">
            Universe: NVDA, AMD, AAPL, MSFT, META, NFLX, TSLA, GOOGL, AMZN, QQQ, SPY. Entrada por 1m/3m/5m/15m con tendencia 30m/1h.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Mag7: {marketMeta?.mag7Direction || 'N/A'} ({marketMeta?.mag7Aligned ? 'alineadas' : 'sin alineación'}) · Nasdaq: {marketMeta?.nasdaqDirection || 'N/A'} · VIX: {marketMeta?.vixRegime || 'N/A'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/20 px-2 py-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={includeSetupB}
              onChange={(e) => onToggleIncludeSetupB(e.target.checked)}
              className="h-3 w-3"
            />
            Guardar también setup B
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/20 px-2 py-1">
            <span className="text-[11px] text-muted-foreground">Min prob.</span>
            <select
              value={String(minProbability)}
              onChange={(e) => onChangeMinProbability(Number(e.target.value))}
              className="rounded border border-border/60 bg-background px-1 py-0.5 text-[11px] text-foreground"
            >
              <option value="68">68%</option>
              <option value="72">72%</option>
              <option value="75">75%</option>
              <option value="80">80%</option>
            </select>
          </div>
          {lastRunAt && <span className="text-[11px] text-muted-foreground">Último scan: {lastRunAt}</span>}
          <button
            onClick={onSaveSetupsA}
            disabled={isSavingSetupsA || isLoading}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {isSavingSetupsA ? (includeSetupB ? 'Guardando A/B...' : 'Guardando A...') : (includeSetupB ? 'Guardar setups A/B' : 'Guardar setups A')}
          </button>
          <button
            onClick={onScan}
            disabled={isLoading}
            className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/20 disabled:opacity-60"
          >
            {isLoading ? 'Escaneando...' : 'Escanear ahora'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40">
            <tr>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-left">Setup</th>
              <th className="px-3 py-2 text-left">Señal</th>
              <th className="px-3 py-2 text-right">Prob.</th>
              <th className="px-3 py-2 text-right">Entry</th>
              <th className="px-3 py-2 text-right">SL</th>
              <th className="px-3 py-2 text-right">TP</th>
              <th className="px-3 py-2 text-left">Contexto</th>
              <th className="px-3 py-2 text-left">Acción</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-muted-foreground">
                  No hay setups A/B de alta probabilidad con contexto claro en este momento.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.ticker} className="border-t border-border/40">
                <td className="px-3 py-2 font-mono font-semibold text-foreground">{row.ticker}</td>
                <td className={`px-3 py-2 font-semibold ${row.setupGrade === 'A' ? 'text-emerald-300' : 'text-amber-300'}`}>{row.setupGrade}</td>
                <td className={`px-3 py-2 font-semibold ${row.signal === 'CALL' ? 'text-emerald-300' : 'text-red-300'}`}>{row.signal}</td>
                <td className="px-3 py-2 text-right font-mono">{row.probability.toFixed(2)}%</td>
                <td className="px-3 py-2 text-right font-mono">{row.entry?.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">{row.sl?.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">{row.tp?.toFixed(2)}</td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">
                  {row.strategyMode === 'SCALP' ? 'Alta volatilidad/breakout' : 'Esperar contexto'} · 30m/1h: {row.timeframeSummary.tf_30m}/{row.timeframeSummary.tf_1h}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onPickTicker(row.ticker)}
                    className="rounded-md border border-border/60 bg-secondary/30 px-2 py-1 text-[11px] text-foreground hover:border-border"
                  >
                    Cargar ticker
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function tradingReducer(state, action) {
  switch (action.type) {
    case 'SET_TICKER':
      // Atomically update ticker and clear results if ticker changed from analyzed
      return {
        ...state,
        ticker: action.ticker,
        analysisResult: action.ticker === state.analyzedTicker ? state.analysisResult : null,
        lastUpdated: action.ticker === state.analyzedTicker ? state.lastUpdated : null,
      };
    case 'SET_RESULT':
      return { ...state, analysisResult: action.result, analyzedTicker: action.ticker, lastUpdated: action.lastUpdated };
    case 'CLEAR_RESULT':
      return { ...state, analysisResult: null, lastUpdated: null, analyzedTicker: '' };
    default:
      return state;
  }
}

const initialTradingState = { ticker: '', analyzedTicker: '', analysisResult: null, lastUpdated: null };

function getDirectionMeta(direction) {
  if (direction === 'BULLISH') {
    return {
      statusLabel: 'Alcista',
      valueClassName: 'text-emerald-300',
      cardClassName: 'border-emerald-500/20 bg-emerald-500/10',
    };
  }
  if (direction === 'BEARISH') {
    return {
      statusLabel: 'Bajista',
      valueClassName: 'text-red-300',
      cardClassName: 'border-red-500/20 bg-red-500/10',
    };
  }
  return {
    statusLabel: 'Neutral',
    valueClassName: 'text-amber-300',
    cardClassName: 'border-amber-500/20 bg-amber-500/10',
  };
}

function deriveOneMinuteState(scalp) {
  if (scalp?.ema9_above_20 === true && scalp?.price_above_ema20 === true) return 'BULLISH';
  if (scalp?.ema9_above_20 === false && scalp?.price_above_ema20 === false) return 'BEARISH';
  if (scalp?.signal === 'CALL') return 'BULLISH';
  if (scalp?.signal === 'PUT') return 'BEARISH';
  return 'NEUTRAL';
}

function normalizeVixRegime(regime) {
  const normalized = String(regime || '').trim().toUpperCase();
  if (normalized === 'ELEVATED') return 'HIGH';
  if (normalized === 'LOW' || normalized === 'MODERATE' || normalized === 'HIGH' || normalized === 'EXTREME') {
    return normalized;
  }
  return null;
}

function getVixMeta(regime) {
  const normalizedRegime = normalizeVixRegime(regime);

  if (normalizedRegime === 'LOW' || normalizedRegime === 'MODERATE') {
    return {
      statusLabel: normalizedRegime || '--',
      note: 'Favorece lecturas mas limpias',
      valueClassName: 'text-emerald-300',
      cardClassName: 'border-emerald-500/20 bg-emerald-500/10',
    };
  }
  if (normalizedRegime === 'HIGH' || normalizedRegime === 'EXTREME') {
    return {
      statusLabel: normalizedRegime || '--',
      note: 'Aumenta ruido y trampas',
      valueClassName: 'text-red-300',
      cardClassName: 'border-red-500/20 bg-red-500/10',
    };
  }
  return {
    statusLabel: normalizedRegime || regime || '--',
    note: 'Sin lectura clara',
    valueClassName: 'text-amber-300',
    cardClassName: 'border-amber-500/20 bg-amber-500/10',
  };
}

function CompactLiveCard({ ticker, scalp, lastUpdated, autoRefreshMs, nextRefreshAt, isLoading }) {
  const successProb = Number.isFinite(Number(scalp?.success_prob))
    ? Math.max(0, Math.min(100, Number(scalp.success_prob)))
    : 0;
  const [remainingMs, setRemainingMs] = useState(() => (nextRefreshAt ? Math.max(0, nextRefreshAt - Date.now()) : 0));

  useEffect(() => {
    if (!nextRefreshAt) {
      setRemainingMs(0);
      return undefined;
    }

    const updateRemaining = () => {
      setRemainingMs(Math.max(0, nextRefreshAt - Date.now()));
    };

    updateRemaining();
    const timerId = setInterval(updateRemaining, 1000);
    return () => clearInterval(timerId);
  }, [nextRefreshAt]);

  const oneMinuteState = deriveOneMinuteState(scalp);
  const timeframeItems = [
    { label: '1 min', value: oneMinuteState, note: 'Trigger inmediato' },
    { label: '5 min', value: scalp?.tf_5min_confirm || 'NEUTRAL', note: 'Confirmacion' },
    { label: '15 min', value: scalp?.tf_15min_trend || 'NEUTRAL', note: 'Direccion macro' },
  ];
  const confluenceItems = [
    {
      label: 'VIX',
      value: normalizeVixRegime(scalp?.vix_regime) || scalp?.vix_regime || '--',
      note: scalp?.vix_context || getVixMeta(scalp?.vix_regime).note,
      ...getVixMeta(scalp?.vix_regime),
    },
    {
      label: 'SPX-500',
      value: scalp?.spx_direction || 'NEUTRAL',
      note: 'Confluencia del indice lider',
      ...getDirectionMeta(scalp?.spx_direction || 'NEUTRAL'),
    },
    {
      label: 'NQ1',
      value: scalp?.nq_direction || 'NEUTRAL',
      note: 'Direccionalidad de futuros Nasdaq',
      ...getDirectionMeta(scalp?.nq_direction || 'NEUTRAL'),
    },
  ];
  const countdownMinutes = Math.floor(remainingMs / 60000);
  const countdownSeconds = Math.floor((remainingMs % 60000) / 1000);
  const countdownLabel = `${String(countdownMinutes).padStart(2, '0')}:${String(countdownSeconds).padStart(2, '0')}`;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Live Scalp</h2>
          <p className="text-sm text-muted-foreground">
            {ticker ? `${ticker.toUpperCase()} · actualización automática cada ${Math.round(autoRefreshMs / 60000)} min` : 'Ingresa un ticker para generar la señal live.'}
          </p>
        </div>
        <div className="space-y-2">
          {lastUpdated && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              Actualizado: {lastUpdated}
            </div>
          )}
          <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
            {isLoading ? 'Actualizando señal...' : `Próximo refresh en ${countdownLabel}`}
          </div>
        </div>
      </div>

      <TradeLevels
        entry={scalp?.entry}
        stopLoss={scalp?.sl}
        takeProfit={scalp?.tp}
        direction={scalp?.signal}
      />

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {timeframeItems.map((item) => {
          const meta = getDirectionMeta(item.value);
          return (
            <div key={item.label} className={`rounded-xl border p-3 ${meta.cardClassName}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className={`mt-1 text-sm font-semibold ${meta.valueClassName}`}>{meta.statusLabel}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{item.note}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {confluenceItems.map((item) => (
          <div key={item.label} className={`rounded-xl border p-3 ${item.cardClassName}`}>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className={`mt-1 text-sm font-semibold ${item.valueClassName}`}>{item.statusLabel}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{item.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-border/50 bg-secondary/30 p-4">
        <ProbabilityBar
          label="Probabilidad operativa"
          successPercent={successProb}
          tone="success"
        />
      </div>

      {Number.isFinite(scalp?.consolidation_prob) && (
        <div className="mt-3 rounded-xl border border-border/50 bg-secondary/30 p-4">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Prob. de Consolidación</p>
          <ProbabilityBar
            label={
              scalp.consolidation_class === 'STRONG_CONSOLIDATION'
                ? 'Consolidación fuerte — preparar breakout'
                : scalp.consolidation_class === 'CONSOLIDATION'
                ? 'Mercado en rango — operar soporte/resistencia'
                : 'Mercado en tendencia — operar en dirección'
            }
            successPercent={scalp.consolidation_prob}
            tone={
              scalp.consolidation_class === 'STRONG_CONSOLIDATION' ? 'rejection'
                : scalp.consolidation_class === 'CONSOLIDATION' ? 'mixed'
                : 'success'
            }
            note={`${scalp.consolidation_score ?? 0}/5 factores activos`}
          />
        </div>
      )}
    </div>
  );
}

export default function DayTrading({ liveOnly = false, autoRefreshMs = 0 }) {
  const [state, dispatch] = useReducer(tradingReducer, initialTradingState);
  const { ticker, analysisResult, lastUpdated } = state;
  const [isLoading, setIsLoading] = useState(false);
  const [isScannerLoading, setIsScannerLoading] = useState(false);
  const [isSavingScannerSetups, setIsSavingScannerSetups] = useState(false);
  const [liveScannerRows, setLiveScannerRows] = useState([]);
  const [liveScannerMinProbability, setLiveScannerMinProbability] = useState(68);
  const [liveScannerIncludeSetupB, setLiveScannerIncludeSetupB] = useState(false);
  const [liveScannerLastRun, setLiveScannerLastRun] = useState(null);
  const [liveScannerMarketMeta, setLiveScannerMarketMeta] = useState({
    mag7Direction: 'N/A',
    mag7Aligned: false,
    nasdaqDirection: 'N/A',
    vixRegime: 'N/A',
  });
  const [nextRefreshAt, setNextRefreshAt] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  const [withPremarket, setWithPremarket] = useState(false);
  const [gammaExpirationMode, setGammaExpirationMode] = useState('nearest');
  const [gammaCalculationMode, setGammaCalculationMode] = useState('institutional');
  const [gammaStrictReal, setGammaStrictReal] = useState(false);
  const runAnalysisRef = useRef(null);
  const tickerRef = useRef(ticker);
  const isLoadingRef = useRef(isLoading);

  // Atomic setter — ticker + result clear happen in a single render
  const setTicker = useCallback((val) => {
    dispatch({ type: 'SET_TICKER', ticker: (val || '').toUpperCase() });
  }, []);

  // Live price from polling — will be used directly in the analysis prompt
  const livePrice = useLivePrice(ticker, 5000);

  const runLiveUniverseScan = useCallback(async ({ silent = false } = {}) => {
    if (!liveOnly) return;
    if (!hasBase44Config()) {
      if (!silent) toast.error(getBase44ConfigError());
      return;
    }

    setIsScannerLoading(true);
    try {
      const universe = LIVE_SCALP_UNIVERSE;
      const mag7Settled = await Promise.allSettled(
        MAG7_UNIVERSE.map((symbol) => base44.functions.invoke('getStockPrice', { ticker: symbol }))
      );
      const mag7Moves = mag7Settled.map((item) => item.status === 'fulfilled' ? getPriceDirection(item.value?.data) : { direction: 'NEUTRAL' });
      const mag7Bull = mag7Moves.filter((m) => m.direction === 'BULLISH').length;
      const mag7Bear = mag7Moves.filter((m) => m.direction === 'BEARISH').length;
      const mag7Direction = mag7Bull > mag7Bear ? 'BULLISH' : mag7Bear > mag7Bull ? 'BEARISH' : 'NEUTRAL';
      const mag7Aligned = Math.max(mag7Bull, mag7Bear) >= 6;

      const [vixRes, qqqRes] = await Promise.allSettled([
        base44.functions.invoke('getVix', {}),
        base44.functions.invoke('getStockPrice', { ticker: 'QQQ' }),
      ]);
      const vixRegime = vixRes.status === 'fulfilled' ? String(vixRes.value?.data?.regime || 'N/A').toUpperCase() : 'N/A';
      const nasdaqDirection = qqqRes.status === 'fulfilled' ? getPriceDirection(qqqRes.value?.data).direction : 'NEUTRAL';

      const settled = await Promise.allSettled(
        universe.map(async (symbol) => {
          const [intradayRes, priceRes] = await Promise.all([
            base44.functions.invoke('getIntradayData', { ticker: symbol }),
            base44.functions.invoke('getStockPrice', { ticker: symbol }),
          ]);
          const intraday = intradayRes?.data;
          const priceData = priceRes?.data;
          if (!intraday || !priceData) return null;
          return scoreLiveCandidate({
            ticker: symbol,
            intraday,
            priceData,
            vixRegime,
            nasdaqDirection,
            mag7Direction,
            mag7Aligned,
            minProbability: liveScannerMinProbability,
          });
        })
      );

      const rows = settled
        .map((item) => (item.status === 'fulfilled' ? item.value : null))
        .filter((row) => row && row.pass)
        .sort((a, b) => b.probability - a.probability);

      setLiveScannerRows(rows);
      const runAt = new Date().toLocaleTimeString();
      setLiveScannerLastRun(runAt);
      setLiveScannerMarketMeta({
        mag7Direction,
        mag7Aligned,
        nasdaqDirection,
        vixRegime,
      });

      if (!silent) {
        toast.success(rows.length > 0
          ? `Scan completo: ${rows.length} setups A/B de alta probabilidad.`
          : 'Scan completo: sin setups A/B con contexto fuerte por ahora.');
      }
    } catch (err) {
      if (!silent) toast.error('Error en scan Live: ' + getReadableError(err));
    } finally {
      setIsScannerLoading(false);
    }
  }, [liveOnly, liveScannerMinProbability]);

  const saveLiveScannerSetupsA = useCallback(async () => {
    if (!liveOnly) return;
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }

    const allowedSetups = liveScannerIncludeSetupB ? new Set(['A', 'B']) : new Set(['A']);
    const setupsToSave = liveScannerRows.filter((row) =>
      allowedSetups.has(String(row?.setupGrade || '')) && row?.signal && row?.entry != null && row?.sl != null && row?.tp != null
    );
    if (!setupsToSave.length) {
      toast.info(liveScannerIncludeSetupB
        ? 'No hay setups A/B para guardar en este momento.'
        : 'No hay setups A para guardar en este momento.');
      return;
    }

    setIsSavingScannerSetups(true);
    try {
      let saved = 0;
      const createdRecords = [];
      for (const row of setupsToSave) {
        const record = {
          ticker: String(row.ticker || '').toUpperCase(),
          analysis_type: 'live-scanner',
          source_window: 'live-scanner',
          timeframe: '1m-3m-5m-15m',
          signal: row.signal,
          entry_price: Number(row.entry),
          stop_loss: Number(row.sl),
          take_profit: Number(row.tp),
          status: 'PENDING',
          progress_pct: 0,
          max_progress_pct: 0,
          reached_level_price: Number(row.entry),
          current_price: Number(row.entry),
          last_checked_at: null,
          analysis_id: null,
          scanner_probability: Number(row.probability),
          scanner_setup_grade: row.setupGrade,
          scanner_meta: JSON.stringify({
            timeframeSummary: row.timeframeSummary,
            reasons: row.reasons,
            strategyMode: row.strategyMode,
            minProbability: liveScannerMinProbability,
          }),
        };
        const created = await base44.entities.SignalLog.create(record);
        createdRecords.push(created || record);
        saved += 1;
      }

      let trainingInserted = 0;
      try {
        const syncResult = await appendSignalLogsBatchToSimpleDataset(createdRecords);
        trainingInserted = Number(syncResult?.inserted || 0);
      } catch (syncErr) {
        console.warn('Live scanner training sync failed:', syncErr?.message || syncErr);
      }

      toast.success(liveScannerIncludeSetupB
        ? `Setups A/B guardados: ${saved}. Enviados a entrenamiento: ${trainingInserted}`
        : `Setups A guardados: ${saved}. Enviados a entrenamiento: ${trainingInserted}`);
    } catch (err) {
      toast.error('No se pudo guardar setups del scanner Live: ' + getReadableError(err));
    } finally {
      setIsSavingScannerSetups(false);
    }
  }, [liveOnly, liveScannerRows, liveScannerMinProbability, liveScannerIncludeSetupB]);

  const runAnalysis = async () => {
    if (!ticker) return;
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }
    setIsLoading(true);
    const t = ticker.toUpperCase();
    const now = new Date().toISOString();
    try {
      let priceHint = '';
      let contextHint = '';
      let intradayData = null;
      let vd = null;
      let gd = null;
      let spyData = null;
      let nqData = null;
      let qqqData = null;
      let pmData = null;
      let pullbackMarginCfg = 0.002;
      let defensiveMinProbCfg = 60;
      let defensiveMaxProbCfg = 65;
      let orbInvalidMaxProbCfg = 55;
      let highConvictionMinCfg = 4;

      // Build price hint from the shared live polling hook
      const lp = livePrice ?? {};
      const lpPrice = lp.price != null ? Number(lp.price) : null;
      const lpPrevClose = lp.prevClose != null ? Number(lp.prevClose) : null;
      const lpOpen = lp.open != null ? Number(lp.open) : null;
      const lpHigh = lp.high != null ? Number(lp.high) : null;
      const lpLow = lp.low != null ? Number(lp.low) : null;
      const lpVolume = lp.volume != null ? Number(lp.volume) : null;

      if (lpPrice && lpPrevClose) {
        const gapAmt = lpOpen && lpPrevClose ? lpOpen - lpPrevClose : null;
        const gapPct = gapAmt != null && lpPrevClose ? (gapAmt / lpPrevClose * 100) : null;
        priceHint = `PRECIOS REALES EN TIEMPO REAL de Yahoo Finance via polling (USA ESTOS VALORES EXACTOS):
prev_close=${lpPrevClose}, today_open=${lpOpen ?? 'N/A'}, today_high=${lpHigh}, today_low=${lpLow}, current_price=${lpPrice}, volume=${lpVolume}
GAP HOY: ${gapAmt != null ? `${gapAmt >= 0 ? '+' : ''}${gapAmt.toFixed(2)} (${gapPct != null ? (gapPct >= 0 ? '+' : '') + gapPct.toFixed(2) : '?'}%)` : 'N/A'}
Actualizado: ${lp.lastUpdated?.toLocaleTimeString() ?? now}
`;
      }

  const dayPivot = (lpHigh != null && lpLow != null && lpPrevClose != null)
    ? (lpHigh + lpLow + lpPrevClose) / 3
    : null;
  const dayR1 = dayPivot != null && lpLow != null ? (2 * dayPivot) - lpLow : null;
  const dayS1 = dayPivot != null && lpHigh != null ? (2 * dayPivot) - lpHigh : null;

      // Fetch intraday EMA, VIX, Gamma/OI, TickerStats DB, y premarket siempre en paralelo
      let orbStatuses = {};
      try {
        const fetches = [
          base44.functions.invoke('getIntradayData', { ticker: t }),
          base44.functions.invoke('getVix', {}),
          base44.functions.invoke('getGammaOI', {
            ticker: t,
            expiration_mode: gammaExpirationMode,
            gamma_calculation_mode: gammaCalculationMode,
            strict_real_gamma: gammaStrictReal,
          }),
          base44.entities.TickerStats.filter({ ticker: t }),
          base44.functions.invoke('getStockPrice', { ticker: 'SPY' }),
          base44.functions.invoke('getStockPrice', { ticker: 'NQ=F' }),
          base44.functions.invoke('getStockPrice', { ticker: 'QQQ' }),
          base44.functions.invoke('getPremarketData', { ticker: t }), // siempre fetch
          base44.entities.BotSettings.list('-created_date', 1),
        ];
        const settled = await Promise.allSettled(fetches);
        const [intradayRes, vixRes, gammaRes, statsRes, spyRes, nqRes, qqqRes, pmRes, settingsRes] = settled;
        const id = intradayRes.status === 'fulfilled' ? intradayRes.value?.data : null;
        vd = vixRes.status === 'fulfilled' ? vixRes.value?.data : null;
        gd = gammaRes.status === 'fulfilled' ? gammaRes.value?.data : null;
        const hist = statsRes.status === 'fulfilled' ? (statsRes.value?.[0] ?? null) : null;
        spyData = spyRes.status === 'fulfilled' ? spyRes.value?.data : null;
        nqData = nqRes.status === 'fulfilled' ? nqRes.value?.data : null;
        qqqData = qqqRes.status === 'fulfilled' ? qqqRes.value?.data : null;
        pmData = pmRes?.status === 'fulfilled' ? pmRes.value?.data : null;
        const botSettings = settingsRes.status === 'fulfilled' ? (settingsRes.value?.[0] ?? null) : null;
        if (botSettings && Number.isFinite(Number(botSettings.pullback_margin_pct))) {
          pullbackMarginCfg = Math.max(0.001, Number(botSettings.pullback_margin_pct) / 100);
        }
        if (botSettings && Number.isFinite(Number(botSettings.daytrading_defensive_min_prob))) {
          defensiveMinProbCfg = Math.max(50, Math.min(80, Number(botSettings.daytrading_defensive_min_prob)));
        }
        if (botSettings && Number.isFinite(Number(botSettings.daytrading_defensive_max_prob))) {
          defensiveMaxProbCfg = Math.max(55, Math.min(90, Number(botSettings.daytrading_defensive_max_prob)));
        }
        if (defensiveMaxProbCfg < defensiveMinProbCfg) {
          defensiveMaxProbCfg = defensiveMinProbCfg;
        }
        if (botSettings && Number.isFinite(Number(botSettings.daytrading_orb_invalid_max_prob))) {
          orbInvalidMaxProbCfg = Math.max(40, Math.min(70, Number(botSettings.daytrading_orb_invalid_max_prob)));
        }
        if (botSettings && Number.isFinite(Number(botSettings.daytrading_high_conviction_min))) {
          highConvictionMinCfg = Math.max(1, Math.min(6, Number(botSettings.daytrading_high_conviction_min)));
        }

        // ── EMA / Intraday ──────────────────────────────────────────
        if (id && !id.error) {
          intradayData = id;

          // ── Últimas velas OHLC por timeframe ─────────────────────
          const fmtCandle = (c) => c ? `O=${c.open} H=${c.high} L=${c.low} C=${c.close} V=${c.volume}` : 'N/A';
          const last1m = id.candles_15m?.[id.candles_15m.length - 1]; // reuse var names below
          const lastC5m = (id.candles5m > 0 && id.current_price_5m) ? `Último cierre 5m=$${id.current_price_5m}` : '';
          const last3_15m = (id.candles_15m || []).slice(-3);
          const last3_1h = (id.candles_1h || []).slice(-3);
          const last2_4h = (id.candles_4h || []).slice(-2);
          contextHint += `
VELAS RECIENTES (OHLCV — usa estos datos EXACTOS para determinar dirección y niveles):
  Último precio 1m=$${id.current_price_1m}, Último precio 5m=$${id.current_price_5m}
  Últimas 3 velas 15m:${last3_15m.map((c, i) => `\n    [${i + 1}] ${fmtCandle(c)}`).join('')}
  Últimas 3 velas 1h:${last3_1h.map((c, i) => `\n    [${i + 1}] ${fmtCandle(c)}`).join('')}
  Últimas 2 velas 4h:${last2_4h.map((c, i) => `\n    [${i + 1}] ${fmtCandle(c)}`).join('')}
INSTRUCCIÓN: Usa el HIGH y LOW de estas velas como niveles de soporte/resistencia inmediatos. El entry DEBE ser cercano al precio actual ($${lpPrice ?? id.current_price_1m}). NO inventes precios alejados.
`;
          if (dayPivot != null) {
            contextHint += `
PIVOTS DEL DÍA (calculados con precios reales):
pivot_point=${dayPivot.toFixed(2)}, r1=${dayR1 != null ? dayR1.toFixed(2) : 'N/A'}, s1=${dayS1 != null ? dayS1.toFixed(2) : 'N/A'}
REGLA: Para CALL, mejor confluencia si entry está en soporte (S1 o soporte 1H) y/o precio sobre pivot_point. Para PUT, mejor confluencia si entry está en resistencia (R1 o resistencia 1H) y/o precio bajo pivot_point.
`;
          }
          contextHint += `
DATOS REALES DE VELAS INTRADAY (Yahoo Finance — ${id.candles1m} velas 1min, ${id.candles5m} velas 5min):
EMAs 1min: EMA9=${id.ema9_1m}, EMA20=${id.ema20_1m}, EMA50=${id.ema50_1m}
EMAs 5min: EMA9=${id.ema9_5m}, EMA20=${id.ema20_5m}, EMA50=${id.ema50_5m}
Flags: ema9_above_20=${id.ema9_above_20_1m}, price_above_ema20=${id.price_above_ema20_1m}, ema50_bounce=${id.ema50_bounce}, volume_confirms=${id.volume_confirms}
Precio 1min=${id.current_price_1m}, Precio 5min=${id.current_price_5m}
`;

          // ── Bollinger Bands (datos reales) ─────────────────────────
          const bb1 = id.bb_1m;
          const bb5 = id.bb_5m;
          if (bb1) {
            contextHint += `
BOLLINGER BANDS 1min (REALES): upper=${bb1.upper}, middle=${bb1.middle}, lower=${bb1.lower}, bandwidth=${bb1.bandwidth}%, %B=${bb1.pct_b}, std_dev=${bb1.std_dev}
  squeeze=${bb1.squeeze}, expansion=${bb1.expansion}, signal=${bb1.signal}
  Interpretación: ${bb1.interpretation}
  Estrategia: ${bb1.strategy}
`;
          }
          if (bb5) {
            contextHint += `
BOLLINGER BANDS 5min (REALES): upper=${bb5.upper}, middle=${bb5.middle}, lower=${bb5.lower}, bandwidth=${bb5.bandwidth}%, %B=${bb5.pct_b}, std_dev=${bb5.std_dev}
  squeeze=${bb5.squeeze}, expansion=${bb5.expansion}, signal=${bb5.signal}
  Interpretación: ${bb5.interpretation}
  Estrategia: ${bb5.strategy}
`;
          }

          // ── ORB First Candle OHLC + breakout status (deterministic) ──
          const fcLabels = [
            ['first_candle_5m', 'ORB 5min'],
            ['first_candle_15m', 'ORB 15min'],
            ['first_candle_30m', 'ORB 30min'],
            ['first_candle_1h', 'ORB 1h'],
          ];
          // Compute deterministic ORB breakout status for each timeframe
          const computeOrbStatus = (fc, tfKey) => {
            if (!fc || !lpPrice) return null;
            const above = lpPrice > fc.high;
            const below = lpPrice < fc.low;
            const dayHitHigh = lpHigh > fc.high;
            const dayHitLow = lpLow < fc.low;
            const candles15 = Array.isArray(id?.candles_15m) ? id.candles_15m : [];
            const avgVol15 = candles15.length ? (candles15.reduce((acc, c) => acc + (Number(c?.volume) || 0), 0) / candles15.length) : 0;

            const aggregateLastCandles = (count) => {
              if (candles15.length < count) return null;
              const span = candles15.slice(-count);
              const open = Number(span[0]?.open);
              const close = Number(span[span.length - 1]?.close);
              const high = Math.max(...span.map((c) => Number(c?.high) || -Infinity));
              const low = Math.min(...span.map((c) => Number(c?.low) || Infinity));
              const volume = span.reduce((acc, c) => acc + (Number(c?.volume) || 0), 0);
              if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) return null;
              return { open, close, high, low, volume };
            };

            const assessBreakQuality = (status) => {
              const actionable = ['BREAK_UP', 'BREAK_DOWN', 'DOUBLE_BREAK_UP', 'DOUBLE_BREAK_DOWN'];
              if (!actionable.includes(status)) {
                return {
                  quality: 'UNKNOWN',
                  likely_consolidation: false,
                  body_ratio: null,
                  volume_ratio: null,
                  reason: 'Sin ruptura activa',
                };
              }

              const breakUp = status.endsWith('_UP');
              let refCandle = null;
              if (tfKey === 'first_candle_15m') {
                refCandle = candles15[candles15.length - 1] || null;
              } else if (tfKey === 'first_candle_30m') {
                refCandle = aggregateLastCandles(2);
              }
              if (!refCandle) {
                return {
                  quality: 'UNKNOWN',
                  likely_consolidation: false,
                  body_ratio: null,
                  volume_ratio: null,
                  reason: 'Sin vela de referencia',
                };
              }

              const o = Number(refCandle.open);
              const c = Number(refCandle.close);
              const h = Number(refCandle.high);
              const l = Number(refCandle.low);
              const v = Number(refCandle.volume || 0);
              const body = Math.abs(c - o);
              const range = Math.max(0.01, h - l);
              const bodyRatio = body / range;
              const volumeRatio = avgVol15 > 0 ? (v / avgVol15) : 1;
              const brokeAndClosed = breakUp ? c > fc.high : c < fc.low;
              const rejectionWick = breakUp
                ? (h - c) > body * 1.1
                : (c - l) > body * 1.1;

              const clean = brokeAndClosed && bodyRatio >= 0.45 && volumeRatio >= 1.1 && !rejectionWick;
              const rejection = rejectionWick || !brokeAndClosed || bodyRatio < 0.30 || volumeRatio < 0.95;
              const likelyConsolidation = status.startsWith('DOUBLE_BREAK') && rejection;

              if (clean) {
                return {
                  quality: 'CLEAN',
                  likely_consolidation: false,
                  body_ratio: Number(bodyRatio.toFixed(2)),
                  volume_ratio: Number(volumeRatio.toFixed(2)),
                  reason: 'Último rompimiento limpio (cuerpo+volumen)',
                };
              }
              if (rejection) {
                return {
                  quality: 'REJECTION',
                  likely_consolidation: likelyConsolidation,
                  body_ratio: Number(bodyRatio.toFixed(2)),
                  volume_ratio: Number(volumeRatio.toFixed(2)),
                  reason: likelyConsolidation
                    ? 'Rompimiento con rechazo: probable consolidación'
                    : 'Rompimiento con rechazo débil',
                };
              }
              return {
                quality: 'MIXED',
                likely_consolidation: false,
                body_ratio: Number(bodyRatio.toFixed(2)),
                volume_ratio: Number(volumeRatio.toFixed(2)),
                reason: 'Rompimiento parcial sin confirmación completa',
              };
            };

            let status, detail;
            if (above) {
              status = dayHitLow ? 'DOUBLE_BREAK_UP' : 'BREAK_UP';
              detail = above ? `Precio SOBRE ORB high ($${fc.high}) → breakout alcista activo` : '';
            } else if (below) {
              status = dayHitHigh ? 'DOUBLE_BREAK_DOWN' : 'BREAK_DOWN';
              detail = `Precio BAJO ORB low ($${fc.low}) → breakout bajista activo`;
            } else if (dayHitHigh && !dayHitLow) {
              status = 'FAILED_BREAK_UP';
              detail = `Rompió arriba ($${fc.high}) pero regresó dentro → posible fake breakout alcista`;
            } else if (dayHitLow && !dayHitHigh) {
              status = 'FAILED_BREAK_DOWN';
              detail = `Rompió abajo ($${fc.low}) pero regresó dentro → posible fake breakout bajista`;
            } else if (dayHitHigh && dayHitLow) {
              status = 'DOUBLE_BREAK_INSIDE';
              detail = `Rompió ambos lados y regresó dentro → alta indecisión / volatilidad`;
            } else {
              status = 'CONSOLIDATING';
              const range = fc.high - fc.low;
              const posInRange = range > 0 ? ((lpPrice - fc.low) / range * 100).toFixed(0) : 50;
              detail = `Precio dentro del rango ORB (${posInRange}% del rango) → esperando breakout`;
            }
            const quality = assessBreakQuality(status);
            if (quality?.reason && status.startsWith('DOUBLE_BREAK')) {
              detail += ` | ${quality.reason}`;
            }
            return { status, detail, ...quality };
          };
          const fcLines = fcLabels
            .filter(([k]) => id[k])
            .map(([k, label]) => {
              const fc = id[k];
              const orbInfo = computeOrbStatus(fc, k);
              orbStatuses[k] = orbInfo;
              const statusStr = orbInfo ? ` | Estado=${orbInfo.status}` : '';
              return `  ${label}: High=${fc.high}, Low=${fc.low}, Open=${fc.open}, Close=${fc.close}, Range=$${(fc.high - fc.low).toFixed(2)}${statusStr}`;
            });
          if (fcLines.length) {
            const statusDetails = fcLabels
              .filter(([k]) => orbStatuses[k])
              .map(([k, label]) => `  ${label}: ${orbStatuses[k].detail}`)
              .join('\n');
            contextHint += `
RANGOS ORB REALES (primera vela de cada timeframe — USA ESTOS COMO NIVELES CLAVE):
${fcLines.join('\n')}
ESTADO ACTUAL DEL ORB (calculado con precio actual=${lpPrice}):
${statusDetails}
INSTRUCCIÓN: Estos son los rangos y estados ORB exactos del día. USA el estado determinístico de arriba para tu análisis — NO lo recalcules. El entry/sl/tp DEBEN estar anclados a estos niveles cuando el ORB sea relevante.
- BREAK_UP/BREAK_DOWN: Breakout confirmado → trade en dirección del break con TP en extensión del rango.
- FAILED_BREAK: Precio regresó al rango → posible reversa, buscar trade en dirección opuesta al break fallido.
- CONSOLIDATING: Esperar breakout o buscar fade en los extremos del rango.
- DOUBLE_BREAK: Alta volatilidad → usar stops más amplios o reducir tamaño de posición.
`;
          }
        }

        // ── Premarket data (real, de Yahoo — siempre disponible si existe) ──────
        if (pmData && pmData.available) {
          contextHint += `
DATOS PREMARKET REALES (Yahoo Finance — USA ESTOS VALORES EXACTOS):
premarket_high=${pmData.premarket_high}, premarket_low=${pmData.premarket_low}, premarket_open=${pmData.premarket_open}, premarket_close=${pmData.premarket_close}
premarket_volume=${pmData.premarket_volume?.toLocaleString()}, premarket_candles=${pmData.premarket_candles}, prev_close=${pmData.prev_close}
premarket_direction=${pmData.premarket_direction}, premarket_range=$${pmData.premarket_range}
INSTRUCCIÓN: Usa estos datos para definir premarket_high, premarket_low, premarket_volume, premarket_direction y premarket_note. El premarket_high/low son niveles clave para la sesión regular.
`;
        }

        // ── VIX ─────────────────────────────────────────────────────
        if (vd && !vd.error) {
          contextHint += `
VIX REAL (Yahoo Finance — USA ESTOS VALORES EXACTOS):
vix=${vd.vix}, regime=${vd.regime} (${vd.regime_es}), cambio=${vd.vix_change > 0 ? '+' : ''}${vd.vix_change} (${vd.vix_change_pct}%)
Impacto: ${vd.impact_note}
Ajuste probabilidades ORB: ${vd.orb_probability_adjustment > 0 ? '+' : ''}${vd.orb_probability_adjustment}% en todos los timeframes
`;
        }

        // ── Gamma / OI ──────────────────────────────────────────────
        if (gd && !gd.error && gd.call_wall) {
          const price = lpPrice ?? intradayData?.current_price_1m;
          let gammaPos = '';
          if (price && gd.call_wall && gd.put_wall) {
            const range = gd.call_wall - gd.put_wall;
            const mid = (gd.call_wall + gd.put_wall) / 2;
            if (price > gd.call_wall) gammaPos = 'SOBRE call_wall → aceleración alcista posible, pero fake breakout si sin volumen';
            else if (price < gd.put_wall) gammaPos = 'BAJO put_wall → aceleración bajista posible, pero fake breakout si sin volumen';
            else if (price > mid) gammaPos = `ENTRE walls, más cerca de call_wall (${(((price - gd.put_wall) / range) * 100).toFixed(0)}% del rango) → resistencia cercana`;
            else gammaPos = `ENTRE walls, más cerca de put_wall (${(((price - gd.put_wall) / range) * 100).toFixed(0)}% del rango) → soporte cercano`;
          }
          contextHint += `
GAMMA/OI REAL (${String(gd.source || 'desconocido').toUpperCase()} — USA ESTOS VALORES EXACTOS):
call_wall=${gd.call_wall}, put_wall=${gd.put_wall}, gamma_level=${gd.gamma_level}, max_pain=${gd.max_pain}
put_call_ratio=${gd.put_call_ratio}, oi_call_dominant=${gd.oi_call_dominant}, strikes_analyzed=${gd.strikes_analyzed}
fuente=${gd.source || 'N/A'}, modo_gamma=${gd.gamma_calculation_mode || gammaCalculationMode}, strict_real_gamma=${gd.strict_real_gamma ? 'true' : 'false'}, expiracion_solicitada=${gd.requested_expiration_mode || gammaExpirationMode}, options_expiration=${gd.options_expiration || 'N/A'}
Posición del precio: ${gammaPos}
REGLAS DE RIESGO GAMMA:
- Entry CALL: NO entrar si precio está a menos de 0.3% del call_wall (resistencia magnética). Esperar ruptura con volumen.
- Entry PUT: NO entrar si precio está a menos de 0.3% del put_wall (soporte magnético). Esperar ruptura con volumen.
- SL: SIEMPRE al otro lado del gamma wall más cercano si el trade va en dirección del wall.
- TP Scalp: El gamma wall opuesto o max_pain=${gd.max_pain} es un target natural.
- TP Intraday: Extensión más allá del gamma wall si rompe, o vuelta a max_pain.
- Si put_call_ratio > 1.2 → sesgo PUT (más puts en el mercado). Si < 0.8 → sesgo CALL.
`;
        } else {
          contextHint += `
GAMMA/OI: no disponible — busca en internet (Barchart, SpotGamma, CBOE) call_wall, put_wall y gamma_level actuales para ${t}.
`;
        }

        // ── Índices Reales (SPY + QQQ) ──────────────────────────────
        if (spyData || nqData || qqqData) {
          const spyDir = spyData && spyData.current_price > spyData.today_open ? 'BULLISH' : spyData && spyData.current_price < spyData.today_open ? 'BEARISH' : 'NEUTRAL';
          const nqDir = nqData && nqData.current_price > nqData.today_open ? 'BULLISH' : nqData && nqData.current_price < nqData.today_open ? 'BEARISH' : 'NEUTRAL';
          const qqqDir = qqqData && qqqData.current_price > qqqData.today_open ? 'BULLISH' : qqqData && qqqData.current_price < qqqData.today_open ? 'BEARISH' : 'NEUTRAL';
          const spyChg = spyData?.prev_close ? ((spyData.current_price - spyData.prev_close) / spyData.prev_close * 100).toFixed(2) : '?';
          const nqChg = nqData?.prev_close ? ((nqData.current_price - nqData.prev_close) / nqData.prev_close * 100).toFixed(2) : '?';
          const qqqChg = qqqData?.prev_close ? ((qqqData.current_price - qqqData.prev_close) / qqqData.prev_close * 100).toFixed(2) : '?';
          const aligned = spyDir === nqDir && nqDir === qqqDir && spyDir !== 'NEUTRAL';
          contextHint += `
ÍNDICES REALES (Yahoo Finance — USA ESTOS COMO DIRECCIÓN MACRO):
SPY: precio=${spyData?.current_price}, cambio=${spyChg}%, dirección=${spyDir}
      NQ1!: precio=${nqData?.current_price}, cambio=${nqChg}%, dirección=${nqDir}
QQQ: precio=${qqqData?.current_price}, cambio=${qqqChg}%, dirección=${qqqDir}
Alineados: ${aligned ? 'SÍ → confluencia fuerte, aumenta probabilidad' : 'NO → divergencia, reduce probabilidad y aumenta riesgo'}
      REGLA: Si SPY/NQ1/QQQ van en dirección OPUESTA al trade → reducir success_prob en 10-15%. Si al menos 2 de 3 confirman → sumar 5-8%. Si los 3 confirman → sumar 10%.
`;
        }

        // ── ORB histórico + Gap desde DB ─────────────────────────────
        if (hist) {
          const gapAmt = lpOpen && lpPrevClose ? lpOpen - lpPrevClose : null;
          const gapPct = gapAmt != null && lpPrevClose ? Math.abs(gapAmt / lpPrevClose * 100) : null;

          // Gap fill probabilities (adjusted by VIX if available)
          const vixAdj = vd?.orb_probability_adjustment ?? 0;
          const gapFill25  = Math.min(99, (hist.gap_fill_25  ?? 85) + vixAdj);
          const gapFill50  = Math.min(99, (hist.gap_fill_50  ?? 68) + vixAdj);
          const gapFill75  = Math.min(99, (hist.gap_fill_75  ?? 48) + vixAdj);
          const gapFill100 = Math.min(99, (hist.gap_fill_100 ?? 30) + vixAdj);

          contextHint += `
PROBABILIDADES HISTÓRICAS DEL GAP (base de datos interna — ${hist.sample_count ?? 'N/A'} sesiones analizadas):
Gap fill 25%=${gapFill25}%, Gap fill 50%=${gapFill50}%, Gap fill 75%=${gapFill75}%, Gap fill 100%=${gapFill100}%
${gapPct != null ? `Tamaño del gap hoy: ${gapPct.toFixed(2)}% → ${gapPct < 0.5 ? 'GAP PEQUEÑO (llenado probable 80-90%)' : gapPct < 1 ? 'GAP MODERADO (llenado 70-80%)' : gapPct < 2 ? 'GAP MEDIANO (llenado 55-70%)' : gapPct < 5 ? 'GAP GRANDE (llenado 30-50%)' : 'GAP EXTREMO (llenado <30%)'}` : ''}
INSTRUCCIÓN: Usa estas probabilidades para ajustar tu análisis del gap fill vs continuación.

PROBABILIDADES ORB HISTÓRICAS (base de datos interna — mismas ${hist.sample_count ?? 'N/A'} sesiones):
┌─ ORB 5min:  single_break=${hist.orb5_single_break}%, double_break=${hist.orb5_double_break}%, consolidation=${hist.orb5_consolidation}%
│  clean_break=${hist.orb5_clean_break_prob}%, failed_break=${hist.orb5_failed_break_prob}%
│  vol_confirm_boost=+${hist.orb5_vol_confirm_boost}%, low_vix_boost=+${hist.orb5_low_vix_boost}%, high_vix_penalty=-${hist.orb5_high_vix_penalty}%
│  trending_market=${hist.orb5_trending_market_break}%, ranging_market=${hist.orb5_ranging_market_break}%
│  gamma_wall_boost=+${hist.orb5_gamma_wall_boost}%, index_confirm_boost=+${hist.orb5_index_confirm_boost}%, gap_confluence_boost=+${hist.orb5_gap_confluence_boost}%
├─ ORB 15min: single_break=${hist.orb15_single_break}%, double_break=${hist.orb15_double_break}%, consolidation=${hist.orb15_consolidation}%
│  clean_break=${hist.orb15_clean_break_prob}%, failed_break=${hist.orb15_failed_break_prob}%
│  vol_confirm_boost=+${hist.orb15_vol_confirm_boost}%, low_vix_boost=+${hist.orb15_low_vix_boost}%, high_vix_penalty=-${hist.orb15_high_vix_penalty}%
│  trending_market=${hist.orb15_trending_market_break}%, ranging_market=${hist.orb15_ranging_market_break}%
│  gamma_wall_boost=+${hist.orb15_gamma_wall_boost}%, index_confirm_boost=+${hist.orb15_index_confirm_boost}%
├─ ORB 30min: single_break=${hist.orb30_single_break}%, double_break=${hist.orb30_double_break}%, consolidation=${hist.orb30_consolidation}%
│  clean_break=${hist.orb30_clean_break_prob}%, failed_break=${hist.orb30_failed_break_prob}%
│  vol_confirm_boost=+${hist.orb30_vol_confirm_boost}%, low_vix_boost=+${hist.orb30_low_vix_boost}%, high_vix_penalty=-${hist.orb30_high_vix_penalty}%
│  trending_market=${hist.orb30_trending_market_break}%, ranging_market=${hist.orb30_ranging_market_break}%
│  gamma_wall_boost=+${hist.orb30_gamma_wall_boost}%, index_confirm_boost=+${hist.orb30_index_confirm_boost}%
└─ ORB 1h:   single_break=${hist.orb1h_single_break}%, double_break=${hist.orb1h_double_break}%, consolidation=${hist.orb1h_consolidation}%
   clean_break=${hist.orb1h_clean_break_prob}%, failed_break=${hist.orb1h_failed_break_prob}%
   vol_confirm_boost=+${hist.orb1h_vol_confirm_boost}%, low_vix_boost=+${hist.orb1h_low_vix_boost}%, high_vix_penalty=-${hist.orb1h_high_vix_penalty}%
   trending_market=${hist.orb1h_trending_market_break}%, ranging_market=${hist.orb1h_ranging_market_break}%
   gamma_wall_boost=+${hist.orb1h_gamma_wall_boost}%, index_confirm_boost=+${hist.orb1h_index_confirm_boost}%

INSTRUCCIÓN CRÍTICA: Aplica estos modificadores a tu análisis scalp e intraday:
- Si el precio está en tendencia + volumen confirma → suma vol_confirm_boost e index_confirm_boost a la probabilidad base
- Si VIX > 25 → resta high_vix_penalty. Si VIX < 15 → suma low_vix_boost
- Si el ORB está alineado con gamma wall → suma gamma_wall_boost
- Si el día tiene un gap grande (>1.5%) → resta large_gap_day_penalty del clean_break_prob
- El orb_context en el análisis DEBE mencionar estos niveles y probabilidades ajustadas
`;
        } else {
          contextHint += `
ORB HISTÓRICO: No hay datos en base de datos para ${t}. Usa tu conocimiento empírico del ticker para estimar probabilidades de ruptura.
`;
        }

        // ── Multi-timeframe strategy context (for 3 strategies) ──
        if (id && !id.error) {
          contextHint += `
DATOS MULTI-TEMPORALIDAD PARA ESTRATEGIAS (REALES — Yahoo Finance):
Tendencia 4H: ${id.trend_4h || 'N/A'} | EMA20(4H)=${id.ema20_4h ?? 'N/A'}, EMA50(4H)=${id.ema50_4h ?? 'N/A'}
Tendencia 1H: ${id.trend_1h || 'N/A'} | EMA20(1H)=${id.ema20_1h ?? 'N/A'}, EMA50(1H)=${id.ema50_1h ?? 'N/A'}
Tendencia 15m: ${id.trend_15m || 'N/A'} | EMA20(15m)=${id.ema20_15m ?? 'N/A'}, EMA50(15m)=${id.ema50_15m ?? 'N/A'}
Engulfing 15m: ${id.engulfing_15m || 'Ninguna'}
S/R 1H: Resistencias=[${(id.sr_1h?.resistances || []).slice(0, 3).map(r => `$${r.level}(${r.touches}t)`).join(', ') || 'N/A'}] Soportes=[${(id.sr_1h?.supports || []).slice(0, 3).map(s => `$${s.level}(${s.touches}t)`).join(', ') || 'N/A'}]
Liquidez 1H: Highs=[${(id.liquidity_zones_1h?.equal_highs || []).slice(0, 3).map(l => `$${l}`).join(', ') || 'N/A'}] Lows=[${(id.liquidity_zones_1h?.equal_lows || []).slice(0, 3).map(l => `$${l}`).join(', ') || 'N/A'}]
Liquidez 4H: Highs=[${(id.liquidity_zones_4h?.equal_highs || []).slice(0, 3).map(l => `$${l}`).join(', ') || 'N/A'}] Lows=[${(id.liquidity_zones_4h?.equal_lows || []).slice(0, 3).map(l => `$${l}`).join(', ') || 'N/A'}]

INSTRUCCIÓN ESTRATEGIAS:
1) PULLBACK EN TENDENCIA: Dirección en 4H (EMA20>EMA50 + precio encima = alcista). Pullback en 1H (precio retrocede a EMA20 de 1H). Entrada en 15min (vela envolvente confirma). SL debajo soporte. TP=2x riesgo. Breakeven a 1R.
2) BREAKOUT: Zona clave en 1H (resistencia/soporte). Ruptura confirmada con volumen alto + segunda vela confirma. NO entrar si vela retrocede fuerte o volumen no acompaña.
3) LIQUIDITY SWEEP: Máximos/mínimos iguales = zonas de liquidez. Precio rompe momentáneamente y regresa → falsa ruptura. SWEEP_HIGH + cambio estructura bajista = PUT. SWEEP_LOW + cambio estructura alcista = CALL. SL encima/debajo del sweep. TP en siguiente zona opuesta (mínimo R:R 1:2).
`;
        }
      } catch (e) { /* continuar sin datos adicionales */ }

      let result = await base44.integrations.Core.InvokeLLM({
        prompt: `Eres un trader profesional institucional con metodología cuantitativa y gestión de riesgo estricta. Analiza ${t} (${now}).

${priceHint}${contextHint}
Usa estos precios, EMAs, BB, gamma/OI, VIX e índices como base exacta. NO estimes valores que ya te proporcioné — úsalos tal cual.

═══════════════════════════════════════════════════════════════
🎯 REGLAS DE RIESGO OBLIGATORIAS PARA SCALP E INTRADAY
═══════════════════════════════════════════════════════════════

ANTES de generar cualquier señal, verifica este checklist de confluencias:
1. ¿Dirección macro (15min+ para scalp, 1h para intraday) tiene sesgo claro? (+1 si sí)
2. ¿EMAs alineadas en la dirección del trade? (9>20>50 alcista o 9<20<50 bajista) (+1 si sí)
3. ¿Volumen confirma? (volume_confirms=true) (+1 si sí)
4. ¿Índices SPY/QQQ alineados con la dirección? (+1 si sí, -1 si van en contra)
5. ¿VIX en régimen favorable? (LOW/MODERATE = +1, HIGH = 0, EXTREME = -1)
6. ¿Bollinger Bands confirman? (signal=OVERSOLD+trade CALL, o signal=OVERBOUGHT+trade PUT, o SQUEEZE esperando breakout) (+1 si confirma)
7. ¿Precio respeta gamma levels? (NO está chocando contra wall en dirección opuesta) (+1 si sí)
8. ¿ORB alineado? (ruptura en la dirección del trade o consolidación con setup de breakout) (+1 si sí)
9. ¿Gap confluencia? (gap fill favorece dirección del trade) (+1 si sí)

PUNTUACIÓN Y PROBABILIDAD (IMPORTANTE — SIEMPRE dar señal direccional):
- SIEMPRE devuelve CALL o PUT basado en la dirección con más peso técnico. NUNCA devuelvas NEUTRAL.
- Si hay pocas confluencias (<4), baja success_prob a 30-45% pero SIGUE dando señal CALL o PUT con entry/sl/tp.
- Si hay 4-5 confluencias, success_prob entre 45-65%.
- Si hay 6-7 confluencias, success_prob entre 65-80%.
- Si hay 8-9 confluencias, success_prob entre 80-92%.
- El trader necesita VER la operación con mayor probabilidad para decidir. Un "NEUTRAL" no le sirve de nada.
- Incluso en alta volatilidad o mercado indeciso, SIEMPRE identifica la dirección más probable y da niveles de operación.

REGLAS DE ENTRY/SL/TP (OBLIGATORIO — siempre incluir precios numéricos):
- Entry NUNCA es el precio actual. SIEMPRE es un nivel técnico: EMA 20/50, soporte ORB, put_wall para CALL, call_wall para PUT, retroceso a VWAP.
- SL Scalp: idealmente máximo 0.5% del precio (o ATR×1 de 1min). SIEMPRE al otro lado del nivel de invalidación.
- SL Intraday: idealmente máximo 1% del precio (o ATR×1.5 de 5min). Al otro lado del swing previo.
- TP Scalp: mínimo R:R 1:2. Target = gamma wall opuesto, max_pain, extensión ORB, o siguiente EMA.
- TP Intraday: mínimo R:R 1:3. Target = gamma wall, extensión ORB 30min/1h, o nivel de estructura diario.
- CRÍTICO: SIEMPRE devuelve entry, sl, tp como NÚMEROS válidos. Si el R:R es bajo, baja la probabilidad pero NO omitas los precios.

REGLAS ANTI FAKE-BREAKOUT:
- Si precio cerca (<0.3%) de call_wall y trade es CALL → fake_breakout_risk=HIGH, reducir prob 10%.
- Si precio cerca (<0.3%) de put_wall y trade es PUT → fake_breakout_risk=HIGH, reducir prob 10%.
- Si BB en SQUEEZE + precio en gamma wall → fake_breakout_risk=HIGH, reducir prob 15% pero SEGUIR dando señal con entry/sl/tp.
- Si volumen <50% del promedio en la ruptura → fake_breakout_risk=HIGH, reducir prob 10%.

═══════════════════════════════════════
🔥 SCALP (1min entrada / 5min confirmación / 15min dirección)
═══════════════════════════════════════

PASO 1 — DIRECCIÓN MACRO (15min):
- ¿Cuál es la tendencia en 15min? ¿Precio sobre/bajo EMA 20 de 15min?
→ tf_15min_trend: BULLISH / BEARISH / NEUTRAL

PASO 2 — CONFIRMACIÓN (5min):
- ¿La estructura en 5min confirma la dirección del 15min?
- ¿EMA 9 sobre EMA 20 en 5min? ¿Volumen creciente?
→ tf_5min_confirm: BULLISH / BEARISH / NEUTRAL

═══ AFINACIÓN DE ENTRADA CON PRECISIÓN (3min / 2min / 1min) ═══
IMPORTANTE: Estos 3 timeframes NO definen la dirección — sirven EXCLUSIVAMENTE para afinar la entrada con mayor precisión y seguridad.

PASO 3 — PATRÓN EN 3min (identificación de zona):
- ¿Se forma en 3min un patrón de reversión o continuación en el nivel clave? (engulfing, pin bar, inside bar, rechazo de EMA)
- ¿El nivel clave (EMA 20/50, soporte, resistencia, gamma wall) está siendo respetado?
→ tf_3min_pattern: BULLISH si hay patrón alcista en nivel clave / BEARISH si bajista / NEUTRAL si no hay patrón claro

PASO 4 — CONFIRMACIÓN DE VELA EN 2min:
- ¿La vela de 2min cierra con cuerpo definido a favor de la señal? (cierre alcista con cuerpo >50% del rango, o bajista)
- ¿El volumen en la vela de 2min está por encima del promedio?
→ tf_2min_confirm: BULLISH si vela confirma alcista / BEARISH si confirma bajista / NEUTRAL si vela indecisa (doji, sombras largas)

PASO 5 — TRIGGER EXACTO (1min):
- La entrada se ejecuta en 1min cuando el precio rompe el máximo de la vela de 2min (para CALL) o el mínimo (para PUT)
- entry_precision_note: describe en 1-2 frases en español el trigger exacto: "Entrar CALL cuando rompa $XXX.XX (máximo vela 2min) con volumen. SL bajo mínimo de la vela de 3min $XXX.XX"

PASO 6 — AFINACIÓN ENTRADA (1min) — EMAs y señal final:
EMAs en 1min (valores exactos actuales):
- ema9, ema20, ema50
- ema9_above_20: ¿EMA 9 > EMA 20? → fuerza alcista
- price_above_ema20: ¿precio actual > EMA 20? → tendencia sana
- ema50_bounce: ¿el precio hizo rebote en EMA 50 esta sesión? → entrada institucional

GAMMA / OPEN INTEREST (crítico para scalp):
- call_wall: precio del call wall de mayor OI (resistencia magnética)
- put_wall: precio del put wall de mayor OI (soporte magnético)
- gamma_level: nivel gamma principal del día
- gamma_context: 1 frase en español: ¿el precio está entre walls (rango), cerca de un wall (freno), o ya rompió un wall (aceleración)?
  IMPORTANTE: si el precio se acerca al call_wall → aumenta fake_breakout_risk. Si ya rompió call_wall con volumen → baja fake_breakout_risk.

CONFLUENCIA CON ÍNDICES PRINCIPALES (obligatorio):
- spx_direction: dirección actual del SPX-500 (BULLISH/BEARISH/NEUTRAL)
- nq_direction: dirección actual del NQ1/NQ Futures (BULLISH/BEARISH/NEUTRAL)
- nasdaq100_direction: dirección actual del NASDAQ 100/QQQ (BULLISH/BEARISH/NEUTRAL)
- index_confluence_summary: 1-2 frases en español explicando si los 3 índices confirman la señal o hay divergencia, y cómo afecta la probabilidad del scalp

VIX:
- vix_value: nivel actual del VIX
- vix_regime: LOW (<15) / MODERATE (15-20) / HIGH (20-30) / EXTREME (>30)
- vix_context: 1 frase en español: ¿el VIX actual favorece tendencias limpias o genera más ruido/whipsaws?

${withPremarket ? `PREMARKET (INCLUIR EN EL ANÁLISIS — mercado antes de las 9:30 AM):
- premarket_high: máximo registrado en premarket hoy
- premarket_low: mínimo registrado en premarket hoy
- premarket_volume: descripción del volumen premarket (alto/normal/bajo comparado con días anteriores)
- premarket_direction: BULLISH si premarket > cierre ayer, BEARISH si premarket < cierre ayer, NEUTRAL si sin dirección
- premarket_note: 1-2 frases en español sobre qué dice el premarket sobre la sesión regular de hoy` : `PREMARKET: análisis SIN premarket — no usar datos de premarket, basar el análisis SOLO en la sesión regular (9:30 AM - 4:00 PM ET).`}

VOLUMEN Y NIVELES:
- volume_confirms: ¿el volumen en el nivel clave está por encima del promedio? (true/false)
- key_level_type: tipo de nivel — puede ser "Call Wall", "Put Wall", "Gamma Level", "Soporte ORB", "VWAP", "EMA 50", etc.
- key_level_price: precio exacto del nivel clave (puede ser el call_wall, put_wall o gamma_level si son los más relevantes)
- fake_breakout_risk: LOW si hay volumen elevado y precio alejado de gamma walls, HIGH si ruptura sin volumen o precio chocando contra gamma wall, MEDIUM si ambiguo

SEÑAL Y NIVELES (1min ejecución):
- signal: CALL o PUT — SIEMPRE la dirección con más peso técnico. NUNCA NEUTRAL. Si hay duda, elige la dirección del momentum actual.
- entry: precio estratégico (EMA 20/50, VWAP, borde ORB, gamma wall) — NUNCA el precio actual. DEBE ser un número válido siempre.
- sl: al otro lado del nivel de invalidación. Scalp idealmente max 0.5% del precio. DEBE ser un número válido siempre.
- tp: siguiente nivel institucional (gamma wall opuesto, max_pain, extensión ORB). R:R mínimo 1:2. DEBE ser un número válido siempre.
- success_prob: 0-100 basado en conteo de confluencias (ver checklist arriba). Penalizar si VIX>25 (-10), si índices divergen (-10), si BB en SQUEEZE (-5).
- summary: resumen de 1-2 frases EN ESPAÑOL explicando POR QUÉ es la señal y cuántas confluencias hay
- detail: análisis completo EN ESPAÑOL con desglose de cada confluencia

═══════════════════════════════════════
📈 INTRADAY (5min ejecuta / 15min estructura / 30min+1h mandan)
═══════════════════════════════════════

ESTRUCTURA DE TIMEFRAMES:
- tf_1h_direction: tendencia en 1h (BULLISH/BEARISH/NEUTRAL) — MANDA la dirección
- tf_30min_direction: tendencia en 30min — confirma la dirección del 1h
- tf_15min_structure: ¿está haciendo pullback a soporte o confirma estructura? (BULLISH=soportando, BEARISH=resistiendo, NEUTRAL=choppy)
- tf_5min_signal: señal de ejecución en 5min (BULLISH/BEARISH/NEUTRAL)

ORB (Opening Range Breakout):
- orb_context: estado actual de los ORBs de 5min, 15min, 30min, 1h — ¿rompió? ¿consolidando? ¿hacia qué lado? (texto en español, 1-2 frases)

CONFLUENCIA DE ÍNDICES (muy importante):
- spx_confirm: dirección de SPX ahora mismo (BULLISH/BEARISH/NEUTRAL)
- nq_confirm: dirección de NQ1!/NQ Futures (BULLISH/BEARISH/NEUTRAL)
- nasdaq_confirm: dirección de NASDAQ 100 / QQQ (BULLISH/BEARISH/NEUTRAL)
- index_confluence: ¿los 3 índices confirman la misma dirección? ¿hay divergencia? (texto en español)

VIX:
- vix_value: nivel actual del VIX
- vix_regime: LOW (<15) / MODERATE (15-20) / HIGH (20-30) / EXTREME (>30)
- vix_context: ¿implica tendencias limpias o más trampas? (1 frase en español)

GAMMA / OPEN INTEREST (Barchart o estimados):
- call_wall: precio del call wall de mayor OI
- put_wall: precio del put wall de mayor OI
- gamma_level: nivel gamma principal (donde el market maker cubre más)

EMAs en 5min (valores exactos):
- ema9_5min, ema20_5min, ema50_5min

SEÑAL INTRADAY:
- signal: CALL o PUT — SIEMPRE la dirección con más peso técnico según estructura de 1h+30min. NUNCA NEUTRAL.
- entry: entrada estratégica anclada a nivel técnico (pullback a EMA 20 5min, rebote en put_wall, borde ORB 30min, VWAP) — NUNCA el precio actual. DEBE ser un número válido siempre.
- sl: bajo/sobre el swing reciente más cercano o al otro lado del nivel de invalidación. Idealmente max 1% del precio. DEBE ser un número válido siempre.
- tp: call_wall, put_wall, max_pain, extensión ORB 30min/1h, o nivel estructural diario. R:R mínimo 1:3. DEBE ser un número válido siempre.
- success_prob: 0-100 basado en conteo de confluencias. Penalizar si VIX>25, si índices divergen, si BB en squeeze, si ORB no confirma.
- summary: 1-2 frases EN ESPAÑOL con conteo de confluencias
- detail: análisis completo EN ESPAÑOL detallando cada factor y su alineación

═══════════════════════════════════════
⚖️ GESTIÓN DE RIESGO
═══════════════════════════════════════
- max_risk_pct: riesgo máximo por operación (%). VIX LOW→2%, MODERATE→1.5%, HIGH→1%, EXTREME→0.5%
- rr_ratio: relación riesgo:recompensa real calculada de entry/sl/tp (ej: "1:2.5"). Si <1:1.5 → revisar niveles.
- position_suggestion: sugerencia de tamaño EN ESPAÑOL basada en riesgo. Incluir: "Con cuenta de $X, arriesgar máximo $Y (max_risk_pct%). Tamaño: Z contratos/acciones."

IMPORTANTE: Todos los textos (summary, detail, context, confluence) DEBEN estar en español.

═══════════════════════════════════════
🛡️ GESTIÓN DE RIESGO DINÁMICA (para este trade específico)
═══════════════════════════════════════

Basándote en los niveles de entrada, SL, TP, gamma walls, BB y la estructura actual de ${t}, indica las reglas dinámicas de gestión:

1. MOVER SL A BREAKEVEN:
   breakeven_trigger: ¿cuándo exactamente? (ej: "cuando el precio alcance el 50% del recorrido hacia TP en $XXX.XX" o "cuando supere el gamma_level en $XXX")
   breakeven_action: qué hacer exactamente (ej: "mover SL a $XXX.XX (precio de entrada) para asegurar trade gratuito")

2. TOMAR PROFIT PARCIAL:
   partial_profit_trigger: ¿en qué nivel? Debe ser un nivel técnico real (gamma wall, ORB extension, BB upper/lower, max_pain)
   partial_profit_action: cuánto cerrar (ej: "cerrar 50% en $XXX (gamma_level), mover SL del resto a BE")

3. SALIDA TOTAL (TP):
   full_exit_trigger: condición exacta (ej: "al tocar TP en $XXX o si BB indica overbought + rechazo en call_wall")
   full_exit_action: cómo ejecutar

4. AGUANTAR POSICIÓN:
   hold_trigger: (ej: "mientras precio sobre EMA 20 1min Y BB no en señal opuesta Y volumen estable")
   hold_action: qué vigilar (ej: "monitorear BB %B — si cruza 0.8 y empieza a bajar, tightear SL")

5. INVALIDACIÓN (salir inmediatamente):
   invalidation_trigger: señal técnica concreta (ej: "cierre de vela 1min por debajo de EMA 50 ($XXX) con volumen >1.5x promedio" o "precio pierde put_wall con volumen")
   invalidation_action: acción inmediata

general_note: nota con las 2-3 cosas más importantes a vigilar en este trade (en español)

NOTA: Las estrategias de estructura (Liquidity Sweep, Pullback, Breakout) se calculan automáticamente con datos reales. NO las incluyas en tu respuesta JSON.

═══════════════════════════════════════
🚫 ALERTAS DE NO OPERAR
═══════════════════════════════════════

Evalúa si existe alguna de estas 3 condiciones AHORA para ${t}. Devuelve un array "alerts" con SOLO las que aplican (puede ser vacío []).

1. NOTICIAS IMPORTANTES (type: "news"):
   Detecta si hay próximas noticias de alto impacto en las próximas 2-4 horas que puedan generar movimientos erráticos e impredecibles. Incluye:
   - Datos macroeconómicos: CPI, NFP, FOMC, PPI, PMI, ventas minoristas, PIB
   - Earnings o resultados trimestrales del propio ticker
   - Decisiones de la Fed, discursos de Powell
   - Eventos geopolíticos de alto impacto
   Si detectas alguno: severity="HIGH", label="Noticia de Alto Impacto", reason="[nombre del evento] a las [hora ET]. Movimiento impredecible esperado.", wait_until="[hora del evento + 30min] ET"

2. MERCADO LATERAL / CHOPPY (type: "sideways"):
   Detecta si el ticker está en rango lateral sin dirección clara:
   - Precio oscilando sin hacer nuevos máximos o mínimos significativos
   - ADX por debajo de 20 (sin tendencia)
   - EMAs aplanadas (EMA 9 ≈ EMA 20 ≈ EMA 50)
   - Múltiples whipsaws recientes en ambas direcciones
   Si detectas: severity="MEDIUM", label="Mercado Lateral / Sin Dirección", reason="[descripción concreta del rango y las condiciones]", wait_until="Ruptura confirmada del rango con volumen"

3. BAJO VOLUMEN / MEDIODÍA (type: "low_volume"):
   Detecta si el ticker está en zona de bajo volumen. Esto ocurre típicamente:
   - Entre 11:30 AM y 1:30 PM ET (hora de mediodía — liquidez mínima)
   - Volumen actual por debajo del 40% del promedio de la sesión
   - Spreads amplios, movimientos erráticos sin volumen
   Si aplica: severity="MEDIUM", label="Bajo Volumen / Zona de Mediodía", reason="[descripción del volumen actual y hora]", wait_until="Después de 1:30 PM ET cuando retorna el volumen institucional"

REGLA: Si ninguna condición aplica, devuelve alerts=[] (array vacío). No inventes alertas si no hay evidencia real.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: fullSchema
      });

      // Deep clone to avoid mutating frozen/immutable objects from InvokeLLM
      result = JSON.parse(JSON.stringify(result ?? {}));

      // Ensure core sections exist even if LLM response was truncated
      if (!result.scalp) result.scalp = {};
      if (!result.intraday) result.intraday = {};
      if (!result.risk) result.risk = {};
      if (!result.risk_rules) result.risk_rules = {};
      if (!result.no_trade) result.no_trade = { alerts: [] };
      if (!result.strategies) result.strategies = {};

      // Override EMA values with real calculated data (already fetched above)
      if (intradayData) {
        result.scalp.ema9  = intradayData.ema9_1m;
        result.scalp.ema20 = intradayData.ema20_1m;
        result.scalp.ema50 = intradayData.ema50_1m;
        result.scalp.ema9_above_20     = intradayData.ema9_above_20_1m;
        result.scalp.price_above_ema20 = intradayData.price_above_ema20_1m;
        result.scalp.ema50_bounce      = intradayData.ema50_bounce;
        result.scalp.volume_confirms   = intradayData.volume_confirms;
        result.scalp.bb_1m = intradayData.bb_1m ?? null;
        result.scalp.bb_5m = intradayData.bb_5m ?? null;

        result.intraday.ema9_5min  = intradayData.ema9_5m;
        result.intraday.ema20_5min = intradayData.ema20_5m;
        result.intraday.ema50_5min = intradayData.ema50_5m;
        result.intraday.bb_5m = intradayData.bb_5m ?? null;

        // Override ORB first candle data + deterministic breakout status
        if (intradayData.first_candle_5m) result.scalp.orb_5m = intradayData.first_candle_5m;
        if (intradayData.first_candle_15m) result.scalp.orb_15m = intradayData.first_candle_15m;
        if (intradayData.first_candle_30m) result.intraday.orb_30m = intradayData.first_candle_30m;
        if (intradayData.first_candle_1h) result.intraday.orb_1h = intradayData.first_candle_1h;
        // Store deterministic ORB status
        if (orbStatuses.first_candle_5m) result.scalp.orb_5m_status = orbStatuses.first_candle_5m.status;
        if (orbStatuses.first_candle_15m) {
          result.scalp.orb_15m_status = orbStatuses.first_candle_15m.status;
          result.scalp.orb_15m_quality = orbStatuses.first_candle_15m.quality;
          result.scalp.orb_15m_likely_consolidation = !!orbStatuses.first_candle_15m.likely_consolidation;
        }
        if (orbStatuses.first_candle_30m) {
          result.intraday.orb_30m_status = orbStatuses.first_candle_30m.status;
          result.intraday.orb_30m_quality = orbStatuses.first_candle_30m.quality;
          result.intraday.orb_30m_likely_consolidation = !!orbStatuses.first_candle_30m.likely_consolidation;
        }
        if (orbStatuses.first_candle_1h) result.intraday.orb_1h_status = orbStatuses.first_candle_1h.status;

        // ── Override timeframe trend fields con datos reales (determinístico) ─────
        // Scalp: estructura de dirección 15min y 5min
        if (intradayData.trend_15m) result.scalp.tf_15min_trend = intradayData.trend_15m;
        if (intradayData.ema9_5m != null && intradayData.ema20_5m != null) {
          result.scalp.tf_5min_confirm = intradayData.ema9_5m > intradayData.ema20_5m ? 'BULLISH'
            : intradayData.ema9_5m < intradayData.ema20_5m ? 'BEARISH' : 'NEUTRAL';
        }
        // Scalp: afinación de entrada — patrón 3min y confirmación 2min desde velas 1min reales
        const c1m = intradayData.candles_1m || [];
        if (c1m.length >= 3) {
          const last3 = c1m.slice(-3);
          const bar3 = {
            open: last3[0]?.open ?? last3[0]?.close,
            close: last3[last3.length - 1]?.close,
            high: Math.max(...last3.map(c => c?.high ?? 0)),
            low: Math.min(...last3.map(c => c?.low ?? Infinity)),
          };
          const body3 = (bar3.close ?? 0) - (bar3.open ?? 0);
          const range3 = (bar3.high ?? 0) - (bar3.low ?? 0);
          result.scalp.tf_3min_pattern = range3 > 0 && Math.abs(body3) / range3 > 0.3
            ? (body3 > 0 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
        }
        if (c1m.length >= 2) {
          const last2 = c1m.slice(-2);
          const bar2 = {
            open: last2[0]?.open ?? last2[0]?.close,
            close: last2[last2.length - 1]?.close,
            high: Math.max(...last2.map(c => c?.high ?? 0)),
            low: Math.min(...last2.map(c => c?.low ?? Infinity)),
          };
          const body2 = (bar2.close ?? 0) - (bar2.open ?? 0);
          const range2 = (bar2.high ?? 0) - (bar2.low ?? 0);
          result.scalp.tf_2min_confirm = range2 > 0 && Math.abs(body2) / range2 > 0.4
            ? (body2 > 0 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
        }

        // Intraday: estructura de dirección 1h, 30min (proxy desde 15m), 15min, 5min
        if (intradayData.trend_1h) result.intraday.tf_1h_direction = intradayData.trend_1h;
        if (intradayData.trend_15m) {
          if (!result.intraday.tf_30min_direction) result.intraday.tf_30min_direction = intradayData.trend_15m;
          result.intraday.tf_15min_structure = intradayData.trend_15m;
        }
        if (intradayData.ema9_5m != null && intradayData.ema20_5m != null) {
          const tf5 = intradayData.ema9_5m > intradayData.ema20_5m ? 'BULLISH'
            : intradayData.ema9_5m < intradayData.ema20_5m ? 'BEARISH' : 'NEUTRAL';
          result.intraday.tf_5min_signal = tf5;
        }
      }

      // Override VIX with real data from getVix
      if (vd && !vd.error) {
        const normalizedVixRegime = normalizeVixRegime(vd.regime) || vd.regime;
        result.scalp.vix_value = vd.vix;
        result.scalp.vix_regime = normalizedVixRegime;
        result.scalp.vix_context = vd.impact_note || result.scalp.vix_context;
        result.intraday.vix_value = vd.vix;
        result.intraday.vix_regime = normalizedVixRegime;
        result.intraday.vix_context = vd.impact_note || result.intraday.vix_context;
      }

      // Override Gamma/OI with real data
      if (gd && !gd.error) {
        if (gd.call_wall)   result.scalp.call_wall   = gd.call_wall;
        if (gd.put_wall)    result.scalp.put_wall    = gd.put_wall;
        if (gd.gamma_level) result.scalp.gamma_level = gd.gamma_level;
        result.scalp.gamma_source = gd.source || null;
        result.scalp.gamma_options_expiration = gd.options_expiration || null;
        result.scalp.gamma_expiration_mode = gd.requested_expiration_mode || gammaExpirationMode;
        result.scalp.gamma_calculation_mode = gd.gamma_calculation_mode || gammaCalculationMode;
        result.scalp.strict_real_gamma = !!gd.strict_real_gamma;
        result.scalp.call_wall_institutional = gd.call_wall_institutional ?? null;
        result.scalp.put_wall_institutional = gd.put_wall_institutional ?? null;
        result.scalp.gamma_level_institutional = gd.gamma_level_institutional ?? null;
        result.scalp.call_wall_near_open = gd.call_wall_near_open ?? null;
        result.scalp.put_wall_near_open = gd.put_wall_near_open ?? null;
        result.scalp.gamma_level_near_open = gd.gamma_level_near_open ?? null;
        result.scalp.gamma_flip = gd.gamma_flip ?? null;
        result.scalp.gex_total = gd.gex_total ?? null;
        result.scalp.gex_regime = gd.gex_regime ?? null;
        result.scalp.gex_market_mode = gd.gex_market_mode ?? null;
        result.scalp.vol_gex = gd.vol_gex ?? null;
        result.scalp.delta_exposure = gd.delta_exposure ?? null;
        result.scalp.gex_0dte = gd.gex_0dte ?? null;
        result.scalp.gex_ex_0dte = gd.gex_ex_0dte ?? null;
        result.scalp.gex_estimated_gamma_count = gd.gex_estimated_gamma_count ?? null;
        result.scalp.gex_direct_gamma_count = gd.gex_direct_gamma_count ?? null;
        result.scalp.max_pain = gd.max_pain;
        if (gd.call_wall)   result.intraday.call_wall   = gd.call_wall;
        if (gd.put_wall)    result.intraday.put_wall    = gd.put_wall;
        if (gd.gamma_level) result.intraday.gamma_level = gd.gamma_level;
        result.intraday.gamma_source = gd.source || null;
        result.intraday.gamma_options_expiration = gd.options_expiration || null;
        result.intraday.gamma_expiration_mode = gd.requested_expiration_mode || gammaExpirationMode;
        result.intraday.gamma_calculation_mode = gd.gamma_calculation_mode || gammaCalculationMode;
        result.intraday.strict_real_gamma = !!gd.strict_real_gamma;
        result.intraday.call_wall_institutional = gd.call_wall_institutional ?? null;
        result.intraday.put_wall_institutional = gd.put_wall_institutional ?? null;
        result.intraday.gamma_level_institutional = gd.gamma_level_institutional ?? null;
        result.intraday.call_wall_near_open = gd.call_wall_near_open ?? null;
        result.intraday.put_wall_near_open = gd.put_wall_near_open ?? null;
        result.intraday.gamma_level_near_open = gd.gamma_level_near_open ?? null;
        result.intraday.gamma_flip = gd.gamma_flip ?? null;
        result.intraday.gex_total = gd.gex_total ?? null;
        result.intraday.gex_regime = gd.gex_regime ?? null;
        result.intraday.gex_market_mode = gd.gex_market_mode ?? null;
        result.intraday.vol_gex = gd.vol_gex ?? null;
        result.intraday.delta_exposure = gd.delta_exposure ?? null;
        result.intraday.gex_0dte = gd.gex_0dte ?? null;
        result.intraday.gex_ex_0dte = gd.gex_ex_0dte ?? null;
        result.intraday.gex_estimated_gamma_count = gd.gex_estimated_gamma_count ?? null;
        result.intraday.gex_direct_gamma_count = gd.gex_direct_gamma_count ?? null;
        result.intraday.max_pain = gd.max_pain;

        // Validación de calidad: solo gamma real activo con datos insuficientes
        const GEX_MIN_DIRECT = 5;
        const directCount = gd.gex_direct_gamma_count ?? 0;
        if (gd.strict_real_gamma && directCount < GEX_MIN_DIRECT) {
          result.scalp.data_quality = 'LOW';
          result.intraday.data_quality = 'LOW';
          result.scalp.data_quality_reason = `Solo gamma real ON pero solo ${directCount} contratos con gamma directa (mínimo ${GEX_MIN_DIRECT}). GEX poco confiable.`;
          result.intraday.data_quality_reason = result.scalp.data_quality_reason;
          // Penalizar success_prob en scalp
          if (Number.isFinite(Number(result.scalp.success_prob))) {
            result.scalp.success_prob = Math.max(0, Number(result.scalp.success_prob) - 12);
          }
          // Penalizar success_prob en intraday
          if (Number.isFinite(Number(result.intraday.success_prob))) {
            result.intraday.success_prob = Math.max(0, Number(result.intraday.success_prob) - 12);
          }
        }
      }

      // Override premarket con datos reales de Yahoo (siempre disponibles si existen)
      if (pmData && pmData.available) {
        result.scalp.premarket_high = pmData.premarket_high;
        result.scalp.premarket_low = pmData.premarket_low;
        result.scalp.premarket_direction = pmData.premarket_direction;
        result.scalp.premarket_volume = pmData.premarket_volume > 500000 ? 'Alto' : pmData.premarket_volume > 100000 ? 'Normal' : 'Bajo';
        if (!result.scalp.premarket_note) {
          result.scalp.premarket_note = pmData.premarket_direction === 'NEUTRAL'
            ? 'Premarket sin dirección clara — sesión regular puede definir la tendencia.'
            : `Premarket ${pmData.premarket_direction === 'BULLISH' ? 'alcista' : 'bajista'} — rango $${pmData.premarket_low}–$${pmData.premarket_high}. Estos niveles son soporte/resistencia clave para la apertura.`;
        }
      }

      // Compute fake_breakout_risk determinístico si el LLM no lo devolvió
      if (!result.scalp.fake_breakout_risk) {
        const sp = lpPrice;
        const cw = result.scalp.call_wall;
        const pw = result.scalp.put_wall;
        const nearCW = cw && sp ? Math.abs(sp - cw) / sp < 0.003 : false;
        const nearPW = pw && sp ? Math.abs(sp - pw) / sp < 0.003 : false;
        const bbSqueeze = result.scalp.bb_1m?.squeeze === true;
        const volConf = result.scalp.volume_confirms;
        const sig = result.scalp.signal;
        if ((nearCW && sig === 'CALL') || (nearPW && sig === 'PUT') || bbSqueeze) {
          result.scalp.fake_breakout_risk = 'HIGH';
        } else if (!volConf || nearCW || nearPW) {
          result.scalp.fake_breakout_risk = 'MEDIUM';
        } else {
          result.scalp.fake_breakout_risk = 'LOW';
        }
      }

      // Override index confluence with REAL SPY/QQQ data
      if (spyData || nqData || qqqData) {
        const spyDir = spyData && spyData.current_price > spyData.today_open ? 'BULLISH' : spyData && spyData.current_price < spyData.today_open ? 'BEARISH' : 'NEUTRAL';
        const nqDir = nqData && nqData.current_price > nqData.today_open ? 'BULLISH' : nqData && nqData.current_price < nqData.today_open ? 'BEARISH' : 'NEUTRAL';
        const qqqDir = qqqData && qqqData.current_price > qqqData.today_open ? 'BULLISH' : qqqData && qqqData.current_price < qqqData.today_open ? 'BEARISH' : 'NEUTRAL';
        result.scalp.spx_direction = spyDir;
        result.scalp.nq_direction = nqDir;
        result.scalp.nasdaq100_direction = qqqDir;
        result.intraday.spx_confirm = spyDir;
        result.intraday.nq_confirm = nqDir;
        result.intraday.nasdaq_confirm = qqqDir;
      }

      // ═══ CONSOLIDATION PROBABILITY ═══
      // Multi-factor consolidation score from real 15m candle data
      if (intradayData && result.scalp) {
        const candles15 = intradayData.candles_15m || [];
        const period = 20;
        const slice = candles15.slice(-period);
        const currentPrice = intradayData.current_price_15m || intradayData.current_price_5m || intradayData.current_price_1m || 1;
        let consolidationScore = 0;

        // 1. Narrow range: (max_high - min_low) of last 20 candles < 0.5% of current price
        if (slice.length >= 5) {
          const maxHigh = Math.max(...slice.map(c => c.high));
          const minLow = Math.min(...slice.map(c => c.low));
          if ((maxHigh - minLow) / currentPrice < 0.005) consolidationScore++;
        }

        // 2. BB Squeeze on 5m (primary) or 1m (fallback)
        if (result.scalp.bb_5m?.squeeze === true || result.scalp.bb_1m?.squeeze === true) consolidationScore++;

        // 3. Low ATR: avg true range of last 14 candles < 80% of avg over 50 candles
        if (candles15.length >= 14) {
          const calcAvgTR = (candles) => {
            let sum = 0;
            for (let i = 1; i < candles.length; i++) {
              const tr = Math.max(
                candles[i].high - candles[i].low,
                Math.abs(candles[i].high - candles[i - 1].close),
                Math.abs(candles[i].low - candles[i - 1].close),
              );
              sum += tr;
            }
            return sum / (candles.length - 1);
          };
          const atr14 = calcAvgTR(candles15.slice(-14));
          const atrBase = calcAvgTR(candles15.length >= 50 ? candles15.slice(-50) : candles15);
          if (atr14 < atrBase * 0.8) consolidationScore++;
        }

        // 4. ADX proxy: directional efficiency ratio (net price move / sum of true ranges)
        if (slice.length >= 10) {
          const netMove = Math.abs(slice[slice.length - 1].close - (slice[0].open ?? slice[0].close));
          let totalTR = 0;
          for (let i = 1; i < slice.length; i++) {
            totalTR += Math.max(
              slice[i].high - slice[i].low,
              Math.abs(slice[i].high - slice[i - 1].close),
              Math.abs(slice[i].low - slice[i - 1].close),
            );
          }
          if (totalTR > 0 && netMove / totalTR < 0.25) consolidationScore++;
        }

        // 5. No HH/LL structure: !(higherHigh && lowerLow) over last 20 candles
        if (slice.length >= 5) {
          let higherHigh = false;
          let lowerLow = false;
          for (let i = 1; i < slice.length; i++) {
            if (slice[i].high > slice[i - 1].high) higherHigh = true;
            if (slice[i].low < slice[i - 1].low) lowerLow = true;
          }
          if (!(higherHigh && lowerLow)) consolidationScore++;
        }

        result.scalp.consolidation_score = consolidationScore;
        result.scalp.consolidation_prob = Math.round((consolidationScore / 5) * 100);
        result.scalp.consolidation_class = consolidationScore >= 4 ? 'STRONG_CONSOLIDATION'
          : consolidationScore >= 3 ? 'CONSOLIDATION' : 'TRENDING';
      }

      // ═══ DETERMINISTIC ENTRY/SL/TP FALLBACK ═══
      // If the LLM didn't return valid entry/sl/tp, compute them from real data
      const computeFallbackLevels = (section, opts) => {
        if (!section || !lpPrice) return;
        const { maxSlPct, minRR, ema20Val, ema50Val, orbCandle, callW, putW, strategyType } = opts;
        const signal = section.signal;
        if (!signal || (signal !== 'CALL' && signal !== 'PUT')) return;
        const isBull = signal === 'CALL';

        // ── Sanity check: reject LLM entry if too far from current price ──
        const maxEntryDist = 0.03; // 3% max deviation from current price
        if (section.entry && typeof section.entry === 'number') {
          const dist = Math.abs(section.entry - lpPrice) / lpPrice;
          if (dist > maxEntryDist) {
            console.warn(`LLM entry $${section.entry} está ${(dist * 100).toFixed(1)}% lejos del precio actual $${lpPrice} — recalculando`);
            section.entry = null; // force recalculation
            section.sl = null;
            section.tp = null;
          }
        }

        // ── Sanity check: entry must be on correct side for signal ──
        if (section.entry && typeof section.entry === 'number') {
          // For CALL, entry should be at or below current price (buying on pullback)
          // For PUT, entry should be at or above current price (selling on bounce)
          if (isBull && section.entry > lpPrice * 1.015) {
            console.warn(`CALL entry $${section.entry} está sobre precio actual $${lpPrice} — recalculando`);
            section.entry = null;
            section.sl = null;
            section.tp = null;
          } else if (!isBull && section.entry < lpPrice * 0.985) {
            console.warn(`PUT entry $${section.entry} está debajo de precio actual $${lpPrice} — recalculando`);
            section.entry = null;
            section.sl = null;
            section.tp = null;
          }
        }

        // ── Entry fallback ──
        if (!section.entry || typeof section.entry !== 'number') {
          if (isBull) {
             // CALL: entry at nearest support
             // SCALP: tight range (0.5-1% below), INTRADAY: deeper pullback (1-2% below)
             const rangeFloor = strategyType === 'scalp' ? lpPrice * 0.995 : lpPrice * 0.98;
             const candidates = [ema20Val, putW, orbCandle?.low].filter(v => v && v < lpPrice && v > rangeFloor);
            section.entry = candidates.length
              ? parseFloat(Math.max(...candidates).toFixed(2))
               : parseFloat((strategyType === 'scalp' ? lpPrice * 0.998 : lpPrice * 0.987).toFixed(2));
          } else {
             // PUT: entry at nearest resistance
             // SCALP: tight range (0.5-1% above), INTRADAY: deeper rally (1-2% above)
             const rangeCeiling = strategyType === 'scalp' ? lpPrice * 1.005 : lpPrice * 1.02;
             const candidates = [ema20Val, callW, orbCandle?.high].filter(v => v && v > lpPrice && v < rangeCeiling);
            section.entry = candidates.length
              ? parseFloat(Math.min(...candidates).toFixed(2))
               : parseFloat((strategyType === 'scalp' ? lpPrice * 1.002 : lpPrice * 1.013).toFixed(2));
          }
        }

        // ── SL validation + fallback ──
        if (section.sl && typeof section.sl === 'number') {
          // SL must be on correct side of entry
          const slValid = isBull ? section.sl < section.entry : section.sl > section.entry;
          const slDist = Math.abs(section.sl - section.entry) / section.entry;
          if (!slValid || slDist > maxSlPct * 3 || slDist < 0.001) {
            section.sl = null; // force recalculation
          }
        }
        if (!section.sl || typeof section.sl !== 'number') {
          const riskAmt = section.entry * maxSlPct;
          if (isBull) {
            const ema50Below = ema50Val && ema50Val < section.entry ? ema50Val : null;
            section.sl = parseFloat((ema50Below ? Math.min(ema50Below, section.entry - riskAmt) : section.entry - riskAmt).toFixed(2));
          } else {
            const ema50Above = ema50Val && ema50Val > section.entry ? ema50Val : null;
            section.sl = parseFloat((ema50Above ? Math.max(ema50Above, section.entry + riskAmt) : section.entry + riskAmt).toFixed(2));
          }
        }

        // ── TP validation + fallback — enforce minimum R:R ──
        if (section.tp && typeof section.tp === 'number') {
          const tpValid = isBull ? section.tp > section.entry : section.tp < section.entry;
          if (!tpValid) section.tp = null;
        }
        if (!section.tp || typeof section.tp !== 'number') {
          const risk = Math.abs(section.entry - section.sl);
          const minReward = risk * minRR;
          if (isBull) {
            const targets = [callW, orbCandle?.high ? orbCandle.high + (orbCandle.high - orbCandle.low) : null]
              .filter(v => v && v > section.entry + minReward);
            section.tp = targets.length
              ? parseFloat(Math.min(...targets).toFixed(2))
              : parseFloat((section.entry + minReward).toFixed(2));
          } else {
            const targets = [putW, orbCandle?.low ? orbCandle.low - (orbCandle.high - orbCandle.low) : null]
              .filter(v => v && v < section.entry - minReward);
            section.tp = targets.length
              ? parseFloat(Math.max(...targets).toFixed(2))
              : parseFloat((section.entry - minReward).toFixed(2));
          }
        }

        // ── Enforce R:R even if LLM returned values ──
        if (section.entry && section.sl && section.tp) {
          const risk = Math.abs(section.entry - section.sl);
          const reward = Math.abs(section.tp - section.entry);
          if (risk > 0 && reward / risk < minRR) {
            const requiredReward = risk * minRR;
            section.tp = parseFloat((isBull ? section.entry + requiredReward : section.entry - requiredReward).toFixed(2));
          }
        }
      };

      const enforceScalpOdteProfile = (scalpSection, intradaySection) => {
        if (!scalpSection || !lpPrice) return;
        const signal = scalpSection.signal;
        if (signal !== 'CALL' && signal !== 'PUT') return;

        const isBull = signal === 'CALL';
        const entry = Number(scalpSection.entry || lpPrice);
        const slCurrent = Number(scalpSection.sl || 0);
        const riskCurrent = slCurrent > 0 ? Math.abs(entry - slCurrent) : 0;

        const minRisk = Math.max(0.05, entry * 0.0015);
        const maxRisk = Math.max(minRisk, entry * 0.0035);
        const scalpRisk = Math.min(maxRisk, Math.max(minRisk, riskCurrent || entry * 0.0025));
        const scalpSl = isBull ? entry - scalpRisk : entry + scalpRisk;

        const rrTarget = 1.35;
        const rewardRaw = scalpRisk * rrTarget;
        const minReward = Math.max(0.08, entry * 0.0025);
        const maxReward = Math.max(minReward, entry * 0.0060);
        const scalpReward = Math.min(maxReward, Math.max(minReward, rewardRaw));
        const scalpTp = isBull ? entry + scalpReward : entry - scalpReward;

        scalpSection.entry = Number(entry.toFixed(2));
        scalpSection.sl = Number(scalpSl.toFixed(2));
        scalpSection.tp = Number(scalpTp.toFixed(2));
        scalpSection.scalp_profile = 'ODTE_COMPACT';
        scalpSection.scalp_note = 'Niveles compactos para scalp en opciones 0DTE/semana: SL corto y TP corto.';

        if (!intradaySection || intradaySection.signal !== signal) return;
        const iEntry = Number(intradaySection.entry || 0);
        const iSl = Number(intradaySection.sl || 0);
        const iTp = Number(intradaySection.tp || 0);
        if (!iEntry || !iSl || !iTp) return;

        const intradayIsBull = intradaySection.signal === 'CALL';
        const iRiskCurrent = Math.abs(iEntry - iSl);
        const minIntradayRisk = Math.max(scalpRisk * 1.8, iEntry * 0.0060);
        if (iRiskCurrent < minIntradayRisk) {
          intradaySection.sl = Number((intradayIsBull ? iEntry - minIntradayRisk : iEntry + minIntradayRisk).toFixed(2));
        }

        const iRiskFinal = Math.abs(iEntry - intradaySection.sl);
        const iRewardCurrent = Math.abs(iTp - iEntry);
        const minIntradayReward = Math.max(iRiskFinal * 2.5, scalpReward * 1.8, iEntry * 0.0100);
        if (iRewardCurrent < minIntradayReward) {
          intradaySection.tp = Number((intradayIsBull ? iEntry + minIntradayReward : iEntry - minIntradayReward).toFixed(2));
        }
      };

      // NOTE: Fallback levels are computed AFTER scoreConfluence (below)
      // so that recovered NEUTRAL→CALL/PUT signals also get entry/sl/tp

      // ═══ DETERMINISTIC STRATEGY DETECTION (3 strategies) ═══
      if (intradayData && lpPrice) {
        if (!result.strategies) result.strategies = {};
        const idd = intradayData;
        const gammaData = gd && !gd.error ? gd : null;
        const vixRegime = vd?.regime || null;
        const sweptZoneLabel = (t) => ({
          EQUAL_HIGHS: 'Máximos iguales 1H',
          EQUAL_LOWS: 'Mínimos iguales 1H',
          EQUAL_HIGHS_4H: 'Máximos iguales 4H',
          EQUAL_LOWS_4H: 'Mínimos iguales 4H',
        }[t] || t);

        // ─── STRATEGY 1: TREND + PULLBACK ───────────────────────
        // Dirección en 4H, confirmación en 1H, entrada en 15min
        {
          const ema20_1h = idd.ema20_1h;
          const ema50_1h = idd.ema50_1h;
          const candles1h = idd.candles_1h || [];
          const candles15pb = idd.candles_15m || [];
          const price1h = idd.current_price_1h ?? lpPrice;
          const pullbackMargin = pullbackMarginCfg; // configurable desde BotSettings

          // Lógica base: tendencia por EMA20/EMA50
          const trendByEma = ema20_1h && ema50_1h
            ? (ema20_1h > ema50_1h ? 'BULLISH' : ema20_1h < ema50_1h ? 'BEARISH' : 'NEUTRAL')
            : 'NEUTRAL';
          const isBullTrend = trendByEma === 'BULLISH';
          const isBearTrend = trendByEma === 'BEARISH';
          const hasTrend = isBullTrend || isBearTrend;

          // Pullback en 1H: precio retrocede hacia EMA 20 de 1H
          let pullbackDetected = false;
          let pullbackType = '';
          let distToEma20_1h = null;
          let nearEma20 = false;
          let touchedEma20Recently = false;
          if (hasTrend && ema20_1h) {
            distToEma20_1h = Math.abs(price1h - ema20_1h) / ema20_1h;
            nearEma20 = distToEma20_1h < pullbackMargin;
            touchedEma20Recently = candles1h.slice(-4).some((c) => c.low <= ema20_1h && c.high >= ema20_1h);
            if (nearEma20) { pullbackDetected = true; pullbackType = 'EMA 20 (1H)'; }
            else if (touchedEma20Recently) { pullbackDetected = true; pullbackType = 'Toque reciente EMA 20 (1H)'; }
          }

          // Confirmación de entrada: vela fuerte a favor de tendencia
          const lastPb15 = candles15pb[candles15pb.length - 1];
          const candleRange = lastPb15 ? Math.max(0, (lastPb15.high ?? 0) - (lastPb15.low ?? 0)) : 0;
          const candleBody = lastPb15 ? Math.abs((lastPb15.close ?? 0) - (lastPb15.open ?? 0)) : 0;
          const strongBullCandle = !!lastPb15 &&
            lastPb15.close > lastPb15.open &&
            candleRange > 0 &&
            (candleBody / candleRange) > 0.5;
          const strongBearCandle = !!lastPb15 &&
            lastPb15.open > lastPb15.close &&
            candleRange > 0 &&
            (candleBody / candleRange) > 0.5;

          const entryConfirmed = pullbackDetected && (
            (isBullTrend && strongBullCandle) ||
            (isBearTrend && strongBearCandle)
          );

          // Gamma confluence check
          const gammaConfl = gammaData && lpPrice ? (
            isBullTrend ? lpPrice < (gammaData.call_wall * 0.997)
                        : lpPrice > (gammaData.put_wall * 1.003)
          ) : false;

          // Volume analysis: low volume on pullback = healthy
          const volOnPullback = !idd.volume_confirms_15m
            ? 'Volumen bajo en retroceso — pullback sano.'
            : 'Volumen alto en retroceso — monitorear posible reversión.';

          let pbEntry, pbSl, pbTp, breakevenRule;
          let pullbackProjected = false;
          if (pullbackDetected && isBullTrend) {
            pbEntry = parseFloat((ema20_1h * 1.001).toFixed(2));
            pbSl = parseFloat(((ema50_1h ?? ema20_1h * 0.99) * 0.998).toFixed(2));
            const risk = pbEntry - pbSl;
            pbTp = parseFloat((pbEntry + risk * 2).toFixed(2));
            breakevenRule = `Mover SL a breakeven cuando precio alcance +${(risk * 1).toFixed(2)} (1R).`;
          } else if (pullbackDetected && isBearTrend) {
            pbEntry = parseFloat((ema20_1h * 0.999).toFixed(2));
            pbSl = parseFloat(((ema50_1h ?? ema20_1h * 1.01) * 1.002).toFixed(2));
            const risk = pbSl - pbEntry;
            pbTp = parseFloat((pbEntry - risk * 2).toFixed(2));
            breakevenRule = `Mover SL a breakeven cuando precio alcance -${(risk * 1).toFixed(2)} (1R).`;
          } else if (!pullbackDetected && hasTrend && ema20_1h) {
            pullbackProjected = true;
            if (isBullTrend) {
              pbEntry = parseFloat((ema20_1h * 1.001).toFixed(2));
              pbSl = parseFloat(((ema50_1h ?? ema20_1h * 0.99) * 0.998).toFixed(2));
              const risk = Math.max(0.01, pbEntry - pbSl);
              pbTp = parseFloat((pbEntry + risk * 2).toFixed(2));
            } else if (isBearTrend) {
              pbEntry = parseFloat((ema20_1h * 0.999).toFixed(2));
              pbSl = parseFloat(((ema50_1h ?? ema20_1h * 1.01) * 1.002).toFixed(2));
              const risk = Math.max(0.01, pbSl - pbEntry);
              pbTp = parseFloat((pbEntry - risk * 2).toFixed(2));
            }
          }

          let prob = 50;
          if (pullbackDetected) prob += 10;
          if (entryConfirmed) prob += 15;
          if (gammaConfl) prob += 5;
          if (!idd.volume_confirms_15m) prob += 5; // healthy pullback
          if (vixRegime === 'LOW' || vixRegime === 'MODERATE') prob += 3;
          if (vixRegime === 'EXTREME') prob -= 10;

          const pullbackBlockedReason = !hasTrend
            ? 'Bloqueado: no hay tendencia clara EMA20/EMA50 en 1H.'
            : pullbackProjected
              ? 'Setup proyectado: esperar pullback 1H + trigger 15m para activación.'
            : !pullbackDetected
              ? 'Bloqueado: precio fuera de zona de pullback 1H (EMA20/EMA50).'
              : !entryConfirmed
                ? 'Bloqueado: falta vela fuerte de confirmación en 15m.'
                : null;

          result.strategies.pullback_trend = {
            detected: pullbackDetected,
            trend_direction: isBullTrend ? 'BULLISH' : isBearTrend ? 'BEARISH' : 'NEUTRAL',
            trend_tf: '1H',
            pullback_level: ema20_1h ? parseFloat(ema20_1h.toFixed(2)) : null,
            pullback_level_type: pullbackType || 'N/A',
            ema_trend_4h: hasTrend
              ? `1H: EMA20=${ema20_1h?.toFixed(2)} ${isBullTrend ? '>' : '<'} EMA50=${ema50_1h?.toFixed(2)} → tendencia ${trendByEma}.`
              : 'Sin tendencia clara en 1H.',
            pullback_1h: pullbackDetected
              ? `Precio retrocedió a ${pullbackType}. EMA20(1H)=${ema20_1h?.toFixed(2)}.`
              : `Precio no está en zona de pullback en 1H. Distancia a EMA20(1H): ${ema20_1h ? ((Math.abs(price1h - ema20_1h) / price1h * 100).toFixed(2) + '%') : 'N/A'}.`,
            entry_trigger_15m: entryConfirmed
              ? `Vela fuerte ${isBullTrend ? 'alcista' : 'bajista'} detectada en 15min → ENTRADA CONFIRMADA.`
              : pullbackDetected
                ? `Esperando vela fuerte ${isBullTrend ? 'alcista' : 'bajista'} en 15min para confirmar entrada.`
                : 'Sin señal de entrada — no hay pullback activo.',
            volume_on_pullback: volOnPullback,
            gamma_confluence: gammaConfl,
            vix_regime: vixRegime,
            breakeven_rule: breakevenRule || 'N/A — sin trade activo.',
            direction: (pullbackDetected || pullbackProjected) ? (isBullTrend ? 'CALL' : 'PUT') : 'NEUTRAL',
            entry: (pullbackDetected || pullbackProjected) ? (pbEntry ?? null) : null,
            sl: (pullbackDetected || pullbackProjected) ? (pbSl ?? null) : null,
            tp: (pullbackDetected || pullbackProjected) ? (pbTp ?? null) : null,
            trade_ready: !!entryConfirmed,
            projected_levels: pullbackProjected,
            blocked_reason: pullbackBlockedReason,
            success_prob: Math.min(92, Math.max(30, prob)),
            debug: {
              has_trend: hasTrend,
              trend_ema_1h: trendByEma,
              pullback_margin: pullbackMargin,
              dist_to_ema20_1h_pct: distToEma20_1h != null ? Number((distToEma20_1h * 100).toFixed(3)) : null,
              near_ema20: nearEma20,
              touched_ema20_recently: touchedEma20Recently,
              strong_bull_candle_15m: strongBullCandle,
              strong_bear_candle_15m: strongBearCandle,
              entry_confirmed: entryConfirmed,
              gamma_confluence: gammaConfl,
              volume_confirms_15m: !!idd.volume_confirms_15m,
              vix_regime: vixRegime || 'N/A',
            },
            summary: entryConfirmed
              ? `Tendencia ${trendByEma} por EMA20/EMA50 en 1H. Pullback a ${pullbackType}. Vela fuerte ${isBullTrend ? 'alcista' : 'bajista'} confirma entrada ${isBullTrend ? 'CALL' : 'PUT'} a $${pbEntry}. SL=$${pbSl}, TP=$${pbTp} (R:R 1:2).${gammaConfl ? ' Gamma favorable.' : ''}${vixRegime === 'EXTREME' ? ' ⚠️ VIX extremo.' : ''}`
              : pullbackDetected
                ? `Tendencia ${trendByEma} por EMA20/EMA50 en 1H. Pullback detectado a ${pullbackType} — esperando vela fuerte de confirmación.`
                : hasTrend
                  ? `Tendencia ${trendByEma} activa pero sin pullback en EMA20 — esperar toque de EMA20.`
                  : 'Tendencia lateral por EMA20/EMA50 — estrategia no aplica.',
          };
        }

        // ─── STRATEGY 2: BREAKOUT ───────────────────────────────
        // Zona clave en 1H, entrada en 15min, precisión 5m-1m
        {
          const sr = idd.sr_1h || { supports: [], resistances: [] };
          const candles15 = idd.candles_15m || [];
          const lastCandle15 = candles15[candles15.length - 1];
          const prevCandle15 = candles15[candles15.length - 2];

          let breakoutDetected = false;
          let breakoutLevel = null;
          let breakoutType = '';
          let isBullBreak = false;
          let secondConfirms = false;
          let volOnBreakout = false;
          let falseBreakoutFilter = false;
          let breakoutIndex = -1;
          let breakoutProjected = false;

          // Check recent 15m candles (not only latest pair) for breakout in the last ~2.5h
          if (candles15.length >= 2) {
            for (let i = 1; i < candles15.length; i++) {
              const prev = candles15[i - 1];
              const curr = candles15[i];

              for (const r of sr.resistances) {
                if ((prev.close <= r.level && curr.close > r.level) || (curr.high > r.level && curr.close >= r.level * 0.999)) {
                  breakoutDetected = true;
                  breakoutIndex = i;
                  breakoutLevel = r.level;
                  breakoutType = `Resistencia 1H ($${r.level}) — ${r.touches} toques`;
                  isBullBreak = true;
                  break;
                }
              }
              if (breakoutDetected) break;

              for (const s of sr.supports) {
                if ((prev.close >= s.level && curr.close < s.level) || (curr.low < s.level && curr.close <= s.level * 1.001)) {
                  breakoutDetected = true;
                  breakoutIndex = i;
                  breakoutLevel = s.level;
                  breakoutType = `Soporte 1H ($${s.level}) — ${s.touches} toques`;
                  isBullBreak = false;
                  break;
                }
              }
              if (breakoutDetected) break;
            }

            if (breakoutDetected && breakoutIndex > 0) {
              const breakoutCandle = candles15[breakoutIndex];
              const beforeBreak = candles15[breakoutIndex - 1];
              const confirmCandle = candles15[breakoutIndex + 1] || candles15[candles15.length - 1];
              const latestCandle = candles15[candles15.length - 1];

              if (breakoutCandle?.volume && beforeBreak?.volume) {
                volOnBreakout = breakoutCandle.volume > beforeBreak.volume * 1.15;
              }

              if (confirmCandle && breakoutCandle) {
                secondConfirms = isBullBreak
                  ? (confirmCandle.close >= breakoutCandle.close || confirmCandle.close >= breakoutLevel)
                  : (confirmCandle.close <= breakoutCandle.close || confirmCandle.close <= breakoutLevel);
              }

              if (breakoutLevel) {
                const candleBody = Math.abs(breakoutCandle.close - breakoutCandle.open);
                const candleRange = breakoutCandle.high - breakoutCandle.low;
                if (candleRange > 0 && candleBody / candleRange < 0.25) falseBreakoutFilter = true;
                if (isBullBreak && latestCandle?.close < breakoutLevel * 0.998) falseBreakoutFilter = true;
                if (!isBullBreak && latestCandle?.close > breakoutLevel * 1.002) falseBreakoutFilter = true;
              }
            }
          }

          // Also check gamma walls as key levels
          if (!breakoutDetected && gammaData && lastCandle15 && prevCandle15) {
            if (gammaData.call_wall && ((prevCandle15.close <= gammaData.call_wall && lastCandle15.close > gammaData.call_wall) || (lastCandle15.high > gammaData.call_wall && lastCandle15.close >= gammaData.call_wall * 0.999))) {
              breakoutDetected = true;
              breakoutLevel = gammaData.call_wall;
              breakoutType = `Call Wall ($${gammaData.call_wall})`;
              isBullBreak = true;
              volOnBreakout = lastCandle15.volume > (prevCandle15.volume * 1.15);
            } else if (gammaData.put_wall && ((prevCandle15.close >= gammaData.put_wall && lastCandle15.close < gammaData.put_wall) || (lastCandle15.low < gammaData.put_wall && lastCandle15.close <= gammaData.put_wall * 1.001))) {
              breakoutDetected = true;
              breakoutLevel = gammaData.put_wall;
              breakoutType = `Put Wall ($${gammaData.put_wall})`;
              isBullBreak = false;
              volOnBreakout = lastCandle15.volume > (prevCandle15.volume * 1.15);
            }
          }

          if (!breakoutDetected && lpPrice) {
            const above = (sr.resistances || []).filter(r => r.level > lpPrice).sort((a, b) => a.level - b.level)[0] || null;
            const below = (sr.supports || []).filter(s => s.level < lpPrice).sort((a, b) => b.level - a.level)[0] || null;
            const trendBias = idd.trend_15m || idd.trend_1h || idd.trend_4h;

            if (trendBias === 'BULLISH' && above) {
              breakoutProjected = true;
              breakoutLevel = above.level;
              breakoutType = `Proyección resistencia 1H ($${above.level})`;
              isBullBreak = true;
            } else if (trendBias === 'BEARISH' && below) {
              breakoutProjected = true;
              breakoutLevel = below.level;
              breakoutType = `Proyección soporte 1H ($${below.level})`;
              isBullBreak = false;
            } else if (above || below) {
              const distUp = above ? Math.abs(above.level - lpPrice) : Infinity;
              const distDn = below ? Math.abs(lpPrice - below.level) : Infinity;
              breakoutProjected = true;
              if (distUp <= distDn) {
                breakoutLevel = above.level;
                breakoutType = `Proyección resistencia 1H ($${above.level})`;
                isBullBreak = true;
              } else {
                breakoutLevel = below.level;
                breakoutType = `Proyección soporte 1H ($${below.level})`;
                isBullBreak = false;
              }
            }
          }

          const validBreakout = breakoutDetected && volOnBreakout && !falseBreakoutFilter;

          const breakoutBlockedReason = breakoutProjected
            ? 'Setup proyectado: esperar ruptura efectiva y validación de volumen.'
            : !breakoutDetected
            ? 'Bloqueado: no hubo ruptura válida de nivel 1H.'
            : falseBreakoutFilter
              ? 'Bloqueado: filtro de falsa ruptura activo.'
              : !volOnBreakout
                ? 'Bloqueado: volumen insuficiente en la ruptura.'
                : !secondConfirms
                  ? 'Precaución: falta confirmación de segunda vela.'
                  : null;

          let bkEntry, bkSl, bkTp;
          if ((breakoutDetected || breakoutProjected) && breakoutLevel) {
            if (isBullBreak) {
              bkEntry = parseFloat((breakoutLevel * 1.001).toFixed(2));
              bkSl = parseFloat((breakoutLevel * 0.995).toFixed(2)); // below breakout level
              const risk = bkEntry - bkSl;
              bkTp = parseFloat((bkEntry + risk * 2).toFixed(2));
            } else {
              bkEntry = parseFloat((breakoutLevel * 0.999).toFixed(2));
              bkSl = parseFloat((breakoutLevel * 1.005).toFixed(2));
              const risk = bkSl - bkEntry;
              bkTp = parseFloat((bkEntry - risk * 2).toFixed(2));
            }
          }

          let bkProb = 45;
          if (breakoutDetected) bkProb += 10;
          if (volOnBreakout) bkProb += 12;
          if (secondConfirms) bkProb += 8;
          if (!falseBreakoutFilter) bkProb += 5;
          if (gammaData && breakoutLevel) {
            const gammaAlign = isBullBreak
              ? lpPrice < (gammaData.call_wall ?? Infinity)
              : lpPrice > (gammaData.put_wall ?? -Infinity);
            if (gammaAlign) bkProb += 5;
          }
          if (vixRegime === 'EXTREME') bkProb -= 10;

          result.strategies.breakout_retest = {
            detected: breakoutDetected,
            breakout_level: breakoutLevel,
            breakout_level_type: breakoutType || 'N/A',
            volume_on_breakout: volOnBreakout,
            second_candle_confirms: secondConfirms,
            retest_occurred: breakoutDetected && lpPrice && breakoutLevel
              ? Math.abs(lpPrice - breakoutLevel) / breakoutLevel < 0.003
              : false,
            retest_held: breakoutDetected && lpPrice && breakoutLevel
              ? (isBullBreak ? lpPrice >= breakoutLevel : lpPrice <= breakoutLevel)
              : false,
            false_breakout_filter: falseBreakoutFilter,
            gamma_confluence: gammaData && breakoutLevel ? (
              isBullBreak ? lpPrice < (gammaData.call_wall ?? Infinity)
                          : lpPrice > (gammaData.put_wall ?? -Infinity)
            ) : false,
            vix_regime: vixRegime,
            direction: (breakoutDetected || breakoutProjected) ? (isBullBreak ? 'CALL' : 'PUT') : 'NEUTRAL',
            entry: (breakoutDetected || breakoutProjected) ? (bkEntry ?? null) : null,
            sl: (breakoutDetected || breakoutProjected) ? (bkSl ?? null) : null,
            tp: (breakoutDetected || breakoutProjected) ? (bkTp ?? null) : null,
            trade_ready: !!validBreakout,
            projected_levels: breakoutProjected,
            blocked_reason: breakoutBlockedReason,
            success_prob: Math.min(90, Math.max(30, bkProb)),
            debug: {
              candles_15m_scanned: candles15.length,
              breakout_detected: breakoutDetected,
              breakout_index: breakoutIndex,
              breakout_level: breakoutLevel,
              is_bull_break: isBullBreak,
              volume_on_breakout: volOnBreakout,
              second_candle_confirms: secondConfirms,
              false_breakout_filter: falseBreakoutFilter,
              valid_breakout: validBreakout,
              retest_occurred: breakoutDetected && lpPrice && breakoutLevel
                ? Math.abs(lpPrice - breakoutLevel) / breakoutLevel < 0.003
                : false,
              retest_held: breakoutDetected && lpPrice && breakoutLevel
                ? (isBullBreak ? lpPrice >= breakoutLevel : lpPrice <= breakoutLevel)
                : false,
              gamma_confluence: gammaData && breakoutLevel ? (
                isBullBreak ? lpPrice < (gammaData.call_wall ?? Infinity)
                            : lpPrice > (gammaData.put_wall ?? -Infinity)
              ) : false,
              vix_regime: vixRegime || 'N/A',
            },
            summary: falseBreakoutFilter
              ? `⚠️ Ruptura de ${breakoutType} detectada pero filtro de falsa ruptura activo — ${!volOnBreakout ? 'sin volumen' : 'precio retrocedió'}. NO entrar.`
              : validBreakout
                ? `Breakout ${isBullBreak ? 'alcista' : 'bajista'} de ${breakoutType}. Volumen confirma.${secondConfirms ? ' Segunda vela confirma.' : ''} Entry=$${bkEntry}, SL=$${bkSl}, TP=$${bkTp} (R:R 1:2).`
                : breakoutDetected
                  ? `Ruptura de ${breakoutType} detectada pero ${!volOnBreakout ? 'SIN volumen de confirmación' : 'esperando segunda vela'}. Monitorear.`
                  : 'No se detecta breakout de nivel clave en 1H.',
          };
        }

        // ─── STRATEGY 3: LIQUIDITY SWEEP ────────────────────────
        // Detectar liquidez en 1H-4H, sweep en 15min, entrada en 5min
        {
          const liqZones = [...(idd.liquidity_zones_1h?.equal_highs || []).map(l => ({ level: l, type: 'EQUAL_HIGHS' })),
                           ...(idd.liquidity_zones_1h?.equal_lows || []).map(l => ({ level: l, type: 'EQUAL_LOWS' })),
                           ...(idd.liquidity_zones_4h?.equal_highs || []).map(l => ({ level: l, type: 'EQUAL_HIGHS_4H' })),
                           ...(idd.liquidity_zones_4h?.equal_lows || []).map(l => ({ level: l, type: 'EQUAL_LOWS_4H' }))];

          const candles15 = idd.candles_15m || [];
          let sweepDetected = false;
          let sweptZone = null;
          let sweepType = '';  // SWEEP_HIGH or SWEEP_LOW
          let wickRejection = false;
          let structureShift = false;
          let sweepCandle = null;
          let sweepProjected = false;

          // Check if recent 15m candles (last ~2h) swept liquidity and returned
          if (candles15.length >= 3) {
            const recent = candles15.slice(-8);
            for (const zone of liqZones) {
              // Sweep HIGH: price broke above level then closed back below
              if (zone.type.includes('HIGHS')) {
                for (let i = 0; i < recent.length; i++) {
                  const c = recent[i];
                  if (c.high > zone.level && c.close < zone.level) {
                    sweepDetected = true;
                    sweptZone = zone;
                    sweepCandle = c;
                    sweepType = 'SWEEP_HIGH';
                    wickRejection = (c.high - c.close) > (c.close - c.low) * 1.5;
                    break;
                  }
                }
              }
              // Sweep LOW: price broke below level then closed back above
              if (!sweepDetected && zone.type.includes('LOWS')) {
                for (let i = 0; i < recent.length; i++) {
                  const c = recent[i];
                  if (c.low < zone.level && c.close > zone.level) {
                    sweepDetected = true;
                    sweptZone = zone;
                    sweepCandle = c;
                    sweepType = 'SWEEP_LOW';
                    wickRejection = (c.close - c.low) > (c.high - c.close) * 1.5;
                    break;
                  }
                }
              }
              if (sweepDetected) break;
            }
          }

          if (!sweepDetected && liqZones.length && lpPrice) {
            const highs = liqZones.filter(z => z.type.includes('HIGHS')).sort((a, b) => a.level - b.level);
            const lows = liqZones.filter(z => z.type.includes('LOWS')).sort((a, b) => b.level - a.level);
            const nearestHigh = highs.find(z => z.level > lpPrice) || highs[0] || null;
            const nearestLow = lows.find(z => z.level < lpPrice) || lows[0] || null;
            const trendBias = idd.trend_15m || idd.trend_1h || idd.trend_4h;

            if (trendBias === 'BULLISH' && nearestLow) {
              sweepProjected = true;
              sweptZone = nearestLow;
              sweepType = 'SWEEP_LOW';
            } else if (trendBias === 'BEARISH' && nearestHigh) {
              sweepProjected = true;
              sweptZone = nearestHigh;
              sweepType = 'SWEEP_HIGH';
            } else if (nearestHigh || nearestLow) {
              const distHigh = nearestHigh ? Math.abs(nearestHigh.level - lpPrice) : Infinity;
              const distLow = nearestLow ? Math.abs(lpPrice - nearestLow.level) : Infinity;
              sweepProjected = true;
              if (distLow <= distHigh && nearestLow) {
                sweptZone = nearestLow;
                sweepType = 'SWEEP_LOW';
              } else if (nearestHigh) {
                sweptZone = nearestHigh;
                sweepType = 'SWEEP_HIGH';
              }
            }
          }

          // Structure shift confirmation: accept BOS or engulfing aligned after sweep
          if (sweepDetected && candles15.length >= 2) {
            const lastC = candles15[candles15.length - 1];
            const prevC = candles15[candles15.length - 2];
            if (sweepType === 'SWEEP_HIGH') {
              const bearishBos = lastC.close < prevC.low;
              const bearishFollowThrough = sweptZone ? lastC.close < sweptZone.level * 0.999 : false;
              const bearishEngulf = idd.engulfing_15m === 'BEARISH_ENGULFING';
              structureShift = bearishBos || bearishFollowThrough || bearishEngulf;
            } else {
              const bullishBos = lastC.close > prevC.high;
              const bullishFollowThrough = sweptZone ? lastC.close > sweptZone.level * 1.001 : false;
              const bullishEngulf = idd.engulfing_15m === 'BULLISH_ENGULFING';
              structureShift = bullishBos || bullishFollowThrough || bullishEngulf;
            }
          }

          // Direction: sweep HIGH + bearish shift = PUT. Sweep LOW + bullish shift = CALL
          const sweepDirection = (sweepDetected || sweepProjected)
            ? (sweepType === 'SWEEP_HIGH' ? 'PUT' : 'CALL')
            : 'NEUTRAL';

          // Gamma confluence
          const gammaConfl = gammaData && lpPrice ? (
            sweepType === 'SWEEP_HIGH'
              ? lpPrice < (gammaData.call_wall ?? Infinity) // price retreated from highs
              : lpPrice > (gammaData.put_wall ?? -Infinity)  // price bounced from lows
          ) : false;

          let swEntry, swSl, swTp;
          if ((sweepDetected || sweepProjected) && sweptZone) {
            if (sweepType === 'SWEEP_HIGH') {
              // PUT after sweep of highs
              swEntry = parseFloat((sweptZone.level * 0.999).toFixed(2));
              swSl = parseFloat((sweptZone.level * 1.005).toFixed(2)); // above the sweep
              const risk = swSl - swEntry;
              // TP at next liquidity zone below, or 2x risk
              const lowerZones = liqZones
                .filter(z => z.type.includes('LOWS') && z.level < swEntry)
                .sort((a, b) => b.level - a.level);
              const tpTarget = lowerZones[0]?.level ?? (swEntry - risk * 2);
              const naturalRR = (swEntry - tpTarget) / risk;
              swTp = naturalRR >= 2 ? parseFloat(tpTarget.toFixed(2)) : parseFloat((swEntry - risk * 2).toFixed(2));
            } else {
              // CALL after sweep of lows
              swEntry = parseFloat((sweptZone.level * 1.001).toFixed(2));
              swSl = parseFloat((sweptZone.level * 0.995).toFixed(2)); // below the sweep
              const risk = swEntry - swSl;
              const upperZones = liqZones
                .filter(z => z.type.includes('HIGHS') && z.level > swEntry)
                .sort((a, b) => a.level - b.level);
              const tpTarget = upperZones[0]?.level ?? (swEntry + risk * 2);
              const naturalRR = (tpTarget - swEntry) / risk;
              swTp = naturalRR >= 2 ? parseFloat(tpTarget.toFixed(2)) : parseFloat((swEntry + risk * 2).toFixed(2));
            }
          }

          const validSweep = sweepDetected && structureShift;

          const sweepBlockedReason = sweepProjected
            ? 'Setup proyectado: esperar barrida y confirmación de cambio de estructura.'
            : !sweepDetected
            ? 'Bloqueado: no se detectó sweep de liquidez reciente.'
            : !structureShift
              ? 'Bloqueado: sweep sin cambio de estructura confirmado.'
              : !wickRejection
                ? 'Precaución: sweep sin mecha de rechazo clara.'
                : null;

          let swProb = 40;
          if (sweepDetected) swProb += 10;
          if (wickRejection) swProb += 10;
          if (structureShift) swProb += 15;
          if (gammaConfl) swProb += 5;
          if (idd.volume_confirms_15m) swProb += 5;
          if (vixRegime === 'LOW' || vixRegime === 'MODERATE') swProb += 3;
          if (vixRegime === 'EXTREME') swProb -= 8;

          result.strategies.liquidity_sweep = {
            detected: sweepDetected,
            swept_level: sweptZone?.level ?? null,
            swept_level_type: sweptZone ? `${sweptZoneLabel(sweptZone.type)} ($${sweptZone.level})` : 'N/A',
            sweep_type: sweepType || null,
            direction: sweepDirection,
            entry: (sweepDetected || sweepProjected) ? (swEntry ?? null) : null,
            sl: (sweepDetected || sweepProjected) ? (swSl ?? null) : null,
            tp: (sweepDetected || sweepProjected) ? (swTp ?? null) : null,
            trade_ready: !!validSweep,
            projected_levels: sweepProjected,
            blocked_reason: sweepBlockedReason,
            success_prob: Math.min(90, Math.max(30, swProb)),
            volume_confirms: idd.volume_confirms_15m || false,
            wick_rejection: wickRejection,
            structure_shift: structureShift,
            gamma_confluence: gammaConfl,
            vix_regime: vixRegime,
            timeframe_detected: sweptZone?.type?.includes('4H') ? '4H' : '1H',
            debug: {
              liquidity_zones_count: liqZones.length,
              candles_15m_scanned: candles15.length,
              sweep_detected: sweepDetected,
              sweep_type: sweepType || 'NONE',
              swept_zone_type: sweptZone?.type || 'N/A',
              swept_zone_level: sweptZone?.level ?? null,
              sweep_candle_close: sweepCandle?.close ?? null,
              wick_rejection: wickRejection,
              structure_shift: structureShift,
              valid_sweep: validSweep,
              gamma_confluence: gammaConfl,
              volume_confirms_15m: !!idd.volume_confirms_15m,
              vix_regime: vixRegime || 'N/A',
            },
            summary: validSweep
              ? `Liquidity sweep ${sweepType === 'SWEEP_HIGH' ? 'de máximos' : 'de mínimos'} en $${sweptZone.level}. ${wickRejection ? 'Mecha de rechazo confirmada.' : ''} Cambio de estructura ${sweepType === 'SWEEP_HIGH' ? 'bajista' : 'alcista'} → ${sweepDirection}. Entry=$${swEntry}, SL=$${swSl}, TP=$${swTp}.`
              : sweepDetected
                ? `Sweep detectado en $${sweptZone?.level} pero ${!structureShift ? 'SIN cambio de estructura — esperando confirmación' : ''}${!wickRejection ? '. Sin mecha de rechazo clara.' : '.'}`
                : 'No se detectan sweeps de liquidez activos.',
          };
        }

        // ─── STRATEGY 4: FIXED RANGE VOLUME PROFILE ─────────────
        // POC/VAH/VAL + reversión de valor / fake breakout trap / breakout real
        {
          const candles15vp = Array.isArray(idd.candles_15m) ? idd.candles_15m.filter(c => c?.high != null && c?.low != null && c?.close != null) : [];
          const last = candles15vp[candles15vp.length - 1] || null;
          const prev = candles15vp[candles15vp.length - 2] || null;

          const calcATR = (candles, period = 14) => {
            if (!Array.isArray(candles) || candles.length < 3) return null;
            const trs = [];
            for (let i = 1; i < candles.length; i++) {
              const h = Number(candles[i].high);
              const l = Number(candles[i].low);
              const pc = Number(candles[i - 1].close);
              if (![h, l, pc].every(Number.isFinite)) continue;
              const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
              if (Number.isFinite(tr)) trs.push(tr);
            }
            if (!trs.length) return null;
            const span = trs.slice(-Math.min(period, trs.length));
            return span.reduce((a, b) => a + b, 0) / span.length;
          };

          const detectRange = (candles, priceRef) => {
            if (!candles.length || !priceRef) return null;
            const n = candles.length;
            const windows = [120, 100, 80, 60, 50].filter(w => w <= n && w >= 50);
            for (const w of windows) {
              const slice = candles.slice(-w);
              const highs = slice.map(c => c.high);
              const lows = slice.map(c => c.low);
              const hi = Math.max(...highs);
              const lo = Math.min(...lows);
              const pct = (hi - lo) / priceRef;
              if (pct <= 0.04) {
                return { candles: slice, range_high: hi, range_low: lo, range_size_pct: pct, bars: w, source: 'consolidation' };
              }
            }
            const fallback = candles.slice(-Math.min(80, n));
            const fHi = Math.max(...fallback.map(c => c.high));
            const fLo = Math.min(...fallback.map(c => c.low));
            return {
              candles: fallback,
              range_high: fHi,
              range_low: fLo,
              range_size_pct: priceRef ? (fHi - fLo) / priceRef : null,
              bars: fallback.length,
              source: 'fallback_window',
            };
          };

          const buildVolumeProfile = (candles, low, high, bins = 24) => {
            if (!candles.length || !Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
            const step = (high - low) / bins;
            if (!Number.isFinite(step) || step <= 0) return null;

            const volBins = Array.from({ length: bins }, () => 0);
            for (const c of candles) {
              const tp = (c.high + c.low + c.close) / 3;
              const volume = Number(c.volume) > 0 ? Number(c.volume) : 1;
              const idx = Math.max(0, Math.min(bins - 1, Math.floor((tp - low) / step)));
              volBins[idx] += volume;
            }

            const totalVol = volBins.reduce((a, b) => a + b, 0);
            if (totalVol <= 0) return null;

            let pocIdx = 0;
            for (let i = 1; i < volBins.length; i++) {
              if (volBins[i] > volBins[pocIdx]) pocIdx = i;
            }

            const included = new Set([pocIdx]);
            let accVol = volBins[pocIdx];
            let up = pocIdx + 1;
            let down = pocIdx - 1;
            while ((accVol / totalVol) < 0.7 && (down >= 0 || up < bins)) {
              const upVol = up < bins ? volBins[up] : -1;
              const downVol = down >= 0 ? volBins[down] : -1;
              if (upVol >= downVol) {
                if (up < bins) {
                  included.add(up);
                  accVol += volBins[up];
                  up += 1;
                } else if (down >= 0) {
                  included.add(down);
                  accVol += volBins[down];
                  down -= 1;
                }
              } else if (down >= 0) {
                included.add(down);
                accVol += volBins[down];
                down -= 1;
              }
            }

            const indexes = Array.from(included).sort((a, b) => a - b);
            const minIdx = indexes[0];
            const maxIdx = indexes[indexes.length - 1];
            const poc = low + (pocIdx + 0.5) * step;
            const val = low + minIdx * step;
            const vah = low + (maxIdx + 1) * step;

            return {
              poc,
              vah,
              val,
              bins,
              total_volume: totalVol,
              value_area_pct: (accVol / totalVol) * 100,
            };
          };

          const atr = calcATR(candles15vp, 14) || (lpPrice * 0.0045);
          const avgVol15 = candles15vp.length > 20
            ? candles15vp.slice(-21, -1).reduce((a, c) => a + (Number(c.volume) || 0), 0) / 20
            : null;
          const lastVol15 = Number(last?.volume) || 0;
          const volumeImpulse = avgVol15 ? lastVol15 > avgVol15 * 1.25 : !!idd.volume_confirms_15m;

          const rangeInfo = detectRange(candles15vp, lpPrice);
          const vp = rangeInfo
            ? buildVolumeProfile(rangeInfo.candles, rangeInfo.range_low, rangeInfo.range_high, 24)
            : null;

          let setupType = null;
          let direction = 'NEUTRAL';
          let validSetup = false;
          let entry = null;
          let sl = null;
          let tp = null;
          let blockedReason = null;

          const near = Math.max((atr || 0) * 0.25, lpPrice * 0.0015);
          const bodyPct = last && (last.high - last.low) > 0
            ? Math.abs(last.close - last.open) / (last.high - last.low)
            : 0;

          const spxDir = result.scalp?.spx_direction || 'NEUTRAL';
          const nqDir = result.scalp?.nq_direction || 'NEUTRAL';
          const ndxDir = result.scalp?.nasdaq100_direction || 'NEUTRAL';
          const bullishIdx = [spxDir, nqDir, ndxDir].filter(d => d === 'BULLISH').length;
          const bearishIdx = [spxDir, nqDir, ndxDir].filter(d => d === 'BEARISH').length;
          const indexConfluence = Math.max(bullishIdx, bearishIdx);
          const spxBullish = spxDir === 'BULLISH';
          const spxBearish = spxDir === 'BEARISH';
          const newsBlocked = Array.isArray(result.no_trade?.alerts)
            ? result.no_trade.alerts.some(a => a?.type === 'news' && a?.severity === 'HIGH')
            : false;
          const vixExtreme = vixRegime === 'EXTREME';

          if (vp && last) {
            const aboveVAH = last.close > vp.vah + near;
            const belowVAL = last.close < vp.val - near;

            const fakeUpTrap = !!prev &&
              prev.high > vp.vah + near &&
              prev.close < vp.vah &&
              last.close < vp.vah &&
              last.close < prev.low;

            const fakeDownTrap = !!prev &&
              prev.low < vp.val - near &&
              prev.close > vp.val &&
              last.close > vp.val &&
              last.close > prev.high;

            const reversionBull =
              last.low <= vp.poc + near &&
              last.close > vp.poc &&
              last.close > last.open;

            const reversionBear =
              last.high >= vp.poc - near &&
              last.close < vp.poc &&
              last.close < last.open;

            const breakoutBull = aboveVAH && volumeImpulse && bullishIdx >= 2 && !spxBearish;
            const breakoutBear = belowVAL && volumeImpulse && bearishIdx >= 2 && !spxBullish;

            if (fakeUpTrap || fakeDownTrap) {
              setupType = 'fake_breakout_trap';
              direction = fakeUpTrap ? 'PUT' : 'CALL';
              entry = parseFloat(last.close.toFixed(2));
              if (direction === 'PUT') {
                sl = parseFloat(Math.max(prev?.high ?? (vp.vah + atr * 0.5), vp.vah + atr * 0.35).toFixed(2));
                tp = parseFloat((vp.val + atr * 0.15).toFixed(2));
              } else {
                sl = parseFloat(Math.min(prev?.low ?? (vp.val - atr * 0.5), vp.val - atr * 0.35).toFixed(2));
                tp = parseFloat((vp.vah - atr * 0.15).toFixed(2));
              }
              validSetup = bodyPct >= 0.4;
              if (!validSetup) blockedReason = 'Bloqueado: trampa detectada sin vela de rechazo contundente.';
            } else if (breakoutBull || breakoutBear) {
              setupType = 'real_breakout_continuation';
              direction = breakoutBull ? 'CALL' : 'PUT';
              if (direction === 'CALL') {
                entry = parseFloat((Math.max(last.close, vp.vah + atr * 0.1)).toFixed(2));
                sl = parseFloat((vp.poc - atr * 0.2).toFixed(2));
              } else {
                entry = parseFloat((Math.min(last.close, vp.val - atr * 0.1)).toFixed(2));
                sl = parseFloat((vp.poc + atr * 0.2).toFixed(2));
              }
              const risk = Math.max(0.01, Math.abs(entry - sl));
              tp = parseFloat((direction === 'CALL' ? entry + (risk * 2.1) : entry - (risk * 2.1)).toFixed(2));
              validSetup = true;
            } else if (reversionBull || reversionBear) {
              setupType = 'value_reversion';
              direction = reversionBull ? 'CALL' : 'PUT';
              entry = parseFloat(vp.poc.toFixed(2));
              if (direction === 'CALL') {
                sl = parseFloat(Math.min(vp.val - atr * 0.2, entry - atr * 0.9).toFixed(2));
                tp = parseFloat((vp.vah - atr * 0.15).toFixed(2));
                validSetup = bullishIdx >= 1 && !spxBearish;
              } else {
                sl = parseFloat(Math.max(vp.vah + atr * 0.2, entry + atr * 0.9).toFixed(2));
                tp = parseFloat((vp.val + atr * 0.15).toFixed(2));
                validSetup = bearishIdx >= 1 && !spxBullish;
              }
              if (!validSetup) blockedReason = 'Bloqueado: reversión en valor sin respaldo de índices.';
            }
          }

          if (validSetup && (newsBlocked || vixExtreme)) {
            validSetup = false;
            blockedReason = newsBlocked
              ? 'Bloqueado: noticia de alto impacto activa (No-Trade).'
              : 'Bloqueado: VIX extremo para esta estrategia.';
          }

          let vpProb = 42;
          if (setupType === 'value_reversion') vpProb = 56;
          if (setupType === 'fake_breakout_trap') vpProb = 60;
          if (setupType === 'real_breakout_continuation') vpProb = 58;
          if (volumeImpulse) vpProb += 7;
          if (indexConfluence >= 2) vpProb += 8;
          if ((direction === 'CALL' && spxBullish) || (direction === 'PUT' && spxBearish)) vpProb += 5;
          if ((direction === 'CALL' && spxBearish) || (direction === 'PUT' && spxBullish)) vpProb -= 7;
          if (bodyPct >= 0.5) vpProb += 4;
          if (vixRegime === 'LOW' || vixRegime === 'MODERATE') vpProb += 3;
          if (vixRegime === 'HIGH') vpProb -= 4;
          if (vixExtreme) vpProb -= 10;
          if (newsBlocked) vpProb -= 12;

          result.strategies.volume_profile_reversion = {
            detected: !!setupType,
            setup_type: setupType,
            direction,
            trade_ready: !!validSetup,
            blocked_reason: blockedReason,
            entry: setupType ? entry : null,
            sl: setupType ? sl : null,
            tp: setupType ? tp : null,
            success_prob: Math.min(92, Math.max(28, vpProb)),
            poc: vp ? parseFloat(vp.poc.toFixed(2)) : null,
            vah: vp ? parseFloat(vp.vah.toFixed(2)) : null,
            val: vp ? parseFloat(vp.val.toFixed(2)) : null,
            atr_15m: atr ? parseFloat(atr.toFixed(2)) : null,
            volume_impulse: volumeImpulse,
            index_confluence: `${indexConfluence}/3`,
            range_bars: rangeInfo?.bars ?? null,
            range_source: rangeInfo?.source ?? null,
            range_high: rangeInfo ? parseFloat(rangeInfo.range_high.toFixed(2)) : null,
            range_low: rangeInfo ? parseFloat(rangeInfo.range_low.toFixed(2)) : null,
            vix_regime: vixRegime,
            debug: {
              candles_15m_available: candles15vp.length,
              range_source: rangeInfo?.source || 'none',
              range_bars: rangeInfo?.bars || 0,
              near_threshold: Number.isFinite(near) ? Number(near.toFixed(4)) : null,
              volume_impulse: !!volumeImpulse,
              avg_volume_15m: avgVol15 ? Number(avgVol15.toFixed(2)) : null,
              last_volume_15m: lastVol15,
              body_strength: Number(bodyPct.toFixed(3)),
              bullish_index_votes: bullishIdx,
              bearish_index_votes: bearishIdx,
              news_blocked: newsBlocked,
              vix_regime: vixRegime || 'N/A',
            },
            summary: !setupType
              ? 'Sin setup activo de Perfil de Volumen (POC/VAH/VAL). Esperar rechazo en valor, fake breakout o breakout real.'
              : setupType === 'value_reversion'
                ? `Reversión en valor detectada alrededor de POC=$${vp?.poc?.toFixed(2)} con VAH=$${vp?.vah?.toFixed(2)} y VAL=$${vp?.val?.toFixed(2)}. ${validSetup ? `Entrada $${entry}, SL $${sl}, TP $${tp}.` : 'Aún no cumple filtros de validación.'}`
                : setupType === 'fake_breakout_trap'
                  ? `Fake breakout trap detectado en ${direction === 'PUT' ? 'VAH' : 'VAL'} con rechazo y retorno al rango. ${validSetup ? `Entrada $${entry}, SL $${sl}, TP $${tp}.` : 'Falta calidad de vela/condiciones para activar trade.'}`
                  : `Breakout real con continuación fuera del value area (${direction}). ${validSetup ? `Entrada $${entry}, SL $${sl}, TP $${tp}.` : 'Detectado pero bloqueado por filtros de riesgo.'}`,
          };
        }
      }

      // ═══ DETERMINISTIC CONFLUENCE SCORING ═══
      // Verify and adjust LLM success_prob based on real data alignment
      // NEVER degrade signal to NEUTRAL — only adjust probability and add warnings
      const getIndexConfluenceMetrics = (section, tradeDir) => {
        const spxDir = section?.spx_direction ?? section?.spx_confirm;
        const nqfDir = section?.nq_direction ?? section?.nq_confirm;
        const ndxDir = section?.nasdaq100_direction ?? section?.nasdaq_confirm;
        const alignedCount = [spxDir, nqfDir, ndxDir].filter((d) => d === tradeDir).length;
        const oppositeCount = [spxDir, nqfDir, ndxDir].filter((d) => d && d !== 'NEUTRAL' && d !== tradeDir).length;
        const spxAligned = spxDir === tradeDir;
        const spxOpposite = !!spxDir && spxDir !== 'NEUTRAL' && spxDir !== tradeDir;
        const weightedOpposite = (spxOpposite ? 2 : 0)
          + (nqfDir && nqfDir !== 'NEUTRAL' && nqfDir !== tradeDir ? 1 : 0)
          + (ndxDir && ndxDir !== 'NEUTRAL' && ndxDir !== tradeDir ? 1 : 0);
        return { spxDir, nqfDir, ndxDir, alignedCount, oppositeCount, spxAligned, spxOpposite, weightedOpposite };
      };

      const scoreConfluence = (section, label) => {
        if (!section) return;

        // If LLM returned NEUTRAL, override with best directional guess from data
        if (section.signal === 'NEUTRAL' || !section.signal) {
          // Determine direction from available data
          const ema9 = section.ema9 ?? section.ema9_5min;
          const ema20 = section.ema20 ?? section.ema20_5min;
          const ema50 = section.ema50 ?? section.ema50_5min;
          const priceRef = lpPrice || section.entry;

          let bullPoints = 0, bearPoints = 0;

          // EMAs direction
          if (ema9 && ema20) {
            if (ema9 > ema20) bullPoints += 2; else bearPoints += 2;
          }
          if (priceRef && ema20) {
            if (priceRef > ema20) bullPoints++; else bearPoints++;
          }

          // Index direction
          const spxDir = section.spx_direction ?? section.spx_confirm;
          const nqfDir = section.nq_direction ?? section.nq_confirm;
          const ndxDir = section.nasdaq100_direction ?? section.nasdaq_confirm;
          if (spxDir === 'BULLISH') bullPoints += 2; else if (spxDir === 'BEARISH') bearPoints += 2;
          if (nqfDir === 'BULLISH') bullPoints++; else if (nqfDir === 'BEARISH') bearPoints++;
          if (ndxDir === 'BULLISH') bullPoints++; else if (ndxDir === 'BEARISH') bearPoints++;

          // Gap direction
          if (lpOpen && lpPrevClose) {
            if (lpOpen > lpPrevClose && priceRef && priceRef < lpOpen) bearPoints++; // gap up failing
            else if (lpOpen < lpPrevClose && priceRef && priceRef > lpOpen) bullPoints++; // gap down recovering
            else if (lpOpen > lpPrevClose) bullPoints++;
            else bearPoints++;
          }

          // BB signal
          const bb = section.bb_1m ?? section.bb_5m;
          if (bb?.signal === 'OVERSOLD' || bb?.signal === 'NEAR_LOWER') bullPoints++;
          if (bb?.signal === 'OVERBOUGHT' || bb?.signal === 'NEAR_UPPER') bearPoints++;

          section.signal = bearPoints > bullPoints ? 'PUT' : 'CALL';
          section._signal_recovered = true; // flag that we overrode NEUTRAL
        }

        const isBull = section.signal === 'CALL';
        const isScalp = String(label || '').toLowerCase() === 'scalp';
        const factors = [];

        let score = 0;
        let contextScore = 0;
        let qualityScore = 0;

        // 1. EMA alignment
        const ema9 = section.ema9 ?? section.ema9_5min;
        const ema20 = section.ema20 ?? section.ema20_5min;
        const ema50 = section.ema50 ?? section.ema50_5min;
        const tradeDir = isBull ? 'BULLISH' : 'BEARISH';

        // 2. Index alignment
        const indexMetrics = getIndexConfluenceMetrics(section, tradeDir);
        const { spxDir, nqfDir, ndxDir: ndxDirMetrics } = indexMetrics;
        if (indexMetrics.spxAligned && indexMetrics.alignedCount >= 3) {
          score += isScalp ? 3.5 : 3;
          factors.push('SPX lider confirma + índices 3/3 alineados');
        } else if (indexMetrics.spxAligned && indexMetrics.alignedCount === 2) {
          score += isScalp ? 2.5 : 2.25;
          factors.push('SPX lider confirma + índices 2/3 alineados');
        } else if (indexMetrics.alignedCount >= 3) {
          score += 2.5;
          factors.push('Índices 3/3 alineados');
        } else if (indexMetrics.alignedCount === 2) {
          score += 1.25;
          factors.push('Índices 2/3 alineados');
        }
        if (indexMetrics.spxOpposite) {
          score -= isScalp ? 2 : 1.75;
          factors.push('SPX en contra de la dirección del trade');
        } else if (indexMetrics.weightedOpposite >= 2) {
          score -= 1;
          factors.push('Índices secundarios en contra');
        }

        // 3b. Pivot + S/R confluence
        if (section.entry && Number.isFinite(section.entry)) {
          if (dayPivot != null) {
            const abovePivot = section.entry >= dayPivot;
            if (isBull && abovePivot) { score += 1; factors.push('Confluencia pivot (CALL sobre PP) — peso alto'); }
            if (!isBull && !abovePivot) { score += 1; factors.push('Confluencia pivot (PUT bajo PP) — peso alto'); }
          }

          const supports = intradayData?.sr_1h?.supports || [];
          const resistances = intradayData?.sr_1h?.resistances || [];
          const entryPx = Number(section.entry);
          const near = (lvl) => Math.abs(entryPx - lvl) / entryPx < 0.004; // 0.4%
          const nearSupport = supports.some((s) => Number.isFinite(s?.level) && near(s.level));
          const nearResistance = resistances.some((r) => Number.isFinite(r?.level) && near(r.level));
          if (isBull && nearSupport) { score += 0.5; factors.push('Confluencia soporte 1H'); }
          if (!isBull && nearResistance) { score += 0.5; factors.push('Confluencia resistencia 1H'); }
          if (isBull && nearResistance) { score -= 0.5; factors.push('Entry CALL cerca de resistencia'); }
          if (!isBull && nearSupport) { score -= 0.5; factors.push('Entry PUT cerca de soporte'); }
        }

        // 4. VIX favorable
        const vixR = section.vix_regime;
        if (vixR === 'LOW' || vixR === 'MODERATE') { score++; factors.push('VIX favorable'); }
        else if (vixR === 'EXTREME') { score--; factors.push('VIX extremo'); }
        else if (vixR === 'HIGH') { factors.push('VIX alto (precaución)'); }

        // 5. BB confirmation
        const bb = section.bb_1m ?? section.bb_5m;
        if (bb) {
          const bbConfirm = (isBull && (bb.signal === 'OVERSOLD' || bb.signal === 'NEAR_LOWER')) ||
                            (!isBull && (bb.signal === 'OVERBOUGHT' || bb.signal === 'NEAR_UPPER'));
          if (bbConfirm) { score++; factors.push(`BB ${bb.signal}`); }
          if (bb.squeeze) { factors.push('BB SQUEEZE (precaución)'); }
        }

        // 6. Gamma position + directional alignment
        if (section.call_wall && section.put_wall && lpPrice) {
          const cw = section.call_wall, pw = section.put_wall;
          const nearCallWall = Math.abs(lpPrice - cw) / lpPrice < 0.003;
          const nearPutWall = Math.abs(lpPrice - pw) / lpPrice < 0.003;
          const gammaRange = cw - pw;
          const priceInRange = gammaRange > 0 ? (lpPrice - pw) / gammaRange : 0.5;

          if (isBull && nearCallWall) {
            score--; factors.push('Cerca de call_wall → resistencia magnética (freno CALL)');
          } else if (!isBull && nearPutWall) {
            score--; factors.push('Cerca de put_wall → soporte magnético (freno PUT)');
          } else if (isBull && lpPrice > cw) {
            score++; factors.push('Sobre call_wall → aceleración alcista');
          } else if (!isBull && lpPrice < pw) {
            score++; factors.push('Bajo put_wall → aceleración bajista');
          } else if (isBull && priceInRange < 0.4) {
            score++; factors.push(`Gamma favorable CALL (precio en zona baja ${(priceInRange * 100).toFixed(0)}%)`);
          } else if (!isBull && priceInRange > 0.6) {
            score++; factors.push(`Gamma favorable PUT (precio en zona alta ${(priceInRange * 100).toFixed(0)}%)`);
          } else {
            factors.push(`Gamma neutral (precio en ${(priceInRange * 100).toFixed(0)}% del rango)`);
          }
        }

        // 7. EMA bounce
        if (section.ema50_bounce && isBull) { score++; factors.push('EMA50 bounce'); }

        // 8. Fake breakout risk
        if (section.fake_breakout_risk === 'HIGH') { score--; factors.push('Alto riesgo fake breakout'); }

        // 9. ORB break direction alignment (multi-timeframe, deterministic)
        {
          const orbChecks = label.toLowerCase() === 'scalp'
            ? [['orb_5m_status', 'ORB 5m', 1], ['orb_15m_status', 'ORB 15m', 1.75]]
            : [['orb_30m_status', 'ORB 30m', 2.5], ['orb_1h_status', 'ORB 1h', 1.5]];
          for (const [field, name, weight] of orbChecks) {
            const st = section[field];
            if (!st) continue;
            const isDoubleBreak = st === 'DOUBLE_BREAK_UP' || st === 'DOUBLE_BREAK_DOWN';
            const qualityField = field === 'orb_15m_status'
              ? 'orb_15m_quality'
              : field === 'orb_30m_status'
                ? 'orb_30m_quality'
                : null;
            const consolidationField = field === 'orb_15m_status'
              ? 'orb_15m_likely_consolidation'
              : field === 'orb_30m_status'
                ? 'orb_30m_likely_consolidation'
                : null;
            const breakoutQuality = qualityField ? section[qualityField] : null;
            const likelyConsolidation = consolidationField ? !!section[consolidationField] : false;

            let effectiveWeight = weight;
            if (isDoubleBreak && (field === 'orb_15m_status' || field === 'orb_30m_status')) {
              if (breakoutQuality === 'CLEAN') {
                effectiveWeight = weight + (field === 'orb_30m_status' ? 1.5 : 1.0);
                factors.push(`${name} double break limpio (cuerpo+volumen) → mayor prioridad`);
              } else if (breakoutQuality === 'REJECTION' || likelyConsolidation) {
                effectiveWeight = Math.max(0.35, weight * 0.35);
                factors.push(`${name} double break con rechazo → menor peso, probable consolidación`);
              } else if (breakoutQuality === 'MIXED') {
                effectiveWeight = weight + (field === 'orb_30m_status' ? 0.6 : 0.35);
                factors.push(`${name} double break parcial → peso moderado`);
              }
            }
            if (isBull && (st === 'BREAK_UP' || st === 'DOUBLE_BREAK_UP')) {
              score += effectiveWeight; factors.push(`${name} breakout alcista ✓${name === 'ORB 30m' && isDoubleBreak ? ' (double break con peso extra)' : ''}`);
            } else if (!isBull && (st === 'BREAK_DOWN' || st === 'DOUBLE_BREAK_DOWN')) {
              score += effectiveWeight; factors.push(`${name} breakout bajista ✓${name === 'ORB 30m' && isDoubleBreak ? ' (double break con peso extra)' : ''}`);
            } else if (isBull && (st === 'BREAK_DOWN' || st === 'DOUBLE_BREAK_DOWN')) {
              score -= 0.5; factors.push(`${name} breakout en contra (bajista)`);
            } else if (!isBull && (st === 'BREAK_UP' || st === 'DOUBLE_BREAK_UP')) {
              score -= 0.5; factors.push(`${name} breakout en contra (alcista)`);
            } else if (st === 'FAILED_BREAK_UP') {
              if (!isBull) { score += 0.5; factors.push(`${name} failed break up → favorece PUT`); }
              else { score -= 0.5; factors.push(`${name} failed break up → peligro CALL`); }
            } else if (st === 'FAILED_BREAK_DOWN') {
              if (isBull) { score += 0.5; factors.push(`${name} failed break down → favorece CALL`); }
              else { score -= 0.5; factors.push(`${name} failed break down → peligro PUT`); }
            } else if (st === 'DOUBLE_BREAK_INSIDE') {
              factors.push(`${name} doble break (indecisión)`);
            } else if (st === 'CONSOLIDATING') {
              factors.push(`${name} consolidando`);
            }
          }
        }

        // ═══ CAPAS AVANZADAS SOLO PARA SCALP ═══
        if (isScalp) {
          const vp = result?.strategies?.volume_profile_reversion || null;
          const atr15 = Number(vp?.atr_15m) || (lpPrice ? lpPrice * 0.0045 : 0);
          const nearAtr = Math.max(atr15 * 0.2, (lpPrice || section.entry || 0) * 0.0015);
          const priceRef = Number(lpPrice || section.entry || 0);

          const gammaSupportNear = isBull
            ? !!(section.put_wall && priceRef && Math.abs(priceRef - section.put_wall) <= nearAtr * 1.5)
            : !!(section.call_wall && priceRef && Math.abs(priceRef - section.call_wall) <= nearAtr * 1.5);
          const oiSupport = gammaSupportNear || !!(section.gamma_level && priceRef && Math.abs(priceRef - section.gamma_level) <= nearAtr * 2);

          // CAPA 1: CONTEXTO
          if (spxDir === tradeDir) contextScore += 2;
          if (nqfDir === tradeDir) contextScore += 2;
          if (gammaSupportNear) contextScore += 2;
          if (oiSupport) contextScore += 1;

          if (contextScore >= 4) factors.push(`Capa Contexto: válida (${contextScore}/7)`);
          else factors.push(`Capa Contexto: NO TRADE (${contextScore}/7)`);

          // CAPA 2: ZONA
          const bb = section.bb_1m ?? section.bb_5m;
          const isLowerExtreme = bb?.signal === 'OVERSOLD' || bb?.signal === 'NEAR_LOWER';
          const isUpperExtreme = bb?.signal === 'OVERBOUGHT' || bb?.signal === 'NEAR_UPPER';
          const nearSMA = !!(priceRef && (Math.abs(priceRef - (ema20 ?? priceRef)) <= nearAtr * 1.5 || Math.abs(priceRef - (ema50 ?? priceRef)) <= nearAtr * 1.5));
          const farFromSMA = !!(priceRef && ema20 && ema50 && Math.abs(priceRef - ((ema20 + ema50) / 2)) > nearAtr * 2.2);
          const atVAL = !!(vp?.val && priceRef && Math.abs(priceRef - vp.val) <= nearAtr);
          const atVAH = !!(vp?.vah && priceRef && Math.abs(priceRef - vp.vah) <= nearAtr);
          const gammaResNear = !!(section.call_wall && priceRef && Math.abs(priceRef - section.call_wall) <= nearAtr * 1.5);
          const gammaSupNear = !!(section.put_wall && priceRef && Math.abs(priceRef - section.put_wall) <= nearAtr * 1.5);

          const buyZone = isBull && atVAL && isLowerExtreme && nearSMA && gammaSupNear;
          const sellZone = !isBull && atVAH && isUpperExtreme && farFromSMA && gammaResNear;
          const zoneValid = buyZone || sellZone;
          factors.push(zoneValid ? 'Capa Zona: setup en zona de alta probabilidad' : 'Capa Zona: sin zona premium (VAL/VAH+BB+SMA+Gamma)');

          // CAPA 3: TRIGGER
          const c1m = intradayData?.candles_1m || [];
          const lastC = c1m[c1m.length - 1] || null;
          const prevC = c1m[c1m.length - 2] || null;
          const body = lastC ? Math.abs(lastC.close - lastC.open) : 0;
          const upperWick = lastC ? Math.max(0, (lastC.high - Math.max(lastC.close, lastC.open))) : 0;
          const lowerWick = lastC ? Math.max(0, (Math.min(lastC.close, lastC.open) - lastC.low)) : 0;
          const rejectionCandle = !!lastC && (isBull ? (lowerWick > body * 2 && lastC.close > lastC.open) : (upperWick > body * 2 && lastC.close < lastC.open));

          const volumeConfirmation = section.volume_confirms === true || intradayData?.volume_confirms_15m === true;
          const microAligned3 = isBull ? section.tf_3min_pattern === 'BULLISH' : section.tf_3min_pattern === 'BEARISH';
          const microAligned2 = isBull ? section.tf_2min_confirm === 'BULLISH' : section.tf_2min_confirm === 'BEARISH';
          const continuation = !!(lastC && prevC && (isBull ? lastC.close > prevC.high : lastC.close < prevC.low));
          const microStructure = microAligned3 && microAligned2 && continuation;

          const fakeBreakTrap = vp?.setup_type === 'fake_breakout_trap' && vp?.direction === section.signal;
          const triggerValid = (rejectionCandle && volumeConfirmation) || microStructure || fakeBreakTrap;
          factors.push(triggerValid ? 'Capa Trigger: confirmación de timing válida' : 'Capa Trigger: sin confirmación de entrada (rejection/micro/fake breakout)');

          // FILTRO ANTI-PÉRDIDAS
          const c15 = intradayData?.candles_15m || [];
          const recent15 = c15.slice(-20);
          const hi15 = recent15.length ? Math.max(...recent15.map(c => Number(c.high) || -Infinity)) : null;
          const lo15 = recent15.length ? Math.min(...recent15.map(c => Number(c.low) || Infinity)) : null;
          const rangePct = hi15 != null && lo15 != null && priceRef ? (hi15 - lo15) / priceRef : null;

          const emaFlat = !!(ema9 && ema20 && ema50 && Math.abs(ema9 - ema20) / (priceRef || ema20) < 0.0015 && Math.abs(ema20 - ema50) / (priceRef || ema20) < 0.0025);
          const sidewaysExtreme = (rangePct != null && rangePct < 0.004) || emaFlat;
          const tinyRange = rangePct != null && rangePct < 0.0025;
          const noVolume = !volumeConfirmation;
          const contradiction = spxDir && nqfDir && spxDir !== 'NEUTRAL' && nqfDir !== 'NEUTRAL' && spxDir !== nqfDir;

          const antiLossReasons = [];
          if (sidewaysExtreme) antiLossReasons.push('mercado lateral extremo');
          if (tinyRange) antiLossReasons.push('rango demasiado pequeño');
          if (noVolume) antiLossReasons.push('sin volumen de confirmación');
          if (contradiction) antiLossReasons.push('contradicción SPX vs NQ');
          const antiLossBlocked = antiLossReasons.length > 0;

          // SISTEMA DE PUNTUACIÓN A+/B+/B/C
          const trendAligned = (section.tf_15min_trend === tradeDir) && (section.tf_5min_confirm === tradeDir);
          const spxNqConfirm = spxDir === tradeDir && nqfDir === tradeDir;
          const atValOrVah = isBull ? atVAL : atVAH;
          const bollingerExtreme = isBull ? isLowerExtreme : isUpperExtreme;

          if (trendAligned) qualityScore += 2;
          if (gammaSupportNear) qualityScore += 2;
          if (spxNqConfirm) qualityScore += 2;
          if (atValOrVah) qualityScore += 2;
          if (bollingerExtreme) qualityScore += 1;
          if (nearSMA) qualityScore += 1;
          if (rejectionCandle) qualityScore += 2;
          if (volumeConfirmation) qualityScore += 2;

          const orb15Aligned = isBull
            ? (section.orb_15m_status === 'BREAK_UP' || section.orb_15m_status === 'DOUBLE_BREAK_UP')
            : (section.orb_15m_status === 'BREAK_DOWN' || section.orb_15m_status === 'DOUBLE_BREAK_DOWN');
          const orb15Double = section.orb_15m_status === 'DOUBLE_BREAK_UP' || section.orb_15m_status === 'DOUBLE_BREAK_DOWN';
          if (orb15Aligned) {
            const orb15Quality = section.orb_15m_quality;
            const orb15Consolidating = !!section.orb_15m_likely_consolidation;
            let orb15Boost = orb15Double ? 2 : 1.5;
            if (orb15Double && orb15Quality === 'CLEAN') {
              orb15Boost = 2.5;
              factors.push('ORB 15m double break limpio → prioridad alta');
            } else if (orb15Double && (orb15Quality === 'REJECTION' || orb15Consolidating)) {
              orb15Boost = 0.5;
              factors.push('ORB 15m double break con rechazo → probable consolidación');
            } else {
              factors.push(`ORB 15m alineado → refuerzo de calidad ${orb15Double ? 'alto' : 'medio'}`);
            }
            qualityScore += orb15Boost;
          }

          const convictionScore =
            (qualityScore >= 8 ? 2 : qualityScore >= 7 ? 1 : 0) +
            (contextScore >= 4 ? 1 : 0) +
            (zoneValid ? 1 : 0) +
            (triggerValid ? 1 : 0) +
            (!antiLossBlocked ? 1 : 0);
          const highConviction = convictionScore >= highConvictionMinCfg && qualityScore >= 7;
          const setupGrade = qualityScore >= 11 ? 'A+' : qualityScore >= 9 ? 'B+' : qualityScore >= 8 ? 'B' : 'C';

          section.context_score = contextScore;
          section.conviction_score = convictionScore;
          section.zone_valid = zoneValid;
          section.trigger_valid = triggerValid;
          section.setup_grade = setupGrade;
          section.max_trades_per_session = 3;
          section.no_trade_recommended = !highConviction;
          section.intent_signals = [
            volumeConfirmation ? 'Velas con volumen' : null,
            rejectionCandle ? 'Rechazo claro en nivel' : null,
            fakeBreakTrap ? 'Fake breakout trap detectado' : null,
          ].filter(Boolean);

          if (!highConviction) {
            const reasons = [];
            if (contextScore < 4) reasons.push(`Contexto insuficiente (${contextScore}/7)`);
            if (!zoneValid) reasons.push('Zona no premium');
            if (!triggerValid) reasons.push('Trigger no confirmado');
            if (antiLossBlocked) reasons.push(`Filtro anti-pérdidas: ${antiLossReasons.join(', ')}`);
            if (setupGrade === 'C') reasons.push('Setup grado C');
            section.no_trade_reason = reasons.join(' | ');
            factors.push(`Clasificación: ${setupGrade} → alerta de entrada (${section.no_trade_reason})`);
          } else {
            section.no_trade_reason = null;
            factors.push(`Clasificación: ${setupGrade} → Trade permitido (máx 3 trades/sesión)`);
          }

          section.entry_tolerance_rule = `Entrada precisa: |precio - ${isBull ? 'VAL' : 'VAH'}| < ATR*0.2 (ATR15m=${atr15 ? atr15.toFixed(2) : 'N/A'})`;

          // Stop inteligente debajo/encima de liquidez real
          if (section.entry && section.signal && section.signal !== 'NEUTRAL') {
            const supports = intradayData?.sr_1h?.supports || [];
            const resistances = intradayData?.sr_1h?.resistances || [];
            const entryPx = Number(section.entry);
            if (isBull) {
              const nearestSupport = supports
                .map((s) => Number(s?.level))
                .filter((v) => Number.isFinite(v) && v < entryPx)
                .sort((a, b) => b - a)[0];
              const liquidityFloor = Number(section.put_wall) || nearestSupport;
              if (Number.isFinite(liquidityFloor)) {
                const smartSl = Number((Math.min(liquidityFloor, nearestSupport ?? liquidityFloor) - Math.max(0.01, atr15 * 0.15)).toFixed(2));
                if (!section.sl || smartSl < section.sl) section.sl = smartSl;
              }
            } else {
              const nearestResistance = resistances
                .map((r) => Number(r?.level))
                .filter((v) => Number.isFinite(v) && v > entryPx)
                .sort((a, b) => a - b)[0];
              const liquidityCeil = Number(section.call_wall) || nearestResistance;
              if (Number.isFinite(liquidityCeil)) {
                const smartSl = Number((Math.max(liquidityCeil, nearestResistance ?? liquidityCeil) + Math.max(0.01, atr15 * 0.15)).toFixed(2));
                if (!section.sl || smartSl > section.sl) section.sl = smartSl;
              }
            }
          }

          // Probabilidad por grado
          if (setupGrade === 'A+') {
            section.success_prob = Math.max(Number(section.success_prob || 82), 82);
            section.execution_tier = 'large';
          } else if (setupGrade === 'B+') {
            section.success_prob = Math.max(Math.min(Number(section.success_prob || 78), 84), 72);
            section.execution_tier = 'normal';
          } else if (setupGrade === 'B') {
            section.success_prob = Math.max(Math.min(Number(section.success_prob || 72), 75), 65);
            section.execution_tier = 'normal';
          } else {
            const baseProb = Number(section.success_prob || defensiveMinProbCfg);
            const defensiveProb = Math.min(baseProb, defensiveMaxProbCfg);
            section.success_prob = Math.max(defensiveProb, defensiveMinProbCfg);
            section.execution_tier = 'small';
          }

          if (!highConviction) {
            const baseProb = Number(section.success_prob || defensiveMinProbCfg);
            const defensiveProb = Math.min(baseProb, defensiveMaxProbCfg);
            section.success_prob = Math.max(defensiveProb, defensiveMinProbCfg);
            section.execution_tier = 'small';
            section.entry_alert = `Señal ${section.signal} emitida con alerta: ${section.no_trade_reason}. Contexto de mercado no ideal para esta estrategia; operar solo tamaño bajo y esperar confirmaciones adicionales.`;
            section.confluence_warning = `Scalp con alerta de calidad (setup ${setupGrade}). Mantener disciplina: máximo 3 trades por sesión y tamaño reducido.`;
          } else {
            section.entry_alert = null;
          }

          // Score visible será el de calidad solicitado (0-14)
          score = qualityScore;
        }

        // Store confluence data
        section.confluence_score = Math.round(score * 10) / 10;
        section.confluence_factors = factors;

        // Adjust success_prob based on confluence count — NEVER set to NEUTRAL
        if (!isScalp) {
          const orb30Aligned = isBull
            ? (section.orb_30m_status === 'BREAK_UP' || section.orb_30m_status === 'DOUBLE_BREAK_UP')
            : (section.orb_30m_status === 'BREAK_DOWN' || section.orb_30m_status === 'DOUBLE_BREAK_DOWN');
          const orb30Double = section.orb_30m_status === 'DOUBLE_BREAK_UP' || section.orb_30m_status === 'DOUBLE_BREAK_DOWN';
          if (orb30Aligned) {
            const orb30Quality = section.orb_30m_quality;
            const orb30Consolidating = !!section.orb_30m_likely_consolidation;
            const orb30ProbBoost = orb30Double
              ? (orb30Quality === 'CLEAN' ? 10 : (orb30Quality === 'REJECTION' || orb30Consolidating ? 1 : 6))
              : 4;
            section.success_prob = Math.min(92, Number(section.success_prob || 0) + orb30ProbBoost);
            factors.push(`ORB 30m alineado → +${orb30ProbBoost}% probabilidad`);
          }

          if (score >= 8) {
            if (section.success_prob < 80) section.success_prob = 80;
          } else if (score >= 6) {
            section.success_prob = Math.min(section.success_prob ?? 65, 80);
            if (section.success_prob < 55) section.success_prob = 55;
          } else if (score >= 4) {
            section.success_prob = Math.min(section.success_prob ?? 50, 65);
            if (section.success_prob < 40) section.success_prob = 40;
          } else if (score >= 2) {
            section.success_prob = Math.min(section.success_prob ?? 40, 55);
            if (section.success_prob < 30) section.success_prob = 30;
          } else {
            section.success_prob = Math.min(section.success_prob ?? 30, 45);
            if (section.success_prob < 20) section.success_prob = 20;
          }

          section.setup_grade = score >= 8 ? 'A+' : score >= 6 ? 'B+' : score >= 4 ? 'B' : 'C';
          section.execution_tier = score >= 8 ? 'large' : score >= 4 ? 'normal' : 'small';
          section.entry_alert = score < 6
            ? `Señal ${section.signal} emitida con alerta: no es setup A+ en ${label}. Falta mayor alineación de contexto, volumen o estructura.`
            : null;
        }

        // Add warning note if low confluences
        if (score < 4 && !section.confluence_warning) {
          section.confluence_warning = `${label}: ${score} confluencias — probabilidad ajustada. Operar con tamaño reducido.`;
        }

        // Validate R:R
        if (section.entry && section.sl && section.tp) {
          const risk = Math.abs(section.entry - section.sl);
          const reward = Math.abs(section.tp - section.entry);
          const rr = risk > 0 ? reward / risk : 0;
          section.calculated_rr = rr.toFixed(2);
          if (rr < 1.5) {
            section.rr_warning = `R:R ${rr.toFixed(2)} es inferior a 1:1.5 — considerar ajustar niveles`;
          }
        }
      };

      // ═══ DETERMINISTIC ORB STRATEGY FOR SCALP (5m/15m) ═══
      const applyOrbScalpStrategy = (scalpSection) => {
        if (!scalpSection || !intradayData || !lpPrice) return;

        if (scalpSection.no_trade_recommended) {
          scalpSection.orb_strategy_valid = false;
          scalpSection.orb_break_type = null;
          scalpSection.orb_strategy_reason = scalpSection.no_trade_reason || 'Setup bloqueado por reglas de calidad (Contexto/Zona/Trigger).';
          scalpSection.success_prob = Math.min(Number(scalpSection.success_prob || orbInvalidMaxProbCfg), orbInvalidMaxProbCfg);
          scalpSection.execution_tier = 'small';
          scalpSection.entry_alert = scalpSection.entry_alert || `ORB no apto para ejecución agresiva: ${scalpSection.orb_strategy_reason}.`;
          if (Array.isArray(scalpSection.confluence_factors)) {
            scalpSection.confluence_factors.push('ORB en modo alerta (setup no A+/B+/B)');
          }
          return;
        }

        const orb5 = intradayData.first_candle_5m;
        const orb15 = intradayData.first_candle_15m;
        const st5 = scalpSection.orb_5m_status;
        const st15 = scalpSection.orb_15m_status;

        const parseStatus = (st) => {
          if (st === 'BREAK_UP') return { mode: 'single', dir: 'CALL', cleanCandidate: true };
          if (st === 'BREAK_DOWN') return { mode: 'single', dir: 'PUT', cleanCandidate: true };
          if (st === 'DOUBLE_BREAK_UP') return { mode: 'double', dir: 'CALL', cleanCandidate: true };
          if (st === 'DOUBLE_BREAK_DOWN') return { mode: 'double', dir: 'PUT', cleanCandidate: true };
          if (st === 'FAILED_BREAK_UP' || st === 'FAILED_BREAK_DOWN' || st === 'DOUBLE_BREAK_INSIDE' || st === 'CONSOLIDATING') {
            return { mode: 'invalid', dir: null, cleanCandidate: false };
          }
          return null;
        };

        const candidates = [
          { tf: '5m', st: st5, orb: orb5 },
          { tf: '15m', st: st15, orb: orb15 },
        ].map((c) => ({ ...c, parsed: parseStatus(c.st) })).filter((c) => c.orb && c.parsed);

        if (candidates.length === 0) return;

        // Prefer 5m for execution; fallback 15m.
        const primary = candidates.find((c) => c.tf === '5m') || candidates[0];
        const { mode, dir } = primary.parsed;

        const spxDir = scalpSection.spx_direction;
        const nqDir = scalpSection.nq_direction;
        const ndxDir = scalpSection.nasdaq100_direction;
        const aligned = [spxDir, nqDir, ndxDir].filter((d) => d === (dir === 'CALL' ? 'BULLISH' : 'BEARISH')).length;
        const spxAligned = spxDir === (dir === 'CALL' ? 'BULLISH' : 'BEARISH');
        const spxOpposite = !!spxDir && spxDir !== 'NEUTRAL' && spxDir !== (dir === 'CALL' ? 'BULLISH' : 'BEARISH');
        const volumeOk = scalpSection.volume_confirms === true || intradayData.volume_confirms_15m === true;
        const vixReg = scalpSection.vix_regime || vd?.regime;
        const vixOk = vixReg === 'LOW' || vixReg === 'MODERATE' || (vixReg === 'HIGH' && aligned === 3);
        const primaryQuality = primary.tf === '15m' ? scalpSection.orb_15m_quality : null;
        const primaryLikelyConsolidation = primary.tf === '15m' ? !!scalpSection.orb_15m_likely_consolidation : false;
        const doubleBreakRejected = mode === 'double' && primary.tf === '15m' && (primaryQuality === 'REJECTION' || primaryLikelyConsolidation);
        const doubleBreakConfirmed = mode === 'double' && primary.tf === '15m' && primaryQuality === 'CLEAN';
        let cleanBreak = mode !== 'invalid' && volumeOk && aligned >= 2 && vixOk && !spxOpposite;
        if (doubleBreakRejected) cleanBreak = false;

        const high = Number(primary.orb.high || 0);
        const low = Number(primary.orb.low || 0);
        const mid = Number(((high + low) / 2).toFixed(2));
        const breakoutLevel = dir === 'CALL' ? high : low;
        const useRetest = dir === 'CALL' ? lpPrice >= breakoutLevel : lpPrice <= breakoutLevel;
        const entry = Number((useRetest ? breakoutLevel : mid).toFixed(2));

        if (!cleanBreak) {
          scalpSection.orb_strategy_valid = false;
          scalpSection.orb_break_type = mode;
          const qualityReason = doubleBreakRejected
            ? `doble rompimiento con rechazo (cuerpo/volumen no confirman), probable consolidación`
            : '';
          scalpSection.orb_strategy_reason = `ORB ${primary.tf} inválido para entrada: ${!volumeOk ? 'sin volumen de ruptura' : ''}${!volumeOk && aligned < 2 ? ', ' : ''}${aligned < 2 ? 'sin confluencia de índices (mínimo 2/3)' : ''}${spxOpposite ? `${(!volumeOk || aligned < 2) ? ', ' : ''}SPX va en contra del trade` : ''}${(volumeOk && aligned >= 2 && !vixOk) ? 'VIX no acompaña el setup' : ''}${qualityReason ? `${(volumeOk || aligned >= 2 || vixOk || spxOpposite) ? ', ' : ''}${qualityReason}` : ''}.`;
          scalpSection.success_prob = Math.min(Number(scalpSection.success_prob || orbInvalidMaxProbCfg), orbInvalidMaxProbCfg);
          scalpSection.execution_tier = 'small';
          scalpSection.summary = `Setup ORB ${primary.tf} invalidado por falta de calidad de ruptura (volumen/confluencia/VIX).`;
          scalpSection.entry_precision_note = `Evitar ejecución agresiva en ORB: ${scalpSection.orb_strategy_reason}`;
          scalpSection.entry_alert = `Señal ${scalpSection.signal} con alerta ORB: contexto de ruptura débil. Operar solo tamaño bajo o esperar nueva confirmación.`;
          if (Array.isArray(scalpSection.confluence_factors)) {
            scalpSection.confluence_factors.push('Estrategia ORB invalidada (sin calidad de ruptura)');
          }
          return;
        }

        // Valid ORB setup: enforce direction and levels from strategy.
        const sl = dir === 'CALL'
          ? Number((low * 0.999).toFixed(2))
          : Number((high * 1.001).toFixed(2));
        const risk = Math.max(0.01, Math.abs(entry - sl));
        const tp = dir === 'CALL'
          ? Number((entry + (risk * 2)).toFixed(2))
          : Number((entry - (risk * 2)).toFixed(2));

        scalpSection.orb_strategy_valid = true;
        scalpSection.orb_break_type = mode;
        scalpSection.signal = dir;
        scalpSection.entry = entry;
        scalpSection.sl = sl;
        scalpSection.tp = tp;
        scalpSection.key_level_type = mode === 'single'
          ? `ORB ${primary.tf} ruptura de un solo lado`
          : `ORB ${primary.tf} doble ruptura (${dir === 'CALL' ? 'último lado alcista' : 'último lado bajista'})`;
        scalpSection.key_level_price = breakoutLevel;
        scalpSection.entry_precision_note = `Estrategia ORB ${primary.tf}: ruptura ${mode === 'single' ? 'de un solo lado' : 'de ambos lados'} válida con volumen y confluencia (${aligned}/3 índices, SPX ${spxAligned ? 'confirmando' : 'neutral'}, VIX ${vixReg}). Entrada ${useRetest ? 'en retest del breakout' : 'al 50% del ORB'} en ${entry.toFixed(2)}.`;
        scalpSection.success_prob = Math.max(Number(scalpSection.success_prob || 50), mode === 'single' ? 70 : 72);
        if (spxAligned) {
          scalpSection.success_prob = Math.min(92, Number(scalpSection.success_prob || 0) + 4);
        }
        if (doubleBreakConfirmed) {
          scalpSection.success_prob = Math.min(92, Math.max(Number(scalpSection.success_prob || 0), 78));
          if (Array.isArray(scalpSection.confluence_factors)) {
            scalpSection.confluence_factors.push('ORB 15m doble rompimiento limpio confirmado (cuerpo+volumen)');
          }
        }
        if (Array.isArray(scalpSection.confluence_factors)) {
          scalpSection.confluence_factors.push(`Estrategia ORB ${primary.tf} válida (${mode}, ${aligned}/3 índices, volumen OK${spxAligned ? ', SPX líder confirma' : ''})`);
        }
      };

      scoreConfluence(result.scalp, 'Scalp');
      scoreConfluence(result.intraday, 'Intraday');

      // Apply strict ORB execution rules for scalp after confluence scoring.
      applyOrbScalpStrategy(result.scalp);

      // ═══ GLOBAL WINDOW CONSENSUS (no bloquea señal, solo alerta y tamaño) ═══
      {
        const scalpSig = result.scalp?.signal;
        const intradaySig = result.intraday?.signal;
        const strategyVotes = Object.values(result.strategies || {})
          .filter((s) => s && (s.trade_ready || s.detected) && (s.direction === 'CALL' || s.direction === 'PUT'))
          .map((s) => s.direction);
        const stratCall = strategyVotes.filter((d) => d === 'CALL').length;
        const stratPut = strategyVotes.filter((d) => d === 'PUT').length;
        const dominantStrategyDir = stratCall === stratPut ? null : (stratCall > stratPut ? 'CALL' : 'PUT');

        const strongContradiction = !!(
          scalpSig && intradaySig && scalpSig !== intradaySig &&
          (dominantStrategyDir ? (scalpSig !== dominantStrategyDir && intradaySig !== dominantStrategyDir) : true)
        );

        const highAlignment = !!(
          scalpSig && intradaySig && scalpSig === intradaySig &&
          (!dominantStrategyDir || dominantStrategyDir === scalpSig)
        );

        const wrongContextReasons = [];
        if (strongContradiction) wrongContextReasons.push('Scalp e Intraday apuntan a direcciones opuestas');
        if (dominantStrategyDir && scalpSig && dominantStrategyDir !== scalpSig) {
          wrongContextReasons.push('La estrategia dominante discrepa con la señal de scalp');
        }
        if (dominantStrategyDir && intradaySig && dominantStrategyDir !== intradaySig) {
          wrongContextReasons.push('La estrategia dominante discrepa con la señal intraday');
        }

        const sizeTier = strongContradiction ? 'small' : (highAlignment ? 'large' : 'normal');
        const sizeGuidance = sizeTier === 'small'
          ? 'Tamaño bajo (25-40% del tamaño base) por contradicción fuerte entre ventanas.'
          : sizeTier === 'large'
            ? 'Tamaño grande (80-100% del tamaño base) permitido por alta alineación entre ventanas.'
            : 'Tamaño normal (50-70% del tamaño base): hay señal operable pero sin consenso pleno.';

        result.window_consensus = {
          strong_contradiction: strongContradiction,
          high_alignment: highAlignment,
          scalp_signal: scalpSig || null,
          intraday_signal: intradaySig || null,
          dominant_strategy_direction: dominantStrategyDir,
          size_tier: sizeTier,
          size_guidance: sizeGuidance,
          warning: strongContradiction
            ? `Contradicción fuerte entre ventanas. ${wrongContextReasons.join(' | ')}. Emitir señal pero evitar entrada agresiva.`
            : null,
          context_mismatch_explanation: wrongContextReasons.length
            ? `Estrategia potencialmente correcta en contexto incorrecto: ${wrongContextReasons.join('; ')}.`
            : 'Contexto de mercado consistente con las estrategias activas.',
        };

        if (result.scalp) {
          result.scalp.execution_tier = strongContradiction ? 'small' : (result.scalp.execution_tier || sizeTier);
          if (strongContradiction) {
            result.scalp.confluence_warning = [result.scalp.confluence_warning, result.window_consensus.warning].filter(Boolean).join(' ');
            result.scalp.entry_alert = [result.scalp.entry_alert, 'Entrada sugerida solo con tamaño bajo por conflicto multi-ventana.'].filter(Boolean).join(' ');
          }
        }
        if (result.intraday) {
          result.intraday.execution_tier = strongContradiction ? 'small' : (result.intraday.execution_tier || sizeTier);
          if (strongContradiction) {
            result.intraday.confluence_warning = [result.intraday.confluence_warning, result.window_consensus.warning].filter(Boolean).join(' ');
          }
        }
      }

      // ═══ DETERMINISTIC ENTRY/SL/TP FALLBACK (runs AFTER scoreConfluence) ═══
      // Compute missing entry/sl/tp only for CALL/PUT signals.
      if (result.scalp) {
        const orbRef = intradayData?.first_candle_5m ?? null;
        computeFallbackLevels(result.scalp, {
          maxSlPct: 0.005,
          minRR: 2,
          ema20Val: intradayData?.ema20_1m,
          ema50Val: intradayData?.ema50_1m,
          orbCandle: orbRef,
          callW: result.scalp?.call_wall ?? gd?.gamma_level ?? null,
          putW: result.scalp?.put_wall ?? gd?.gamma_level ?? null,
          strategyType: 'scalp',
        });
      }
      if (result.intraday) {
        const orbRef = intradayData?.first_candle_30m ?? intradayData?.first_candle_15m ?? null;
        computeFallbackLevels(result.intraday, {
          maxSlPct: 0.01,
          minRR: 3,
          ema20Val: intradayData?.ema20_5m,
          ema50Val: intradayData?.ema50_5m,
          orbCandle: orbRef,
          callW: result.intraday?.call_wall ?? gd?.call_wall ?? null,
          putW: result.intraday?.put_wall ?? gd?.put_wall ?? null,
          strategyType: 'intraday',
        });
      }

      // Final pass: force compact scalp profile (0DTE/semana) and keep measurable distance from intraday.
      enforceScalpOdteProfile(result.scalp, result.intraday);

      // ═══ DETERMINISTIC RISK CALCULATION (after levels are finalized) ═══
      {
        const vixVal = vd?.vix ?? result.scalp?.vix_value ?? 20;
        let maxRiskPct = 2;
        if (vixVal >= 30) maxRiskPct = 0.5;
        else if (vixVal >= 20) maxRiskPct = 1;
        else if (vixVal >= 15) maxRiskPct = 1.5;

        const sEntry = result.scalp?.entry, sSl = result.scalp?.sl, sTp = result.scalp?.tp;
        const iEntry = result.intraday?.entry, iSl = result.intraday?.sl, iTp = result.intraday?.tp;

        const rrCalc = (entry, sl, tp) => {
          if (!entry || !sl || !tp) return null;
          const r = Math.abs(entry - sl);
          return r > 0 ? (Math.abs(tp - entry) / r).toFixed(2) : null;
        };
        const scalpRRVal = rrCalc(sEntry, sSl, sTp);
        const intradayRRVal = rrCalc(iEntry, iSl, iTp);

        const accountSize = 5000;
        const maxDollarRisk = (accountSize * maxRiskPct / 100).toFixed(0);
        let contracts = '--';
        if (sEntry && sSl) {
          const riskPerContract = Math.abs(sEntry - sSl) * 100;
          if (riskPerContract > 0) contracts = Math.floor(Number(maxDollarRisk) / riskPerContract);
        }

        result.risk.max_risk_pct = maxRiskPct;
        result.risk.rr_ratio = scalpRRVal ? `1:${scalpRRVal}` : (intradayRRVal ? `1:${intradayRRVal}` : 'N/A');
        result.risk.position_suggestion = `Con cuenta de $${accountSize}, arriesgar máximo $${maxDollarRisk} (${maxRiskPct}%). ${contracts !== '--' ? `Tamaño base: ${contracts} contrato(s).` : 'Ajustar tamaño base según spread.'}`;

        const consensusTier = result.window_consensus?.size_tier || 'normal';
        if (consensusTier === 'small') {
          result.risk.position_suggestion += ' Contradicción fuerte entre ventanas: usar tamaño bajo (25-40% del tamaño base).';
        } else if (consensusTier === 'large') {
          result.risk.position_suggestion += ' Alta alineación entre ventanas: se permite tamaño grande (80-100% del tamaño base).';
        } else {
          result.risk.position_suggestion += ' Consenso parcial: usar tamaño normal (50-70% del tamaño base).';
        }

        // ═══ DETERMINISTIC RISK RULES (professional position management) ═══
        // Choose active setup: prefer scalp if available, fallback to intraday.
        const active = result.scalp?.signal ? result.scalp : result.intraday;
        if (!result.risk_rules) result.risk_rules = {};

        const aEntry = Number(active?.entry || 0);
        const aSl = Number(active?.sl || 0);
        const aTp = Number(active?.tp || 0);
        const aSignal = String(active?.signal || '');
        const aIsBull = aSignal === 'CALL';
        const oneR = aEntry && aSl ? Math.abs(aEntry - aSl) : 0;
        const twoR = oneR * 2;
        const oneHalfR = oneR * 1.5;
        const bePrice = aEntry && oneR
          ? (aIsBull ? aEntry + oneR : aEntry - oneR)
          : null;
        const partialPrice = aEntry && oneHalfR
          ? (aIsBull ? aEntry + oneHalfR : aEntry - oneHalfR)
          : null;
        const positiveStop = aEntry && oneR
          ? (aIsBull ? aEntry + (oneR * 0.2) : aEntry - (oneR * 0.2))
          : null;
        const fmt = (v) => (Number.isFinite(v) ? `$${Number(v).toFixed(2)}` : 'N/A');
        const fakeRiskHigh = result.scalp?.fake_breakout_risk === 'HIGH';
        const vixHigh = vixVal >= 25;
        const sizeCut = fakeRiskHigh || vixHigh;

        if (aEntry && aSl && aTp && oneR > 0) {
          result.risk_rules.breakeven_trigger = `Cuando el precio alcance 1R en ${fmt(bePrice)} (${fmt(oneR)} desde la entrada ${fmt(aEntry)}).`;
          result.risk_rules.breakeven_action = `Mover SL a breakeven en ${fmt(aEntry)}. Si el impulso es fuerte (volumen confirma), subir SL a stop positivo en ${fmt(positiveStop)}.`;

          result.risk_rules.partial_profit_trigger = `En 1.5R (${fmt(partialPrice)}) o al tocar primer nivel duro (Call/Put Wall, R1/S1 o resistencia/soporte 1H).`;
          result.risk_rules.partial_profit_action = `Cerrar 50% de la posición, asegurar stop en positivo (${fmt(positiveStop)}) y dejar correr el resto hasta TP ${fmt(aTp)} o trailing por vela 2m/3m.`;

          result.risk_rules.full_exit_trigger = `Salida total al tocar TP ${fmt(aTp)} o si aparece señal técnica opuesta clara (failed breakout + volumen en contra).`;
          result.risk_rules.full_exit_action = `Cerrar el 100% restante sin dudar si se cumple la invalidación.`;

          result.risk_rules.hold_trigger = `Mantener mientras precio respete estructura a favor (EMA20 y ORB en dirección del trade) y no pierda ${aIsBull ? 'soportes' : 'resistencias'} clave.`;
          result.risk_rules.hold_action = `Aplicar trailing stop dinámico: para ${aSignal}, mover SL detrás del último ${aIsBull ? 'mínimo' : 'máximo'} relevante en 2m/3m.`;

          result.risk_rules.invalidation_trigger = `Invalidar si el precio cruza en cierre la zona de SL ${fmt(aSl)} con volumen alto o rompe el nivel gamma contrario (${aIsBull ? `Put Wall ${fmt(gd?.put_wall)}` : `Call Wall ${fmt(gd?.call_wall)}`}).`;
          result.risk_rules.invalidation_action = `Cerrar inmediatamente la posición. No promediar pérdida ni mover SL en contra.`;

          result.risk_rules.general_note = `${result.scalp?.signal ? 'Scalp' : 'Intraday'} activo: riesgo por trade ${maxRiskPct}%. 1R=${fmt(oneR)}, 2R=${fmt(twoR)}. ${sizeCut ? 'Condición de riesgo elevada (VIX/fake breakout): reducir tamaño 30-50% y ejecutar BE más temprano.' : 'Condición normal: ejecutar BE en 1R y parcial en 1.5R para profesionalizar la gestión.'}`;

          // Reflect size reduction guidance directly in position suggestion
          if (sizeCut) {
            result.risk.position_suggestion += ' Riesgo elevado detectado: reducir tamaño 30-50% y priorizar gestión defensiva (BE temprano).';
          }
        }
      }

      const rootSetupGrade = result.scalp?.setup_grade || result.intraday?.setup_grade || (result.window_consensus?.strong_contradiction ? 'C' : (result.window_consensus?.high_alignment ? 'A+' : 'B'));
      const rootEntryAlert = result.scalp?.entry_alert || result.intraday?.entry_alert || result.window_consensus?.warning || null;
      const rootExecutionTier = result.scalp?.execution_tier || result.intraday?.execution_tier || result.window_consensus?.size_tier || 'normal';
      const rootSignal = result.scalp?.signal || result.intraday?.signal || null;

      result.setup_grade = rootSetupGrade;
      result.entry_alert = rootEntryAlert;
      result.analysis_meta = {
        source_window: 'daytrading',
        active_module: result.scalp?.signal ? 'scalp' : 'intraday',
        overall_signal: rootSignal,
        setup_grade: rootSetupGrade,
        entry_alert: rootEntryAlert,
        execution_tier: rootExecutionTier,
        size_tier: result.window_consensus?.size_tier || rootExecutionTier,
        size_guidance: result.window_consensus?.size_guidance || null,
        context_mismatch_explanation: result.window_consensus?.context_mismatch_explanation || null,
        scalp_signal: result.scalp?.signal || null,
        intraday_signal: result.intraday?.signal || null,
      };

      try {
        const ml = await inferMlProbabilityFromPayload(result, { sourceWindow: 'daytrading', ticker: t });
        if (ml) {
          result.ml = ml;
          if (!result.analysis_meta) result.analysis_meta = {};
          result.analysis_meta.ml_probability = ml.ml_probability;
          result.analysis_meta.ml_threshold = ml.threshold;
          result.analysis_meta.ml_pass_filter = ml.pass_filter;
          result.analysis_meta.ml_samples = ml.samples_used;
          result.analysis_meta.ml_confidence = ml.confidence_tier;
          if (result.window_consensus) {
            result.window_consensus.ml_probability = ml.ml_probability;
            result.window_consensus.ml_filter = ml.pass_filter;
            result.window_consensus.ml_samples = ml.samples_used;
            result.window_consensus.ml_note = ml.note;
          }
          if (ml.pass_filter === false) {
            const mlWarn = `Filtro ML: probabilidad ${(ml.ml_probability * 100).toFixed(1)}% (< ${(ml.threshold * 100).toFixed(0)}%). Setup operable pero evitar entrada agresiva.`;
            result.scalp.entry_alert = [result.scalp.entry_alert, mlWarn].filter(Boolean).join(' ');
            result.intraday.entry_alert = [result.intraday.entry_alert, mlWarn].filter(Boolean).join(' ');
          }
        }
      } catch (mlErr) {
        console.warn('ML inference failed for DayTrading:', mlErr?.message || mlErr);
      }

      dispatch({ type: 'SET_RESULT', result, ticker: t, lastUpdated: new Date().toLocaleString() });
      if (liveOnly && autoRefreshMs > 0) {
        setNextRefreshAt(Date.now() + autoRefreshMs);
      }
      toast.success(`Análisis de ${t} completado`);
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('Error 404: faltan recursos backend (funciones o entidades Base44) para Day Trading.');
      } else {
        toast.error('Error: ' + getReadableError(err));
      }
    } finally {
      setIsLoading(false);
    }
  };

  runAnalysisRef.current = runAnalysis;
  tickerRef.current = ticker;
  isLoadingRef.current = isLoading;

  const saveAnalysis = async () => {
    if (!analysisResult || !ticker) return;
    if (!hasBase44Config()) {
      toast.error('No se puede guardar: falta configurar Base44 en .env.local');
      return;
    }
    try {
      const savedAnalysis = await base44.entities.Analysis.create({
        ticker: ticker.toUpperCase(),
        type: liveOnly ? 'live-scalp' : 'scalp',
        signal: analysisResult.scalp?.signal,
        entry_price: analysisResult.scalp?.entry,
        stop_loss: analysisResult.scalp?.sl,
        take_profit: analysisResult.scalp?.tp,
        success_probability: analysisResult.scalp?.success_prob,
        analysis_data: JSON.stringify(analysisResult),
        last_updated: lastUpdated,
      });
      try {
        await upsertMlTradeSampleFromAnalysis(savedAnalysis);
      } catch (syncErr) {
        console.warn('ML dataset sync failed for DayTrading:', syncErr?.message || syncErr);
      }
      try {
        await saveSignalsFromAnalysis({
          ticker,
          analysisType: liveOnly ? 'live-scalp' : 'scalp',
          analysisResult,
          savedAnalysisId: savedAnalysis?.id,
        });
      } catch (signalErr) {
        console.warn('Signal log sync failed for DayTrading:', signalErr?.message || signalErr);
      }
      toast.success('Análisis guardado');
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('No se pudo guardar: la entidad Analysis no existe en el backend Base44.');
      } else {
        toast.error('Error al guardar: ' + getReadableError(err));
      }
    }
  };

  useEffect(() => {
    if (!liveOnly || !autoRefreshMs || !ticker) return;

    if (!analysisResult && !isLoadingRef.current) {
      runAnalysisRef.current?.();
    }

    const intervalId = setInterval(() => {
      if (!tickerRef.current || isLoadingRef.current) return;
      runAnalysisRef.current?.();
    }, autoRefreshMs);

    return () => clearInterval(intervalId);
  }, [liveOnly, autoRefreshMs, ticker, analysisResult]);

  useEffect(() => {
    if (!liveOnly || !ticker) {
      setNextRefreshAt(null);
    }
  }, [liveOnly, ticker]);

  useEffect(() => {
    if (!liveOnly) return;
    runLiveUniverseScan({ silent: true });
    const scanInterval = Math.max(60000, Number(autoRefreshMs) || 60000);
    const intervalId = setInterval(() => {
      runLiveUniverseScan({ silent: true });
    }, scanInterval);
    return () => clearInterval(intervalId);
  }, [liveOnly, autoRefreshMs, runLiveUniverseScan]);

  const risk = analysisResult?.risk;

  // Calculate R:R client-side from actual scalp levels
  const calcRR = (entry, sl, tp, signal) => {
    if (!entry || !sl || !tp) return null;
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk === 0) return null;
    return (reward / risk).toFixed(2);
  };

  const scalpRR = calcRR(
    analysisResult?.scalp?.entry,
    analysisResult?.scalp?.sl,
    analysisResult?.scalp?.tp,
    analysisResult?.scalp?.signal
  );
  const intradayRR = calcRR(
    analysisResult?.intraday?.entry,
    analysisResult?.intraday?.sl,
    analysisResult?.intraday?.tp,
    analysisResult?.intraday?.signal
  );

  return (
    <div className="space-y-6">
      <TickerInput
        ticker={ticker}
        setTicker={setTicker}
        onAnalyze={runAnalysis}
        onRefresh={runAnalysis}
        onSave={saveAnalysis}
        onBacktest={liveOnly ? undefined : () => setShowBacktest(true)}
        isLoading={isLoading}
        lastUpdated={lastUpdated}
      />

      {liveOnly && (
        <div className="flex items-center justify-between gap-3 px-1 py-1">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Ventana Live Scalp</h2>
            <p className="text-xs text-muted-foreground">Vista compacta con entrada, stop, take profit y probabilidad. Actualización automática cada 1 minuto.</p>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
            Auto-refresh: {Math.max(1, Math.round(autoRefreshMs / 60000))} min
          </div>
        </div>
      )}

      {liveOnly && (
        <LiveUniverseScannerCard
          rows={liveScannerRows}
          isLoading={isScannerLoading}
          onScan={() => runLiveUniverseScan({ silent: false })}
          lastRunAt={liveScannerLastRun}
          marketMeta={liveScannerMarketMeta}
          minProbability={liveScannerMinProbability}
          onChangeMinProbability={(value) => {
            setLiveScannerMinProbability(value);
          }}
          onSaveSetupsA={saveLiveScannerSetupsA}
          isSavingSetupsA={isSavingScannerSetups}
          includeSetupB={liveScannerIncludeSetupB}
          onToggleIncludeSetupB={setLiveScannerIncludeSetupB}
          onPickTicker={(symbol) => {
            setTicker(symbol);
            toast.info(`Ticker ${symbol} cargado. Pulsa Analizar para ver detalle completo.`);
          }}
        />
      )}

      {/* Live Price — uses shared polling hook, no extra requests */}
      {!liveOnly && ticker && <LivePriceBadge ticker={ticker} priceData={livePrice} />}

      {/* Trading Hours Guide */}
      {!liveOnly && <TradingHours />}

      {/* Premarket Toggle */}
      {!liveOnly && <div className="flex items-center gap-3 px-1 flex-wrap">
        <button
          onClick={() => setWithPremarket(!withPremarket)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
            withPremarket
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
              : 'bg-secondary border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${withPremarket ? 'bg-amber-400 animate-pulse' : 'bg-muted-foreground/40'}`} />
          {withPremarket ? '🌅 Analizando CON premarket' : '🌅 Analizar CON premarket'}
        </button>
        <span className="text-xs text-muted-foreground">
          {withPremarket ? 'Se incluyen datos de sesión premarket en el análisis' : 'Solo sesión regular (9:30 AM – 4:00 PM ET)'}
        </span>

        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-muted-foreground">Gamma cálculo</label>
          <select
            value={gammaCalculationMode}
            onChange={(e) => setGammaCalculationMode(e.target.value === 'near_open' ? 'near_open' : 'institutional')}
            className="h-9 rounded-lg border border-border/60 bg-secondary px-2 text-xs text-foreground"
          >
            <option value="institutional">Institucional amplio</option>
            <option value="near_open">Cerca apertura</option>
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={gammaStrictReal}
              onChange={(e) => setGammaStrictReal(Boolean(e.target.checked))}
              className="h-4 w-4 rounded border-border/70 bg-secondary"
            />
            Solo gamma real
          </label>

          <label className="text-xs text-muted-foreground">Gamma expiración</label>
          <select
            value={gammaExpirationMode}
            onChange={(e) => setGammaExpirationMode(e.target.value === 'all' ? 'all' : 'nearest')}
            className="h-9 rounded-lg border border-border/60 bg-secondary px-2 text-xs text-foreground"
          >
            <option value="nearest">Nearest</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>}

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Analizando {ticker} — 3 timeframes scalp + 4 timeframes intraday...</p>
          </div>
        </div>
      )}

      {analysisResult && !isLoading && (
        <ChartErrorBoundary resetKey={ticker}>
          {liveOnly ? (
            <CompactLiveCard
              ticker={ticker}
              scalp={analysisResult.scalp}
              lastUpdated={lastUpdated}
              autoRefreshMs={autoRefreshMs}
              nextRefreshAt={nextRefreshAt}
              isLoading={isLoading}
            />
          ) : (
            <div className="space-y-6">
              {/* No-Trade Alerts — mostrar primero si existen */}
              <NoTradeAlert alerts={analysisResult?.no_trade?.alerts ?? []} />

              <ConsensusPanel
                title="🧭 Consenso Entre Ventanas"
                consensus={analysisResult?.window_consensus}
                setupGrade={analysisResult?.scalp?.setup_grade}
                entryAlert={analysisResult?.scalp?.entry_alert}
              />

              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ScalpModule data={analysisResult.scalp} risk={analysisResult.risk} />
                  <IntradayModule data={analysisResult.intraday} risk={analysisResult.risk} />
                </div>

                <StructurePatterns
                  strategies={analysisResult?.strategies}
                  fallbackLevels={{
                    entry_price: analysisResult?.entry_price,
                    stop_loss: analysisResult?.stop_loss,
                    take_profit: analysisResult?.take_profit,
                  }}
                />

                <RiskRulesModule rules={analysisResult?.risk_rules} />
              </>

              {risk && (
                <div className="p-4 bg-card rounded-xl border border-border/50">
                  <h3 className="text-sm font-semibold text-foreground mb-3">⚖️ Gestión de Riesgo</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground">Riesgo Máximo</p>
                      <p className="text-lg font-bold text-amber-400">{risk.max_risk_pct}%</p>
                    </div>
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground">R:R Scalp</p>
                      <p className="text-lg font-bold text-primary">
                        {scalpRR ? `1:${scalpRR}` : risk.rr_ratio}
                      </p>
                      {intradayRR && (
                        <p className="text-[9px] text-muted-foreground">Intraday: 1:{intradayRR}</p>
                      )}
                    </div>
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground">Posición Sugerida</p>
                      <p className="text-sm font-bold text-foreground">{risk.position_suggestion}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ChartErrorBoundary>
      )}

      {/* Chart with marked levels — only shown after analysis */}
      {!liveOnly && ticker && analysisResult && (
        <ChartErrorBoundary resetKey={ticker}>
          <DayTradingChart ticker={ticker} analysisData={analysisResult} />
        </ChartErrorBoundary>
      )}

      {!liveOnly && <BacktestModal open={showBacktest} onClose={() => setShowBacktest(false)} data={analysisResult?.backtesting} title={`${ticker} Day Trading`} />}
    </div>
  );
}