import React, { useState, useEffect } from 'react';
import { premarketPrep } from '@/lib/orbInstitutional';
import { useMarketContext } from '@/lib/MarketContextProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Sun, TrendingUp, TrendingDown } from 'lucide-react';

const WATCHLIST = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'META', 'GOOGL', 'AMD', 'TSLA'];

export default function PremarketScanner() {
  const { session } = useMarketContext();
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [autoRan, setAutoRan] = useState(false);

  const scan = async () => {
    setLoading(true);
    try {
      const results = await premarketPrep(WATCHLIST);
      setLevels(results);
      setLastScan(new Date().toLocaleTimeString());
    } catch (e) {
      console.error('[PremarketScanner]', e);
    } finally {
      setLoading(false);
    }
  };

  // Auto-run during premarket
  useEffect(() => {
    if (session === 'PREMARKET' && !autoRan && levels.length === 0) {
      setAutoRan(true);
      scan();
    }
  }, [session, autoRan, levels.length]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-400" />
            Pre-Market Scanner — Niveles Institucionales
          </CardTitle>
          <div className="flex items-center gap-2">
            {lastScan && <span className="text-[10px] text-muted-foreground">{lastScan}</span>}
            <Button size="sm" variant="outline" onClick={scan} disabled={loading} className="h-7 text-xs">
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sun className="w-3 h-3 mr-1" />}
              {loading ? 'Escaneando...' : 'Scan Pre-Market'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {levels.length === 0 && !loading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Presiona &quot;Scan Pre-Market&quot; para obtener niveles institucionales del día.
            {session === 'PREMARKET' && ' Se ejecuta automáticamente en pre-market.'}
          </p>
        ) : loading ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Escaneando {WATCHLIST.length} tickers...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase tracking-wide">
                  <th className="px-2 py-1.5 text-left">Ticker</th>
                  <th className="px-2 py-1.5 text-right">Spot</th>
                  <th className="px-2 py-1.5 text-right">Gamma Flip</th>
                  <th className="px-2 py-1.5 text-right">vs GF</th>
                  <th className="px-2 py-1.5 text-right">Call Wall</th>
                  <th className="px-2 py-1.5 text-right">Put Wall</th>
                  <th className="px-2 py-1.5 text-right">Max Pain</th>
                  <th className="px-2 py-1.5 text-right">PCR</th>
                  <th className="px-2 py-1.5 text-left">GEX</th>
                </tr>
              </thead>
              <tbody>
                {levels.map(l => {
                  const vsGF = l.gammaFlip && l.spot ? ((l.spot - l.gammaFlip) / l.gammaFlip * 100) : null;
                  const aboveGF = vsGF != null && vsGF > 0;
                  return (
                    <tr key={l.ticker} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="px-2 py-2 font-bold text-foreground">{l.ticker}</td>
                      <td className="px-2 py-2 text-right font-mono text-foreground">${l.spot?.toFixed(2) ?? '—'}</td>
                      <td className={`px-2 py-2 text-right font-mono ${aboveGF ? 'text-emerald-400' : 'text-red-400'}`}>
                        {l.gammaFlip ? `$${l.gammaFlip.toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-2 py-2 text-right font-mono font-semibold ${aboveGF ? 'text-emerald-400' : 'text-red-400'}`}>
                        {vsGF != null ? `${vsGF > 0 ? '+' : ''}${vsGF.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-emerald-400/70">{l.callWall ? `$${l.callWall.toFixed(2)}` : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono text-red-400/70">{l.putWall ? `$${l.putWall.toFixed(2)}` : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono text-amber-400/70">{l.maxPain ? `$${l.maxPain.toFixed(2)}` : '—'}</td>
                      <td className={`px-2 py-2 text-right font-mono ${l.pcr > 1 ? 'text-red-400' : l.pcr < 0.7 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                        {l.pcr?.toFixed(2) ?? '—'}
                      </td>
                      <td className="px-2 py-2">
                        {l.gexRegime ? (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                            l.gexRegime.includes('POSITIVE') ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          }`}>
                            {l.gexRegime.includes('POSITIVE') ? 'POS' : 'NEG'}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
