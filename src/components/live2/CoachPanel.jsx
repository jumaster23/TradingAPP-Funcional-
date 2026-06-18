import React from 'react';
import { cn } from '@/lib/utils';
import { Eye, TrendingUp, TrendingDown, Minus, Target, Activity, BarChart3, AlertCircle } from 'lucide-react';

function fmt(p) {
  return p != null ? `$${Number(p).toFixed(2)}` : '--';
}

function RegimePill({ regime }) {
  const map = {
    EXPANSION: { label: 'Espacio libre 🟢', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
    NORMAL:    { label: 'Normal 🟡',        cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
    EXHAUSTION:{ label: 'Extendido 🔴',     cls: 'bg-red-500/15 text-red-400 border-red-500/20' },
  };
  const m = map[regime] || map.NORMAL;
  return (
    <span className={cn('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border', m.cls)}>
      {m.label}
    </span>
  );
}

// Mini mapa vertical del volume profile
function VolumeMap({ price, poc, hvnLevels = [], lvnLevels = [], dayHigh, dayLow }) {
  if (!price || !dayHigh || !dayLow) return null;
  const range = dayHigh - dayLow;
  if (range === 0) return null;

  const toY = (p) => Math.max(0, Math.min(100, ((dayHigh - p) / range) * 100));

  const levels = [
    ...(hvnLevels || []).map(l => ({ price: l, type: 'HVN' })),
    ...(lvnLevels || []).map(l => ({ price: l, type: 'LVN' })),
    poc ? { price: poc, type: 'POC' } : null,
  ].filter(Boolean).sort((a, b) => b.price - a.price);

  const priceY = toY(price);

  return (
    <div className="relative bg-black/30 rounded-xl border border-white/5 overflow-hidden" style={{ height: 160 }}>
      {/* Candle-like background gradient */}
      <div className="absolute inset-0 opacity-10 bg-gradient-to-b from-emerald-500/20 via-transparent to-red-500/20" />

      {/* Volume levels */}
      {levels.map((l, i) => {
        const y = toY(l.price);
        const colors = {
          POC: { bar: 'bg-yellow-400', label: 'text-yellow-400', width: 'w-full' },
          HVN: { bar: 'bg-blue-400/60', label: 'text-blue-300', width: 'w-2/3' },
          LVN: { bar: 'bg-gray-500/40', label: 'text-gray-400', width: 'w-1/3' },
        };
        const c = colors[l.type];
        return (
          <div key={i} className="absolute left-0 right-0 flex items-center" style={{ top: `${y}%` }}>
            <div className={cn('h-px', c.bar, c.width)} />
            <span className={cn('text-[7px] font-black ml-1 whitespace-nowrap', c.label)}>
              {l.type} {fmt(l.price)}
            </span>
          </div>
        );
      })}

      {/* Current price marker */}
      <div
        className="absolute left-0 right-0 flex items-center z-10"
        style={{ top: `${priceY}%` }}
      >
        <div className="h-0.5 w-full bg-white/70 shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
        <span className="absolute right-1 text-[8px] font-black text-white bg-black/60 px-1 rounded">
          {fmt(price)}
        </span>
      </div>

      {/* Labels top / bottom */}
      <div className="absolute top-1 left-1">
        <span className="text-[7px] font-bold text-muted-foreground">{fmt(dayHigh)} ↑</span>
      </div>
      <div className="absolute bottom-1 left-1">
        <span className="text-[7px] font-bold text-muted-foreground">{fmt(dayLow)} ↓</span>
      </div>
    </div>
  );
}

function EMABar({ price, ema20, ema50, emaAlignment }) {
  if (!price || !ema20) return null;
  const diff20 = ((price - ema20) / ema20 * 100).toFixed(2);
  const diff50  = ema50 ? ((price - ema50) / ema50 * 100).toFixed(2) : null;
  const bullish = emaAlignment === 'BULL';

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {bullish ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
        Tendencia EMA
      </p>
      <div className="flex gap-2">
        <div className={cn(
          'flex-1 p-2 rounded-xl border text-center',
          Number(diff20) > 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
        )}>
          <p className="text-[8px] text-muted-foreground uppercase">EMA 20</p>
          <p className="text-xs font-black font-mono">{fmt(ema20)}</p>
          <p className={cn('text-[8px] font-bold', Number(diff20) > 0 ? 'text-emerald-400' : 'text-red-400')}>
            {diff20 > 0 ? '+' : ''}{diff20}%
          </p>
        </div>
        {ema50 && (
          <div className={cn(
            'flex-1 p-2 rounded-xl border text-center',
            Number(diff50) > 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
          )}>
            <p className="text-[8px] text-muted-foreground uppercase">EMA 50</p>
            <p className="text-xs font-black font-mono">{fmt(ema50)}</p>
            <p className={cn('text-[8px] font-bold', Number(diff50) > 0 ? 'text-emerald-400' : 'text-red-400')}>
              {diff50 > 0 ? '+' : ''}{diff50}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryZoneCard({ entryZone, price }) {
  if (!entryZone) return null;
  const inside = price >= entryZone.low && price <= entryZone.high;
  const above  = price > entryZone.high;
  const dist   = above
    ? `+${(price - entryZone.high).toFixed(2)} sobre la zona`
    : inside
    ? '¡Precio dentro de la zona!'
    : `${(entryZone.low - price).toFixed(2)} pts para llegar`;

  return (
    <div className={cn(
      'p-3 rounded-xl border space-y-1',
      inside ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.12)]'
             : 'bg-amber-500/5 border-amber-500/20'
    )}>
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
          <Target className="w-3 h-3" />
          Zona ideal de entrada ({entryZone.type})
        </p>
        {inside && (
          <span className="text-[8px] font-black text-emerald-400 animate-pulse">● ACTIVA</span>
        )}
      </div>
      <p className="text-sm font-black font-mono">
        {fmt(entryZone.low)} — {fmt(entryZone.high)}
      </p>
      <p className={cn('text-[8px] font-bold', inside ? 'text-emerald-400' : 'text-amber-400')}>
        {dist}
      </p>
    </div>
  );
}

function ATRBar({ atrUsedPct = 0, atrRemaining, regime }) {
  const usedPct = Math.min(atrUsedPct * 100, 100);
  const color = regime === 'EXPANSION' ? 'bg-emerald-500' : regime === 'NORMAL' ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-black text-muted-foreground uppercase">Rango del día</p>
        <RegimePill regime={regime} />
      </div>
      <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${usedPct}%` }} />
      </div>
      <div className="flex justify-between text-[8px] font-mono text-muted-foreground">
        <span>Usado: {usedPct.toFixed(0)}%</span>
        <span>Queda: {fmt(atrRemaining)}</span>
      </div>
    </div>
  );
}

function FibInfo({ fibTouch, fibLevels, spyConvergence, price, isBullish }) {
  if (!fibLevels) return null;
  const lvls = isBullish !== false ? fibLevels.bull : fibLevels.bear;

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">🌀 Fibonacci</p>
      <div className="bg-black/20 rounded-xl p-3 space-y-1.5">
        {fibTouch?.touched ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
            <p className="text-[10px] font-black text-emerald-400">Precio en {fibTouch.level} — zona de alta probabilidad</p>
          </div>
        ) : (
          <p className="text-[10px] text-amber-400/80 font-bold">Precio fuera de niveles Fib clave — esperar</p>
        )}
        <div className="grid grid-cols-3 gap-1 pt-1">
          {[
            { label: '38.2%', val: lvls?.r382 },
            { label: '50%',   val: lvls?.r500 },
            { label: '61.8%', val: lvls?.r618 },
          ].map(({ label, val }) => {
            if (!val) return null;
            const isNear = price && Math.abs(price - val) < (fibLevels.range * 0.03);
            return (
              <div key={label} className={cn(
                'p-1.5 rounded-lg text-center border',
                isNear ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-black/20 border-white/5'
              )}>
                <p className="text-[8px] font-black text-muted-foreground">{label}</p>
                <p className={cn('text-[9px] font-black font-mono', isNear ? 'text-emerald-400' : '')}>{fmt(val)}</p>
              </div>
            );
          })}
        </div>
        {spyConvergence && (
          <p className="text-[9px] font-black text-blue-400 flex items-center gap-1 pt-1">
            📡 SPY también en nivel Fibonacci — confluencia confirmada
          </p>
        )}
      </div>
    </div>
  );
}

function WhatToWatch({ ctx }) {
  const items = [];

  if (!ctx.sweep)         items.push({ emoji: '🌊', text: 'Esperando sweep — que el precio rompa un mínimo/máximo clave y rebote.' });
  if (!ctx.choch)         items.push({ emoji: '🔄', text: 'Sin CHoCH todavía — necesito ver el cambio de tendencia.' });
  if (!ctx.fibTouch?.touched) items.push({ emoji: '🌀', text: 'Precio sin tocar nivel Fibonacci clave. Esperar 38.2%, 50% o Golden Pocket (61.8%).' });
  if (!ctx.spyConvergence) items.push({ emoji: '📡', text: 'SPY no está en nivel Fib — falta confluencia de mercado amplio.' });
  if (ctx.volumeZone === 'HVN') items.push({ emoji: '🧱', text: `Precio en HVN (zona de mucho volumen ${fmt(ctx.price)}) — puede rebotar. Esperar ruptura o rechazo.` });
  if (ctx.volumeZone === 'LVN') items.push({ emoji: '🚀', text: `Precio en LVN (zona vacía de volumen) — puede moverse rápido si hay catalizador.` });
  if (ctx.regime === 'EXHAUSTION') items.push({ emoji: '⛽', text: 'ATR casi agotado — mercado extendido. Esperar nueva sesión.' });
  if (ctx.emaAlignment === 'NEUTRAL') items.push({ emoji: '🧭', text: 'EMAs sin dirección clara — precio entre EMA20 y EMA50.' });
  if (!ctx.wickRejection) items.push({ emoji: '🕯️', text: 'Sin wick de rechazo todavía — buscar vela con mecha larga que confirme zona.' });

  if (items.length === 0) {
    items.push({ emoji: '⏳', text: 'Todo listo excepto la señal de entrada. Esperando el trigger.' });
  }

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
        <Eye className="w-3 h-3" /> Qué mirar ahora
      </p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2 bg-black/20 p-2 rounded-lg">
            <span className="text-base leading-none">{item.emoji}</span>
            <p className="text-[10px] text-muted-foreground leading-snug">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoachMessage({ ctx }) {
  const dir = ctx.emaAlignment === 'BULL' ? 'alcista 📈' : ctx.emaAlignment === 'BEAR' ? 'bajista 📉' : 'lateral ↔️';
  const pocDist = ctx.poc ? Math.abs(ctx.price - ctx.poc).toFixed(2) : null;
  const pocRelation = ctx.poc
    ? (ctx.price > ctx.poc ? `${pocDist} puntos SOBRE el POC` : `${pocDist} puntos BAJO el POC`)
    : null;

  let message = `La tendencia es ${dir}. `;
  if (pocRelation) message += `El precio está ${pocRelation} — donde más volumen entró. `;
  if (ctx.entryZone) {
    const inside = ctx.price >= ctx.entryZone.low && ctx.price <= ctx.entryZone.high;
    message += inside
      ? `¡Precio en la zona ideal (${ctx.entryZone.type})! Esperamos el trigger. `
      : `La zona ideal de entrada es ${fmt(ctx.entryZone.low)}–${fmt(ctx.entryZone.high)} (${ctx.entryZone.type}). `;
  }
  if (ctx.sweep) {
    message += 'Sweep detectado ✓. ';
  } else {
    message += 'Todavía no hay sweep de liquidez — el precio debe barrear un nivel clave antes. ';
  }
  message += ctx.regime === 'EXPANSION'
    ? `Rango libre: quedan ${fmt(ctx.atrRemaining)} de movimiento disponible.`
    : ctx.regime === 'EXHAUSTION'
    ? 'Mercado ya muy extendido. Paciencia.'
    : `Rango normal. Quedan ${fmt(ctx.atrRemaining)} disponibles.`;

  return (
    <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 flex gap-2">
      <span className="text-lg leading-none">🧠</span>
      <p className="text-[10px] text-foreground/80 leading-relaxed">{message}</p>
    </div>
  );
}

export default function CoachPanel({ coachContext, score, reason }) {
  if (!coachContext) return null;
  const ctx = coachContext;

  return (
    <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <p className="text-xs font-black uppercase tracking-widest text-foreground">Coach en Vivo</p>
        </div>
        {score != null && (
          <span className="text-[9px] font-black bg-secondary/40 border border-white/10 px-2 py-0.5 rounded-full">
            Score {score}/11
          </span>
        )}
      </div>

      {/* Mensaje del coach */}
      <CoachMessage ctx={ctx} />

      {/* Volume Profile map + Entry Zone */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
            <BarChart3 className="w-3 h-3" /> Perfil de volumen
          </p>
          <VolumeMap
            price={ctx.price}
            poc={ctx.poc}
            hvnLevels={ctx.hvnLevels}
            lvnLevels={ctx.lvnLevels}
            dayHigh={ctx.dayHigh}
            dayLow={ctx.dayLow}
          />
        </div>
        <div className="flex flex-col justify-between gap-2">
          <EntryZoneCard entryZone={ctx.entryZone} price={ctx.price} />
          <ATRBar atrUsedPct={ctx.atrUsedPct} atrRemaining={ctx.atrRemaining} regime={ctx.regime} />
        </div>
      </div>

      {/* Fibonacci info */}
      <FibInfo
        fibTouch={ctx.fibTouch}
        fibLevels={ctx.fibLevels}
        spyConvergence={ctx.spyConvergence}
        price={ctx.price}
        isBullish={ctx.emaAlignment === 'BULL'}
      />

      {/* EMA bars */}
      <EMABar
        price={ctx.price}
        ema20={ctx.ema20}
        ema50={ctx.ema50}
        emaAlignment={ctx.emaAlignment}
      />

      {/* What to watch */}
      <WhatToWatch ctx={ctx} />
    </div>
  );
}
