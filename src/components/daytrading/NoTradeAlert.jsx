import React from 'react';
import { AlertTriangle, Ban, Clock, TrendingDown, Newspaper } from 'lucide-react';

const ALERT_ICONS = {
  news: Newspaper,
  sideways: TrendingDown,
  low_volume: Clock,
};

const SEVERITY_STYLES = {
  HIGH: {
    border: 'border-red-500/50',
    bg: 'bg-red-500/10',
    icon: 'text-red-400',
    badge: 'bg-red-500/20 text-red-400 border-red-500/40',
    dot: 'bg-red-400 animate-pulse',
  },
  MEDIUM: {
    border: 'border-amber-500/50',
    bg: 'bg-amber-500/10',
    icon: 'text-amber-400',
    badge: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
    dot: 'bg-amber-400',
  },
  LOW: {
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/5',
    icon: 'text-yellow-400',
    badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    dot: 'bg-yellow-400',
  },
};

function AlertCard({ alert }) {
  const Icon = ALERT_ICONS[alert.type] || AlertTriangle;
  const s = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.MEDIUM;

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-3 flex items-start gap-3`}>
      <div className={`mt-0.5 ${s.icon}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-bold uppercase tracking-wide ${s.icon}`}>{alert.label}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${s.badge}`}>
            {alert.severity === 'HIGH' ? 'NO OPERAR' : alert.severity === 'MEDIUM' ? 'PRECAUCIÓN' : 'AVISO'}
          </span>
        </div>
        <p className="text-[10px] text-foreground leading-relaxed">{alert.reason}</p>
        {alert.wait_until && (
          <p className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            Esperar hasta: <span className="text-foreground font-semibold">{alert.wait_until}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export default function NoTradeAlert({ alerts }) {
  if (!alerts || alerts.length === 0) return null;

  const hasHighSeverity = alerts.some(a => a.severity === 'HIGH');

  return (
    <div className={`rounded-xl border ${hasHighSeverity ? 'border-red-500/40' : 'border-amber-500/30'} overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-2.5 ${hasHighSeverity ? 'bg-red-500/15' : 'bg-amber-500/10'}`}>
        <Ban className={`w-4 h-4 ${hasHighSeverity ? 'text-red-400' : 'text-amber-400'}`} />
        <span className={`text-sm font-bold ${hasHighSeverity ? 'text-red-400' : 'text-amber-400'}`}>
          🚫 Alertas de No Operar
        </span>
        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold border
          ${hasHighSeverity ? 'bg-red-500/20 text-red-400 border-red-500/40' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}`}>
          {alerts.length} {alerts.length === 1 ? 'alerta' : 'alertas'}
        </span>
      </div>
      {/* Alerts */}
      <div className="bg-card p-3 space-y-2">
        {alerts.map((alert, i) => <AlertCard key={i} alert={alert} />)}
      </div>
    </div>
  );
}