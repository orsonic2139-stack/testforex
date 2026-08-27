import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
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

// ============================================================
// Supabase 配置
// ============================================================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mjdodjohycnegtbqkdms.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qZG9kam9oeWNuZWd0YnFrZG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NTcyNTMsImV4cCI6MjEwMzQzMzI1M30.s2s0BACICEKAAAOoifZhdZixvEh9bnm0gpeUklp_xY4';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  const isBackendControlledRef = useRef<boolean>(false);

  // ============================================================
  // 讀取 Supabase 後台價格
  // ============================================================
  const loadBackendPrice = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('price_control')
        .select('current_price, is_running, target_price, is_complete')
        .limit(1)
        .order('id', { ascending: true });

      if (error) {
        console.warn('讀取 Supabase 價格失敗:', error.message);
        return null;
      }

      if (data && data.length > 0) {
        const record = data[0];
        // 如果後台正在運行，使用後台價格
        if (record.is_running || record.is_complete) {
          isBackendControlledRef.current = true;
          return {
            price: record.current_price,
            isRunning: record.is_running,
            targetPrice: record.target_price,
            isComplete: record.is_complete,
          };
        }
      }
    } catch (err) {
      console.warn('讀取 Supabase 價格異常:', err);
    }
    return null;
  }, []);

  // ============================================================
  // Fetch historical candles when timeframe changes
  // ============================================================
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

  // ============================================================
  // 獲取初始 Quote（優先使用 Supabase 後台價格）
  // ============================================================
  useEffect(() => {
    let cancelled = false;

    const initQuote = async () => {
      try {
        // 1. 先嚐試讀取 Supabase 後台價格
        const backendData = await loadBackendPrice();
        
        if (backendData && backendData.price) {
          // 使用後台價格
          const price = backendData.price;
          lastPriceRef.current = price;
          isBackendControlledRef.current = true;
          
          setQuote({
            bid: round2(price - 0.18),
            ask: round2(price + 0.18),
            last: price,
            spread: 0.36,
            change: 0,
            changePercent: 0,
            open: price,
            high: price,
            low: price,
            previousClose: price,
            timestamp: Date.now(),
          });
          return;
        }

        // 2. 如果沒有後台價格，使用 Provider 的 Quote
        const q = await providerRef.current.getCurrentQuote();
        if (cancelled || !q) return;
        setQuote(q);
        lastPriceRef.current = q.last;
      } catch (err) {
        console.warn('獲取初始價格失敗:', err);
      }
    };

    initQuote();

    return () => {
      cancelled = true;
    };
  }, [loadBackendPrice]);

  // ============================================================
  // 訂閱 Supabase Realtime（監聽後台價格變化）
  // ============================================================
  useEffect(() => {
    const channel = supabase
      .channel('price_control_sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'price_control',
        },
        (payload) => {
          const record = payload.new;
          
          if (record.current_price !== undefined && record.current_price !== null) {
            const newPrice = record.current_price;
            const prevPrice = lastPriceRef.current;
            
            // 更新價格方向
            if (prevPrice !== null) {
              if (newPrice > prevPrice) {
                setPriceDirection('up');
              } else if (newPrice < prevPrice) {
                setPriceDirection('down');
              }
              
              if (dirTimeoutRef.current) {
                clearTimeout(dirTimeoutRef.current);
              }
              dirTimeoutRef.current = setTimeout(() => setPriceDirection(null), 600);
            }
            
            lastPriceRef.current = newPrice;
            isBackendControlledRef.current = true;

            // 更新 Quote
            setQuote((prevQuote) => {
              if (!prevQuote) {
                return {
                  bid: round2(newPrice - 0.18),
                  ask: round2(newPrice + 0.18),
                  last: newPrice,
                  spread: 0.36,
                  change: 0,
                  changePercent: 0,
                  open: newPrice,
                  high: newPrice,
                  low: newPrice,
                  previousClose: newPrice,
                  timestamp: Date.now(),
                };
              }
              return {
                ...prevQuote,
                bid: round2(newPrice - 0.18),
                ask: round2(newPrice + 0.18),
                last: newPrice,
                spread: round2(0.36),
                high: Math.max(prevQuote.high, newPrice),
                low: Math.min(prevQuote.low, newPrice),
                change: round2(newPrice - prevQuote.previousClose),
                changePercent: round2(
                  ((newPrice - prevQuote.previousClose) / prevQuote.previousClose) * 100
                ),
                timestamp: Date.now(),
              };
            });

            // 如果後台模擬完成，更新狀態
            if (record.is_complete) {
              console.log('✅ 後台價格目標已達成:', newPrice);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📡 Supabase Realtime 已訂閱 price_control 表');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ============================================================
  // 訂閱 Provider 的即時價格更新（僅在非後台控制時使用）
  // ============================================================
  useEffect(() => {
    const provider = providerRef.current;
    
    const callback = (update: PriceUpdate) => {
      // 如果後台正在控制，跳過 Provider 的價格更新
      if (isBackendControlledRef.current) {
        // 但還是更新 lastUpdate 以便顯示
        setLastUpdate(update);
        return;
      }

      setLastUpdate(update);
      const prev = lastPriceRef.current;
      
      if (prev !== null) {
        if (update.last > prev) {
          setPriceDirection('up');
        } else if (update.last < prev) {
          setPriceDirection('down');
        }

        if (dirTimeoutRef.current) {
          clearTimeout(dirTimeoutRef.current);
        }
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

    // 定期更新市場會話資訊
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
      if (dirTimeoutRef.current) {
        clearTimeout(dirTimeoutRef.current);
      }
    };
  }, []);

  // ============================================================
  // 手動刷新
  // ============================================================
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

  // ============================================================
  // 切換到後台控制模式
  // ============================================================
  const enableBackendControl = useCallback(() => {
    isBackendControlledRef.current = true;
  }, []);

  // ============================================================
  // 切換回 Provider 模式
  // ============================================================
  const disableBackendControl = useCallback(() => {
    isBackendControlledRef.current = false;
  }, []);

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
    // 新增導出
    isBackendControlled: isBackendControlledRef.current,
    enableBackendControl,
    disableBackendControl,
    loadBackendPrice,
  };
}

// ============================================================
// 工具函數
// ============================================================
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}