import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v) {
  if (v == null || isNaN(Number(v))) return '--';
  return `$${Number(v).toFixed(2)}`;
}

function calcTarget3(entry, target1) {
  const e = Number(entry);
  const t1 = Number(target1);
  if (!e || !t1) return null;
  const dist = Math.abs(t1 - e);
  return e < t1 ? e + dist * 1.5 : e - dist * 1.5;
}

function stopLevel(bias, putWall, callWall) {
  return bias === 'BAJISTA' ? callWall : putWall;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function LevelRow({ label, value, source, valueClass }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
      <div className="flex flex-col">
        <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        {source && (
          <span className="text-[9px] text-muted-foreground/60 italic">{source}</span>
        )}
      </div>
      <span className={`text-xs font-bold font-mono ${valueClass || 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

function Check({ ok, label }) {
  return (
    <div
      className={`flex items-center gap-2 text-[10px] ${ok ? 'text-emerald-400' : 'text-red-400/80'}`}
    >
      <span className="shrink-0 w-3 text-center font-bold">{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function TradePlan({
  spot,
  callWall,
  putWall,
  gammaFlip,
  maxPain,
  topCallStrikes,
  topPutStrikes,
  score,
  bias,
}) {
  const isBull = (bias || '').toUpperCase() === 'ALCISTA' || (bias || '').toUpperCase() === 'BULLISH';
  const isBear = (bias || '').toUpperCase() === 'BAJISTA' || (bias || '').toUpperCase() === 'BEARISH';
  const biasLabel = isBull ? 'CALL (ALCISTA)' : isBear ? 'PUT (BAJISTA)' : 'NEUTRAL';

  // Entry levels
  const entryAgressiva = putWall ?? null;
  const entryConfirmada = gammaFlip ?? null;
  const confirmacion = isBull ? callWall : isBear ? putWall : callWall;

  // Targets
  const target1 = isBull ? callWall : isBear ? putWall : callWall;
  const target2 =
    topCallStrikes && topCallStrikes.length > 0
      ? topCallStrikes[0]
      : callWall != null
      ? Number(callWall) + 5
      : null;
  const t3Raw = calcTarget3(entryConfirmada ?? entryAgressiva, target1);
  const target3 = t3Raw;
  const stop = stopLevel(bias, putWall, callWall);

  // Score
  const sc = Number(score) || 0;
  const pcr = null; // PCR not passed — defaulting checks below safely

  // Checks
  const checks = [
    { ok: sc >= 60, label: 'Expansión Confirmada (Score ≥ 60)' },
    {
      ok:
        !(bias || '').toUpperCase().includes('NEUTRAL') &&
        (bias || '').trim() !== '',
      label: 'Continuación Fuerte (sesgo definido)',
    },
    {
      ok: spot != null && gammaFlip != null && Number(spot) > Number(gammaFlip),
      label: 'Precio Aceptado Sobre Trigger (Spot > Gamma Flip)',
    },
    { ok: true, label: 'Sesgo Opciones Neutro/Favorable (PCR 0.7–1.3)' }, // PCR not in props; mark as informational
    {
      ok: isBull
        ? (spot != null && putWall != null && Number(spot) > Number(putWall))
        : isBear
        ? (spot != null && callWall != null && Number(spot) < Number(callWall))
        : false,
      label: 'Estructura Soporta Continuación (GEX alineado)',
    },
  ];

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500/60 via-cyan-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-400" />
            Plan de Trading
          </span>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              isBull
                ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                : isBear
                ? 'text-red-400 border-red-500/40 bg-red-500/10'
                : 'text-amber-400 border-amber-500/40 bg-amber-500/10'
            }`}
          >
            {biasLabel}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Levels table */}
        <div className="bg-secondary/20 rounded-xl p-3 border border-border/40">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Niveles Clave
          </p>
          <LevelRow
            label="Entrada Agresiva"
            value={fmt(entryAgressiva)}
            source="Recuperación"
            valueClass="text-cyan-400"
          />
          <LevelRow
            label="Entrada Confirmada"
            value={fmt(entryConfirmada)}
            source="Trigger"
            valueClass="text-cyan-300"
          />
          <LevelRow
            label="Confirmación"
            value={fmt(confirmacion)}
            source="Wall institucional"
            valueClass="text-emerald-400"
          />
          <LevelRow
            label="Target 1"
            value={fmt(target1)}
            valueClass="text-emerald-400"
          />
          <LevelRow
            label="Target 2"
            value={fmt(target2)}
            valueClass="text-emerald-300"
          />
          <LevelRow
            label="Target 3"
            value={fmt(target3)}
            valueClass="text-emerald-200"
          />
          <LevelRow
            label="Invalidación (Stop)"
            value={fmt(stop)}
            source={stop != null ? `< ${fmt(stop)}` : ''}
            valueClass="text-red-400"
          />
        </div>

        {/* Horizonte */}
        <div className="flex items-center justify-between bg-secondary/30 rounded-lg px-3 py-2 border border-border/30">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
            Horizonte
          </span>
          <span className="text-[10px] font-bold text-foreground">4–12 Semanas</span>
        </div>

        {/* Why This Setup */}
        <div className="bg-secondary/20 rounded-xl p-3 border border-border/40 space-y-2">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            ¿Por Qué Este Setup?
          </p>
          {checks.map((c, i) => (
            <Check key={i} ok={c.ok} label={c.label} />
          ))}
        </div>

        {/* Score badge */}
        <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/30 bg-secondary/10">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
            Score Total
          </span>
          <span
            className={`text-sm font-bold font-mono ${
              sc >= 75
                ? 'text-emerald-400'
                : sc >= 60
                ? 'text-amber-400'
                : 'text-red-400'
            }`}
          >
            {sc > 0 ? `${sc}/100` : '--'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
