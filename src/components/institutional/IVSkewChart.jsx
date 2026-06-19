import React from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const callIV = payload.find(p => p.dataKey === 'callIV')?.value;
  const putIV  = payload.find(p => p.dataKey === 'putIV')?.value;
  const spread = (callIV != null && putIV != null) ? (putIV - callIV).toFixed(2) : null;
  return (
    <div className="bg-card border border-border/60 rounded-lg px-3 py-2 text-[11px] shadow-xl space-y-1">
      <p className="text-muted-foreground">Strike: <span className="text-foreground font-mono font-bold">{label}</span></p>
      {callIV != null && <p className="text-emerald-400">Call IV: <span className="font-mono font-bold">{callIV.toFixed(2)}%</span></p>}
      {putIV  != null && <p className="text-red-400">Put IV: <span className="font-mono font-bold">{putIV.toFixed(2)}%</span></p>}
      {spread != null && <p className="text-amber-400/80">Spread: <span className="font-mono font-bold">{spread}%</span></p>}
    </div>
  );
};

function skewBadgeStyle(skew) {
  if (skew == null) return 'bg-amber-500/15 border-amber-500/40 text-amber-400';
  if (skew > 3) return 'bg-red-500/15 border-red-500/40 text-red-400';
  if (skew < -3) return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400';
  return 'bg-amber-500/15 border-amber-500/40 text-amber-400';
}

export default function IVSkewChart({ data = [], spot, skew25d }) {
  if (!data.length) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground tracking-widest">IV SKEW (25Δ PUT - CALL)</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px]">
          <p className="text-muted-foreground text-sm">Sin datos</p>
        </CardContent>
      </Card>
    );
  }

  const badgeCls = skewBadgeStyle(skew25d);

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-red-500/50 via-emerald-500/30 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center justify-between">
          <span className="tracking-widest text-muted-foreground">IV SKEW (25Δ PUT - CALL)</span>
          {skew25d != null && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border font-mono ${badgeCls}`}>
              {skew25d > 0 ? '+' : ''}{skew25d.toFixed(2)}%
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1 text-[9px] text-emerald-400">
            <span className="w-5 h-0.5 bg-emerald-500 inline-block" />Call IV
          </span>
          <span className="flex items-center gap-1 text-[9px] text-red-400">
            <span className="w-5 h-0.5 bg-red-500 inline-block" />Put IV
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="strike"
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#444' }}
            />
            <YAxis
              tickFormatter={v => `${v.toFixed(0)}%`}
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={38}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#444' }} />
            {spot != null && (
              <ReferenceLine
                x={spot}
                stroke="#22d3ee"
                strokeDasharray="4 3"
                label={{ value: 'ATM', position: 'top', fill: '#22d3ee', fontSize: 9 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="callIV"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: '#10b981', r: 3, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="putIV"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ fill: '#ef4444', r: 3, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
