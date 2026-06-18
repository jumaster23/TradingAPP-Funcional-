import React from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Target, AlertCircle, Clock } from 'lucide-react';

function humanizeReason(reason) {
  if (!reason) return '';
  const r = reason.toLowerCase();
  if (r.includes('atr') && (r.includes('85') || r.includes('exhaustion') || r.includes('extendido'))) return 'El mercado ya corrió demasiado hoy 😴';
  if (r.includes('sweep')) return 'Esperando la trampa de liquidez 🎣';
  if (r.includes('score')) return 'Me faltan piezas del puzzle 🧩';
  if (r.includes('sesión') || r.includes('sesion') || r.includes('ventana') || r.includes('0dte')) return 'Fuera de horario operativo ⏰';
  if (r.includes('lateral')) return 'Mercado sin momentum 💤';
  if (r.includes('volumen')) return 'Pocos jugadores en el mercado 📉';
  if (r.includes('ema') || r.includes('dirección') || r.includes('alineados')) return 'Dirección no está clara todavía 🧭';
  if (r.includes('rr') || r.includes('atr insuficiente')) return 'No hay espacio suficiente para el RR 3:1 📏';
  return reason;
}

export default function TrafficLight({ signal, reason, setupGrade, score, mentorMessage, entry, sl, tp, probability, fibTouch, spyConvergence }) {
  const isCall = signal?.includes('CALL');
  const isPut  = signal?.includes('PUT');
  const isActive = isCall || isPut;
  const humanReason = humanizeReason(reason);

  // ── WAIT state ──────────────────────────────────────────────────────────────
  if (!isActive) {
    const isAlmostReady = score != null && score >= 5;
    return (
      <div className={cn(
        'rounded-3xl border p-5 transition-all duration-500',
        isAlmostReady
          ? 'bg-amber-500/5 border-amber-500/20'
          : 'bg-secondary/10 border-white/5'
      )}>
        <div className="flex items-center gap-3 mb-4">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-xl',
            isAlmostReady ? 'bg-amber-500/20' : 'bg-white/5'
          )}>
            {isAlmostReady ? '👀' : '⏳'}
          </div>
          <div>
            <p className={cn('text-xl font-black tracking-tight', isAlmostReady ? 'text-amber-400' : 'text-muted-foreground')}>
              {isAlmostReady ? 'CASI LISTO' : 'ESPERANDO'}
            </p>
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
              {humanReason || 'Escaneando el mercado...'}
            </p>
          </div>
          {score != null && (
            <span className={cn(
              'ml-auto text-xs font-black px-3 py-1 rounded-full border',
              isAlmostReady
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-white/5 border-white/10 text-muted-foreground'
            )}>
              Score {score}/15
            </span>
          )}
        </div>

        {mentorMessage && (
          <div className="bg-white/3 border border-white/5 rounded-xl p-3">
            <p className="text-[10px] text-muted-foreground italic leading-relaxed">"{mentorMessage}"</p>
          </div>
        )}
      </div>
    );
  }

  // ── ACTIVE SIGNAL (CALL or PUT) ─────────────────────────────────────────────
  const risk   = entry && sl ? Math.abs(entry - sl) : null;
  const reward = entry && tp ? Math.abs(tp - entry) : null;
  const rr     = risk && reward ? (reward / risk).toFixed(1) : null;

  return (
    <div className={cn(
      'rounded-3xl border-2 p-5 transition-all duration-500 animate-in fade-in zoom-in',
      isCall
        ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_30px_rgba(16,185,129,0.12)]'
        : 'bg-red-500/10 border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.12)]'
    )}>

      {/* Header: badge tipo + score + prob */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className={cn(
            'px-4 py-2 rounded-2xl font-black text-2xl tracking-tight border animate-pulse',
            isCall
              ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]'
              : 'bg-red-500 text-white border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.4)]'
          )}>
            {isCall ? '📈 CALL' : '📉 PUT'}
          </div>
          {setupGrade && (
            <span className="text-[10px] font-black px-2 py-1 rounded-full bg-white/10 border border-white/20 text-foreground">
              {setupGrade}
            </span>
          )}
        </div>
        <div className="text-right">
          {probability != null && (
            <p className={cn('text-3xl font-black', isCall ? 'text-emerald-400' : 'text-red-400')}>
              {probability}%
            </p>
          )}
          <p className="text-[9px] text-muted-foreground font-bold uppercase">probabilidad</p>
          {score != null && (
            <p className="text-[9px] text-muted-foreground">Score {score}/15</p>
          )}
        </div>
      </div>

      {/* Entry / SL / TP — los números grandes */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-black/30 rounded-2xl p-4 border border-white/5 text-center">
          <p className="text-[9px] font-black text-muted-foreground uppercase mb-1 flex items-center justify-center gap-1">
            <Target className="w-3 h-3" /> Entrada
          </p>
          <p className="text-2xl font-black font-mono text-foreground">${entry?.toFixed(2)}</p>
          <p className="text-[9px] text-muted-foreground mt-1">precio ahora</p>
        </div>

        <div className="bg-red-500/10 rounded-2xl p-4 border border-red-500/20 text-center">
          <p className="text-[9px] font-black text-red-400 uppercase mb-1 flex items-center justify-center gap-1">
            <TrendingDown className="w-3 h-3" /> Stop Loss
          </p>
          <p className="text-2xl font-black font-mono text-red-400">${sl?.toFixed(2)}</p>
          {risk && (
            <p className="text-[9px] text-red-400/70 mt-1">-${risk.toFixed(2)} riesgo</p>
          )}
        </div>

        <div className="bg-emerald-500/10 rounded-2xl p-4 border border-emerald-500/20 text-center">
          <p className="text-[9px] font-black text-emerald-400 uppercase mb-1 flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3" /> Take Profit
          </p>
          <p className="text-2xl font-black font-mono text-emerald-400">${tp?.toFixed(2)}</p>
          {reward && (
            <p className="text-[9px] text-emerald-400/70 mt-1">+${reward.toFixed(2)} objetivo</p>
          )}
        </div>
      </div>

      {/* RR ratio + extras */}
      <div className="flex flex-wrap items-center gap-2">
        {rr && (
          <span className={cn(
            'text-xs font-black px-3 py-1.5 rounded-full border',
            isCall ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border-red-500/30 text-red-400'
          )}>
            R:R {rr}:1
          </span>
        )}
        {fibTouch?.touched && (
          <span className="text-xs font-black px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
            🌀 Fib {fibTouch.level}
          </span>
        )}
        {spyConvergence && (
          <span className="text-xs font-black px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
            📡 SPY alineado
          </span>
        )}
      </div>

      {/* Mensaje mentor */}
      {mentorMessage && (
        <div className="mt-4 bg-white/3 border border-white/5 rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground italic leading-relaxed">"{mentorMessage}"</p>
        </div>
      )}
    </div>
  );
}
