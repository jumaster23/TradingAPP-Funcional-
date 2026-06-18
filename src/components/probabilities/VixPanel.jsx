import React from 'react';
import { Wind, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Regimes based on custom trading logic
const REGIMES = {
  CALM:    {
    label: 'Calma / Complacencia (10-15)',
    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', barColor: 'bg-emerald-500',
    signal: '🟢 CALL — VIX bajando, mercado sube',
    signalColor: 'text-emerald-400',
    bullets: [
      '📉 VIX bajando = mercado tiende a subir',
      '✅ CALL si VIX rompe soporte a la baja con volumen',
      '📊 Divergencia VIX/precio bajista = señal CALL fuerte',
      '⚠ Complacencia extrema: stops ajustados, no sobredimensionar',
    ],
  },
  NORMAL_LOW:  {
    label: 'Normal bajo (16-20) — Esperar',
    color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', barColor: 'bg-cyan-500',
    signal: '⏸ NEUTRAL — VIX lateral, esperar confirmación',
    signalColor: 'text-cyan-400',
    bullets: [
      '↔ VIX lateral sin tendencia clara entre 16-20',
      '⏳ MEJOR ESPERAR: no hay señal direccional definida',
      '🔄 Aguardar ruptura del VIX fuera de este rango',
      '📋 Usar ORB, gap y confluencia de índices para decidir',
    ],
  },
  NORMAL_HIGH: {
    label: 'Normal alto (20-22)',
    color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', barColor: 'bg-yellow-500',
    signal: '⚠ PRECAUCIÓN — VIX subiendo, sesgo PUT',
    signalColor: 'text-yellow-400',
    bullets: [
      '📈 VIX en aumento: presión bajista creciente',
      '🔴 Si VIX rompe resistencia con volumen → PUT',
      '⏳ Esperar confirmación de ruptura clara',
      '⚠ Reducir tamaño de posición en CALL',
    ],
  },
  HIGH:    {
    label: 'Alto / Miedo (23-35)',
    color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', barColor: 'bg-orange-500',
    signal: '🔴 PUT — VIX subiendo, mercado cae',
    signalColor: 'text-red-400',
    bullets: [
      '📈 VIX subiendo con volumen alto = mercado tiende a caer',
      '✅ PUT si VIX rompe resistencia con confirmación de volumen',
      '📊 Divergencia VIX/precio alcista = señal PUT fuerte',
      '⚡ Rebotes violentos posibles — stops amplios, posición -40%',
    ],
  },
  EXTREME: {
    label: 'Pánico Total (>35)',
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', barColor: 'bg-red-500',
    signal: '🟢 CALL contrarian — pánico = rebote',
    signalColor: 'text-emerald-400',
    bullets: [
      '🚨 Pánico total — mercado sobrevendido extremo',
      '📈 CALL contrarian: rebotes fuertes y rápidos al aliviar VIX',
      '🚫 NO entrar en PUT: el riesgo/recompensa es desfavorable',
      '⚡ Esperar que VIX empiece a bajar como confirmación de entrada',
    ],
  },
};

function getRegimeFromValue(vix) {
  if (!vix) return 'NORMAL_LOW';
  if (vix <= 15) return 'CALM';
  if (vix <= 20) return 'NORMAL_LOW';
  if (vix <= 22) return 'NORMAL_HIGH';
  if (vix <= 35) return 'HIGH';
  return 'EXTREME';
}

// Map VIX value (0-50) to % bar width (capped at 50)
function vixToBarPct(vix) {
  return Math.min(100, (vix / 50) * 100);
}

export default function VixPanel({ vix, regime, change, changePct, impact }) {
  if (!vix) return null;

  const resolvedRegime = getRegimeFromValue(vix);
  const cfg = REGIMES[resolvedRegime] || REGIMES.NORMAL;
  const isUp = change > 0;
  const isDown = change < 0;

  // Determine ORB adjustment
  let orbAdj, orbColor;
  if (resolvedRegime === 'CALM')         { orbAdj = '+8%';  orbColor = 'text-emerald-400'; }
  else if (resolvedRegime === 'NORMAL_LOW')   { orbAdj = '0%';   orbColor = 'text-cyan-400'; }
  else if (resolvedRegime === 'NORMAL_HIGH')  { orbAdj = '-5%';  orbColor = 'text-yellow-400'; }
  else if (resolvedRegime === 'HIGH')    { orbAdj = '-15%'; orbColor = 'text-orange-400'; }
  else                                   { orbAdj = '-25%'; orbColor = 'text-red-400'; }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Wind className="w-4 h-4 text-cyan-400" />
            VIX — Índice de Volatilidad del Mercado
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
            {cfg.label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Main VIX value + change */}
        <div className="flex items-end gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">VIX Actual (Tiempo Real)</p>
            <p className={`text-4xl font-bold font-mono ${cfg.color}`}>{vix?.toFixed(2)}</p>
          </div>
          {change !== null && change !== undefined && (
            <div className={`flex items-center gap-1 pb-1 text-sm font-bold ${isUp ? 'text-red-400' : isDown ? 'text-emerald-400' : 'text-muted-foreground'}`}>
              {isUp ? <TrendingUp className="w-4 h-4" /> : isDown ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
              {isUp ? '+' : ''}{change?.toFixed(2)} ({isUp ? '+' : ''}{changePct?.toFixed(2)}%)
              <span className="text-[10px] font-normal text-muted-foreground ml-1">vs ayer</span>
            </div>
          )}
        </div>

        {/* VIX Scale bar */}
        <div className="space-y-2">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Escala de Volatilidad</p>
          <div className="relative h-6 bg-secondary rounded-full overflow-hidden">
            {/* Zone backgrounds: CALM 0-15 (30%), NORMAL 16-22 (14%), HIGH 23-35 (26%), EXTREME >35 (30%) */}
            <div className="absolute inset-0 flex">
              <div className="h-full bg-emerald-500/20" style={{ width: '30%' }} />
              <div className="h-full bg-cyan-500/15"   style={{ width: '14%' }} />
              <div className="h-full bg-orange-500/15" style={{ width: '26%' }} />
              <div className="h-full bg-red-500/20"    style={{ width: '30%' }} />
            </div>
            {/* Current VIX marker */}
            <div
              className={`absolute top-1 bottom-1 w-1.5 rounded-full ${cfg.barColor} shadow-lg`}
              style={{ left: `calc(${vixToBarPct(vix)}% - 3px)`, transition: 'left 0.5s ease' }}
            />
            {/* Labels */}
            <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
              <span className="text-[8px] text-emerald-400/80">10</span>
              <span className="text-[8px] text-emerald-400/80">15</span>
              <span className="text-[8px] text-cyan-400/80">22</span>
              <span className="text-[8px] text-orange-400/80">35</span>
              <span className="text-[8px] text-red-400/80">50+</span>
            </div>
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground/60 pr-4">
            <span className="text-emerald-400/70">Calma/Complacencia</span>
            <span className="text-cyan-400/70">Normal</span>
            <span className="text-orange-400/70">Miedo</span>
            <span className="text-red-400/70">Pánico</span>
          </div>
        </div>

        {/* Signal + ORB row */}
        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-lg p-2.5 border ${cfg.border} ${cfg.bg}`}>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Señal Recomendada</p>
            <p className={`text-sm font-bold ${cfg.signalColor}`}>{cfg.signal}</p>
          </div>
          <div className="bg-secondary/40 rounded-lg p-2.5 border border-border/40">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Ajuste ORB</p>
            <p className={`text-lg font-bold font-mono ${orbColor}`}>{orbAdj}</p>
            <p className="text-[9px] text-muted-foreground">todos los timeframes</p>
          </div>
        </div>

        {/* Bullets */}
        <div className={`rounded-lg p-3 border ${cfg.border} ${cfg.bg} space-y-1.5`}>
          <p className={`text-[9px] font-semibold uppercase tracking-wide flex items-center gap-1 ${cfg.color}`}>
            <AlertTriangle className="w-3 h-3" />
            Qué hacer en este régimen
          </p>
          {cfg.bullets.map((b, i) => (
            <p key={i} className="text-[10px] text-foreground">{b}</p>
          ))}
        </div>

        {/* Impact note from LLM if available */}
        {impact && (
          <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Análisis en tiempo real</p>
            <p className="text-[10px] text-foreground">{impact}</p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}