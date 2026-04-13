import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

const GRADE_ORDER = ['A+', 'B+', 'B', 'C', 'N/A'];
const SIZE_ORDER = ['large', 'normal', 'small', 'N/A'];
const WINDOW_ORDER = ['all', 'daytrading', 'swing', 'probabilities', 'institutional', 'unknown'];
const CONFIDENCE_ORDER = ['exact', 'high', 'medium', 'low'];

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildMlExportRows(samples) {
  return samples
    .filter((sample) => sample?.dataset_status === 'labeled')
    .map((sample) => {
      const features = safeJsonParse(sample?.features_json, {}) || {};
      return {
        analysis_id: sample?.analysis_id || '',
        journal_entry_id: sample?.journal_entry_id || '',
        ticker: sample?.ticker || '',
        source_window: sample?.source_window || '',
        signal: sample?.signal || '',
        setup_grade: sample?.setup_grade || '',
        size_tier: sample?.size_tier || '',
        success_probability: sample?.success_probability ?? '',
        profit: sample?.profit ?? '',
        label: sample?.label ?? '',
        ...features,
      };
    });
}

function exportMlRowsAsCsv(rows) {
  if (!rows.length) return;
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const escapeCell = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ].join('\n');
  downloadTextFile(`ml-trade-dataset-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

function getDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getDateTime(date, time) {
  if (!date) return null;
  const parsed = new Date(`${date}T${time || '12:00'}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function normalizeSourceWindow(sourceWindow) {
  if (sourceWindow === 'scalp' || sourceWindow === 'intraday' || sourceWindow === 'daytrading') return 'daytrading';
  if (sourceWindow === 'probability' || sourceWindow === 'probabilities') return 'probabilities';
  if (sourceWindow === 'swing') return 'swing';
  if (sourceWindow === 'institutional') return 'institutional';
  return 'unknown';
}

function getAnalysisSnapshot(analysis) {
  const parsed = typeof analysis?.analysis_data === 'string'
    ? safeJsonParse(analysis.analysis_data, {})
    : (analysis?.analysis_data || {});
  const meta = parsed?.analysis_meta || {};
  const createdDate = getDateOnly(analysis?.created_date || parsed?._analysisTime || analysis?.last_updated);
  const createdTime = (() => {
    const raw = analysis?.created_date || parsed?._analysisTime || null;
    const dt = raw ? new Date(raw) : null;
    return dt && !Number.isNaN(dt.getTime()) ? dt.getTime() : null;
  })();

  return {
    id: analysis?.id,
    ticker: String(analysis?.ticker || '').toUpperCase(),
    signal: meta?.overall_signal || analysis?.signal || parsed?.signal || parsed?.scalp?.signal || parsed?.intraday?.signal || null,
    date: createdDate,
    timestamp: createdTime,
    sourceWindow: normalizeSourceWindow(meta?.source_window || analysis?.type || 'unknown'),
    setupGrade: meta?.setup_grade || parsed?.setup_grade || 'N/A',
    sizeTier: meta?.size_tier || meta?.execution_tier || parsed?.window_consensus?.size_tier || 'N/A',
    entryAlert: meta?.entry_alert || parsed?.entry_alert || null,
    summary: parsed?.summary || parsed?.analysis_summary || parsed?.scalp?.summary || parsed?.intraday?.summary || null,
    raw: parsed,
  };
}

function getMatchConfidence(entry, analysis) {
  if (!analysis) return 'low';
  if (entry?.analysis_id && analysis?.id && String(entry.analysis_id) === String(analysis.id)) return 'exact';

  const entryDate = getDateOnly(entry?.date);
  const entryDirection = entry?.direction || null;
  const entryTimestamp = getDateTime(entryDate, entry?.entry_time);
  const sameDay = entryDate && analysis.date && entryDate === analysis.date;
  const sameDirection = !entryDirection || !analysis.signal || entryDirection === analysis.signal;
  const timeDiffMinutes = entryTimestamp && analysis.timestamp
    ? Math.abs(entryTimestamp - analysis.timestamp) / 60000
    : null;

  if (sameDay && sameDirection && timeDiffMinutes != null && timeDiffMinutes <= 90) return 'high';
  if (sameDay && sameDirection) return 'medium';
  return 'low';
}

function matchEntriesToAnalyses(entries, analyses) {
  const normalizedAnalyses = analyses.map(getAnalysisSnapshot);
  const analysesById = new Map(normalizedAnalyses.map((analysis) => [String(analysis.id), analysis]));
  const usedIds = new Set();

  return entries.map((entry) => {
    if (entry?.analysis_id && analysesById.has(String(entry.analysis_id))) {
      const exactAnalysis = analysesById.get(String(entry.analysis_id));
      return {
        entry,
        analysis: exactAnalysis,
        confidence: getMatchConfidence(entry, exactAnalysis),
      };
    }

    const entryTicker = String(entry?.ticker || '').toUpperCase();
    const entryDate = getDateOnly(entry?.date);
    const entryTimestamp = getDateTime(entryDate, entry?.entry_time);
    const entryDirection = entry?.direction || null;

    const candidates = normalizedAnalyses
      .filter((analysis) => !usedIds.has(analysis.id))
      .filter((analysis) => analysis.ticker === entryTicker)
      .filter((analysis) => analysis.date === entryDate)
      .filter((analysis) => !entryDirection || !analysis.signal || analysis.signal === entryDirection)
      .sort((a, b) => {
        if (entryTimestamp && a.timestamp && b.timestamp) {
          return Math.abs(a.timestamp - entryTimestamp) - Math.abs(b.timestamp - entryTimestamp);
        }
        return (b.timestamp || 0) - (a.timestamp || 0);
      });

    const matchedAnalysis = candidates[0] || null;
    if (matchedAnalysis?.id) usedIds.add(matchedAnalysis.id);

    return {
      entry,
      analysis: matchedAnalysis,
      confidence: getMatchConfidence(entry, matchedAnalysis),
    };
  });
}

function buildBucketStats(rows, keyName) {
  const buckets = rows.reduce((acc, row) => {
    const key = row?.analysis?.[keyName] || 'N/A';
    if (!acc[key]) acc[key] = { key, trades: 0, wins: 0, pnl: 0 };
    acc[key].trades += 1;
    if ((row.entry?.pnl || 0) > 0) acc[key].wins += 1;
    acc[key].pnl += Number(row.entry?.pnl || 0);
    return acc;
  }, {});

  return Object.values(buckets).map((bucket) => ({
    ...bucket,
    winRate: bucket.trades > 0 ? (bucket.wins / bucket.trades) * 100 : 0,
  }));
}

function getGradeBadgeClass(grade) {
  if (grade === 'A+') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (grade === 'B+') return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
  if (grade === 'B') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (grade === 'C') return 'bg-red-500/15 text-red-300 border-red-500/30';
  return 'bg-muted text-muted-foreground border-border/50';
}

function getSizeLabel(sizeTier) {
  if (sizeTier === 'large') return 'Grande';
  if (sizeTier === 'normal') return 'Normal';
  if (sizeTier === 'small') return 'Bajo';
  return 'N/A';
}

function getWindowLabel(sourceWindow) {
  if (sourceWindow === 'daytrading' || sourceWindow === 'scalp' || sourceWindow === 'intraday') return 'DayTrading';
  if (sourceWindow === 'swing') return 'Swing';
  if (sourceWindow === 'probabilities' || sourceWindow === 'probability') return 'Probabilities';
  if (sourceWindow === 'institutional') return 'Institutional';
  return 'Sin ventana';
}

function getWindowBadgeClass(sourceWindow) {
  if (sourceWindow === 'daytrading' || sourceWindow === 'scalp' || sourceWindow === 'intraday') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
  if (sourceWindow === 'swing') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (sourceWindow === 'probabilities' || sourceWindow === 'probability') return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
  if (sourceWindow === 'institutional') return 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300';
  return 'border-border/60 bg-background/40 text-foreground';
}

function getConfidenceLabel(confidence) {
  if (confidence === 'exact') return 'Exacta';
  if (confidence === 'high') return 'Alta';
  if (confidence === 'medium') return 'Media';
  return 'Baja';
}

function getConfidenceBadgeClass(confidence) {
  if (confidence === 'exact') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (confidence === 'high') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (confidence === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-red-500/30 bg-red-500/10 text-red-300';
}

function buildThresholdSweep(entries, thresholds = []) {
  return thresholds.map((threshold) => {
    const tagged = entries.filter((entry) => Number.isFinite(Number(entry?.ml_probability)));
    const kept = tagged.filter((entry) => Number(entry.ml_probability) >= threshold);
    const defensive = tagged.filter((entry) => Number(entry.ml_probability) < threshold);
    const keptWins = kept.filter((entry) => Number(entry?.pnl || 0) > 0).length;
    const defensiveWins = defensive.filter((entry) => Number(entry?.pnl || 0) > 0).length;
    const keptPnl = kept.reduce((sum, entry) => sum + Number(entry?.pnl || 0), 0);
    const defensivePnl = defensive.reduce((sum, entry) => sum + Number(entry?.pnl || 0), 0);
    return {
      threshold,
      taggedTrades: tagged.length,
      keptTrades: kept.length,
      defensiveTrades: defensive.length,
      keptWinRate: kept.length ? (keptWins / kept.length) * 100 : 0,
      defensiveWinRate: defensive.length ? (defensiveWins / defensive.length) * 100 : 0,
      keptPnl,
      defensivePnl,
    };
  });
}

export default function JournalStats({ entries, analyses, mlSamples = [], initialCapital }) {
  const [windowFilter, setWindowFilter] = React.useState('all');
  const [confidenceFilter, setConfidenceFilter] = React.useState('all');
  const [gradeFilter, setGradeFilter] = React.useState('all');
  const [resultFilter, setResultFilter] = React.useState('all');
  const [selectedMatch, setSelectedMatch] = React.useState(null);
  const totalPnL = entries.reduce((sum, e) => sum + (e.pnl || 0), 0);
  const wins = entries.filter(e => (e.pnl || 0) > 0).length;
  const losses = entries.filter(e => (e.pnl || 0) < 0).length;
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const growthPct = initialCapital > 0 ? (totalPnL / initialCapital) * 100 : 0;
  const totalCapital = initialCapital + totalPnL;
  const matchedRows = matchEntriesToAnalyses(entries, analyses).filter((row) => row.analysis);
  const filteredMatchedRows = matchedRows.filter((row) => windowFilter === 'all' || row.analysis?.sourceWindow === windowFilter);
  const matchedTrades = matchedRows.length;
  const matchedRate = totalTrades > 0 ? (matchedTrades / totalTrades) * 100 : 0;
  const gradeStats = buildBucketStats(filteredMatchedRows, 'setupGrade').sort((a, b) => GRADE_ORDER.indexOf(a.key) - GRADE_ORDER.indexOf(b.key));
  const sizeStats = buildBucketStats(filteredMatchedRows, 'sizeTier').sort((a, b) => SIZE_ORDER.indexOf(a.key) - SIZE_ORDER.indexOf(b.key));
  const windowStats = buildBucketStats(matchedRows, 'sourceWindow').sort((a, b) => WINDOW_ORDER.indexOf(a.key) - WINDOW_ORDER.indexOf(b.key));
  const tableRows = filteredMatchedRows
    .filter((row) => confidenceFilter === 'all' || row.confidence === confidenceFilter)
    .filter((row) => gradeFilter === 'all' || row.analysis?.setupGrade === gradeFilter)
    .filter((row) => resultFilter === 'all' || row.entry?.result === resultFilter);
  const confidenceStats = buildBucketStats(matchedRows.map((row) => ({ ...row, analysis: { ...row.analysis, confidence_bucket: row.confidence } })), 'confidence_bucket')
    .sort((a, b) => CONFIDENCE_ORDER.indexOf(a.key) - CONFIDENCE_ORDER.indexOf(b.key));
  const labeledSamples = mlSamples.filter((sample) => sample?.dataset_status === 'labeled');
  const pendingSamples = mlSamples.filter((sample) => sample?.dataset_status === 'pending_outcome');
  const mlExportRows = buildMlExportRows(mlSamples);
  const mlTaggedEntries = entries.filter((entry) => typeof entry?.ml_pass_filter === 'boolean');
  const mlPassEntries = mlTaggedEntries.filter((entry) => entry.ml_pass_filter === true);
  const mlDefensiveEntries = mlTaggedEntries.filter((entry) => entry.ml_pass_filter === false);
  const mlPassWinRate = mlPassEntries.length
    ? (mlPassEntries.filter((entry) => Number(entry.pnl || 0) > 0).length / mlPassEntries.length) * 100
    : 0;
  const mlDefensiveWinRate = mlDefensiveEntries.length
    ? (mlDefensiveEntries.filter((entry) => Number(entry.pnl || 0) > 0).length / mlDefensiveEntries.length) * 100
    : 0;
  const thresholdSweep = buildThresholdSweep(entries, [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85]);
  const mlWinRate = labeledSamples.length > 0
    ? (labeledSamples.filter((sample) => Number(sample?.label) === 1).length / labeledSamples.length) * 100
    : 0;
  const mlReadiness = labeledSamples.length >= 500 ? 'Listo para primer modelo' : labeledSamples.length >= 100 ? 'Aún en acumulación' : 'Muy temprano';
  const recentMatches = tableRows
    .slice()
    .sort((a, b) => getDateTime(getDateOnly(b.entry?.date), b.entry?.entry_time) - getDateTime(getDateOnly(a.entry?.date), a.entry?.entry_time))
    .slice(0, 12);

  const stats = [
    { label: 'Capital Inicial', value: `$${initialCapital.toLocaleString()}`, color: 'text-foreground' },
    { label: 'Ganancias Totales', value: `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString()}`, color: totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Crecimiento', value: `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(2)}%`, color: growthPct >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Capital Total', value: `$${totalCapital.toLocaleString()}`, color: 'text-primary' },
    { label: 'Win Rate', value: `${winRate.toFixed(1)}%`, color: winRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Trades con Setup', value: `${matchedTrades}/${totalTrades || 0} (${matchedRate.toFixed(0)}%)`, color: matchedTrades > 0 ? 'text-sky-300' : 'text-muted-foreground' },
    { label: 'Samples ML', value: `${labeledSamples.length} etiquetados / ${pendingSamples.length} pendientes`, color: labeledSamples.length >= 100 ? 'text-emerald-300' : 'text-amber-300' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((stat, idx) => (
          <Card key={idx} className="bg-card border-border/50">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">{stat.label}</p>
              <p className={`text-lg font-bold font-mono ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-sm">ML Readiness</CardTitle>
              <CardDescription>
                Dataset automático para filtrar setups, clasificar trades y estimar probabilidad con tus señales actuales.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-border/60 bg-background/40"
                disabled={!mlExportRows.length}
                onClick={() => downloadTextFile(`ml-trade-dataset-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(mlExportRows, null, 2), 'application/json;charset=utf-8')}
              >
                Exportar JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-border/60 bg-background/40"
                disabled={!mlExportRows.length}
                onClick={() => exportMlRowsAsCsv(mlExportRows)}
              >
                Exportar CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-[10px] text-muted-foreground">Estado</p>
            <p className="mt-1 font-semibold text-foreground">{mlReadiness}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-[10px] text-muted-foreground">Etiquetados</p>
            <p className="mt-1 font-semibold text-foreground">{labeledSamples.length}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-[10px] text-muted-foreground">Pendientes</p>
            <p className="mt-1 font-semibold text-foreground">{pendingSamples.length}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-[10px] text-muted-foreground">Win Rate Dataset</p>
            <p className={`mt-1 font-semibold ${mlWinRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{mlWinRate.toFixed(1)}%</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Impacto del Filtro ML</CardTitle>
          <CardDescription>
            Compara resultados reales entre entradas que pasaron el filtro ML y entradas en modo defensivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-[10px] text-muted-foreground">Trades con Tag ML</p>
            <p className="mt-1 font-semibold text-foreground">{mlTaggedEntries.length}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-[10px] text-muted-foreground">PASS (WR)</p>
            <p className="mt-1 font-semibold text-emerald-300">{mlPassEntries.length} | {mlPassWinRate.toFixed(1)}%</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <p className="text-[10px] text-muted-foreground">DEFENSIVO (WR)</p>
            <p className="mt-1 font-semibold text-amber-300">{mlDefensiveEntries.length} | {mlDefensiveWinRate.toFixed(1)}%</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Calibración de Threshold ML</CardTitle>
          <CardDescription>
            Simulación rápida para elegir el umbral con tus trades históricos etiquetados con ml_probability.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Tagged</TableHead>
                  <TableHead>PASS</TableHead>
                  <TableHead>WR PASS</TableHead>
                  <TableHead>PnL PASS</TableHead>
                  <TableHead>DEF</TableHead>
                  <TableHead>WR DEF</TableHead>
                  <TableHead>PnL DEF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {thresholdSweep.map((row) => (
                  <TableRow key={row.threshold}>
                    <TableCell className="font-mono">{row.threshold.toFixed(2)}</TableCell>
                    <TableCell>{row.taggedTrades}</TableCell>
                    <TableCell>{row.keptTrades}</TableCell>
                    <TableCell className={row.keptWinRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{row.keptWinRate.toFixed(1)}%</TableCell>
                    <TableCell className={row.keptPnl >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                      {row.keptPnl >= 0 ? '+' : ''}${row.keptPnl.toFixed(2)}
                    </TableCell>
                    <TableCell>{row.defensiveTrades}</TableCell>
                    <TableCell className={row.defensiveWinRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{row.defensiveWinRate.toFixed(1)}%</TableCell>
                    <TableCell className={row.defensivePnl >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                      {row.defensivePnl >= 0 ? '+' : ''}${row.defensivePnl.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            PASS = trades con ml_probability ≥ threshold. DEF = trades por debajo del threshold.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Rendimiento por Setup</CardTitle>
            <CardDescription>
              Win rate y PnL del journal agrupados por la calidad guardada en analysis_meta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {gradeStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay suficientes coincidencias entre journal y análisis guardados.</p>
            ) : gradeStats.map((bucket) => (
              <div key={bucket.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={getGradeBadgeClass(bucket.key)}>{bucket.key}</Badge>
                  <span className="text-sm text-foreground">{bucket.trades} trade(s)</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">{bucket.winRate.toFixed(1)}% WR</div>
                  <div className={`text-xs font-mono ${bucket.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {bucket.pnl >= 0 ? '+' : ''}${bucket.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Rendimiento por Tamaño Sugerido</CardTitle>
            <CardDescription>
              Mide si el tamaño recomendado por consenso se está traduciendo en mejores resultados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sizeStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay operaciones suficientes para evaluar large, normal o small.</p>
            ) : sizeStats.map((bucket) => (
              <div key={bucket.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-border/60 bg-background/40 text-foreground">{getSizeLabel(bucket.key)}</Badge>
                  <span className="text-sm text-foreground">{bucket.trades} trade(s)</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">{bucket.winRate.toFixed(1)}% WR</div>
                  <div className={`text-xs font-mono ${bucket.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {bucket.pnl >= 0 ? '+' : ''}${bucket.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Rendimiento por Ventana</CardTitle>
            <CardDescription>
              Compara resultados del journal según la ventana que originó el análisis guardado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {windowStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay trades emparejados con una ventana analítica identificable.</p>
            ) : windowStats.map((bucket) => (
              <div key={bucket.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={getWindowBadgeClass(bucket.key)}>{getWindowLabel(bucket.key)}</Badge>
                  <span className="text-sm text-foreground">{bucket.trades} trade(s)</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">{bucket.winRate.toFixed(1)}% WR</div>
                  <div className={`text-xs font-mono ${bucket.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {bucket.pnl >= 0 ? '+' : ''}${bucket.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Confianza del Matching</CardTitle>
            <CardDescription>
              Diferencia entre vínculos explícitos, matches horarios fuertes y heurísticos más débiles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {confidenceStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay matches para evaluar la calidad del vínculo.</p>
            ) : confidenceStats.map((bucket) => (
              <div key={bucket.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={getConfidenceBadgeClass(bucket.key)}>{getConfidenceLabel(bucket.key)}</Badge>
                  <span className="text-sm text-foreground">{bucket.trades} trade(s)</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">{bucket.winRate.toFixed(1)}% WR</div>
                  <div className={`text-xs font-mono ${bucket.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {bucket.pnl >= 0 ? '+' : ''}${bucket.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50 xl:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3">
              <div>
                <CardTitle className="text-sm">Trades Emparejados</CardTitle>
                <CardDescription>
                  Auditoría rápida del match entre JournalEntry y Analysis usando fecha, ticker, dirección y cercanía horaria.
                </CardDescription>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <div>
                <Select value={windowFilter} onValueChange={setWindowFilter}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Filtrar ventana" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las ventanas</SelectItem>
                    <SelectItem value="daytrading">DayTrading</SelectItem>
                    <SelectItem value="swing">Swing</SelectItem>
                    <SelectItem value="probabilities">Probabilities</SelectItem>
                    <SelectItem value="institutional">Institutional</SelectItem>
                    <SelectItem value="unknown">Sin ventana</SelectItem>
                  </SelectContent>
                </Select>
                </div>
                <div>
                <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Filtrar match" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los matches</SelectItem>
                    <SelectItem value="exact">Exacta</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="low">Baja</SelectItem>
                  </SelectContent>
                </Select>
                </div>
                <div>
                <Select value={gradeFilter} onValueChange={setGradeFilter}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Filtrar setup" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los setups</SelectItem>
                    <SelectItem value="A+">A+</SelectItem>
                    <SelectItem value="B+">B+</SelectItem>
                    <SelectItem value="B">B</SelectItem>
                    <SelectItem value="C">C</SelectItem>
                    <SelectItem value="N/A">N/A</SelectItem>
                  </SelectContent>
                </Select>
                </div>
                <div>
                <Select value={resultFilter} onValueChange={setResultFilter}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Filtrar resultado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Wins y losses</SelectItem>
                    <SelectItem value="win">Solo wins</SelectItem>
                    <SelectItem value="loss">Solo losses</SelectItem>
                  </SelectContent>
                </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {recentMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay matches para el filtro seleccionado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Ventana</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead>Setup</TableHead>
                    <TableHead>Tamaño</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-right">Detalle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentMatches.map((row, idx) => (
                    <TableRow key={`${row.entry?.id || row.analysis?.id || idx}-${idx}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.entry?.date || 'N/A'}</TableCell>
                      <TableCell className="font-semibold">{row.entry?.ticker || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getWindowBadgeClass(row.analysis?.sourceWindow)}>
                          {getWindowLabel(row.analysis?.sourceWindow)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getConfidenceBadgeClass(row.confidence)}>
                          {getConfidenceLabel(row.confidence)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-border/60 bg-background/40 text-foreground">
                          {row.entry?.direction || row.analysis?.signal || 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline" className={getGradeBadgeClass(row.analysis?.setupGrade)}>{row.analysis?.setupGrade || 'N/A'}</Badge>
                          {row.analysis?.entryAlert ? (
                            <p className="max-w-[280px] text-[11px] leading-4 text-amber-300">{row.analysis.entryAlert}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-foreground">{getSizeLabel(row.analysis?.sizeTier)}</TableCell>
                      <TableCell className={`text-right font-mono ${Number(row.entry?.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {Number(row.entry?.pnl || 0) >= 0 ? '+' : ''}${Number(row.entry?.pnl || 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" className="border-border/60 bg-background/40" onClick={() => setSelectedMatch(row)}>
                          Ver análisis
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(selectedMatch)} onOpenChange={(open) => { if (!open) setSelectedMatch(null); }}>
        <DialogContent className="max-w-4xl border-border bg-card">
          <DialogHeader>
            <DialogTitle>
              {selectedMatch?.entry?.ticker || 'Trade'} | {selectedMatch?.entry?.date || 'N/A'}
            </DialogTitle>
            <DialogDescription>
              Revisión del análisis emparejado para validar contexto, alerta y consistencia del matching.
            </DialogDescription>
          </DialogHeader>

          {selectedMatch ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={getWindowBadgeClass(selectedMatch.analysis?.sourceWindow)}>
                  {getWindowLabel(selectedMatch.analysis?.sourceWindow)}
                </Badge>
                <Badge variant="outline" className={getConfidenceBadgeClass(selectedMatch.confidence)}>
                  Match {getConfidenceLabel(selectedMatch.confidence)}
                </Badge>
                <Badge variant="outline" className={getGradeBadgeClass(selectedMatch.analysis?.setupGrade)}>
                  Setup {selectedMatch.analysis?.setupGrade || 'N/A'}
                </Badge>
                <Badge variant="outline" className="border-border/60 bg-background/40 text-foreground">
                  Tamaño {getSizeLabel(selectedMatch.analysis?.sizeTier)}
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-[10px] text-muted-foreground">Dirección</p>
                  <p className="mt-1 font-semibold">{selectedMatch.entry?.direction || selectedMatch.analysis?.signal || 'N/A'}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-[10px] text-muted-foreground">Hora entrada</p>
                  <p className="mt-1 font-semibold">{selectedMatch.entry?.entry_time || 'N/A'}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-[10px] text-muted-foreground">P&L</p>
                  <p className={`mt-1 font-semibold ${Number(selectedMatch.entry?.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {Number(selectedMatch.entry?.pnl || 0) >= 0 ? '+' : ''}${Number(selectedMatch.entry?.pnl || 0).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-[10px] text-muted-foreground">Análisis guardado</p>
                  <p className="mt-1 font-semibold">{selectedMatch.analysis?.date || 'N/A'}</p>
                </div>
              </div>

              {selectedMatch.analysis?.entryAlert ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-xs font-semibold text-amber-300">Alerta del análisis</p>
                  <p className="mt-1 text-sm text-amber-100/90">{selectedMatch.analysis.entryAlert}</p>
                </div>
              ) : null}

              {selectedMatch.analysis?.summary ? (
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-xs font-semibold text-foreground">Resumen operativo</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedMatch.analysis.summary}</p>
                </div>
              ) : null}

              <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                <p className="text-xs font-semibold text-foreground">analysis_data</p>
                <ScrollArea className="mt-2 h-[360px] w-full rounded-md border border-border/50 bg-background/60">
                  <pre className="p-4 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                    {JSON.stringify(selectedMatch.analysis?.raw || {}, null, 2)}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}