import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, CheckCircle2, XCircle } from 'lucide-react';
import SignalBadge from '../trading/SignalBadge';
import ProbabilityBar from '../trading/ProbabilityBar';

const Check = ({ val }) => val
  ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
  : <XCircle className="w-3 h-3 text-red-400/60" />;

export default function LeapsScanner({ results, scanTime, onSelect }) {
  if (!results || results.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          🎯 Candidatos LEAPS Encontrados
        </h3>
        {scanTime && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {scanTime.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {results.map((item, idx) => (
          <Card
            key={idx}
            className="bg-card border-border/50 hover:border-purple-500/30 transition-all cursor-pointer"
            onClick={() => onSelect && onSelect(item)}
          >
            <CardContent className="p-3 space-y-2.5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-base font-bold font-mono text-foreground">{item.ticker}</span>
                  <p className="text-[9px] text-muted-foreground">{item.name}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <SignalBadge signal={item.signal} />
                  {item.setup_grade && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${item.setup_grade === 'A+' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : item.setup_grade === 'B+' ? 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' : item.setup_grade === 'B' ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10'}`}>
                      {item.setup_grade}
                    </span>
                  )}
                  {item.current_price && (
                    <span className="text-[10px] font-mono text-amber-400">${item.current_price?.toFixed(2)}</span>
                  )}
                </div>
              </div>

              {/* Multi-timeframe + fundamentals status */}
              <div className="grid grid-cols-4 gap-1.5 text-center">
                {[
                  { label: 'Diario', val: item.daily_ok, note: 'Principal' },
                  { label: 'Semanal', val: item.weekly_ok, note: 'Macro' },
                  { label: 'Mensual', val: item.monthly_ok, note: 'Confirma' },
                  { label: 'Fundamentos', val: item.fundamentals_ok, note: 'Filtro' },
                ].map(({ label, val, note }) => (
                  <div key={label} className={`rounded-lg p-1.5 border ${val ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-secondary/30 border-border/30'}`}>
                    <p className="text-[8px] text-muted-foreground">{label}</p>
                    <div className="flex items-center justify-center my-0.5"><Check val={val} /></div>
                    <p className={`text-[8px] font-semibold ${val ? 'text-emerald-400' : 'text-muted-foreground/50'}`}>{note}</p>
                  </div>
                ))}
              </div>

              {/* EMA status + RSI + Sector */}
              {(item.ema_status || item.rsi_value || item.sector) && (
                <div className="space-y-1">
                  {item.ema_status && <p className="text-[9px] text-muted-foreground leading-tight">{item.ema_status}</p>}
                  <div className="flex items-center gap-3">
                    {item.rsi_value != null && (
                      <span className={`text-[9px] font-semibold ${item.rsi_value >= 50 && item.rsi_value <= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        RSI: {item.rsi_value.toFixed(1)}
                      </span>
                    )}
                    {item.sector && <span className="text-[9px] text-muted-foreground">Sector: {item.sector}</span>}
                  </div>
                </div>
              )}

              {/* Trade Levels: Entry / SL / TP */}
              {(item.entry_price || item.stop_loss || item.take_profit) && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="bg-primary/8 rounded-lg p-1.5 text-center border border-primary/20">
                    <p className="text-[8px] text-muted-foreground">Entrada</p>
                    <p className="text-[11px] font-bold font-mono text-primary">{item.entry_price ? `$${item.entry_price.toFixed(2)}` : '--'}</p>
                  </div>
                  <div className="bg-red-500/8 rounded-lg p-1.5 text-center border border-red-500/20">
                    <p className="text-[8px] text-muted-foreground">Stop Loss</p>
                    <p className="text-[11px] font-bold font-mono text-red-400">{item.stop_loss ? `$${item.stop_loss.toFixed(2)}` : '--'}</p>
                  </div>
                  <div className="bg-emerald-500/8 rounded-lg p-1.5 text-center border border-emerald-500/20">
                    <p className="text-[8px] text-muted-foreground">Take Profit</p>
                    <p className="text-[11px] font-bold font-mono text-emerald-400">{item.take_profit ? `$${item.take_profit.toFixed(2)}` : '--'}</p>
                  </div>
                </div>
              )}

              {/* Expiration + contract context */}
              {(item.expiration_suggestion || item.delta_suggestion || item.strike_suggestion) && (
                <div className="bg-purple-500/8 rounded-lg px-2 py-1.5 border border-purple-500/20 space-y-0.5">
                  {item.expiration_suggestion && (
                    <p className="text-[9px] text-purple-400 font-semibold">📅 Expiración: {item.expiration_suggestion}</p>
                  )}
                  <div className="flex items-center gap-3">
                    {item.delta_suggestion != null && (
                      <span className="text-[9px] text-foreground">Delta: {item.delta_suggestion}</span>
                    )}
                    {item.strike_suggestion && (
                      <span className="text-[9px] text-foreground">Strike: {item.strike_suggestion}</span>
                    )}
                  </div>
                </div>
              )}

              <ProbabilityBar successPercent={item.success_probability || 50} />

              {(item.entry_alert || item.size_guidance) && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-2 py-1.5">
                  <p className="text-[9px] text-amber-300">{item.entry_alert || item.size_guidance}</p>
                </div>
              )}

              {item.reason && (
                <p className="text-[9px] text-muted-foreground leading-tight line-clamp-2">{item.reason}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}