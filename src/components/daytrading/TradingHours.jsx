import React from 'react';
import { Clock, Zap, TrendingUp, Ban, Flame } from 'lucide-react';

const ET_OFFSET = -4; // EDT (ajustar a -5 en invierno EST)

function getNowET() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const et = new Date(utc + ET_OFFSET * 3600000);
  return et.getHours() + et.getMinutes() / 60; // decimal hours
}

const SESSIONS = [
  {
    id: 'open',
    label: 'Apertura',
    time: '9:30 – 10:30 AM ET',
    start: 9.5,
    end: 10.5,
    icon: Zap,
    color: 'emerald',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/10',
    headerBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    dot: 'bg-emerald-400',
    recommendation: '✅ IDEAL PARA SCALP',
    recColor: 'text-emerald-400',
    bullets: [
      '⚡ Máxima volatilidad del día',
      '🏦 Mayor volumen institucional',
      '📈 Movimientos claros y direccionales',
      '🎯 Mejor momento para scalp 1m/5m',
    ],
    tip: 'Esperar los primeros 5-10 min para que se estabilice el price discovery antes de entrar.',
  },
  {
    id: 'midmorning',
    label: 'Media Mañana',
    time: '10:30 AM – 12:00 PM ET',
    start: 10.5,
    end: 12.0,
    icon: TrendingUp,
    color: 'cyan',
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/8',
    headerBg: 'bg-cyan-500/12',
    iconColor: 'text-cyan-400',
    badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    dot: 'bg-cyan-400',
    recommendation: '✅ IDEAL PARA INTRADAY',
    recColor: 'text-cyan-400',
    bullets: [
      '📊 Movimiento más limpio y ordenado',
      '🔇 Menos ruido que la apertura',
      '✔️ Confirmación de tendencia establecida',
      '📐 Pullbacks a EMAs más confiables',
    ],
    tip: 'La tendencia que se forma aquí suele mantenerse hasta el power hour. Operar en dirección del ORB confirmado.',
  },
  {
    id: 'midday',
    label: 'Mediodía',
    time: '12:00 – 2:00 PM ET',
    start: 12.0,
    end: 14.0,
    icon: Ban,
    color: 'red',
    border: 'border-red-500/40',
    bg: 'bg-red-500/8',
    headerBg: 'bg-red-500/15',
    iconColor: 'text-red-400',
    badge: 'bg-red-500/20 text-red-400 border-red-500/40',
    dot: 'bg-red-400 animate-pulse',
    recommendation: '🚫 EVITAR — NO OPERAR',
    recColor: 'text-red-400',
    bullets: [
      '📉 Volumen cae al mínimo del día',
      '↔️ Mercado lateral sin dirección clara',
      '⚠️ Muchas falsas señales y whipsaws',
      '💀 Spreads más amplios, slippage mayor',
    ],
    tip: 'Usar este tiempo para revisar el análisis, preparar el plan para el power hour y descansar.',
  },
  {
    id: 'powerhour',
    label: 'Power Hour',
    time: '2:00 – 4:00 PM ET',
    start: 14.0,
    end: 16.0,
    icon: Flame,
    color: 'orange',
    border: 'border-orange-500/40',
    bg: 'bg-orange-500/8',
    headerBg: 'bg-orange-500/15',
    iconColor: 'text-orange-400',
    badge: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
    dot: 'bg-orange-400',
    recommendation: '⚡ 3PM = MÁS POTENTE',
    recColor: 'text-orange-400',
    bullets: [
      '🔥 Retorna el volumen institucional',
      '🏦 Cierre de posiciones institucionales',
      '↕️ Puede darse continuación O reversión fuerte',
      '💥 La hora 3PM–4PM es la más explosiva',
    ],
    tip: 'Confirmar si la dirección de apertura continúa o hay reversión. Reducir tamaño de posición en los últimos 15 min del día.',
  },
];

export default function TradingHours() {
  const nowET = getNowET();
  const isMarketOpen = nowET >= 9.5 && nowET < 16.0;
  const currentSession = SESSIONS.find(s => nowET >= s.start && nowET < s.end);

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary/40 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Horario Óptimo de Trading (ET)</span>
        </div>
        <div className="flex items-center gap-2">
          {isMarketOpen ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-semibold text-emerald-400">MERCADO ABIERTO</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
              <span className="text-[10px] font-semibold text-muted-foreground">MERCADO CERRADO</span>
            </>
          )}
        </div>
      </div>

      {/* Timeline bar */}
      <div className="px-4 py-3 border-b border-border/30">
        <div className="relative h-5 rounded-full overflow-hidden flex">
          {/* Open */}
          <div className="h-full bg-emerald-500/40 flex items-center justify-center" style={{ width: '15.38%' }}>
            <span className="text-[8px] font-bold text-emerald-300">OPEN</span>
          </div>
          {/* Mid-morning */}
          <div className="h-full bg-cyan-500/30 flex items-center justify-center" style={{ width: '23.08%' }}>
            <span className="text-[8px] font-bold text-cyan-300">MID-AM</span>
          </div>
          {/* Midday */}
          <div className="h-full bg-red-500/25 flex items-center justify-center" style={{ width: '30.77%' }}>
            <span className="text-[8px] font-bold text-red-300">MIDDAY</span>
          </div>
          {/* Power hour */}
          <div className="h-full bg-orange-500/35 flex items-center justify-center" style={{ width: '30.77%' }}>
            <span className="text-[8px] font-bold text-orange-300">POWER HOUR</span>
          </div>

          {/* Current time marker */}
          {isMarketOpen && (() => {
            const pct = ((nowET - 9.5) / 6.5) * 100;
            return (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
                style={{ left: `${pct}%` }}
              >
                <div className="absolute -top-0.5 -left-1 w-2.5 h-2.5 bg-white rounded-full shadow" />
              </div>
            );
          })()}
        </div>
        <div className="flex justify-between text-[8px] text-muted-foreground/60 mt-1 px-0.5">
          <span>9:30</span>
          <span>10:30</span>
          <span>12:00</span>
          <span>2:00</span>
          <span>4:00 PM</span>
        </div>
      </div>

      {/* Session cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3">
        {SESSIONS.map((session) => {
          const Icon = session.icon;
          const isActive = currentSession?.id === session.id;
          return (
            <div
              key={session.id}
              className={`rounded-xl border ${session.border} ${session.bg} overflow-hidden relative
                ${isActive ? 'ring-2 ring-white/20 shadow-lg scale-[1.02]' : ''} transition-all`}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              )}

              {/* Card header */}
              <div className={`px-3 py-2 ${session.headerBg} flex items-center justify-between`}>
                <div className="flex items-center gap-1.5">
                  {isActive && <span className={`w-1.5 h-1.5 rounded-full ${session.dot}`} />}
                  <Icon className={`w-3.5 h-3.5 ${session.iconColor}`} />
                  <span className={`text-[11px] font-bold ${session.iconColor}`}>{session.label}</span>
                </div>
                {isActive && (
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${session.badge}`}>
                    AHORA
                  </span>
                )}
              </div>

              <div className="px-3 py-2.5 space-y-2">
                {/* Time */}
                <p className="text-[10px] font-mono text-muted-foreground">{session.time}</p>

                {/* Recommendation */}
                <p className={`text-[10px] font-bold ${session.recColor}`}>{session.recommendation}</p>

                {/* Bullets */}
                <div className="space-y-1">
                  {session.bullets.map((b, i) => (
                    <p key={i} className="text-[9px] text-foreground/80 leading-tight">{b}</p>
                  ))}
                </div>

                {/* Tip */}
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[9px] text-muted-foreground italic leading-tight">{session.tip}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}