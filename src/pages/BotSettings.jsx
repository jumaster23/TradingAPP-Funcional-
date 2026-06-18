import React, { useState, useEffect, useRef } from 'react';
import { base44, clearAllBlocks } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Save, RefreshCw, Zap, Bell, Shield, Settings, Sliders, Info, MessageCircle, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { hasBase44Config, isNotFoundError, getReadableError } from '@/lib/backendGuard';
import { refreshSignalLogExecution } from '@/lib/signalLog';
import { appendSignalLogsBatchToSimpleDataset } from '@/lib/mlDataset';

const defaultSettings = {
  initial_capital: 10000, max_daily_loss: 500, max_daily_trades: 10, position_size: 100,
  trailing_stop: false, orb_duration: '15min', pullback_enabled: true, volume_confirmation: true,
  gap_min_size: 0.3, gap_max_size: 3.0, gap_direction: 'both',
  vwap_bounce_enabled: true, breakout_enabled: true, scalping_enabled: true, intraday_enabled: true,
  pullback_margin_pct: 0.2,
  atr_minimum: 0.5, update_frequency: 'minutes', notifications_enabled: true, sound_alerts: true,
  risk_alerts: true, news_alerts: true, auto_backtesting: false, execution_mode: 'manual',
  ml_filter_enabled: true, ml_filter_threshold: 0.7,
  daytrading_defensive_min_prob: 60, daytrading_defensive_max_prob: 65,
  daytrading_orb_invalid_max_prob: 55, daytrading_high_conviction_min: 4,
  max_slippage: 0.05, font_color: '#e2e8f0', font_family: 'Inter',
};

export default function BotSettings() {
  const [settings, setSettings] = useState(defaultSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [signalLogs, setSignalLogs] = useState([]);
  const [isLoadingSignalLogs, setIsLoadingSignalLogs] = useState(false);
  const [isSyncingSignalDataset, setIsSyncingSignalDataset] = useState(false);
  const [signalDatasetSyncStats, setSignalDatasetSyncStats] = useState(null);
  const didAutoSyncRef = useRef(false);

  useEffect(() => {
    (async () => {
      if (!hasBase44Config()) return;
      try {
        const records = await base44.entities.BotSettings.list('-created_date', 1);
        if (records.length > 0) setSettings({ ...defaultSettings, ...records[0] });
      } catch (err) {
        if (!isNotFoundError(err)) {
          console.warn('BotSettings load failed:', getReadableError(err));
        }
      }
    })();
  }, []);

  const loadSignalLogs = async () => {
    if (!hasBase44Config()) return;
    setIsLoadingSignalLogs(true);
    try {
      const logs = await base44.entities.SignalLog.list('-created_date', 200);
      const refreshed = await Promise.all(
        logs.map(async (log) => {
          try {
            return await refreshSignalLogExecution(log);
          } catch {
            return log;
          }
        })
      );
      setSignalLogs(refreshed);
    } catch (err) {
      if (!isNotFoundError(err)) {
        toast.error('No se pudo cargar la base de señales: ' + getReadableError(err));
      }
    } finally {
      setIsLoadingSignalLogs(false);
    }
  };

  useEffect(() => {
    loadSignalLogs();
  }, []);

  const syncSignalsToTrainingDataset = async ({ silent = false } = {}) => {
    if (!hasBase44Config()) {
      if (!silent) toast.error('No se puede sincronizar: falta configurar Base44 en .env.local');
      return;
    }
    setIsSyncingSignalDataset(true);
    try {
      const logs = await base44.entities.SignalLog.list('-created_date', 1000);
      const result = await appendSignalLogsBatchToSimpleDataset(logs);
      const inserted = Number(result?.inserted || 0);
      const total = Number(result?.total_labeled || 0);
      setSignalDatasetSyncStats({
        inserted,
        total,
        mode: silent ? 'auto' : 'manual',
        syncedAt: new Date().toISOString(),
      });
      if (!silent && inserted > 0) {
        toast.success(`Señales sincronizadas al dataset ML: +${inserted} nuevas (${total} etiquetadas evaluadas)`);
      } else if (!silent) {
        toast.info(`Sin nuevas filas para insertar. Señales etiquetadas evaluadas: ${total}`);
      }
    } catch (err) {
      if (!silent) {
        toast.error('Error sincronizando señales a dataset ML: ' + getReadableError(err));
      }
    } finally {
      setIsSyncingSignalDataset(false);
    }
  };

  useEffect(() => {
    if (didAutoSyncRef.current) return;
    didAutoSyncRef.current = true;
    syncSignalsToTrainingDataset({ silent: true });
  }, []);

  const updateSetting = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const saveSettings = async () => {
    if (!hasBase44Config()) {
      toast.error('No se puede guardar: falta configurar Base44 en .env.local');
      return;
    }
    setIsSaving(true);
    try {
      const records = await base44.entities.BotSettings.list('-created_date', 1);
      if (records.length > 0) {
        await base44.entities.BotSettings.update(records[0].id, settings);
      } else {
        await base44.entities.BotSettings.create(settings);
      }
      toast.success('Configuración guardada');
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('No se pudo guardar: la entidad BotSettings no existe en el backend Base44.');
      } else {
        toast.error('Error al guardar: ' + getReadableError(err));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const SectionCard = ({ icon: Icon, title, children }) => (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Icon className="w-4 h-4 text-primary" />{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );

  const SettingRow = ({ label, children }) => (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-xs text-muted-foreground shrink-0">{label}</Label>
      {children}
    </div>
  );

  const formatDateTime = (iso) => {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString();
  };

  const statusClass = (status) => {
    if (status === 'TP_HIT') return 'text-emerald-400';
    if (status === 'SL_HIT') return 'text-red-400';
    if (status === 'IN_PROGRESS') return 'text-amber-300';
    return 'text-muted-foreground';
  };

  return (
    <div className="space-y-6">
      {/* Top Buttons */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-xl border border-border/50">
        <Button onClick={saveSettings} disabled={isSaving} className="bg-primary hover:bg-primary/90">
          <Save className="w-4 h-4 mr-2" />{isSaving ? 'Guardando...' : 'Guardar Cambios'}
        </Button>
        <Button variant="outline" onClick={() => setSettings(defaultSettings)}><RefreshCw className="w-4 h-4 mr-2" />Actualizar</Button>
        <Button variant="outline"><Zap className="w-4 h-4 mr-2" />Optimizar</Button>
        <Button
          variant="outline"
          className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
          onClick={() => { clearAllBlocks(); toast.success('Bloqueos API eliminados. Ya puedes usar los scanners.'); }}
        >
          <Trash2 className="w-4 h-4 mr-2" />Limpiar bloqueos API
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Info className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">TradingBot AI v1.0</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Capital & Risk */}
        <SectionCard icon={Shield} title="Capital & Gestión de Riesgo">
          <SettingRow label="Capital Inicial">
            <Input type="number" value={settings.initial_capital} onChange={(e) => updateSetting('initial_capital', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
          <SettingRow label="Pérdida Máx. Diaria">
            <Input type="number" value={settings.max_daily_loss} onChange={(e) => updateSetting('max_daily_loss', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
          <SettingRow label="Operaciones Máx./Día">
            <Input type="number" value={settings.max_daily_trades} onChange={(e) => updateSetting('max_daily_trades', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
          <SettingRow label="Tamaño de Posición">
            <Input type="number" value={settings.position_size} onChange={(e) => updateSetting('position_size', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
          <SettingRow label="Trailing Stop">
            <Switch checked={settings.trailing_stop} onCheckedChange={(v) => updateSetting('trailing_stop', v)} />
          </SettingRow>
          <SettingRow label="Modo Ejecución">
            <Select value={settings.execution_mode} onValueChange={(v) => updateSetting('execution_mode', v)}>
              <SelectTrigger className="w-32 bg-secondary"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="semi_auto">Semi-Auto</SelectItem></SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Max Slippage">
            <Input type="number" step="0.01" value={settings.max_slippage} onChange={(e) => updateSetting('max_slippage', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
          <Separator className="bg-border/50" />
          <SettingRow label="Filtro ML Activo">
            <Switch checked={settings.ml_filter_enabled ?? true} onCheckedChange={(v) => updateSetting('ml_filter_enabled', v)} />
          </SettingRow>
          <SettingRow label="Threshold ML (0-1)">
            <Input
              type="number"
              step="0.01"
              min="0.5"
              max="0.95"
              value={settings.ml_filter_threshold ?? 0.7}
              onChange={(e) => updateSetting('ml_filter_threshold', +e.target.value)}
              className="w-32 bg-secondary border-border font-mono text-right"
            />
          </SettingRow>
        </SectionCard>

        {/* Alerts */}
        <SectionCard icon={Bell} title="Alertas & Notificaciones">
          <SettingRow label="Notificaciones">
            <Switch checked={settings.notifications_enabled} onCheckedChange={(v) => updateSetting('notifications_enabled', v)} />
          </SettingRow>
          <SettingRow label="Alerta Sonido (Pop-up)">
            <Switch checked={settings.sound_alerts} onCheckedChange={(v) => updateSetting('sound_alerts', v)} />
          </SettingRow>
          <SettingRow label="Alerta de Riesgo">
            <Switch checked={settings.risk_alerts} onCheckedChange={(v) => updateSetting('risk_alerts', v)} />
          </SettingRow>
          <SettingRow label="Alertas Noticias">
            <Switch checked={settings.news_alerts} onCheckedChange={(v) => updateSetting('news_alerts', v)} />
          </SettingRow>
          <SettingRow label="Backtesting Automático">
            <Switch checked={settings.auto_backtesting} onCheckedChange={(v) => updateSetting('auto_backtesting', v)} />
          </SettingRow>
          <SettingRow label="Frecuencia Actualización">
            <Select value={settings.update_frequency} onValueChange={(v) => updateSetting('update_frequency', v)}>
              <SelectTrigger className="w-32 bg-secondary"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="seconds">Segundos</SelectItem><SelectItem value="minutes">Minutos</SelectItem><SelectItem value="hours">Horas</SelectItem></SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="ATR Mínimo">
            <Input type="number" step="0.1" value={settings.atr_minimum} onChange={(e) => updateSetting('atr_minimum', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
        </SectionCard>

        {/* Strategy ORB */}
        <SectionCard icon={Sliders} title="Estrategia ORB">
          <SettingRow label="Duración del Rango">
            <Select value={settings.orb_duration} onValueChange={(v) => updateSetting('orb_duration', v)}>
              <SelectTrigger className="w-32 bg-secondary"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="5min">5 min</SelectItem><SelectItem value="15min">15 min</SelectItem><SelectItem value="30min">30 min</SelectItem><SelectItem value="1hour">1 hora</SelectItem></SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Pullback antes de entrar">
            <Switch checked={settings.pullback_enabled} onCheckedChange={(v) => updateSetting('pullback_enabled', v)} />
          </SettingRow>
          <SettingRow label="Confirmación de Volumen">
            <Switch checked={settings.volume_confirmation} onCheckedChange={(v) => updateSetting('volume_confirmation', v)} />
          </SettingRow>
          <SettingRow label="Margen Pullback EMA20 (%)">
            <Input
              type="number"
              step="0.1"
              min="0.1"
              max="2"
              value={settings.pullback_margin_pct ?? 0.2}
              onChange={(e) => updateSetting('pullback_margin_pct', +e.target.value)}
              className="w-32 bg-secondary border-border font-mono text-right"
            />
          </SettingRow>
          <Separator className="bg-border/50" />
          <SettingRow label="Prob. mínima defensiva (%)">
            <Input
              type="number"
              step="1"
              min="50"
              max="80"
              value={settings.daytrading_defensive_min_prob ?? 60}
              onChange={(e) => updateSetting('daytrading_defensive_min_prob', +e.target.value)}
              className="w-32 bg-secondary border-border font-mono text-right"
            />
          </SettingRow>
          <SettingRow label="Prob. máxima defensiva (%)">
            <Input
              type="number"
              step="1"
              min="55"
              max="90"
              value={settings.daytrading_defensive_max_prob ?? 65}
              onChange={(e) => updateSetting('daytrading_defensive_max_prob', +e.target.value)}
              className="w-32 bg-secondary border-border font-mono text-right"
            />
          </SettingRow>
          <SettingRow label="Max prob. ORB inválido (%)">
            <Input
              type="number"
              step="1"
              min="40"
              max="70"
              value={settings.daytrading_orb_invalid_max_prob ?? 55}
              onChange={(e) => updateSetting('daytrading_orb_invalid_max_prob', +e.target.value)}
              className="w-32 bg-secondary border-border font-mono text-right"
            />
          </SettingRow>
          <SettingRow label="Convicción mínima (1-6)">
            <Input
              type="number"
              step="1"
              min="1"
              max="6"
              value={settings.daytrading_high_conviction_min ?? 4}
              onChange={(e) => updateSetting('daytrading_high_conviction_min', +e.target.value)}
              className="w-32 bg-secondary border-border font-mono text-right"
            />
          </SettingRow>
        </SectionCard>

        {/* Strategy Gap */}
        <SectionCard icon={Settings} title="Estrategia Gap Fill & Módulos">
          <SettingRow label="Gap Mín. (%)">
            <Input type="number" step="0.1" value={settings.gap_min_size} onChange={(e) => updateSetting('gap_min_size', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
          <SettingRow label="Gap Máx. (%)">
            <Input type="number" step="0.1" value={settings.gap_max_size} onChange={(e) => updateSetting('gap_max_size', +e.target.value)} className="w-32 bg-secondary border-border font-mono text-right" />
          </SettingRow>
          <SettingRow label="Dirección Gap">
            <Select value={settings.gap_direction} onValueChange={(v) => updateSetting('gap_direction', v)}>
              <SelectTrigger className="w-40 bg-secondary"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="counter_trend">Contra Tendencia</SelectItem><SelectItem value="with_trend">A Favor</SelectItem><SelectItem value="both">Ambas</SelectItem></SelectContent>
            </Select>
          </SettingRow>
          <Separator className="bg-border/50" />
          <SettingRow label="VWAP Bounce"><Switch checked={settings.vwap_bounce_enabled} onCheckedChange={(v) => updateSetting('vwap_bounce_enabled', v)} /></SettingRow>
          <SettingRow label="Breakouts"><Switch checked={settings.breakout_enabled} onCheckedChange={(v) => updateSetting('breakout_enabled', v)} /></SettingRow>
          <SettingRow label="Scalping"><Switch checked={settings.scalping_enabled} onCheckedChange={(v) => updateSetting('scalping_enabled', v)} /></SettingRow>
          <SettingRow label="Intraday"><Switch checked={settings.intraday_enabled} onCheckedChange={(v) => updateSetting('intraday_enabled', v)} /></SettingRow>
        </SectionCard>
      {/* Integrations */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            Integraciones de Mensajería
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Telegram */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wide">Telegram</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Bot Token</Label>
                <Input
                  type="password"
                  placeholder="123456:ABC-DEF..."
                  value={settings.telegram_token || ''}
                  onChange={(e) => updateSetting('telegram_token', e.target.value)}
                  className="bg-secondary border-border font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Chat ID</Label>
                <Input
                  placeholder="-100123456789"
                  value={settings.telegram_chat_id || ''}
                  onChange={(e) => updateSetting('telegram_chat_id', e.target.value)}
                  className="bg-secondary border-border font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <Separator className="bg-border/50" />

          {/* Discord */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-indigo-400" />
              <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">Discord</h4>
            </div>
            <div className="pl-6">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Webhook URL</Label>
                <Input
                  type="password"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={settings.discord_webhook_url || ''}
                  onChange={(e) => updateSetting('discord_webhook_url', e.target.value)}
                  className="bg-secondary border-border font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <Separator className="bg-border/50" />

          {/* WhatsApp */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">WhatsApp Business API</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-6">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Access Token</Label>
                <Input
                  type="password"
                  placeholder="EAAxxxxxx..."
                  value={settings.whatsapp_token || ''}
                  onChange={(e) => updateSetting('whatsapp_token', e.target.value)}
                  className="bg-secondary border-border font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Phone Number ID</Label>
                <Input
                  placeholder="1234567890"
                  value={settings.whatsapp_phone_id || ''}
                  onChange={(e) => updateSetting('whatsapp_phone_id', e.target.value)}
                  className="bg-secondary border-border font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Número Destinatario</Label>
                <Input
                  placeholder="591XXXXXXXX"
                  value={settings.whatsapp_recipient || ''}
                  onChange={(e) => updateSetting('whatsapp_recipient', e.target.value)}
                  className="bg-secondary border-border font-mono text-xs"
                />
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Signal Log DB */}
      <Card className="bg-card border-border/50 md:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            Base de Datos de Señales (Scalp/Live/Probabilities)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Registro automático al presionar Guardar. Incluye progreso de ejecución para entrenamiento del bot.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={syncSignalsToTrainingDataset} disabled={isSyncingSignalDataset}>
                <Zap className="w-3 h-3 mr-1" />
                {isSyncingSignalDataset ? 'Sincronizando...' : 'Sync entrenamiento'}
              </Button>
              <Button variant="outline" size="sm" onClick={loadSignalLogs} disabled={isLoadingSignalLogs}>
                <RefreshCw className="w-3 h-3 mr-1" />
                {isLoadingSignalLogs ? 'Actualizando...' : 'Actualizar'}
              </Button>
            </div>
          </div>

          {signalDatasetSyncStats && (
            <div className="rounded-md border border-border/50 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
              Sync {signalDatasetSyncStats.mode === 'auto' ? 'automático' : 'manual'}: +{signalDatasetSyncStats.inserted} nuevas, {signalDatasetSyncStats.total} etiquetadas evaluadas.
              {' '}Última ejecución: {formatDateTime(signalDatasetSyncStats.syncedAt)}.
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40">
                <tr>
                  <th className="text-left px-3 py-2">Fecha y hora</th>
                  <th className="text-left px-3 py-2">Ticker</th>
                  <th className="text-left px-3 py-2">Ventana</th>
                  <th className="text-left px-3 py-2">Timeframe</th>
                  <th className="text-left px-3 py-2">Señal</th>
                  <th className="text-right px-3 py-2">Entry</th>
                  <th className="text-right px-3 py-2">SL</th>
                  <th className="text-right px-3 py-2">TP</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-right px-3 py-2">Progreso</th>
                  <th className="text-right px-3 py-2">Máx logrado</th>
                </tr>
              </thead>
              <tbody>
                {signalLogs.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground" colSpan={11}>
                      No hay señales guardadas todavía.
                    </td>
                  </tr>
                ) : signalLogs.map((row) => (
                  <tr key={row.id} className="border-t border-border/40">
                    <td className="px-3 py-2">{formatDateTime(row.created_date)}</td>
                    <td className="px-3 py-2 font-mono">{row.ticker || '--'}</td>
                    <td className="px-3 py-2">{row.source_window || '--'}</td>
                    <td className="px-3 py-2">{row.timeframe || '--'}</td>
                    <td className={`px-3 py-2 font-semibold ${row.signal === 'CALL' ? 'text-emerald-400' : row.signal === 'PUT' ? 'text-red-400' : 'text-muted-foreground'}`}>{row.signal || '--'}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.entry_price != null ? row.entry_price.toFixed(2) : '--'}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.stop_loss != null ? row.stop_loss.toFixed(2) : '--'}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.take_profit != null ? row.take_profit.toFixed(2) : '--'}</td>
                    <td className={`px-3 py-2 font-semibold ${statusClass(row.status)}`}>{row.status || 'PENDING'}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number.isFinite(Number(row.progress_pct)) ? `${Number(row.progress_pct).toFixed(2)}%` : '--'}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number.isFinite(Number(row.max_progress_pct)) ? `${Number(row.max_progress_pct).toFixed(2)}%` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      </div>
    </div>
  );
}