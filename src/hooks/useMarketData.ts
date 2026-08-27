import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  Candle,
  ConnectionStatus,
  MarketStatus,
  PriceUpdate,
  Quote,
  Timeframe,
} from '@/types';
import {
  createMarketDataProvider,
  getGoldMarketSession,
} from '@/services/marketData';

export interface MarketDataState {
  quote: Quote | null;
  status: ConnectionStatus;
  marketStatus: MarketStatus;
  candles: Candle[];
  loading: boolean;
  error: string | null;
  lastUpdate: PriceUpdate | null;
  priceDirection: 'up' | 'down' | null;
}

export function useMarketData(timeframe: Timeframe) {
  const providerRef = useRef(createMarketDataProvider());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(providerRef.current.mode);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(
    providerRef.current.getMarketStatus()
  );
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<PriceUpdate | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);
  const lastPriceRef = useRef<number | null>(null);
  const dirTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch historical candles when timeframe changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    providerRef.current
      .getHistoricalCandles(timeframe, 500)
      .then((data) => {
        if (cancelled) return;
        setCandles(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load chart data');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  // Fetch initial quote
  useEffect(() => {
    let cancelled = false;
    providerRef.current
      .getCurrentQuote()
      .then((q) => {
        if (cancelled || !q) return;
        setQuote(q);
        lastPriceRef.current = q.last;
      })
      .catch(() => {
        // Non-fatal; subscription will provide updates
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to live price updates
  useEffect(() => {
    const provider = providerRef.current;
    const callback = (update: PriceUpdate) => {
      setLastUpdate(update);
      const prev = lastPriceRef.current;
      if (prev !== null) {
        if (update.last > prev) setPriceDirection('up');
        else if (update.last < prev) setPriceDirection('down');

        if (dirTimeoutRef.current) clearTimeout(dirTimeoutRef.current);
        dirTimeoutRef.current = setTimeout(() => setPriceDirection(null), 600);
      }
      lastPriceRef.current = update.last;

      setQuote((prevQuote) => {
        if (!prevQuote) {
          return {
            bid: update.bid,
            ask: update.ask,
            last: update.last,
            spread: round2(update.ask - update.bid),
            change: 0,
            changePercent: 0,
            open: update.last,
            high: update.last,
            low: update.last,
            previousClose: update.last,
            timestamp: update.timestamp,
          };
        }
        return {
          ...prevQuote,
          bid: update.bid,
          ask: update.ask,
          last: update.last,
          spread: round2(update.ask - update.bid),
          high: Math.max(prevQuote.high, update.last),
          low: Math.min(prevQuote.low, update.last),
          change: round2(update.last - prevQuote.previousClose),
          changePercent: round2(
            ((update.last - prevQuote.previousClose) / prevQuote.previousClose) * 100
          ),
          timestamp: update.timestamp,
        };
      });
    };

    provider.subscribeToPriceUpdates(callback);

    // Update market session info periodically
    const sessionInterval = setInterval(() => {
      const session = getGoldMarketSession();
      setMarketStatus({
        status: provider.mode,
        label: provider.getMarketStatus().label,
        isMarketOpen: session.isOpen,
        sessionName: session.session,
      });
    }, 5000);

    return () => {
      provider.unsubscribe();
      clearInterval(sessionInterval);
      if (dirTimeoutRef.current) clearTimeout(dirTimeoutRef.current);
    };
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    providerRef.current
      .getHistoricalCandles(timeframe, 500)
      .then((data) => {
        setCandles(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [timeframe]);

  return {
    quote,
    status,
    marketStatus,
    candles,
    loading,
    error,
    lastUpdate,
    priceDirection,
    refresh,
    provider: providerRef.current,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
