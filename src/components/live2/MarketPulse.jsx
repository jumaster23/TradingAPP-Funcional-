import React from 'react';
import { cn } from '@/lib/utils';

function getMarketDirection(spyChange, qqqChange) {
  if (spyChange > 0 && qqqChange > 0) return { label: 'ALCISTA 🚀', color: 'text-emerald-400' };
  if (spyChange < 0 && qqqChange < 0) return { label: 'BAJISTA 🔻', color: 'text-red-400' };
  return { label: 'MIXTO 🤷', color: 'text-amber-400' };
}

function getVixStatus(vix) {
  if (!vix) return { label: 'N/D', color: 'text-muted-foreground' };
  if (vix < 15) return { label: `${vix.toFixed(1)} CALMO 😎`, color: 'text-emerald-400' };
  if (vix < 20) return { label: `${vix.toFixed(1)} NORMAL`, color: 'text-foreground' };
  if (vix < 25) return { label: `${vix.toFixed(1)} ELEVADO ⚠️`, color: 'text-amber-400' };
  return { label: `${vix.toFixed(1)} ALTO 🔥`, color: 'text-red-400' };
}

function formatPct(n) {
  if (n == null) return '--';
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
}

export default function MarketPulse({ vix, spyChange, qqqChange, session, isOpen }) {
  const dir = getMarketDirection(spyChange ?? 0, qqqChange ?? 0);
  const vixStatus = getVixStatus(vix);

  const spyColor = (spyChange ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400';
  const qqqColor = (qqqChange ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400';
  const spyDot = (spyChange ?? 0) >= 0 ? '🟢' : '🔴';
  const qqqDot = (qqqChange ?? 0) >= 0 ? '🟢' : '🔴';
  const sessionLabel = session || 'CERRADO';

  return (
    <div className="bg-secondary/20 rounded-2xl border border-white/5 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="text-base">🌡️</span>
        <span className="text-[10px] font-black text-muted-foreground uppercase">Mercado</span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-muted-foreground">SPY</span>
        <span className={cn('text-xs font-black', spyColor)}>{formatPct(spyChange)}</span>
        <span className="text-xs">{spyDot}</span>
        <span className="text-muted-foreground mx-1">·</span>
        <span className="text-xs font-mono text-muted-foreground">QQQ</span>
        <span className={cn('text-xs font-black', qqqColor)}>{formatPct(qqqChange)}</span>
        <span className="text-xs">{qqqDot}</span>
        <span className="text-muted-foreground mx-1">→</span>
        <span className={cn('text-xs font-black', dir.color)}>{dir.label}</span>
      </div>

      <div className="h-4 w-px bg-white/10 hidden sm:block" />

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-muted-foreground">VIX</span>
        <span className={cn('text-xs font-black', vixStatus.color)}>{vixStatus.label}</span>
      </div>

      <div className="h-4 w-px bg-white/10 hidden sm:block" />

      <div className="flex items-center gap-1.5">
        <span className={cn('text-xs', isOpen ? 'text-emerald-400' : 'text-muted-foreground')}>
          {isOpen ? '🟢' : '⚫'}
        </span>
        <span className={cn('text-xs font-black', isOpen ? 'text-emerald-400' : 'text-muted-foreground')}>
          {sessionLabel}
        </span>
      </div>
    </div>
  );
}
