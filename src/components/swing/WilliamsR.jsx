import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, CheckCircle2, XCircle, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

function getZone(value) {
  if (value === null || value === undefined) return null;
  if (value >= -20) return { label: 'Sobrecomprado ⚠️', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
  if (value <= -80) return { label: 'Sobrevendido ⚠️', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
  if (value <= -40 && value > -80) return { label: 'Zona CALL óptima', color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30' };
  if (value > -40 && value < -20) return { label: 'Zona PUT óptima', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' };
  return { label: 'Neutral', color: 'text-muted-foreground', bg: 'bg-secondary/50', border: 'border-border/40' };
}

function WRGauge({ value, label }) {
  if (value === null || value === undefined) return null;
  const zone = getZone(value);
  // Map -100 to 0 → 0% to 100% on the bar (left = -100, right = 0)
  const pct = Math.min(100, Math.max(0, ((value + 100) / 100) * 100));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className={`text-xs font-bold font-mono ${zone.color}`}>{value?.toFixed(1)}</span>
      </div>
      {/* Track */}
      <div className="relative h-5 rounded-full bg-secondary overflow-hidden">
        {/* Zone shading: -80 to -40 = zona buena swing (CALL) */}
        <div className="absolute top-0 bottom-0 bg-primary/10 rounded-sm" style={{ left: '0%', width: '20%' }} />
        {/* -80 to -40 optimal zone */}
        <div className="absolute top-0 bottom-0 bg-primary/20" style={{ left: '20%', width: '40%' }} />
        {/* Marker */}
        <div
          className={`absolute top-0 bottom-0 w-1 ${zone.color.replace('text-', 'bg-').replace('/400', '/80')}`}
          style={{ left: `calc(${pct}% - 2px)`, transition: 'left 0.5s ease' }}
        />
        {/* Labels inside */}
        <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
          <span className="text-[8px] text-muted-foreground/60">-100</span>
          <span className="text-[8px] text-emerald-400/60">-80</span>
          <span className="text-[8px] text-primary/60">-40</span>
          <span className="text-[8px] text-red-400/60">-20</span>
          <span className="text-[8px] text-muted-foreground/60">0</span>
        </div>
      </div>
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${zone.bg} ${zone.color} border ${zone.border}`}>
        {zone.label}
      </div>
    </div>
  );
}

function ConfirmRow({ label, confirmed }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {confirmed ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
      <span className={confirmed ? 'text-emerald-400' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

export default function WilliamsR({ data }) {
  if (!data) return null;

  const { daily, weekly, interpretation, swing_quality, signal_note, call_signal_active, put_signal_active, call_confirmations, put_confirmations } = data;
  const isGoodSwing = swing_quality === true;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Williams %R
          </span>
          {swing_quality !== undefined && (
            isGoodSwing
              ? <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Buen setup swing
                </span>
              : <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/30">
                  <XCircle className="w-3 h-3" /> Fuera de zona óptima
                </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Gauges */}
        <div className="space-y-4">
          <WRGauge value={daily} label="Williams %R Diario (14 períodos)" />
          <WRGauge value={weekly} label="Williams %R Semanal (14 períodos)" />
        </div>

        {/* Zone legend */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-2">
            <p className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wide mb-0.5">Señal CALL 🔺</p>
            <p className="text-[10px] text-muted-foreground">Estaba en -80 a -100 (sobrevendido) y cruza ARRIBA de -80 → confirmar vela + volumen + tendencia</p>
          </div>
          <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-2">
            <p className="text-[9px] font-semibold text-red-400 uppercase tracking-wide mb-0.5">Señal PUT 🔻</p>
            <p className="text-[10px] text-muted-foreground">Estaba en -20 a 0 (sobrecomprado) y cruza ABAJO de -20 → confirmar vela + volumen</p>
          </div>
        </div>

        {/* Active CALL signal */}
        {call_signal_active && (
          <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <p className="text-xs font-bold text-emerald-400">⚡ SEÑAL CALL ACTIVA — Cruzó sobre -80</p>
            </div>
            <p className="text-[10px] text-muted-foreground">Williams %R salió de zona sobrevendido. Confirmar con:</p>
            {call_confirmations && (
              <div className="space-y-1">
                <ConfirmRow label="Vela alcista (cierre > apertura)" confirmed={call_confirmations.confirmed_candle} />
                <ConfirmRow label="Volumen por encima del promedio" confirmed={call_confirmations.confirmed_volume} />
                <ConfirmRow label="Tendencia general alcista" confirmed={call_confirmations.confirmed_trend} />
              </div>
            )}
          </div>
        )}

        {/* Active PUT signal */}
        {put_signal_active && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <p className="text-xs font-bold text-red-400">⚡ SEÑAL PUT ACTIVA — Cruzó bajo -20</p>
            </div>
            <p className="text-[10px] text-muted-foreground">Williams %R salió de zona sobrecomprado. Confirmar con:</p>
            {put_confirmations && (
              <div className="space-y-1">
                <ConfirmRow label="Vela bajista (cierre < apertura)" confirmed={put_confirmations.confirmed_candle} />
                <ConfirmRow label="Volumen por encima del promedio" confirmed={put_confirmations.confirmed_volume} />
              </div>
            )}
          </div>
        )}

        {/* Interpretation */}
        {interpretation && (
          <div className="bg-secondary/30 rounded-lg p-3 border border-border/40">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              Interpretación
            </p>
            <p className="text-[10px] text-foreground">{interpretation}</p>
          </div>
        )}

        {signal_note && (
          <p className="text-[10px] text-muted-foreground italic">{signal_note}</p>
        )}

      </CardContent>
    </Card>
  );
}