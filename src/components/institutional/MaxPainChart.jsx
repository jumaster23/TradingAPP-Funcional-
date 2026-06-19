import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Area,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatPayout(val) {
  if (val == null) return '0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs}`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="bg-card border border-border/60 rounded-lg px-3 py-2 text-[11px] shadow-xl space-y-1">
      <p className="text-muted-foreground">Strike: <span className="text-foreground font-mono font-bold">{label}</span></p>
      <p className="text-purple-400">Payout: <span className="font-mono font-bold">{formatPayout(val)}</span></p>
    </div>
  );
};

export default function MaxPainChart({ data = [], maxPainStrike, spot }) {
  if (!data.length) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground tracking-widest">MAX PAIN (Payout by Strike)</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px]">
          <p className="text-muted-foreground text-sm">Sin datos</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-500/60 via-indigo-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center justify-between">
          <span className="tracking-widest text-muted-foreground">MAX PAIN (Payout por Strike)</span>
          {maxPainStrike != null && (
            <span className="text-[10px] font-mono text-amber-400 font-semibold">
              Pain: {maxPainStrike}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="painGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="strike"
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#444' }}
            />
            <YAxis
              tickFormatter={formatPayout}
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={46}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#444' }} />
            {maxPainStrike != null && (
              <ReferenceLine
                x={maxPainStrike}
                stroke="#f59e0b"
                strokeWidth={1.5}
                label={{ value: 'Max Pain', position: 'top', fill: '#f59e0b', fontSize: 9 }}
              />
            )}
            {spot != null && (
              <ReferenceLine
                x={spot}
                stroke="#22d3ee"
                strokeDasharray="4 3"
                label={{ value: 'Spot', position: 'insideTopRight', fill: '#22d3ee', fontSize: 9 }}
              />
            )}
            <Area
              type="monotone"
              dataKey="totalPain"
              stroke="#a855f7"
              strokeWidth={2}
              fill="url(#painGradient)"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
