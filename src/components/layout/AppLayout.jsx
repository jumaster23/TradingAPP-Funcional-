import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { BarChart3, TrendingUp, Newspaper, Waves, Building2, Settings, BookOpen, BookMarked, Radio, Zap, History, Target, Brain, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { path: '/Probabilities', label: 'Probabilidades', icon: BarChart3 },
  { path: '/LiveDashboard', label: 'Señales', icon: Activity },
  { path: '/Live', label: 'Live', icon: Radio },
  { path: '/Live2', label: 'Live 2.0', icon: Zap },
  { path: '/Live3', label: 'Live 3.0', icon: Target },
  { path: '/Live4', label: 'Live 4.0', icon: Brain },
  { path: '/Backtest', label: 'Backtest', icon: History },
  { path: '/DayTrading', label: 'Day Trading', icon: TrendingUp },
  { path: '/News', label: 'Noticias', icon: Newspaper },
  { path: '/Swing', label: 'Swing', icon: Waves },
  { path: '/InstitutionalPro', label: 'Institucional Pro', icon: Building2 },
  { path: '/Institutional', label: 'Institucional', icon: Building2 },
  { path: '/BotSettings', label: 'Config', icon: Settings },
  { path: '/Journal', label: 'Journal', icon: BookOpen },
  { path: '/Library', label: 'Biblioteca', icon: BookMarked },
];

export default function AppLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Trading bot hibrido</h1>
              <p className="text-[10px] text-muted-foreground font-medium">Machine Learning · v1.0</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-muted-foreground">Activo</span>
          </div>
        </div>
        {/* Navigation */}
        <nav className="max-w-[1600px] mx-auto px-4 flex gap-1 overflow-x-auto pb-0 scrollbar-hide">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all whitespace-nowrap",
                  isActive
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}