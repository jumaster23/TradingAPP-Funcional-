import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, RefreshCw, Save, History, Clock } from 'lucide-react';

export default function TickerInput({ ticker, setTicker, onAnalyze, onRefresh, onSave, onBacktest, isLoading, lastUpdated }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-xl border border-border/50">
      <div className="flex-1 min-w-[200px]">
        <Input
          placeholder="Ticker (ej: QQQ, SPY, TSLA)"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          className="bg-secondary border-border text-foreground font-mono text-sm"
        />
      </div>
      <Button onClick={onAnalyze} disabled={isLoading || !ticker} className="bg-primary hover:bg-primary/90 text-primary-foreground">
        <Search className="w-4 h-4 mr-2" />
        Analizar
      </Button>
      <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
        Actualizar
      </Button>
      {onSave && (
        <Button variant="outline" onClick={onSave}>
          <Save className="w-4 h-4 mr-2" />
          Guardar
        </Button>
      )}
      {onBacktest && (
        <Button variant="outline" onClick={onBacktest}>
          <History className="w-4 h-4 mr-2" />
          Backtesting
        </Button>
      )}
      {lastUpdated && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
          <Clock className="w-3 h-3" />
          {lastUpdated}
        </div>
      )}
    </div>
  );
}