import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  RefreshCw, ExternalLink, Clock, AlertTriangle, AlertCircle, CheckCircle,
  Calendar, Newspaper, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* ─── Impact config ─── */
const impactCfg = {
  high:   { color: 'border-l-red-500 bg-red-500/5',     badge: 'bg-red-500/15 text-red-400 border-red-500/30',     icon: AlertTriangle, label: 'Alto' },
  medium: { color: 'border-l-orange-500 bg-orange-500/5', badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30', icon: AlertCircle,  label: 'Medio' },
  low:    { color: 'border-l-emerald-500 bg-emerald-500/5', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle,  label: 'Bajo' },
};

/* ─── Keyword-based impact classification ─── */
const HI_RE  = /\b(fed|fomc|interest.?rate|cpi|ppi|nonfarm|payroll|gdp|inflat|recession|crash|bankrupt|default|tariff|war|sanction|emergency|shutdown|rate.?cut|rate.?hike|jobs.?report|employment|consumer.?price|housing.?starts|debt.?ceiling)\b/i;
const MED_RE = /\b(earning|revenue|quarter|forecast|upgrade|downgrade|ipo|merg|acqui|trade|oil|crude|treasury|yield|unemploy|retail.?sales|housing|nasdaq|s.?p.?500|dow.?jones|russell|vix|volatil|options|hedge|short.?sell|buyback|dividend)\b/i;

function classifyImpact(title, desc) {
  const text = `${title} ${desc}`;
  if (HI_RE.test(text))  return 'high';
  if (MED_RE.test(text)) return 'medium';
  return 'low';
}

/* ─── Strip HTML ─── */
function stripHtml(raw) {
  if (!raw) return '';
  return raw.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

/* ─── Format date in ET ─── */
function fmtDateET(date) {
  try {
    return new Intl.DateTimeFormat('es-US', {
      timeZone: 'America/New_York',
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(date) + ' ET';
  } catch { return date.toISOString(); }
}

function fmtRelative(date) {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    // Future event
    const futureMins = Math.floor(-diffMs / 60000);
    if (futureMins < 60) return `En ${futureMins} min`;
    const futureHrs = Math.floor(futureMins / 60);
    const remMins = futureMins % 60;
    if (futureHrs < 24) return remMins > 0 ? `En ${futureHrs}h ${remMins}m` : `En ${futureHrs}h`;
    const futureDays = Math.floor(futureHrs / 24);
    if (futureDays === 1) return 'Mañana';
    return `En ${futureDays} días`;
  }
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Justo ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Ayer';
  return `Hace ${days} días`;
}

/* ─── Parse RSS XML ─── */
function parseRSS(xmlText, fallbackSource, lang = 'en') {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const items = doc.querySelectorAll('item');
    return Array.from(items).map(item => {
      const title  = stripHtml(item.querySelector('title')?.textContent || '');
      const link   = (item.querySelector('link')?.textContent || '').trim();
      const pubStr = (item.querySelector('pubDate')?.textContent || '').trim();
      const desc   = stripHtml(item.querySelector('description')?.textContent || '').slice(0, 400);
      const source = stripHtml(item.querySelector('source')?.textContent || '') || fallbackSource;
      const date   = pubStr ? new Date(pubStr) : null;
      if (!title || !date || isNaN(date.getTime())) return null;
      return {
        title, link, source, desc,
        date,
        ts: date.getTime(),
        dateStr: fmtDateET(date),
        relative: fmtRelative(date),
        impact: classifyImpact(title, desc),
        _lang: lang,
      };
    }).filter(Boolean);
  } catch { return []; }
}

/* ─── Dedup by title similarity ─── */
function dedup(items) {
  const seen = new Map();
  const out = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) continue;
    seen.set(key, true);
    out.push(it);
  }
  return out;
}

/* ─── Group by time period ─── */
function groupByPeriod(items) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  // Monday of current week
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday

  const groups = { hoy: [], ayer: [], semana: [], anterior: [] };
  for (const it of items) {
    if (it.ts >= todayStart.getTime()) groups.hoy.push(it);
    else if (it.ts >= yesterdayStart.getTime()) groups.ayer.push(it);
    else if (it.ts >= weekStart.getTime()) groups.semana.push(it);
    else groups.anterior.push(it);
  }
  return groups;
}

/* ─── Forex Factory calendar → news items ─── */
const FF_IMPACT_MAP = { High: 'high', Medium: 'medium', Low: 'low', Holiday: 'low' };

function parseForexFactory(json) {
  if (!Array.isArray(json)) return [];
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
  return json
    .map(ev => {
      const dateStr = ev.date;
      if (!dateStr) return null;
      const date = new Date(dateStr);
      if (isNaN(date.getTime()) || date.getTime() < weekAgo || date.getTime() > weekAhead) return null;
      const impact = FF_IMPACT_MAP[ev.impact] || 'low';
      const title = `${ev.country || 'USD'}: ${ev.title || 'Evento económico'}`;
      const parts = [];
      if (ev.forecast) parts.push(`Pronóstico: ${ev.forecast}`);
      if (ev.previous) parts.push(`Anterior: ${ev.previous}`);
      if (ev.actual) parts.push(`Actual: ${ev.actual}`);
      const desc = parts.join(' | ');
      const isFuture = date.getTime() > now;
      return {
        title,
        link: 'https://www.forexfactory.com/calendar',
        source: 'Forex Factory',
        desc,
        date,
        ts: date.getTime(),
        dateStr: fmtDateET(date),
        relative: fmtRelative(date),
        impact,
        _lang: 'es',
        _isCalendar: true,
        _isFuture: isFuture,
        _ffImpact: ev.impact,
      };
    })
    .filter(Boolean);
}

/* ─── RSS feed definitions ─── */
const RSS_FEEDS = [
  {
    url: '/api/news/google/rss/search?q=bolsa+de+valores+OR+S%26P+500+OR+Fed+OR+econom%C3%ADa+when:7d&hl=es&gl=US&ceid=US:es',
    source: 'Google News',
    lang: 'es',
  },
  {
    url: '/api/news/google/rss/search?q=Nasdaq+OR+ganancias+OR+opciones+trading+OR+VIX+when:7d&hl=es&gl=US&ceid=US:es',
    source: 'Google News',
    lang: 'es',
  },
  {
    url: '/api/news/google/rss/search?q=aranceles+OR+inflaci%C3%B3n+OR+tasa+de+inter%C3%A9s+OR+CPI+OR+empleo+when:7d&hl=es&gl=US&ceid=US:es',
    source: 'Google News',
    lang: 'es',
  },
  {
    url: '/api/news/yahoo/rss/2.0/headline?s=SPY,QQQ,DIA,AAPL,TSLA,NVDA&region=US&lang=en-US',
    source: 'Yahoo Finance',
    lang: 'en',
  },
  {
    url: '/api/news/mw/public/rss/mw_topstories',
    source: 'MarketWatch',
    lang: 'en',
  },
];

/* ─── Batch translate English news to Spanish via LLM ─── */
async function translateBatch(items) {
  if (!items.length) return items;
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) return items; // no key → return untranslated

  // Process in chunks of 15 to stay within token limits
  const CHUNK = 15;
  const translated = [...items];
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const payload = chunk.map((n, idx) => ({
      id: idx,
      t: n.title,
      d: n.desc || '',
    }));
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-001',
          messages: [
            { role: 'system', content: 'Eres un traductor financiero. Traduce titulares y descripciones de noticias financieras del inglés al español. Mantén los nombres propios, tickers y siglas en su forma original (Fed, S&P 500, Nasdaq, etc). Responde SOLO JSON válido.' },
            {
              role: 'user',
              content: `Traduce al español cada título (t) y descripción (d). Devuelve JSON: {"items":[{"id":0,"t":"...","d":"..."},...]}

${JSON.stringify(payload)}`,
            },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          const arr = parsed?.items || [];
          for (const tr of arr) {
            const idx2 = i + (tr.id ?? -1);
            if (idx2 >= 0 && idx2 < translated.length) {
              if (tr.t) translated[idx2] = { ...translated[idx2], title: tr.t };
              if (tr.d) translated[idx2] = { ...translated[idx2], desc: tr.d };
            }
          }
        }
      }
    } catch { /* translation failed — keep original English */ }
  }
  return translated;
}

/* ─── Fetch with retry (Forex Factory rate-limits aggressively) ─── */
async function fetchWithRetry(url, retries = 2, delayMs = 1500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429 && i < retries) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      return [];
    } catch {
      if (i < retries) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      return [];
    }
  }
  return [];
}

/* ─── Filter tabs ─── */
const FILTERS = [
  { key: 'all',       label: 'Todos' },
  { key: 'high',      label: 'Alto Impacto' },
  { key: 'medium',    label: 'Medio' },
  { key: 'calendar',  label: '📅 Calendario' },
];

/* ══════════════════════════════ COMPONENT ══════════════════════════════ */
export default function News() {
  const [news, setNews]           = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter]       = useState('all');
  const [feedErrors, setFeedErrors] = useState([]);

  /* ── Fetch all RSS feeds + Forex Factory ── */
  const fetchNews = useCallback(async () => {
    setIsLoading(true);
    setFeedErrors([]);
    const errors = [];
    const allItems = [];

    // Fetch RSS feeds + Forex Factory calendar in parallel
    const [rssResults, ffResult] = await Promise.all([
      Promise.allSettled(
        RSS_FEEDS.map(async (feed) => {
          const res = await fetch(feed.url).catch(() => null);
          if (!res || !res.ok) {
            errors.push(feed.source);
            return [];
          }
          const text = await res.text();
          return parseRSS(text, feed.source, feed.lang || 'en');
        })
      ),
      // Forex Factory calendar (this week + next week) with retry for rate limits
      Promise.allSettled([
        fetchWithRetry('/api/news/ff/ff_calendar_thisweek.json'),
        new Promise(r => setTimeout(r, 800)).then(() => fetchWithRetry('/api/news/ff/ff_calendar_nextweek.json')),
      ]),
    ]);

    for (const r of rssResults) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        allItems.push(...r.value);
      }
    }

    // Parse Forex Factory calendar results
    for (const r of ffResult) {
      if (r.status === 'fulfilled') {
        allItems.push(...parseForexFactory(r.value));
      } else {
        errors.push('Forex Factory');
      }
    }

    // Filter: last 7 days for past events, up to 7 days ahead for calendar events, dedup, sort
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekAhead = Date.now() + 7 * 24 * 60 * 60 * 1000;
    let filtered = dedup(allItems.filter(n => n.ts >= weekAgo && n.ts <= weekAhead))
      .sort((a, b) => b.ts - a.ts);

    // Translate English news to Spanish
    const enIdx = [];
    const enItems = [];
    filtered.forEach((n, idx) => {
      if (n._lang === 'en') { enIdx.push(idx); enItems.push(n); }
    });
    if (enItems.length) {
      try {
        const trItems = await translateBatch(enItems);
        trItems.forEach((tr, j) => { filtered[enIdx[j]] = tr; });
      } catch { /* keep originals */ }
    }

    setNews(filtered);
    setFeedErrors(errors);
    setLastUpdated(new Date());
    setIsLoading(false);

    if (filtered.length > 0) {
      toast.success(`${filtered.length} noticias cargadas y traducidas`);
    } else if (errors.length > 0) {
      toast.error('No se pudieron obtener noticias de las fuentes');
    } else {
      toast.info('No se encontraron noticias recientes');
    }
  }, []);

  /* ── Auto-fetch on mount ── */
  useEffect(() => { fetchNews(); }, [fetchNews]);

  /* ── Filtered + grouped news ── */
  const filteredNews = useMemo(() => {
    if (filter === 'all') return news;
    if (filter === 'calendar') return news.filter(n => n._isCalendar);
    return news.filter(n => n.impact === filter);
  }, [news, filter]);

  /* ── Upcoming high-impact events (next 48h) ── */
  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    const in48h = now + 48 * 60 * 60 * 1000;
    return news
      .filter(n => n._isCalendar && n.ts >= now && n.ts <= in48h)
      .sort((a, b) => a.ts - b.ts);
  }, [news]);

  const groups = useMemo(() => groupByPeriod(filteredNews), [filteredNews]);

  /* ── Impact counts ── */
  const counts = useMemo(() => ({
    all: news.length,
    high: news.filter(n => n.impact === 'high').length,
    medium: news.filter(n => n.impact === 'medium').length,
    calendar: news.filter(n => n._isCalendar).length,
  }), [news]);

  /* ── Render a section ── */
  const renderSection = (title, icon, items) => {
    if (!items.length) return null;
    return (
      <div key={title} className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          {icon}
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{items.length}</span>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => {
            const imp = impactCfg[item.impact] || impactCfg.low;
            const Icon = imp.icon;
            return (
              <Card
                key={`${item.ts}-${idx}`}
                className={cn('border-l-4 border-border/50 cursor-pointer hover:bg-accent/30 transition-all', imp.color)}
                onClick={() => item.link && window.open(item.link, '_blank', 'noopener')}
              >
                <CardContent className="p-3 sm:p-4 flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    <Icon className={cn('w-4 h-4', imp.badge.split(' ')[1])} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold border', imp.badge)}>{imp.label}</span>
                      {item._isCalendar && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">📅 Evento</span>
                      )}
                      {item._isFuture && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-blue-500/15 text-blue-400 border-blue-500/30">Próximo</span>
                      )}
                      <span className="text-[10px] text-muted-foreground font-medium">{item.source}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground leading-tight line-clamp-2">{item.title}</h4>
                    {item.desc && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{item.desc}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span className="font-mono">{item.dateStr}</span>
                      </div>
                      <span className="text-[10px] text-primary/70 font-medium">{item.relative}</span>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between p-4 bg-card rounded-xl border border-border/50">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-primary" />
            Noticias del Mercado
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Forex Factory · Google News · Yahoo Finance · MarketWatch
            {lastUpdated && (
              <span className="ml-2 text-primary/70">
                — Actualizado: {fmtDateET(lastUpdated)}
              </span>
            )}
          </p>
        </div>
        <Button onClick={fetchNews} disabled={isLoading} size="sm" className="bg-primary hover:bg-primary/90">
          <RefreshCw className={cn('w-4 h-4 mr-2', isLoading && 'animate-spin')} />
          Actualizar
        </Button>
      </div>

      {/* ── Feed errors ── */}
      {feedErrors.length > 0 && !isLoading && (
        <div className="px-3 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg text-[11px] text-orange-400">
          <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
          No se pudo acceder a: {[...new Set(feedErrors)].join(', ')}
        </div>
      )}

      {/* ── Filter tabs ── */}
      {news.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all border',
                filter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-border/50 hover:bg-muted'
              )}
            >
              {f.label} ({counts[f.key] ?? 0})
            </button>
          ))}
        </div>
      )}

      {/* ── Loading ── */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Buscando noticias financieras...</p>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && news.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No se encontraron noticias. Intenta actualizar.</p>
        </div>
      )}

      {/* ── Upcoming economic events (next 48h) ── */}
      {!isLoading && upcomingEvents.length > 0 && filter !== 'calendar' && (
        <div className="p-3 bg-yellow-500/5 border border-yellow-500/30 rounded-xl space-y-2">
          <h3 className="text-xs font-bold text-yellow-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Próximos Eventos Económicos ({upcomingEvents.length})
          </h3>
          <div className="grid gap-1.5">
            {upcomingEvents.map((ev, i) => {
              const imp = impactCfg[ev.impact] || impactCfg.low;
              return (
                <div
                  key={`upcoming-${i}`}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer hover:bg-accent/20 transition-all',
                    ev.impact === 'high' ? 'border-red-500/30 bg-red-500/5' : 'border-border/30 bg-muted/30'
                  )}
                  onClick={() => window.open(ev.link, '_blank', 'noopener')}
                >
                  <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold border', imp.badge)}>{imp.label}</span>
                  <span className="text-[11px] font-semibold text-foreground flex-1 truncate">{ev.title}</span>
                  {ev.desc && <span className="text-[10px] text-muted-foreground hidden sm:inline">{ev.desc}</span>}
                  <span className="text-[10px] font-mono text-primary/80 whitespace-nowrap">{ev.dateStr}</span>
                  <span className="text-[10px] font-medium text-yellow-400 whitespace-nowrap">{fmtRelative(ev.date)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── News grouped by period ── */}
      {!isLoading && filteredNews.length > 0 && (
        <div className="space-y-6">
          {renderSection(
            'Hoy',
            <Calendar className="w-4 h-4 text-primary" />,
            groups.hoy
          )}
          {renderSection(
            'Ayer',
            <Clock className="w-4 h-4 text-blue-400" />,
            groups.ayer
          )}
          {renderSection(
            'Esta Semana',
            <Calendar className="w-4 h-4 text-orange-400" />,
            groups.semana
          )}
          {renderSection(
            'Anteriores',
            <Calendar className="w-4 h-4 text-muted-foreground" />,
            groups.anterior
          )}
        </div>
      )}

      {/* ── Summary bar ── */}
      {!isLoading && news.length > 0 && (
        <div className="flex items-center justify-center gap-4 py-3 text-[10px] text-muted-foreground border-t border-border/30">
          <span>Total: <strong className="text-foreground">{news.length}</strong></span>
          <span className="text-red-400">Alto: <strong>{counts.high}</strong></span>
          <span className="text-orange-400">Medio: <strong>{counts.medium}</strong></span>
          <span className="text-emerald-400">Bajo: <strong>{news.length - counts.high - counts.medium}</strong></span>
          <span className="text-yellow-400">📅 Calendario: <strong>{counts.calendar}</strong></span>
        </div>
      )}
    </div>
  );
}