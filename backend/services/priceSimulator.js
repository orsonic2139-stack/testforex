import { EventEmitter } from 'events';

export class PriceSimulator extends EventEmitter {
  constructor(initialPrice = 2485.00) {
    super();
    this.currentPrice = initialPrice;
    this.initialPrice = initialPrice;
    this.targetPrice = null;
    this.duration = 0;
    this.elapsed = 0;
    this.isPaused = false;
    this.isRunning = false;
    this.updateInterval = null;
    this.lastUpdateTime = null;
  }

  // 獲取當前價格
  getCurrentPrice() {
    return this.currentPrice;
  }

  // 獲取目標價格
  getTargetPrice() {
    return this.targetPrice;
  }

  // 獲取進度 (0-1)
  getProgress() {
    if (!this.targetPrice || this.duration === 0) return 0;
    return Math.min(this.elapsed / this.duration, 1);
  }

  // 是否正在運行
  isRunning() {
    return this.isRunning;
  }

  // 設置目標
  setTarget(targetPrice, durationSeconds) {
    // 驗證
    if (targetPrice <= 0) {
      throw new Error('目標價格必須大於 0');
    }
    if (durationSeconds < 1) {
      throw new Error('持續時間至少為 1 秒');
    }

    // 停止當前的模擬
    this.stop();

    // 設定新目標
    this.targetPrice = targetPrice;
    this.duration = durationSeconds;
    this.elapsed = 0;
    this.initialPrice = this.currentPrice;
    this.isPaused = false;
    this.isRunning = true;
    this.lastUpdateTime = Date.now();

    // 開始模擬
    this.start();

    return {
      currentPrice: this.currentPrice,
      targetPrice: this.targetPrice,
      duration: this.duration,
      message: `將在 ${durationSeconds} 秒內從 ${this.currentPrice.toFixed(2)} 達到 ${targetPrice.toFixed(2)}`,
    };
  }

  // 開始模擬
  start() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.lastUpdateTime = Date.now();

    // 使用 requestAnimationFrame 風格的 setInterval
    this.updateInterval = setInterval(() => {
      this.update();
    }, 50); // 每 50ms 更新一次，實現平滑動畫
  }

  // 更新價格
  update() {
    if (this.isPaused) {
      this.lastUpdateTime = Date.now();
      return;
    }

    const now = Date.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000; // 秒
    this.lastUpdateTime = now;

    this.elapsed += deltaTime;

    // 計算進度 (0 到 1)
    let progress = Math.min(this.elapsed / this.duration, 1);

    // 使用 easeInOut 緩動函數，讓價格變化更自然
    const easedProgress = this.easeInOut(progress);

    // 計算當前價格（線性插值）
    const priceRange = this.targetPrice - this.initialPrice;
    this.currentPrice = this.initialPrice + priceRange * easedProgress;

    // 四捨五入到小數點後 2 位
    this.currentPrice = Math.round(this.currentPrice * 100) / 100;

    // 發送更新事件
    this.emit('update', {
      price: this.currentPrice,
      targetPrice: this.targetPrice,
      progress: progress,
      elapsed: this.elapsed,
      duration: this.duration,
      isComplete: progress >= 1,
    });

    // 檢查是否達到目標
    if (progress >= 1) {
      this.currentPrice = this.targetPrice;
      this.stop();

      this.emit('targetReached', {
        price: this.currentPrice,
        targetPrice: this.targetPrice,
        duration: this.duration,
        message: `✅ 已達到目標價格 ${this.targetPrice.toFixed(2)}`,
      });
    }
  }

  // 緩動函數 (easeInOut)
  easeInOut(t) {
    return t < 0.5 
      ? 2 * t * t 
      : -1 + (4 - 2 * t) * t;
  }

  // 停止模擬
  stop() {
    this.isRunning = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  // 暫停/繼續
  togglePause() {
    this.isPaused = !this.isPaused;
    if (!this.isPaused) {
      this.lastUpdateTime = Date.now();
    }
    return this.isRunning;
  }

  // 重置
  reset() {
    this.stop();
    this.currentPrice = this.initialPrice;
    this.targetPrice = null;
    this.duration = 0;
    this.elapsed = 0;
    this.isPaused = false;
    this.isRunning = false;

    this.emit('update', {
      price: this.currentPrice,
      targetPrice: null,
      progress: 0,
      elapsed: 0,
      duration: 0,
      isComplete: true,
    });

    return this.currentPrice;
  }

  // 清理資源
  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}