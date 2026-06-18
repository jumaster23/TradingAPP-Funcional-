import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { hasBase44Config } from '@/lib/backendGuard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { saveTrade, closeTrade, getTrades, saveSignal, getSignals, getTodayTradeCount } from '@/hooks/useDB';
import {
  Clock, Play, AlertTriangle, TrendingUp, TrendingDown, Search, RefreshCw,
  Activity, Zap, Loader2, BarChart3, Target, ChevronRight, Moon
} from 'lucide-react';
import TradeLevels from '../trading/TradeLevels';
import ProbabilityBar from '../trading/ProbabilityBar';
import TrafficLight from '@/components/live2/TrafficLight';
import FiveKeys from '@/components/live2/FiveKeys';
import TradeVisualizer from '@/components/live2/TradeVisualizer';
import MarketPulse from '@/components/live2/MarketPulse';
import ActiveRace from '@/components/live2/ActiveRace';
import ScoreBoard from '@/components/live2/ScoreBoard';
import CoachPanel from '@/components/live2/CoachPanel';
import DayPriceMap from '@/components/live2/DayPriceMap';

const STOCK_UNIVERSE = [
  { ticker: 'NVDA', name: 'NVIDIA' },
  { ticker: 'AMD', name: 'AMD' },
  { ticker: 'AAPL', name: 'Apple' },
  { ticker: 'MSFT', name: 'Microsoft' },
  { ticker: 'META', name: 'Meta' },
  { ticker: 'NFLX', name: 'Netflix' },
  { ticker: 'TSLA', name: 'Tesla' },
  { ticker: 'GOOGL', name: 'Google' },
  { ticker: 'AMZN', name: 'Amazon' },
  { ticker: 'QQQ', name: 'QQQ' },
  { ticker: 'SPY', name: 'SPY' },
  { ticker: 'IWM', name: 'Russell 2000' },
  { ticker: 'DIA', name: 'Dow Jones' },
  { ticker: 'SMH', name: 'Semiconductors' },
  { ticker: 'XLF', name: 'Financials' },
  { ticker: 'XLE', name: 'Energy' },
];

function calculateEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < 2 || !lows || lows.length < 2 || !closes || closes.length < 2) return null;
  const trs = [];
  for (let i = 1; i < Math.min(highs.length, lows.length, closes.length); i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── ATR Daily Context ─────────────────────────────────────────────────────────
function calculateATRDailyContext(highs, lows, atr) {
  if (!highs.length || !lows.length || !atr) return { atrUsedPct: 0.5, atrRemaining: atr || 0 };
  const dayHigh = Math.max(...highs);
  const dayLow = Math.min(...lows);
  const rangeToday = dayHigh - dayLow;
  const atrUsedPct = atr > 0 ? rangeToday / atr : 0;
  const atrRemaining = Math.max(atr - rangeToday, 0);
  return { atrUsedPct, atrRemaining, dayHigh, dayLow };
}

function getATRRegime(atrUsedPct) {
  if (atrUsedPct < 0.5) return 'EXPANSION';
  if (atrUsedPct < 0.8) return 'NORMAL';
  return 'EXHAUSTION';
}

function allowTrade(setupType, atrUsedPct) {
  if (atrUsedPct > 0.85 && setupType !== 'REVERSAL') return false;
  return true;
}

// ── Volume Profile (POC / HVN / LVN) ─────────────────────────────────────────
function calculateVolumeProfile(closes, volumes, bins = 20) {
  if (!closes.length || !volumes.length) return { poc: null, hvnLevels: [], lvnLevels: [] };
  const minP = Math.min(...closes);
  const maxP = Math.max(...closes);
  const range = maxP - minP;
  if (range === 0) return { poc: null, hvnLevels: [], lvnLevels: [] };
  const binSize = range / bins;
  const buckets = Array(bins).fill(0);
  for (let i = 0; i < Math.min(closes.length, volumes.length); i++) {
    const idx = Math.min(Math.floor((closes[i] - minP) / binSize), bins - 1);
    buckets[idx] += volumes[i] || 0;
  }
  const maxVol = Math.max(...buckets);
  const avgVol = buckets.reduce((a, b) => a + b, 0) / bins;
  const pocIdx = buckets.indexOf(maxVol);
  const poc = minP + pocIdx * binSize + binSize / 2;
  const hvnLevels = [];
  const lvnLevels = [];
  buckets.forEach((vol, i) => {
    const level = minP + i * binSize + binSize / 2;
    if (vol > avgVol * 1.3) hvnLevels.push(level);
    if (vol < avgVol * 0.7) lvnLevels.push(level);
  });
  return { poc, hvnLevels, lvnLevels };
}

function getVolumeZone(price, volProfile, atr) {
  const threshold = atr ? atr * 0.3 : price * 0.003;
  if (volProfile.hvnLevels.some(l => Math.abs(price - l) < threshold)) return 'HVN';
  if (volProfile.lvnLevels.some(l => Math.abs(price - l) < threshold)) return 'LVN';
  if (volProfile.poc && Math.abs(price - volProfile.poc) < threshold) return 'POC';
  return 'NEUTRAL';
}

// ── SMC Detection (sweep / CHoCH / BOS / OB) ─────────────────────────────────
function detectSMC(closes, highs, lows, lookback = 10) {
  const len = closes.length;
  if (len < lookback + 3) return { sweep: false, choch: false, bos: false, bullSignal: false, bearSignal: false, recentHigh: highs[len-1] || 0, recentLow: lows[len-1] || 0 };

  const prevHighs = highs.slice(-lookback, -2);
  const prevLows  = lows.slice(-lookback, -2);
  const prevHigh  = Math.max(...prevHighs);
  const prevLow   = Math.min(...prevLows);
  const recentHigh = Math.max(...highs.slice(-3));
  const recentLow  = Math.min(...lows.slice(-3));

  // Sweep: rompe nivel clave y recupera en las últimas 2 velas
  const bullSweep = lows[len - 2] < prevLow && closes[len - 1] > prevLow;
  const bearSweep = highs[len - 2] > prevHigh && closes[len - 1] < prevHigh;
  const sweep = bullSweep || bearSweep;

  // CHoCH: cambio de carácter — tendencia de las primeras 5 velas vs últimas 5
  const firstHalf  = closes[len - lookback];
  const midPoint   = closes[len - Math.floor(lookback / 2)];
  const lastClose  = closes[len - 1];
  const prevTrend  = firstHalf < midPoint ? 'BULL' : 'BEAR';
  const currTrend  = midPoint  < lastClose ? 'BULL' : 'BEAR';
  const choch      = prevTrend !== currTrend;

  // BOS: break of structure
  const bos = closes[len - 1] > prevHigh || closes[len - 1] < prevLow;

  const bullSignal = bullSweep || (choch && currTrend === 'BULL') || (bos && closes[len - 1] > prevHigh);
  const bearSignal = bearSweep || (choch && currTrend === 'BEAR') || (bos && closes[len - 1] < prevLow);

  return { sweep, choch, bos, bullSignal, bearSignal, recentHigh, recentLow };
}


// ── 0DTE Helpers ──────────────────────────────────────────────────────────────
function isLiquiditySession() {
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const min = et.getHours() * 60 + et.getMinutes();
  return (min >= 575 && min <= 630) || (min >= 840 && min <= 930); // 9:35–10:30 | 2:00–3:30
}

function getSessionLabel() {
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const min = et.getHours() * 60 + et.getMinutes();
  const day = et.getDay();
  if (day === 0 || day === 6) return null; // weekend
  if (min >= 570 && min <= 660) return 'NY OPEN';    // 9:30–11:00 AM
  if (min >= 720 && min <= 840) return 'MIDDAY';     // 12:00–2:00 PM
  if (min >= 840 && min <= 960) return 'AFTERNOON';  // 2:00–4:00 PM
  return null;
}

function detectWickRejection(highs, lows, opens, closes, lookback = 5) {
  const len = closes.length;
  if (len < lookback) return false;
  for (let i = len - lookback; i < len; i++) {
    const range = highs[i] - lows[i];
    if (range === 0) continue;
    const upperWick = highs[i] - Math.max(opens[i] || closes[i], closes[i]);
    const lowerWick = Math.min(opens[i] || closes[i], closes[i]) - lows[i];
    if (upperWick / range > 0.6 || lowerWick / range > 0.6) return true;
  }
  return false;
}

function detectOrderBlock(closes, opens, highs, lows, isBullish, lookback = 10) {
  const len = closes.length;
  if (len < lookback) return null;
  for (let i = len - 2; i >= len - lookback; i--) {
    const isBearish = closes[i] < (opens[i] || closes[i]);
    const isBull    = closes[i] > (opens[i] || closes[i]);
    if (isBullish && isBearish) return { high: highs[i], low: lows[i], mid: (highs[i] + lows[i]) / 2 };
    if (!isBullish && isBull)   return { high: highs[i], low: lows[i], mid: (highs[i] + lows[i]) / 2 };
  }
  return null;
}

function isPullbackToZone(price, ob, poc, atr) {
  const threshold = (atr || price * 0.003) * 0.5;
  const nearOB  = ob  && price >= ob.low - threshold && price <= ob.high + threshold;
  const nearPOC = poc && Math.abs(price - poc) < threshold * 2;
  return { nearOB: !!nearOB, nearPOC: !!nearPOC, inZone: !!(nearOB || nearPOC) };
}

function isLateralMarket(closes, lookback = 30) {
  if (closes.length < lookback) return false;
  const slice = closes.slice(-lookback);
  const high = Math.max(...slice);
  const low  = Math.min(...slice);
  const avg  = slice.reduce((a, b) => a + b, 0) / lookback;
  // Solo lateral si rango < 0.15% en las últimas 30 velas — umbral real
  return avg > 0 && (high - low) / avg < 0.0015;
}

function isLowVolume(volumes) {
  if (volumes.length < 20) return false;
  // Usar promedio de las últimas 5 velas vs promedio de 20 — más estable que 1 vela sola
  const recent5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avg20   = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
  return avg20 > 0 && recent5 < avg20 * 0.25; // solo bloquea si volumen cae a 25% del promedio
}

// ── BacktestPanel v2 — Fib bounce + day bias (lógica v5 validada) ─────────────
// Usa la misma lógica del backtest_v5.mjs: precio vs apertura del día como bias,
// detección de bounce en niveles Fib, máx 3 trades/día, RR 3:1.
// Fetcha datos históricos 1m de Yahoo Finance por rango de fechas.

const PRESET_RANGES = [
  { label: '3 días', value: '3d', interval: '1m' },
  { label: '5 días', value: '5d', interval: '1m' },
  { label: '10 días', value: '10d', interval: '5m' },
  { label: '1 mes',  value: '1mo', interval: '5m' },
];

// Lógica v5 portable (autónoma, no depende de state externo)
function bt_calcEMA(arr, period) {
  if (!arr || arr.length < period) return null;
  const k = 2 / (period + 1);
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}
function bt_calcATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < 2) return 1;
  const trs = [];
  for (let i = 1; i < Math.min(highs.length, lows.length, closes.length); i++) {
    trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  }
  if (!trs.length) return 1;
  return trs.slice(-period).reduce((a,b)=>a+b,0) / Math.min(trs.length, period);
}
// ── Bounce detection más estricto para datos 1m reales ───────────────────────
// Fix: 2 velas consecutivas = ruido en 1m. Necesitamos:
//   1. Precio REALMENTE tocó el nivel (min de ventana ≤ level + tol*0.5, no 1.5)
//   2. 3 velas consecutivas de recuperación (no 2)
//   3. Tolerancia más pequeña: range*0.008 no atr*0.65
function bt_callBounce(closes, i, level, tol) {
  if (i < 6 || !level) return false;
  const w = closes.slice(Math.max(0, i-6), i+1);
  // El mínimo de la ventana REALMENTE tocó el nivel (precio cayó hasta ahí)
  const windowMin = Math.min(...w);
  if (windowMin > level + tol) return false;           // no llegó al nivel
  if (windowMin < level - tol * 1.5) return false;     // se fue muy por debajo (no es bounce, es breakdown)
  // 3 velas consecutivas subiendo (confirmación real, no ruido de 1m)
  const rising3 = closes[i] > closes[i-1] && closes[i-1] > closes[i-2] && closes[i-2] > closes[i-3];
  // Precio actual debe estar por encima del nivel
  const aboveLevel = closes[i] >= level - tol * 0.3;
  return rising3 && aboveLevel;
}
function bt_putBounce(closes, i, level, tol) {
  if (i < 6 || !level) return false;
  const w = closes.slice(Math.max(0, i-6), i+1);
  const windowMax = Math.max(...w);
  if (windowMax < level - tol) return false;
  if (windowMax > level + tol * 1.5) return false;
  const falling3 = closes[i] < closes[i-1] && closes[i-1] < closes[i-2] && closes[i-2] < closes[i-3];
  const belowLevel = closes[i] <= level + tol * 0.3;
  return falling3 && belowLevel;
}
function bt_analyze(closes, highs, lows, i, rollingHigh, rollingLow, dayOpen) {
  const price = closes[i];
  const range = rollingHigh - rollingLow;
  if (range < 1.5 || i < 25) return null;

  const dayBull  = price > dayOpen + 0.25;
  const dayBear  = price < dayOpen - 0.25;
  if (!dayBull && !dayBear) return null;

  const dRange   = (rollingHigh - rollingLow) || 1;
  const nearHigh = (rollingHigh - price) / dRange < 0.08;
  const nearLow  = (price - rollingLow)  / dRange < 0.08;
  if (dayBull && nearHigh) return null;
  if (dayBear && nearLow)  return null;

  // Tolerancia = % del rango del día (más estricta y consistente que ATR)
  const tol  = range * 0.008;  // ~0.5% del rango — en SPY con rango $5 = ±$0.04
  const fib618 = rollingHigh - 0.618 * range;
  const fib500 = rollingHigh - 0.500 * range;
  const fib382 = rollingHigh - 0.382 * range;

  let signal = null, fibLabel = '', fibScore = 0;

  if (dayBull) {
    if      (bt_callBounce(closes, i, fib618, tol)) { signal='CALL'; fibLabel='61.8% ★'; fibScore=3; }
    else if (bt_callBounce(closes, i, fib500, tol)) { signal='CALL'; fibLabel='50%';      fibScore=2; }
    else if (bt_callBounce(closes, i, fib382, tol)) { signal='CALL'; fibLabel='38.2%';    fibScore=1; }
  } else {
    if      (bt_putBounce(closes, i, fib382, tol)) { signal='PUT'; fibLabel='38.2% ★'; fibScore=3; }
    else if (bt_putBounce(closes, i, fib500, tol)) { signal='PUT'; fibLabel='50%';      fibScore=2; }
    else if (bt_putBounce(closes, i, fib618, tol)) { signal='PUT'; fibLabel='61.8%';    fibScore=1; }
  }
  if (!signal) return null;

  // ── Score: confirmación adicional ────────────────────────────────────────
  const slice  = closes.slice(0, i+1);
  const ema20  = bt_calcEMA(slice, 20);
  const ema50  = bt_calcEMA(slice, Math.min(50, slice.length-1));

  // Trend score: EMA50 apoyando la dirección del día
  const ema50AbovePrice = ema50 && ema50 > price; // EMA50 encima = resistencia aún presente
  let trendScore = 1;
  if (dayBull && ema20 && ema50 && ema20 >= ema50 * 0.998 && !ema50AbovePrice) trendScore = 2;
  if (dayBear && ema20 && ema50 && ema20 <= ema50 * 1.002 &&  ema50AbovePrice) trendScore = 2;

  // Pivot: mismo nivel tocado antes (soporte/resistencia real)
  const prev = closes.slice(0, Math.max(0, i-3));
  const pivotTouches = prev.filter(p => Math.abs(p - price) < tol * 3).length;
  const pivotScore   = pivotTouches >= 10 ? 2 : pivotTouches >= 4 ? 1 : 0;

  // Momentum: ¿las últimas 20 velas van en dirección del día?
  const m20 = price - closes[Math.max(0, i-20)];
  // Para CALL en pullback: m20 NEGATIVO es bueno (estamos EN el pullback)
  // Para PUT en pullback: m20 POSITIVO es bueno (estamos EN el bounce bajista)
  // Lo que no queremos: momentum YA muy extendido en la dirección contraria
  const spyScore = 1; // siempre 1 sin datos SPY reales

  const score = fibScore + trendScore + pivotScore + spyScore;

  // Umbral más alto: 6/9 mínimo para filtrar señales débiles en datos ruidosos
  if (score < 6) return null;

  const atr = bt_calcATR(
    highs.slice(Math.max(0,i-20), i+1),
    lows.slice(Math.max(0,i-20), i+1),
    closes.slice(Math.max(0,i-20), i+1)
  );
  return { signal, fibLabel, fibScore, score, atr };
}

// Splits a flat 1m/5m array into per-day sessions using timestamps
function splitByDay(timestamps, closes, highs, lows) {
  const days = new Map();
  for (let i = 0; i < timestamps.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    // Market hours: 9:30–16:00 ET
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const min = et.getHours() * 60 + et.getMinutes();
    if (min < 570 || min >= 960) continue; // skip pre/after market
    const key = et.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    if (!days.has(key)) days.set(key, { closes: [], highs: [], lows: [], timestamps: [] });
    const day = days.get(key);
    if (closes[i] != null) day.closes.push(closes[i]);
    if (highs[i]  != null) day.highs.push(highs[i]);
    if (lows[i]   != null) day.lows.push(lows[i]);
    day.timestamps.push(et);
  }
  return Array.from(days.entries()).map(([date, data]) => ({ date, ...data }));
}

function runDayBacktest(day, RISK = 0.50, TP_TARGET = 2.00, MAX_TRADES = 3, COOLDOWN = 10) {
  const { closes, highs, lows, timestamps, date } = day;
  if (closes.length < 25) return { date, trades: [], skipped: true };

  let rollingHigh = closes[0], rollingLow = closes[0];
  const dayOpen   = closes[0];
  const trades    = [];
  let activeTrade = null;
  let lastSignal  = -COOLDOWN;

  for (let i = 0; i < closes.length; i++) {
    rollingHigh = Math.max(rollingHigh, closes[i]);
    rollingLow  = Math.min(rollingLow,  closes[i]);

    if (i < 20) continue;
    if (trades.length >= MAX_TRADES && !activeTrade) break;

    const price = closes[i];

    if (activeTrade) {
      const { sl, tp, signal } = activeTrade;
      const isCall = signal === 'CALL';
      const hitTP  = isCall ? price >= tp : price <= tp;
      const hitSL  = isCall ? price <= sl : price >= sl;
      if (hitTP || hitSL) {
        const win = hitTP;
        const pnl = win ? TP_TARGET : -RISK;
        trades.push({ ...activeTrade, exitPrice: price, exitIdx: i, result: win ? 'WIN' : 'LOSS', pnl });
        activeTrade = null;
      }
      continue;
    }

    if (i - lastSignal < COOLDOWN) continue;

    const r = bt_analyze(closes, highs, lows, i, rollingHigh, rollingLow, dayOpen);
    if (!r) continue;

    const { signal, fibLabel, score, atr } = r;
    const sl = signal === 'CALL' ? price - RISK       : price + RISK;
    const tp = signal === 'CALL' ? price + TP_TARGET  : price - TP_TARGET;
    const timeStr = timestamps[i]?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) || '';

    activeTrade = { signal, entry: price, sl, tp, entryIdx: i, timeStr, fibLabel, score };
    lastSignal  = i;
  }

  // Forzar cierre al final del día
  if (activeTrade) {
    const exitP = closes[closes.length - 1];
    const pnl   = activeTrade.signal === 'CALL' ? exitP - activeTrade.entry : activeTrade.entry - exitP;
    trades.push({ ...activeTrade, exitPrice: exitP, result: pnl >= 0 ? 'WIN' : 'LOSS', pnl, forcedClose: true });
  }

  return { date, trades };
}

function BacktestPanel({ ticker }) {
  const [range, setRange]       = useState('5d');
  const [interval, setInterval] = useState('1m');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults]   = useState(null);
  const [error, setError]       = useState(null);
  const [progress, setProgress] = useState('');

  const RISK      = 0.50;
  const TP_TARGET = 2.00;
  const RR        = TP_TARGET / RISK; // 4:1

  const runBacktest = async () => {
    setIsRunning(true);
    setResults(null);
    setError(null);
    setProgress('Descargando datos históricos...');

    try {
      const selectedRange = PRESET_RANGES.find(r => r.value === range) || PRESET_RANGES[1];
      const intv = selectedRange.interval;

      const res = await fetch(`/api/yahoo/chart/${ticker}?interval=${intv}&range=${range}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('Sin datos del servidor');

      const timestamps = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      const closes = (q.close || []).map(v => v ?? null);
      const highs  = (q.high  || []).map(v => v ?? null);
      const lows   = (q.low   || []).map(v => v ?? null);

      setProgress('Dividiendo por sesiones...');
      const days = splitByDay(timestamps, closes, highs, lows);

      setProgress(`Simulando ${days.length} días...`);
      const dayResults = days.map(day => runDayBacktest(day, RISK, TP_TARGET));

      // Aggregate
      const allTrades = dayResults.flatMap(d => d.trades);
      const wins      = allTrades.filter(t => t.result === 'WIN').length;
      const losses    = allTrades.filter(t => t.result === 'LOSS').length;
      const totalPnl  = allTrades.reduce((s, t) => s + t.pnl, 0);
      const winRate   = allTrades.length > 0 ? (wins / allTrades.length * 100) : 0;

      // Daily P&L for equity curve
      const dailySummary = dayResults
        .filter(d => !d.skipped && d.trades.length > 0)
        .map(d => ({
          date: d.date,
          trades: d.trades.length,
          wins:   d.trades.filter(t => t.result === 'WIN').length,
          pnl:    d.trades.reduce((s, t) => s + t.pnl, 0),
        }));

      setResults({ allTrades, wins, losses, totalPnl, winRate, dailySummary, dayResults, days: days.length });
      setProgress('');
    } catch (e) {
      setError(e.message);
      setProgress('');
    } finally {
      setIsRunning(false);
    }
  };

  const winColor  = (w) => w >= 60 ? 'text-emerald-400' : w >= 40 ? 'text-amber-400' : 'text-red-400';
  const pnlColor  = (p) => p >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="bg-secondary/10 rounded-3xl border border-white/5 p-6 space-y-6 animate-in fade-in zoom-in duration-500">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black uppercase tracking-tighter">Backtest</h2>
          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
            Estrategia Fib Bounce + Bias del Día • {ticker}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Range selector */}
          <div className="flex gap-1 bg-black/20 p-1 rounded-xl border border-white/5">
            {PRESET_RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => { setRange(r.value); setInterval(r.interval); }}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all',
                  range === r.value
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button
            onClick={runBacktest}
            disabled={isRunning}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-widest"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            {isRunning ? 'Simulando...' : 'Correr'}
          </Button>
        </div>
      </div>

      {/* Config summary */}
      <div className="flex flex-wrap gap-3 text-[9px] font-bold text-muted-foreground uppercase">
        <span>Intervalo: {interval}</span>
        <span className="opacity-30">|</span>
        <span>Riesgo: $0.50/trade</span>
        <span className="opacity-30">|</span>
        <span>Objetivo: $2.00 (RR 4:1)</span>
        <span className="opacity-30">|</span>
        <span>Máx 3 trades/día</span>
        <span className="opacity-30">|</span>
        <span>Lógica: Fib Bounce + Apertura</span>
      </div>

      {/* Progress */}
      {isRunning && progress && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-primary/5 border border-primary/20">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <p className="text-sm font-bold text-primary">{progress}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
          <p className="text-sm font-bold text-red-400">Error: {error}</p>
        </div>
      )}

      {/* Results */}
      {results && !isRunning && (
        <div className="space-y-6 animate-in fade-in duration-500">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Trades',    val: results.allTrades.length, cls: 'text-foreground' },
              { label: 'Win Rate',  val: `${results.winRate.toFixed(0)}%`, cls: winColor(results.winRate) },
              { label: 'P&L Total', val: `${results.totalPnl >= 0 ? '+' : ''}$${results.totalPnl.toFixed(2)}`, cls: pnlColor(results.totalPnl) },
              { label: 'Días sim.', val: results.days, cls: 'text-foreground' },
            ].map(({ label, val, cls }) => (
              <div key={label} className="bg-black/20 rounded-2xl border border-white/5 p-4 text-center">
                <p className="text-[9px] font-black text-muted-foreground uppercase mb-1">{label}</p>
                <p className={cn('text-2xl font-black tracking-tighter', cls)}>{val}</p>
              </div>
            ))}
          </div>

          {/* Wins / Losses / Expectativa */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-center">
              <p className="text-[9px] text-emerald-400 font-black uppercase">Wins</p>
              <p className="text-xl font-black text-emerald-400">{results.wins}</p>
              <p className="text-[9px] text-emerald-400/60">+${(results.wins * TP_TARGET).toFixed(2)}</p>
            </div>
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-center">
              <p className="text-[9px] text-red-400 font-black uppercase">Losses</p>
              <p className="text-xl font-black text-red-400">{results.losses}</p>
              <p className="text-[9px] text-red-400/60">-${(results.losses * RISK).toFixed(2)}</p>
            </div>
            <div className="bg-secondary/20 border border-white/5 rounded-xl p-3 text-center">
              <p className="text-[9px] text-muted-foreground font-black uppercase">Expectativa</p>
              <p className={cn('text-xl font-black', pnlColor(results.totalPnl / Math.max(results.allTrades.length, 1)))}>
                {results.allTrades.length > 0 ? `${(results.totalPnl/results.allTrades.length) >= 0 ? '+' : ''}$${(results.totalPnl/results.allTrades.length).toFixed(2)}` : '—'}
              </p>
              <p className="text-[9px] text-muted-foreground/60">por trade</p>
            </div>
          </div>

          {/* Daily summary table */}
          {results.dailySummary.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                <BarChart3 className="w-3 h-3" /> Resultados por Día
              </p>
              <div className="overflow-x-auto rounded-2xl border border-white/5">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/5">
                      <th className="text-left font-black text-muted-foreground uppercase px-4 py-2">Fecha</th>
                      <th className="text-center font-black text-muted-foreground uppercase px-3 py-2">Trades</th>
                      <th className="text-center font-black text-muted-foreground uppercase px-3 py-2">Wins</th>
                      <th className="text-right font-black text-muted-foreground uppercase px-4 py-2">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.dailySummary.map((d, i) => {
                      const wr = d.trades > 0 ? (d.wins / d.trades * 100).toFixed(0) : 0;
                      return (
                        <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-4 py-2 font-mono font-bold">{d.date}</td>
                          <td className="px-3 py-2 text-center font-bold">{d.trades}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={cn('font-black', winColor(Number(wr)))}>{wr}%</span>
                          </td>
                          <td className={cn('px-4 py-2 text-right font-black', pnlColor(d.pnl))}>
                            {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trade log — last 20 */}
          {results.allTrades.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-3 h-3" /> Últimos Trades
                <span className="ml-auto text-[9px] bg-secondary/40 border border-white/10 px-2 py-0.5 rounded-full">{results.allTrades.length} total</span>
              </p>
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {[...results.allTrades].reverse().slice(0, 20).map((t, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-white/5 hover:bg-black/50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', t.result === 'WIN' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-red-500')} />
                      <span className="text-[9px] font-mono text-muted-foreground">{t.timeStr || '—'}</span>
                      <span className={cn('text-[9px] font-black uppercase px-1.5 py-0.5 rounded', t.signal === 'CALL' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                        {t.signal}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60 font-mono">{t.fibLabel}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] font-mono text-muted-foreground/60">
                        ${t.entry?.toFixed(2)} → ${t.exitPrice?.toFixed(2)}
                      </span>
                      <span className={cn('text-[10px] font-black', pnlColor(t.pnl))}>
                        {t.pnl >= 0 ? '+' : ''}${t.pnl?.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.allTrades.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">Sin señales en el período seleccionado.</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Intentá con un rango más largo o un activo con más volatilidad.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatPrice(p) {
  return p != null ? `$${Number(p).toFixed(2)}` : '--';
}

function formatPct(p) {
  if (p == null) return '--';
  const sign = p > 0 ? '+' : '';
  return `${sign}${Number(p).toFixed(2)}%`;
}

function CheckItem({ label, status }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-black/20">
      <span className="text-[10px] font-bold text-muted-foreground uppercase">{label}</span>
      {status ? (
        <div className="flex items-center gap-1 text-emerald-400">
          <span className="text-[9px] font-black">OK</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]" />
        </div>
      ) : (
        <div className="flex items-center gap-1 text-amber-400/60">
          <span className="text-[9px] font-black uppercase">Wait</span>
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/40" />
        </div>
      )}
    </div>
  );
}

function ConfluenceLight({ label, status }) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-500",
      status ? "bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "bg-red-500/5 border-red-500/10"
    )}>
      <div className={cn(
        "w-3 h-3 rounded-full mb-3",
        status ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-pulse" : "bg-red-500/40"
      )} />
      <span className={cn(
        "text-[9px] font-black uppercase tracking-tighter text-center",
        status ? "text-emerald-400" : "text-muted-foreground/60"
      )}>
        {label}
      </span>
      <span className="text-[8px] font-bold mt-1 opacity-40">
        {status ? 'PASSED' : 'WAITING'}
      </span>
    </div>
  );
}

function Header({ ticker, price, change, vix, spyChange, qqqChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
      <div>
        <h1 className="text-4xl font-black tracking-tighter uppercase text-foreground">Live 2.0</h1>
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Panel de Ejecución Pro • {ticker}</p>
      </div>
      <MarketClock />
    </div>
  );
}

function LivePriceCard({ ticker, price, change, vix, spyChange, qqqChange }) {
  const isUp = change >= 0;
  return (
    <div className="bg-secondary/20 rounded-2xl p-4 border border-white/5 flex items-center justify-between">
      <div>
        <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Precio Actual</p>
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-black font-mono tracking-tighter">${price?.toFixed(2)}</p>
          <span className={cn("text-sm font-bold", isUp ? 'text-emerald-400' : 'text-red-400')}>
            {isUp ? '+' : ''}{change?.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="text-right">
        <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Ticker</p>
        <p className="text-xl font-black text-primary">{ticker}</p>
      </div>
    </div>
  );
}

function getMarketHours() {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = etNow.getHours();
  const day = etNow.getDay();
  
  const isWeekend = day === 0 || day === 6;
  const isRegular = hours >= 9.5 && hours < 16;
  const isAfterHours = hours >= 16 && hours < 20;
  const isPreMarket = hours >= 4 && hours < 9.5;
  
  if (isWeekend) return { session: 'WEEKEND', isOpen: false };
  if (isRegular) return { session: 'REGULAR', isOpen: true };
  if (isAfterHours) return { session: 'AFTER-HOURS', isOpen: true };
  if (isPreMarket) return { session: 'PRE-MARKET', isOpen: true };
  return { session: 'CERRADO', isOpen: false };
}

function TickerSearch({ value, onChange, onAnalyze, isLoading }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value);

  const filtered = STOCK_UNIVERSE.filter(t => 
    t.ticker.toLowerCase().includes(search.toLowerCase()) ||
    t.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 6);

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          value={search}
          onChange={(e) => {
            const val = e.target.value.toUpperCase();
            setSearch(val);
            onChange(val);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onAnalyze();
              setIsOpen(false);
            }
          }}
          placeholder="Ej: NVDA, AAPL, BTC-USD..."
          className="bg-secondary border-border font-mono h-11"
        />
        {isOpen && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            {filtered.map(t => (
              <button
                key={t.ticker}
                type="button"
                onClick={() => { 
                  setSearch(t.ticker);
                  onChange(t.ticker); 
                  setIsOpen(false); 
                }}
                className="w-full px-3 py-2 text-left hover:bg-secondary/50 flex items-center justify-between transition-colors"
              >
                <span className="font-bold text-sm">{t.ticker}</span>
                <span className="text-muted-foreground text-[10px] uppercase">{t.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Button 
        onClick={onAnalyze} 
        disabled={isLoading || !search}
        className="h-11 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20"
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
        ANALIZAR
      </Button>
    </div>
  );
}

function LevelExpectationBar({ current, entry, sl, tp, signal }) {
  if (!current || !entry || !sl || !tp) return null;
  const isCall = signal === 'CALL';
  
  // Calculate relative position (0% = SL, 100% = TP)
  const range = Math.abs(tp - sl);
  const position = isCall 
    ? ((current - sl) / range) * 100 
    : ((sl - current) / range) * 100;
  
  const entryPos = isCall
    ? ((entry - sl) / range) * 100
    : ((sl - entry) / range) * 100;

  const clampedPos = Math.max(0, Math.min(100, position));

  return (
    <div className="space-y-2 py-4">
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
        <span className="text-red-400">Stop Loss</span>
        <span className="text-muted-foreground">Entrada</span>
        <span className="text-emerald-400">Objetivo</span>
      </div>
      <div className="relative h-3 bg-secondary/50 rounded-full border border-border/40 overflow-hidden">
        {/* Entry line marker */}
        <div 
          className="absolute h-full w-0.5 bg-white/40 z-10" 
          style={{ left: `${entryPos}%` }} 
        />
        {/* Progress bar */}
        <div 
          className={cn(
            "h-full transition-all duration-1000",
            isCall ? "bg-gradient-to-r from-red-500/20 via-amber-500/40 to-emerald-500" : "bg-gradient-to-r from-emerald-500 to-amber-500/40 via-red-500/20"
          )}
          style={{ width: `${clampedPos}%` }}
        />
        {/* Current price pulse */}
        <div 
          className="absolute top-0 w-3 h-3 bg-white rounded-full border-2 border-primary shadow-[0_0_10px_rgba(255,255,255,0.5)] -ml-1.5 transition-all duration-1000"
          style={{ left: `${clampedPos}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] font-mono opacity-60">
        <span>${sl.toFixed(2)}</span>
        <span>${entry.toFixed(2)}</span>
        <span>${tp.toFixed(2)}</span>
      </div>
    </div>
  );
}

function MarketClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Format New York Time
  const nyTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(time);

  const seconds = time.getSeconds();
  const nextCandle = 60 - seconds;

  return (
    <div className="flex items-center gap-4 bg-black/40 px-4 py-2 rounded-xl border border-white/5 shadow-inner">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary animate-pulse" />
        <span className="text-xl font-black font-mono tracking-tighter text-foreground">
          {nyTime}
          <span className="text-[10px] text-muted-foreground ml-1 font-sans font-bold">NY</span>
        </span>
      </div>
      <div className="h-8 w-px bg-white/10" />
      <div className="text-right">
        <p className="text-[9px] font-bold text-muted-foreground uppercase leading-none mb-1">Próxima Vela</p>
        <div className="flex items-center gap-1.5">
          <div className="relative w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="absolute h-full bg-primary transition-all duration-1000" 
              style={{ width: `${(nextCandle / 60) * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono font-bold text-primary">{nextCandle}s</span>
        </div>
      </div>
    </div>
  );
}

function ProIntelligencePanel({ ticker, rs, alignment, vixRegime }) {
  const getRSMeta = (val) => {
    if (val > 0.8) return { label: 'Líder Fuerte', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: <Zap className="w-3 h-3" /> };
    if (val > 0.2) return { label: 'Outperformer', color: 'text-emerald-300', bg: 'bg-emerald-500/5', icon: <TrendingUp className="w-3 h-3" /> };
    if (val < -0.8) return { label: 'Debilidad Crítica', color: 'text-red-400', bg: 'bg-red-500/10', icon: <AlertTriangle className="w-3 h-3" /> };
    if (val < -0.2) return { label: 'Underperformer', color: 'text-red-300', bg: 'bg-red-500/5', icon: <TrendingDown className="w-3 h-3" /> };
    return { label: 'Neutral vs Mercado', color: 'text-muted-foreground', bg: 'bg-secondary/20', icon: <Activity className="w-3 h-3" /> };
  };

  const rsMeta = getRSMeta(rs);
  const alignmentColor = alignment === 'HIGH' ? 'text-emerald-400' : alignment === 'LOW' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className={cn("p-3 rounded-xl border border-white/5 space-y-2", rsMeta.bg)}>
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Fuerza Relativa (vs SPY)</p>
          {rsMeta.icon}
        </div>
        <div className="flex items-end justify-between">
          <p className={cn("text-sm font-black", rsMeta.color)}>{rsMeta.label}</p>
          <p className="text-xs font-mono font-bold opacity-60">{(rs * 10).toFixed(1)}</p>
        </div>
        <div className="h-1 w-full bg-black/20 rounded-full overflow-hidden">
          <div 
            className={cn("h-full transition-all duration-1000", rs.toFixed(1) > 0 ? 'bg-emerald-500' : 'bg-red-500')} 
            style={{ 
              width: `${Math.min(100, Math.abs(rs) * 50)}%`,
              marginLeft: rs < 0 ? 'auto' : '0'
            }} 
          />
        </div>
      </div>

      <div className="p-3 rounded-xl border border-white/5 bg-secondary/10 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Alineación Institucional</p>
          <BarChart3 className="w-3 h-3 text-primary" />
        </div>
        <div className="flex items-end justify-between">
          <p className={cn("text-sm font-black uppercase", alignmentColor)}>{alignment}</p>
          <div className="flex gap-0.5">
            {[1, 2, 3].map(i => (
              <div key={i} className={cn("w-1 h-3 rounded-full", i <= (alignment === 'HIGH' ? 3 : alignment === 'MID' ? 2 : 1) ? 'bg-primary' : 'bg-white/10')} />
            ))}
          </div>
        </div>
        <p className="text-[9px] text-muted-foreground italic">
          {alignment === 'HIGH' ? 'Instituciones comprando en bloque' : alignment === 'LOW' ? 'Flujo de capital contradictorio' : 'Contexto de mercado mixto'}
        </p>
      </div>
    </div>
  );
}

function MTFStatus({ trends }) {
  if (!trends) return null;
  
  const getStatusColor = (trend) => {
    if (trend === 'BULL') return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
    if (trend === 'BEAR') return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
    return 'bg-slate-500';
  };

  return (
    <div className="bg-secondary/20 rounded-xl p-3 border border-white/5">
      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
        <Clock className="w-3 h-3" /> Alineación Temporal
      </p>
      <div className="grid grid-cols-4 gap-2">
        {['1m', '5m', '15m', '1h'].map((tf) => (
          <div key={tf} className="flex flex-col items-center gap-1.5">
            <div className={cn("w-2 h-2 rounded-full animate-pulse", getStatusColor(trends[tf]))} />
            <span className="text-[10px] font-bold font-mono text-muted-foreground">{tf}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketStatus({ vix, spyChange, qqqChange }) {
  const { session, isOpen } = getMarketHours();
  
  let vixColor = 'text-foreground';
  let vixLabel = 'Normal';
  if (vix > 25) { vixColor = 'text-red-400'; vixLabel = 'Alto'; }
  else if (vix > 20) { vixColor = 'text-amber-400'; vixLabel = 'Elevado'; }
  else if (vix <= 15) { vixColor = 'text-emerald-400'; vixLabel = 'Bajo'; }

  const marketDir = (spyChange > 0 && qqqChange > 0) ? 'ALCISTA' : (spyChange < 0 && qqqChange < 0) ? 'BAJISTA' : 'MIXTO';
  const marketColor = marketDir === 'ALCISTA' ? 'text-emerald-400' : marketDir === 'BAJISTA' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="grid grid-cols-4 gap-2">
      <div className="bg-secondary/40 rounded-lg p-2 text-center">
        <p className="text-[8px] text-muted-foreground">SESIÓN</p>
        <p className={cn("text-xs font-bold", isOpen ? 'text-emerald-400' : 'text-slate-400')}>{session}</p>
      </div>
      <div className="bg-secondary/40 rounded-lg p-2 text-center">
        <p className="text-[8px] text-muted-foreground">VIX</p>
        <p className={cn("text-xs font-bold font-mono", vixColor)}>{vix?.toFixed(1) || '--'}</p>
        <p className="text-[8px] text-muted-foreground">{vixLabel}</p>
      </div>
      <div className="bg-secondary/40 rounded-lg p-2 text-center">
        <p className="text-[8px] text-muted-foreground">SPY</p>
        <p className={cn("text-xs font-bold", spyChange > 0 ? 'text-emerald-400' : 'text-red-400')}>
          {formatPct(spyChange)}
        </p>
      </div>
      <div className="bg-secondary/40 rounded-lg p-2 text-center">
        <p className="text-[8px] text-muted-foreground">QQQ</p>
        <p className={cn("text-xs font-bold", qqqChange > 0 ? 'text-emerald-400' : 'text-red-400')}>
          {formatPct(qqqChange)}
        </p>
      </div>
    </div>
  );
}

function isMarketOpen() {
  const now = new Date();
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const day = etTime.getDay();

  // Weekends: Saturday (6) and Sunday (0)
  if (day === 0 || day === 6) return false;

  const timeAsMinutes = hours * 60 + minutes;
  const openingTime = 9 * 60 + 30; // 9:30 AM
  const closingTime = 16 * 60;    // 4:00 PM

  return timeAsMinutes >= openingTime && timeAsMinutes < closingTime;
}

function MarketClosedBanner() {
  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6 flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-1000">
      <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
        <Moon className="w-5 h-5 text-amber-500" />
      </div>
      <div>
        <h3 className="text-sm font-black uppercase tracking-widest text-amber-500">Mercado Cerrado</h3>
        <p className="text-[10px] text-muted-foreground font-medium uppercase italic">El análisis se reanudará en la próxima apertura (9:30 AM ET)</p>
      </div>
    </div>
  );
}

function ActiveTradeCard({ trade, currentPrice }) {
  const isCall = trade.signal === 'CALL';
  const progress = isCall 
    ? ((currentPrice - trade.entry) / (trade.tp - trade.entry)) * 100
    : ((trade.entry - currentPrice) / (trade.entry - trade.tp)) * 100;

  return (
    <div className={cn(
      "p-6 rounded-3xl border-2 shadow-2xl animate-pulse",
      isCall ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
    )}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-black uppercase tracking-widest text-foreground">Trade Activo: {trade.ticker}</h2>
        </div>
        <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-black text-muted-foreground uppercase">
          {trade.signal} @ ${trade.entry.toFixed(2)}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between text-[10px] font-black text-muted-foreground uppercase">
          <span>Stop Loss: ${trade.sl.toFixed(2)}</span>
          <span>Take Profit: ${trade.tp.toFixed(2)}</span>
        </div>
        <div className="h-3 w-full bg-black/40 rounded-full overflow-hidden p-0.5 border border-white/5">
          <div 
            className={cn("h-full rounded-full transition-all duration-1000", isCall ? 'bg-emerald-500' : 'bg-red-500')}
            style={{ width: `${Math.max(5, Math.min(100, progress))}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-4xl font-black tracking-tighter">${currentPrice?.toFixed(2)}</p>
          <div className="text-right">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">P&L Estimado</p>
            <p className={cn("text-lg font-black", currentPrice >= trade.entry ? (isCall ? 'text-emerald-400' : 'text-red-400') : (isCall ? 'text-red-400' : 'text-emerald-400'))}>
              {currentPrice >= trade.entry ? '+' : ''}{((currentPrice - trade.entry) / trade.entry * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeHistory({ history }) {
  if (history.length === 0) return null;
  return (
    <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4 mt-6">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-4">Historial de Hoy</h3>
      <div className="space-y-2">
        {history.map((t, i) => (
          <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-black/20 border border-white/5">
            <div className="flex items-center gap-3">
              <div className={cn("w-1.5 h-1.5 rounded-full", t.result === 'SUCCESS' ? 'bg-emerald-500' : 'bg-red-500')} />
              <span className="text-xs font-bold font-mono">{t.ticker}</span>
              <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded", t.signal === 'CALL' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                {t.signal}
              </span>
            </div>
            <div className="text-right">
              <p className={cn("text-xs font-black", t.result === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400')}>
                {t.result}
              </p>
              <p className="text-[8px] text-muted-foreground font-mono">{new Date(t.closedAt).toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradingPlan({ signal, entry, sl, tp, price, onTrade }) {
  if (signal === 'WAIT') return null;

  const isCall = signal === 'CALL';
  const riskPct = Math.abs((entry - sl) / entry * 100);
  const rewardPct = Math.abs((tp - entry) / entry * 100);
  const rr = (rewardPct / riskPct).toFixed(1);

  return (
    <div className={cn(
      "p-6 rounded-3xl border-2 shadow-2xl transition-all duration-500 animate-in fade-in zoom-in",
      isCall ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
    )}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" /> Plan de Ejecución
        </h2>
        <div className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-black text-primary">
          RATIO {rr}:1
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">Entrada Sugerida</p>
          <p className="text-4xl font-black tracking-tighter text-foreground">${entry?.toFixed(2)}</p>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] font-bold text-red-400 uppercase flex items-center gap-1">
             <TrendingDown className="w-3 h-3" /> Stop Loss
          </p>
          <p className="text-3xl font-black tracking-tighter text-red-400/80">${sl?.toFixed(2)}</p>
          <p className="text-[10px] font-bold text-red-400/60">-{riskPct.toFixed(2)}% Riesgo</p>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] font-bold text-emerald-400 uppercase flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Take Profit
          </p>
          <p className="text-3xl font-black tracking-tighter text-emerald-400/80">${tp?.toFixed(2)}</p>
          <p className="text-[10px] font-bold text-emerald-400/60">+{rewardPct.toFixed(2)}% Ganancia</p>
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase">Estatus del Trade</p>
            <p className="text-xs font-bold text-foreground">
              {price > entry ? (isCall ? 'EN GANANCIA' : 'EN PÉRDIDA') : (isCall ? 'EN PÉRDIDA' : 'EN GANANCIA')}
            </p>
          </div>
        </div>
        <Button 
          onClick={() => onTrade({ signal, entry, sl, tp })}
          className={cn(
            "h-12 px-8 text-lg font-black tracking-tight rounded-xl shadow-lg transition-transform active:scale-95",
            isCall ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20" : "bg-red-500 hover:bg-red-600 shadow-red-500/20"
          )}
        >
          EJECUTAR {signal} NOW
        </Button>
      </div>
    </div>
  );
}

function SignalCard({ signal, ticker, price, entry, sl, tp, atr, probability, reason, onTrade, trends, checklist, relativeStrength, mentorMessage }) {
  if (signal === 'WAIT') {
    return (
      <div className="bg-secondary/20 rounded-3xl p-6 border border-white/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Escaneando Mercado</h2>
        </div>
        
        <div className="bg-primary/5 rounded-2xl p-4 border border-primary/10 mb-6 italic text-primary/90 text-sm leading-relaxed">
          "{mentorMessage}"
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <ConfluenceLight label="SMC Sweep" status={checklist?.sweep} />
          <ConfluenceLight label="CHoCH / BOS" status={checklist?.choch} />
          <ConfluenceLight label="EMA 20/50" status={checklist?.emaAlignment} />
          <ConfluenceLight label="Vol. Zone" status={checklist?.volumeConfluence} />
          <ConfluenceLight label="ATR < 80%" status={checklist?.atrOk} />
          <ConfluenceLight label="Gamma" status={checklist?.gamma} />
        </div>

        <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase">RS Score</p>
            <p className={cn("text-xs font-mono font-bold", relativeStrength > 0 ? 'text-emerald-400' : 'text-red-400')}>
              {relativeStrength > 0 ? '+' : ''}{relativeStrength?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase">VIX Status</p>
            <p className="text-xs font-mono font-bold text-slate-300">ESTABLE</p>
          </div>
        </div>
      </div>
    );
  }

  const isCall = signal.includes('CALL');
  const signalColor = isCall ? 'text-emerald-400' : 'text-red-400';
  const signalBg = isCall ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20';
  const btnColor = isCall ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20' : 'bg-red-600 hover:bg-red-700 shadow-red-500/20';

  const riskAmount = Math.abs((sl - entry) / entry * 100);
  const rewardAmount = Math.abs((tp - entry) / entry * 100);
  const rrRatio = riskAmount > 0 ? rewardAmount / riskAmount : 0;

  return (
    <div className={cn("rounded-2xl border-2 p-6 space-y-6 transition-all duration-500", signalBg)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner", isCall ? 'bg-emerald-600' : 'bg-red-600')}>
            {isCall ? <TrendingUp className="w-8 h-8 text-white" /> : <TrendingDown className="w-8 h-8 text-white" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-bold">{ticker}</span>
              <span className={cn("text-xs font-bold uppercase", signalColor)}>{isCall ? 'Scalp Alcista' : 'Scalp Bajista'}</span>
            </div>
            <p className={cn("text-3xl font-black tracking-tighter", signalColor)}>{signal}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground font-bold uppercase">Precio Actual</p>
          <p className="text-3xl font-black font-mono tracking-tighter">${price?.toFixed(2)}</p>
        </div>
      </div>

      <ProbabilityBar 
        label="Fuerza del Setup (ML Probability)" 
        successPercent={probability} 
        tone={probability > 75 ? 'success' : 'mixed'}
        className="bg-black/20 p-4 rounded-xl border border-white/5"
      />

      <TradeLevels entry={entry} stopLoss={sl} takeProfit={tp} direction={isCall ? 'CALL' : 'PUT'} />

      <div className="space-y-1">
        <p className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
          <Activity className="w-3 h-3" /> 
          Expectativa de Niveles
        </p>
        <LevelExpectationBar current={price} entry={entry} sl={sl} tp={tp} signal={isCall ? 'CALL' : 'PUT'} />
      </div>

      <div className="grid grid-cols-3 gap-2 py-2">
        <div className="text-center p-2 rounded-lg bg-black/10">
          <p className="text-[9px] text-muted-foreground">R:R RATIO</p>
          <p className="text-sm font-bold">{rrRatio.toFixed(2)}</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-black/10">
          <p className="text-[9px] text-muted-foreground">RIESGO %</p>
          <p className="text-sm font-bold text-red-400">-{riskAmount.toFixed(2)}%</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-black/10">
          <p className="text-[9px] text-muted-foreground">TARGET %</p>
          <p className="text-sm font-bold text-emerald-400">+{rewardAmount.toFixed(2)}%</p>
        </div>
      </div>

      {/* 0DTE Option Levels */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
        <p className="text-[9px] font-black text-primary uppercase tracking-widest">0DTE — Niveles sobre Prima</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-[8px] text-red-400 font-bold uppercase">SL Prima</p>
            <p className="text-sm font-black text-red-400">-30%</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] text-amber-400 font-bold uppercase">TP1 (70%)</p>
            <p className="text-sm font-black text-amber-400">+25%</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] text-emerald-400 font-bold uppercase">TP2 (30%)</p>
            <p className="text-sm font-black text-emerald-400">+50%</p>
          </div>
        </div>
        <p className="text-[8px] text-muted-foreground italic">Delta ideal: 0.40–0.60 · ATM o ligeramente ITM · Expira hoy</p>
      </div>

      <div className="bg-white/5 rounded-xl p-4 border border-white/5">
        <div className="flex gap-2 mb-1">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <p className="text-[10px] font-bold uppercase text-amber-400">Análisis Estructural</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
      </div>

      <Button 
        className={cn("w-full h-14 text-xl font-black tracking-tight shadow-xl", btnColor)}
        onClick={() => onTrade({ ticker, signal, entry, sl, tp })}
      >
        <Play className="w-6 h-6 mr-3 fill-current" />
        EJECUTAR {signal} @ {formatPrice(entry)}
      </Button>
    </div>
  );
}

function getMentorMessage(signal, trends, checklist, relativeStrength, wallResistance, price, isGolden, regime, atrUsedPct, volumeZone) {
  if (signal?.includes('CALL')) {
    const zone = volumeZone === 'LVN' ? ' Zona LVN libre — dejá correr.' : volumeZone === 'HVN' ? ' HVN cerca — TP conservador.' : '';
    return `Setup SMC alcista confirmado. Sweep + CHoCH + EMA alineadas.${zone} Entrá con el plan.`;
  }
  if (signal?.includes('PUT')) {
    const zone = volumeZone === 'LVN' ? ' LVN abajo — hay espacio.' : volumeZone === 'HVN' ? ' HVN cerca — ajustá el TP.' : '';
    return `Estructura bajista validada. Sweep + CHoCH detectados.${zone} Stop corto, respetá el plan.`;
  }
  // WAIT logic
  if (regime === 'EXHAUSTION') {
    return `ATR al ${(atrUsedPct * 100).toFixed(0)}%. El activo ya "se movió todo" hoy. Solo reversals — no persigas breakouts.`;
  }
  if (checklist && !checklist.sweep && !checklist.choch) {
    return 'Sin sweep ni CHoCH. Los institucionales no mostraron la mano todavía. Esperá la trampa de liquidez.';
  }
  if (checklist && !checklist.emaAlignment) {
    return 'EMA 20 y 50 no alineadas o precio fuera de la EMA. La dirección no está confirmada.';
  }
  if (checklist && !checklist.volumeConfluence) {
    return 'No hay confluencia de volumen (POC/LVN). Entrando en el vacío — esperá que el precio llegue a una zona de liquidez.';
  }
  if (trends && trends['5m'] !== trends['15m']) {
    return `5m dice ${trends['5m']} pero 15m dice ${trends['15m']}. Marcos peleados — afuera mirando.`;
  }
  return 'Escaneando estructura. Necesito sweep + CHoCH + EMA alineada + zona de volumen para darte una señal limpia.';
}

async function fetchOptionChain(ticker) {
  try {
    const res = await fetch(`/api/yahoo/v7/finance/options/${ticker}`);
    const json = await res.json();
    return json?.optionChain?.result?.[0] || null;
  } catch (e) {
    console.error('Error fetching options', ticker, e);
    return null;
  }
}

function calculateGEX(optionData, spotPrice) {
  if (!optionData) return null;
  const calls = optionData.options?.[0]?.calls || [];
  const puts = optionData.options?.[0]?.puts || [];
  const callWall = calls.reduce((prev, current) => (prev.openInterest > current.openInterest) ? prev : current, { strike: 0, openInterest: 0 });
  const putWall = puts.reduce((prev, current) => (prev.openInterest > current.openInterest) ? prev : current, { strike: 0, openInterest: 0 });
  const allStrikes = [...calls, ...puts].map(o => o.strike).sort((a, b) => a - b);
  const gammaFlip = allStrikes.find(strike => {
    const c = calls.find(o => o.strike === strike)?.openInterest || 0;
    const p = puts.find(o => o.strike === strike)?.openInterest || 0;
    return Math.abs(c - p) < (c + p) * 0.1; 
  }) || spotPrice;
  return { callWall: callWall.strike, putWall: putWall.strike, gammaFlip };
}

// ── Day Range Fibonacci (usa el rango real del día) ──────────────────────────
function calculateDayRangeFib(dayHigh, dayLow) {
  if (!dayHigh || !dayLow || dayHigh <= dayLow) return null;
  const range = dayHigh - dayLow;
  if (range < 0.05) return null;
  return {
    swingHigh: dayHigh, swingLow: dayLow, range, isUpMove: true,
    bull: {
      r236: dayHigh - 0.236 * range, r382: dayHigh - 0.382 * range,
      r500: dayHigh - 0.500 * range, r618: dayHigh - 0.618 * range,
      r650: dayHigh - 0.650 * range, r786: dayHigh - 0.786 * range,
    },
    bear: {
      r236: dayLow + 0.236 * range, r382: dayLow + 0.382 * range,
      r500: dayLow + 0.500 * range, r618: dayLow + 0.618 * range,
      r650: dayLow + 0.650 * range, r786: dayLow + 0.786 * range,
    },
  };
}

// ── Pivot Zone Detection (niveles tocados 2+ veces) ───────────────────────────
function detectPivotZones(highs, lows, atr, minTouches = 2) {
  if (!highs.length || !lows.length) return [];
  const tol = (atr || 1) * 0.35;
  const all = [...highs.slice(-300), ...lows.slice(-300)];
  const used = new Array(all.length).fill(false);
  const zones = [];
  for (let i = 0; i < all.length; i++) {
    if (used[i]) continue;
    const members = [all[i]];
    used[i] = true;
    for (let j = i + 1; j < all.length; j++) {
      if (!used[j] && Math.abs(all[j] - all[i]) <= tol) { members.push(all[j]); used[j] = true; }
    }
    if (members.length >= minTouches) {
      const avg = members.reduce((a, b) => a + b, 0) / members.length;
      zones.push({ price: avg, touches: members.length, strength: members.length >= 3 ? 'STRONG' : 'MODERATE' });
    }
  }
  return zones.sort((a, b) => b.touches - a.touches).slice(0, 5);
}

// ── Fibonacci Retracement ─────────────────────────────────────────────────────
function calculateFibLevels(highs, lows, lookback = 60) {
  const len = Math.min(highs.length, lows.length, lookback);
  if (len < 10) return null;
  const h = highs.slice(-len);
  const l = lows.slice(-len);
  const swingHigh = Math.max(...h);
  const swingLow  = Math.min(...l);
  const range = swingHigh - swingLow;
  if (range < 0.01) return null;

  // Determine direction: low before high = uptrend (bullish swing)
  const highIdx = h.lastIndexOf(swingHigh);
  const lowIdx  = l.lastIndexOf(swingLow);
  const isUpMove = lowIdx < highIdx;

  return {
    swingHigh, swingLow, range, isUpMove,
    // Pullback levels from swing high (buy the dip)
    bull: {
      r236: swingHigh - 0.236 * range,
      r382: swingHigh - 0.382 * range,
      r500: swingHigh - 0.500 * range,
      r618: swingHigh - 0.618 * range,
      r650: swingHigh - 0.650 * range,
      r786: swingHigh - 0.786 * range,
    },
    // Bounce levels from swing low (sell the bounce)
    bear: {
      r236: swingLow + 0.236 * range,
      r382: swingLow + 0.382 * range,
      r500: swingLow + 0.500 * range,
      r618: swingLow + 0.618 * range,
      r650: swingLow + 0.650 * range,
      r786: swingLow + 0.786 * range,
    },
  };
}

function getFibTouch(price, fibLevels, isBullish, atr) {
  if (!fibLevels || price == null) return { touched: false, level: null, score: 0 };
  const lvls = isBullish ? fibLevels.bull : fibLevels.bear;
  const tol  = (atr || price * 0.003) * 0.55;

  // Golden Pocket 61.8%–65% — highest probability reversal zone
  if (Math.abs(price - lvls.r618) < tol || Math.abs(price - lvls.r650) < tol)
    return { touched: true, level: '61.8% Golden', score: 3 };
  // 50% — balanced, mid-trend entry
  if (Math.abs(price - lvls.r500) < tol)
    return { touched: true, level: '50%', score: 2 };
  // 38.2% — shallow pullback, strong trend confirmation
  if (Math.abs(price - lvls.r382) < tol)
    return { touched: true, level: '38.2%', score: 1 };
  // 78.6% — deep retracement, last defense level
  if (Math.abs(price - lvls.r786) < tol)
    return { touched: true, level: '78.6%', score: 1 };

  return { touched: false, level: null, score: 0 };
}

// ── Fib Bounce Detection (v5 — backtest validated) ───────────────────────────
// CALL bounce: precio bajó al nivel Fib y está recuperando (2 velas consecutivas al alza)
function detectFibCallBounce(closes, fibLevel, atr) {
  if (!fibLevel || !atr || closes.length < 8) return false;
  const tol    = atr * 0.65;
  const window = closes.slice(-8);
  // Algún precio de la ventana tocó el nivel desde arriba
  const touched = Math.min(...window) <= fibLevel + tol && window.some(p => p >= fibLevel - tol * 0.5);
  if (!touched) return false;
  const len = closes.length;
  return closes[len - 1] > closes[len - 2] && closes[len - 2] > closes[len - 3];
}

// PUT bounce: precio subió al nivel Fib y está cayendo (2 velas consecutivas a la baja)
function detectFibPutBounce(closes, fibLevel, atr) {
  if (!fibLevel || !atr || closes.length < 8) return false;
  const tol    = atr * 0.65;
  const window = closes.slice(-8);
  const touched = Math.max(...window) >= fibLevel - tol && window.some(p => p <= fibLevel + tol * 0.5);
  if (!touched) return false;
  const len = closes.length;
  return closes[len - 1] < closes[len - 2] && closes[len - 2] < closes[len - 3];
}

// Evalúa cuál nivel Fib tiene bounce activo
function getBestFibBounce(closes, fibLevels, isCallDir, atr) {
  if (!fibLevels || !atr) return { bouncing: false, level: null, label: null, score: 0 };
  const lvls = isCallDir ? fibLevels.bull : fibLevels.bear;
  const fn   = isCallDir ? detectFibCallBounce : detectFibPutBounce;

  if (fn(closes, lvls?.r618, atr) || fn(closes, lvls?.r650, atr))
    return { bouncing: true, level: (lvls?.r618 || lvls?.r650), label: '61.8% Golden', score: 3 };
  if (fn(closes, lvls?.r500, atr))
    return { bouncing: true, level: lvls?.r500, label: '50%', score: 2 };
  if (fn(closes, lvls?.r382, atr))
    return { bouncing: true, level: lvls?.r382, label: '38.2%', score: 1 };

  return { bouncing: false, level: null, label: null, score: 0 };
}

// ── 0DTE "Liquidity Reversal A+" Pipeline ────────────────────────────────────
async function analyzeTicker(ticker, spyData, qqqData, vix, i1m, i5m, i15m, i1h, gammaData, spy5m = null) {
  const getCloses  = (d) => d?.indicators?.quote?.[0]?.close?.filter(v => v != null)  || [];
  const getHighs   = (d) => d?.indicators?.quote?.[0]?.high?.filter(v => v != null)   || [];
  const getLows    = (d) => d?.indicators?.quote?.[0]?.low?.filter(v => v != null)    || [];
  const getOpens   = (d) => d?.indicators?.quote?.[0]?.open?.filter(v => v != null)   || [];
  const getVolumes = (d) => d?.indicators?.quote?.[0]?.volume?.filter(v => v != null) || [];

  const closes1m  = getCloses(i1m);
  const highs1m   = getHighs(i1m);
  const lows1m    = getLows(i1m);
  const opens1m   = getOpens(i1m);
  const volumes1m = getVolumes(i1m);
  const closes5m  = getCloses(i5m);
  const highs5m   = getHighs(i5m);
  const lows5m    = getLows(i5m);
  const opens5m   = getOpens(i5m);

  if (closes1m.length < 20) return { signal: 'WAIT', reason: 'Cargando datos...' };

  const price = closes1m[closes1m.length - 1];

  // ── Calcular TODO antes de los early returns (para dar contexto siempre) ──
  const atr            = calculateATR(highs1m.slice(-15), lows1m.slice(-15), closes1m.slice(-15), 14);
  const { atrUsedPct, atrRemaining, dayHigh, dayLow } = calculateATRDailyContext(highs1m, lows1m, atr);
  const regime         = getATRRegime(atrUsedPct);
  const ema20          = calculateEMA(closes1m, 20);
  const ema50          = calculateEMA(closes1m, 50);
  const volProfile     = calculateVolumeProfile(closes1m, volumes1m);
  const volumeZone     = getVolumeZone(price, volProfile, atr);
  const smc1m          = detectSMC(closes1m, highs1m, lows1m);
  const smc5m          = closes5m.length >= 13 ? detectSMC(closes5m, highs5m, lows5m) : smc1m;
  const emaAlignment   = ema20 && ema50 ? (ema20 > ema50 ? 'BULL' : 'BEAR') : 'NEUTRAL';
  const wickRejection  = detectWickRejection(highs1m, lows1m, opens1m, closes1m);
  const spyCloses      = getCloses(spyData);
  const relativeStrength = spyCloses.length > 5
    ? ((closes1m[closes1m.length-1]/closes1m[closes1m.length-5]-1) - (spyCloses[spyCloses.length-1]/spyCloses[spyCloses.length-5]-1)) * 10
    : 0;

  // ── Fibonacci retracement levels — día real > swing 5m > rolling 1m ─────────
  const dayFib    = calculateDayRangeFib(dayHigh, dayLow);
  const fib5m     = closes5m.length >= 15 ? calculateFibLevels(highs5m, lows5m, 30) : null;
  const fibLevels = dayFib || fib5m || calculateFibLevels(highs1m, lows1m, 60);

  // SPY intraday fib (convergencia con mercado amplio)
  const getH = (d) => d?.indicators?.quote?.[0]?.high?.filter(v => v != null)  || [];
  const getL = (d) => d?.indicators?.quote?.[0]?.low?.filter(v => v != null)   || [];
  const getC = (d) => d?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
  const spyH5m = getH(spy5m), spyL5m = getL(spy5m), spyC5m = getC(spy5m);
  const spyFibLevels   = spyH5m.length >= 15 ? calculateFibLevels(spyH5m, spyL5m, 30) : null;
  const spyCurrentPrice = spyC5m.length > 0 ? spyC5m[spyC5m.length - 1] : null;

  // Coach context — siempre disponible independientemente del WAIT
  const isBullishDir   = emaAlignment === 'BULL';
  const obForContext   = detectOrderBlock(closes1m, opens1m, highs1m, lows1m, isBullishDir) ||
                         detectOrderBlock(closes5m, opens5m, highs5m, lows5m, isBullishDir);
  const entryZone      = obForContext
    ? { low: obForContext.low, high: obForContext.high, type: 'OB' }
    : volProfile.poc
    ? { low: volProfile.poc - (atr || 0) * 0.3, high: volProfile.poc + (atr || 0) * 0.3, type: 'POC' }
    : null;

  // Pre-compute fib touch here so coachContext always has it
  const fibTouchCoach    = getFibTouch(price, fibLevels, isBullishDir, atr);
  const spyFibTouchCoach = spyCurrentPrice && spyFibLevels
    ? getFibTouch(spyCurrentPrice, spyFibLevels, isBullishDir, atr * 0.15)
    : { touched: false, level: null, score: 0 };

  const dayOpenForCoach = closes1m[0];
  const coachContext = {
    price,
    ema20,
    ema50,
    poc:          volProfile.poc,
    hvnLevels:    volProfile.hvnLevels?.slice(0, 3),
    lvnLevels:    volProfile.lvnLevels?.slice(0, 3),
    dayHigh,
    dayLow,
    dayOpen:      dayOpenForCoach,
    dayBias:      price > dayOpenForCoach + 0.25 ? 'BULL' : price < dayOpenForCoach - 0.25 ? 'BEAR' : 'NEUTRAL',
    atr,
    atrUsedPct,
    atrRemaining,
    regime,
    emaAlignment,
    volumeZone,
    entryZone,
    sweep:          smc1m.sweep || smc5m.sweep,
    choch:          smc1m.choch || smc5m.choch,
    wickRejection,
    relativeStrength,
    fibTouch:       fibTouchCoach,
    fibLevels,
    spyFibTouch:    spyFibTouchCoach,
    spyConvergence: spyFibTouchCoach.touched,
  };

  const getTrend = (closes) => {
    if (closes.length < 5) return 'NEUTRAL';
    return closes[closes.length - 1] > closes[closes.length - 5] ? 'BULL' : 'BEAR';
  };
  const trends = {
    '1m':  getTrend(closes1m),
    '5m':  getTrend(closes5m),
    '15m': getTrend(getCloses(i15m)),
    '1h':  getTrend(getCloses(i1h))
  };

  const session = getSessionLabel();

  // ── Filtros obligatorios — ahora TODOS incluyen coachContext ─────────────
  if (atrUsedPct > 0.85) {
    return { signal: 'WAIT', reason: `Mercado extendido — ATR ${(atrUsedPct*100).toFixed(0)}% usado.`, trends, checklist: { atrOk: false }, atr, atrUsedPct, atrRemaining, regime, coachContext, session };
  }

  if (!session) {
    return { signal: 'WAIT', reason: 'Fuera de ventana 0DTE.', trends, checklist: { atrOk: atrUsedPct < 0.8 }, atr, atrUsedPct, atrRemaining, regime, coachContext, session: null };
  }

  if (isLateralMarket(closes1m)) {
    return { signal: 'WAIT', reason: 'Mercado lateral — esperando momentum.', trends, checklist: { atrOk: true }, atr, atrUsedPct, atrRemaining, regime, coachContext, session };
  }

  if (isLowVolume(volumes1m)) {
    return { signal: 'WAIT', reason: 'Volumen bajo — sin flujo institucional.', trends, checklist: { atrOk: true }, atr, atrUsedPct, atrRemaining, regime, coachContext, session };
  }

  const sweep = smc1m.sweep || smc5m.sweep;
  const choch = smc1m.choch || smc5m.choch;
  const volumeConfl  = volumeZone === 'POC' || volumeZone === 'LVN';

  // ── DIRECCIÓN: Bias del día (v5 — backtest validated) ───────────────────
  // EMA crossover falla en pullbacks (EMA20 cae más rápido que EMA50 = falso downtrend).
  // Solución: precio > apertura del día = BULL, precio < apertura = BEAR.
  const dayOpen   = closes1m[0];
  const dayBull   = price > dayOpen + 0.25;
  const dayBear   = price < dayOpen - 0.25;

  // No entrar en el top/bottom 8% del rango del día (no perseguir extremos)
  const dayRange    = (dayHigh || price) - (dayLow || price);
  const nearDayHigh = dayRange > 0 && (dayHigh - price) / dayRange < 0.08;
  const nearDayLow  = dayRange > 0 && (price - dayLow)  / dayRange < 0.08;

  const isBullish = dayBull && !nearDayHigh;
  const isBearish = dayBear && !nearDayLow;

  const ob = detectOrderBlock(closes1m, opens1m, highs1m, lows1m, isBullish) ||
             detectOrderBlock(closes5m, opens5m, highs5m, lows5m, isBullish);
  const pullbackZone = isPullbackToZone(price, ob, volProfile.poc, atr);

  // ── Fib bounce detection (gate primario — reemplaza sweep) ───────────────
  const fibBounce  = getBestFibBounce(closes1m, fibLevels, isBullish, atr);

  // ── Score máximo 15 (SMC da puntos adicionales, no son gate) ─────────────
  const fibTouch     = fibBounce.bouncing
    ? { touched: true, level: fibBounce.label, score: fibBounce.score }
    : getFibTouch(price, fibLevels, isBullish, atr);
  const spyFibTouch  = spyCurrentPrice && spyFibLevels
    ? getFibTouch(spyCurrentPrice, spyFibLevels, isBullish, atr * 0.15)
    : { touched: false, score: 0 };
  const spyConvergence = spyFibTouch.touched;

  // EMA alignment score: ema20 vs ema50 y precio (scoring, ya no gate de dirección)
  const emaConfirmed = emaAlignment !== 'NEUTRAL' &&
    ((emaAlignment === 'BULL' && price > ema20) || (emaAlignment === 'BEAR' && price < ema20));

  let score = 0;
  if (sweep)            score += 3;
  if (choch)            score += 2;
  if (emaConfirmed)     score += 2;
  if (volumeConfl)      score += 2;
  if (atrUsedPct < 0.7) score += 2;
  score += fibTouch.score;          // +1 / +2 / +3
  if (spyConvergence)   score += 1; // SPY en mismo nivel Fib

  const checklist = {
    sweep, choch,
    emaAlignment:     emaConfirmed,
    volumeConfluence: volumeConfl,
    atrOk:            atrUsedPct < 0.8,
    pullback:         pullbackZone.inZone,
    fibLevel:         fibTouch.touched,
    spyConvergence,
    gamma:            true,
  };

  // ── Gate principal: Fib bounce confirmado + dirección clara ──────────────
  if (!isBullish && !isBearish) {
    return { signal: 'WAIT', reason: `Precio en zona neutral (vs apertura $${dayOpen?.toFixed(2)}). Sin sesgo claro.`, trends, checklist, atr, atrUsedPct, atrRemaining, regime, score, session, coachContext };
  }

  if (!fibBounce.bouncing) {
    const fib50  = isBullish ? fibLevels?.bull?.r500 : fibLevels?.bear?.r500;
    const fib382 = isBullish ? fibLevels?.bull?.r382 : fibLevels?.bear?.r382;
    const fib618 = isBullish ? fibLevels?.bull?.r618 : fibLevels?.bear?.r618;
    const nearestMsg = fib50 ? ` Fib 50%: $${fib50.toFixed(2)} | 38.2%: $${fib382?.toFixed(2)}` : '';
    return { signal: 'WAIT', reason: `Esperando rebote en nivel Fibonacci.${nearestMsg}`, trends, checklist, atr, atrUsedPct, atrRemaining, regime, score, session, coachContext };
  }

  if (score < 5) {
    return { signal: 'WAIT', reason: `Score ${score}/15 — mín. 5 (Fib bounce sin confirmación adicional).`, trends, checklist, atr, atrUsedPct, atrRemaining, regime, score, session, coachContext };
  }

  // Gamma context
  const gammaOk = gammaData ? (isBullish ? price > gammaData.gammaFlip : price < gammaData.gammaFlip) : true;
  checklist.gamma = gammaOk;

  // ── 6. Execution — SL/TP con Fib target ──────────────────────────────────
  // SL y TP fijos — validado por backtest: SL $0.50 / TP $2.00 (RR 4:1)
  // SL fijo evita que la estructura SMC variable distorsione el riesgo real
  const FIXED_SL = 0.50;
  const FIXED_TP = 2.00;
  const entry    = price;
  const sl       = isBullish ? entry - FIXED_SL : entry + FIXED_SL;
  const tp       = isBullish ? entry + FIXED_TP : entry - FIXED_TP;
  const rrRatio  = (FIXED_TP / FIXED_SL).toFixed(1); // siempre 4.0

  // ── 7. Opciones 0DTE ──────────────────────────────────────────────────────
  const optionSLPct  = -30;
  const optionTP1Pct = +25;
  const optionTP2Pct = +50;

  const fibLabel = fibBounce.bouncing
    ? ` | Fib ${fibBounce.label}${spyConvergence ? '+SPY ✓' : ''} (bounce ✓)`
    : fibTouch.touched ? ` | Fib ${fibTouch.level}${spyConvergence ? '+SPY' : ''}` : '';
  const dayBiasLabel = isBullish ? `↑ $${dayOpen?.toFixed(2)}` : `↓ $${dayOpen?.toFixed(2)}`;
  // Probabilidad basada en: bounce confirmado (base 70%) + score adicional
  const probability = fibBounce.score >= 3 && score >= 10 ? 88
    : fibBounce.score >= 2 && score >= 7  ? 79
    : fibBounce.score >= 1 && score >= 5  ? 70
    : 65;
  const signalType  = isBullish ? '0DTE CALL' : '0DTE PUT';
  const mentorMsg   = `Bounce en ${fibBounce.label} confirmado | Bias día ${dayBiasLabel} | Score ${score}/15${fibLabel} | ${session} | SL $0.50 → TP $2.00 (RR ${rrRatio}:1)`;

  return {
    signal: signalType,
    entry,
    sl,
    tp,
    tp1Pct:   optionTP1Pct,
    tp2Pct:   optionTP2Pct,
    slPct:    optionSLPct,
    probability,
    trends,
    checklist,
    atr,
    atrUsedPct,
    atrRemaining,
    regime,
    setupGrade:    'A+',
    volumeZone,
    score,
    session,
    wickRejection,
    pullbackZone,
    relativeStrength,
    fibTouch,
    spyConvergence,
    mentorMessage: mentorMsg,
    reason: `0DTE A+ (${score}/15)${fibLabel} | ${session} | SL $${FIXED_SL} / TP $${FIXED_TP} | R:R ${rrRatio}:1`
  };
}

function SignalHistoryTable({ signals }) {
  if (!signals || signals.length === 0) {
    return (
      <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-3 h-3" /> Historial de Señales
        </p>
        <p className="text-xs text-muted-foreground text-center py-4">Sin señales registradas todavía.</p>
      </div>
    );
  }

  return (
    <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4 space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <BarChart3 className="w-3 h-3" /> Historial de Señales
        <span className="ml-auto text-[9px] bg-secondary/40 border border-white/10 px-2 py-0.5 rounded-full">{signals.length}</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left font-black text-muted-foreground uppercase pb-2 pr-3">Fecha / Hora</th>
              <th className="text-left font-black text-muted-foreground uppercase pb-2 pr-3">Ticker</th>
              <th className="text-left font-black text-muted-foreground uppercase pb-2 pr-3">Señal</th>
              <th className="text-right font-black text-muted-foreground uppercase pb-2 pr-3">Entrada</th>
              <th className="text-right font-black text-muted-foreground uppercase pb-2 pr-3">SL</th>
              <th className="text-right font-black text-muted-foreground uppercase pb-2 pr-3">TP</th>
              <th className="text-center font-black text-muted-foreground uppercase pb-2 pr-3">Score</th>
              <th className="text-left font-black text-muted-foreground uppercase pb-2">Sesión</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {signals.map((s, i) => {
              const isCall = s.signal_type?.includes('CALL');
              const dt = s.created_at ? new Date(s.created_at) : null;
              const dateStr = dt ? dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '--';
              const timeStr = dt ? dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }) : '--';
              return (
                <tr key={i} className="hover:bg-white/3 transition-colors">
                  <td className="py-2 pr-3 font-mono text-muted-foreground whitespace-nowrap">
                    {dateStr} <span className="text-primary">{timeStr}</span>
                  </td>
                  <td className="py-2 pr-3 font-black">{s.ticker}</td>
                  <td className="py-2 pr-3">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full font-black text-[9px] uppercase',
                      isCall ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                    )}>
                      {s.signal_type}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{s.entry ? `$${Number(s.entry).toFixed(2)}` : '--'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-red-400">{s.sl ? `$${Number(s.sl).toFixed(2)}` : '--'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-emerald-400">{s.tp ? `$${Number(s.tp).toFixed(2)}` : '--'}</td>
                  <td className="py-2 pr-3 text-center">
                    <span className={cn(
                      'font-black',
                      s.score >= 9 ? 'text-emerald-400' : s.score >= 7 ? 'text-amber-400' : 'text-muted-foreground'
                    )}>
                      {s.score ?? '--'}/11
                    </span>
                  </td>
                  <td className="py-2 text-muted-foreground">{s.session || '--'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function fetchStockPrice(ticker) {
  try {
    const res = await fetch(`/api/yahoo/chart/${ticker}?interval=1d&range=5d`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    
    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close?.filter(v => v != null) || [];
    const highs = quote.high?.filter(v => v != null) || [];
    const lows = quote.low?.filter(v => v != null) || [];
    const opens = quote.open?.filter(v => v != null) || [];

    return {
      current_price: closes[closes.length - 1],
      prev_close: closes.length >= 2 ? closes[closes.length - 2] : result.meta?.chartPreviousClose,
      today_open: opens[opens.length - 1],
      today_high: highs[highs.length - 1],
      today_low: lows[lows.length - 1],
    };
  } catch (e) {
    return null;
  }
}

async function fetchIntradayData(ticker, interval = '1m') {
  try {
    const res = await fetch(`/api/yahoo/chart/${ticker}?interval=${interval}&range=1d`);
    const json = await res.json();
    return json?.chart?.result?.[0] || null;
  } catch (e) {
    return null;
  }
}

async function fetchVix() {
  try {
    const res = await fetch('/api/yahoo/chart/%5EVIX?interval=1d&range=5d');
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    
    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close?.filter(v => v != null) || [];
    const current = closes[closes.length - 1];
    const prev = closes.length >= 2 ? closes[closes.length - 2] : current;
    
    return { vix: current, prev_close: prev };
  } catch (e) {
    console.error('Error VIX', e);
    return null;
  }
}

export default function Live2Panel() {
  const [selectedTicker, setSelectedTicker] = useState('NVDA');
  const [vixData, setVixData] = useState(null);
  const [spyData, setSpyData] = useState(null);
  const [qqqData, setQqqData] = useState(null);
  const [tickerData, setTickerData] = useState(null);
  const [intraday1m, setIntraday1m] = useState(null);
  const [intraday5m, setIntraday5m] = useState(null);
  const [intraday15m, setIntraday15m] = useState(null);
  const [intraday1h, setIntraday1h] = useState(null);
  const [activeTrade, setActiveTrade] = useState(null);
  const [view, setView] = useState('LIVE');
  const [optionsData, setOptionsData] = useState(null);
  const [tradeHistory, setTradeHistory] = useState(() => {
    const saved = localStorage.getItem('trading_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [dailyTradeCount, setDailyTradeCount] = useState(() => {
    const saved = localStorage.getItem('daily_trade_count');
    if (!saved) return { date: '', count: 0 };
    try { return JSON.parse(saved); } catch { return { date: '', count: 0 }; }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [signal, setSignal] = useState({ signal: 'WAIT', reason: 'Cargando...' });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [signalHistory, setSignalHistory] = useState([]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);

    try {
      const [vix, spy, qqq, ticker, i1m, i5m, i15m, i1h, options, spy5m] = await Promise.all([
        fetchVix(),
        fetchStockPrice('SPY'),
        fetchStockPrice('QQQ'),
        fetchStockPrice(selectedTicker),
        fetchIntradayData(selectedTicker, '1m'),
        fetchIntradayData(selectedTicker, '5m'),
        fetchIntradayData(selectedTicker, '15m'),
        fetchIntradayData(selectedTicker, '1h'),
        fetchOptionChain(selectedTicker),
        fetchIntradayData('SPY', '5m'),
      ]);

      setVixData(vix);
      setSpyData(spy);
      setQqqData(qqq);
      setTickerData(ticker);
      setIntraday1m(i1m);
      setIntraday5m(i5m);
      setIntraday15m(i15m);
      setIntraday1h(i1h);
      setOptionsData(options);

      // 1. If we have an active trade, track it
      if (activeTrade) {
        const currentPrice = ticker?.current_price;
        if (currentPrice) {
          const isCall = activeTrade.signal.includes('CALL');
          const hitTP = isCall ? currentPrice >= activeTrade.tp : currentPrice <= activeTrade.tp;
          const hitSL = isCall ? currentPrice <= activeTrade.sl : currentPrice >= activeTrade.sl;

          if (hitTP || hitSL) {
            const tradeResult = hitTP ? 'SUCCESS' : 'FAILURE';
            const completedTrade = {
              ...activeTrade,
              exitPrice: currentPrice,
              result: tradeResult,
              closedAt: new Date().toISOString()
            };
            // persist to DB (best-effort) + localStorage
            if (activeTrade.dbId) {
              closeTrade(activeTrade.dbId, currentPrice, tradeResult);
            }
            const newHistory = [completedTrade, ...tradeHistory].slice(0, 50);
            setTradeHistory(newHistory);
            localStorage.setItem('trading_history', JSON.stringify(newHistory));
            setActiveTrade(null);
          }
        }
      }

      // 2. Only run analysis if we don't have an active trade
      if (ticker && i1m && !activeTrade) {
        const gammaLevels = calculateGEX(options, ticker.current_price);
        const analysis = await analyzeTicker(selectedTicker, spy, qqq, vix?.vix || 20, i1m, i5m, i15m, i1h, gammaLevels, spy5m);
        setSignal(analysis);
        // save non-WAIT signals to DB and refresh history
        if (analysis.signal !== 'WAIT') {
          saveSignal(selectedTicker, analysis).then(() => {
            getSignals(selectedTicker, 30).then(rows => setSignalHistory(rows));
          });
        }
      }

      setLastUpdated(new Date());
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedTicker, activeTrade, tradeHistory]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      if (selectedTicker && !isLoading && isMarketOpen()) {
        fetchData();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Load signal history when ticker changes
  useEffect(() => {
    getSignals(selectedTicker, 30).then(rows => setSignalHistory(rows));
  }, [selectedTicker]);

  const handleTrade = async (trade) => {
    // Check daily limit from DB first, fallback to localStorage
    const todayCount = await getTodayTradeCount();
    if (todayCount >= 3) {
      alert('Límite diario alcanzado (3 trades). Regla 0DTE: más trades = pierdes ventaja.');
      return;
    }
    // Update localStorage counter as fallback
    const today = new Date().toISOString().slice(0, 10);
    const newCount = { date: today, count: todayCount + 1 };
    setDailyTradeCount(newCount);
    localStorage.setItem('daily_trade_count', JSON.stringify(newCount));
    // Save to DB and get ID for close tracking
    const dbTrade = await saveTrade({
      ticker:      selectedTicker,
      signal:      trade.signal,
      entry:       trade.entry,
      sl:          trade.sl,
      tp:          trade.tp,
      score:       signal.score,
      setupGrade:  signal.setupGrade,
      atrUsedPct:  signal.atrUsedPct,
      volumeZone:  signal.volumeZone,
      session:     signal.session,
    });
    setActiveTrade({
      ticker:    selectedTicker,
      signal:    trade.signal,
      entry:     trade.entry,
      sl:        trade.sl,
      tp:        trade.tp,
      openedAt:  new Date().toISOString(),
      dbId:      dbTrade?.id,
    });
  };

  const spyChange = spyData?.current_price && spyData?.prev_close 
    ? ((spyData.current_price - spyData.prev_close) / spyData.prev_close * 100) 
    : 0;
  const qqqChange = qqqData?.current_price && qqqData?.prev_close 
    ? ((qqqData.current_price - qqqData.prev_close) / qqqData.prev_close * 100) 
    : 0;

  const { session: mktSession, isOpen: mktIsOpen } = getMarketHours();

  return (
    <div className="flex flex-col gap-6 p-4 max-w-4xl mx-auto pb-20">
      <Header
        ticker={selectedTicker}
        price={tickerData?.current_price}
        change={((tickerData?.current_price - tickerData?.prev_close) / tickerData?.prev_close * 100)}
        vix={vixData?.vix}
        spyChange={spyChange}
        qqqChange={qqqChange}
      />

      <TickerSearch
        value={selectedTicker}
        onChange={setSelectedTicker}
        onAnalyze={fetchData}
        isLoading={isLoading}
      />

      <LivePriceCard
        ticker={selectedTicker}
        price={tickerData?.current_price}
        change={((tickerData?.current_price - tickerData?.prev_close) / tickerData?.prev_close * 100)}
      />

      {/* MarketStatus + MTFStatus → MarketPulse */}
      <MarketPulse
        vix={vixData?.vix}
        spyChange={spyChange}
        qqqChange={qqqChange}
        session={mktSession}
        isOpen={mktIsOpen}
      />

      <ProIntelligencePanel
        ticker={selectedTicker}
        rs={signal.relativeStrength || 0}
        alignment={signal.alignment || 'MID'}
        vixRegime={vixData?.vix > 20 ? 'HIGH' : 'LOW'}
      />

      {/* Mapa del día — siempre visible */}
      {(() => {
        const c1m = intraday1m?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
        const h1m = intraday1m?.indicators?.quote?.[0]?.high?.filter(v => v != null)  || [];
        const l1m = intraday1m?.indicators?.quote?.[0]?.low?.filter(v => v != null)   || [];
        const dayFib = calculateDayRangeFib(tickerData?.today_high, tickerData?.today_low);
        const pivots = c1m.length > 20 ? detectPivotZones(h1m, l1m, signal.atr || 1) : [];
        return (
          <DayPriceMap
            closes={c1m}
            fibLevels={dayFib}
            pivotZones={pivots}
            currentPrice={tickerData?.current_price}
            entry={signal.entry}
            sl={signal.sl}
            tp={signal.tp}
            signal={signal.signal}
          />
        );
      })()}

      {activeTrade ? (
        <ActiveRace
          trade={activeTrade}
          currentPrice={tickerData?.current_price}
        />
      ) : (
        <>
          {/* Semáforo principal */}
          <TrafficLight
            signal={signal.signal}
            reason={signal.reason}
            setupGrade={signal.setupGrade}
            score={signal.score}
            entry={signal.entry}
            sl={signal.sl}
            tp={signal.tp}
            probability={signal.probability}
            fibTouch={signal.fibTouch}
            spyConvergence={signal.spyConvergence}
            mentorMessage={getMentorMessage(
              signal.signal,
              signal.trends,
              signal.checklist,
              signal.relativeStrength || 0,
              null,
              tickerData?.current_price,
              false,
              signal.regime,
              signal.atrUsedPct,
              signal.volumeZone
            )}
          />

          {/* 5 llaves */}
          <FiveKeys checklist={signal.checklist} />

          {/* Coach en vivo — solo cuando WAIT */}
          {signal.signal === 'WAIT' && signal.coachContext && (
            <CoachPanel
              coachContext={signal.coachContext}
              score={signal.score}
              reason={signal.reason}
            />
          )}

          {/* Si hay señal: botón ejecutar + visualizador */}
          {signal.signal !== 'WAIT' && (
            <>
              <div className="flex gap-3">
                <button
                  onClick={() => handleTrade({ signal: signal.signal, entry: signal.entry, sl: signal.sl, tp: signal.tp })}
                  className={cn(
                    'flex-1 h-14 rounded-2xl font-black text-lg tracking-tight border-2 transition-all active:scale-95 shadow-lg',
                    signal.signal.includes('CALL')
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-400 shadow-emerald-500/30'
                      : 'bg-red-500 hover:bg-red-600 text-white border-red-400 shadow-red-500/30'
                  )}
                >
                  ⚡ EJECUTAR {signal.signal}
                </button>
              </div>
              <TradeVisualizer
                entry={signal.entry}
                sl={signal.sl}
                tp={signal.tp}
                signal={signal.signal}
                currentPrice={tickerData?.current_price}
              />
            </>
          )}
        </>
      )}

      {/* Historial → ScoreBoard */}
      <ScoreBoard history={tradeHistory} />

      {/* Historial de señales DB */}
      <SignalHistoryTable signals={signalHistory} />

      {/* Backtest */}
      <BacktestPanel ticker={selectedTicker} />

      <div className="grid grid-cols-4 gap-2">
        <div className="bg-secondary/30 rounded-lg p-2 text-center">
          <p className="text-[8px] text-muted-foreground">APERTURA</p>
          <p className="text-xs font-mono">{formatPrice(tickerData?.today_open)}</p>
        </div>
        <div className="bg-secondary/30 rounded-lg p-2 text-center">
          <p className="text-[8px] text-muted-foreground">MÁXIMO</p>
          <p className="text-xs font-mono">{formatPrice(tickerData?.today_high)}</p>
        </div>
        <div className="bg-secondary/30 rounded-lg p-2 text-center">
          <p className="text-[8px] text-muted-foreground">MÍNIMO</p>
          <p className="text-xs font-mono">{formatPrice(tickerData?.today_low)}</p>
        </div>
        <div className="bg-secondary/30 rounded-lg p-2 text-center">
          <p className="text-[8px] text-muted-foreground">ÚLTIMO CIERRE</p>
          <p className="text-xs font-mono">{formatPrice(tickerData?.prev_close)}</p>
        </div>
      </div>

      <div className="text-[9px] text-muted-foreground text-center">
        Actualiza cada 5 segundos • Mercado US (ET)
      </div>
    </div>
  );
}