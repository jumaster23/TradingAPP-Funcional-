import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, ClipboardList, AlertTriangle, Lightbulb } from 'lucide-react';

const CHECKS = [
  { key: 'chk_trend_daily', label: 'Tendencia Diaria (EMA 50)', desc: 'Precio sobre EMA 50 en diario' },
  { key: 'chk_trend_weekly', label: 'Tendencia Semanal (EMA 20)', desc: 'Precio sobre EMA 20 en semanal' },
  { key: 'chk_support_level', label: 'Nivel Técnico Clave', desc: 'En soporte, pivot o ORB importante' },
  { key: 'chk_volume', label: 'Volumen Confirma', desc: 'Volumen creciente en la dirección del trade' },
  { key: 'chk_open_interest', label: 'Open Interest Favorece', desc: 'OI da ventaja en la dirección del trade' },
  { key: 'chk_gamma_alignment', label: 'Gamma Alineado', desc: 'Niveles gamma apoyan la dirección' },
  { key: 'chk_index_confluence', label: 'Confluencia SPX / NQ', desc: 'SPX y NQ confirman la misma dirección' },
  { key: 'chk_rr_ratio', label: 'R:R ≥ 1:2', desc: 'Ratio riesgo:recompensa mínimo 1:2' },
  { key: 'chk_vix_favorable', label: 'VIX Favorable (<25)', desc: 'VIX en nivel que permite swing limpio' },
  { key: 'chk_no_catalyst_risk', label: 'Sin Riesgo de Catalizador', desc: 'Sin earnings ni eventos mayores en 5 días' },
];

export default function SwingChecklist({ checklist, failureReasons, improvementSuggestion, successProbability }) {
  if (!checklist) return null;

  const passed = CHECKS.filter(c => checklist[c.key]?.passes).length;
  const total = CHECKS.length;
  const isFailing = successProbability < 60;
  const setupGrade = successProbability >= 80 ? 'A+' : successProbability >= 70 ? 'B+' : successProbability >= 60 ? 'B' : 'C';

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Checklist de Calidad Swing
          </span>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${passed >= 7 ? 'bg-emerald-500/15 text-emerald-400' : passed >= 5 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
              {passed}/{total} criterios
            </span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${setupGrade === 'A+' ? 'bg-emerald-500/15 text-emerald-400' : setupGrade === 'B+' ? 'bg-cyan-500/15 text-cyan-400' : setupGrade === 'B' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
              Setup {setupGrade}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Checklist items */}
        <div className="space-y-1.5">
          {CHECKS.map(({ key, label, desc }) => {
            const item = checklist[key];
            const passes = item?.passes;
            return (
              <div key={key} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 border ${passes ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                {passes
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-semibold ${passes ? 'text-emerald-400' : 'text-red-400'}`}>{label}</p>
                  <p className="text-[10px] text-muted-foreground">{item?.note || desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Entry alert reasons */}
        {isFailing && failureReasons?.length > 0 && (
          <div className="border-t border-border/40 pt-3 space-y-2">
            <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Alerta de entrada: por qué no es setup A+
            </p>
            <ul className="space-y-1.5">
              {failureReasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground">
                  <span className="text-red-400 font-bold shrink-0">{i + 1}.</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Improvement suggestion */}
        {isFailing && improvementSuggestion && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
            <p className="text-[9px] font-semibold text-primary uppercase tracking-wide flex items-center gap-1 mb-1">
              <Lightbulb className="w-3 h-3" />
              Qué debe cambiar para subir a setup B+/A+
            </p>
            <p className="text-[10px] text-foreground">{improvementSuggestion}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}