import React, { useMemo } from 'react';

const W = 500, H = 200;
const PAD = { top: 14, right: 60, bottom: 18, left: 6 };
const cW = W - PAD.left - PAD.right;
const cH = H - PAD.top - PAD.bottom;

function f2(p) { return p != null ? Number(p).toFixed(2) : ''; }

export default function DayPriceMap({ closes = [], fibLevels, pivotZones = [], currentPrice, entry, sl, tp, signal }) {
  const pts = useMemo(() => {
    if (!closes.length) return [];
    const step = Math.max(1, Math.floor(closes.length / 160));
    return closes.filter((_, i) => i % step === 0);
  }, [closes]);

  const bounds = useMemo(() => {
    if (!pts.length) return null;
    const all = [...pts, fibLevels?.swingHigh, fibLevels?.swingLow, entry, sl, tp].filter(v => v != null);
    const mn = Math.min(...all), mx = Math.max(...all);
    const pad = (mx - mn) * 0.06 || 1;
    return { min: mn - pad, max: mx + pad };
  }, [pts, fibLevels, entry, sl, tp]);

  if (!bounds || pts.length < 2) {
    return (
      <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4 flex items-center justify-center" style={{ height: 120 }}>
        <p className="text-[10px] text-muted-foreground">Cargando mapa del día...</p>
      </div>
    );
  }

  const rng  = bounds.max - bounds.min;
  const toX  = (i) => PAD.left + (i / Math.max(pts.length - 1, 1)) * cW;
  const toY  = (p) => PAD.top  + (1 - (p - bounds.min) / rng) * cH;

  const sparkD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
  const areaD  = sparkD + ` L${toX(pts.length - 1).toFixed(1)},${PAD.top + cH} L${PAD.left},${PAD.top + cH} Z`;

  const isCall  = signal?.includes('CALL');
  const isPut   = signal?.includes('PUT');
  const lineClr = isCall ? '#10b981' : isPut ? '#ef4444' : '#818cf8';

  const fibLines = fibLevels ? [
    { p: fibLevels.swingLow,      lbl: 'Min',    clr: '#f87171', dash: '2,3', sw: 0.5 },
    { p: fibLevels.bull?.r786,    lbl: '78.6%',  clr: '#94a3b8', dash: '2,3', sw: 0.5 },
    { p: fibLevels.bull?.r618,    lbl: '61.8★',  clr: '#f59e0b', dash: '3,2', sw: 1.0 },
    { p: fibLevels.bull?.r500,    lbl: '50%',    clr: '#fbbf24', dash: '4,2', sw: 1.0 },
    { p: fibLevels.bull?.r382,    lbl: '38.2%',  clr: '#60a5fa', dash: '3,2', sw: 0.8 },
    { p: fibLevels.bull?.r236,    lbl: '23.6%',  clr: '#94a3b8', dash: '2,3', sw: 0.5 },
    { p: fibLevels.swingHigh,     lbl: 'Max',    clr: '#34d399', dash: '2,3', sw: 0.5 },
  ].filter(l => l.p != null) : [];

  return (
    <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">
          Mapa del día
          {fibLevels && (
            <span className="ml-2 text-muted-foreground/50 normal-case font-normal">
              {f2(fibLevels.swingLow)} — {f2(fibLevels.swingHigh)}
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          {pivotZones.filter(z => z.strength === 'STRONG').length > 0 && (
            <span className="text-[8px] text-amber-400/70 font-bold">
              {pivotZones.filter(z => z.strength === 'STRONG').length} pivotes fuertes
            </span>
          )}
          {currentPrice && (
            <span className="text-[10px] font-black font-mono">${f2(currentPrice)}</span>
          )}
        </div>
      </div>

      {/* SVG Chart */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
        <defs>
          <linearGradient id="dpAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={lineClr} stopOpacity="0.2" />
            <stop offset="100%" stopColor={lineClr} stopOpacity="0"   />
          </linearGradient>
          <clipPath id="dpClip">
            <rect x={PAD.left} y={PAD.top} width={cW} height={cH} />
          </clipPath>
        </defs>

        {/* Pivot zone bands */}
        {pivotZones.map((z, i) => {
          const y   = toY(z.price);
          const bH  = Math.max(3, cH * 0.012);
          const clr = z.strength === 'STRONG' ? '#f59e0b' : '#818cf8';
          return (
            <rect key={`pz${i}`}
              x={PAD.left} y={y - bH} width={cW} height={bH * 2}
              fill={clr} opacity="0.09" clipPath="url(#dpClip)"
            />
          );
        })}

        {/* Fibonacci lines */}
        {fibLines.map(({ p, lbl, clr, dash, sw }) => {
          const y = toY(p);
          if (y < PAD.top - 4 || y > PAD.top + cH + 4) return null;
          return (
            <g key={lbl}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                stroke={clr} strokeWidth={sw} strokeDasharray={dash} opacity="0.55" />
              <text x={W - PAD.right + 3} y={y + 3.5}
                fill={clr} fontSize="7" fontWeight="bold" opacity="0.9">{lbl}</text>
              <text x={W - PAD.right + 3} y={y + 11.5}
                fill={clr} fontSize="5.5" opacity="0.7">${f2(p)}</text>
            </g>
          );
        })}

        {/* SL / TP / Entry lines */}
        {sl && (() => {
          const y = toY(sl);
          return (
            <g>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                stroke="#ef4444" strokeWidth="1.2" strokeDasharray="5,3" opacity="0.75" />
              <text x={PAD.left + 3} y={y - 2.5} fill="#ef4444" fontSize="7" fontWeight="bold">SL</text>
            </g>
          );
        })()}
        {tp && (() => {
          const y = toY(tp);
          return (
            <g>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                stroke="#10b981" strokeWidth="1.2" strokeDasharray="5,3" opacity="0.75" />
              <text x={PAD.left + 3} y={y - 2.5} fill="#10b981" fontSize="7" fontWeight="bold">TP</text>
            </g>
          );
        })()}
        {entry && (() => {
          const y = toY(entry);
          return (
            <g>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeDasharray="5,3" />
              <text x={PAD.left + 3} y={y - 2.5} fill="white" fontSize="7" fontWeight="bold">ENT</text>
            </g>
          );
        })()}

        {/* Area fill + sparkline */}
        <path d={areaD} fill="url(#dpAreaGrad)" clipPath="url(#dpClip)" />
        <path d={sparkD} fill="none" stroke={lineClr} strokeWidth="1.7" clipPath="url(#dpClip)" />

        {/* Current price dot */}
        {currentPrice && pts.length > 0 && (() => {
          const cx = toX(pts.length - 1);
          const cy = toY(currentPrice);
          return (
            <g>
              <line x1={PAD.left} y1={cy} x2={W - PAD.right} y2={cy}
                stroke="white" strokeWidth="0.5" opacity="0.2" />
              <circle cx={cx} cy={cy} r="5" fill={lineClr} opacity="0.25" />
              <circle cx={cx} cy={cy} r="3" fill="white" />
            </g>
          );
        })()}

        {/* Pivot labels — top 4 */}
        {pivotZones.slice(0, 4).map((z, i) => {
          const y = toY(z.price);
          if (y < PAD.top + 8 || y > PAD.top + cH - 4) return null;
          const clr = z.strength === 'STRONG' ? '#f59e0b' : '#818cf8';
          return (
            <text key={`pl${i}`} x={PAD.left + 5} y={y - 3}
              fill={clr} fontSize="6.5" fontWeight="bold" opacity="0.85">
              {z.strength === 'STRONG' ? '★' : '◆'} ${f2(z.price)} ×{z.touches}
            </text>
          );
        })}

        {/* Time labels */}
        <text x={PAD.left} y={H - 2} fill="#475569" fontSize="7">Apertura</text>
        <text x={PAD.left + cW - 22} y={H - 2} fill="#475569" fontSize="7">Ahora</text>
      </svg>

      {/* Fib key levels legend */}
      {fibLevels && (
        <div className="flex flex-wrap gap-3 pt-1 border-t border-white/5">
          {[
            { lbl: '38.2%', p: fibLevels.bull?.r382, cls: 'text-blue-400' },
            { lbl: '50%',   p: fibLevels.bull?.r500, cls: 'text-yellow-400' },
            { lbl: '61.8% ★', p: fibLevels.bull?.r618, cls: 'text-amber-400 font-black' },
          ].filter(x => x.p).map(({ lbl, p, cls }) => (
            <span key={lbl} className={`text-[9px] font-bold ${cls}`}>
              {lbl}: <span className="font-black font-mono">${f2(p)}</span>
            </span>
          ))}
          {pivotZones.filter(z => z.strength === 'STRONG').map((z, i) => (
            <span key={`sl${i}`} className="text-[9px] font-bold text-amber-400/70">
              Pivote: <span className="font-black font-mono">${f2(z.price)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
