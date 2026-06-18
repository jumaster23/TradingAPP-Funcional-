import React from 'react';
import { cn } from '@/lib/utils';

export default function ActiveRace({ trade, currentPrice }) {
  if (!trade || currentPrice == null) return null;

  const isCall = trade.signal && trade.signal.includes('CALL');
  const entry = trade.entry;
  const sl = trade.sl;
  const tp = trade.tp;

  // P&L direction
  const isWinning = isCall ? currentPrice > entry : currentPrice < entry;
  const pnlAbs = Math.abs(currentPrice - entry);
  const pnlPct = entry !== 0 ? (pnlAbs / entry * 100) : 0;
  const pnlSign = isWinning ? '+' : '-';
  const pnlDir = isWinning ? (isCall ? currentPrice > entry : currentPrice < entry) : false;

  // Progress toward TP (0–100%)
  const range = tp != null && sl != null ? Math.abs(tp - sl) : 1;
  const rawProgress = isCall
    ? ((currentPrice - sl) / range) * 100
    : ((sl - currentPrice) / range) * 100;
  const progress = Math.max(0, Math.min(100, rawProgress));

  // Opened time
  const openedTime = trade.openedAt
    ? new Date(trade.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '--';

  return (
    <div className={cn(
      'rounded-3xl border-2 p-6 space-y-4 transition-all duration-500',
      isWinning
        ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_30px_rgba(16,185,129,0.15)] animate-pulse'
        : 'bg-red-500/10 border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.15)] animate-pulse'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏁</span>
          <div>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Trade en Curso</p>
            <p className="text-sm font-black text-foreground">
              {trade.ticker} {trade.signal && (trade.signal.includes('CALL') ? 'CALL' : 'PUT')} @ ${entry?.toFixed(2)}
            </p>
          </div>
        </div>
        <span className="text-[9px] font-bold text-muted-foreground bg-black/20 px-2 py-1 rounded-full">
          {openedTime}
        </span>
      </div>

      {/* Precio actual grande */}
      <div className="text-center">
        <p className="text-5xl font-black font-mono tracking-tighter text-foreground transition-all duration-500">
          ${currentPrice.toFixed(2)}
        </p>
        <p className={cn(
          'text-lg font-black mt-1',
          isWinning ? 'text-emerald-400' : 'text-red-400'
        )}>
          {pnlSign}${pnlAbs.toFixed(2)}{' '}
          {isWinning ? 'GANANDO' : 'PERDIENDO'}{' '}
          ({pnlSign}{pnlPct.toFixed(2)}%)
        </p>
      </div>

      {/* Barra de progreso */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] font-bold text-muted-foreground uppercase">
          <span>SL ${sl?.toFixed(2)}</span>
          <span className={cn(isWinning ? 'text-emerald-400' : 'text-red-400')}>
            {progress.toFixed(0)}% → TP
          </span>
          <span>TP ${tp?.toFixed(2)}</span>
        </div>
        <div className="h-3 w-full bg-black/30 rounded-full overflow-hidden border border-white/5">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-1000',
              isWinning ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
            )}
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
