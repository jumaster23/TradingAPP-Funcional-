import { useState, useReducer, useCallback } from 'react';
import React from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { hasBase44Config, getBase44ConfigError, isNotFoundError, getReadableError } from '@/lib/backendGuard';
import { inferMlProbabilityFromPayload, upsertMlTradeSampleFromAnalysis } from '@/lib/mlDataset';
import { saveSignalsFromAnalysis } from '@/lib/signalLog';

const STATS_TTL_DAYS = 7;

function isStale(dateStr) {
  if (!dateStr) return true;
  return Date.now() - new Date(dateStr).getTime() > STATS_TTL_DAYS * 86400000;
}

const historicalSchema = {
  type: 'object',
  properties: {
    gap_fill_25: { type: 'number' },
    gap_fill_50: { type: 'number' },
    gap_fill_75: { type: 'number' },
    gap_fill_100: { type: 'number' },

    orb5_single_break: { type: 'number' },
    orb5_double_break: { type: 'number' },
    orb5_consolidation: { type: 'number' },
    orb5_clean_break_prob: { type: 'number' },
    orb5_failed_break_prob: { type: 'number' },
    orb5_small_range_break: { type: 'number' },
    orb5_large_range_break: { type: 'number' },
    orb5_large_gap_day_penalty: { type: 'number' },
    orb5_vol_confirm_boost: { type: 'number' },
    orb5_low_vix_boost: { type: 'number' },
    orb5_high_vix_penalty: { type: 'number' },
    orb5_gap_confluence_boost: { type: 'number' },
    orb5_trending_market_break: { type: 'number' },
    orb5_ranging_market_break: { type: 'number' },
    orb5_gamma_wall_boost: { type: 'number' },
    orb5_index_confirm_boost: { type: 'number' },

    orb15_single_break: { type: 'number' },
    orb15_double_break: { type: 'number' },
    orb15_consolidation: { type: 'number' },
    orb15_clean_break_prob: { type: 'number' },
    orb15_failed_break_prob: { type: 'number' },
    orb15_small_range_break: { type: 'number' },
    orb15_large_range_break: { type: 'number' },
    orb15_large_gap_day_penalty: { type: 'number' },
    orb15_vol_confirm_boost: { type: 'number' },
    orb15_low_vix_boost: { type: 'number' },
    orb15_high_vix_penalty: { type: 'number' },
    orb15_gap_confluence_boost: { type: 'number' },
    orb15_trending_market_break: { type: 'number' },
    orb15_ranging_market_break: { type: 'number' },
    orb15_gamma_wall_boost: { type: 'number' },
    orb15_index_confirm_boost: { type: 'number' },

    orb30_single_break: { type: 'number' },
    orb30_double_break: { type: 'number' },
    orb30_consolidation: { type: 'number' },
    orb30_clean_break_prob: { type: 'number' },
    orb30_failed_break_prob: { type: 'number' },
    orb30_small_range_break: { type: 'number' },
    orb30_large_range_break: { type: 'number' },
    orb30_large_gap_day_penalty: { type: 'number' },
    orb30_vol_confirm_boost: { type: 'number' },
    orb30_low_vix_boost: { type: 'number' },
    orb30_high_vix_penalty: { type: 'number' },
    orb30_gap_confluence_boost: { type: 'number' },
    orb30_trending_market_break: { type: 'number' },
    orb30_ranging_market_break: { type: 'number' },
    orb30_gamma_wall_boost: { type: 'number' },
    orb30_index_confirm_boost: { type: 'number' },

    orb1h_single_break: { type: 'number' },
    orb1h_double_break: { type: 'number' },
    orb1h_consolidation: { type: 'number' },
    orb1h_clean_break_prob: { type: 'number' },
    orb1h_failed_break_prob: { type: 'number' },
    orb1h_small_range_break: { type: 'number' },
    orb1h_large_range_break: { type: 'number' },
    orb1h_large_gap_day_penalty: { type: 'number' },
    orb1h_vol_confirm_boost: { type: 'number' },
    orb1h_low_vix_boost: { type: 'number' },
    orb1h_high_vix_penalty: { type: 'number' },
    orb1h_gap_confluence_boost: { type: 'number' },
    orb1h_trending_market_break: { type: 'number' },
    orb1h_ranging_market_break: { type: 'number' },
    orb1h_gamma_wall_boost: { type: 'number' },
    orb1h_index_confirm_boost: { type: 'number' },

    sample_count: { type: 'number' }
  }
};

const realtimeSchema = {
  type: 'object',
  properties: {
    signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
    entry_price: { type: 'number' },
    stop_loss: { type: 'number' },
    take_profit: { type: 'number' },
    success_probability: { type: 'number' },
    analysis_summary: { type: 'string' },
    vix_level: { type: 'number' },
    vix_regime: { type: 'string' },
    vix_change: { type: 'number' },
    vix_change_pct: { type: 'number' },
    vix_impact: { type: 'string' },
    market_context: { type: 'string' },
    prev_close: { type: 'number' },
    today_open: { type: 'number' },
    today_high: { type: 'number' },
    today_low: { type: 'number' },
    current_price: { type: 'number' },
    gap_size_usd: { type: 'number' },
    gap_size_percent: { type: 'number' },
    fill_status: { type: 'string' },
    fill_percent_current: { type: 'number' },
    gap_type: { type: 'string' },
    gap_entry_call: { type: 'number' },
    gap_sl_call: { type: 'number' },
    gap_tp_call: { type: 'number' },
    gap_entry_put: { type: 'number' },
    gap_sl_put: { type: 'number' },
    gap_tp_put: { type: 'number' },
    orb5_high: { type: 'number' },
    orb5_low: { type: 'number' },
    orb5_status: { type: 'string', enum: ['pending', 'single_break_up', 'single_break_down', 'double_break', 'consolidating'] },
    orb5_retest_prob: { type: 'number' },
    orb5_no_retest_prob: { type: 'number' },
    orb5_ext_potential: { type: 'number' },
    orb5_ret_potential: { type: 'number' },
    orb15_high: { type: 'number' },
    orb15_low: { type: 'number' },
    orb15_status: { type: 'string', enum: ['pending', 'single_break_up', 'single_break_down', 'double_break', 'consolidating'] },
    orb15_retest_prob: { type: 'number' },
    orb15_no_retest_prob: { type: 'number' },
    orb15_ext_potential: { type: 'number' },
    orb15_ret_potential: { type: 'number' },
    orb30_high: { type: 'number' },
    orb30_low: { type: 'number' },
    orb30_status: { type: 'string', enum: ['pending', 'single_break_up', 'single_break_down', 'double_break', 'consolidating'] },
    orb30_retest_prob: { type: 'number' },
    orb30_no_retest_prob: { type: 'number' },
    orb30_ext_potential: { type: 'number' },
    orb30_ret_potential: { type: 'number' },
    orb1h_high: { type: 'number' },
    orb1h_low: { type: 'number' },
    orb1h_status: { type: 'string', enum: ['pending', 'single_break_up', 'single_break_down', 'double_break', 'consolidating'] },
    orb1h_retest_prob: { type: 'number' },
    orb1h_no_retest_prob: { type: 'number' },
    orb1h_ext_potential: { type: 'number' },
    orb1h_ret_potential: { type: 'number' },
    vwap: { type: 'number' },
    gamma_level: { type: 'number' },
    call_wall: { type: 'number' },
    put_wall: { type: 'number' },
    gamma_flip: { type: 'number' },
    pivot_point: { type: 'number' },
    prev_high: { type: 'number' },
    prev_low: { type: 'number' },
    scalp_signal: { type: 'string' },
    scalp_entry: { type: 'number' },
    scalp_sl: { type: 'number' },
    scalp_tp: { type: 'number' },
    scalp_prob: { type: 'number' },
    scalp_summary: { type: 'string' },
    scalp_detail: { type: 'string' },
    intraday_signal: { type: 'string' },
    intraday_entry: { type: 'number' },
    intraday_sl: { type: 'number' },
    intraday_tp: { type: 'number' },
    intraday_prob: { type: 'number' },
    intraday_summary: { type: 'string' },
    intraday_detail: { type: 'string' },
    risk_max_pct: { type: 'number' },
    risk_rr_ratio: { type: 'string' },
    risk_position_suggestion: { type: 'string' },
    backtest_success_rate: { type: 'number' },
    backtest_summary: { type: 'string' },
    backtest_total: { type: 'number' },
    backtest_wins: { type: 'number' },
    backtest_losses: { type: 'number' }
  }
};

function probReducer(state, action) {
  switch (action.type) {
    case 'SET_TICKER':
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

const initialProbState = { ticker: '', analyzedTicker: '', analysisResult: null, lastUpdated: null };

export function useProbabilityAnalysis() {
  const [state, dispatch] = useReducer(probReducer, initialProbState);
  const { ticker, analysisResult, lastUpdated } = state;
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');

  const setTicker = useCallback((val) => {
    dispatch({ type: 'SET_TICKER', ticker: (val || '').toUpperCase() });
  }, []);

  const GAP_CLASSIFICATION_CONTEXT = `
=== CLASIFICACIÓN DE GAPS POR TAMAÑO (usa esto para calibrar probabilidades de llenado) ===
• Gaps PEQUEÑOS (< 0.5%): Probabilidad de llenado completo 80%-90% el mismo día. Alta probabilidad, bajo riesgo.
• Gaps MODERADOS (0.5% a 1%): Probabilidad de llenado 70%-80%. Buen balance riesgo/beneficio.
• Gaps MEDIANOS (1% a 2%): Probabilidad de llenado 55%-70%. Empieza la incertidumbre, evaluar contexto.
• Gaps GRANDES (2% a 5%): Probabilidad de llenado 30%-50%. Mayor probabilidad de continuación del gap.
• Gaps EXTREMOS (> 5%): Probabilidad de llenado < 30%. Solo se llenan con noticias positivas/negativas, earnings, volumen extremo o momentum sostenido.
IMPORTANTE: Ajusta las probabilidades fill_probability_25/50/75/100 usando esta clasificación como base, combinada con el contexto actual del ticker (VIX, volumen, momentum, noticias).
`;

  const analyze = async () => {
    if (!ticker) return;
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }
    setIsLoading(true);
    const t = ticker.toUpperCase();

    try {
      // Step 1: Check DB for cached historical stats
      setLoadingStage('Cargando estadísticas históricas...');
      let cachedStats = null;
      try {
        const existingStats = await base44.entities.TickerStats.filter({ ticker: t });
        cachedStats = existingStats[0] || null;
      } catch (err) {
        if (!isNotFoundError(err)) {
          throw err;
        }
      }
      const needsHistorical = !cachedStats || isStale(cachedStats.last_analyzed);

      setLoadingStage('Obteniendo precios en tiempo real...');
      const now = new Date().toISOString();

      // Step 1b: Fetch real prices + intraday (first candle) in parallel
      // Also fetch index data for confluence (SPY, QQQ, NQ=F)
      let realPrices = null;
      let intradayData = null;
      let vixData = null;
      let indexData = null;
      try {
        const [priceRes, intradayRes, vixRes, spyRes, qqqRes] = await Promise.all([
          base44.functions.invoke('getStockPrice', { ticker: t }),
          base44.functions.invoke('getIntradayData', { ticker: t }),
          base44.functions.invoke('getVix', {}),
          base44.functions.invoke('getStockPrice', { ticker: 'SPY' }).catch(() => null),
          base44.functions.invoke('getStockPrice', { ticker: 'QQQ' }).catch(() => null),
        ]);
        realPrices = priceRes?.data;
        if (intradayRes?.data && !intradayRes.data.error) intradayData = intradayRes.data;
        // bb_1m and bb_5m are included in intradayData automatically
        if (vixRes?.data && !vixRes.data.error) vixData = vixRes.data;

        // Build index confluence data
        const spy = spyRes?.data;
        const qqq = qqqRes?.data;
        if (spy || qqq) {
          const spyDir = spy?.current_price && spy?.prev_close ? (spy.current_price > spy.prev_close ? 'bullish' : spy.current_price < spy.prev_close ? 'bearish' : 'flat') : null;
          const qqqDir = qqq?.current_price && qqq?.prev_close ? (qqq.current_price > qqq.prev_close ? 'bullish' : qqq.current_price < qqq.prev_close ? 'bearish' : 'flat') : null;
          const spyChg = spy?.current_price && spy?.prev_close ? ((spy.current_price - spy.prev_close) / spy.prev_close * 100) : null;
          const qqqChg = qqq?.current_price && qqq?.prev_close ? ((qqq.current_price - qqq.prev_close) / qqq.prev_close * 100) : null;
          const aligned = spyDir && qqqDir && spyDir === qqqDir;
          indexData = {
            spy: spy ? { price: spy.current_price, change_pct: spyChg?.toFixed(2), direction: spyDir, open: spy.today_open, high: spy.today_high, low: spy.today_low } : null,
            qqq: qqq ? { price: qqq.current_price, change_pct: qqqChg?.toFixed(2), direction: qqqDir, open: qqq.today_open, high: qqq.today_high, low: qqq.today_low } : null,
            aligned,
            market_direction: aligned ? spyDir : 'mixed',
          };
        }
      } catch (e) {
        console.warn('Price/intraday/vix fetch failed, LLM will estimate:', e.message);
      }

      const priceHint = realPrices
        ? `USE THESE EXACT REAL-TIME PRICES (fetched directly from Yahoo Finance, do NOT override them):
prev_close=${realPrices.prev_close}, today_open=${realPrices.today_open ?? 'unknown'}, today_high=${realPrices.today_high}, today_low=${realPrices.today_low}, current_price=${realPrices.current_price}
`
        : `Fetch REAL-TIME market data from Yahoo Finance for ${t} right now (${now}). URL: https://finance.yahoo.com/quote/${t}
`;

      const vixHint = vixData
        ? `VIX REAL EN TIEMPO REAL (dato directo de Yahoo Finance — USA ESTE VALOR EXACTO, no lo estimes):
VIX actual = ${vixData.vix} | Cambio hoy = ${vixData.vix_change > 0 ? '+' : ''}${vixData.vix_change} (${vixData.vix_change_pct > 0 ? '+' : ''}${vixData.vix_change_pct}%)
Régimen VIX = ${vixData.regime_es} (${vixData.regime})
Impacto en trading: ${vixData.impact_note}
Ajuste probabilidades ORB: ${vixData.orb_probability_adjustment > 0 ? '+' : ''}${vixData.orb_probability_adjustment}% en todos los timeframes
USA vix_level = ${vixData.vix} en tu respuesta.
`
        : '';

      // Step 2: Launch calls in parallel
      const calls = [
        // Real-time: focused short prompt → fast
        base44.integrations.Core.InvokeLLM({
          prompt: `${priceHint}${vixHint}
${GAP_CLASSIFICATION_CONTEXT}
Return ONLY these values for ${t} (${now}):
PRICES: prev_close, today_open, today_high, today_low, current_price
GAP: gap_size_usd (today_open - prev_close), gap_size_percent, gap_type ("Common Gap"/"Breakaway Gap"/"Runaway Gap"/"Exhaustion Gap")
GAP STATUS using today_high/today_low:
  - If gap up (today_open > prev_close): filled if today_low <= prev_close → fill_status="filled_100". If today_low between prev_close and today_open → "filling". Else "unfilled".
  - If gap down: filled if today_high >= prev_close → "filled_100". If today_high between today_open and prev_close → "filling". Else "unfilled".
  - fill_percent_current: max % the gap has been filled today based on high/low
GAP TRADE LEVELS: gap_entry_call, gap_sl_call, gap_tp_call, gap_entry_put, gap_sl_put, gap_tp_put
ORB EXACT RANGES (from 9:30 AM ET market open):
  orb5_high/low (first 5min), orb15_high/low (first 15min), orb30_high/low (first 30min), orb1h_high/low (first 60min)
  For EACH ORB also provide:
  - status: CURRENT real status of today's ORB — use current_price, today_high, today_low to determine:
    * "pending" = ORB window not yet closed (market hasn't elapsed that timeframe yet)
    * "single_break_up" = price broke above orb_high and is holding above it
    * "single_break_down" = price broke below orb_low and is holding below it
    * "double_break" = price broke both high and low at some point today (whipsaw)
    * "consolidating" = price is still inside the ORB range (no break yet)
    IMPORTANT: Base this on actual today_high vs orb_high and today_low vs orb_low
  - retest_prob, no_retest_prob, ext_potential (extension %), ret_potential (retracement %)
GAMMA/OPTIONS LEVELS (CRÍTICO — obtener de Barchart en tiempo real):
Visita https://www.barchart.com/stocks/quotes/${t}/options para obtener los datos ACTUALES de opciones:
- call_wall: strike con MAYOR open interest de CALLS (no estimes, obtén el valor real de Barchart)
- put_wall: strike con MAYOR open interest de PUTS (no estimes, obtén el valor real de Barchart)
- gamma_flip: nivel de gamma flip según Barchart (donde GEX cambia de positivo a negativo)
- gamma_level: nivel gamma principal (mayor concentración de gamma exposure)
IMPORTANTE: Estos valores cambian cada día. Hoy ${now} los datos reales de Barchart DEBEN usarse, no datos históricos ni estimados.
OTHER LEVELS: vwap (current), pivot_point, prev_high, prev_low
SIGNAL: overall signal (CALL/PUT/NEUTRAL), entry_price (strategic, not current price), stop_loss, take_profit, success_probability (0-100), analysis_summary (2 sentences max, MUST be in Spanish), vix_level, market_context (1 sentence, MUST be in Spanish)
SCALP (1-5min): scalp_signal, scalp_entry, scalp_sl, scalp_tp, scalp_prob, scalp_summary (in Spanish), scalp_detail (in Spanish)
INTRADAY (15-30min): intraday_signal, intraday_entry, intraday_sl, intraday_tp, intraday_prob, intraday_summary (in Spanish), intraday_detail (in Spanish)
RISK: risk_max_pct, risk_rr_ratio, risk_position_suggestion
BACKTEST (historical for this ticker): backtest_success_rate, backtest_summary (in Spanish), backtest_total, backtest_wins, backtest_losses
IMPORTANT: ALL text fields must be written in Spanish.`,
          add_context_from_internet: true,
          model: 'gemini_3_flash',
          response_json_schema: realtimeSchema
        })
      ];

      // Historical call only if not cached (no internet = fast ~3s)
      if (needsHistorical) {
        setLoadingStage('Calculando estadísticas históricas...');
        calls.push(
          base44.functions.invoke('getHistoricalStats', { ticker: t }).catch((e) => {
            console.warn('Historical stats function failed, using fallback values:', e?.message || e);
            return null;
          })
        );
      }

      const results = await Promise.all(calls);
      // Deep clone to avoid mutating frozen/immutable objects from InvokeLLM
      const rt = JSON.parse(JSON.stringify(results[0] ?? {}));
      let hist = cachedStats;
      let orbStatsSource = cachedStats ? 'cache_recent' : 'none';
      let orbStatsRefreshAttempted = false;
      let orbStatsRefreshSucceeded = false;

      // Save/update historical stats in DB
      if (needsHistorical && results[1]) {
        orbStatsRefreshAttempted = true;
        const hd = results[1]?.data ?? results[1];
        if (hd?.error) {
          hist = cachedStats;
          orbStatsSource = cachedStats ? 'stale_cache_fallback' : 'none';
        } else {
        const statsData = { ...hd, ticker: t, last_analyzed: new Date().toISOString() };
        try {
          if (cachedStats) {
            await base44.entities.TickerStats.update(cachedStats.id, statsData);
          } else {
            await base44.entities.TickerStats.create(statsData);
          }
        } catch (err) {
          if (!isNotFoundError(err)) {
            throw err;
          }
        }
        hist = { ...hd, last_analyzed: statsData.last_analyzed };
        orbStatsRefreshSucceeded = true;
        orbStatsSource = 'fresh';
        }
      }

      if (!needsHistorical && cachedStats) {
        orbStatsSource = 'cache_recent';
      }

      const orbStatsLastAnalyzed = hist?.last_analyzed ?? cachedStats?.last_analyzed ?? null;
      const orbStatsAgeDays = orbStatsLastAnalyzed
        ? (Date.now() - new Date(orbStatsLastAnalyzed).getTime()) / 86400000
        : null;
      const orbStatsIsStale = orbStatsAgeDays == null ? true : orbStatsAgeDays > STATS_TTL_DAYS;
      const orbStatsWarning = orbStatsRefreshAttempted && !orbStatsRefreshSucceeded && cachedStats
        ? `No se pudo refrescar estadísticas ORB; se usan datos en caché de hace ${orbStatsAgeDays != null ? orbStatsAgeDays.toFixed(1) : 'N/A'} días.`
        : (orbStatsIsStale
          ? `Estadísticas ORB desactualizadas (${orbStatsAgeDays != null ? orbStatsAgeDays.toFixed(1) : 'N/A'} días).`
          : null);

      // Override VIX with real data
      if (vixData) {
        rt.vix_level = vixData.vix;
        rt.vix_regime = vixData.regime;
        rt.vix_change = vixData.vix_change;
        rt.vix_change_pct = vixData.vix_change_pct;
        rt.vix_impact = vixData.impact_note;
      }

      // Override prices with real data if available
      if (realPrices) {
        if (realPrices.prev_close) rt.prev_close = realPrices.prev_close;
        if (realPrices.today_open) rt.today_open = realPrices.today_open;
        if (realPrices.today_high) rt.today_high = realPrices.today_high;
        if (realPrices.today_low) rt.today_low = realPrices.today_low;
        if (realPrices.current_price) rt.current_price = realPrices.current_price;

        // ── Deterministic entry_price fallback ──
        // If LLM didn't return a valid entry_price, compute from real levels
        if (!rt.entry_price || typeof rt.entry_price !== 'number') {
          const price = realPrices.current_price;
          const fc5 = intradayData?.first_candle_5m;
          const fc15 = intradayData?.first_candle_15m;
          if (rt.call_wall && rt.put_wall && price) {
            // Use nearest gamma wall as reference
            const mid = (rt.call_wall + rt.put_wall) / 2;
            if (rt.signal === 'CALL') {
              rt.entry_price = parseFloat((fc5 ? fc5.high * 1.001 : Math.min(price, mid)).toFixed(2));
            } else if (rt.signal === 'PUT') {
              rt.entry_price = parseFloat((fc5 ? fc5.low * 0.999 : Math.max(price, mid)).toFixed(2));
            } else {
              rt.entry_price = parseFloat(price.toFixed(2));
            }
          } else if (fc5 && price) {
            // Use ORB 5min level
            rt.entry_price = parseFloat((price > (fc5.high + fc5.low) / 2 ? fc5.high * 1.001 : fc5.low * 0.999).toFixed(2));
          } else if (price) {
            rt.entry_price = parseFloat(price.toFixed(2));
          }
        }
        // Also ensure SL/TP have values
        if (rt.entry_price && (!rt.stop_loss || typeof rt.stop_loss !== 'number')) {
          const risk = rt.entry_price * 0.005; // 0.5% default
          rt.stop_loss = parseFloat((rt.signal === 'CALL' ? rt.entry_price - risk : rt.entry_price + risk).toFixed(2));
        }
        if (rt.entry_price && rt.stop_loss && (!rt.take_profit || typeof rt.take_profit !== 'number')) {
          const riskAmt = Math.abs(rt.entry_price - rt.stop_loss);
          rt.take_profit = parseFloat((rt.signal === 'CALL' ? rt.entry_price + riskAmt * 2 : rt.entry_price - riskAmt * 2).toFixed(2));
        }
        // Recalculate gap with real prices
        if (rt.today_open && rt.prev_close) {
          rt.gap_size_usd = rt.today_open - rt.prev_close;
          rt.gap_size_percent = ((rt.gap_size_usd) / rt.prev_close) * 100;
        }
      }

      // ── Deterministic VIX probability penalty & R:R enforcement ──
      const vixVal = rt.vix_level || vixData?.vix || 0;
      let vixProbPenalty = 0;
      let vixMinRR = 1.5; // default minimum R:R
      let vixWarning = '';

      if (vixVal > 35) {
        vixProbPenalty = -20;
        vixMinRR = 3;
        vixWarning = `VIX extremo (${vixVal.toFixed(1)}) — evitar operaciones de alto riesgo. Penalización de -20% en todas las probabilidades. Solo trades con R:R mínimo 1:3.`;
      } else if (vixVal > 25) {
        vixProbPenalty = -15;
        vixMinRR = 2.5;
        vixWarning = `VIX alto (${vixVal.toFixed(1)}) — volatilidad elevada. Penalización de -15% en probabilidades. R:R mínimo recomendado 1:2.5.`;
      } else if (vixVal > 22) {
        vixProbPenalty = -5;
        vixMinRR = 2;
        vixWarning = `VIX por encima de normal (${vixVal.toFixed(1)}) — precaución. Penalización de -5% en probabilidades.`;
      } else if (vixVal <= 15 && vixVal > 0) {
        vixProbPenalty = 0;
        vixMinRR = 1.5;
        vixWarning = `VIX en calma (${vixVal.toFixed(1)}) — condiciones favorables para operar. Sin penalización.`;
      }

      // Apply penalty to success_probability
      if (vixProbPenalty && typeof rt.success_probability === 'number') {
        rt.success_probability = Math.max(5, Math.min(95, rt.success_probability + vixProbPenalty));
      }

      // Enforce minimum R:R — adjust TP if current R:R is below VIX-based minimum
      if (rt.entry_price && rt.stop_loss && rt.take_profit) {
        const riskAmt = Math.abs(rt.entry_price - rt.stop_loss);
        const currentReward = Math.abs(rt.take_profit - rt.entry_price);
        const currentRR = riskAmt > 0 ? currentReward / riskAmt : 0;

        if (currentRR < vixMinRR && riskAmt > 0) {
          const requiredReward = riskAmt * vixMinRR;
          if (rt.signal === 'CALL') {
            rt.take_profit = parseFloat((rt.entry_price + requiredReward).toFixed(2));
          } else if (rt.signal === 'PUT') {
            rt.take_profit = parseFloat((rt.entry_price - requiredReward).toFixed(2));
          }
        }
      }

      // Override vix_impact with deterministic warning
      if (vixWarning) {
        rt.vix_impact = vixWarning;
      }

      // Client-side fill status — use REAL prices (already overridden above)
      // Use realPrices directly if available, otherwise fall back to rt values
      const rp = realPrices || {};
      const pc = rp.prev_close ?? rt.prev_close;
      const open = rp.today_open ?? rt.today_open;
      const high = rp.today_high ?? rt.today_high;
      const low = rp.today_low ?? rt.today_low;

      const gapUsd = open && pc ? open - pc : 0;
      const gapUp = gapUsd > 0;
      const gapDown = gapUsd < 0;
      let fillStatus = 'no_gap';
      let fillPctCurrent = 0;

      if (gapUp && open && pc) {
        const gapSize = open - pc;
        // Gap UP: low must come down to prev_close to fill
        const filledAmount = open - (low ?? open);
        fillPctCurrent = Math.min(100, Math.round((filledAmount / gapSize) * 100));
        if (low <= pc) fillStatus = 'filled_100';
        else if (fillPctCurrent > 0) fillStatus = 'filling';
        else fillStatus = 'unfilled';
      } else if (gapDown && open && pc) {
        const gapSize = pc - open;
        // Gap DOWN: high must come up to prev_close to fill
        const filledAmount = (high ?? open) - open;
        fillPctCurrent = Math.min(100, Math.round((filledAmount / gapSize) * 100));
        if (high >= pc) fillStatus = 'filled_100';
        else if (fillPctCurrent > 0) fillStatus = 'filling';
        else fillStatus = 'unfilled';
      }

      rt.fill_status = fillStatus;
      rt.fill_percent_current = fillPctCurrent;
      // Also sync gap_size with real prices
      rt.gap_size_usd = gapUsd;
      rt.gap_size_percent = pc ? (gapUsd / pc) * 100 : 0;

      // Gap trade levels using first-candle multi-timeframe methodology:
      // 15m candle = context (SL reference), 5m candle = confirmation, 1m candle = precise entry
      // Gap UP fill = PUT: enter on break below 1m first candle LOW (liquidity sweep), SL above 15m high
      // Gap DOWN fill = CALL: enter on break above 1m first candle HIGH (liquidity sweep), SL below 15m low
      if (open && pc && Math.abs(gapUsd) > 0) {
        const fc1m  = intradayData?.first_candle_1m;
        const fc5m  = intradayData?.first_candle_5m;
        const fc15m = intradayData?.first_candle_15m;
        const buf   = open * 0.0005; // 0.05% trigger buffer

        if (fc1m && fc5m && fc15m) {
          if (gapUp) {
            // PUT = gap fill (price drops to prev_close)
            rt.gap_entry_put  = parseFloat((fc1m.low - buf).toFixed(2));       // break below 1m low
            rt.gap_sl_put     = parseFloat((fc15m.high + buf * 2).toFixed(2)); // above 15m context high
            rt.gap_tp_put     = parseFloat(pc.toFixed(2));                     // prev_close = fill target
            // CALL = continuation
            rt.gap_entry_call = parseFloat((fc5m.high + buf).toFixed(2));
            rt.gap_sl_call    = parseFloat((fc1m.low  - buf * 2).toFixed(2));
            rt.gap_tp_call    = parseFloat((open + Math.abs(gapUsd) * 1.5).toFixed(2));
          } else {
            // CALL = gap fill (price rises to prev_close)
            rt.gap_entry_call = parseFloat((fc1m.high + buf).toFixed(2));      // break above 1m high
            rt.gap_sl_call    = parseFloat((fc15m.low  - buf * 2).toFixed(2)); // below 15m context low
            rt.gap_tp_call    = parseFloat(pc.toFixed(2));                     // prev_close = fill target
            // PUT = continuation
            rt.gap_entry_put  = parseFloat((fc5m.low  - buf).toFixed(2));
            rt.gap_sl_put     = parseFloat((fc1m.high + buf * 2).toFixed(2));
            rt.gap_tp_put     = parseFloat((open - Math.abs(gapUsd) * 1.5).toFixed(2));
          }
        } else {
          // Fallback if candle data not available
          const fbuf = open * 0.001;
          if (gapUp) {
            rt.gap_entry_put  = parseFloat((open - fbuf).toFixed(2));
            rt.gap_sl_put     = parseFloat(((high ?? open) + fbuf * 2).toFixed(2));
            rt.gap_tp_put     = parseFloat(pc.toFixed(2));
            rt.gap_entry_call = parseFloat((open + fbuf).toFixed(2));
            rt.gap_sl_call    = parseFloat((open - fbuf * 3).toFixed(2));
            rt.gap_tp_call    = parseFloat((open + Math.abs(gapUsd) * 1.5).toFixed(2));
          } else {
            rt.gap_entry_call = parseFloat((open + fbuf).toFixed(2));
            rt.gap_sl_call    = parseFloat(((low ?? open) - fbuf * 2).toFixed(2));
            rt.gap_tp_call    = parseFloat(pc.toFixed(2));
            rt.gap_entry_put  = parseFloat((open - fbuf).toFixed(2));
            rt.gap_sl_put     = parseFloat((open + fbuf * 3).toFixed(2));
            rt.gap_tp_put     = parseFloat((open - Math.abs(gapUsd) * 1.5).toFixed(2));
          }
        }

        // Store first candle info for UI display
        rt._first_candle_1m  = intradayData?.first_candle_1m  ?? null;
        rt._first_candle_5m  = intradayData?.first_candle_5m  ?? null;
        rt._first_candle_15m = intradayData?.first_candle_15m ?? null;
      }

      // ── ORB HIGH/LOW from REAL first-candle data (Yahoo Finance) ──
      // Override LLM values with deterministic calculations
      const orbCandles = {
        orb5:  intradayData?.first_candle_5m  ?? null,
        orb15: intradayData?.first_candle_15m ?? null,
        orb30: intradayData?.first_candle_30m ?? null,
        orb1h: intradayData?.first_candle_1h  ?? null,
      };

      const curPrice = realPrices?.current_price ?? rt.current_price;
      const dayHigh  = realPrices?.today_high    ?? rt.today_high;
      const dayLow   = realPrices?.today_low     ?? rt.today_low;

      function computeOrbStatus(candle) {
        if (!candle || !candle.high || !candle.low) return 'pending';
        const brokeHigh = dayHigh > candle.high;
        const brokeLow  = dayLow  < candle.low;
        if (brokeHigh && brokeLow)  return 'double_break';
        if (brokeHigh && curPrice > candle.high) return 'single_break_up';
        if (brokeLow  && curPrice < candle.low)  return 'single_break_down';
        if (brokeHigh || brokeLow) return 'consolidating'; // broke but didn't hold
        return 'consolidating';
      }

      // Override ORB fields with real data
      for (const [prefix, candle] of Object.entries(orbCandles)) {
        if (candle && candle.high != null && candle.low != null) {
          rt[`${prefix}_high`]   = Number(candle.high.toFixed(2));
          rt[`${prefix}_low`]    = Number(candle.low.toFixed(2));
          rt[`${prefix}_status`] = computeOrbStatus(candle);
        }
      }

      // Deterministic signal guard: 5m ORB single-break must dominate conflicting scalp/general signal.
      // This prevents cases like ORB 5m bearish breakout while the signal still says CALL.
      const orb5DetSignal = rt.orb5_status === 'single_break_up'
        ? 'CALL'
        : rt.orb5_status === 'single_break_down'
          ? 'PUT'
          : null;

      const isDirectional = (s) => s === 'CALL' || s === 'PUT';
      const coerceLevelsToSignal = (entry, sl, tp, signal) => {
        if (!entry || !signal) return { entry, sl, tp };
        const e = Number(entry);
        let s = Number(sl);
        let t = Number(tp);
        if (!Number.isFinite(e)) return { entry, sl, tp };

        const minRisk = Math.max(0.05, e * 0.003);
        const minReward = minRisk * 2;

        if (signal === 'CALL') {
          if (!Number.isFinite(s) || s >= e) s = e - minRisk;
          if (!Number.isFinite(t) || t <= e) t = e + Math.max(minReward, Math.abs(e - s) * 2);
        } else if (signal === 'PUT') {
          if (!Number.isFinite(s) || s <= e) s = e + minRisk;
          if (!Number.isFinite(t) || t >= e) t = e - Math.max(minReward, Math.abs(e - s) * 2);
        }

        return {
          entry: Number(e.toFixed(2)),
          sl: Number(s.toFixed(2)),
          tp: Number(t.toFixed(2)),
        };
      };

      if (orb5DetSignal) {
        // Multi-factor confidence: historical ORB behavior + quality context + market confluences.
        let orb5SupportScore = 1.5; // base weight for real-time hold above/below ORB 5m

        const histBreakUp = Number(hist?.orb5_break_up);
        const histBreakDown = Number(hist?.orb5_break_down);
        if (Number.isFinite(histBreakUp) && Number.isFinite(histBreakDown)) {
          if (orb5DetSignal === 'CALL') {
            orb5SupportScore += histBreakUp >= histBreakDown ? 1 : -1;
          } else {
            orb5SupportScore += histBreakDown >= histBreakUp ? 1 : -1;
          }
        }

        const histClean = Number(hist?.orb5_clean_break_prob);
        const histFailed = Number(hist?.orb5_failed_break_prob);
        if (Number.isFinite(histClean) && Number.isFinite(histFailed)) {
          orb5SupportScore += histClean >= histFailed ? 0.5 : -0.5;
        }

        if (indexData?.aligned) {
          const indexDirSignal = indexData.market_direction === 'bullish' ? 'CALL' : 'PUT';
          orb5SupportScore += indexDirSignal === orb5DetSignal ? 1 : -1;
        }

        if (vixVal > 30) orb5SupportScore -= 0.75;
        else if (vixVal > 0 && vixVal <= 22) orb5SupportScore += 0.5;

        const callWall = Number(rt.call_wall);
        const putWall = Number(rt.put_wall);
        if (Number.isFinite(curPrice) && Number.isFinite(callWall) && Number.isFinite(putWall)) {
          if (orb5DetSignal === 'CALL') {
            if (curPrice > callWall) orb5SupportScore += 0.5;
            if (curPrice < putWall) orb5SupportScore -= 0.5;
          } else {
            if (curPrice < putWall) orb5SupportScore += 0.5;
            if (curPrice > callWall) orb5SupportScore -= 0.5;
          }
        }

        if (rt.orb15_status === 'single_break_up' && orb5DetSignal === 'CALL') orb5SupportScore += 0.5;
        if (rt.orb15_status === 'single_break_down' && orb5DetSignal === 'PUT') orb5SupportScore += 0.5;

        const shouldEnforceOrb5 = orb5SupportScore >= 1.5;
        const signalConflictOverall = isDirectional(rt.signal) && rt.signal !== orb5DetSignal;
        const signalConflictScalp = isDirectional(rt.scalp_signal) && rt.scalp_signal !== orb5DetSignal;

        if (shouldEnforceOrb5) {
          if (!isDirectional(rt.signal) || signalConflictOverall) {
            rt.signal = orb5DetSignal;
            const fixedOverall = coerceLevelsToSignal(rt.entry_price, rt.stop_loss, rt.take_profit, rt.signal);
            rt.entry_price = fixedOverall.entry;
            rt.stop_loss = fixedOverall.sl;
            rt.take_profit = fixedOverall.tp;
          }

          if (!isDirectional(rt.scalp_signal) || signalConflictScalp) {
            rt.scalp_signal = orb5DetSignal;
            const fixedScalp = coerceLevelsToSignal(rt.scalp_entry, rt.scalp_sl, rt.scalp_tp, rt.scalp_signal);
            rt.scalp_entry = fixedScalp.entry;
            rt.scalp_sl = fixedScalp.sl;
            rt.scalp_tp = fixedScalp.tp;
          }

          if (signalConflictOverall || signalConflictScalp) {
            rt.analysis_summary = `${rt.analysis_summary || ''} Señal ajustada por ORB 5m (${rt.orb5_status}) con validación histórica/confluente (score ${orb5SupportScore.toFixed(1)}).`.trim();
          }
        }
      }

      // ── INDEX CONFLUENCE ──
      let indexConfluenceBoost = 0;
      let marketDirectionLabel = '';
      if (indexData) {
        const tickerDir = curPrice && (realPrices?.prev_close ?? rt.prev_close)
          ? (curPrice > (realPrices?.prev_close ?? rt.prev_close) ? 'bullish' : 'bearish')
          : null;
        if (indexData.aligned && tickerDir === indexData.market_direction) {
          indexConfluenceBoost = 8; // strong confluence
          marketDirectionLabel = indexData.market_direction === 'bullish'
            ? 'Mercado alcista confirmado (SPY + QQQ + ticker alineados)'
            : 'Mercado bajista confirmado (SPY + QQQ + ticker alineados)';
        } else if (indexData.aligned) {
          indexConfluenceBoost = 3; // indices aligned but ticker diverges
          marketDirectionLabel = `Índices ${indexData.market_direction === 'bullish' ? 'alcistas' : 'bajistas'} — ticker diverge`;
        } else {
          indexConfluenceBoost = -3; // mixed market
          marketDirectionLabel = 'Mercado mixto (SPY y QQQ no coinciden) — precaución';
        }
      }

      // Merge real-time + historical into final result
      const isFilled = fillStatus === 'filled_100';

      const merged = {
        signal: rt.signal,
        entry_price: rt.entry_price,
        stop_loss: rt.stop_loss,
        take_profit: rt.take_profit,
        success_probability: rt.success_probability,
        analysis_summary: rt.analysis_summary,
        vix_level: rt.vix_level,
        vix_regime: rt.vix_regime,
        vix_change: rt.vix_change,
        vix_change_pct: rt.vix_change_pct,
        vix_impact: rt.vix_impact,
        vix_warning: vixWarning,
        vix_prob_penalty: vixProbPenalty,
        vix_min_rr: vixMinRR,
        market_context: rt.market_context,
        gap_analysis: {
          gap_type: rt.gap_type,
          previous_close: rt.prev_close,
          today_open: rt.today_open,
          today_high: rt.today_high,
          today_low: rt.today_low,
          current_price: rt.current_price,
          gap_size_usd: rt.gap_size_usd,
          gap_size_percent: rt.gap_size_percent,
          fill_status: rt.fill_status || 'unfilled',
          fill_percent_current: rt.fill_percent_current,
          // Historical probabilities from DB (or freshly computed)
          fill_probability_25: isFilled ? 100 : (hist?.gap_fill_25 ?? 85),
          fill_probability_50: isFilled ? 100 : (hist?.gap_fill_50 ?? 68),
          fill_probability_75: isFilled ? 100 : (hist?.gap_fill_75 ?? 48),
          fill_probability_100: isFilled ? 100 : (hist?.gap_fill_100 ?? 30),
          gap_entry_call: rt.gap_entry_call,
          gap_sl_call: rt.gap_sl_call,
          gap_tp_call: rt.gap_tp_call,
          gap_entry_put: rt.gap_entry_put,
          gap_sl_put: rt.gap_sl_put,
          gap_tp_put: rt.gap_tp_put,
          first_candle_1m:  rt._first_candle_1m  ?? null,
          first_candle_5m:  rt._first_candle_5m  ?? null,
          first_candle_15m: rt._first_candle_15m ?? null,
          // Multifactor gap breakdown from historical analysis
          sample_count: hist?.gap_sample_count ?? hist?.sample_count,
          gap_small_fill100: hist?.gap_small_fill100 ?? null,
          gap_moderate_fill100: hist?.gap_moderate_fill100 ?? null,
          gap_medium_fill100: hist?.gap_medium_fill100 ?? null,
          gap_large_fill100: hist?.gap_large_fill100 ?? null,
          gap_extreme_fill100: hist?.gap_extreme_fill100 ?? null,
          gap_up_fill100: hist?.gap_up_fill100 ?? null,
          gap_up_fill50: hist?.gap_up_fill50 ?? null,
          gap_down_fill100: hist?.gap_down_fill100 ?? null,
          gap_down_fill50: hist?.gap_down_fill50 ?? null,
          gap_low_vix_fill100: hist?.gap_low_vix_fill100 ?? null,
          gap_high_vix_fill100: hist?.gap_high_vix_fill100 ?? null,
          gap_high_vol_fill100: hist?.gap_high_vol_fill100 ?? null,
          gap_trend_aligned_fill100: hist?.gap_trend_aligned_fill100 ?? null,
          gap_trend_opposed_fill100: hist?.gap_trend_opposed_fill100 ?? null,
        },
        orb_5min: {
          high: rt.orb5_high, low: rt.orb5_low,
          status: rt.orb5_status,
          sample_count: hist?.sample_count,
          orb_sample_days: hist?.orb_sample_days,
          single_break_prob: hist?.orb5_single_break ?? 60,
          double_break_prob: hist?.orb5_double_break ?? 20,
          consolidation_prob: hist?.orb5_consolidation ?? 20,
          break_up_prob: hist?.orb5_break_up,
          break_down_prob: hist?.orb5_break_down,
          clean_break_prob: hist?.orb5_clean_break_prob,
          failed_break_prob: hist?.orb5_failed_break_prob,
          small_range_break: hist?.orb5_small_range_break,
          large_range_break: hist?.orb5_large_range_break,
          large_gap_day_penalty: hist?.orb5_large_gap_day_penalty,
          vol_confirm_boost: hist?.orb5_vol_confirm_boost,
          low_vix_boost: hist?.orb5_low_vix_boost,
          high_vix_penalty: hist?.orb5_high_vix_penalty,
          gap_confluence_boost: hist?.orb5_gap_confluence_boost,
          trending_market_break: hist?.orb5_trending_market_break,
          ranging_market_break: hist?.orb5_ranging_market_break,
          gamma_wall_boost: hist?.orb5_gamma_wall_boost,
          index_confirm_boost: hist?.orb5_index_confirm_boost,
          retest_prob: rt.orb5_retest_prob,
          extension_potential: rt.orb5_ext_potential,
          retracement_potential: rt.orb5_ret_potential
        },
        orb_15min: {
          high: rt.orb15_high, low: rt.orb15_low,
          status: rt.orb15_status,
          sample_count: hist?.sample_count,
          orb_sample_days: hist?.orb_sample_days,
          single_break_prob: hist?.orb15_single_break ?? 55,
          double_break_prob: hist?.orb15_double_break ?? 18,
          consolidation_prob: hist?.orb15_consolidation ?? 27,
          break_up_prob: hist?.orb15_break_up,
          break_down_prob: hist?.orb15_break_down,
          clean_break_prob: hist?.orb15_clean_break_prob,
          failed_break_prob: hist?.orb15_failed_break_prob,
          small_range_break: hist?.orb15_small_range_break,
          large_range_break: hist?.orb15_large_range_break,
          large_gap_day_penalty: hist?.orb15_large_gap_day_penalty,
          vol_confirm_boost: hist?.orb15_vol_confirm_boost,
          low_vix_boost: hist?.orb15_low_vix_boost,
          high_vix_penalty: hist?.orb15_high_vix_penalty,
          gap_confluence_boost: hist?.orb15_gap_confluence_boost,
          trending_market_break: hist?.orb15_trending_market_break,
          ranging_market_break: hist?.orb15_ranging_market_break,
          gamma_wall_boost: hist?.orb15_gamma_wall_boost,
          index_confirm_boost: hist?.orb15_index_confirm_boost,
          retest_prob: rt.orb15_retest_prob,
          extension_potential: rt.orb15_ext_potential,
          retracement_potential: rt.orb15_ret_potential
        },
        orb_30min: {
          high: rt.orb30_high, low: rt.orb30_low,
          status: rt.orb30_status,
          sample_count: hist?.sample_count,
          orb_sample_days: hist?.orb_sample_days,
          single_break_prob: hist?.orb30_single_break ?? 50,
          double_break_prob: hist?.orb30_double_break ?? 15,
          consolidation_prob: hist?.orb30_consolidation ?? 35,
          break_up_prob: hist?.orb30_break_up,
          break_down_prob: hist?.orb30_break_down,
          clean_break_prob: hist?.orb30_clean_break_prob,
          failed_break_prob: hist?.orb30_failed_break_prob,
          small_range_break: hist?.orb30_small_range_break,
          large_range_break: hist?.orb30_large_range_break,
          large_gap_day_penalty: hist?.orb30_large_gap_day_penalty,
          vol_confirm_boost: hist?.orb30_vol_confirm_boost,
          low_vix_boost: hist?.orb30_low_vix_boost,
          high_vix_penalty: hist?.orb30_high_vix_penalty,
          gap_confluence_boost: hist?.orb30_gap_confluence_boost,
          trending_market_break: hist?.orb30_trending_market_break,
          ranging_market_break: hist?.orb30_ranging_market_break,
          gamma_wall_boost: hist?.orb30_gamma_wall_boost,
          index_confirm_boost: hist?.orb30_index_confirm_boost,
          retest_prob: rt.orb30_retest_prob,
          extension_potential: rt.orb30_ext_potential,
          retracement_potential: rt.orb30_ret_potential
        },
        orb_1h: {
          high: rt.orb1h_high, low: rt.orb1h_low,
          status: rt.orb1h_status,
          sample_count: hist?.sample_count,
          orb_sample_days: hist?.orb_sample_days,
          single_break_prob: hist?.orb1h_single_break ?? 45,
          double_break_prob: hist?.orb1h_double_break ?? 12,
          consolidation_prob: hist?.orb1h_consolidation ?? 43,
          break_up_prob: hist?.orb1h_break_up,
          break_down_prob: hist?.orb1h_break_down,
          clean_break_prob: hist?.orb1h_clean_break_prob,
          failed_break_prob: hist?.orb1h_failed_break_prob,
          small_range_break: hist?.orb1h_small_range_break,
          large_range_break: hist?.orb1h_large_range_break,
          large_gap_day_penalty: hist?.orb1h_large_gap_day_penalty,
          vol_confirm_boost: hist?.orb1h_vol_confirm_boost,
          low_vix_boost: hist?.orb1h_low_vix_boost,
          high_vix_penalty: hist?.orb1h_high_vix_penalty,
          gap_confluence_boost: hist?.orb1h_gap_confluence_boost,
          trending_market_break: hist?.orb1h_trending_market_break,
          ranging_market_break: hist?.orb1h_ranging_market_break,
          gamma_wall_boost: hist?.orb1h_gamma_wall_boost,
          index_confirm_boost: hist?.orb1h_index_confirm_boost,
          retest_prob: rt.orb1h_retest_prob,
          extension_potential: rt.orb1h_ext_potential,
          retracement_potential: rt.orb1h_ret_potential
        },
        key_levels: {
          gamma_level: rt.gamma_level,
          call_wall: rt.call_wall,
          put_wall: rt.put_wall,
          gamma_flip: rt.gamma_flip,
          pivot_point: rt.pivot_point,
          prev_high: rt.prev_high,
          prev_low: rt.prev_low,
          prev_close: rt.prev_close,
          vwap: rt.vwap
        },
        scalp: {
          signal: rt.scalp_signal,
          entry: rt.scalp_entry,
          sl: rt.scalp_sl,
          tp: rt.scalp_tp,
          success_prob: rt.scalp_prob,
          summary: rt.scalp_summary,
          detail: rt.scalp_detail
        },
        intraday: {
          signal: rt.intraday_signal,
          entry: rt.intraday_entry,
          sl: rt.intraday_sl,
          tp: rt.intraday_tp,
          success_prob: rt.intraday_prob,
          summary: rt.intraday_summary,
          detail: rt.intraday_detail
        },
        risk_management: {
          max_risk_pct: rt.risk_max_pct,
          rr_ratio: rt.risk_rr_ratio,
          position_suggestion: rt.risk_position_suggestion
        },
        backtesting: {
          success_rate: rt.backtest_success_rate,
          summary: rt.backtest_summary,
          total_trades: rt.backtest_total,
          winning_trades: rt.backtest_wins,
          losing_trades: rt.backtest_losses
        },
        orb_stats_meta: {
          source: orbStatsSource,
          ttl_days: STATS_TTL_DAYS,
          last_analyzed: orbStatsLastAnalyzed,
          age_days: orbStatsAgeDays != null ? Number(orbStatsAgeDays.toFixed(2)) : null,
          stale: orbStatsIsStale,
          warning: orbStatsWarning,
        },
        bollinger: {
          bb_1m: intradayData?.bb_1m ?? null,
          bb_5m: intradayData?.bb_5m ?? null,
        },
        index_confluence: indexData ? {
          spy: indexData.spy,
          qqq: indexData.qqq,
          aligned: indexData.aligned,
          market_direction: indexData.market_direction,
          confluence_boost: indexConfluenceBoost,
          direction_label: marketDirectionLabel,
        } : null,
      };

      {
        const overallSignal = merged.signal;
        const scalpSignal = merged.scalp?.signal;
        const intradaySignal = merged.intraday?.signal;
        const activeSignals = [overallSignal, scalpSignal, intradaySignal].filter((v) => v === 'CALL' || v === 'PUT');
        const callVotes = activeSignals.filter((v) => v === 'CALL').length;
        const putVotes = activeSignals.filter((v) => v === 'PUT').length;
        const dominantDirection = callVotes === putVotes ? overallSignal : (callVotes > putVotes ? 'CALL' : 'PUT');

        const indexAlignedWithOverall = merged.index_confluence
          ? ((merged.index_confluence.market_direction === 'bullish' && overallSignal === 'CALL') || (merged.index_confluence.market_direction === 'bearish' && overallSignal === 'PUT'))
          : false;

        const contradictionReasons = [];
        if (scalpSignal && intradaySignal && scalpSignal !== intradaySignal) contradictionReasons.push('Scalp e Intraday no coinciden');
        if (overallSignal && scalpSignal && overallSignal !== scalpSignal) contradictionReasons.push('La señal general discrepa del scalp');
        if (overallSignal && intradaySignal && overallSignal !== intradaySignal) contradictionReasons.push('La señal general discrepa del intraday');
        if (merged.index_confluence && !merged.index_confluence.aligned) contradictionReasons.push('SPY y QQQ muestran mercado mixto');
        if (merged.index_confluence && merged.index_confluence.aligned && !indexAlignedWithOverall) contradictionReasons.push('La dirección del mercado no valida la señal principal');

        const strongContradiction = contradictionReasons.length >= 2;
        const highAlignment = !strongContradiction && overallSignal && scalpSignal && intradaySignal && overallSignal === scalpSignal && overallSignal === intradaySignal && (!merged.index_confluence || indexAlignedWithOverall);
        const sizeTier = strongContradiction ? 'small' : highAlignment ? 'large' : 'normal';
        const sizeGuidance = sizeTier === 'small'
          ? 'Usar tamaño bajo (25-40% del tamaño base): hay contradicción entre marcos o contexto mixto.'
          : sizeTier === 'large'
            ? 'Usar tamaño grande (80-100% del tamaño base): señal principal, scalp e intraday alineados.'
            : 'Usar tamaño normal (50-70% del tamaño base): oportunidad operable con consenso parcial.';

        const setupGrade = strongContradiction ? 'C' : highAlignment ? 'A+' : (merged.success_probability >= 70 ? 'B+' : 'B');
        const entryAlert = strongContradiction
          ? `Se emite ${overallSignal} pero con alerta: ${contradictionReasons.join(' | ')}. No es setup A+; esperar confirmación adicional o ejecutar solo con tamaño bajo.`
          : null;
        const contextMismatchExplanation = strongContradiction
          ? `La estrategia puede ser correcta, pero no en este contexto de mercado: ${contradictionReasons.join('; ')}.`
          : 'El contexto de mercado acompaña razonablemente la estrategia dominante.';

        merged.window_consensus = {
          overall_signal: overallSignal || null,
          scalp_signal: scalpSignal || null,
          intraday_signal: intradaySignal || null,
          dominant_direction: dominantDirection || null,
          strong_contradiction: strongContradiction,
          high_alignment: highAlignment,
          size_tier: sizeTier,
          size_guidance: sizeGuidance,
          warning: entryAlert,
          context_mismatch_explanation: contextMismatchExplanation,
          setup_grade: setupGrade,
        };

        merged.entry_alert = entryAlert;
        merged.setup_grade = setupGrade;
        merged.analysis_meta = {
          source_window: 'probabilities',
          overall_signal: overallSignal || null,
          dominant_direction: dominantDirection || null,
          setup_grade: setupGrade,
          entry_alert: entryAlert,
          execution_tier: sizeTier,
          size_tier: sizeTier,
          size_guidance: sizeGuidance,
          context_mismatch_explanation: contextMismatchExplanation,
          scalp_signal: scalpSignal || null,
          intraday_signal: intradaySignal || null,
        };
        if (merged.risk_management) {
          merged.risk_management.position_suggestion = `${merged.risk_management.position_suggestion || ''} ${sizeGuidance}`.trim();
        }
      }

      try {
        const ml = await inferMlProbabilityFromPayload(merged, { sourceWindow: 'probabilities', ticker: t });
        if (ml) {
          merged.ml = ml;
          if (!merged.analysis_meta) merged.analysis_meta = {};
          merged.analysis_meta.ml_probability = ml.ml_probability;
          merged.analysis_meta.ml_threshold = ml.threshold;
          merged.analysis_meta.ml_pass_filter = ml.pass_filter;
          merged.analysis_meta.ml_samples = ml.samples_used;
          merged.analysis_meta.ml_confidence = ml.confidence_tier;
          if (merged.window_consensus) {
            merged.window_consensus.ml_probability = ml.ml_probability;
            merged.window_consensus.ml_filter = ml.pass_filter;
            merged.window_consensus.ml_samples = ml.samples_used;
            merged.window_consensus.ml_note = ml.note;
          }
          if (ml.pass_filter === false) {
            const mlWarn = `Filtro ML: probabilidad ${(ml.ml_probability * 100).toFixed(1)}% (< ${(ml.threshold * 100).toFixed(0)}%). Señal mantenida en modo defensivo.`;
            merged.entry_alert = [merged.entry_alert, mlWarn].filter(Boolean).join(' ');
          }
        }
      } catch (mlErr) {
        console.warn('ML inference failed for Probabilities:', mlErr?.message || mlErr);
      }

      dispatch({ type: 'SET_RESULT', result: merged, ticker: t, lastUpdated: new Date().toLocaleString() });
      toast.success(`Análisis de ${t} completado`);
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('Error 404: faltan recursos backend (funciones o entidades Base44) para este proyecto.');
      } else {
        toast.error('Error: ' + getReadableError(err));
      }
    } finally {
      setIsLoading(false);
      setLoadingStage('');
    }
  };

  const saveAnalysis = async () => {
    if (!analysisResult || !ticker) return;
    if (!hasBase44Config()) {
      toast.error('No se puede guardar: falta configurar Base44 en .env.local');
      return;
    }
    try {
      const savedAnalysis = await base44.entities.Analysis.create({
        ticker: ticker.toUpperCase(),
        type: 'probability',
        signal: analysisResult.signal,
        entry_price: analysisResult.entry_price,
        stop_loss: analysisResult.stop_loss,
        take_profit: analysisResult.take_profit,
        success_probability: analysisResult.success_probability,
        analysis_data: JSON.stringify(analysisResult),
        last_updated: lastUpdated,
      });
      try {
        await upsertMlTradeSampleFromAnalysis(savedAnalysis);
      } catch (syncErr) {
        console.warn('ML dataset sync failed for Probabilities:', syncErr?.message || syncErr);
      }
      try {
        await saveSignalsFromAnalysis({
          ticker,
          analysisType: 'probability',
          analysisResult,
          savedAnalysisId: savedAnalysis?.id,
        });
      } catch (signalErr) {
        console.warn('Signal log sync failed for Probabilities:', signalErr?.message || signalErr);
      }
      toast.success('Análisis guardado');
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('No se pudo guardar: la entidad Analysis no existe en el backend Base44.');
      } else {
        toast.error('Error al guardar');
      }
    }
  };

  return { ticker, setTicker, isLoading, loadingStage, analysisResult, lastUpdated, analyze, saveAnalysis };

}