import React from 'react';
import { cn } from '@/lib/utils';

const toneMap = {
  success: {
    successBar: 'from-emerald-600 to-emerald-400',
    successText: 'text-emerald-400',
  },
  mixed: {
    successBar: 'from-amber-600 to-amber-400',
    successText: 'text-amber-300',
  },
  rejection: {
    successBar: 'from-rose-700 to-red-500',
    successText: 'text-red-300',
  },
};

export default function ProbabilityBar({ label, successPercent, className, tone = 'success', note, noteClassName }) {
  const failPercent = 100 - successPercent;
  const palette = toneMap[tone] || toneMap.success;

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-6 rounded-full overflow-hidden bg-secondary flex">
          <div
            className={cn(
              'h-full flex items-center justify-center text-[10px] font-bold transition-all duration-700',
              'bg-emerald-500 text-white'
            )}
            style={{ width: `${successPercent}%` }}
          >
            {successPercent >= 15 && (
              <span className="text-emerald-100">{successPercent.toFixed(0)}%</span>
            )}
          </div>
          <div
            className="h-full flex items-center justify-center text-[10px] font-bold transition-all duration-700 bg-red-500 text-white"
            style={{ width: `${failPercent}%` }}
          >
            {failPercent >= 15 && (
              <span className="text-red-100">{failPercent.toFixed(0)}%</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span className={palette.successText}>Éxito: {successPercent.toFixed(1)}%</span>
        <span className="text-red-400">Fallo: {failPercent.toFixed(1)}%</span>
      </div>
      {note && (
        <p className={cn('text-[10px] text-muted-foreground', noteClassName)}>{note}</p>
      )}
    </div>
  );
}