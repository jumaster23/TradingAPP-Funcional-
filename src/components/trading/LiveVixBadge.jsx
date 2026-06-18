import React from 'react';
import { useLiveVix } from '@/hooks/useLiveVix';
import { RefreshCw, Wind } from 'lucide-react';

function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const REGIME_STYLES = {
  LOW:      { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'Bajo' },
  MODERATE: { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30',   label: 'Moderado' },
  HIGH:     { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30',  label: 'Alto' },
  EXTREME:  { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',        label: 'Extremo' },
};

export default function LiveVixBadge({ vixData }) {
  const polled = useLiveVix(10000);
  const d = vixData ?? polled;

  const style = REGIME_STYLES[d?.regime] ?? REGIME_STYLES.MODERATE;
  const isUp = d?.vix_change > 0;
  const isDown = d?.vix_change < 0;

  return (
    <div className={`rounded-xl border ${style.bg} p-3 flex flex-wrap items-center gap-4`}>
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <Wind className={`w-4 h-4 ${style.color}`} />
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">VIX — Volatilidad</p>
      </div>

      {/* Value */}
      <div className="flex items-center gap-3">
        {d?.vix ? (
          <span className={`text-2xl font-bold font-mono ${style.color}`}>{d.vix.toFixed(2)}</span>
        ) : (
          <span className="text-2xl font-bold font-mono text-muted-foreground">--.-</span>
        )}
        {d?.isLoading && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />}

        {/* Change */}
        {d?.vix_change != null && (
          <span className={`text-sm font-bold font-mono ${isUp ? 'text-red-400' : isDown ? 'text-emerald-400' : 'text-muted-foreground'}`}>
            {isUp ? '+' : ''}{d.vix_change.toFixed(2)} ({isUp ? '+' : ''}{d.vix_change_pct?.toFixed(2)}%)
          </span>
        )}
      </div>

      {/* Regime badge */}
      {d?.regime && (
        <div className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase ${style.bg} ${style.color}`}>
          {style.label}
        </div>
      )}

      {/* Impact note */}
      {d?.impact_note && (
        <p className="text-[10px] text-muted-foreground flex-1 min-w-[160px]">{d.impact_note}</p>
      )}

      {/* Last updated */}
      {d?.lastUpdated && (
        <div className="ml-auto text-[9px] text-muted-foreground flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse inline-block" />
          Actualizado {formatTime(d.lastUpdated)}
        </div>
      )}
    </div>
  );
}