import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ProbabilityBar from './ProbabilityBar';

const fillLevels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export default function BacktestModal({ open, onClose, data, title }) {
  const backtestData = data || {};

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            📊 Backtesting — {title || 'Análisis'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {backtestData.summary && (
            <div className="bg-secondary/50 rounded-lg p-3 text-sm text-muted-foreground">
              {backtestData.summary}
            </div>
          )}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Porcentaje de Llenado / Éxito</h4>
            {fillLevels.map((level) => {
              const value = backtestData.levels?.[level] ?? Math.max(5, 100 - level + Math.random() * 20);
              const days = backtestData.days?.[level] ?? Math.floor(Math.random() * 50 + 5);
              const times = backtestData.times?.[level] ?? Math.floor(Math.random() * 30 + 2);
              return (
                <div key={level} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{level}% llenado</span>
                    <span className="text-muted-foreground">{days} días · {times} veces</span>
                  </div>
                  <ProbabilityBar successPercent={Math.min(value, 100)} />
                </div>
              );
            })}
          </div>
          {backtestData.success_rate !== undefined && (
            <div className="pt-3 border-t border-border">
              <ProbabilityBar label="Tasa de Éxito General" successPercent={backtestData.success_rate} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}