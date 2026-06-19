import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatOI(val) {
  if (val == null) return '0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs}`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const callVal = payload.find(p => p.dataKey === 'callOI')?.value ?? 0;
  const putRaw = payload.find(p => p.dataKey === 'putOIMirror')?.value ?? 0;
  const putVal = Math.abs(putRaw);
  return (
    <div className="bg-card border border-border/60 rounded-lg px-3 py-2 text-[11px] shadow-xl space-y-1">
      <p className="text-muted-foreground">Strike: <span className="text-foreground font-mono font-bold">{label}</span></p>
      <p className="text-emerald-400">Calls OI: <span className="font-mono font-bold">{formatOI(callVal)}</span></p>
      <p className="text-red-400">Puts OI: <span className="font-mono font-bold">{formatOI(putVal)}</span></p>
    </div>
  );
};

export default function OIDistributionChart({ data = [], callWall, putWall, maxPain, spot, expDate }) {
  if (!data.length) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground tracking-widest">OPEN INTEREST DISTRIBUTION</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px]">
          <p className="text-muted-foreground text-sm">Sin datos</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map(d => ({
    ...d,
    putOIMirror: d.putOI != null ? d.putOI * -1 : 0,
  }));

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500/50 via-red-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center justify-between">
          <span className="tracking-widest text-muted-foreground">OPEN INTEREST DISTRIBUTION</span>
          {expDate && (
            <span className="text-[10px] text-muted-foreground/60 font-normal">Exp: {expDate}</span>
          )}
        </CardTitle>
        <div className="flex items-center gap-3 mt-1">
          {callWall != null && (
            <span className="text-[9px] text-emerald-400">
              ▲ Call Wall: <span className="font-mono font-bold">{callWall}</span>
            </span>
          )}
          {putWall != null && (
            <span className="text-[9px] text-red-400">
              ▼ Put Wall: <span className="font-mono font-bold">{putWall}</span>
            </span>
          )}
          {maxPain != null && (
            <span className="text-[9px] text-amber-400">
              Max Pain: <span className="font-mono font-bold">{maxPain}</span>
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex items-center gap-3 mb-2">
          <span className="flex items-center gap-1 text-[9px] text-emerald-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />Calls
          </span>
          <span className="flex items-center gap-1 text-[9px] text-red-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Puts
          </span>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
            <XAxis
              dataKey="strike"
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#444' }}
            />
            <YAxis
              tickFormatter={formatOI}
              tick={{ fill: '#888', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={46}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
            {spot != null && (
              <ReferenceLine
                x={spot}
                stroke="#22d3ee"
                strokeWidth={1.5}
                label={{ value: 'Spot', position: 'top', fill: '#22d3ee', fontSize: 9 }}
              />
            )}
            {callWall != null && (
              <ReferenceLine
                x={callWall}
                stroke="#10b981"
                strokeDasharray="4 3"
                label={{ value: 'Call Wall', position: 'insideTopRight', fill: '#10b981', fontSize: 9 }}
              />
            )}
            {putWall != null && (
              <ReferenceLine
                x={putWall}
                stroke="#ef4444"
                strokeDasharray="4 3"
                label={{ value: 'Put Wall', position: 'insideTopLeft', fill: '#ef4444', fontSize: 9 }}
              />
            )}
            <Bar dataKey="callOI" fill="#10b981" fillOpacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={14} />
            <Bar dataKey="putOIMirror" fill="#ef4444" fillOpacity={0.85} radius={[0, 0, 2, 2]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
