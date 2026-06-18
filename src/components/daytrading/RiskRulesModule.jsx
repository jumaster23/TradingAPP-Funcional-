import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, TrendingUp, Pause, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

function RuleRow({ icon: RuleIcon, color, title, trigger, action }) {
  return (
    <div className={`rounded-lg border p-3 space-y-1.5 ${color.bg} ${color.border}`}>
      <div className="flex items-center gap-2">
        <RuleIcon className={`w-4 h-4 ${color.text} shrink-0`} />
        <p className={`text-xs font-bold ${color.text}`}>{title}</p>
      </div>
      {trigger && (
        <div className="flex items-start gap-1.5 text-[10px]">
          <span className="text-muted-foreground shrink-0 font-semibold uppercase">Cuando:</span>
          <span className="text-foreground">{trigger}</span>
        </div>
      )}
      {action && (
        <div className="flex items-start gap-1.5 text-[10px]">
          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-foreground font-medium">{action}</span>
        </div>
      )}
    </div>
  );
}

export default function RiskRulesModule({ rules }) {
  if (!rules) return null;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          Gestión de Riesgo Dinámica
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Breakeven */}
        {rules.breakeven_trigger && (
          <RuleRow
            icon={Shield}
            color={{ text: 'text-cyan-400', bg: 'bg-cyan-500/5', border: 'border-cyan-500/20' }}
            title="Mover SL a Breakeven"
            trigger={rules.breakeven_trigger}
            action={rules.breakeven_action}
          />
        )}

        {/* Partial Profit */}
        {rules.partial_profit_trigger && (
          <RuleRow
            icon={TrendingUp}
            color={{ text: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20' }}
            title="Tomar Profit Parcial"
            trigger={rules.partial_profit_trigger}
            action={rules.partial_profit_action}
          />
        )}

        {/* Full Exit */}
        {rules.full_exit_trigger && (
          <RuleRow
            icon={CheckCircle2}
            color={{ text: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/20' }}
            title="Salida Total (TP completo)"
            trigger={rules.full_exit_trigger}
            action={rules.full_exit_action}
          />
        )}

        {/* Hold Condition */}
        {rules.hold_trigger && (
          <RuleRow
            icon={Pause}
            color={{ text: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/20' }}
            title="Aguantar la posición"
            trigger={rules.hold_trigger}
            action={rules.hold_action}
          />
        )}

        {/* Invalidation */}
        {rules.invalidation_trigger && (
          <RuleRow
            icon={AlertTriangle}
            color={{ text: 'text-red-400', bg: 'bg-red-500/5', border: 'border-red-500/20' }}
            title="Salir inmediatamente (invalidación)"
            trigger={rules.invalidation_trigger}
            action={rules.invalidation_action}
          />
        )}

        {/* General note */}
        {rules.general_note && (
          <div className="bg-secondary/30 rounded-lg px-3 py-2 border border-border/40">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Guía de ejecución</p>
            <p className="text-[10px] text-muted-foreground">{rules.general_note}</p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}