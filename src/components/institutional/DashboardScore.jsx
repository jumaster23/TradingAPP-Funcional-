import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity } from 'lucide-react';

// ── Scoring helpers ──────────────────────────────────────────────────────────

function scoreTrend(spyTrend) {
  const t = (spyTrend || '').toUpperCase();
  if (t.includes('STRONG_BULL') || t === 'BULLISH') return 8;
  if (t.includes('LEAN_BULL') || t === 'LEAN_BULLISH') return 6;
  if (t === 'NEUTRAL') return 5;
  if (t.includes('LEAN_BEAR') || t === 'LEAN_BEARISH') return 4;
  if (t.includes('BEAR') || t === 'BEARISH') return 2;
  return 5;
}

function scoreMomentum(rsi) {
  const r = Number(rsi) || 50;
  if (r >= 50 && r <= 65) return 8;
  if ((r >= 40 && r < 50) || (r > 65 && r <= 70)) return 6;
  return 3;
}

function scoreOptions(gexRegime, pcr) {
  let s = 0;
  const g = (gexRegime || '').toUpperCase();
  s += g.includes('POSITIVE') || g.includes('BULL') || g.includes('LONG') ? 7 : 4;
  const p = Number(pcr) || 1;
  s += p >= 0.7 && p <= 1.3 ? 2 : 1;
  return Math.min(10, s);
}

function scoreIV(ivStructure, skew25d) {
  const iv = (ivStructure || '').toUpperCase();
  let s = iv.includes('CONTANGO') ? 8 : iv.includes('FLAT') ? 5 : iv.includes('BACK') ? 3 : 5;
  const sk = Number(skew25d) || 0.1;
  if (Math.abs(sk) < 0.05) s = Math.min(10, s + 2);
  return s;
}

function scoreRiskReward(spot, callWall, putWall, maxPainAlignment) {
  const s = Number(spot) || 0;
  const cw = Number(callWall) || 0;
  const pw = Number(putWall) || 0;
  if (!s || !cw || !pw) return 5;
  const distPut = Math.abs(s - pw);
  const distCall = Math.abs(s - cw);
  const range = Math.abs(cw - pw) || 1;
  let score;
  if (distPut < range * 0.2) score = 8;
  else if (distCall < range * 0.2) score = 3;
  else score = 5;
  if (maxPainAlignment) score = Math.min(10, score + 2);
  return score;
}

function computeTotal(scores) {
  const sum = Object.values(scores).reduce((a, b) => a + b, 0);
  return Math.round((sum / (Object.keys(scores).length * 10)) * 100);
}

function statusConfig(total) {
  if (total >= 75) return { label: 'CONFIRMADO', cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' };
  if (total >= 60) return { label: 'WATCHLIST', cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10' };
  return { label: 'PRECAUCIÓN', cls: 'text-red-400 border-red-500/40 bg-red-500/10' };
}

function computeBias(spyTrend, rsi, gexRegime) {
  let bull = 0, bear = 0;
  const t = (spyTrend || '').toUpperCase();
  if (t.includes('BULL')) bull++;
  else if (t.includes('BEAR')) bear++;
  const r = Number(rsi) || 50;
  if (r > 55) bull++;
  else if (r < 45) bear++;
  const g = (gexRegime || '').toUpperCase();
  if (g.includes('POSITIVE') || g.includes('BULL')) bull++;
  else if (g.includes('NEGATIVE') || g.includes('BEAR')) bear++;
  if (bull > bear) return 'ALCISTA';
  if (bear > bull) return 'BAJISTA';
  return 'NEUTRAL';
}

// ── Sub-components ───────────────────────────────────────────────────────────

function CategoryRow({ label, score }) {
  const pct = (score / 10) * 100;
  const barColor =
    pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-32 shrink-0 uppercase tracking-wide">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono font-bold text-foreground w-8 text-right">
        {score}/10
      </span>
    </div>
  );
}

function GaugeArc({ total }) {
  // SVG semi-circle gauge 0–100
  const r = 46;
  const cx = 60;
  const cy = 60;
  const startAngle = -180;
  const sweepAngle = 180;
  const clampedPct = Math.min(100, Math.max(0, total));
  const angle = (clampedPct / 100) * sweepAngle + startAngle;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const arcPath = (deg) => {
    const x = cx + r * Math.cos(toRad(deg));
    const y = cy + r * Math.sin(toRad(deg));
    return `${x},${y}`;
  };

  const trackPath = `M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`;
  const fillEndX = cx + r * Math.cos(toRad(angle));
  const fillEndY = cy + r * Math.sin(toRad(angle));
  const largeArc = clampedPct > 50 ? 1 : 0;
  const fillPath = `M ${cx - r},${cy} A ${r},${r} 0 ${largeArc},1 ${fillEndX},${fillEndY}`;

  const gaugeColor =
    clampedPct >= 75 ? '#10b981' : clampedPct >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <svg viewBox="0 0 120 70" className="w-36 h-24 mx-auto">
      {/* Track */}
      <path
        d={trackPath}
        fill="none"
        stroke="#1f2937"
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Fill */}
      {clampedPct > 0 && (
        <path
          d={fillPath}
          fill="none"
          stroke={gaugeColor}
          strokeWidth="10"
          strokeLinecap="round"
        />
      )}
      {/* Label */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        className="font-bold"
        fill={gaugeColor}
        fontSize="20"
        fontFamily="monospace"
        fontWeight="bold"
      >
        {clampedPct}
      </text>
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        fill="#9ca3af"
        fontSize="7"
        fontFamily="sans-serif"
      >
        /100
      </text>
    </svg>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DashboardScore({
  gexRegime,
  pcr,
  ivStructure,
  skew25d,
  spyTrend,
  rsi,
  distToCallWall,
  distToPutWall,
  maxPainAlignment,
  spot,
  callWall,
  putWall,
  gammaFlip,
}) {
  const scores = {
    trend: scoreTrend(spyTrend),
    momentum: scoreMomentum(rsi),
    options: scoreOptions(gexRegime, pcr),
    iv: scoreIV(ivStructure, skew25d),
    riskReward: scoreRiskReward(spot, callWall, putWall, maxPainAlignment),
  };

  const total = computeTotal(scores);
  const status = statusConfig(total);
  const bias = computeBias(spyTrend, rsi, gexRegime);
  const biasColor =
    bias === 'ALCISTA'
      ? 'text-emerald-400'
      : bias === 'BAJISTA'
      ? 'text-red-400'
      : 'text-amber-400';

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500/60 via-purple-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Dashboard Score
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Gauge */}
        <div className="flex flex-col items-center gap-1">
          <GaugeArc total={total} />
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${status.cls}`}
            >
              {status.label}
            </span>
            <span className={`text-xs font-bold ${biasColor}`}>
              SESGO: {bias}
            </span>
          </div>
        </div>

        {/* Category rows */}
        <div className="bg-secondary/20 rounded-xl p-3 border border-border/40 space-y-2.5">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Puntuación por Categoría
          </p>
          <CategoryRow label="Tendencia" score={scores.trend} />
          <CategoryRow label="Momentum" score={scores.momentum} />
          <CategoryRow label="Estructura Opciones" score={scores.options} />
          <CategoryRow label="Estructura IV" score={scores.iv} />
          <CategoryRow label="Riesgo/Recompensa" score={scores.riskReward} />
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-secondary/30 rounded-lg p-2 border border-border/30">
            <p className="text-[9px] text-muted-foreground">RSI</p>
            <p className="text-sm font-bold font-mono text-foreground">
              {rsi != null ? Number(rsi).toFixed(1) : '--'}
            </p>
          </div>
          <div className="bg-secondary/30 rounded-lg p-2 border border-border/30">
            <p className="text-[9px] text-muted-foreground">PCR</p>
            <p className="text-sm font-bold font-mono text-foreground">
              {pcr != null ? Number(pcr).toFixed(2) : '--'}
            </p>
          </div>
          <div className="bg-secondary/30 rounded-lg p-2 border border-border/30">
            <p className="text-[9px] text-muted-foreground">GEX</p>
            <p
              className={`text-[10px] font-bold ${
                (gexRegime || '').toUpperCase().includes('POSITIVE') ||
                (gexRegime || '').toUpperCase().includes('BULL')
                  ? 'text-emerald-400'
                  : 'text-red-400'
              }`}
            >
              {gexRegime || '--'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
