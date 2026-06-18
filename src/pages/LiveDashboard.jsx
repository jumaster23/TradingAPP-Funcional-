/**
 * LiveDashboard — Panel unificado de señales en vivo
 * Tabs: Consenso | ORB (Live2) | Scalp (Live3) | Smart Money (Live4)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Activity, TrendingUp, TrendingDown, Zap, Clock, RefreshCw, Shield } from 'lucide-react';

import { useMarketContext } from '@/lib/MarketContextProvider';
import { multiTickerScan } from '@/lib/signalAggregator';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import Live2 from './Live2';
import Live3 from './Live3';
import Live4 from './Live4';

// ── Constantes ──
const TICKERS = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'META', 'AMD', 'TSLA', 'GOOGL'];
const SCAN_INTERVAL_MS = 60_000; // 60 segundos

// ── Helpers ──
function isMarketOpen() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = et.getDay();
  const m = et.getHours() * 60 + et.getMinutes();
  return d > 0 && d < 6 && m >= 570 && m < 960;
}

function getSessionLabel(sessionKey) {
  const map = {
    PREMARKET: 'Pre-Market',
    MORNING_KZ: 'Morning KZ',
    MIDDAY: 'Mediodía',
    POWER_HOUR: 'Power Hour',
    CLOSE: 'Cierre',
    AFTERHOURS: 'After Hours',
    CLOSED: 'Cerrado',
  };
  return map[sessionKey] || sessionKey;
}

// ── Colores por grade ──
function gradeColor(grade) {
  if (grade === 'A+') return 'text-emerald-400';
  if (grade === 'A') return 'text-cyan-400';
  if (grade === 'B') return 'text-amber-400';
  return 'text-red-400';
}

function gradeBg(grade) {
  if (grade === 'A+') return 'bg-emerald-500/15 border-emerald-500/30';
  if (grade === 'A') return 'bg-cyan-500/15 border-cyan-500/30';
  if (grade === 'B') return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-red-500/15 border-red-500/30';
}

function directionIcon(consensus) {
  if (consensus === 'CALL') return <TrendingUp className="h-4 w-4 text-emerald-400" />;
  if (consensus === 'PUT') return <TrendingDown className="h-4 w-4 text-red-400" />;
  return <Activity className="h-4 w-4 text-muted-foreground" />;
}

function directionText(consensus) {
  if (consensus === 'CALL') return <span className="font-bold text-emerald-400">CALL ↑</span>;
  if (consensus === 'PUT') return <span className="font-bold text-red-400">PUT ↓</span>;
  return <span className="text-muted-foreground">NEUTRO</span>;
}

function biasColor(bias) {
  if (!bias) return 'text-muted-foreground';
  if (bias.includes('BULLISH')) return 'text-emerald-400';
  if (bias.includes('BEARISH')) return 'text-red-400';
  return 'text-amber-400';
}

function vixRegimeColor(regime) {
  if (!regime) return 'text-muted-foreground';
  if (regime === 'LOW') return 'text-emerald-400';
  if (regime === 'NORMAL') return 'text-sky-400';
  if (regime === 'ELEVATED') return 'text-amber-400';
  if (regime === 'HIGH') return 'text-orange-400';
  if (regime === 'EXTREME') return 'text-red-500';
  return 'text-muted-foreground';
}

function vixRegimeLabel(regime) {
  const map = {
    LOW: 'Bajo',
    NORMAL: 'Normal',
    ELEVATED: 'Elevado',
    HIGH: 'Alto',
    EXTREME: 'Extremo',
  };
  return map[regime] || regime;
}

function biasLabel(bias) {
  const map = {
    BULLISH: 'Alcista',
    LEAN_BULLISH: 'Ligeramente Alcista',
    LEAN_BEARISH: 'Ligeramente Bajista',
    BEARISH: 'Bajista',
    NEUTRAL: 'Neutral',
  };
  return map[bias] || bias;
}

// ── Barra de contexto de mercado ──
function MarketContextBar({ ctx, session }) {
  if (!ctx) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Cargando contexto de mercado...
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3 items-center text-xs">
      {/* SPY */}
      <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
        <span className="text-muted-foreground">SPY</span>
        <span className="font-mono font-semibold text-foreground">
          ${ctx.spy?.price?.toFixed(2) ?? '—'}
        </span>
        {ctx.spy?.changePct != null && (
          <span className={ctx.spy.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {ctx.spy.changePct >= 0 ? '+' : ''}{ctx.spy.changePct.toFixed(2)}%
          </span>
        )}
      </div>

      {/* VIX */}
      <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
        <Shield className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">VIX</span>
        <span className="font-mono font-semibold text-foreground">
          {ctx.vix?.value?.toFixed(2) ?? '—'}
        </span>
        {ctx.vix?.regime && (
          <span className={vixRegimeColor(ctx.vix.regime)}>
            {vixRegimeLabel(ctx.vix.regime)}
          </span>
        )}
      </div>

      {/* Breadth */}
      {ctx.breadth && (
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
          <Activity className="h-3 w-3 text-muted-foreground" />
          <span className="text-emerald-400">{ctx.breadth.green}↑</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-red-400">{ctx.breadth.red}↓</span>
          <span className="text-muted-foreground">sectores</span>
        </div>
      )}

      {/* Sesión */}
      <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="text-foreground font-medium">{getSessionLabel(session)}</span>
      </div>

      {/* Bias general */}
      {ctx.bias && (
        <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
          <Zap className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Sesgo:</span>
          <span className={`font-semibold ${biasColor(ctx.bias)}`}>
            {biasLabel(ctx.bias)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Fila de resultado por ticker ──
function TickerRow({ result }) {
  const { ticker, consensus, confidence, grade, signals = {}, entry, sl, tp, action } = result;
  const activeEngines = Object.values(signals).filter(
    s => s && s.direction && s.direction !== 'NEUTRAL'
  );
  const engineNames = { smartMoney: 'Smart Money', scalp: 'Scalp', orb: 'ORB' };

  return (
    <tr className="border-b border-border/40 hover:bg-muted/30 transition-colors">
      {/* Ticker */}
      <td className="px-3 py-2.5 font-mono font-bold text-sm text-foreground whitespace-nowrap">
        {ticker}
      </td>

      {/* Dirección */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {directionIcon(consensus)}
          {directionText(consensus)}
        </div>
      </td>

      {/* Confianza */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-16 bg-muted rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                confidence >= 75 ? 'bg-emerald-500' :
                confidence >= 60 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, confidence)}%` }}
            />
          </div>
          <span className="font-mono text-xs text-muted-foreground w-8">{confidence}%</span>
        </div>
      </td>

      {/* Grade */}
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-bold border ${gradeBg(grade)} ${gradeColor(grade)}`}>
          {grade}
        </span>
      </td>

      {/* Engines activos */}
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {activeEngines.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            Object.entries(signals).map(([key, sig]) => {
              if (!sig || sig.direction === 'NEUTRAL') return null;
              const isBull = sig.direction === 'CALL';
              return (
                <span
                  key={key}
                  className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
                    isBull
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}
                >
                  {engineNames[key] || key}
                </span>
              );
            })
          )}
        </div>
      </td>

      {/* Entry / SL / TP */}
      <td className="px-3 py-2.5">
        {entry ? (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-foreground">${entry.toFixed(2)}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-red-400">{sl ? `$${sl.toFixed(2)}` : '—'}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-emerald-400">{tp ? `$${tp.toFixed(2)}` : '—'}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Sin entrada</span>
        )}
      </td>

      {/* Acción */}
      <td className="px-3 py-2.5 max-w-[180px]">
        <span className={`text-xs truncate block ${
          action?.startsWith('ENTER') ? 'text-emerald-400 font-semibold' :
          action?.startsWith('LEAN') ? 'text-amber-400' :
          'text-muted-foreground'
        }`}>
          {action || '—'}
        </span>
      </td>
    </tr>
  );
}

// ── Tabla de escaneo multi-ticker ──
function ConsensusScanTable({ results, scanning }) {
  if (scanning) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <RefreshCw className="h-8 w-8 text-muted-foreground animate-spin" />
        <p className="text-muted-foreground text-sm">Escaneando {TICKERS.length} tickers...</p>
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Activity className="h-8 w-8 text-muted-foreground" />
        <p className="text-muted-foreground text-sm">Sin resultados. Presiona "Escanear Ahora".</p>
      </div>
    );
  }

  const actionable = results.filter(r => r.grade === 'A+' || r.grade === 'A');
  const neutral = results.filter(r => r.grade !== 'A+' && r.grade !== 'A');

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
            <th className="px-3 py-2 text-left">Ticker</th>
            <th className="px-3 py-2 text-left">Dirección</th>
            <th className="px-3 py-2 text-left">Confianza</th>
            <th className="px-3 py-2 text-left">Grade</th>
            <th className="px-3 py-2 text-left">Engines</th>
            <th className="px-3 py-2 text-left">Entrada / SL / TP</th>
            <th className="px-3 py-2 text-left">Acción</th>
          </tr>
        </thead>
        <tbody>
          {/* Señales accionables primero */}
          {actionable.map(r => (
            <TickerRow key={r.ticker} result={r} />
          ))}
          {/* Divisor */}
          {actionable.length > 0 && neutral.length > 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-1">
                <div className="border-t border-dashed border-border/40 mt-1" />
              </td>
            </tr>
          )}
          {/* Resto */}
          {neutral.map(r => (
            <TickerRow key={r.ticker} result={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Resumen de oportunidades ──
function OpportunitySummary({ results }) {
  if (!results || results.length === 0) return null;

  const aplusCalls = results.filter(r => r.grade === 'A+' && r.consensus === 'CALL').length;
  const aplusPuts = results.filter(r => r.grade === 'A+' && r.consensus === 'PUT').length;
  const aGrade = results.filter(r => r.grade === 'A').length;
  const topConfidence = results[0]?.confidence ?? 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card className="bg-emerald-500/10 border-emerald-500/20">
        <CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-emerald-400">{aplusCalls}</p>
          <p className="text-xs text-muted-foreground mt-0.5">A+ CALL</p>
        </CardContent>
      </Card>
      <Card className="bg-red-500/10 border-red-500/20">
        <CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-red-400">{aplusPuts}</p>
          <p className="text-xs text-muted-foreground mt-0.5">A+ PUT</p>
        </CardContent>
      </Card>
      <Card className="bg-cyan-500/10 border-cyan-500/20">
        <CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-cyan-400">{aGrade}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Señales A</p>
        </CardContent>
      </Card>
      <Card className="bg-card border-border">
        <CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{topConfidence}%</p>
          <p className="text-xs text-muted-foreground mt-0.5">Mejor confianza</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════
//  COMPONENTE PRINCIPAL
// ═══════════════════════════════════════
export default function LiveDashboard() {
  const marketCtx = useMarketContext();
  const { session, isLoading: ctxLoading, lastUpdate: ctxUpdate } = marketCtx;

  const [activeTab, setActiveTab] = useState('consensus');
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [etTime, setEtTime] = useState('');
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  // Reloj ET
  useEffect(() => {
    const tick = () => {
      const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      setEtTime(et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCountdown(prev => Math.max(0, prev - 1));
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  // Escaneo principal
  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const results = await multiTickerScan(TICKERS, marketCtx || {});
      setScanResults(results);
      setLastScan(new Date().toLocaleTimeString());
      setCountdown(SCAN_INTERVAL_MS / 1000);
    } catch (err) {
      console.error('[LiveDashboard] Scan error:', err);
    } finally {
      setScanning(false);
    }
  }, [marketCtx, scanning]);

  // Auto-scan cada 60s solo en horario de mercado
  useEffect(() => {
    // Escaneo inicial
    runScan();

    intervalRef.current = setInterval(() => {
      if (isMarketOpen()) runScan();
    }, SCAN_INTERVAL_MS);

    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionLabel = getSessionLabel(session);
  const open = isMarketOpen();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Zap className="h-6 w-6 text-amber-400" />
              Panel en Vivo
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Motores ORB · Scalp · Smart Money — consenso en tiempo real
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Reloj ET */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-border rounded-md px-3 py-1.5">
              <Clock className="h-3 w-3" />
              <span className="font-mono">{etTime} ET</span>
              <span className={`ml-1 rounded-full w-2 h-2 inline-block ${open ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
              <span>{sessionLabel}</span>
            </div>

            {/* Botón escanear */}
            <Button
              size="sm"
              variant={scanning ? 'secondary' : 'default'}
              disabled={scanning}
              onClick={runScan}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Escaneando...' : `Escanear Ahora${countdown > 0 ? ` (${countdown}s)` : ''}`}
            </Button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid grid-cols-4 w-full sm:w-auto sm:inline-flex">
            <TabsTrigger value="consensus" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Consenso</span>
              <span className="sm:hidden">Consens.</span>
            </TabsTrigger>
            <TabsTrigger value="live2" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">ORB (Live2)</span>
              <span className="sm:hidden">ORB</span>
            </TabsTrigger>
            <TabsTrigger value="live3" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Scalp (Live3)</span>
              <span className="sm:hidden">Scalp</span>
            </TabsTrigger>
            <TabsTrigger value="live4" className="gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Smart Money (Live4)</span>
              <span className="sm:hidden">Smart $</span>
            </TabsTrigger>
          </TabsList>

          {/* ══ TAB: CONSENSO ══ */}
          <TabsContent value="consensus" className="space-y-4 mt-0">

            {/* Barra de contexto */}
            <Card className="border-border/50">
              <CardContent className="py-3 px-4">
                <MarketContextBar ctx={marketCtx} session={session} />
                {ctxUpdate && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Contexto actualizado: {ctxUpdate}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Resumen de oportunidades */}
            {scanResults.length > 0 && (
              <OpportunitySummary results={scanResults} />
            )}

            {/* Tabla principal */}
            <Card className="border-border/50">
              <CardHeader className="pb-3 px-4 pt-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    Escaneo Multi-Ticker
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      ({TICKERS.length} tickers)
                    </span>
                  </CardTitle>
                  {lastScan && (
                    <span className="text-xs text-muted-foreground">
                      Último escaneo: {lastScan}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <ConsensusScanTable results={scanResults} scanning={scanning} />
              </CardContent>
            </Card>

            {/* Leyenda de grades */}
            <Card className="border-border/50">
              <CardContent className="py-3 px-4">
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold text-emerald-400`}>A+</span>
                    <span>Señal fuerte — alta confianza, engines alineados</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold text-cyan-400`}>A</span>
                    <span>Señal buena — múltiples confirmaciones</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold text-amber-400`}>B</span>
                    <span>Señal moderada — esperar confirmación</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold text-red-400`}>C</span>
                    <span>Señal débil — no operar</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Aviso mercado cerrado */}
            {!open && (
              <Card className="border-amber-500/30 bg-amber-500/10">
                <CardContent className="py-3 px-4 flex items-center gap-2 text-sm text-amber-400">
                  <Clock className="h-4 w-4 shrink-0" />
                  Mercado cerrado — el auto-escaneo se activa en horario regular (9:30–16:00 ET)
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ══ TAB: ORB (Live2) ══ */}
          <TabsContent value="live2" className="mt-0">
            <Live2 />
          </TabsContent>

          {/* ══ TAB: SCALP (Live3) ══ */}
          <TabsContent value="live3" className="mt-0">
            <Live3 />
          </TabsContent>

          {/* ══ TAB: SMART MONEY (Live4) ══ */}
          <TabsContent value="live4" className="mt-0">
            <Live4 />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
