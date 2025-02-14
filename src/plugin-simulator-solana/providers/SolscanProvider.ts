import { PriceSource, TokenInfo } from '../types/index.ts';
import axios from 'axios';

export class SolscanProvider implements PriceSource {
  private readonly API_BASE = 'https://pro-api.solscan.io/v2.0/token/price';
  private cache: Map<string, { price: number; timestamp: number }>;
  private readonly CACHE_DURATION = 30000; // 30 seconds
  private lastRequestTime: number = 0;
  private readonly MIN_REQUEST_INTERVAL = 100; // 100ms between requests
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second
  private readonly apiKey: string;

  constructor() {
    this.cache = new Map();
    this.apiKey = process.env.SOLSCAN_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[Solscan] Warning: No API key provided. Price fetching may fail.');
    }
  }

  getName(): string {
    return 'Solscan';
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
      await this.delay(this.MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  private getCachedPrice(tokenAddress: string): number | null {
    const cached = this.cache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.price;
    }
    return null;
  }

  private setCachedPrice(tokenAddress: string, price: number): void {
    this.cache.set(tokenAddress, {
      price,
      timestamp: Date.now(),
    });
  }

  async getPrice(tokenAddress: string): Promise<number | null> {
    try {
      // Check cache first
      const cachedPrice = this.getCachedPrice(tokenAddress);
      if (cachedPrice !== null) {
        console.log(`[Solscan] Using cached price for ${tokenAddress}: $${cachedPrice}`);
        return cachedPrice;
      }

      if (!this.apiKey) {
        console.error('[Solscan] No API key available');
        return null;
      }

      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          await this.enforceRateLimit();

          const response = await axios.get(this.API_BASE, {
            params: {
              address: tokenAddress,
            },
            headers: {
              token: this.apiKey,
              Accept: 'application/json',
              'User-Agent': 'TradingModule/1.0',
            },
            timeout: 5000,
          });

          console.log(`[Solscan] Received response status: ${response.status}`);

          if (!response.data?.data?.priceUsdt) {
            console.log(`[Solscan] No price data found for token: ${tokenAddress}`);
            return null;
          }

          const price = parseFloat(response.data.data.priceUsdt);
          if (isNaN(price) || price <= 0) {
            console.log(`[Solscan] Invalid price format for token: ${tokenAddress}`);
            return null;
          }

          this.setCachedPrice(tokenAddress, price);
          console.log(`[Solscan] Successfully fetched price for ${tokenAddress}: $${price}`);
          return price;
        } catch (error) {
          if (attempt === this.MAX_RETRIES) {
            throw error;
          }
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            console.log('[Solscan] API key level insufficient, falling back to other providers');
            return null;
          }
          console.log(`[Solscan] Attempt ${attempt} failed, retrying after delay...`);
          if (axios.isAxiosError(error)) {
            console.error(`[Solscan] Axios error details:`, {
              message: error.message,
              code: error.code,
              status: error.response?.status,
              data: error.response?.data,
              config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers,
              },
            });
          }
          await this.delay(this.RETRY_DELAY * attempt);
        }
      }
      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          console.log('[Solscan] API key level insufficient, falling back to other providers');
          return null;
        }
        console.error(`[Solscan] API error for ${tokenAddress}:`, {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data,
          config: {
            url: error.config?.url,
            method: error.config?.method,
            headers: error.config?.headers,
          },
        });
      } else {
        console.error(
          `[Solscan] Unexpected error for ${tokenAddress}:`,
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : 'Unknown error',
        );
      }
      return null;
    }
  }

  async supports(tokenAddress: string): Promise<boolean> {
    try {
      console.log(`[Solscan] Checking support for token: ${tokenAddress}`);
      if (!this.apiKey) {
        return false;
      }

      // First check cache
      if (this.getCachedPrice(tokenAddress) !== null) {
        return true;
      }

      const price = await this.getPrice(tokenAddress);
      return price !== null;
    } catch (error) {
      console.error(`[Solscan] Error checking token support:`, error);
      return false;
    }
  }
}
