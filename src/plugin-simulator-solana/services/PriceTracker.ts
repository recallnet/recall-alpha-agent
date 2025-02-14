import { PriceSource, TokenInfo } from '../types/index.ts';
import { JupiterProvider } from '../providers/JupiterProvider.ts';
import { SerumProvider } from '../providers/SerumProvider.ts';
import { SolanaProvider } from '../providers/SolanaProvider.ts';
import { RaydiumProvider } from '../providers/RaydiumProvider.ts';

export class PriceTracker {
  private providers: PriceSource[];
  private priceCache: Map<string, { price: number; timestamp: number }>;
  private readonly CACHE_DURATION = 30000; // 30 seconds
  private readonly TRUMP_TOKEN = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';

  constructor() {
    // Initialize providers
    const jupiterProvider = new JupiterProvider();
    const raydiumProvider = new RaydiumProvider();
    const serumProvider = new SerumProvider();
    const solanaProvider = new SolanaProvider();

    this.providers = [
      jupiterProvider, // Jupiter for most tokens
      raydiumProvider, // Raydium for TRUMP specific pricing
      serumProvider, // Serum as fallback
      solanaProvider, // Basic Solana chain data
    ];
    this.priceCache = new Map();
  }

  async getPrice(tokenAddress: string): Promise<number | null> {
    console.log(`[PriceTracker] Getting price for token: ${tokenAddress}`);

    // Check cache first
    const cached = this.priceCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log(`[PriceTracker] Using cached price for ${tokenAddress}: $${cached.price}`);
      return cached.price;
    }

    // For TRUMP token, try Raydium first as it has our fixed rate
    if (tokenAddress === this.TRUMP_TOKEN) {
      console.log(`[PriceTracker] Using Raydium for TRUMP token price`);
      const raydiumProvider = this.providers.find((p) => p.getName() === 'Raydium');
      if (raydiumProvider) {
        const price = await raydiumProvider.getPrice(tokenAddress);
        if (price !== null) {
          console.log(`[PriceTracker] Got TRUMP price $${price} from Raydium`);
          this.priceCache.set(tokenAddress, {
            price,
            timestamp: Date.now(),
          });
          return price;
        }
      }
    }

    // Try each provider in sequence until we get a price
    for (const provider of this.providers) {
      try {
        console.log(`\n[PriceTracker] Attempting to get price from ${provider.getName()}`);
        const price = await provider.getPrice(tokenAddress);

        if (price !== null) {
          console.log(`[PriceTracker] Got price $${price} from ${provider.getName()}`);
          this.priceCache.set(tokenAddress, {
            price,
            timestamp: Date.now(),
          });
          return price;
        } else {
          console.log(`[PriceTracker] No price available from ${provider.getName()}`);
        }
      } catch (error) {
        console.error(
          `[PriceTracker] Error fetching price from ${provider.getName()}:`,
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : 'Unknown error',
        );
        continue;
      }
    }

    console.log(`[PriceTracker] No price available for ${tokenAddress} from any provider`);
    return null;
  }

  async isTokenSupported(tokenAddress: string): Promise<boolean> {
    for (const provider of this.providers) {
      try {
        if (await provider.supports(tokenAddress)) {
          console.log(`[PriceTracker] Token ${tokenAddress} is supported by ${provider.getName()}`);
          return true;
        }
      } catch (error) {
        continue;
      }
    }
    console.log(`[PriceTracker] No providers support token ${tokenAddress}`);
    return false;
  }
}
