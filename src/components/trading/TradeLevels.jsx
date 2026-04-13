import React from 'react';
import { ArrowUpRight, ArrowDownRight, Shield } from 'lucide-react';

export default function TradeLevels({ entry, stopLoss, takeProfit, direction }) {
  const isCall = direction === 'CALL';

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-secondary/50 rounded-lg p-3 border border-border/50">
        <div className="flex items-center gap-1.5 mb-1">
          {isCall ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
          <span className="text-[10px] font-medium text-muted-foreground uppercase">Entrada</span>
        </div>
        <p className="text-lg font-bold text-foreground font-mono">${entry?.toFixed(2) || '---'}</p>
      </div>
      <div className="bg-red-500/5 rounded-lg p-3 border border-red-500/20">
        <div className="flex items-center gap-1.5 mb-1">
          <Shield className="w-3.5 h-3.5 text-red-400" />
          <span className="text-[10px] font-medium text-red-400 uppercase">Stop Loss</span>
        </div>
        <p className="text-lg font-bold text-red-400 font-mono">${stopLoss?.toFixed(2) || '---'}</p>
      </div>
      <div className="bg-emerald-500/5 rounded-lg p-3 border border-emerald-500/20">
        <div className="flex items-center gap-1.5 mb-1">
          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px] font-medium text-emerald-400 uppercase">Take Profit</span>
        </div>
        <p className="text-lg font-bold text-emerald-400 font-mono">${takeProfit?.toFixed(2) || '---'}</p>
      </div>
    </div>
  );
}