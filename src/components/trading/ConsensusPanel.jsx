import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

function gradeClass(setupGrade) {
  if (setupGrade === 'A+') return 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
  if (setupGrade === 'B+') return 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10';
  if (setupGrade === 'B') return 'text-amber-300 border-amber-500/40 bg-amber-500/10';
  return 'text-red-300 border-red-500/40 bg-red-500/10';
}

function panelClass(consensus) {
  if (consensus?.strong_contradiction) return 'bg-amber-500/10 border-amber-500/30';
  if (consensus?.high_alignment) return 'bg-emerald-500/10 border-emerald-500/30';
  return 'bg-card border-border/50';
}

function SignalLine({ label, value }) {
  if (!value) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {label}: <span className="text-foreground font-semibold">{value}</span>
    </p>
  );
}

export default function ConsensusPanel({ title = 'Consenso', consensus, setupGrade, entryAlert }) {
  if (!consensus) return null;

  return (
    <Card className={`border ${panelClass(consensus)}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {setupGrade && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${gradeClass(setupGrade)}`}>
              Setup {setupGrade}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <SignalLine label="General" value={consensus.overall_signal} />
          <SignalLine label="Scalp" value={consensus.scalp_signal} />
          <SignalLine label="Intraday" value={consensus.intraday_signal} />
          <SignalLine label="Dominante" value={consensus.dominant_direction || consensus.dominant_strategy_direction} />
          <SignalLine label="Diario" value={consensus.daily_trend} />
          <SignalLine label="4H" value={consensus.tf4h_trend} />
          <SignalLine label="Sesgo" value={consensus.intraday_bias} />
          <SignalLine label="Régimen" value={consensus.market_regime} />
        </div>

        {typeof consensus.ml_probability === 'number' && (
          <p className="text-xs text-foreground/90">
            ML: {(consensus.ml_probability * 100).toFixed(1)}% | Filtro: {consensus.ml_filter ? 'PASS' : 'DEFENSIVO'} | Muestras: {consensus.ml_samples || 0}
          </p>
        )}
        {consensus.ml_note && <p className="text-xs text-muted-foreground">{consensus.ml_note}</p>}

        {consensus.size_guidance && <p className="text-xs text-foreground/90">{consensus.size_guidance}</p>}
        {(entryAlert || consensus.warning) && <p className="text-xs text-amber-300">{entryAlert || consensus.warning}</p>}
        {consensus.context_mismatch_explanation && <p className="text-xs text-muted-foreground">{consensus.context_mismatch_explanation}</p>}
      </CardContent>
    </Card>
  );
}