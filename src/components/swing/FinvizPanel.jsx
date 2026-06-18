import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart2, Target, AlertTriangle, Users } from 'lucide-react';

function Pill({ label, value, color }) {
  const colors = {
    green: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    red: 'bg-red-500/10 border-red-500/30 text-red-400',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    cyan: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
    default: 'bg-secondary/60 border-border/40 text-muted-foreground',
  };
  return (
    <div className={`flex flex-col items-center rounded-lg border px-2.5 py-2 ${colors[color] || colors.default}`}>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-[11px] font-bold mt-0.5">{value ?? '--'}</span>
    </div>
  );
}

function SignalColor(signal) {
  if (!signal) return 'default';
  const s = signal.toLowerCase();
  if (s.includes('strong buy') || s.includes('buy')) return 'green';
  if (s.includes('strong sell') || s.includes('sell')) return 'red';
  return 'amber';
}

function SmaColor(signal) {
  if (!signal) return 'default';
  return signal.toLowerCase().includes('above') || signal.toLowerCase().includes('sobre') ? 'green' : 'red';
}

export default function FinvizPanel({ data }) {
  if (!data) return null;

  const rsiColor = data.rsi >= 70 ? 'red' : data.rsi <= 30 ? 'green' : 'cyan';
  const shortColor = data.short_float >= 20 ? 'red' : data.short_float >= 10 ? 'amber' : 'default';

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-cyan-400" />
          Finviz — Datos Técnicos y Fundamentales
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Sector / Industry */}
        {(data.sector || data.industry) && (
          <div className="flex gap-2 text-[10px] text-muted-foreground">
            {data.sector && <span className="bg-secondary/60 border border-border/40 rounded-full px-2.5 py-0.5">{data.sector}</span>}
            {data.industry && <span className="bg-secondary/60 border border-border/40 rounded-full px-2.5 py-0.5">{data.industry}</span>}
          </div>
        )}

        {/* Technical indicators row */}
        <div className="grid grid-cols-4 gap-2">
          <Pill label="RSI(14)" value={data.rsi?.toFixed(1)} color={rsiColor} />
          <Pill label="ATR" value={data.atr?.toFixed(2)} color="default" />
          <Pill label="Beta" value={data.beta?.toFixed(2)} color="default" />
          <Pill label="Vol Ratio" value={data.volume_ratio ? `${data.volume_ratio.toFixed(1)}x` : '--'} color={data.volume_ratio >= 1.5 ? 'green' : 'default'} />
        </div>

        {/* MACD + Analyst Rating */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">MACD Señal</p>
            <p className={`text-xs font-bold ${SignalColor(data.macd) === 'green' ? 'text-emerald-400' : SignalColor(data.macd) === 'red' ? 'text-red-400' : 'text-amber-400'}`}>
              {data.macd || '--'}
            </p>
          </div>
          <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <Users className="w-2.5 h-2.5" />Rating Analistas
            </p>
            <p className={`text-xs font-bold ${SignalColor(data.analyst_rating) === 'green' ? 'text-emerald-400' : SignalColor(data.analyst_rating) === 'red' ? 'text-red-400' : 'text-amber-400'}`}>
              {data.analyst_rating || '--'}
            </p>
          </div>
        </div>

        {/* SMAs */}
        <div className="grid grid-cols-3 gap-2">
          <Pill label="SMA 20" value={data.sma20_signal} color={SmaColor(data.sma20_signal)} />
          <Pill label="SMA 50" value={data.sma50_signal} color={SmaColor(data.sma50_signal)} />
          <Pill label="SMA 200" value={data.sma200_signal} color={SmaColor(data.sma200_signal)} />
        </div>

        {/* Price Target + Short Float */}
        <div className="grid grid-cols-2 gap-2">
          {data.price_target && (
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1">
                <Target className="w-2.5 h-2.5 text-primary" />Precio Objetivo
              </p>
              <p className="text-sm font-bold font-mono text-primary">${data.price_target.toFixed(2)}</p>
            </div>
          )}
          {data.short_float !== undefined && (
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1">
                <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />Short Float
              </p>
              <p className={`text-sm font-bold font-mono ${shortColor === 'red' ? 'text-red-400' : shortColor === 'amber' ? 'text-amber-400' : 'text-foreground'}`}>
                {data.short_float?.toFixed(1)}%
                {data.short_float >= 15 && <span className="text-[9px] ml-1 text-amber-400">⚡ Squeeze risk</span>}
              </p>
            </div>
          )}
        </div>

        {/* Summary */}
        {data.summary && (
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3">
            <p className="text-[9px] font-semibold text-cyan-400 uppercase tracking-wide mb-1">Resumen Finviz</p>
            <p className="text-[10px] text-foreground">{data.summary}</p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}