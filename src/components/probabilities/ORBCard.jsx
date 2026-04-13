import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Info, Database, TrendingUp, Wind, Activity, BarChart2, Layers, GitMerge, AlertTriangle, Target, ShieldAlert, Zap, Clock, RefreshCw } from 'lucide-react';
import InfoModal from '../trading/InfoModal';

function classifyGap(gapPct) {
  const abs = Math.abs(gapPct || 0);
  if (abs < 0.5)  return { label: 'Sin gap / Pequeño',  range: '<0.5%',  noise: 'Alto ruido',      noiseColor: 'text-red-400',     probBoost: 0  };
  if (abs < 1.0)  return { label: 'Gap Moderado',        range: '0.5–1%', noise: 'Equilibrio',      noiseColor: 'text-amber-400',   probBoost: 5  };
  if (abs < 2.0)  return { label: 'Gap Medio',           range: '1–2%',   noise: 'Buen escenario',  noiseColor: 'text-primary',     probBoost: 10 };
  if (abs < 5.0)  return { label: 'Gap Grande',          range: '2–5%',   noise: 'Mov. fuerte',     noiseColor: 'text-emerald-400', probBoost: 12 };
  return           { label: 'Gap Extremo',               range: '>5%',    noise: 'Alta volatilidad', noiseColor: 'text-cyan-400',   probBoost: 15 };
}

function calcAdjustedProb(orb, gapClass) {
  let base = orb.single_break_prob || 55;
  base += gapClass.probBoost;
  if (orb.gap_confluence_boost) base += orb.gap_confluence_boost * 0.5;
  return Math.min(95, Math.round(base));
}

function computeTradeLevels(orb) {
  const high = orb.high;
  const low = orb.low;
  if (!high || !low) return null;
  const range = high - low;
  const atrEst = range * 2;
  return {
    callEntry: high + range * 0.02,
    callSL:    low  - range * 0.15,
    callTP:    high + atrEst,
    putEntry:  low  - range * 0.02,
    putSL:     high + range * 0.15,
    putTP:     low  - atrEst,
  };
}

const FAIL_CONDITIONS = [
  'Gap pequeño o sin gap (bajo momentum)',
  'Volumen bajo en la vela de ruptura',
  'Rango ORB muy amplio (>1% del precio)',
  'Mercado en rango / consolidación',
  'Precio regresa al interior del ORB tras ruptura',
];

export default function ORBCard({ timeframe, data, gapData, confluence }) {
  const [showInfo, setShowInfo] = useState(false);

  const isDoubleBreak = data?.status === 'double_break';

  // Determine default side from ORB status
  const defaultSide = (() => {
    const s = data?.status;
    if (s === 'single_break_down') return 'PUT';
    if (s === 'single_break_up') return 'CALL';
    if (s === 'double_break') return 'CALL'; // neutral — show both
    if (gapData?.gap_size_usd < 0) return 'PUT';
    return 'CALL';
  })();

  const [activeSide, setActiveSide] = useState(defaultSide);

  const orb = data || {};
  const gapPct = gapData?.gap_size_percent || 0;
  const gapClass = classifyGap(gapPct);
  const adjProb = calcAdjustedProb(orb, gapClass);
  const levels = computeTradeLevels(orb);

  const bars = [
    { label: 'Single Break (direccional)', value: orb.single_break_prob ?? 0, color: 'from-emerald-600 to-emerald-400' },
    { label: 'Double Break (whipsaw)',      value: orb.double_break_prob ?? 0, color: 'from-blue-600 to-cyan-400' },
    { label: 'Consolidación (sin ruptura)', value: orb.consolidation_prob ?? 0, color: 'from-amber-600 to-amber-400' },
  ];

  const dirBars = [
    orb.break_up_prob != null && { label: '↑ Break Alcista', value: orb.break_up_prob, color: 'from-emerald-600 to-emerald-400' },
    orb.break_down_prob != null && { label: '↓ Break Bajista', value: orb.break_down_prob, color: 'from-red-500 to-red-400' },
  ].filter(Boolean);

  const breakQuality = [
    orb.clean_break_prob  != null && { label: 'Ruptura limpia',   value: orb.clean_break_prob,  color: 'from-emerald-600 to-emerald-400' },
    orb.failed_break_prob != null && { label: 'Ruptura fallida',  value: orb.failed_break_prob, color: 'from-red-500 to-red-400' },
  ].filter(Boolean);

  const conditions = [
    orb.small_range_break     != null && { icon: <BarChart2 className="w-2.5 h-2.5 text-emerald-400" />, label: 'ORB rango pequeño (<0.3%)', value: orb.small_range_break, color: 'text-emerald-400', group: 'Tamaño del ORB' },
    orb.large_range_break     != null && { icon: <BarChart2 className="w-2.5 h-2.5 text-red-400" />,     label: 'ORB rango grande (>1%)',    value: orb.large_range_break, color: 'text-red-400',     group: 'Tamaño del ORB' },
    orb.large_gap_day_penalty != null && { icon: <TrendingUp className="w-2.5 h-2.5 text-orange-400" />, label: 'Gap grande (>1.5%)',        value: `-${orb.large_gap_day_penalty?.toFixed(1)}%`, color: 'text-orange-400', isBoost: true, group: 'Tamaño del GAP' },
    orb.gap_confluence_boost  != null && { icon: <GitMerge className="w-2.5 h-2.5 text-purple-400" />,   label: 'Breakout = dirección gap',  value: `+${orb.gap_confluence_boost?.toFixed(1)}%`,  color: 'text-purple-400', isBoost: true, group: 'Confluencia GAP' },
    orb.trending_market_break != null && { icon: <TrendingUp className="w-2.5 h-2.5 text-emerald-400" />,label: 'Mercado tendencial (ADX>25)',value: orb.trending_market_break, color: 'text-emerald-400', group: 'Condición mercado' },
    orb.ranging_market_break  != null && { icon: <Activity className="w-2.5 h-2.5 text-amber-400" />,    label: 'Mercado lateral/choppy',    value: orb.ranging_market_break,  color: 'text-amber-400',   group: 'Condición mercado' },
    orb.vol_confirm_boost     != null && { icon: <Layers className="w-2.5 h-2.5 text-amber-400" />,      label: 'Volumen ruptura >1.5x avg', value: `+${orb.vol_confirm_boost?.toFixed(1)}%`,     color: 'text-amber-400',  isBoost: true, group: 'Volumen' },
    orb.gamma_wall_boost      != null && { icon: <Layers className="w-2.5 h-2.5 text-cyan-400" />,       label: 'Alineado con gamma/OI',    value: `+${orb.gamma_wall_boost?.toFixed(1)}%`,      color: 'text-cyan-400',   isBoost: true, group: 'Gamma / OI' },
    orb.low_vix_boost         != null && { icon: <Wind className="w-2.5 h-2.5 text-cyan-400" />,         label: 'VIX bajo (<15)',            value: `+${orb.low_vix_boost?.toFixed(1)}%`,         color: 'text-cyan-400',   isBoost: true, group: 'VIX' },
    orb.high_vix_penalty      != null && { icon: <Wind className="w-2.5 h-2.5 text-red-400" />,          label: 'VIX alto (>25)',            value: `-${orb.high_vix_penalty?.toFixed(1)}%`,      color: 'text-red-400',    isBoost: true, group: 'VIX' },
    orb.index_confirm_boost   != null && { icon: <GitMerge className="w-2.5 h-2.5 text-emerald-400" />,  label: 'SPX + NQ confirman',        value: `+${orb.index_confirm_boost?.toFixed(1)}%`,   color: 'text-emerald-400',isBoost: true, group: 'Confluencia índices' },
  ].filter(Boolean);

  const groups = conditions.reduce((acc, c) => {
    if (!acc[c.group]) acc[c.group] = [];
    acc[c.group].push(c);
    return acc;
  }, {});

  const infoContent = `## ORB ${timeframe} — Probabilidades por tipo de GAP

| Tipo | Rango | Probabilidad breakout limpio |
|------|-------|------------------------------|
| Sin gap | <0.5% | ~45% — alto ruido |
| Moderado | 0.5–1% | 60–70% — equilibrio |
| Medio | 1–2% | 65–75% — buen escenario |
| Grande | 2–5% | 70–80% — movimiento fuerte |
| Extremo | >5% | 75–85% — alta volatilidad |

### Cuándo FALLA el ORB
- Gap pequeño o sin gap → bajo momentum
- Volumen bajo en ruptura → falta convicción
- Rango ORB muy amplio → resistencia interna
- Mercado en rango/consolidación → sin dirección macro
- Sin confirmación de SPX/NQ → divergencia de índices

*n≈${orb.orb_sample_days || orb.sample_count || '500+'} sesiones históricas*`;

  return (
    <>
      <Card className="bg-card border-border/50 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary/60 to-transparent" />
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">ORB {timeframe}</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20" onClick={() => setShowInfo(true)}>
            <Info className="w-3.5 h-3.5 text-primary" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* ORB Range — always show when high/low are available */}
          {(orb.high != null && orb.low != null) ? (
            <div className="flex justify-between text-[10px] font-mono bg-secondary/40 rounded-lg px-2.5 py-1.5">
              <span className="text-emerald-400">H: ${orb.high?.toFixed(2)}</span>
              <span className="text-muted-foreground">Rango: ${(orb.high - orb.low).toFixed(2)}</span>
              <span className="text-red-400">L: ${orb.low?.toFixed(2)}</span>
            </div>
          ) : (
            <div className="flex justify-center text-[10px] font-mono bg-secondary/40 rounded-lg px-2.5 py-1.5 text-muted-foreground">
              ORB pendiente — mercado no ha completado este timeframe
            </div>
          )}

          {/* Index Confluence mini-badge */}
          {confluence && (
            <div className={`flex items-center justify-between rounded-lg px-2.5 py-1 border text-[10px]
              ${confluence.aligned && confluence.market_direction === 'bullish' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                confluence.aligned && confluence.market_direction === 'bearish' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
              <span className="flex items-center gap-1">
                <GitMerge className="w-2.5 h-2.5" />
                SPY {confluence.spy?.direction === 'bullish' ? '▲' : '▼'} {confluence.spy?.change_pct}% · QQQ {confluence.qqq?.direction === 'bullish' ? '▲' : '▼'} {confluence.qqq?.change_pct}%
              </span>
              <span className="font-semibold">
                {confluence.confluence_boost > 0 ? '+' : ''}{confluence.confluence_boost}%
              </span>
            </div>
          )}

          {/* ORB Status badge */}
          {orb.status && orb.status !== 'pending' && (
            <div className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 border text-[10px] font-semibold
              ${orb.status === 'single_break_up'   ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                orb.status === 'single_break_down' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                orb.status === 'double_break'       ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
                'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
              <span>Estado actual</span>
              <span>{
                orb.status === 'single_break_up'   ? '↑ Rompió al alza' :
                orb.status === 'single_break_down' ? '↓ Rompió a la baja' :
                orb.status === 'double_break'       ? '↕ Double break (whipsaw)' :
                'Consolidando dentro del rango'
              }</span>
            </div>
          )}

          {/* ══ DOUBLE BREAK PANEL ══ */}
          {isDoubleBreak && (
            <div className="rounded-xl border border-blue-500/40 bg-blue-500/8 overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/15 border-b border-blue-500/25">
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[11px] font-bold text-blue-400">⚡ Double Break — Análisis Whipsaw</span>
              </div>
              <div className="px-3 py-2.5 space-y-2.5">

                {/* Qué significa */}
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  El precio rompió <span className="text-red-400 font-semibold">ambos lados del ORB</span> — este patrón indica una sesión choppy/whipsaw con bajo seguimiento direccional. Operar requiere confirmaciones adicionales.
                </p>

                {/* Probabilidades específicas de double break */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-secondary/50 rounded-lg p-2 text-center border border-border/40">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Reversal final alcista</p>
                    <p className="text-base font-bold font-mono text-emerald-400">
                      {orb.double_break_prob ? Math.round(100 - orb.double_break_prob * 0.6) : '~55'}%
                    </p>
                    <p className="text-[8px] text-muted-foreground">si 2do break = alza</p>
                  </div>
                  <div className="bg-secondary/50 rounded-lg p-2 text-center border border-border/40">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Reversal final bajista</p>
                    <p className="text-base font-bold font-mono text-red-400">
                      {orb.double_break_prob ? Math.round(100 - orb.double_break_prob * 0.6) : '~55'}%
                    </p>
                    <p className="text-[8px] text-muted-foreground">si 2do break = baja</p>
                  </div>
                </div>

                {/* Reglas de operación en double break */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-semibold text-blue-400 uppercase tracking-wide flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />Estrategia recomendada
                  </p>
                  {[
                    { icon: '⏳', text: 'ESPERAR: no entrar hasta que el precio salga del ORB con cierre de vela confirmada (no wick)' },
                    { icon: '📊', text: 'VOLUMEN: el breakout definitivo debe tener volumen >1.5x el promedio — sin volumen = nueva trampa' },
                    { icon: '📐', text: 'DIRECCIÓN FINAL: operar EN LA DIRECCIÓN del 2do break si el precio cierra y se mantiene fuera del ORB por 2+ velas' },
                    { icon: '🛡️', text: 'STOP estricto: colocar SL dentro del ORB (al otro extremo) — el double break invalida si el precio regresa al interior' },
                    { icon: '🎯', text: 'TP reducido: en whipsaw el TP = 1x rango ORB (no 2x). Reducir tamaño de posición 50%' },
                  ].map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-[11px] shrink-0">{r.icon}</span>
                      <span className="text-[9px] text-foreground/80 leading-tight">{r.text}</span>
                    </div>
                  ))}
                </div>

                {/* Señal clave */}
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5">
                  <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                  <p className="text-[9px] text-amber-400 font-medium">
                    <span className="font-bold">Señal de alta probabilidad:</span> cierre de vela de 5min fuera del ORB + volumen + confirmación de índices (SPX/NQ) en la misma dirección.
                  </p>
                </div>

                {/* Niveles ajustados para double break */}
                {orb.high && orb.low && (() => {
                  const range = orb.high - orb.low;
                  const buf = range * 0.05;
                  return (
                    <div className="space-y-1">
                      <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <Target className="w-2.5 h-2.5 text-primary" />Niveles ajustados (whipsaw — TP reducido)
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {/* CALL side */}
                        <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-lg p-2 space-y-1">
                          <p className="text-[9px] font-bold text-emerald-400">CALL ↑ (si 2do break = alza)</p>
                          <div className="text-[9px] font-mono space-y-0.5">
                            <div className="flex justify-between"><span className="text-muted-foreground">Entrada:</span><span className="text-foreground">${(orb.high + buf).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Stop:</span><span className="text-red-400">${(orb.low - buf).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Target:</span><span className="text-emerald-400">${(orb.high + range).toFixed(2)}</span></div>
                          </div>
                        </div>
                        {/* PUT side */}
                        <div className="bg-red-500/8 border border-red-500/20 rounded-lg p-2 space-y-1">
                          <p className="text-[9px] font-bold text-red-400">PUT ↓ (si 2do break = baja)</p>
                          <div className="text-[9px] font-mono space-y-0.5">
                            <div className="flex justify-between"><span className="text-muted-foreground">Entrada:</span><span className="text-foreground">${(orb.low - buf).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Stop:</span><span className="text-red-400">${(orb.high + buf).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Target:</span><span className="text-emerald-400">${(orb.low - range).toFixed(2)}</span></div>
                          </div>
                        </div>
                      </div>
                      <p className="text-[8px] text-muted-foreground/60 italic">TP = 1x rango ORB (reducido por whipsaw) · SL al extremo opuesto del ORB</p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Gap context badge */}
          <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-secondary/30 border border-border/40">
            <div className="flex items-center gap-1.5">
              <GitMerge className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{gapClass.label} ({gapClass.range})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold ${gapClass.noiseColor}`}>{gapClass.noise}</span>
              <span className="text-[10px] font-bold text-primary">{adjProb}%</span>
            </div>
          </div>

          {/* Historical probability bars */}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Database className="w-2.5 h-2.5 text-primary" />
            <span className="font-medium">Probabilidades históricas</span>
          </div>

          {bars.map((bar) => (
            <div key={bar.label} className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">{bar.label}</span>
                <span className="text-foreground font-semibold">{(bar.value ?? 0).toFixed(1)}%</span>
              </div>
              <div className="h-4 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full rounded-full bg-gradient-to-r ${bar.color} transition-all duration-700`} style={{ width: `${bar.value ?? 0}%` }} />
              </div>
            </div>
          ))}

          {/* Break direction */}
          {dirBars.length > 0 && (
            <div className="pt-1 space-y-1">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Dirección del break</p>
              {dirBars.map((bar) => (
                <div key={bar.label} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">{bar.label}</span>
                    <span className="text-foreground font-semibold">{(bar.value ?? 0).toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full bg-gradient-to-r ${bar.color} transition-all duration-700`} style={{ width: `${bar.value ?? 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Break quality */}
          {breakQuality.length > 0 && (
            <div className="pt-2 border-t border-border/40 space-y-1">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Calidad del breakout</p>
              {breakQuality.map((bar) => (
                <div key={bar.label} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">{bar.label}</span>
                    <span className="text-foreground font-semibold">{(bar.value ?? 0).toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full bg-gradient-to-r ${bar.color} transition-all duration-700`} style={{ width: `${bar.value ?? 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trade Levels */}
          {levels && (
            <div className="pt-2 border-t border-border/40 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Target className="w-3 h-3 text-primary" />
                  Niveles de Operación
                </p>
                <div className="flex rounded-md overflow-hidden border border-border/50 text-[9px]">
                  <button onClick={() => setActiveSide('CALL')} className={`px-2 py-0.5 font-semibold transition-colors ${activeSide === 'CALL' ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:bg-secondary'}`}>CALL ↑</button>
                  <button onClick={() => setActiveSide('PUT')}  className={`px-2 py-0.5 font-semibold transition-colors ${activeSide === 'PUT'  ? 'bg-red-500/20 text-red-400'       : 'text-muted-foreground hover:bg-secondary'}`}>PUT ↓</button>
                </div>
              </div>
              <div className="text-[9px] text-muted-foreground px-1">
                {activeSide === 'CALL' ? 'Ruptura sobre H del ORB — breakout alcista' : 'Ruptura bajo L del ORB — breakout bajista'}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  { label: 'Entrada', value: activeSide === 'CALL' ? levels.callEntry : levels.putEntry, color: 'text-foreground' },
                  { label: 'Stop',    value: activeSide === 'CALL' ? levels.callSL    : levels.putSL,    color: 'text-red-400' },
                  { label: 'Target',  value: activeSide === 'CALL' ? levels.callTP    : levels.putTP,    color: 'text-emerald-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-secondary/40 rounded-lg p-1.5 border border-border/40">
                    <p className="text-[9px] text-muted-foreground">{label}</p>
                    <p className={`text-[11px] font-bold font-mono ${color}`}>${value?.toFixed(2)}</p>
                  </div>
                ))}
              </div>
              <div className="text-[9px] text-muted-foreground/60 italic px-1">TP = extensión 2x rango ORB · SL = extremo opuesto + buffer</div>
            </div>
          )}

          {/* Fail conditions */}
          <div className="pt-2 border-t border-border/40 space-y-1.5">
            <p className="text-[9px] font-semibold text-red-400 uppercase tracking-wide flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              Cuándo falla el ORB
            </p>
            {FAIL_CONDITIONS.map((cond, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="w-2.5 h-2.5 text-red-400/60 mt-0.5 shrink-0" />
                <span className="text-[9px] text-muted-foreground">{cond}</span>
              </div>
            ))}
          </div>

          {/* Conditional modifiers */}
          {Object.keys(groups).length > 0 && (
            <div className="pt-2 border-t border-border/40 space-y-2.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Modificadores contextuales</p>
              {Object.entries(groups).map(([groupName, items]) => (
                <div key={groupName}>
                  <p className="text-[9px] text-muted-foreground/60 mb-1">{groupName}</p>
                  <div className="space-y-1">
                    {items.map((c, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {c.icon}
                          <span className="text-[10px] text-muted-foreground">{c.label}</span>
                        </div>
                        <span className={`text-[10px] font-bold font-mono ${c.color}`}>
                          {c.isBoost ? c.value : `${c.value?.toFixed(1)}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

        </CardContent>
      </Card>
      <InfoModal open={showInfo} onClose={() => setShowInfo(false)} title={`ORB ${timeframe} — Info`} content={infoContent} />
    </>
  );
}