import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

function fmt(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '--';
}

function fmtDiff(a, b) {
  if (a == null || b == null) return { abs: '--', pct: '--', positive: true };
  const diff = a - b;
  const pct = b !== 0 ? (diff / b * 100) : 0;
  return {
    abs: `${diff >= 0 ? '+' : ''}$${Math.abs(diff).toFixed(2)}`,
    pct: `(${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
    positive: diff >= 0,
  };
}

export default function TradeVisualizer({ entry, sl, tp, signal, currentPrice }) {
  const [premium, setPremium] = useState(500);
  const isCall = signal && signal.includes('CALL');

  const tp1Result = useMemo(() => {
    const gain = premium * 0.25;
    return { out: premium + gain, gain };
  }, [premium]);

  const tp2Result = useMemo(() => {
    const gain = premium * 0.50;
    return { out: premium + gain, gain };
  }, [premium]);

  const slResult = useMemo(() => {
    const loss = premium * 0.30;
    return { out: premium - loss, loss };
  }, [premium]);

  // Current price position on the bar
  const range = tp != null && sl != null ? Math.abs(tp - sl) : 1;
  const pricePos = currentPrice != null && sl != null && tp != null
    ? isCall
      ? Math.max(0, Math.min(100, ((currentPrice - sl) / range) * 100))
      : Math.max(0, Math.min(100, ((sl - currentPrice) / range) * 100))
    : null;

  const entryPos = entry != null && sl != null && tp != null
    ? isCall
      ? Math.max(0, Math.min(100, ((entry - sl) / range) * 100))
      : Math.max(0, Math.min(100, ((sl - entry) / range) * 100))
    : 50;

  const tpDiff = fmtDiff(tp, entry);
  const slDiff = fmtDiff(sl, entry);

  return (
    <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4 space-y-4">
      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Niveles del Trade</p>

      {/* Barra vertical de niveles */}
      <div className="space-y-1">
        {/* TP */}
        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-lg">▲</span>
            <div>
              <p className="text-[9px] font-black text-emerald-400 uppercase">Take Profit</p>
              <p className="text-lg font-black text-emerald-400 font-mono">{fmt(tp)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className={cn('text-sm font-bold', tpDiff.positive ? 'text-emerald-400' : 'text-red-400')}>
              {tpDiff.abs}
            </p>
            <p className="text-[9px] text-emerald-400/60 font-mono">{tpDiff.pct}</p>
          </div>
        </div>

        {/* Progress bar con precio actual */}
        <div className="relative h-4 mx-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full h-1.5 bg-white/10 rounded-full relative overflow-visible">
              {/* Fill */}
              <div
                className="absolute h-full bg-gradient-to-r from-red-500/30 via-amber-500/30 to-emerald-500/50 rounded-full"
                style={{ width: '100%' }}
              />
              {/* Entry line */}
              <div
                className="absolute h-5 w-0.5 bg-white/50 -top-1.5 z-10"
                style={{ left: `${entryPos}%` }}
              />
              {/* Current price dot */}
              {pricePos !== null && (
                <div
                  className="absolute w-4 h-4 bg-white rounded-full border-2 border-primary shadow-[0_0_8px_rgba(255,255,255,0.6)] -top-1.5 -ml-2 z-20 transition-all duration-1000"
                  style={{ left: `${pricePos}%` }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Entry */}
        <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📍</span>
            <div>
              <p className="text-[9px] font-black text-muted-foreground uppercase">Entrada</p>
              <p className="text-lg font-black font-mono text-foreground">{fmt(entry)}</p>
            </div>
          </div>
          {currentPrice != null && (
            <p className="text-xs font-mono text-muted-foreground">Precio: {fmt(currentPrice)}</p>
          )}
        </div>

        <div className="relative h-4 mx-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full h-1.5 bg-white/10 rounded-full" />
          </div>
        </div>

        {/* SL */}
        <div className="flex items-center justify-between bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-red-400 text-lg">▼</span>
            <div>
              <p className="text-[9px] font-black text-red-400 uppercase">Stop Loss</p>
              <p className="text-lg font-black text-red-400 font-mono">{fmt(sl)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-red-400">{slDiff.abs}</p>
            <p className="text-[9px] text-red-400/60 font-mono">{slDiff.pct}</p>
          </div>
        </div>
      </div>

      {/* Calculadora prima */}
      <div className="border-t border-white/5 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Calculadora Prima 0DTE</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">$</span>
            <input
              type="number"
              value={premium}
              onChange={e => setPremium(Math.max(0, Number(e.target.value)))}
              className="w-20 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono text-foreground text-right focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <span className="text-xs font-bold text-amber-400">TP1 → cobras</span>
            <div className="text-right">
              <span className="text-sm font-black text-amber-400">${tp1Result.out.toFixed(0)}</span>
              <span className="text-[9px] text-amber-400/60 ml-1">(+${tp1Result.gain.toFixed(0)})</span>
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-xs font-bold text-emerald-400">TP2 → cobras</span>
            <div className="text-right">
              <span className="text-sm font-black text-emerald-400">${tp2Result.out.toFixed(0)}</span>
              <span className="text-[9px] text-emerald-400/60 ml-1">(+${tp2Result.gain.toFixed(0)})</span>
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
            <span className="text-xs font-bold text-red-400">SL → perdés</span>
            <div className="text-right">
              <span className="text-sm font-black text-red-400">${slResult.out.toFixed(0)}</span>
              <span className="text-[9px] text-red-400/60 ml-1">(-${slResult.loss.toFixed(0)})</span>
            </div>
          </div>
        </div>

        <p className="text-[9px] text-muted-foreground italic text-center">
          Delta ideal: 0.40–0.60 · ATM · Expira hoy
        </p>
      </div>
    </div>
  );
}
