import React from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function JournalCalendar({ currentMonth, setCurrentMonth, entries }) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const weekDays = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sáb', 'Dom'];

  const getDayPnL = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayEntries = entries.filter(e => e.date === dateStr);
    if (dayEntries.length === 0) return null;
    return dayEntries.reduce((sum, e) => sum + (e.pnl || 0), 0);
  };

  const getDayMlState = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayEntries = entries.filter(e => e.date === dateStr && typeof e?.ml_pass_filter === 'boolean');
    if (dayEntries.length === 0) return null;
    const passCount = dayEntries.filter((e) => e.ml_pass_filter === true).length;
    const defensiveCount = dayEntries.length - passCount;
    if (passCount > 0 && defensiveCount > 0) return { label: 'Mixto', className: 'text-sky-300 bg-sky-500/15 border-sky-500/30' };
    if (passCount > 0) return { label: 'PASS', className: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' };
    return { label: 'DEF', className: 'text-amber-300 bg-amber-500/15 border-amber-500/30' };
  };

  // Calculate weekly totals
  const getWeekTotal = (weekStart) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    let total = 0;
    let hasEntries = false;
    for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      const pnl = getDayPnL(d);
      if (pnl !== null) {
        total += pnl;
        hasEntries = true;
      }
    }
    return hasEntries ? total : null;
  };

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  // Group days by weeks
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="bg-card rounded-xl border border-border/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
        <h3 className="text-sm font-bold text-foreground capitalize">{format(currentMonth, 'MMMM yyyy', { locale: es })}</h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {/* Week day headers */}
      <div className="grid grid-cols-8 gap-1 mb-1">
        {weekDays.map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
        ))}
        <div className="text-center text-[10px] font-medium text-muted-foreground py-1">Total</div>
      </div>

      {/* Calendar grid */}
      {weeks.map((week, wi) => {
        const weekTotal = getWeekTotal(week[0]);
        return (
          <div key={wi} className="grid grid-cols-8 gap-1 mb-1">
            {week.map((day, di) => {
              const pnl = getDayPnL(day);
              const mlState = getDayMlState(day);
              const inMonth = isSameMonth(day, currentMonth);
              return (
                <div
                  key={di}
                  className={cn(
                    'aspect-square rounded-lg flex flex-col items-center justify-center p-0.5 text-center transition-all',
                    !inMonth && 'opacity-30',
                    isToday(day) && 'ring-1 ring-primary',
                    pnl !== null && pnl > 0 && 'bg-emerald-500/15 border border-emerald-500/30',
                    pnl !== null && pnl < 0 && 'bg-red-500/15 border border-red-500/30',
                    pnl === null && 'bg-secondary/30'
                  )}
                >
                  <span className="text-[10px] text-muted-foreground">{format(day, 'd')}</span>
                  {pnl !== null && (
                    <span className={cn('text-[9px] font-bold font-mono', pnl > 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {pnl > 0 ? '+' : ''}{pnl.toFixed(0)}
                    </span>
                  )}
                  {mlState && (
                    <span className={cn('mt-0.5 rounded border px-1 py-0 text-[8px] leading-none font-semibold', mlState.className)}>
                      {mlState.label}
                    </span>
                  )}
                </div>
              );
            })}
            {/* Week total */}
            <div className={cn(
              'aspect-square rounded-lg flex items-center justify-center',
              weekTotal !== null && weekTotal > 0 && 'bg-emerald-500/10',
              weekTotal !== null && weekTotal < 0 && 'bg-red-500/10',
              weekTotal === null && 'bg-secondary/20'
            )}>
              {weekTotal !== null && (
                <span className={cn('text-[10px] font-bold font-mono', weekTotal > 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {weekTotal > 0 ? '+' : ''}{weekTotal.toFixed(0)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}