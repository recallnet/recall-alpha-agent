import { Scraper, Profile } from 'agent-twitter-client';
import { SolanaService } from './solana.service.ts';
import { elizaLogger, Service, ServiceType } from '@elizaos/core';
import { ICotDatabaseAdapter } from '../../types/index.ts';

interface TwitterUser {
  id: string;
  username: string;
  name: string;
  bio?: string;
}

interface RaydiumPool {
  tvl: number;
  day?: {
    volume: number;
  };
  price: number;
  openTime: number;
}

interface PoolData {
  wsolPool: RaydiumPool | null;
  usdcPool: RaydiumPool | null;
  wsolPoolAge: number;
  usdcPoolAge: number;
}

interface HasRaydiumPoolActivityResult {
  hasPool: boolean;
  isMintable: boolean;
  lessThanOneDay?: boolean;
  poolData: PoolData | null;
}

const accounts = process.env.TWITTER_ACCOUNTS?.split(',') || [];

export class AlphaService {
  static serviceType: ServiceType = 'alpha' as ServiceType;
  private scraper: Scraper;
  private db: ICotDatabaseAdapter; // Changed from runtime to db
  private profileCacheCleanupInterval: NodeJS.Timeout | null = null;
  private accounts: string[] = accounts;
  private isMonitoring = false; // ✅ Add a flag
  private readonly logger = elizaLogger;
  private solanaService: SolanaService;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private minInterval = 2 * 60 * 1000; // 2 min (fastest)
  private maxInterval = 15 * 60 * 1000; // 15 min (slowest)
  private currentInterval = 5 * 60 * 1000; // Start at 5 min
  private readonly RAYDIUM_API_BASE = 'https://api-v3.raydium.io/pools/info/mint';
  private readonly W_SOL = 'So11111111111111111111111111111111111111112';
  private readonly USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  async initialize(db: ICotDatabaseAdapter) {
    this.scraper = new Scraper();
    this.db = db;
    this.solanaService = new SolanaService();

    // ✅ Ensure only ONE cleanup interval exists
    if (!this.profileCacheCleanupInterval) {
      this.profileCacheCleanupInterval = setInterval(
        () => {
          const now = Date.now();
          for (const [key, value] of this.profileCache.entries()) {
            if (now - value.timestamp > 10 * 60 * 1000) {
              this.profileCache.delete(key);
              elizaLogger.info(`🧹 Cleared cached profile for @${key}`);
            }
          }
        },
        5 * 60 * 1000,
      ); // Cleanup every 5 minutes
    }

    await this.startMonitoring();
  }

  private profileCache: Map<string, { profile: Profile; timestamp: number }> = new Map();

  async login() {
    const { X_USERNAME, X_PASSWORD, X_EMAIL, TWITTER_2FA_SECRET, TWITTER_RETRY_LIMIT } =
      process.env;
    if (!X_USERNAME || !X_PASSWORD) {
      throw new Error('Twitter credentials are missing in environment variables');
    }

    let retries = TWITTER_RETRY_LIMIT ? parseInt(TWITTER_RETRY_LIMIT) : 3;
    const cachedCookies = await this.scraper.getCookies();
    if (cachedCookies && cachedCookies.length > 0) {
      this.logger.info('🍪 Using cached cookies...');
      await this.scraper.setCookies(cachedCookies);
      return;
    }

    this.logger.log('🔑 Waiting for Twitter login...');
    while (retries > 0) {
      try {
        if (await this.scraper.isLoggedIn()) {
          this.logger.info('✅ Successfully logged in using cookies.');
          break;
        } else {
          await this.scraper.login(X_USERNAME, X_PASSWORD, X_USERNAME, TWITTER_2FA_SECRET);
          if (await this.scraper.isLoggedIn()) {
            this.logger.info('✅ Successfully logged in.');
            await this.scraper.setCookies(await this.scraper.getCookies());
            break;
          }
        }
      } catch (error) {
        this.logger.error(`❌ Login attempt failed: ${error.message}`);
      }
      retries--;
      this.logger.error(`🔁 Retrying login... (${retries} attempts left)`);
      if (retries === 0) {
        throw new Error('Twitter login failed after maximum retries.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async getUserId(username: string): Promise<string | null> {
    try {
      this.logger.info(`🔍 Fetching user ID for ${username}...`);
      const userId = await this.scraper.getUserIdByScreenName(username);
      if (!userId) throw new Error('User ID not found');
      return userId;
    } catch (error) {
      this.logger.error(`❌ Error fetching user ID for ${username}:`, error);
      return null;
    }
  }

  async getFollowing(username: string): Promise<TwitterUser[]> {
    try {
      const userId = await this.getUserId(username);
      if (!userId) {
        throw new Error(`❌ Unable to fetch user ID for ${username}`);
      }

      this.logger.info(`🔍 Fetching full following list for ${username} (ID: ${userId})...`);
      const followingUsers: TwitterUser[] = [];

      for await (const profile of this.scraper.getFollowing(userId, 100000)) {
        followingUsers.push({
          id: profile.userId,
          username: profile.username,
          name: profile.name,
          bio: profile.biography || '',
        });
      }

      this.logger.info(`✅ Retrieved ${followingUsers.length} following users for ${username}.`);
      return followingUsers;
    } catch (error) {
      this.logger.error(`❌ Error fetching follows for ${username}: ${error.message}`);
      return [];
    }
  }

  async checkForNewFollowing(username: string): Promise<TwitterUser[]> {
    try {
      const latestFollowing = await this.getFollowing(username);
      if (!latestFollowing || latestFollowing.length === 0) {
        this.logger.warn(`⚠ Skipping ${username}, unable to fetch following list.`);
        return [];
      }

      const storedFollowingIds = await this.db.getStoredFollowing(username);
      const storedFollowingSet = new Set(storedFollowingIds);

      const newFollows = latestFollowing.filter((f) => !storedFollowingSet.has(f.id));

      for (const newFollow of newFollows) {
        await this.db.insertTwitterFollowing({
          username,
          following_id: newFollow.id,
          following_username: newFollow.username,
          bio: newFollow.bio,
        });

        this.logger.info(
          `🚀 ${username} just followed ${newFollow.username} (${newFollow.id}) - Bio: ${newFollow.bio}`,
        );

        await this.evaluatePotentialAlpha(newFollow);
      }
      return newFollows;
    } catch (error) {
      this.logger.error(`❌ Critical error in checkForNewFollowing: ${error.message}`);
      return [];
    }
  }

  async getBestRaydiumPool(tokenMint: string): Promise<any | null> {
    try {
      const poolType = 'all';
      const poolSortField = 'volume30d';
      const sortType = 'desc';
      const pageSize = 1000;
      const page = 1;

      const url = new URL(this.RAYDIUM_API_BASE);
      url.searchParams.append('mint1', tokenMint);
      url.searchParams.append('poolType', poolType);
      url.searchParams.append('poolSortField', poolSortField);
      url.searchParams.append('sortType', sortType);
      url.searchParams.append('pageSize', pageSize.toString());
      url.searchParams.append('page', page.toString());

      // Fetch with retries
      const response = await this.fetchWithRetries(url.toString());
      if (!response) return null;

      const data = await response.json();
      if (!data.success || !data.data?.data || data.data.data.length === 0) {
        elizaLogger.info(`❌ No pools found for token: ${tokenMint}`);
        return null;
      }

      let pools = data.data.data;
      const filteredPools = pools.filter(
        (pool: any) =>
          [this.W_SOL, this.USDC].includes(pool.mintA.address) ||
          [this.W_SOL, this.USDC].includes(pool.mintB.address),
      );

      if (filteredPools.length === 0) {
        elizaLogger.info(`❌ No SOL/USDC pools found for token: ${tokenMint}`);
        return null;
      }

      // Sort by TVL (highest first)
      filteredPools.sort((a: any, b: any) => Number(b.tvl) - Number(a.tvl));
      const bestPool = filteredPools[0];

      return {
        poolId: bestPool.id,
        marketId: bestPool.marketId,
        baseMint: bestPool.mintA.address,
        baseSymbol: bestPool.mintA.symbol,
        quoteMint: bestPool.mintB.address,
        quoteSymbol: bestPool.mintB.symbol,
        price: bestPool.price,
        tvl: bestPool.tvl,
        volume24h: bestPool.day?.volume || 0,
        feeRate: bestPool.feeRate,
        lpMint: bestPool.lpMint?.address || null,
        openTime: bestPool.openTime,
      };
    } catch (error) {
      elizaLogger.error(`❌ Error selecting best pool: ${error.message}`);
      return null;
    }
  }

  async fetchWithRetries(url: string, maxRetries = 5): Promise<Response | null> {
    let attempt = 0;
    let delay = 500; // Start with 500ms delay

    while (attempt < maxRetries) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        const response = await fetch(url, { signal: controller.signal });

        return response.ok ? response : null; // ✅ Return immediately if successful
      } catch (error) {
        if (error.name === 'AbortError') {
          elizaLogger.warn(`⚠ Request timeout: Retrying in ${delay / 1000} seconds...`);
        } else {
          elizaLogger.error(`❌ Network error on attempt ${attempt + 1}: ${error.message}`);
        }
      } finally {
        clearTimeout(timeout); // ✅ Always clear timeout
      }

      attempt++;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }

    elizaLogger.error(`❌ Max retries exceeded for URL: ${url}`);
    return null;
  }

  private async getRaydiumPoolData(
    tokenMint: string,
  ): Promise<HasRaydiumPoolActivityResult | null> {
    try {
      const url = new URL(this.RAYDIUM_API_BASE);
      url.searchParams.append('mint1', tokenMint);
      url.searchParams.append('poolType', 'all');
      url.searchParams.append('poolSortField', 'volume30d');
      url.searchParams.append('sortType', 'desc');
      url.searchParams.append('pageSize', '1000');
      url.searchParams.append('page', '1');

      elizaLogger.info(`🔍 Fetching Raydium pool data for token ${tokenMint}...`);

      // Use fetchWithRetries instead of raw fetch
      const response = await this.fetchWithRetries(url.toString());
      if (!response) {
        elizaLogger.error(`❌ Fetch failed after max retries for token ${tokenMint}`);
        return null;
      }

      const data = await response.json();
      const isMintable = await this.solanaService.isTokenMintable(tokenMint);

      if (!data.success || !data.data?.data || data.data.data.length === 0) {
        elizaLogger.info(`🚫 No Raydium pools found for token ${tokenMint}`);
        return { hasPool: false, isMintable, poolData: null };
      }

      elizaLogger.info(`✅ Raydium pool data successfully retrieved for token ${tokenMint}`);

      const pools = data.data.data;
      const now = Math.floor(Date.now() / 1000);

      const wsolPool = pools.find(
        (pool: any) => pool.mintA.address === this.W_SOL || pool.mintB.address === this.W_SOL,
      );
      const usdcPool = pools.find(
        (pool: any) => pool.mintA.address === this.USDC || pool.mintB.address === this.USDC,
      );

      const wsolPoolAge = wsolPool ? (now - Number(wsolPool.openTime)) / 86400 : 0;
      const usdcPoolAge = usdcPool ? (now - Number(usdcPool.openTime)) / 86400 : 0;

      elizaLogger.info(`📊 Pool Analysis for ${tokenMint}:
        • Token Status:
          - Mintable: ${isMintable ? '✅' : '❌'}
        
        • WSOL Pool Status: ${wsolPool ? '✅' : '❌'}
          ${
            wsolPool
              ? `- Pool Age: ${wsolPoolAge.toFixed(2)} days
          - TVL: ${wsolPool.tvl?.toLocaleString() || 'N/A'}
          - 24h Volume: ${wsolPool.day?.volume?.toLocaleString() || 'N/A'}
          - Price: ${wsolPool.price || 'N/A'}`
              : ''
          }
        
        • USDC Pool Status: ${usdcPool ? '✅' : '❌'}
          ${
            usdcPool
              ? `- Pool Age: ${usdcPoolAge.toFixed(2)} days
          - TVL: ${usdcPool.tvl?.toLocaleString() || 'N/A'}
          - 24h Volume: ${usdcPool.day?.volume?.toLocaleString() || 'N/A'}
          - Price: ${usdcPool.price || 'N/A'}`
              : ''
          }`);

      return {
        hasPool: !!(wsolPool || usdcPool),
        isMintable,
        lessThanOneDay: wsolPoolAge < 1 || usdcPoolAge < 1,
        poolData: {
          wsolPool,
          usdcPool,
          wsolPoolAge,
          usdcPoolAge,
        },
      };
    } catch (error) {
      elizaLogger.error(`❌ Error checking Raydium pool for ${tokenMint}: ${error.message}`);
      return null;
    }
  }

  extractTokenMintFromBio(bio: string): string | null {
    if (!bio) return null;

    // Solana addresses are base58 (32-44 chars), and we specifically want them ending in "pump"
    const solanaAddressRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}pump\b/;

    // Extract a valid Solana address that ends with "pump"
    const match = bio.match(solanaAddressRegex);
    return match ? match[0] : null;
  }

  async evaluatePotentialAlpha(newFollow: TwitterUser) {
    if (!newFollow.bio) return;

    // Extract token first
    const tokenMint = this.extractTokenMintFromBio(newFollow.bio);
    if (!tokenMint) {
      elizaLogger.info(`No pump-related token found in @${newFollow.username}'s bio`);
      return;
    }

    // Check cache
    let profile = this.profileCache.get(newFollow.username)?.profile;
    const isCacheExpired =
      !profile ||
      Date.now() - this.profileCache.get(newFollow.username)!.timestamp > 10 * 60 * 1000;

    // Fetch profile only if needed
    if (isCacheExpired) {
      profile = await this.scraper.getProfile(newFollow.username);
      if (profile) {
        this.profileCache.set(newFollow.username, { profile, timestamp: Date.now() });
      }
    }

    // Get Raydium pool status
    const raydiumData = await this.getRaydiumPoolData(tokenMint);
    if (!raydiumData) {
      elizaLogger.info(`Unable to fetch Raydium pool data for token ${tokenMint}`);
      return;
    }

    elizaLogger.info(`Complete analysis for @${newFollow.username}:
    • Profile Information:
      - Username: @${newFollow.username}
      - Name: ${profile?.name || 'N/A'}
      - Followers: ${profile?.followersCount?.toLocaleString() || 0}
      - Following: ${profile?.followingCount?.toLocaleString() || 0}
      - Total Tweets: ${profile?.tweetsCount?.toLocaleString() || 0}
      - Account Created: ${profile?.joined ? new Date(profile.joined).toLocaleDateString() : 'N/A'}
      - Bio: ${profile?.biography || 'N/A'}
  
    • Token Information:
      - Token Mint: ${tokenMint}
      - Is Mintable: ${raydiumData.isMintable ? '✅' : '❌'}
      - Has Any Pool: ${raydiumData.hasPool ? '✅' : '❌'}
  
    ${
      raydiumData.poolData
        ? `• Pool Details:
      - WSOL Pool: ${raydiumData.poolData.wsolPool ? `✅ (${raydiumData.poolData.wsolPoolAge.toFixed(2)} days old)` : '❌'}
      - USDC Pool: ${raydiumData.poolData.usdcPool ? `✅ (${raydiumData.poolData.usdcPoolAge.toFixed(2)} days old)` : '❌'}`
        : ''
    }`);
  }

  async startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    this.logger.info('🚀 Starting Twitter Follow Monitoring...');
    await this.login();

    const monitor = async () => {
      try {
        let newFollowCount = 0;

        // ✅ Sequential execution - process accounts one by one
        for (const account of this.accounts) {
          const newFollows = await this.checkForNewFollowing(account);
          newFollowCount += newFollows.length;
        }

        // Adjust monitoring speed based on new follow activity
        if (newFollowCount > 5) {
          this.currentInterval = Math.max(this.minInterval, this.currentInterval * 0.8);
        } else if (newFollowCount === 0) {
          this.currentInterval = Math.min(this.maxInterval, this.currentInterval * 1.2);
        }
      } catch (error) {
        elizaLogger.error(`❌ Monitor loop crashed: ${error.message}`);
      } finally {
        setTimeout(monitor, this.currentInterval); // ✅ Restart loop
      }
    };

    await monitor();
  }

  async cleanup() {
    this.logger.info('🛑 Cleaning up Twitter monitoring service...');

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.profileCacheCleanupInterval) {
      clearInterval(this.profileCacheCleanupInterval);
      this.profileCacheCleanupInterval = null;
      elizaLogger.info('🧹 Stopped profile cache cleanup.');
    }

    this.isMonitoring = false; // ✅ Allow future restart
  }
}
