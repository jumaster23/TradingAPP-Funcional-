import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, Activity, Zap } from 'lucide-react';

function scoreBadgeStyle(score) {
  if (score >= 70) return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400';
  if (score >= 50) return 'bg-amber-500/15 border-amber-500/40 text-amber-400';
  return 'bg-red-500/15 border-red-500/40 text-red-400';
}

function scoreColor(score) {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function TiltLabel({ tilt }) {
  const map = {
    'Front Call Bias': { label: 'Sesgo Call Frontal', cls: 'text-emerald-400', icon: TrendingUp },
    'Front Put Bias':  { label: 'Sesgo Put Frontal',  cls: 'text-red-400',     icon: TrendingDown },
    'Neutral':         { label: 'Neutral',            cls: 'text-amber-400',   icon: Minus },
  };
  const cfg = map[tilt] || map['Neutral'];
  const Icon = cfg.icon;
  return (
    <span className={`flex items-center gap-1 text-xs font-semibold ${cfg.cls}`}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

function DirectionBadge({ value }) {
  if (value == null) return <span className="text-muted-foreground text-xs font-mono">--</span>;
  const bullish = value < 0.9;
  return (
    <span className={`flex items-center gap-0.5 font-mono text-sm font-bold ${bullish ? 'text-emerald-400' : 'text-red-400'}`}>
      {bullish ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
      {value.toFixed(2)}
    </span>
  );
}

const typeColors = {
  CALL: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
  PUT:  'bg-red-500/15 border-red-500/30 text-red-400',
};

const dirColors = {
  BUY:     'text-emerald-400',
  SELL:    'text-red-400',
  NEUTRAL: 'text-amber-400',
};

export default function FlowScoreCard({ score, tilt, pcr, unusualActivity = [] }) {
  const isEmpty = score == null && tilt == null && pcr == null && !unusualActivity.length;

  if (isEmpty) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground tracking-widest">FLUJO INSTITUCIONAL</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-muted-foreground text-sm">Sin datos</p>
        </CardContent>
      </Card>
    );
  }

  const badgeCls = score != null ? scoreBadgeStyle(score) : 'bg-secondary border-border text-muted-foreground';
  const scoreText = score != null ? scoreColor(score) : 'text-muted-foreground';
  const top5 = unusualActivity.slice(0, 5);

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500/60 via-amber-500/30 to-transparent" />
      <CardHeader className="pb-3">
        <CardTitle className="text-xs flex items-center gap-2 tracking-widest text-muted-foreground">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          FLUJO INSTITUCIONAL
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Score + Tilt + PCR row */}
        <div className="grid grid-cols-3 gap-3">

          {/* Score */}
          <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 flex flex-col items-center justify-center gap-1">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Score</p>
            {score != null ? (
              <>
                <span className={`text-2xl font-bold font-mono ${scoreText}`}>{score}</span>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${badgeCls}`}>
                  {score >= 70 ? 'Alcista' : score >= 50 ? 'Neutral' : 'Bajista'}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">--</span>
            )}
          </div>

          {/* PCR */}
          <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 flex flex-col items-center justify-center gap-1">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Put/Call</p>
            <DirectionBadge value={pcr} />
            {pcr != null && (
              <span className={`text-[9px] font-semibold ${pcr < 0.9 ? 'text-emerald-400' : 'text-red-400'}`}>
                {pcr < 0.7 ? 'Codicia' : pcr < 0.9 ? 'Optimista' : pcr < 1.2 ? 'Neutral' : 'Miedo'}
              </span>
            )}
          </div>

          {/* Tilt */}
          <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 flex flex-col items-center justify-center gap-1">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Inclinación</p>
            {tilt ? <TiltLabel tilt={tilt} /> : <span className="text-muted-foreground text-xs">--</span>}
          </div>
        </div>

        {/* Unusual Activity */}
        {top5.length > 0 && (
          <div>
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-2">
              <Zap className="w-3 h-3 text-amber-400" />
              Actividad Inusual (top {top5.length})
            </p>
            <div className="space-y-1.5">
              {top5.map((item, i) => {
                const typeCls = typeColors[item.type] || 'bg-secondary border-border/40 text-muted-foreground';
                const dirCls  = dirColors[item.direction] || 'text-muted-foreground';
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-secondary/30 border border-border/30 text-[10px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-foreground font-semibold">{item.strike ?? '--'}</span>
                      <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${typeCls}`}>
                        {item.type ?? '?'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {item.volOIRatio != null && (
                        <span className="text-muted-foreground font-mono">
                          Vol/OI <span className="text-foreground font-bold">{item.volOIRatio.toFixed(1)}x</span>
                        </span>
                      )}
                      {item.direction && (
                        <span className={`font-bold uppercase ${dirCls}`}>{item.direction}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {top5.length === 0 && (
          <div className="flex items-center justify-center py-4 text-muted-foreground text-[11px]">
            Sin actividad inusual detectada
          </div>
        )}
      </CardContent>
    </Card>
  );
}
