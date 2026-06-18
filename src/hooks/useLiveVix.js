import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { hasBase44Config } from '@/lib/backendGuard';

/**
 * Polls the getVix backend function every `intervalMs` milliseconds.
 * Uses a cancel token per effect run to avoid stale state updates.
 */
export function useLiveVix(intervalMs = 10000) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!hasBase44Config()) {
      setData(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    const fetchVix = async () => {
      if (cancelled) return;
      setIsLoading(true);
      try {
        const res = await base44.functions.invoke('getVix', {});
        const d = res?.data;
        if (!cancelled && d && !d.error) {
          setData({
            vix: d.vix ?? null,
            regime: d.regime ?? null,
            vix_change: d.vix_change ?? null,
            vix_change_pct: d.vix_change_pct ?? null,
            impact_note: d.impact_note ?? null,
            lastUpdated: new Date(),
          });
        }
      } catch (_) {
        // silently ignore
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchVix();
    const id = setInterval(fetchVix, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { ...(data || {}), isLoading };
}