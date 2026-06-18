import React, { useState, useEffect } from 'react';
import { base44 } from '../api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import JournalCalendar from '../components/journal/JournalCalendar';
import JournalStats from '../components/journal/JournalStats';
import TradeEntryForm from '../components/journal/TradeEntryForm';
import { toast } from 'sonner';
import { hasBase44Config, isNotFoundError, getReadableError } from '../lib/backendGuard';
import { appendLabeledSampleToSimpleDataset, appendLabeledSamplesBatchToSimpleDataset, syncMlTradeSampleWithJournalEntry } from '../lib/mlDataset';

export default function Journal() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [initialCapital, setInitialCapital] = useState(10000);
  const [datasetBackfilled, setDatasetBackfilled] = useState(false);
  const queryClient = useQueryClient();

  // Load settings for initial capital
  useEffect(() => {
    (async () => {
      if (!hasBase44Config()) return;
      try {
        const settings = await base44.entities.BotSettings.list('-created_date', 1);
        if (settings.length > 0 && settings[0].initial_capital) {
          setInitialCapital(settings[0].initial_capital);
        }
      } catch (err) {
        if (!isNotFoundError(err)) {
          console.warn('Journal settings load failed:', getReadableError(err));
        }
      }
    })();
  }, []);

  const { data: entries = [] } = useQuery({
    queryKey: ['journal-entries'],
    queryFn: async () => {
      if (!hasBase44Config()) return [];
      try {
        return await base44.entities.JournalEntry.list('-created_date', 500);
      } catch (err) {
        if (isNotFoundError(err)) return [];
        throw err;
      }
    },
  });

  const { data: analyses = [] } = useQuery({
    queryKey: ['saved-analyses'],
    queryFn: async () => {
      if (!hasBase44Config()) return [];
      try {
        return await base44.entities.Analysis.list('-created_date', 1000);
      } catch (err) {
        if (isNotFoundError(err)) return [];
        throw err;
      }
    },
  });

  const { data: mlSamples = [] } = useQuery({
    queryKey: ['ml-trade-dataset'],
    queryFn: async () => {
      if (!hasBase44Config()) return [];
      try {
        return await base44.entities.MLTradeDataset.list('-created_date', 5000);
      } catch (err) {
        if (isNotFoundError(err)) return [];
        throw err;
      }
    },
  });

  const { data: mlOpsStatus = null } = useQuery({
    queryKey: ['ml-ops-status'],
    queryFn: async () => {
      const res = await fetch('/api/ml/status');
      if (!res.ok) throw new Error('No se pudo consultar estado ML');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const runDatasetBackfill = React.useCallback(async () => {
    if (!Array.isArray(entries) || !entries.length) return { inserted: 0, total_labeled: 0 };
    return appendLabeledSamplesBatchToSimpleDataset(entries, mlSamples);
  }, [entries, mlSamples]);

  const trainSimpleModel = useMutation({
    mutationFn: async () => {
      if (Number(mlOpsStatus?.dataset_size || 0) === 0) {
        await runDatasetBackfill();
        await queryClient.invalidateQueries({ queryKey: ['ml-ops-status'] });
      }

      const res = await fetch('/api/ml/train', { method: 'POST' });
      if (!res.ok) {
        let payload = null;
        try {
          payload = await res.json();
        } catch {
          payload = null;
        }
        const message = payload?.message || payload?.error || 'No se pudo entrenar el modelo';
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-ops-status'] });
      toast.success('Entrenamiento ML ejecutado');
    },
    onError: (err) => {
      toast.error('Error entrenando ML: ' + getReadableError(err));
    },
  });

  useEffect(() => {
    if (datasetBackfilled) return;
    if (!Array.isArray(entries) || !entries.length) return;
    if (!mlOpsStatus || Number(mlOpsStatus?.dataset_size || 0) > 0) return;

    setDatasetBackfilled(true);
    (async () => {
      try {
        const result = await runDatasetBackfill();
        if ((result?.inserted || 0) > 0) {
          queryClient.invalidateQueries({ queryKey: ['ml-ops-status'] });
          toast.success(`Dataset simple sincronizado: +${result.inserted} muestras`);
        }
      } catch (err) {
        console.warn('ML dataset backfill failed:', err?.message || err);
      }
    })();
  }, [datasetBackfilled, mlOpsStatus, queryClient, runDatasetBackfill]);

  const createEntry = useMutation({
    mutationFn: async (data) => {
      const entry = await base44.entities.JournalEntry.create(data);
      const linkedAnalysis = data?.analysis_id
        ? analyses.find((analysis) => String(analysis.id) === String(data.analysis_id)) || null
        : null;
      try {
        const syncedSample = await syncMlTradeSampleWithJournalEntry(entry, linkedAnalysis);
        if (syncedSample) {
          await appendLabeledSampleToSimpleDataset(entry, syncedSample);
        }
      } catch (syncErr) {
        console.warn('ML dataset outcome sync failed:', syncErr?.message || syncErr);
      }
      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ml-trade-dataset'] });
      toast.success('Operación registrada');
    },
    onError: (err) => {
      if (isNotFoundError(err)) {
        toast.error('No se pudo registrar: la entidad JournalEntry no existe en el backend Base44.');
      } else {
        toast.error('Error al registrar: ' + getReadableError(err));
      }
    },
  });

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border/50">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Capital Inicial:</Label>
          <Input
            type="number"
            value={initialCapital}
            onChange={(e) => setInitialCapital(+e.target.value || 0)}
            className="w-40 bg-secondary border-border font-mono text-sm text-right"
          />
        </div>

        <div className="p-3 bg-card rounded-xl border border-border/50 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-foreground">ML Ops</p>
            <Button
              size="sm"
              variant="outline"
              className="border-border/60 bg-background/40"
              onClick={() => trainSimpleModel.mutate()}
              disabled={trainSimpleModel.isPending}
            >
              {trainSimpleModel.isPending ? 'Entrenando...' : 'Entrenar ahora'}
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-2">
              <p className="text-muted-foreground">Dataset</p>
              <p className="font-semibold text-foreground">{mlOpsStatus?.dataset_size ?? 'N/A'}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-2">
              <p className="text-muted-foreground">Etiquetados</p>
              <p className="font-semibold text-foreground">{mlOpsStatus?.labeled_size ?? 'N/A'}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-2">
              <p className="text-muted-foreground">Umbral Train</p>
              <p className="font-semibold text-foreground">{mlOpsStatus?.train_min_samples ?? 500}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-2">
              <p className="text-muted-foreground">Último Train</p>
              <p className="font-semibold text-foreground">
                {mlOpsStatus?.last_trained_at
                  ? new Date(mlOpsStatus.last_trained_at).toLocaleString('es-ES')
                  : 'Nunca'}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Modelo activo: {mlOpsStatus?.has_model ? 'Sí' : 'No'}.</span>
            <span>
              Candidatos backfill: <span className="text-foreground font-semibold">{entries.filter(e => e.pnl != null || e.result != null).length}</span> / {entries.length} trades
            </span>
          </div>
        </div>
        <JournalStats entries={entries} analyses={analyses} mlSamples={mlSamples} initialCapital={initialCapital} />
      </div>

      {/* Calendar + Entry Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <JournalCalendar currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} entries={entries} />
        </div>
        <div>
          <TradeEntryForm analyses={analyses} onSave={(data) => createEntry.mutate(data)} isSaving={createEntry.isPending} />
        </div>
      </div>
    </div>
  );
}