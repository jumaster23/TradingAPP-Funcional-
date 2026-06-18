import React from 'react';
import { TrendingUp, TrendingDown, Minus, Zap, AlertTriangle, Activity } from 'lucide-react';

const SIGNAL_CONFIG = {
  OVERBOUGHT: {
    label: 'Sobrecomprado',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
    headerBg: 'bg-red-500/15',
    icon: TrendingDown,
    dot: 'bg-red-400',
    tradeSignal: 'PUT',
    tradeColor: 'text-red-400',
  },
  OVERSOLD: {
    label: 'Sobrevendido',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    headerBg: 'bg-emerald-500/15',
    icon: TrendingUp,
    dot: 'bg-emerald-400',
    tradeSignal: 'CALL',
    tradeColor: 'text-emerald-400',
  },
  SQUEEZE: {
    label: 'Squeeze — Breakout inminente',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
    headerBg: 'bg-amber-500/15',
    icon: Zap,
    dot: 'bg-amber-400 animate-pulse',
    tradeSignal: 'ESPERAR',
    tradeColor: 'text-amber-400',
  },
  TRENDING: {
    label: 'Tendencia fuerte',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10 border-cyan-500/30',
    headerBg: 'bg-cyan-500/15',
    icon: Activity,
    dot: 'bg-cyan-400',
    tradeSignal: 'SEGUIR TENDENCIA',
    tradeColor: 'text-cyan-400',
  },
  NEAR_UPPER: {
    label: 'Cerca de banda superior',
    color: 'text-orange-400',
    bg: 'bg-orange-500/8 border-orange-500/25',
    headerBg: 'bg-orange-500/12',
    icon: AlertTriangle,
    dot: 'bg-orange-400',
    tradeSignal: 'MONITOREAR PUT',
    tradeColor: 'text-orange-400',
  },
  NEAR_LOWER: {
    label: 'Cerca de banda inferior',
    color: 'text-blue-400',
    bg: 'bg-blue-500/8 border-blue-500/25',
    headerBg: 'bg-blue-500/12',
    icon: AlertTriangle,
    dot: 'bg-blue-400',
    tradeSignal: 'MONITOREAR CALL',
    tradeColor: 'text-blue-400',
  },
  NEUTRAL: {
    label: 'Zona media — neutral',
    color: 'text-muted-foreground',
    bg: 'bg-secondary/30 border-border/40',
    headerBg: 'bg-secondary/50',
    icon: Minus,
    dot: 'bg-muted-foreground/40',
    tradeSignal: 'NEUTRAL',
    tradeColor: 'text-muted-foreground',
  },
};

const CONFIRMATION_RULES = [
  { icon: '📊', text: 'RSI: confirmar sobrecompra (>70) o sobreventa (<30) antes de entrar' },
  { icon: '📈', text: 'MACD: buscar cruce a favor de la señal BB (cruce bajista para PUT, alcista para CALL)' },
  { icon: '🔊', text: 'Volumen: la vela de confirmación debe tener volumen superior al promedio (>1.2x)' },
  { icon: '🧱', text: 'S/R: verificar que haya soporte/resistencia clave en la zona de la banda' },
  { icon: '🌪️', text: 'VIX: VIX bajo (<15) favorece rebotes en bandas; VIX alto (>25) aumenta probabilidad de ruptura' },
  { icon: '🎯', text: 'Gamma/OI: si la banda coincide con Call/Put Wall o nivel gamma → mayor probabilidad de reacción' },
];

/**
 * BollingerBandsPanel — muestra el análisis completo de BB para un timeframe.
 * Props:
 *   bb     — objeto devuelto por calcBollingerBands (getIntradayData)
 *   label  — e.g. "1 min" | "5 min"
 *   price  — precio actual (number)
 */
export default function BollingerBandsPanel({ bb, label = '5 min', price }) {
  if (!bb) return null;

  const cfg = SIGNAL_CONFIG[bb.signal] ?? SIGNAL_CONFIG.NEUTRAL;
  const Icon = cfg.icon;

  // Visual %B gauge (0 = lower band, 100 = upper band)
  const gaugePos = Math.max(0, Math.min(100, (bb.pct_b ?? 0.5) * 100));

  return (
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 ${cfg.headerBg} border-b border-inherit`}>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
          <span className={`text-[11px] font-bold ${cfg.color}`}>Bollinger Bands ({label})</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
          {cfg.tradeSignal}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">

        {/* Band values */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-secondary/40 rounded-lg p-1.5">
            <p className="text-[8px] text-muted-foreground uppercase">Banda Superior</p>
            <p className="text-[11px] font-bold font-mono text-red-400">${bb.upper?.toFixed(2)}</p>
          </div>
          <div className="bg-secondary/40 rounded-lg p-1.5">
            <p className="text-[8px] text-muted-foreground uppercase">Media (SMA20)</p>
            <p className="text-[11px] font-bold font-mono text-amber-400">${bb.middle?.toFixed(2)}</p>
          </div>
          <div className="bg-secondary/40 rounded-lg p-1.5">
            <p className="text-[8px] text-muted-foreground uppercase">Banda Inferior</p>
            <p className="text-[11px] font-bold font-mono text-emerald-400">${bb.lower?.toFixed(2)}</p>
          </div>
        </div>

        {/* %B Gauge */}
        <div className="space-y-1">
          <div className="flex justify-between text-[9px]">
            <span className="text-muted-foreground">%B (posición del precio)</span>
            <span className={`font-bold font-mono ${cfg.color}`}>{(bb.pct_b * 100).toFixed(1)}%</span>
          </div>
          <div className="relative h-4 rounded-full overflow-hidden bg-gradient-to-r from-emerald-500/30 via-amber-500/20 to-red-500/30 border border-border/40">
            {/* Band zones */}
            <div className="absolute inset-0 flex">
              <div className="flex-1 border-r border-border/30" />
              <div className="flex-1 border-r border-border/30" />
              <div className="flex-1" />
            </div>
            {/* Price dot */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-background shadow ${cfg.dot.replace('animate-pulse', '')}`}
              style={{ left: `calc(${gaugePos}% - 5px)` }}
            />
          </div>
          <div className="flex justify-between text-[8px] text-muted-foreground/60">
            <span>Inferior (0)</span>
            <span>Media (50)</span>
            <span>Superior (100)</span>
          </div>
        </div>

        {/* Bandwidth & squeeze */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-muted-foreground">Ancho de banda:</span>
            <span className={`font-bold font-mono ${bb.squeeze ? 'text-amber-400' : bb.expansion ? 'text-cyan-400' : 'text-foreground'}`}>
              {bb.bandwidth?.toFixed(2)}%
            </span>
          </div>
          {bb.squeeze && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold animate-pulse">
              ⚡ SQUEEZE — Breakout próximo
            </span>
          )}
          {bb.expansion && !bb.squeeze && (
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-semibold">
              📈 Expansión — Tendencia activa
            </span>
          )}
        </div>

        {/* Interpretation */}
        <div className={`rounded-lg px-2.5 py-2 ${cfg.bg} border border-inherit`}>
          <p className={`text-[10px] font-semibold ${cfg.color} mb-0.5`}>Interpretación:</p>
          <p className="text-[9px] text-foreground/80 leading-relaxed">{bb.interpretation}</p>
        </div>

        {/* Strategy */}
        <div className="rounded-lg px-2.5 py-2 bg-primary/8 border border-primary/20">
          <p className="text-[10px] font-semibold text-primary mb-0.5">Estrategia:</p>
          <p className="text-[9px] text-foreground/80 leading-relaxed">{bb.strategy}</p>
        </div>

        {/* Confirmation rules — collapsed by default */}
        <div className="pt-1 border-t border-border/30 space-y-1">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            ⚠️ Confirmaciones requeridas (no entrar solo por tocar la banda)
          </p>
          {CONFIRMATION_RULES.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-[10px] shrink-0">{r.icon}</span>
              <span className="text-[9px] text-muted-foreground leading-tight">{r.text}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}