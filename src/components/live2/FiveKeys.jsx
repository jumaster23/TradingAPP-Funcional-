import React from 'react';
import { cn } from '@/lib/utils';

const KEY_MAP = {
  sweep:            { emoji: '🌊', label: 'Trampa puesta' },
  choch:            { emoji: '🔄', label: 'Dirección cambió' },
  emaAlignment:     { emoji: '🧭', label: 'Tendencia clara' },
  volumeConfluence: { emoji: '💧', label: 'Zona de interés' },
  atrOk:            { emoji: '⚡', label: 'Espacio libre' },
  fibLevel:         { emoji: '🌀', label: 'Nivel Fibonacci' },
  spyConvergence:   { emoji: '📡', label: 'SPY alineado' },
};

export default function FiveKeys({ checklist }) {
  if (!checklist) return null;

  const keys = Object.entries(KEY_MAP);
  const total = keys.length;
  const onCount = keys.filter(([k]) => !!checklist[k]).length;

  return (
    <div className="bg-secondary/10 rounded-2xl border border-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Condiciones ({total})</p>
        <span className={cn(
          'text-sm font-black px-2 py-0.5 rounded-full',
          onCount === total ? 'bg-emerald-500/20 text-emerald-400' :
          onCount >= 5      ? 'bg-amber-500/20 text-amber-400' :
          'bg-white/5 text-muted-foreground'
        )}>
          {onCount}/{total} llaves
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {keys.map(([key, { emoji, label }]) => {
          const isOn = !!checklist[key];
          return (
            <div
              key={key}
              className={cn(
                'flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-500',
                isOn
                  ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                  : 'bg-secondary/20 border-white/5 opacity-50'
              )}
            >
              <span className={cn('text-2xl mb-2 transition-all duration-300', isOn && 'drop-shadow-[0_0_6px_rgba(16,185,129,0.8)]')}>
                {emoji}
              </span>
              <p className={cn(
                'text-[9px] font-bold text-center leading-tight',
                isOn ? 'text-emerald-400' : 'text-muted-foreground'
              )}>
                {label}
              </p>
              {isOn && (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mt-1.5 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
