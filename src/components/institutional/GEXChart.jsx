import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatGEX(val) {
  if (val == null) return '0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs}`;
}

const regimeBadgeStyle = {
  POSITIVE: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
  NEGATIVE: 'bg-red-500/15 border-red-500/40 text-red-400',
  NEUTRAL:  'bg-amber-500/15 border-amber-500/40 text-amber-400',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="bg-card border border-border/60 rounded-lg px-3 py-2 text-[11px] shadow-xl">
      <p className="text-muted-foreground mb-1">Strike: <span className="text-foreground font-mono font-bold">{label}</span></p>
      <p className={val >= 0 ? 'text-emerald-400' : 'text-red-400'}>
        GEX: <span className="font-mono font-bold">{formatGEX(val)}</span>
      </p>
    </div>
  );
};

export default function GEXChart({ data = [], gammaFlip, spot, regime = 'NEUTRAL' }) {
  if (!data.length) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground tracking-widest">GAMMA EXPOSURE (EST.)</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px]">
          <p className="text-muted-foreground text-sm">Sin datos</p>
        </CardContent>
      </Card>
    );
  }

  const badgeCls = regimeBadgeStyle[regime] || regimeBadgeStyle.NEUTRAL;

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500/60 via-amber-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center justify-between">
          <span className="tracking-widest text-muted-foreground">GAMMA EXPOSURE (EST.)</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeCls}`}>
            {regime}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
            <XAxis
              dataKey="strike"
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#444' }}
            />
            <YAxis
              tickFormatter={formatGEX}
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={46}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
            {gammaFlip != null && (
              <ReferenceLine
                x={gammaFlip}
                stroke="#f59e0b"
                strokeDasharray="4 3"
                label={{ value: 'Gamma Flip', position: 'top', fill: '#f59e0b', fontSize: 9 }}
              />
            )}
            {spot != null && (
              <ReferenceLine
                x={spot}
                stroke="#22d3ee"
                strokeWidth={1.5}
                label={{ value: 'Spot', position: 'insideTopRight', fill: '#22d3ee', fontSize: 9 }}
              />
            )}
            <Bar dataKey="netGEX" radius={[2, 2, 0, 0]} maxBarSize={18}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.netGEX >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {gammaFlip != null && (
          <p className="text-[9px] text-amber-400/70 text-center mt-1 tracking-widest">
            GAMMA NEUTRAL {gammaFlip}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
