import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save } from 'lucide-react';
import { format } from 'date-fns';

const defaultEntry = {
  date: format(new Date(), 'yyyy-MM-dd'),
  ticker: '', direction: 'CALL', entry_price: '', stop_loss: '', take_profit: '',
  pnl: '', entry_time: '', exit_time: '', notes: '', analysis_id: '',
};

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeSourceWindow(sourceWindow) {
  if (sourceWindow === 'scalp' || sourceWindow === 'intraday' || sourceWindow === 'daytrading') return 'daytrading';
  if (sourceWindow === 'probability' || sourceWindow === 'probabilities') return 'probabilities';
  if (sourceWindow === 'swing') return 'swing';
  if (sourceWindow === 'institutional') return 'institutional';
  return 'unknown';
}

function getWindowLabel(sourceWindow) {
  if (sourceWindow === 'daytrading') return 'DayTrading';
  if (sourceWindow === 'swing') return 'Swing';
  if (sourceWindow === 'probabilities') return 'Probabilities';
  if (sourceWindow === 'institutional') return 'Institutional';
  return 'Sin ventana';
}

function toAnalysisOption(analysis) {
  const parsed = typeof analysis?.analysis_data === 'string'
    ? safeJsonParse(analysis.analysis_data, {})
    : (analysis?.analysis_data || {});
  const meta = parsed?.analysis_meta || {};
  return {
    id: analysis?.id,
    ticker: String(analysis?.ticker || '').toUpperCase(),
    signal: meta?.overall_signal || analysis?.signal || parsed?.signal || parsed?.scalp?.signal || parsed?.intraday?.signal || 'N/A',
    setupGrade: meta?.setup_grade || parsed?.setup_grade || 'N/A',
    mlProbability: typeof parsed?.ml?.ml_probability === 'number' ? parsed.ml.ml_probability : (typeof meta?.ml_probability === 'number' ? meta.ml_probability : null),
    mlPassFilter: typeof parsed?.ml?.pass_filter === 'boolean' ? parsed.ml.pass_filter : (typeof meta?.ml_pass_filter === 'boolean' ? meta.ml_pass_filter : null),
    sourceWindow: normalizeSourceWindow(meta?.source_window || analysis?.type || 'unknown'),
    date: getDateOnly(analysis?.created_date || parsed?._analysisTime || analysis?.last_updated),
  };
}

export default function TradeEntryForm({ analyses = [], onSave, isSaving }) {
  const [form, setForm] = useState(defaultEntry);

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const analysisOptions = analyses
    .map(toAnalysisOption)
    .filter((analysis) => {
      if (form.ticker && analysis.ticker !== form.ticker) return false;
      if (form.date && analysis.date && analysis.date !== form.date) return false;
      if (form.direction && analysis.signal && analysis.signal !== 'N/A' && analysis.signal !== form.direction) return false;
      return true;
    })
    .slice(0, 25);

  const selectedAnalysis = analysisOptions.find((analysis) => analysis.id === form.analysis_id)
    || analyses.map(toAnalysisOption).find((analysis) => analysis.id === form.analysis_id)
    || null;

  const handleSave = () => {
    const pnl = parseFloat(form.pnl) || 0;
    onSave({
      ...form,
      entry_price: parseFloat(form.entry_price) || 0,
      stop_loss: parseFloat(form.stop_loss) || 0,
      take_profit: parseFloat(form.take_profit) || 0,
      pnl,
      result: pnl >= 0 ? 'win' : 'loss',
      analysis_id: selectedAnalysis?.id || null,
      analysis_source_window: selectedAnalysis?.sourceWindow || null,
      analysis_setup_grade: selectedAnalysis?.setupGrade || null,
      analysis_signal: selectedAnalysis?.signal || null,
      ml_probability: selectedAnalysis?.mlProbability ?? null,
      ml_pass_filter: typeof selectedAnalysis?.mlPassFilter === 'boolean' ? selectedAnalysis.mlPassFilter : null,
    });
    setForm(defaultEntry);
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Registrar Operación</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Fecha</Label>
            <Input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} className="bg-secondary border-border text-sm" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Ticker</Label>
            <Input value={form.ticker} onChange={(e) => update('ticker', e.target.value.toUpperCase())} placeholder="SPY" className="bg-secondary border-border font-mono text-sm" />
          </div>
        </div>

        <div>
          <Label className="text-[10px] text-muted-foreground">Dirección</Label>
          <Select value={form.direction} onValueChange={(v) => update('direction', v)}>
            <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CALL">CALL</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-[10px] text-muted-foreground">Análisis Vinculado (Opcional)</Label>
          <Select value={form.analysis_id || '__none__'} onValueChange={(v) => update('analysis_id', v === '__none__' ? '' : v)}>
            <SelectTrigger className="bg-secondary border-border">
              <SelectValue placeholder="Seleccionar análisis guardado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin vincular</SelectItem>
              {analysisOptions.map((analysis) => (
                <SelectItem key={analysis.id} value={analysis.id}>
                  {analysis.ticker} | {analysis.date || 'N/A'} | {getWindowLabel(analysis.sourceWindow)} | {analysis.setupGrade} | {analysis.signal}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAnalysis ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Vinculado a {getWindowLabel(selectedAnalysis.sourceWindow)} con setup {selectedAnalysis.setupGrade} y señal {selectedAnalysis.signal}.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Filtra por ticker, fecha y dirección para ver solo análisis compatibles.
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Entrada</Label>
            <Input type="number" step="0.01" value={form.entry_price} onChange={(e) => update('entry_price', e.target.value)} className="bg-secondary border-border font-mono text-sm" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Stop Loss</Label>
            <Input type="number" step="0.01" value={form.stop_loss} onChange={(e) => update('stop_loss', e.target.value)} className="bg-secondary border-border font-mono text-sm" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Take Profit</Label>
            <Input type="number" step="0.01" value={form.take_profit} onChange={(e) => update('take_profit', e.target.value)} className="bg-secondary border-border font-mono text-sm" />
          </div>
        </div>

        <div>
          <Label className="text-[10px] text-muted-foreground">P&L (Ganancia/Pérdida)</Label>
          <Input type="number" step="0.01" value={form.pnl} onChange={(e) => update('pnl', e.target.value)} placeholder="100 o -50" className="bg-secondary border-border font-mono text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Hora Entrada</Label>
            <Input type="time" value={form.entry_time} onChange={(e) => update('entry_time', e.target.value)} className="bg-secondary border-border text-sm" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Hora Salida</Label>
            <Input type="time" value={form.exit_time} onChange={(e) => update('exit_time', e.target.value)} className="bg-secondary border-border text-sm" />
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving || !form.pnl} className="w-full bg-primary hover:bg-primary/90">
          <Save className="w-4 h-4 mr-2" />
          Guardar en Calendario
        </Button>
      </CardContent>
    </Card>
  );
}