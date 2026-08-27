// 後台服務客戶端
export interface PriceTarget {
  targetPrice: number;
  duration: number;
}

export interface PriceUpdate {
  price: number;
  targetPrice: number | null;
  progress: number;
  elapsed: number;
  duration: number;
  isComplete: boolean;
}

class BackendClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  private baseUrl: string;

  constructor() {
    // 生產環境使用相對路徑，開發環境使用 localhost:3001
    this.baseUrl = import.meta.env.PROD 
      ? '' 
      : 'http://localhost:3001';
  }

  // 連接到 WebSocket
  connect() {
    const wsUrl = import.meta.env.PROD
      ? `wss://${window.location.host}`
      : 'ws://localhost:3001';

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('✅ 已連接到後台服務器');
      this.emit('connected', null);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('WebSocket 消息解析失敗:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('❌ WebSocket 連接斷開，嘗試重連...');
      this.emit('disconnected', null);
      this.reconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket 錯誤:', error);
      this.emit('error', error);
    };
  }

  // 處理消息
  private handleMessage(data: any) {
    switch (data.type) {
      case 'init':
        this.emit('init', data);
        break;
      case 'priceUpdate':
        this.emit('priceUpdate', data);
        break;
      case 'targetReached':
        this.emit('targetReached', data);
        break;
      default:
        console.log('未知消息類型:', data.type);
    }
  }

  // 重連
  private reconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  // 設定價格目標 (REST API)
  async setPriceTarget(targetPrice: number, duration: number): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/price/target`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetPrice, duration }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '設定失敗');
    }

    return response.json();
  }

  // 重置價格
  async resetPrice(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/price/reset`, {
      method: 'POST',
    });
    return response.json();
  }

  // 暫停/繼續
  async togglePause(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/price/toggle`, {
      method: 'POST',
    });
    return response.json();
  }

  // 獲取當前價格狀態
  async getPriceStatus(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/price`);
    return response.json();
  }

  // 事件監聽
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error('事件回調執行失敗:', error);
        }
      });
    }
  }

  // 斷開連接
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const backendClient = new BackendClient();