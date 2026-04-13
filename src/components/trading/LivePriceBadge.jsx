import React from 'react';
import { useLivePrice } from '@/hooks/useLivePrice';
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';

function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Shows a live price ticker that auto-refreshes every 5 seconds.
 * Usage: <LivePriceBadge ticker="QQQ" />
 * Or pass priceData directly to skip internal polling: <LivePriceBadge ticker="QQQ" priceData={livePrice} />
 */
export default function LivePriceBadge({ ticker, intervalMs = 5000, priceData }) {
  const polled = useLivePrice(priceData ? null : ticker, intervalMs);
  const raw = priceData ?? polled ?? {};
  const price      = raw.price      != null ? Number(raw.price)      : null;
  const prevClose  = raw.prevClose  != null ? Number(raw.prevClose)  : null;
  const change     = raw.change     != null ? Number(raw.change)     : null;
  const changePct  = raw.changePct  != null ? Number(raw.changePct)  : null;
  const high       = raw.high       != null ? Number(raw.high)       : null;
  const low        = raw.low        != null ? Number(raw.low)        : null;
  const volume     = raw.volume     != null ? Number(raw.volume)     : null;
  const open       = raw.open       != null ? Number(raw.open)       : null;
  const lastUpdated = raw.lastUpdated ?? null;
  const isLoading   = raw.isLoading  ?? false;

  if (!ticker) return null;

  const isUp   = change > 0;
  const isDown = change < 0;
  const color  = isUp ? 'text-emerald-400' : isDown ? 'text-red-400' : 'text-amber-400';
  const bg     = isUp ? 'bg-emerald-500/10 border-emerald-500/30' : isDown ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30';
  const Icon   = isUp ? TrendingUp : isDown ? TrendingDown : Minus;

  return (
    <div className={`rounded-xl border ${bg} p-3 flex flex-wrap items-center gap-4`}>
      {/* Ticker + Price */}
      <div className="flex items-center gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{ticker}</p>
          <div className="flex items-center gap-2">
            {price ? (
              <span className={`text-2xl font-bold font-mono ${color}`}>${price.toFixed(2)}</span>
            ) : (
              <span className="text-2xl font-bold font-mono text-muted-foreground">---</span>
            )}
            {isLoading && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />}
          </div>
        </div>

        {/* Change */}
        {change !== null && change !== undefined && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${bg} border`}>
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <span className={`text-sm font-bold font-mono ${color}`}>
              {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct?.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      {/* OHLV mini stats */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono">
        {open && (
          <div className="text-center">
            <p className="text-muted-foreground">Apertura</p>
            <p className="text-foreground font-bold">${open.toFixed(2)}</p>
          </div>
        )}
        {high && (
          <div className="text-center">
            <p className="text-muted-foreground">Máx</p>
            <p className="text-emerald-400 font-bold">${high.toFixed(2)}</p>
          </div>
        )}
        {low && (
          <div className="text-center">
            <p className="text-muted-foreground">Mín</p>
            <p className="text-red-400 font-bold">${low.toFixed(2)}</p>
          </div>
        )}
        {prevClose && (
          <div className="text-center">
            <p className="text-muted-foreground">Cierre ant.</p>
            <p className="text-amber-400 font-bold">${prevClose.toFixed(2)}</p>
          </div>
        )}
        {volume && (
          <div className="text-center">
            <p className="text-muted-foreground">Volumen</p>
            <p className="text-foreground font-bold">{volume >= 1_000_000 ? `${(volume / 1_000_000).toFixed(1)}M` : volume >= 1000 ? `${(volume / 1000).toFixed(0)}K` : volume}</p>
          </div>
        )}
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <div className="ml-auto text-[9px] text-muted-foreground flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
          Actualizado {formatTime(lastUpdated)}
        </div>
      )}
    </div>
  );
}