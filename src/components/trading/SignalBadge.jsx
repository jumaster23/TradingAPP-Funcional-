import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SignalBadge({ signal, size = 'md' }) {
  const config = {
    CALL: { icon: TrendingUp, label: 'CALL', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    PUT: { icon: TrendingDown, label: 'PUT', bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
    NEUTRAL: { icon: Minus, label: 'NEUTRO', bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  };

  const c = config[signal] || config.NEUTRAL;
  const Icon = c.icon;
  const sizeClasses = size === 'lg' ? 'px-5 py-3 text-lg gap-3' : 'px-3 py-1.5 text-sm gap-2';

  return (
    <div className={cn('inline-flex items-center rounded-lg border font-bold', c.bg, c.text, c.border, sizeClasses)}>
      <Icon className={size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'} />
      {c.label}
    </div>
  );
}