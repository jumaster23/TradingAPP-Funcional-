import React, { useState } from 'react';
import TickerInput from '../components/trading/TickerInput';
import SignalBadge from '../components/trading/SignalBadge';
import TradeLevels from '../components/trading/TradeLevels';
import ProbabilityBar from '../components/trading/ProbabilityBar';
import BacktestModal from '../components/trading/BacktestModal';
import InfoModal from '../components/trading/InfoModal';
import { useAnalysis } from '../hooks/useAnalysis';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Radar, Info, Loader2, Layers, TrendingUp, TrendingDown, Target } from 'lucide-react';
import SwingChecklist from '../components/swing/SwingChecklist';
import WilliamsR from '../components/swing/WilliamsR';
import FinvizPanel from '../components/swing/FinvizPanel';
import LeapsModule from '../components/swing/LeapsModule';
import LeapsScanner from '../components/swing/LeapsScanner';
import SwingMethodology from '../components/swing/SwingMethodology';
import ConsensusPanel from '../components/trading/ConsensusPanel';
import { toast } from 'sonner';
import { hasBase44Config, getBase44ConfigError, isNotFoundError, getReadableError } from '@/lib/backendGuard';
import { validateLevels } from '@/utils/validateLevels';

const USE_LLM_SCANNERS = String(import.meta.env.VITE_SWING_USE_LLM_SCANNERS || 'false').toLowerCase() === 'true';

const SWING_SCAN_UNIVERSE = [
  { ticker: 'AAPL', name: 'Apple', sector: 'Technology' },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'Technology' },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'Semiconductors' },
  { ticker: 'AMZN', name: 'Amazon', sector: 'Consumer Discretionary' },
  { ticker: 'META', name: 'Meta Platforms', sector: 'Communication Services' },
  { ticker: 'GOOGL', name: 'Alphabet', sector: 'Communication Services' },
  { ticker: 'TSLA', name: 'Tesla', sector: 'Consumer Discretionary' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', sector: 'Semiconductors' },
  { ticker: 'NFLX', name: 'Netflix', sector: 'Communication Services' },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'Financials' },
  { ticker: 'AVGO', name: 'Broadcom', sector: 'Semiconductors' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', sector: 'ETF' },
];

const LEAPS_SCAN_UNIVERSE = [
  { ticker: 'AAPL', name: 'Apple', sector: 'Technology', fundamentals_ok: true },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'Technology', fundamentals_ok: true },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'Semiconductors', fundamentals_ok: true },
  { ticker: 'AMZN', name: 'Amazon', sector: 'Consumer Discretionary', fundamentals_ok: true },
  { ticker: 'META', name: 'Meta Platforms', sector: 'Communication Services', fundamentals_ok: true },
  { ticker: 'GOOGL', name: 'Alphabet', sector: 'Communication Services', fundamentals_ok: true },
  { ticker: 'AVGO', name: 'Broadcom', sector: 'Semiconductors', fundamentals_ok: true },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', sector: 'Semiconductors', fundamentals_ok: true },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', fundamentals_ok: true },
  { ticker: 'XOM', name: 'Exxon Mobil', sector: 'Energy', fundamentals_ok: true },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildLocalTradeLevels(price, signal, nearLevel, farLevel, rr) {
  const entry = signal === 'PUT'
    ? Math.max(price * 1.005, nearLevel ?? price * 1.005)
    : Math.min(price * 0.995, nearLevel ?? price * 0.995);

  const stopLoss = signal === 'PUT'
    ? Math.max(entry * 1.04, farLevel ?? entry * 1.04)
    : Math.min(entry * 0.96, farLevel ?? entry * 0.96);

  const risk = Math.max(Math.abs(entry - stopLoss), price * 0.015);
  const takeProfit = signal === 'PUT'
    ? entry - risk * rr
    : entry + risk * rr;

  return {
    entry_price: Number(entry.toFixed(2)),
    stop_loss: Number(stopLoss.toFixed(2)),
    take_profit: Number(takeProfit.toFixed(2)),
  };
}

function buildExecutionMeta({ successProbability, checksPassed = 0, totalChecks = 0, reasons = [], aligned = false }) {
  const setupGrade = successProbability >= 80 && aligned ? 'A+' : successProbability >= 70 ? 'B+' : successProbability >= 60 ? 'B' : 'C';
  const executionTier = setupGrade === 'A+' ? 'large' : setupGrade === 'C' ? 'small' : 'normal';
  const sizeGuidance = executionTier === 'large'
    ? 'Tamaño grande (80-100% del tamaño base).'
    : executionTier === 'small'
      ? 'Tamaño bajo (25-40% del tamaño base).'
      : 'Tamaño normal (50-70% del tamaño base).';
  const entryAlert = setupGrade === 'C'
    ? `No es setup A+: ${reasons.filter(Boolean).join(' | ') || 'faltan confirmaciones suficientes'}. Operar solo si aceptas contexto subóptimo y con tamaño bajo.`
    : setupGrade === 'B'
      ? `Señal operable pero no premium: ${reasons.filter(Boolean).join(' | ') || 'consenso parcial'}.`
      : null;

  return {
    setup_grade: setupGrade,
    execution_tier: executionTier,
    size_guidance: sizeGuidance,
    entry_alert: entryAlert,
    checklist_score: totalChecks ? `${checksPassed}/${totalChecks}` : null,
  };
}

function enrichSwingScannerItem(item) {
  const checks = [item.daily_ok, item.weekly_ok, item.monthly_ok, item.fundamentals_ok];
  const checksPassed = checks.filter(Boolean).length;
  const reasons = [];
  if (!item.daily_ok) reasons.push('diario no confirma');
  if (!item.weekly_ok) reasons.push('semanal no confirma');
  if (!item.monthly_ok) reasons.push('mensual no confirma');
  if (!item.fundamentals_ok) reasons.push('fundamentos débiles');
  return {
    ...item,
    ...buildExecutionMeta({
      successProbability: Number(item.success_probability || 0),
      checksPassed,
      totalChecks: 4,
      reasons,
      aligned: checksPassed >= 4,
    }),
  };
}

function enrichLeapsItem(item) {
  const checks = [item.daily_ok, item.weekly_ok, item.monthly_ok, item.fundamentals_ok];
  const checksPassed = checks.filter(Boolean).length;
  const reasons = [];
  if (!item.daily_ok) reasons.push('capa diaria incompleta');
  if (!item.weekly_ok) reasons.push('macro semanal no valida');
  if (!item.monthly_ok) reasons.push('confirmación mensual insuficiente');
  if (!item.fundamentals_ok) reasons.push('filtro fundamental no óptimo');
  return {
    ...item,
    ...buildExecutionMeta({
      successProbability: Number(item.success_probability || item.success_prob || 0),
      checksPassed,
      totalChecks: 4,
      reasons,
      aligned: checksPassed >= 4,
    }),
  };
}

function enrichLeapsAnalysis(item) {
  if (!item) return item;
  const checks = [
    item.daily?.price_above_both_emas || item.daily?.golden_cross || item.daily?.death_cross,
    item.macro?.weekly_trend === 'BULLISH' || item.macro?.weekly_trend === 'BEARISH',
    item.confirmation?.monthly_trend === 'BULLISH' || item.confirmation?.monthly_trend === 'BEARISH',
    item.fundamentals?.fundamentals_pass,
  ];
  const checksPassed = checks.filter(Boolean).length;
  const reasons = [];
  if (!(item.daily?.price_above_both_emas || item.daily?.golden_cross || item.daily?.death_cross)) reasons.push('capa diaria sin ventaja clara');
  if (!(item.macro?.weekly_trend === 'BULLISH' || item.macro?.weekly_trend === 'BEARISH')) reasons.push('macro semanal neutral');
  if (!(item.confirmation?.monthly_trend === 'BULLISH' || item.confirmation?.monthly_trend === 'BEARISH')) reasons.push('confirmación mensual débil');
  if (!item.fundamentals?.fundamentals_pass) reasons.push('fundamentos no ideales');
  return {
    ...item,
    ...buildExecutionMeta({
      successProbability: Number(item.success_prob || 0),
      checksPassed,
      totalChecks: 4,
      reasons,
      aligned: checksPassed >= 4,
    }),
  };
}

async function buildLocalSwingScannerResults() {
  const results = await Promise.allSettled(
    SWING_SCAN_UNIVERSE.map(async ({ ticker, name, sector }) => {
      const [priceRes, intradayRes] = await Promise.allSettled([
        base44.functions.invoke('getStockPrice', { ticker }),
        base44.functions.invoke('getIntradayData', { ticker }),
      ]);

      const price = priceRes.status === 'fulfilled' ? priceRes.value?.data : null;
      const intraday = intradayRes.status === 'fulfilled' ? intradayRes.value?.data : null;
      if (!price?.current_price || !intraday) return null;

      const bullScore =
        (intraday.trend_4h === 'BULLISH' ? 2 : 0) +
        (intraday.trend_1h === 'BULLISH' ? 2 : 0) +
        (intraday.trend_15m === 'BULLISH' ? 1 : 0) +
        (intraday.volume_confirms_15m ? 1 : 0) +
        (intraday.volume_confirms ? 1 : 0) +
        (price.current_price > (intraday.ema20_1h ?? price.current_price) ? 1 : 0);

      const bearScore =
        (intraday.trend_4h === 'BEARISH' ? 2 : 0) +
        (intraday.trend_1h === 'BEARISH' ? 2 : 0) +
        (intraday.trend_15m === 'BEARISH' ? 1 : 0) +
        (intraday.volume_confirms_15m ? 1 : 0) +
        (intraday.volume_confirms ? 1 : 0) +
        (price.current_price < (intraday.ema20_1h ?? price.current_price) ? 1 : 0);

      const signal = bullScore >= bearScore ? 'CALL' : 'PUT';
      const score = Math.max(bullScore, bearScore);
      if (score < 4) return null;

      const support = intraday.sr_1h?.supports?.[0] ?? null;
      const resistance = intraday.sr_1h?.resistances?.[0] ?? null;
      const levels = signal === 'CALL'
        ? buildLocalTradeLevels(price.current_price, signal, intraday.ema20_1h ?? support, intraday.ema50_1h ?? support, 2.2)
        : buildLocalTradeLevels(price.current_price, signal, intraday.ema20_1h ?? resistance, intraday.ema50_1h ?? resistance, 2.2);

      const successProbability = clamp(44 + score * 7 + (intraday.engulfing_15m?.startsWith(signal === 'CALL' ? 'BULLISH' : 'BEARISH') ? 5 : 0), 55, 88);
      const item = validateLevels({
        ticker,
        name,
        sector,
        signal,
        current_price: price.current_price,
        success_probability: successProbability,
        ema_status: `4h ${intraday.trend_4h || 'N/A'} · 1h ${intraday.trend_1h || 'N/A'} · 15m ${intraday.trend_15m || 'N/A'}`,
        open_interest_note: 'Modo local activo: el scanner usa precio e intradía de Yahoo; gamma/OI se omitió por fallos del proveedor externo.',
        reason: signal === 'CALL'
          ? `Tendencia alineada al alza en 4h/1h con apoyo intradía${intraday.volume_confirms_15m ? ' y volumen de 15m' : ''}. La entrada se aproxima a EMA 20 de 1h o soporte reciente.`
          : `Tendencia alineada a la baja en 4h/1h con presión intradía${intraday.volume_confirms_15m ? ' y volumen de 15m' : ''}. La entrada se aproxima a EMA 20 de 1h o resistencia reciente.`,
        ...levels,
      }, { maxEntryPct: 0.08, maxSlPct: 0.08, minRR: 2 });

      return item;
    })
  );

  return results
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value)
    .sort((a, b) => (b.success_probability || 0) - (a.success_probability || 0))
    .slice(0, 8);
}

async function buildLocalLeapsScannerResults() {
  const results = await Promise.allSettled(
    LEAPS_SCAN_UNIVERSE.map(async ({ ticker, name, sector, fundamentals_ok }) => {
      const [priceRes, profileRes] = await Promise.allSettled([
        base44.functions.invoke('getStockPrice', { ticker }),
        base44.functions.invoke('getTrendProfile', { ticker }),
      ]);

      const price = priceRes.status === 'fulfilled' ? priceRes.value?.data : null;
      const profile = profileRes.status === 'fulfilled' ? profileRes.value?.data : null;
      if (!price?.current_price || !profile?.daily || !profile?.weekly || !profile?.monthly) return null;

      const daily = profile.daily;
      const weekly = profile.weekly;
      const monthly = profile.monthly;
      const bullScore =
        (daily.trend === 'BULLISH' ? 2 : 0) +
        (weekly.trend === 'BULLISH' ? 2 : 0) +
        (monthly.trend !== 'BEARISH' ? 1 : 0) +
        (daily.price_above_ema50 ? 1 : 0) +
        ((daily.rsi ?? 0) >= 50 && (daily.rsi ?? 0) <= 68 ? 1 : 0) +
        (fundamentals_ok ? 1 : 0);
      const bearScore =
        (daily.trend === 'BEARISH' ? 2 : 0) +
        (weekly.trend === 'BEARISH' ? 2 : 0) +
        (monthly.trend !== 'BULLISH' ? 1 : 0) +
        (daily.price_above_ema50 === false ? 1 : 0) +
        ((daily.rsi ?? 100) <= 48 ? 1 : 0) +
        (fundamentals_ok ? 1 : 0);

      const signal = bullScore >= bearScore ? 'CALL' : 'PUT';
      const score = Math.max(bullScore, bearScore);
      if (score < 5) return null;

      const levels = signal === 'CALL'
        ? buildLocalTradeLevels(price.current_price, signal, daily.ema50 ?? price.current_price * 0.98, daily.ema200 ?? price.current_price * 0.92, 3)
        : buildLocalTradeLevels(price.current_price, signal, daily.ema50 ?? price.current_price * 1.02, daily.ema200 ?? price.current_price * 1.08, 3);

      return {
        ticker,
        name,
        sector,
        signal,
        current_price: price.current_price,
        daily_ok: signal === 'CALL' ? daily.trend === 'BULLISH' : daily.trend === 'BEARISH',
        weekly_ok: signal === 'CALL' ? weekly.trend === 'BULLISH' : weekly.trend === 'BEARISH',
        monthly_ok: signal === 'CALL' ? monthly.trend !== 'BEARISH' : monthly.trend !== 'BULLISH',
        fundamentals_ok,
        ema_status: `Diario ${daily.trend} · Semanal ${weekly.trend} · Mensual ${monthly.trend}`,
        rsi_value: daily.rsi,
        success_probability: clamp(48 + score * 6, 58, 86),
        reason: signal === 'CALL'
          ? 'Scanner local LEAPS: tendencia diaria y semanal constructiva, con sesgo de continuidad de largo plazo.'
          : 'Scanner local LEAPS: tendencia diaria y semanal débil, con sesgo correctivo de largo plazo.',
        expiration_suggestion: 'Enero 2027',
        delta_suggestion: signal === 'CALL' ? 0.7 : -0.7,
        strike_suggestion: `$${Math.round(price.current_price)}`,
        ...validateLevels({
          signal,
          current_price: price.current_price,
          ...levels,
        }, { maxEntryPct: 0.10, maxSlPct: 0.12, minRR: 3 }),
      };
    })
  );

  return results
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value)
    .sort((a, b) => (b.success_probability || 0) - (a.success_probability || 0))
    .slice(0, 6);
}

export default function Swing() {
  const { ticker, setTicker, isLoading, analysisResult, lastUpdated, analyze, saveAnalysis } = useAnalysis('swing');
  const [showBacktest, setShowBacktest] = useState(false);
  const [scanResults, setScanResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedScan, setSelectedScan] = useState(null);
  const [scanTime, setScanTime] = useState(null);
  const [leapsTicker, setLeapsTicker] = useState('');
  const [isLeapsLoading, setIsLeapsLoading] = useState(false);
  const [leapsResult, setLeapsResult] = useState(null);
  const [leapsScanResults, setLeapsScanResults] = useState([]);
  const [isLeapsScanning, setIsLeapsScanning] = useState(false);
  const [leapsScanTime, setLeapsScanTime] = useState(null);

  const runAnalysis = () => {
    analyze(`Eres un trader profesional experto en swing trading. Analiza ${ticker} para operaciones de 2 días a 3 semanas.

═══════════════════════════════════════
🔄 METODOLOGÍA SWING — 3 TIMEFRAMES
═══════════════════════════════════════
Objetivo: movimientos de 2 días a 3 semanas.
Temporalidades: PRINCIPAL (4 horas), CONFIRMACIÓN (1 día), ENTRADA FINA (1 hora).
EMAs: 20, 50 y 200 en cada temporalidad.

Devuelve el objeto "swing_methodology" con el análisis estructurado en 3 capas.

═══ CAPA 1 — PRINCIPAL: 4 HORAS (temporalidad de operación) ═══
tf4h.trend: "BULLISH" / "BEARISH" / "NEUTRAL"
tf4h.structure: describe en español la estructura de precio en 4h
tf4h.ema20: valor numérico de la EMA 20 en 4h
tf4h.ema50: valor numérico de la EMA 50 en 4h
tf4h.ema200: valor numérico de la EMA 200 en 4h
tf4h.rsi: valor RSI(14) en 4h
tf4h.volume_vs_avg: volumen actual comparado con promedio 20 períodos (ej: "1.3x" o "0.8x")
tf4h.note: contexto 4h en 1 frase en español

SEÑAL ALCISTA en 4h (las 3 deben cumplirse):
tf4h.ema20_above_ema50: EMA 20 por encima de EMA 50 (true/false)
tf4h.ema50_above_ema200: EMA 50 por encima de EMA 200 (true/false)
tf4h.price_above_all_emas: precio por encima de las 3 EMAs (true/false)

SEÑAL BAJISTA en 4h (las 3 deben cumplirse):
tf4h.ema20_below_ema50: EMA 20 por debajo de EMA 50 (true/false)
tf4h.ema50_below_ema200: EMA 50 por debajo de EMA 200 (true/false)
tf4h.price_below_all_emas: precio por debajo de las 3 EMAs (true/false)

MOMENTUM — RSI en 4h:
tf4h.rsi_buy_signal: RSI entre 50-65 y subiendo → señal de compra (true/false)
tf4h.rsi_sell_signal: RSI entre 35-50 y bajando → señal de venta (true/false)
tf4h.rsi_overbought: RSI > 70 → sobrecomprado, cautela (true/false)
tf4h.rsi_oversold: RSI < 30 → sobrevendido, posible rebote (true/false)

VOLUMEN en 4h:
tf4h.volume_above_avg: volumen actual mayor al promedio de 20 períodos (true/false)
tf4h.volume_confirms: volumen confirma la dirección del movimiento (true/false)

BOLLINGER BANDS en 4h:
tf4h.bb_upper: valor de la banda superior
tf4h.bb_lower: valor de la banda inferior
tf4h.bb_middle: valor de la banda media (SMA 20)
tf4h.bb_touch_lower: precio tocando banda inferior → posible rebote alcista (true/false)
tf4h.bb_break_upper_vol: rompimiento de banda superior CON volumen → continuación alcista (true/false)
tf4h.bb_touch_upper: precio tocando banda superior → posible rechazo bajista (true/false)
tf4h.bb_break_lower_vol: rompimiento de banda inferior CON volumen → continuación bajista (true/false)
tf4h.bb_squeeze: bandas estrechas indicando compresión pre-movimiento (true/false)

═══ CAPA 2 — CONFIRMACIÓN: 1 DÍA (tendencia general + estructura) ═══
daily.trend: "BULLISH" / "BEARISH" / "NEUTRAL"
daily.structure: describe en español la estructura de precio diario
daily.ema20: valor numérico de la EMA 20 en diario
daily.ema50: valor numérico de la EMA 50 en diario
daily.ema200: valor numérico de la EMA 200 en diario
daily.rsi: RSI(14) en diario
daily.note: contexto diario en 1 frase en español

CONFIRMACIÓN CALL en diario:
daily.ema20_above_ema50: EMA 20 encima de EMA 50 (true/false)
daily.ema50_above_ema200: EMA 50 encima de EMA 200 (true/false)
daily.rsi_buy_zone: RSI entre 50-65 subiendo (true/false)
daily.trend_confirms_4h: tendencia diaria confirma la dirección de 4h (true/false)

CONFIRMACIÓN PUT en diario:
daily.ema20_below_ema50: EMA 20 bajo EMA 50 (true/false)
daily.ema50_below_ema200: EMA 50 bajo EMA 200 (true/false)
daily.rsi_sell_zone: RSI entre 35-50 bajando (true/false)
daily.bearish_confirms: tendencia bajista activa en diario (true/false)

SOPORTES Y RESISTENCIAS en diario:
daily.key_support: nivel de soporte clave más cercano (número)
daily.key_resistance: nivel de resistencia clave más cercano (número)
daily.breakout_detected: ¿hay rompimiento reciente de soporte o resistencia? (true/false)
daily.breakout_note: descripción del rompimiento si existe (en español)

═══ CAPA 3 — ENTRADA FINA: 1 HORA (timing exacto) ═══
tf1h.ema20: EMA 20 en 1h
tf1h.ema50: EMA 50 en 1h
tf1h.rsi: RSI en 1h
tf1h.micro_level: precio exacto del nivel de entrada sugerido (número)
tf1h.ready: true si se cumplen las condiciones de entrada
tf1h.volume_confirms: volumen alto en la vela de entrada (true/false)
tf1h.note: timing exacto de entrada en 1 frase en español

CALL entrada 1h:
tf1h.pullback_to_ema20: precio retrocedió a EMA 20 en 1h como soporte (true/false)
tf1h.bullish_candle_confirmed: vela alcista fuerte con cuerpo definido en 1h (true/false)
tf1h.micro_resistance_break: ruptura de micro resistencia en 1h (true/false)

PUT entrada 1h:
tf1h.rejection_from_ema20: precio rechazado desde EMA 20 en 1h como resistencia (true/false)
tf1h.bearish_candle_confirmed: vela bajista confirmada en 1h (true/false)
tf1h.micro_support_break: ruptura de micro soporte en 1h (true/false)

═══ CONTEXTO DE MERCADO (validación obligatoria) ═══
context.spx_direction: dirección actual del SPX-500 (BULLISH/BEARISH/NEUTRAL)
context.spx_note: 1 frase en español sobre SPX y su confluencia con la señal
context.vix_value: valor numérico del VIX ahora mismo
context.vix_regime: LOW (<15) / MODERATE (15-20) / HIGH (20-30) / EXTREME (>30)
context.vix_note: si VIX bajando → favorece CALL, si VIX subiendo → favorece PUT (1 frase en español)
context.call_wall: precio del call wall (mayor OI calls)
context.put_wall: precio del put wall (mayor OI puts)
context.gamma_level: nivel gamma principal
context.gamma_flip: nivel gamma flip
context.max_pain: max pain del ticker
context.gamma_note: 1 frase en español sobre cómo gamma/OI actúa como soporte o resistencia

═══ GESTIÓN DE RIESGO ═══
risk.max_risk_pct: % máximo de riesgo por operación (ej: 2)
risk.rr_ratio: relación riesgo:recompensa (ej: "1:3")
risk.breakeven_trigger: cuándo mover SL a breakeven (en español)
risk.position_suggestion: tamaño de posición sugerido en español
risk.invalidation: condición exacta de invalidación del trade en español

═══ SEÑAL FINAL SWING ═══
signal: "CALL" si 4h alcista + diario confirma + 1h ready / "PUT" si 4h bajista + diario confirma + 1h ready / "NEUTRAL" si no hay alineación
entry_price, stop_loss, take_profit: niveles para el swing (horizonte 2 días a 3 semanas)
success_prob: 0-100 basado en cuántas condiciones de las 3 capas se cumplen
summary: resumen en 2-3 frases en español explicando el setup completo

═══════════════════════════════════════

FUENTES DE DATOS OBLIGATORIAS (consulta TODAS antes de responder):
1. Finviz: https://finviz.com/quote.ashx?t=${ticker} — extrae: precio actual, % cambio, volumen vs promedio, RSI(14), EMA20/50/200, SMA20/50/200, MACD señal, Bollinger Bands, Beta, ATR, Short Float %, Insider ownership, Institutional ownership, P/E, sector/industria, rating de analistas, precio objetivo promedio.
2. Yahoo Finance: datos de opciones y precios OHLC recientes.
3. Barchart: datos de gamma y open interest.

DATOS DE FINVIZ A INCLUIR EN EL ANÁLISIS:
- finviz_rsi: valor RSI(14) actual desde Finviz
- finviz_macd: señal MACD (Buy/Sell/Strong Buy/Strong Sell)
- finviz_sma20_signal: señal SMA20 (precio sobre/bajo)
- finviz_sma50_signal: señal SMA50
- finviz_sma200_signal: señal SMA200
- finviz_analyst_rating: rating promedio de analistas (Strong Buy / Buy / Hold / Sell)
- finviz_price_target: precio objetivo promedio de analistas
- finviz_short_float: % de float vendido en corto (short squeeze risk si > 15%)
- finviz_volume_ratio: volumen actual vs promedio (relativo)
- finviz_atr: ATR actual (volatilidad real del ticker)
- finviz_beta: beta del ticker
- finviz_sector: sector del ticker
- finviz_industry: industria del ticker
- finviz_summary: resumen de 2-3 frases en español sobre lo que dice Finviz del setup actual

USA estos datos de Finviz para enriquecer el checklist, Williams %R, y la probabilidad de éxito general.

GAMMA Y OPEN INTEREST (prioridad alta):
- call_wall, put_wall, gamma_level, gamma_flip, max_pain
- oi_call_dominant: ¿el OI está dominado por calls (true) o puts (false)?
- oi_interpretation: explicación en español de qué implica el OI actual
- gamma_context: cómo los niveles gamma actúan como soporte/resistencia

NIVELES CLAVE: call_wall, put_wall, gamma_level, gamma_flip, max_pain, vwap, pivot_point, prev_high, prev_low, prev_close

SEÑAL Y NIVELES:
- signal: CALL/PUT/NEUTRAL
- entry_price, stop_loss, take_profit, success_probability
- analysis_summary: resumen en español considerando todos los factores
- swing_analysis: {timeframe: "2d-3w", trend, support_levels (array), resistance_levels (array), risk_reward_ratio}
- backtesting: {success_rate, summary, total_trades, winning_trades, losing_trades}

CHECKLIST DE CALIDAD SWING (MUY IMPORTANTE):
Evalúa los 10 parámetros clave. Para cada uno indica si cumple (true/false) y una nota breve en español.
- chk_trend_daily: ¿EMA 20 > EMA 50 > EMA 200 en diario (alcista) o EMA 20 < EMA 50 < EMA 200 (bajista)?
- chk_trend_weekly: ¿precio confirma tendencia en semanal (sobre EMA 20)?
- chk_support_level: ¿el precio está en un nivel técnico importante (soporte, resistencia, pivot)?
- chk_volume: ¿volumen mayor al promedio de 20 días?
- chk_open_interest: ¿el open interest da ventaja en la dirección del trade?
- chk_gamma_alignment: ¿los niveles gamma apoyan la dirección?
- chk_index_confluence: ¿SPX y NQ confirman la misma dirección del trade?
- chk_rr_ratio: ¿el ratio riesgo:recompensa es >= 1:2?
- chk_vix_favorable: ¿el VIX está en nivel favorable para swing (VIX < 25)?
- chk_no_catalyst_risk: ¿no hay earnings ni eventos de riesgo mayor en los próximos 5 días?

Para cada check devuelve: {passes: boolean, note: string (español)}

WILLIAMS %R (MUY IMPORTANTE para validar el swing):
Calcula el Williams %R con período 14 tanto en diario como en semanal.
Zonas y señales:
  - ZONA SOBRECOMPRA: -20 a 0 → precio muy alto, NO entrar CALL
  - ZONA NEUTRAL ALTA: -40 a -20 → momentum elevado, esperar corrección
  - ZONA ÓPTIMA SWING: -40 a -80 → zona ideal de entrada
  - ZONA SOBREVENDIDO: -80 a -100 → precio muy bajo, NO entrar PUT

Devuelve:
- williams_r: {
    daily: número entre -100 y 0,
    weekly: número entre -100 y 0,
    interpretation: explicación en español,
    swing_quality: true si daily O weekly están entre -40 y -80,
    signal_note: nota breve en español,
    call_signal_active: true si Williams %R cruza ARRIBA de -80 desde sobrevendido,
    put_signal_active: true si Williams %R cruza ABAJO de -20 desde sobrecomprado,
    call_confirmations: {confirmed_candle, confirmed_volume, confirmed_trend},
    put_confirmations: {confirmed_candle, confirmed_volume}
  }

JUSTIFICACIÓN DE FALLO (si success_probability < 60%):
- failure_reasons: array de strings en español con mínimo 3 razones detalladas.
- improvement_suggestion: qué condiciones deberían cambiar para que sea buena oportunidad.

Todos los textos en español.`);
  };

  const scanOpportunities = async () => {
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }
    setIsScanning(true);
    try {
      if (!USE_LLM_SCANNERS) {
        const localResults = await buildLocalSwingScannerResults();
        if (localResults.length > 0) {
          setScanResults(localResults.map(enrichSwingScannerItem));
          setScanTime(new Date());
          toast.success(`Scanner local completado — ${localResults.length} oportunidades encontradas`);
        } else {
          toast.warning('Scanner local sin resultados suficientes por ahora. Intenta de nuevo más tarde.');
        }
        return;
      }

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Eres un scanner de oportunidades de swing trading. Escanea el mercado y encuentra las mejores oportunidades.

METODOLOGÍA SWING (horizonte 2 días a 3 semanas):
Temporalidades: PRINCIPAL (4h), CONFIRMACIÓN (1 día), ENTRADA (1h).
EMAs: 20, 50 y 200.

CRITERIOS DE FILTRO OBLIGATORIOS — solo incluir tickers que cumplan TODOS:

1. ALINEACIÓN DE EMAs (4h y Diario):
   - CALL: EMA 20 > EMA 50 > EMA 200 (tendencia alcista confirmada)
   - PUT: EMA 20 < EMA 50 < EMA 200 (tendencia bajista confirmada)

2. RSI (4h):
   - CALL: RSI entre 50-65 y subiendo (momentum comprador sin sobrecompra)
   - PUT: RSI entre 35-50 y bajando (momentum vendedor sin sobreventa)

3. VOLUMEN: mayor al promedio de 20 días (confirmación de interés institucional)

4. BOLLINGER BANDS:
   - CALL: precio tocando banda inferior (rebote) O rompiendo banda superior CON volumen (continuación)
   - PUT: precio tocando banda superior (rechazo) O rompiendo banda inferior CON volumen

5. ROMPIMIENTO: debe haber rompimiento reciente de soporte o resistencia clave

6. GAMMA & OI: niveles gamma y open interest deben apoyar la dirección

Busca en las principales acciones de NYSE y NASDAQ (S&P500, NASDAQ100). Devuelve las 8 mejores oportunidades.

Para cada oportunidad incluye:
- ticker: símbolo
- name: nombre de la empresa
- signal: CALL o PUT
- current_price: precio actual de cotización HOY en tiempo real
- entry_price: precio estratégico de entrada (cercano al current_price, basado en EMA 20 o soporte/resistencia en 1h)
- stop_loss: bajo EMA 50 para CALL, sobre EMA 50 para PUT
- take_profit: mínimo R:R 1:2
- success_probability: 0-100
- reason: explicación detallada en español de por qué es buena oportunidad (incluir EMAs, RSI, volumen, BB)
- ema_status: "EMA 20 > 50 > 200 en 4h y diario" o similar
- bb_status: estado de Bollinger Bands (en español)
- rsi_value: valor RSI actual en 4h
- volume_ratio: volumen vs promedio 20 días (ej: "1.5x")
- open_interest_note: nota sobre open interest y gamma

IMPORTANTE: current_price debe ser el precio de mercado actual de hoy. Todos los textos en español.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            opportunities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ticker: { type: 'string' },
                  name: { type: 'string' },
                  signal: { type: 'string' },
                  current_price: { type: 'number' },
                  entry_price: { type: 'number' },
                  stop_loss: { type: 'number' },
                  take_profit: { type: 'number' },
                  success_probability: { type: 'number' },
                  reason: { type: 'string' },
                  ema_status: { type: 'string' },
                  open_interest_note: { type: 'string' }
                }
              }
            }
          }
        }
      });
      if (result._is_fallback) {
        const localResults = await buildLocalSwingScannerResults();
        if (localResults.length > 0) {
          setScanResults(localResults.map(enrichSwingScannerItem));
          setScanTime(new Date());
          toast.warning(`OpenRouter no disponible. Scanner local activado — ${localResults.length} oportunidades encontradas`);
          return;
        }
        toast.error('Scanner no disponible: falló OpenRouter y no hubo suficientes datos locales para construir oportunidades.');
        return;
      }

      const opportunities = result.opportunities || [];

      if (opportunities.length === 0) {
        const localResults = await buildLocalSwingScannerResults();
        if (localResults.length > 0) {
          setScanResults(localResults.map(enrichSwingScannerItem));
          setScanTime(new Date());
          toast.warning(`El LLM no devolvió oportunidades. Scanner local activado — ${localResults.length} oportunidades encontradas`);
          return;
        }
        toast.warning('El scanner no encontró oportunidades que cumplan los criterios. Intenta de nuevo más tarde.');
        return;
      }

      // Fetch real prices for all tickers in parallel via Yahoo Finance backend function
      const priceResults = await Promise.allSettled(
        opportunities.map(opp => base44.functions.invoke('getStockPrice', { ticker: opp.ticker }))
      );

      const enriched = opportunities.map((opp, i) => {
        const res = priceResults[i];
        const priceData = res?.status === 'fulfilled' ? res.value?.data : undefined;
        const withPrice = priceData?.current_price
          ? { ...opp, current_price: priceData.current_price }
          : opp;
        // Validate entry/SL/TP against real price (swing: 8% max entry dist, 8% SL, 1:2 RR)
        return validateLevels(withPrice, { maxEntryPct: 0.08, maxSlPct: 0.08, minRR: 2 });
      });

      setScanResults(enriched.map(enrichSwingScannerItem));
      setScanTime(new Date());
      toast.success(`Scanner completado — ${enriched.length} oportunidades encontradas`);
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('Error 404: faltan funciones backend para ejecutar el scanner swing.');
      } else {
        toast.error('Error en scanner: ' + getReadableError(err));
      }
    } finally {
      setIsScanning(false);
    }
  };

  const runLeapsAnalysis = async () => {
    if (!leapsTicker) return;
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }
    setIsLeapsLoading(true);
    const t = leapsTicker.toUpperCase();
    try {
      // Fetch real price in parallel with LLM
      let realPrice = null;
      try {
        const priceRes = await base44.functions.invoke('getStockPrice', { ticker: t });
        realPrice = priceRes?.data?.current_price || null;
      } catch (e) { /* continuar sin precio real */ }

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Eres un experto en opciones LEAPS (Long-Term Equity Anticipation Securities). Analiza ${t} con metodología de 3 capas: Principal (1 día) → Macro (semanal) → Confirmación (mensual).

⚠️ PRECIO ACTUAL REAL DE ${t}: $${realPrice ?? 'busca en Yahoo Finance'} — OBLIGATORIO usar este valor para calcular niveles.

REGLAS CRÍTICAS PARA LOS NIVELES (NO NEGOCIABLES):
- entry_price: DEBE ser un número concreto en dólares basado en el precio actual ($${realPrice ?? '?'}). Usar EMA 50 diario o soporte técnico clave. NUNCA null o 0.
- stop_loss: DEBE ser un número concreto. Para CALL: 5-8% por debajo del entry. Para PUT: 5-8% por encima. NUNCA null o 0.
- take_profit: DEBE ser un número concreto con R:R mínimo 1:3. NUNCA null o 0.
- current_price: $${realPrice ?? 'buscar'} — ponlo exactamente.

EJEMPLO (si precio actual = $200): entry_price=195.50, stop_loss=180.00, take_profit=240.00

METODOLOGÍA LEAPS — 3 CAPAS (horizonte 6 meses a 12 meses):

══ CAPA 1: PRINCIPAL (Temporalidad 1 Día) ══
Evaluación técnica principal en el gráfico DIARIO.

TENDENCIA MACRO con EMAs:
- Solo utilizamos EMA 50 y EMA 200.
- price_above_both_emas: ¿precio actual SOBRE ambas EMAs (50 y 200) en diario? (true/false)
- golden_cross: ¿MA 50 cruza por encima de EMA 200? (Golden Cross = señal fuerte alcista) (true/false)
- death_cross: ¿MA 50 cruza por debajo de EMA 200? (Death Cross = señal fuerte bajista) (true/false)
- ema50_value: valor numérico de la EMA 50 en diario
- ema200_value: valor numérico de la EMA 200 en diario

FUERZA DEL ACTIVO — RSI(14) en diario:
- rsi_value: valor numérico del RSI(14) en diario
- rsi_in_ideal_zone: ¿RSI entre 50 y 70? (fuerza sin sobrecompra extrema — zona IDEAL para CALL) (true/false)
- rsi_weak: ¿RSI por debajo de 50? (debilidad — favorece PUT) (true/false)
- rsi_overbought: ¿RSI por encima de 70? (sobrecompra — precaución para CALL) (true/false)

VOLUMEN INSTITUCIONAL:
- volume_growing_on_breakout: ¿volumen creciente en rompimientos recientes? (true/false)
- volume_note: descripción en español del patrón de volumen institucional

- daily_note: nota de 2-3 frases en español sobre el análisis técnico diario

══ CAPA 2: MACRO (Temporalidad Semanal) ══
Evalúa la dirección del mercado en el gráfico SEMANAL para confirmar la tendencia de largo plazo.

- weekly_trend: "BULLISH" / "BEARISH" / "NEUTRAL"
- price_above_ema200_weekly: ¿precio sobre EMA 200 semanal? (true/false)
- ema50_above_ema200_weekly: ¿EMA 50 sobre EMA 200 semanal? (true/false)
- higher_highs_weekly: ¿máximos crecientes en semanal? (true/false)
- lower_lows_weekly: ¿mínimos decrecientes en semanal? (true/false)
- weekly_structure: describe la estructura semanal en español

LÓGICA:
- CALL: tendencia alcista en semanal + precio rompe máximos históricos o resistencia fuerte + RSI > 50 + buenos fundamentos
- PUT: tendencia bajista macro + rompe soporte fuerte + sector débil

- weekly_note: nota de 1-2 frases en español

══ CAPA 3: CONFIRMACIÓN (Temporalidad Mensual) ══
Confirma la señal en el gráfico MENSUAL — la visión de ultra largo plazo.

- monthly_trend: "BULLISH" / "BEARISH" / "NEUTRAL"
- monthly_above_ema50: ¿precio sobre EMA 50 en mensual? (true/false)
- monthly_structure: describe la estructura de precio mensual en español (ej: "Canal alcista de largo plazo desde 2020")
- monthly_rsi: valor RSI en mensual
- breaks_ath: ¿precio rompiendo o cerca de máximos históricos (ATH)? (true/false)
- breaks_strong_support: ¿precio rompiendo soporte fuerte mensual? (true/false)
- monthly_note: nota de 1-2 frases en español

════ ANÁLISIS FUNDAMENTAL (OBLIGATORIO PARA LEAPS) ════
El bot DEBE filtrar por fundamentos. Evalúa:
- revenue_growth: ¿la empresa tiene crecimiento de ingresos? (true/false + descripción)
- eps_positive: ¿EPS positivo y creciente? (true/false + descripción)
- sector_strength: ¿el sector es fuerte actualmente? (true/false + nombre del sector + contexto)
- fundamentals_summary: resumen en español de los fundamentos (2-3 frases)
- fundamentals_pass: ¿pasan los fundamentos el filtro? (true/false)

════ CONTEXTO DE MERCADO ════
VIX VALIDATION:
- vix_context: 1-2 frases sobre cómo el VIX valida o invalida la señal LEAPS

GAMMA & OPEN INTEREST:
- gamma_levels: niveles gamma relevantes para ${t}
- max_pain: precio de max pain si disponible
- oi_note: nota sobre open interest en opciones de ${t}

═══ SEÑAL FINAL Y NIVELES ═══
- signal: "CALL" si diario bullish + semanal bullish + mensual confirma + fundamentos OK / "PUT" si todo bearish + sector débil / "NEUTRAL" si no hay alineación
- entry_price: precio estratégico (EMA 50 diario o soporte técnico clave)
- stop_loss: para CALL bajo EMA 200 diario / para PUT sobre EMA 200 diario
- take_profit: objetivo 6-12 meses, mínimo R:R 1:3
- success_prob: 0-100

═══ ESPECIFICACIONES DEL CONTRATO LEAPS ═══
- options_contract.expiration: vencimiento sugerido (6 meses a 2 años desde hoy, formato "Enero 2027")
- options_contract.delta: delta recomendado (CALL: 0.6-0.8, PUT: -0.6 a -0.8)
- options_contract.open_interest_min: OI mínimo recomendado para liquidez
- options_contract.max_spread: spread máximo aceptable en porcentaje
- options_contract.strike_suggestion: sugerencia de strike basada en delta y precio actual
- options_contract.note: nota en español sobre la selección del contrato

═══ VENCIMIENTO Y HORIZONTE ═══
- expiration.suggested: fecha de vencimiento formato "Enero 2027"
- expiration.horizon: "6-12 meses" o "12-18 meses" según análisis
- expiration.entry_note: cuándo ejecutar la entrada

═══ RISK MANAGER LEAPS ═══
- risk.max_risk_pct: % máximo del portafolio (máx 5%)
- risk.rr_ratio: "1:3" mínimo
- risk.position_size: descripción del sizing
- risk.partial_exit: cuándo tomar parciales
- risk.breakeven_trigger: cuándo mover SL a breakeven
- risk.invalidation: qué invalida el trade
- risk.general_note: nota general en español

- summary: resumen de 2-3 frases en español del análisis completo

IMPORTANTE: Todos los textos en español.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            signal: { type: 'string', enum: ['CALL', 'PUT', 'NEUTRAL'] },
            current_price: { type: 'number' },
            entry_price: { type: 'number' },
            stop_loss: { type: 'number' },
            take_profit: { type: 'number' },
            success_prob: { type: 'number' },
            summary: { type: 'string' },
            vix_context: { type: 'string' },
            daily: {
              type: 'object',
              properties: {
                price_above_both_emas: { type: 'boolean' },
                golden_cross: { type: 'boolean' },
                death_cross: { type: 'boolean' },
                ema50_value: { type: 'number' },
                ema200_value: { type: 'number' },
                rsi_value: { type: 'number' },
                rsi_in_ideal_zone: { type: 'boolean' },
                rsi_weak: { type: 'boolean' },
                rsi_overbought: { type: 'boolean' },
                volume_growing_on_breakout: { type: 'boolean' },
                volume_note: { type: 'string' },
                daily_note: { type: 'string' }
              }
            },
            macro: {
              type: 'object',
              properties: {
                weekly_trend: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
                price_above_ema200_weekly: { type: 'boolean' },
                ema50_above_ema200_weekly: { type: 'boolean' },
                higher_highs_weekly: { type: 'boolean' },
                lower_lows_weekly: { type: 'boolean' },
                weekly_structure: { type: 'string' },
                weekly_note: { type: 'string' }
              }
            },
            confirmation: {
              type: 'object',
              properties: {
                monthly_trend: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
                monthly_above_ema50: { type: 'boolean' },
                monthly_structure: { type: 'string' },
                monthly_rsi: { type: 'number' },
                breaks_ath: { type: 'boolean' },
                breaks_strong_support: { type: 'boolean' },
                monthly_note: { type: 'string' }
              }
            },
            fundamentals: {
              type: 'object',
              properties: {
                revenue_growth: { type: 'boolean' },
                eps_positive: { type: 'boolean' },
                sector_strength: { type: 'boolean' },
                sector_name: { type: 'string' },
                fundamentals_summary: { type: 'string' },
                fundamentals_pass: { type: 'boolean' }
              }
            },
            gamma_oi: {
              type: 'object',
              properties: {
                gamma_levels: { type: 'string' },
                max_pain: { type: 'number' },
                oi_note: { type: 'string' }
              }
            },
            options_contract: {
              type: 'object',
              properties: {
                expiration: { type: 'string' },
                delta: { type: 'number' },
                open_interest_min: { type: 'number' },
                max_spread: { type: 'string' },
                strike_suggestion: { type: 'string' },
                note: { type: 'string' }
              }
            },
            expiration: {
              type: 'object',
              properties: {
                suggested: { type: 'string' },
                horizon: { type: 'string' },
                entry_note: { type: 'string' }
              }
            },
            risk: {
              type: 'object',
              properties: {
                max_risk_pct: { type: 'number' },
                rr_ratio: { type: 'string' },
                position_size: { type: 'string' },
                partial_exit: { type: 'string' },
                breakeven_trigger: { type: 'string' },
                invalidation: { type: 'string' },
                general_note: { type: 'string' }
              }
            }
          }
        }
      });
      // Real price from Yahoo Finance always takes priority
      const leapsData = { ...result, current_price: realPrice ?? result.current_price ?? null };
      // Validate entry/SL/TP against real price (LEAPS: 10% max entry dist, 12% SL, 1:3 RR)
      setLeapsResult(enrichLeapsAnalysis(validateLevels(leapsData, { maxEntryPct: 0.10, maxSlPct: 0.12, minRR: 3 })));
      toast.success(`Análisis LEAPS de ${t} completado`);
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('Error 404: faltan recursos backend para análisis LEAPS.');
      } else {
        toast.error('Error: ' + getReadableError(err));
      }
    } finally {
      setIsLeapsLoading(false);
    }
  };

  const runLeapsScan = async () => {
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }
    setIsLeapsScanning(true);
    try {
      if (!USE_LLM_SCANNERS) {
        const localResults = await buildLocalLeapsScannerResults();
        if (localResults.length > 0) {
          setLeapsScanResults(localResults.map(enrichLeapsItem));
          setLeapsScanTime(new Date());
          toast.success(`Scanner LEAPS local completado — ${localResults.length} candidatos encontrados`);
        } else {
          toast.warning('Scanner LEAPS local sin candidatos por ahora. Intenta de nuevo más tarde.');
        }
        return;
      }

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Eres un scanner de oportunidades LEAPS (opciones largas 6 meses a 2 años). Escanea el mercado buscando los mejores candidatos LEAPS.

METODOLOGÍA LEAPS — 3 CAPAS (horizonte 6 meses a 12 meses):
Temporalidades: PRINCIPAL (1 día), MACRO (semanal), CONFIRMACIÓN (mensual).
EMAs: solo 50 y 200.

CRITERIOS DE FILTRO OBLIGATORIOS — solo incluir tickers que cumplan TODOS:

1. CAPA PRINCIPAL (Diario):
   - EMAs 50 y 200 — Golden Cross (MA50 cruza EMA200) = señal fuerte CALL / Death Cross = señal PUT
   - RSI(14) entre 50-70 para CALL (fuerza sin sobrecompra extrema) / RSI < 50 para PUT
   - Volumen institucional: volumen creciente en rompimientos recientes

2. CAPA MACRO (Semanal):
   - CALL: tendencia alcista semanal, precio sobre ambas EMAs, máximos crecientes
   - PUT: tendencia bajista semanal, precio bajo ambas EMAs, mínimos decrecientes
   - Precio rompe máximos históricos o resistencia fuerte (CALL) / rompe soporte fuerte (PUT)

3. CAPA CONFIRMACIÓN (Mensual):
   - Tendencia mensual alineada con las capas anteriores
   - Estructura de largo plazo coherente

4. FUNDAMENTOS (OBLIGATORIO para LEAPS):
   - Crecimiento de ingresos (revenue growth)
   - EPS positivo
   - Sector fuerte (para CALL) / Sector débil (para PUT)

5. ESPECIFICACIONES DEL CONTRATO:
   - Expiración: 6 meses a 2 años
   - Delta: CALL 0.6-0.8 / PUT -0.6 a -0.8
   - Open Interest alto (liquidez)
   - Spread bajo

6. GAMMA & OI: tener en cuenta niveles gamma relevantes

Busca en las principales acciones del S&P500 y NASDAQ100. Devuelve 6 candidatos LEAPS (mezcla de CALL y PUT según mercado actual).

Para cada candidato:
- ticker: símbolo
- name: nombre empresa
- signal: "CALL" o "PUT"
- current_price: precio actual de mercado HOY (obtener de Yahoo Finance)
- daily_ok: ¿cumple condiciones diarias (EMAs, RSI, volumen)? (true/false)
- weekly_ok: ¿cumple condiciones semanales? (true/false)
- monthly_ok: ¿confirmación mensual? (true/false)
- fundamentals_ok: ¿fundamentos sólidos (revenue growth, EPS+, sector fuerte)? (true/false)
- ema_status: "Golden Cross en diario, precio sobre EMA 50 y 200" o similar (español)
- rsi_value: valor RSI(14) en diario
- sector: nombre del sector
- success_probability: 0-100
- entry_price: precio estratégico de entrada (cercano al current_price, basado en EMA 50 diario o soporte técnico). DEBE ser número concreto, NUNCA null o 0.
- stop_loss: precio de stop loss. Para CALL: 5-8% bajo entry_price. Para PUT: 5-8% sobre entry_price. DEBE ser número concreto.
- take_profit: objetivo de precio con R:R mínimo 1:3. DEBE ser número concreto.
- reason: razón principal de por qué es candidato LEAPS (español, 2-3 frases, incluir fundamentos)
- expiration_suggestion: sugerencia de vencimiento (ej: "Enero 2027")
- delta_suggestion: delta recomendado (ej: 0.70)
- strike_suggestion: strike sugerido basado en delta

IMPORTANTE: Todos los textos en español. Priorizar candidatos donde las 3 capas + fundamentos estén alineados.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            opportunities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ticker: { type: 'string' },
                  name: { type: 'string' },
                  signal: { type: 'string' },
                  current_price: { type: 'number' },
                  daily_ok: { type: 'boolean' },
                  weekly_ok: { type: 'boolean' },
                  monthly_ok: { type: 'boolean' },
                  fundamentals_ok: { type: 'boolean' },
                  ema_status: { type: 'string' },
                  rsi_value: { type: 'number' },
                  sector: { type: 'string' },
                  entry_price: { type: 'number' },
                  stop_loss: { type: 'number' },
                  take_profit: { type: 'number' },
                  success_probability: { type: 'number' },
                  reason: { type: 'string' },
                  expiration_suggestion: { type: 'string' },
                  delta_suggestion: { type: 'number' },
                  strike_suggestion: { type: 'string' }
                }
              }
            }
          }
        }
      });
      if (result._is_fallback) {
        const localResults = await buildLocalLeapsScannerResults();
        if (localResults.length > 0) {
          setLeapsScanResults(localResults.map(enrichLeapsItem));
          setLeapsScanTime(new Date());
          toast.warning(`OpenRouter no disponible. Scanner LEAPS local activado — ${localResults.length} candidatos encontrados`);
          return;
        }
        toast.error('Scanner LEAPS no disponible: falló OpenRouter y no hubo suficientes datos locales para construir candidatos.');
        return;
      }

      const leapsOpps = result.opportunities || [];

      if (leapsOpps.length === 0) {
        const localResults = await buildLocalLeapsScannerResults();
        if (localResults.length > 0) {
          setLeapsScanResults(localResults.map(enrichLeapsItem));
          setLeapsScanTime(new Date());
          toast.warning(`El LLM no devolvió candidatos. Scanner LEAPS local activado — ${localResults.length} candidatos encontrados`);
          return;
        }
        toast.warning('El scanner LEAPS no encontró candidatos que cumplan los criterios. Intenta de nuevo más tarde.');
        return;
      }

      // Fetch real prices for all LEAPS candidates
      const leapsPriceResults = await Promise.allSettled(
        leapsOpps.map(opp => base44.functions.invoke('getStockPrice', { ticker: opp.ticker }))
      );
      const enrichedLeaps = leapsOpps.map((opp, i) => {
        const res = leapsPriceResults[i];
        const priceData = res?.status === 'fulfilled' ? res.value?.data : undefined;
        const withPrice = priceData?.current_price
          ? { ...opp, current_price: priceData.current_price }
          : opp;
        return withPrice;
      });

      setLeapsScanResults(enrichedLeaps.map(enrichLeapsItem));
      setLeapsScanTime(new Date());
      toast.success(`Scanner LEAPS completado — ${enrichedLeaps.length} candidatos encontrados`);
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('Error 404: faltan recursos backend para scanner LEAPS.');
      } else {
        toast.error('Error en scanner LEAPS: ' + getReadableError(err));
      }
    } finally {
      setIsLeapsScanning(false);
    }
  };

  return (
    <div className="space-y-6">
      <TickerInput
        ticker={ticker}
        setTicker={setTicker}
        onAnalyze={runAnalysis}
        onRefresh={runAnalysis}
        onSave={saveAnalysis}
        onBacktest={() => setShowBacktest(true)}
        isLoading={isLoading}
        lastUpdated={lastUpdated}
      />

      {/* Scanner Button */}
      <Button onClick={scanOpportunities} disabled={isScanning} variant="outline" className="w-full border-primary/30 text-primary hover:bg-primary/10">
        {isScanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Radar className="w-4 h-4 mr-2" />}
        Scanner de Oportunidades Swing
      </Button>

      {(isLoading || isScanning) && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">{isScanning ? 'Escaneando mercado...' : `Analizando ${ticker}...`}</p>
          </div>
        </div>
      )}

      {analysisResult && !isLoading && (
        <div className="space-y-4">

          {/* Swing Methodology — 3 Timeframes */}
          {analysisResult.swing_methodology && (
            <SwingMethodology data={analysisResult.swing_methodology} />
          )}

          <div className="flex flex-wrap items-center gap-4 p-4 bg-card rounded-xl border border-border/50">
            <SignalBadge signal={analysisResult.signal} size="lg" />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{analysisResult.analysis_summary}</p>
            </div>
            <ProbabilityBar label="Éxito" successPercent={analysisResult.success_probability || 50} className="w-full md:w-64" />
          </div>

          <ConsensusPanel
            title="Consenso Swing"
            consensus={analysisResult.window_consensus}
            setupGrade={analysisResult.setup_grade}
            entryAlert={analysisResult.entry_alert}
          />

          <TradeLevels entry={analysisResult.entry_price} stopLoss={analysisResult.stop_loss} takeProfit={analysisResult.take_profit} direction={analysisResult.signal} />

          {/* Finviz Panel */}
          <FinvizPanel data={analysisResult.finviz_data} />

          {/* Williams %R */}
          <WilliamsR data={analysisResult.williams_r} />

          {/* Gamma & Open Interest Card */}
          {(analysisResult.key_levels?.call_wall || analysisResult.key_levels?.put_wall || analysisResult.key_levels?.gamma_level) && (
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  Gamma & Open Interest
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Gamma levels grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Call Wall', val: analysisResult.key_levels?.call_wall, color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5' },
                    { label: 'Gamma Level', val: analysisResult.key_levels?.gamma_level, color: 'text-cyan-400', border: 'border-cyan-500/30', bg: 'bg-cyan-500/5' },
                    { label: 'Gamma Flip', val: analysisResult.key_levels?.gamma_flip, color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/5' },
                    { label: 'Put Wall', val: analysisResult.key_levels?.put_wall, color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/5' },
                  ].map(({ label, val, color, border, bg }) => val && (
                    <div key={label} className={`rounded-lg p-2.5 border ${border} ${bg} text-center`}>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
                      <p className={`text-base font-bold font-mono ${color}`}>${val?.toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                {/* Max Pain */}
                {analysisResult.key_levels?.max_pain && (
                  <div className="flex items-center justify-between bg-secondary/40 rounded-lg px-3 py-2">
                    <span className="text-[10px] text-muted-foreground">Max Pain (precio de mayor pérdida para compradores)</span>
                    <span className="text-sm font-bold font-mono text-amber-400">${analysisResult.key_levels.max_pain?.toFixed(2)}</span>
                  </div>
                )}

                {/* OI Interpretation */}
                {analysisResult.oi_interpretation && (
                  <div className="bg-secondary/30 rounded-lg p-3 border border-border/40">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                      {analysisResult.oi_call_dominant ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
                      Open Interest — {analysisResult.oi_call_dominant ? 'Dominado por CALLS' : 'Dominado por PUTS'}
                    </p>
                    <p className="text-[10px] text-foreground">{analysisResult.oi_interpretation}</p>
                  </div>
                )}

                {/* Gamma context */}
                {analysisResult.gamma_context && (
                  <div className="bg-secondary/30 rounded-lg p-3 border border-border/40">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Contexto Gamma</p>
                    <p className="text-[10px] text-foreground">{analysisResult.gamma_context}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Swing Quality Checklist */}
          <SwingChecklist
            checklist={analysisResult.swing_checklist}
            failureReasons={analysisResult.failure_reasons}
            improvementSuggestion={analysisResult.improvement_suggestion}
            successProbability={analysisResult.success_probability}
          />
        </div>
      )}

      {/* Scan Results */}
      {scanResults.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">🔍 Oportunidades Encontradas</h3>
            {scanTime && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                🕒 Escaneado: {scanTime.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })} {scanTime.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scanResults.map((opp, idx) => (
              <Card key={idx} className="bg-card border-border/50 hover:border-primary/30 transition-all cursor-pointer" onClick={() => setSelectedScan(opp)}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold font-mono text-foreground">{opp.ticker}</span>
                      <span className="text-xs text-muted-foreground">{opp.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <SignalBadge signal={opp.signal} />
                      {opp.setup_grade && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${opp.setup_grade === 'A+' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : opp.setup_grade === 'B+' ? 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' : opp.setup_grade === 'B' ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10'}`}>
                          {opp.setup_grade}
                        </span>
                      )}
                      <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full bg-primary/10" onClick={(e) => { e.stopPropagation(); setSelectedScan(opp); }}>
                        <Info className="w-3 h-3 text-primary" />
                      </Button>
                    </div>
                  </div>
                  {/* Current price badge */}
                  {opp.current_price && (
                    <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-1.5 border border-border/40">
                      <span className="text-[10px] text-muted-foreground">Precio actual hoy:</span>
                      <span className="text-sm font-bold font-mono text-amber-400">${opp.current_price.toFixed(2)}</span>
                      {scanTime && (
                        <span className="text-[9px] text-muted-foreground ml-auto">{scanTime.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span>
                      )}
                    </div>
                  )}
                  <TradeLevels entry={opp.entry_price} stopLoss={opp.stop_loss} takeProfit={opp.take_profit} direction={opp.signal} />
                  <ProbabilityBar successPercent={opp.success_probability || 50} />
                  {(opp.entry_alert || opp.size_guidance) && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5">
                      <p className="text-[9px] text-amber-300">{opp.entry_alert || opp.size_guidance}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ═══ LEAPS SECTION ═══ */}
      <div className="border-t border-border/40 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-purple-400" />
          <h2 className="text-base font-bold text-foreground">LEAPS — Opciones de Largo Plazo</h2>
          <span className="text-[10px] text-muted-foreground">Semanal → Diario → 4h/1h</span>
        </div>

        {/* LEAPS Ticker Input */}
        <div className="flex flex-wrap gap-3 p-4 bg-card rounded-xl border border-border/50 mb-4">
          <input
            className="flex-1 min-w-[160px] h-9 rounded-md border border-input bg-secondary px-3 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Ticker para LEAPS (ej: AAPL, NVDA)"
            value={leapsTicker}
            onChange={(e) => setLeapsTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && runLeapsAnalysis()}
          />
          <Button onClick={runLeapsAnalysis} disabled={isLeapsLoading || !leapsTicker} className="bg-purple-600 hover:bg-purple-700 text-white">
            <Target className="w-4 h-4 mr-2" />
            Analizar LEAPS
          </Button>
          <Button onClick={runLeapsScan} disabled={isLeapsScanning} variant="outline" className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10">
            <Radar className="w-4 h-4 mr-2" />
            {isLeapsScanning ? 'Escaneando...' : 'Scanner LEAPS'}
          </Button>
        </div>

        {(isLeapsLoading || isLeapsScanning) && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-400 rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">{isLeapsScanning ? 'Escaneando candidatos LEAPS...' : `Analizando LEAPS de ${leapsTicker}...`}</p>
            </div>
          </div>
        )}

        {leapsResult && !isLeapsLoading && (
          <LeapsModule data={leapsResult} />
        )}

        {leapsScanResults.length > 0 && !isLeapsScanning && (
          <div className="mt-4">
            <LeapsScanner results={leapsScanResults} scanTime={leapsScanTime} onSelect={(item) => setLeapsTicker(item.ticker)} />
          </div>
        )}
      </div>

      <BacktestModal open={showBacktest} onClose={() => setShowBacktest(false)} data={analysisResult?.backtesting} title={`${ticker} Swing`} />
      <InfoModal
        open={!!selectedScan}
        onClose={() => setSelectedScan(null)}
        title={`${selectedScan?.ticker} — Análisis Swing`}
        content={selectedScan ? `**Señal:** ${selectedScan.signal}\n**Setup:** ${selectedScan.setup_grade || 'N/A'}\n**Tamaño sugerido:** ${selectedScan.size_guidance || 'N/A'}\n**Entrada:** $${selectedScan.entry_price}\n**Stop Loss:** $${selectedScan.stop_loss}\n**Take Profit:** $${selectedScan.take_profit}\n\n**Alerta de entrada:** ${selectedScan.entry_alert || 'Sin alerta especial'}\n\n**EMA Status:** ${selectedScan.ema_status}\n\n**Open Interest:** ${selectedScan.open_interest_note}\n\n---\n\n${selectedScan.reason}` : ''}
      />
    </div>
  );
}