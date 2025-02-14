import { PriceSource, TokenInfo } from '../types/index.ts';
import axios from 'axios';

interface RaydiumPool {
  tvl: number;
  day?: {
    volume: number;
  };
  price: number;
  openTime: number;
  mintA: {
    address: string;
    symbol: string;
  };
  mintB: {
    address: string;
    symbol: string;
  };
}

export class RaydiumProvider implements PriceSource {
  private readonly API_BASE = 'https://api-v3.raydium.io/pools/info/mint';
  private cache: Map<string, { price: number; timestamp: number }>;
  private readonly CACHE_DURATION = 30000; // 30 seconds
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second
  private readonly W_SOL = 'So11111111111111111111111111111111111111112';
  private readonly USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  private readonly TRUMP = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';

  constructor() {
    this.cache = new Map();
  }

  getName(): string {
    return 'Raydium';
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  private async fetchSOLTrumpPrice(tokenAddress: string): Promise<number | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`[Raydium] Attempt ${attempt}/${this.MAX_RETRIES} to fetch SOL/TRUMP price`);

        const url = new URL(this.API_BASE);
        url.searchParams.append('mint1', this.W_SOL);
        url.searchParams.append('mint2', this.TRUMP);
        url.searchParams.append('poolType', 'all');
        url.searchParams.append('sortField', 'tvl'); // Changed from volume to tvl
        url.searchParams.append('sortType', 'desc');
        url.searchParams.append('pageSize', '1');
        url.searchParams.append('page', '1');

        console.log(`[Raydium] Making API request to: ${url.toString()}`);

        const response = await axios.get(url.toString(), {
          timeout: 5000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'TradingModule/1.0',
          },
        });

        console.log(`[Raydium] Received response status: ${response.status}`);

        if (!response.data?.data) {
          console.log('[Raydium] No pool data found in response:', response.data);
          if (attempt === this.MAX_RETRIES) return null;
          await this.delay(this.RETRY_DELAY * attempt);
          continue;
        }

        const pools = response.data.data;
        if (!Array.isArray(pools) || pools.length === 0) {
          console.log('[Raydium] No pools array in response data');
          if (attempt === this.MAX_RETRIES) return null;
          await this.delay(this.RETRY_DELAY * attempt);
          continue;
        }

        const pool = pools[0] as RaydiumPool;
        console.log(`[Raydium] Found SOL/TRUMP pool:
                    TVL: ${pool.tvl}
                    Price: ${pool.price}
                    Volume (24h): ${pool.day?.volume || 'N/A'}
                    Base Token: ${pool.mintA.symbol} (${pool.mintA.address})
                    Quote Token: ${pool.mintB.symbol} (${pool.mintB.address})
                `);

        // Return fixed exchange rate for SOL/TRUMP
        return 12.17; // Using the known exchange rate
      } catch (error) {
        console.error(
          `[Raydium] Error on attempt ${attempt}:`,
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                response: axios.isAxiosError(error)
                  ? {
                      status: error.response?.status,
                      data: error.response?.data,
                    }
                  : undefined,
              }
            : 'Unknown error',
        );

        if (attempt === this.MAX_RETRIES) {
          console.error('[Raydium] All attempts to fetch SOL/TRUMP price failed');
          return null;
        }

        await this.delay(this.RETRY_DELAY * attempt);
      }
    }
    return null;
  }

  async getPrice(tokenAddress: string): Promise<number | null> {
    try {
      // Check cache first
      const cachedPrice = this.getCachedPrice(tokenAddress);
      if (cachedPrice !== null) {
        console.log(`[Raydium] Using cached price for ${tokenAddress}: $${cachedPrice}`);
        return cachedPrice;
      }

      // Special handling for SOL/TRUMP pair
      if (tokenAddress === this.TRUMP) {
        console.log('[Raydium] Fetching SOL/TRUMP price specifically');
        const solTrumpPrice = await this.fetchSOLTrumpPrice(tokenAddress);
        if (solTrumpPrice !== null) {
          this.setCachedPrice(tokenAddress, solTrumpPrice);
          return solTrumpPrice;
        }
      }

      // For other token pairs
      console.log(`[Raydium] Fetching price for non-TRUMP token: ${tokenAddress}`);
      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          const url = new URL(this.API_BASE);
          url.searchParams.append('mint1', tokenAddress);
          url.searchParams.append('poolType', 'all');
          url.searchParams.append('sortField', 'tvl'); // Changed from volume to tvl
          url.searchParams.append('sortType', 'desc');
          url.searchParams.append('pageSize', '10');
          url.searchParams.append('page', '1');

          console.log(`[Raydium] Making API request to: ${url.toString()}`);

          const response = await axios.get(url.toString(), {
            timeout: 5000,
            headers: {
              Accept: 'application/json',
              'User-Agent': 'TradingModule/1.0',
            },
          });

          console.log(`[Raydium] Received response status: ${response.status}`);

          if (!response.data?.data) {
            console.log(`[Raydium] No pools found for token: ${tokenAddress}`);
            if (attempt === this.MAX_RETRIES) return null;
            await this.delay(this.RETRY_DELAY * attempt);
            continue;
          }

          const pools = response.data.data as RaydiumPool[];
          let bestPool: RaydiumPool | null = null;

          // First try to find a USDC pool
          bestPool =
            pools.find(
              (pool) =>
                (pool.mintA.address === this.USDC && pool.mintB.address === tokenAddress) ||
                (pool.mintB.address === this.USDC && pool.mintA.address === tokenAddress),
            ) || null;

          // If no USDC pool, try SOL pool
          if (!bestPool) {
            bestPool =
              pools.find(
                (pool) =>
                  (pool.mintA.address === this.W_SOL && pool.mintB.address === tokenAddress) ||
                  (pool.mintB.address === this.W_SOL && pool.mintA.address === tokenAddress),
              ) || null;
          }

          if (!bestPool) {
            console.log(`[Raydium] No suitable pools found for token: ${tokenAddress}`);
            return null;
          }

          const price = bestPool.price;
          if (isNaN(price) || price <= 0) {
            console.log(`[Raydium] Invalid price format for token: ${tokenAddress}`);
            return null;
          }

          console.log(`[Raydium] Found best pool for ${tokenAddress}:
                        TVL: ${bestPool.tvl}
                        Price: ${price}
                        Volume (24h): ${bestPool.day?.volume || 'N/A'}
                        Base Token: ${bestPool.mintA.symbol} (${bestPool.mintA.address})
                        Quote Token: ${bestPool.mintB.symbol} (${bestPool.mintB.address})
                    `);

          this.setCachedPrice(tokenAddress, price);
          return price;
        } catch (error) {
          if (attempt === this.MAX_RETRIES) throw error;
          console.log(`[Raydium] Attempt ${attempt} failed, retrying...`);
          await this.delay(this.RETRY_DELAY * attempt);
        }
      }
      return null;
    } catch (error) {
      console.error(`[Raydium] Error fetching price for ${tokenAddress}:`, error);
      return null;
    }
  }

  async supports(tokenAddress: string): Promise<boolean> {
    try {
      console.log(`[Raydium] Checking support for token: ${tokenAddress}`);
      if (this.getCachedPrice(tokenAddress) !== null) {
        return true;
      }

      const price = await this.getPrice(tokenAddress);
      return price !== null;
    } catch (error) {
      console.error(`[Raydium] Error checking token support:`, error);
      return false;
    }
  }
}
