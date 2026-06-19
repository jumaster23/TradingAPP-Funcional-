import React from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, LabelList
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const structureBadge = {
  CONTANGO:      'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
  BACKWARDATION: 'bg-red-500/15 border-red-500/40 text-red-400',
  FLAT:          'bg-amber-500/15 border-amber-500/40 text-amber-400',
};

const structureLabel = {
  CONTANGO:      'CONTANGO',
  BACKWARDATION: 'BACKWARDACIÓN',
  FLAT:          'PLANO',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="bg-card border border-border/60 rounded-lg px-3 py-2 text-[11px] shadow-xl space-y-1">
      <p className="text-muted-foreground">DTE: <span className="text-foreground font-mono font-bold">{label}d</span></p>
      {point?.expDate && (
        <p className="text-muted-foreground">Exp: <span className="text-foreground">{point.expDate}</span></p>
      )}
      <p className="text-indigo-400">IV ATM: <span className="font-mono font-bold">{payload[0]?.value?.toFixed(2)}%</span></p>
    </div>
  );
};

const DotLabel = ({ x, y, value }) => {
  if (value == null) return null;
  return (
    <text x={x} y={y - 8} fill="#a5b4fc" fontSize={9} textAnchor="middle">
      {value.toFixed(1)}%
    </text>
  );
};

export default function IVTermStructureChart({ data = [], structure = 'FLAT' }) {
  if (!data.length) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground tracking-widest">IV TERM STRUCTURE</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px]">
          <p className="text-muted-foreground text-sm">Sin datos</p>
        </CardContent>
      </Card>
    );
  }

  const badgeCls = structureBadge[structure] || structureBadge.FLAT;
  const badgeLabel = structureLabel[structure] || structure;

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-indigo-500/60 via-purple-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center justify-between">
          <span className="tracking-widest text-muted-foreground">IV TERM STRUCTURE (IV ATM vs DTE)</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeCls}`}>
            {badgeLabel}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="dte"
              tickFormatter={v => `${v}d`}
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
            <Line
              type="monotone"
              dataKey="atmIV"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ fill: '#6366f1', r: 4, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#a5b4fc' }}
            >
              <LabelList dataKey="atmIV" content={<DotLabel />} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
