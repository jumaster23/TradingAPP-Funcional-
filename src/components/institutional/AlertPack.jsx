import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bell } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v) {
  if (v == null || isNaN(Number(v))) return '--';
  return `$${Number(v).toFixed(2)}`;
}

// ── Alert row config ─────────────────────────────────────────────────────────

const ROW_STYLES = {
  OBSERVAR:       'text-muted-foreground bg-secondary/20  border-border/30',
  ENTRADA:        'text-cyan-400          bg-cyan-500/10   border-cyan-500/30',
  CONFIRMACION:   'text-emerald-400       bg-emerald-500/10 border-emerald-500/30',
  TOMA_PARCIAL:   'text-amber-400         bg-amber-500/10  border-amber-500/30',
  REVISAR:        'text-orange-400        bg-orange-500/10 border-orange-500/30',
  INVALIDACION:   'text-red-400           bg-red-500/10    border-red-500/30',
};

// ── Sub-components ───────────────────────────────────────────────────────────

function AlertRow({ num, nivel, accion, icono, tipo }) {
  const cls = ROW_STYLES[tipo] || ROW_STYLES.OBSERVAR;
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${cls}`}
    >
      {/* Alert # badge */}
      <span className="text-[9px] font-bold text-muted-foreground/70 w-12 shrink-0">
        ALERTA #{num}
      </span>
      {/* Price level */}
      <span className="text-[10px] font-bold font-mono w-16 shrink-0 text-foreground">
        {nivel}
      </span>
      {/* Icon + action */}
      <span className="text-[10px] flex items-center gap-1 flex-1 min-w-0 truncate">
        <span>{icono}</span>
        <span className={`font-semibold uppercase tracking-wide ${cls.split(' ')[0]}`}>
          {accion}
        </span>
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AlertPack({
  spot,
  putWall,
  callWall,
  gammaFlip,
  maxPain,
  targets = {},
}) {
  const { target1, target2, target3 } = targets;

  const stopLevel = putWall != null ? Number(putWall) - 1 : null;

  const rows = [
    {
      num: 1,
      nivel: fmt(gammaFlip ?? putWall),
      accion: 'Observar',
      icono: '👁',
      tipo: 'OBSERVAR',
    },
    {
      num: 2,
      nivel: fmt(putWall),
      accion: 'Entrada Principal',
      icono: '↑',
      tipo: 'ENTRADA',
    },
    {
      num: 3,
      nivel: fmt(callWall),
      accion: 'Confirmación Alcista',
      icono: '✓',
      tipo: 'CONFIRMACION',
    },
    {
      num: 4,
      nivel: fmt(target1),
      accion: 'Toma Parcial',
      icono: '🎯',
      tipo: 'TOMA_PARCIAL',
    },
    {
      num: 5,
      nivel: fmt(target2),
      accion: 'Revisar Salida o Roll',
      icono: '🚩',
      tipo: 'REVISAR',
    },
    {
      num: 6,
      nivel: fmt(stopLevel),
      accion: 'Invalidación',
      icono: '✕',
      tipo: 'INVALIDACION',
    },
  ];

  // Most important alert — first actionable level relative to spot
  const spotNum = Number(spot) || 0;
  const gammaFlipNum = Number(gammaFlip) || 0;
  const putWallNum = Number(putWall) || 0;

  let importantPrice = fmt(gammaFlip ?? putWall);
  let importantDir = spotNum < gammaFlipNum ? 'CROSSING UP' : 'CROSSING DOWN';
  let importantMsg =
    spotNum < gammaFlipNum
      ? 'CONVIERTE WATCHLIST EN SETUP CONFIRMADO'
      : spotNum > putWallNum
      ? 'MANTENER POSICIÓN — SOPORTE ACTIVO'
      : 'INVALIDACIÓN — SALIR DE POSICIÓN';

  // Override if spot already above gammaFlip — next key level is callWall
  if (spotNum > gammaFlipNum && spotNum < Number(callWall || 99999)) {
    importantPrice = fmt(callWall);
    importantDir = 'CROSSING UP';
    importantMsg = 'CONFIRMACIÓN ALCISTA — MOMENTUM CONTINÚA';
  }

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-amber-500/60 via-orange-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-400" />
          Pack de Alertas
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Header labels */}
        <div className="flex items-center gap-2 px-2.5">
          <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide w-12 shrink-0">
            #
          </span>
          <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide w-16 shrink-0">
            Nivel
          </span>
          <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide flex-1">
            Acción
          </span>
        </div>

        {/* Alert rows */}
        <div className="space-y-1.5">
          {rows.map((row) => (
            <AlertRow key={row.num} {...row} />
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-border/30 pt-3">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Alerta Más Importante
          </p>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-sm font-bold font-mono text-amber-400">
                {importantPrice}
              </span>
              <span className="text-[10px] font-bold text-amber-300 uppercase">
                {importantDir}
              </span>
              <span className="text-[10px] text-muted-foreground">—</span>
              <span className="text-[10px] font-semibold text-foreground leading-tight">
                {importantMsg}
              </span>
            </div>
          </div>
        </div>

        {/* Reference levels footer */}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          {[
            { label: 'Spot', value: fmt(spot), cls: 'text-foreground' },
            { label: 'Gamma Flip', value: fmt(gammaFlip), cls: 'text-purple-400' },
            { label: 'Put Wall', value: fmt(putWall), cls: 'text-emerald-400' },
            { label: 'Call Wall', value: fmt(callWall), cls: 'text-cyan-400' },
          ].map(({ label, value, cls }) => (
            <div
              key={label}
              className="flex items-center justify-between bg-secondary/20 rounded-lg px-2 py-1 border border-border/20"
            >
              <span className="text-[9px] text-muted-foreground">{label}</span>
              <span className={`text-[10px] font-bold font-mono ${cls}`}>{value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
