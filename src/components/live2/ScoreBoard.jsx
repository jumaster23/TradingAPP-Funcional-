import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

function isToday(isoDate) {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function ScoreBoard({ history }) {
  const todayTrades = useMemo(
    () => (history || []).filter(t => isToday(t.closedAt || t.openedAt)),
    [history]
  );

  const wins = todayTrades.filter(t => t.result === 'SUCCESS').length;
  const losses = todayTrades.filter(t => t.result !== 'SUCCESS').length;

  // Racha actual
  const streak = useMemo(() => {
    let count = 0;
    let type = null;
    for (let i = 0; i < todayTrades.length; i++) {
      const isWin = todayTrades[i].result === 'SUCCESS';
      if (type === null) type = isWin;
      if (isWin === type) count++;
      else break;
    }
    return { count, isWinStreak: type === true };
  }, [todayTrades]);

  // P&L total estimado (basado en entry/exitPrice si existe)
  const totalPnl = useMemo(() => {
    return todayTrades.reduce((acc, t) => {
      if (t.pnl != null) return acc + t.pnl;
      if (t.exitPrice != null && t.entry != null) {
        const isCall = t.signal && t.signal.includes('CALL');
        const raw = isCall ? t.exitPrice - t.entry : t.entry - t.exitPrice;
        return acc + raw;
      }
      return acc;
    }, 0);
  }, [todayTrades]);

  const streakBadge = streak.count > 0
    ? streak.isWinStreak
      ? `${streak.count}🔥`
      : `${streak.count}❄️`
    : '0 ❄️';

  return (
    <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4 space-y-4">
      {/* Header marcador */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-base">✅</span>
            <span className="text-xl font-black text-emerald-400">{wins}</span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase">WIN</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-base">❌</span>
            <span className="text-xl font-black text-red-400">{losses}</span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase">LOSS</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[9px] font-bold text-muted-foreground uppercase">Racha</p>
            <p className="text-sm font-black">{streakBadge}</p>
          </div>
          {totalPnl !== 0 && (
            <div className="text-right">
              <p className="text-[9px] font-bold text-muted-foreground uppercase">P&L Hoy</p>
              <p className={cn('text-sm font-black', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {totalPnl >= 0 ? '+' : ''}${Math.abs(totalPnl).toFixed(2)}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-white/5" />

      {/* Lista de trades */}
      {todayTrades.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 italic">
          Primer trade del día 🎯 Que sea bueno.
        </p>
      ) : (
        <div className="space-y-2">
          {todayTrades.map((t, i) => {
            const isWin = t.result === 'SUCCESS';
            const time = t.closedAt || t.openedAt
              ? new Date(t.closedAt || t.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              : '--';
            const isCall = t.signal && t.signal.includes('CALL');

            const pnlVal = t.pnl != null ? t.pnl
              : (t.exitPrice != null && t.entry != null)
                ? (isCall ? t.exitPrice - t.entry : t.entry - t.exitPrice)
                : null;

            return (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-black/20 border border-white/5">
                <div className="flex items-center gap-3">
                  <span className="text-base">{isWin ? '✅' : '❌'}</span>
                  <span className="text-xs font-black font-mono text-foreground">{t.ticker}</span>
                  <span className={cn(
                    'text-[9px] font-black uppercase px-2 py-0.5 rounded-full',
                    isCall ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  )}>
                    {isCall ? 'CALL' : 'PUT'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {pnlVal != null && (
                    <span className={cn('text-xs font-black', pnlVal >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {pnlVal >= 0 ? '+' : '-'}${Math.abs(pnlVal).toFixed(2)}
                    </span>
                  )}
                  <span className="text-[9px] font-mono text-muted-foreground">{time}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
