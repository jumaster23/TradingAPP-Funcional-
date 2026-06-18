import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { hasBase44Config, getBase44ConfigError, isNotFoundError, getReadableError } from '@/lib/backendGuard';
import { validateLevels } from '@/utils/validateLevels';
import { inferMlProbabilityFromPayload, upsertMlTradeSampleFromAnalysis } from '@/lib/mlDataset';
import { saveSignalsFromAnalysis } from '@/lib/signalLog';

export function useAnalysis(analysisType) {
  const [ticker, setTicker] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const analyze = async (customPrompt) => {
    if (!ticker) return;
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }
    setIsLoading(true);
    try {
      // Fetch real-time prices from Yahoo Finance via backend
      let realPrices = null;
      try {
        const priceRes = await base44.functions.invoke('getStockPrice', { ticker: ticker.toUpperCase() });
        realPrices = priceRes?.data;
      } catch (e) {
        console.warn('Price fetch failed, LLM will estimate:', e.message);
      }

      const priceHint = realPrices
        ? `USA ESTOS PRECIOS EXACTOS en tiempo real (obtenidos de Yahoo Finance, NO los sobreescribas):
prev_close=${realPrices.prev_close}, today_open=${realPrices.today_open ?? 'N/A'}, today_high=${realPrices.today_high}, today_low=${realPrices.today_low}, current_price=${realPrices.current_price}

`
        : '';

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: priceHint + customPrompt,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
            entry_price: { type: 'number' },
            stop_loss: { type: 'number' },
            take_profit: { type: 'number' },
            success_probability: { type: 'number' },
            analysis_summary: { type: 'string' },
            gap_analysis: {
              type: 'object',
              properties: {
                gap_type: { type: 'string' },
                previous_close: { type: 'number' },
                today_open: { type: 'number' },
                today_high: { type: 'number' },
                today_low: { type: 'number' },
                current_price: { type: 'number' },
                gap_size_usd: { type: 'number' },
                gap_size_percent: { type: 'number' },
                fill_status: { type: 'string' },
                fill_percent_current: { type: 'number' },
                fill_probability_25: { type: 'number' },
                fill_probability_50: { type: 'number' },
                fill_probability_75: { type: 'number' },
                fill_probability_100: { type: 'number' },
                gap_entry_call: { type: 'number' },
                gap_sl_call: { type: 'number' },
                gap_tp_call: { type: 'number' },
                gap_entry_put: { type: 'number' },
                gap_sl_put: { type: 'number' },
                gap_tp_put: { type: 'number' }
              }
            },
            orb_5min: {
              type: 'object',
              properties: {
                single_break_prob: { type: 'number' },
                double_break_prob: { type: 'number' },
                consolidation_prob: { type: 'number' },
                extension_potential: { type: 'number' },
                retracement_potential: { type: 'number' },
                retest_prob: { type: 'number' },
                no_retest_prob: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' }
              }
            },
            orb_15min: {
              type: 'object',
              properties: {
                single_break_prob: { type: 'number' },
                double_break_prob: { type: 'number' },
                consolidation_prob: { type: 'number' },
                extension_potential: { type: 'number' },
                retracement_potential: { type: 'number' },
                retest_prob: { type: 'number' },
                no_retest_prob: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' }
              }
            },
            orb_30min: {
              type: 'object',
              properties: {
                single_break_prob: { type: 'number' },
                double_break_prob: { type: 'number' },
                consolidation_prob: { type: 'number' },
                extension_potential: { type: 'number' },
                retracement_potential: { type: 'number' },
                retest_prob: { type: 'number' },
                no_retest_prob: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' }
              }
            },
            orb_1h: {
              type: 'object',
              properties: {
                single_break_prob: { type: 'number' },
                double_break_prob: { type: 'number' },
                consolidation_prob: { type: 'number' },
                extension_potential: { type: 'number' },
                retracement_potential: { type: 'number' },
                retest_prob: { type: 'number' },
                no_retest_prob: { type: 'number' },
                high: { type: 'number' },
                low: { type: 'number' }
              }
            },
            gamma_flip: { type: 'number' },
            max_pain: { type: 'number' },
            oi_call_dominant: { type: 'boolean' },
            oi_interpretation: { type: 'string' },
            gamma_context: { type: 'string' },
            market_context: { type: 'string' },
            vix_level: { type: 'number' },
            key_levels: {
              type: 'object',
              properties: {
                gamma_level: { type: 'number' },
                call_wall: { type: 'number' },
                put_wall: { type: 'number' },
                gamma_flip: { type: 'number' },
                max_pain: { type: 'number' },
                pivot_point: { type: 'number' },
                prev_high: { type: 'number' },
                prev_low: { type: 'number' },
                prev_close: { type: 'number' },
                vwap: { type: 'number' }
              }
            },
            scalp: {
              type: 'object',
              properties: {
                signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
                entry: { type: 'number' },
                sl: { type: 'number' },
                tp: { type: 'number' },
                success_prob: { type: 'number' },
                summary: { type: 'string' },
                detail: { type: 'string' }
              }
            },
            intraday: {
              type: 'object',
              properties: {
                signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
                entry: { type: 'number' },
                sl: { type: 'number' },
                tp: { type: 'number' },
                success_prob: { type: 'number' },
                summary: { type: 'string' },
                detail: { type: 'string' }
              }
            },
            risk_management: {
              type: 'object',
              properties: {
                max_risk_pct: { type: 'number' },
                rr_ratio: { type: 'string' },
                position_suggestion: { type: 'string' }
              }
            },
            backtesting: {
              type: 'object',
              properties: {
                success_rate: { type: 'number' },
                summary: { type: 'string' },
                total_trades: { type: 'number' },
                winning_trades: { type: 'number' },
                losing_trades: { type: 'number' }
              }
            },
            swing_checklist: {
              type: 'object',
              properties: {
                chk_trend_daily: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_trend_weekly: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_support_level: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_volume: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_open_interest: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_gamma_alignment: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_index_confluence: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_rr_ratio: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_vix_favorable: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } },
                chk_no_catalyst_risk: { type: 'object', properties: { passes: { type: 'boolean' }, note: { type: 'string' } } }
              }
            },
            williams_r: {
              type: 'object',
              properties: {
                daily: { type: 'number' },
                weekly: { type: 'number' },
                interpretation: { type: 'string' },
                swing_quality: { type: 'boolean' },
                signal_note: { type: 'string' },
                call_signal_active: { type: 'boolean' },
                put_signal_active: { type: 'boolean' },
                call_confirmations: {
                  type: 'object',
                  properties: {
                    confirmed_candle: { type: 'boolean' },
                    confirmed_volume: { type: 'boolean' },
                    confirmed_trend: { type: 'boolean' }
                  }
                },
                put_confirmations: {
                  type: 'object',
                  properties: {
                    confirmed_candle: { type: 'boolean' },
                    confirmed_volume: { type: 'boolean' }
                  }
                }
              }
            },
            finviz_data: {
              type: 'object',
              properties: {
                rsi: { type: 'number' },
                macd: { type: 'string' },
                sma20_signal: { type: 'string' },
                sma50_signal: { type: 'string' },
                sma200_signal: { type: 'string' },
                analyst_rating: { type: 'string' },
                price_target: { type: 'number' },
                short_float: { type: 'number' },
                volume_ratio: { type: 'number' },
                atr: { type: 'number' },
                beta: { type: 'number' },
                sector: { type: 'string' },
                industry: { type: 'string' },
                summary: { type: 'string' }
              }
            },
            failure_reasons: { type: 'array', items: { type: 'string' } },
            improvement_suggestion: { type: 'string' },
            swing_methodology: {
              type: 'object',
              properties: {
                signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
                entry_price: { type: 'number' },
                stop_loss: { type: 'number' },
                take_profit: { type: 'number' },
                success_prob: { type: 'number' },
                summary: { type: 'string' },
                daily: {
                  type: 'object',
                  properties: {
                    trend: { type: 'string' }, structure: { type: 'string' },
                    ema200: { type: 'number' }, ema50: { type: 'number' }, rsi: { type: 'number' },
                    price_above_ema200: { type: 'boolean' }, ema50_above_ema200: { type: 'boolean' },
                    rsi_in_zone: { type: 'boolean' }, trend_clear: { type: 'boolean' },
                    price_below_ema200: { type: 'boolean' }, ema50_below_ema200: { type: 'boolean' },
                    rsi_weak: { type: 'boolean' }, bearish_trend: { type: 'boolean' },
                    note: { type: 'string' }
                  }
                },
                tf4h: {
                  type: 'object',
                  properties: {
                    ema50: { type: 'number' }, status: { type: 'string' },
                    pullback_to_ema50: { type: 'boolean' }, support_respected: { type: 'boolean' },
                    no_bearish_break: { type: 'boolean' }, pullback_to_resistance: { type: 'boolean' },
                    resistance_holding: { type: 'boolean' }, bearish_pressure: { type: 'boolean' },
                    note: { type: 'string' }
                  }
                },
                tf1h: {
                  type: 'object',
                  properties: {
                    micro_level: { type: 'number' }, ready: { type: 'boolean' }, volume_confirms: { type: 'boolean' },
                    strong_bullish_candle: { type: 'boolean' }, micro_resistance_break: { type: 'boolean' },
                    rejection_candle: { type: 'boolean' }, bearish_entry_confirmed: { type: 'boolean' },
                    note: { type: 'string' }
                  }
                },
                context: {
                  type: 'object',
                  properties: {
                    spx_direction: { type: 'string' }, spx_note: { type: 'string' },
                    vix_value: { type: 'number' }, vix_regime: { type: 'string' }, vix_note: { type: 'string' },
                    call_wall: { type: 'number' }, put_wall: { type: 'number' },
                    gamma_level: { type: 'number' }, gamma_note: { type: 'string' }
                  }
                },
                risk: {
                  type: 'object',
                  properties: {
                    max_risk_pct: { type: 'number' }, rr_ratio: { type: 'string' },
                    breakeven_trigger: { type: 'string' }, position_suggestion: { type: 'string' },
                    invalidation: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      });
      // Validate entry/SL/TP against real price — fix any LLM hallucinated levels
      if (realPrices?.current_price) {
        result.current_price = realPrices.current_price;
        const validated = validateLevels(result, { maxEntryPct: 0.08, maxSlPct: 0.10, minRR: 2 });
        result.entry_price = validated.entry_price;
        result.stop_loss = validated.stop_loss;
        result.take_profit = validated.take_profit;
        // Also validate swing_methodology levels if present
        if (result.swing_methodology) {
          const swm = { ...result.swing_methodology, current_price: realPrices.current_price };
          const vSwm = validateLevels(swm, { maxEntryPct: 0.08, maxSlPct: 0.10, minRR: 2 });
          result.swing_methodology = { ...result.swing_methodology, entry_price: vSwm.entry_price, stop_loss: vSwm.stop_loss, take_profit: vSwm.take_profit };
        }
      }

      if (analysisType === 'swing') {
        const swm = result.swing_methodology || {};
        const dailyTrend = swm.daily?.trend || result.daily?.trend || null;
        const tf4hTrend = swm.tf4h?.trend || swm.tf4h?.status || null;
        const tf1hReady = swm.tf1h?.ready;
        const weeklyTrend = swm.context?.spx_direction || swm.macro?.weekly_trend || null;
        const signal = result.signal || swm.signal || null;
        const dir = signal === 'CALL' ? 'BULLISH' : signal === 'PUT' ? 'BEARISH' : null;

        const contradictionReasons = [];
        if (dir && dailyTrend && dailyTrend !== dir) contradictionReasons.push('La capa diaria no confirma la dirección principal');
        if (dir && tf4hTrend && tf4hTrend !== dir && tf4hTrend !== 'READY_CALL' && tf4hTrend !== 'READY_PUT') contradictionReasons.push('La estructura 4H no acompaña la señal');
        if (dir && weeklyTrend && weeklyTrend !== dir && weeklyTrend !== 'NEUTRAL') contradictionReasons.push('El contexto macro/semanal no valida el swing');
        if (tf1hReady === false) contradictionReasons.push('La entrada fina en 1H aún no está lista');
        if (Array.isArray(result.failure_reasons) && result.failure_reasons.length) contradictionReasons.push(...result.failure_reasons.slice(0, 2));

        const strongContradiction = contradictionReasons.length >= 2;
        const highAlignment = !strongContradiction && dir && (dailyTrend === dir || !dailyTrend) && (weeklyTrend === dir || weeklyTrend === 'NEUTRAL' || !weeklyTrend) && tf1hReady !== false;
        const sizeTier = strongContradiction ? 'small' : highAlignment ? 'large' : 'normal';
        const sizeGuidance = sizeTier === 'small'
          ? 'Usar tamaño bajo (25-40% del tamaño base): swing válido solo en modo defensivo por contexto incompleto o contradictorio.'
          : sizeTier === 'large'
            ? 'Usar tamaño grande (80-100% del tamaño base): las capas 4H/diario/macro están alineadas.'
            : 'Usar tamaño normal (50-70% del tamaño base): hay estructura operable pero no perfecta.';
        const setupGrade = strongContradiction ? 'C' : highAlignment ? 'A+' : (Number(result.success_probability || 0) >= 70 ? 'B+' : 'B');

        result.window_consensus = {
          overall_signal: signal,
          daily_trend: dailyTrend,
          tf4h_trend: tf4hTrend,
          weekly_trend: weeklyTrend,
          tf1h_ready: tf1hReady,
          strong_contradiction: strongContradiction,
          high_alignment: highAlignment,
          size_tier: sizeTier,
          size_guidance: sizeGuidance,
          setup_grade: setupGrade,
          warning: strongContradiction
            ? `Señal ${signal} emitida con alerta: ${contradictionReasons.join(' | ')}. No es setup A+ para swing.`
            : null,
          context_mismatch_explanation: strongContradiction
            ? `La estrategia puede ser correcta, pero en un contexto de mercado incorrecto para swing: ${contradictionReasons.join('; ')}.`
            : 'El contexto multi-timeframe respalda razonablemente la idea swing.',
        };
        result.entry_alert = result.window_consensus.warning || null;
        result.setup_grade = setupGrade;
        result.analysis_meta = {
          source_window: analysisType,
          overall_signal: signal,
          setup_grade: setupGrade,
          entry_alert: result.entry_alert,
          execution_tier: sizeTier,
          size_tier: sizeTier,
          size_guidance: sizeGuidance,
          context_mismatch_explanation: result.window_consensus.context_mismatch_explanation,
          daily_trend: dailyTrend || null,
          tf4h_trend: tf4hTrend || null,
          weekly_trend: weeklyTrend || null,
          tf1h_ready: tf1hReady,
        };

        const baseRiskText = result.swing_methodology?.risk?.position_suggestion || result.risk_management?.position_suggestion || '';
        const mergedRiskText = `${baseRiskText} ${sizeGuidance}`.trim();
        if (result.swing_methodology?.risk) result.swing_methodology.risk.position_suggestion = mergedRiskText;
        if (result.risk_management) result.risk_management.position_suggestion = mergedRiskText;
        if (strongContradiction) {
          result.improvement_suggestion = [result.improvement_suggestion, 'Esperar alineación entre 4H, diario y timing 1H antes de usar tamaño normal o grande.'].filter(Boolean).join(' ');
        }
      }

      try {
        const ml = await inferMlProbabilityFromPayload(result, { sourceWindow: analysisType, ticker });
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
            const mlWarn = `Filtro ML: probabilidad ${(ml.ml_probability * 100).toFixed(1)}% (< ${(ml.threshold * 100).toFixed(0)}%). Mejor esperar confirmación adicional.`;
            result.entry_alert = [result.entry_alert, mlWarn].filter(Boolean).join(' ');
          }
        }
      } catch (mlErr) {
        console.warn('ML inference failed for generic analysis:', mlErr?.message || mlErr);
      }

      setAnalysisResult(result);
      setLastUpdated(new Date().toLocaleString());
      toast.success(`Análisis de ${ticker} completado`);
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('Error 404: faltan recursos backend (funciones o entidades Base44) para este proyecto.');
      } else {
        toast.error('Error al analizar: ' + getReadableError(err));
      }
    } finally {
      setIsLoading(false);
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
        ticker,
        type: analysisType,
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
        console.warn('ML dataset sync failed for generic analysis:', syncErr?.message || syncErr);
      }
        try {
          await saveSignalsFromAnalysis({
            ticker,
            analysisType,
            analysisResult,
            savedAnalysisId: savedAnalysis?.id,
          });
        } catch (signalErr) {
          console.warn('Signal log sync failed for generic analysis:', signalErr?.message || signalErr);
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

  return { ticker, setTicker, isLoading, analysisResult, lastUpdated, analyze, saveAnalysis, setAnalysisResult };
}