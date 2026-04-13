import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';
import SignalBadge from '../trading/SignalBadge';
import TradeLevels from '../trading/TradeLevels';
import ProbabilityBar from '../trading/ProbabilityBar';
import InfoModal from '../trading/InfoModal';

export default function TradeModule({ title, data, infoContent }) {
  const [showInfo, setShowInfo] = useState(false);

  if (!data) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground">Analiza un ticker para ver datos</CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-card border-border/50 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary/60 to-transparent" />
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20" onClick={() => setShowInfo(true)}>
            <Info className="w-3.5 h-3.5 text-primary" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <SignalBadge signal={data.signal} />
            <span className="text-xs text-muted-foreground">{data.summary}</span>
          </div>
          <TradeLevels entry={data.entry} stopLoss={data.sl} takeProfit={data.tp} direction={data.signal} />
          <ProbabilityBar label="Probabilidad de Éxito" successPercent={data.success_prob || 50} />
        </CardContent>
      </Card>
      <InfoModal open={showInfo} onClose={() => setShowInfo(false)} title={`${title} — Info`} content={infoContent || `Tasa de confianza: ${data.success_prob?.toFixed(1)}%\n\n${data.detail || 'Análisis basado en datos históricos y contexto del mercado.'}`} />
    </>
  );
}