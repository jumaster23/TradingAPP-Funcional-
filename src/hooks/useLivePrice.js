import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { hasBase44Config } from '@/lib/backendGuard';

/**
 * Polls the backend getStockPrice function every `intervalMs` milliseconds.
 * Uses a cancel token per effect run to avoid stale data from previous tickers.
 */
export function useLivePrice(ticker, intervalMs = 5000) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!hasBase44Config()) {
      setData(null);
      setIsLoading(false);
      return;
    }
    if (!ticker || ticker.length < 2) {
      setData(null);
      setIsLoading(false);
      return;
    }
    // Reset stale data immediately when ticker changes
    setData(null);

    let cancelled = false;

    const fetchPrice = async () => {
      if (cancelled) return;
      setIsLoading(true);
      try {
        const res = await base44.functions.invoke('getStockPrice', { ticker });
        const d = res?.data;
        if (!cancelled && d && !d.error) {
          const price = d.current_price ?? null;
          const prevClose = d.prev_close ?? null;
          setData({
            price,
            prevClose,
            open: d.today_open ?? null,
            high: d.today_high ?? null,
            low: d.today_low ?? null,
            volume: d.volume ?? null,
            change: price != null && prevClose != null ? parseFloat((price - prevClose).toFixed(2)) : null,
            changePct: price != null && prevClose != null
              ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2))
              : null,
            lastUpdated: new Date(),
          });
        }
      } catch (_) {
        // silently ignore
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchPrice();
    const id = setInterval(fetchPrice, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ticker, intervalMs]);

  if (!data) return { isLoading };
  return { ...data, isLoading };
}