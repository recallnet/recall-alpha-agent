import { Scraper, Profile } from 'agent-twitter-client';
import { SolanaService } from './solana.service.ts';
import { elizaLogger, IAgentRuntime, Service, ServiceType, IDatabaseAdapter } from '@elizaos/core';
import { handleUserInput } from '../../chat/index.ts';

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

const accounts = process.env.TWITTER_TARGET_USERS?.split(',') || [];

export class AlphaService extends Service {
  private runtime: IAgentRuntime;
  private db: IDatabaseAdapter;
  static serviceType: ServiceType = 'alpha' as ServiceType;
  private scraper: Scraper;
  private profileCacheCleanupInterval: NodeJS.Timeout | null = null;
  private accounts: string[] = accounts;
  private isMonitoring = false;
  private readonly logger = elizaLogger;
  private abortController: AbortController | null = null;
  private solanaService: SolanaService;
  private isCleaningUp = false;
  private minInterval = 2 * 60 * 1000; // 2 min (fastest)
  private maxInterval = 15 * 60 * 1000; // 15 min (slowest)
  private currentInterval = 5 * 60 * 1000; // Start at 5 min
  private profileCache: Map<string, { profile: Profile; timestamp: number }> = new Map();
  private readonly MAX_CACHE_SIZE = 500; // Set a reasonable cap
  private readonly RAYDIUM_API_BASE = 'https://api-v3.raydium.io/pools/info/mint';
  private readonly W_SOL = 'So11111111111111111111111111111111111111112';
  private readonly USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  async initialize(_runtime: IAgentRuntime) {
    try {
      if (!_runtime) {
        throw new Error('Runtime is undefined during initialization');
      }

      this.runtime = _runtime;
      this.db = _runtime.databaseAdapter;
      await this.ensureRequiredTables();
      elizaLogger.info('[AlphaService] Initialized Successfully');
    } catch (error) {
      elizaLogger.error(`Failed to initialize AlphaService: ${error.message}`);
      throw error;
    }
  }

  getInstance(): AlphaService {
    return AlphaService.getInstance();
  }

  async startMonitoring(db: IDatabaseAdapter) {
    if (this.isMonitoring) return;
    if (!this.scraper || !(await this.scraper.isLoggedIn())) {
      this.scraper = new Scraper();
      await this.login();
    }
    this.solanaService = new SolanaService();
    this.isMonitoring = true;
    this.db = db;
    await this.ensureRequiredTables();

    // Start profile cache cleanup
    if (!this.profileCacheCleanupInterval) {
      this.profileCacheCleanupInterval = setInterval(
        () => {
          this.cleanupProfileCache();
        },
        5 * 60 * 1000,
      );
    }

    this.logger.info('🚀 Starting Twitter Follow Monitoring...');

    const monitor = async () => {
      if (!this.isMonitoring) return; // ✅ Exit if monitoring is stopped

      try {
        let newFollowCount = 0;
        for (const account of this.accounts) {
          if (!this.isMonitoring) return;
          const newFollows = await this.checkForNewFollowing(account);
          newFollowCount += newFollows.length;
        }

        if (!this.isMonitoring) return;

        // 🔄 Dynamically adjust polling interval
        if (newFollowCount > 5) {
          this.currentInterval = Math.max(this.minInterval, this.currentInterval * 0.8);
        } else if (newFollowCount === 0) {
          this.currentInterval = Math.min(this.maxInterval, this.currentInterval * 1.2);
        }

        this.logger.info(`⏳ Next scan in ${this.currentInterval / 1000}s...`);

        // ✅ Use setTimeout for controlled execution
        setTimeout(() => {
          if (this.isMonitoring) monitor();
        }, this.currentInterval);
      } catch (error) {
        elizaLogger.error(`❌ Monitor loop crashed: ${error.message}`);
      }
    };

    // ✅ Start the first execution
    monitor();
  }

  /**
   * Safely accesses the database adapter with proper error checking
   * @returns The database adapter or throws an error if not available
   */
  private getDatabaseAdapter(): IDatabaseAdapter {
    if (!this.db) {
      throw new Error('Runtime is not initialized');
    }
    const db = this.db;
    if (!db) {
      throw new Error('Database adapter is not available');
    }
    return db;
  }

  /**
   * Ensures that the required tables exist for this service.
   * Creates tables if they don't exist.
   */
  private async ensureRequiredTables(): Promise<void> {
    try {
      const db = this.getDatabaseAdapter();

      // Check and create twitter_following table
      await this.ensureTwitterFollowingTable(db);

      // Check and create alpha_analysis table
      await this.ensureAlphaAnalysisTable(db);

      elizaLogger.info('Required tables for AlphaService successfully checked/created');
    } catch (error) {
      elizaLogger.error(`Error ensuring required tables: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensures the twitter_following table exists.
   */
  private async ensureTwitterFollowingTable(db: IDatabaseAdapter): Promise<void> {
    try {
      if (!db) {
        throw new Error('Database adapter is undefined');
      }

      if ('pool' in db) {
        // PostgreSQL
        await (db as any).pool.query(`
          CREATE TABLE IF NOT EXISTS twitter_following (
            username TEXT NOT NULL,
            following_id TEXT NOT NULL,
            following_username TEXT NOT NULL,
            bio TEXT,
            added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (username, following_id)
          )
        `);
      } else if ('db' in db) {
        // SQLite
        await (db as any).db
          .prepare(
            `
            CREATE TABLE IF NOT EXISTS twitter_following (
              username TEXT NOT NULL,
              following_id TEXT NOT NULL,
              following_username TEXT NOT NULL,
              bio TEXT,
              added_at INTEGER DEFAULT (unixepoch()),
              PRIMARY KEY (username, following_id)
            )
          `,
          )
          .run();
      } else {
        throw new Error('Unsupported database adapter');
      }
      elizaLogger.info('twitter_following table checked/created successfully');
    } catch (error) {
      elizaLogger.error(`Error ensuring twitter_following table: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensures the alpha_analysis table exists.
   */
  private async ensureAlphaAnalysisTable(db: IDatabaseAdapter): Promise<void> {
    try {
      if ('pool' in db) {
        // PostgreSQL
        await (db as any).pool.query(`
          CREATE TABLE IF NOT EXISTS alpha_analysis (
            token_mint TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            bio TEXT,
            followers_count INTEGER NOT NULL,
            following_count INTEGER NOT NULL,
            tweets_count INTEGER NOT NULL,
            account_created TIMESTAMP WITH TIME ZONE,
            is_mintable BOOLEAN NOT NULL,
            has_pool BOOLEAN NOT NULL,
            wsol_pool_age FLOAT,
            usdc_pool_age FLOAT,
            wsol_pool_tvl FLOAT,
            usdc_pool_tvl FLOAT,
            wsol_pool_volume_24h FLOAT,
            usdc_pool_volume_24h FLOAT,
            wsol_pool_price FLOAT,
            usdc_pool_price FLOAT,
            tweeted BOOLEAN DEFAULT FALSE,
            added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } else if ('db' in db) {
        // SQLite
        await (db as any).db
          .prepare(
            `
            CREATE TABLE IF NOT EXISTS alpha_analysis (
              token_mint TEXT PRIMARY KEY,
              username TEXT NOT NULL,
              bio TEXT,
              followers_count INTEGER NOT NULL,
              following_count INTEGER NOT NULL,
              tweets_count INTEGER NOT NULL,
              account_created INTEGER,
              is_mintable INTEGER NOT NULL,
              has_pool INTEGER NOT NULL,
              wsol_pool_age REAL,
              usdc_pool_age REAL,
              wsol_pool_tvl REAL,
              usdc_pool_tvl REAL,
              wsol_pool_volume_24h REAL,
              usdc_pool_volume_24h REAL,
              wsol_pool_price REAL,
              usdc_pool_price REAL,
              tweeted INTEGER DEFAULT 0,
              added_at INTEGER DEFAULT (unixepoch())
            )
          `,
          )
          .run();
      } else {
        throw new Error('Unsupported database adapter');
      }
      elizaLogger.info('alpha_analysis table checked/created successfully');
    } catch (error) {
      elizaLogger.error(`Error ensuring alpha_analysis table: ${error.message}`);
      throw error;
    }
  }

  private cleanupProfileCache() {
    if (!this.isMonitoring) return; // Ensure cleanup only runs if monitoring is active

    const now = Date.now();
    let removedCount = 0;

    const keysToDelete = Array.from(this.profileCache.keys()).filter(
      (key) => now - this.profileCache.get(key)!.timestamp > 10 * 60 * 1000,
    );

    keysToDelete.forEach((key) => {
      this.profileCache.delete(key);
      removedCount++;
    });

    if (removedCount > 0) {
      elizaLogger.info(`🧹 Cleared ${removedCount} expired profiles from cache.`);
    }

    if (this.profileCache.size > this.MAX_CACHE_SIZE) {
      const excess = this.profileCache.size - this.MAX_CACHE_SIZE;
      const oldestKeys = Array.from(this.profileCache.keys()).slice(0, excess);
      oldestKeys.forEach((key) => this.profileCache.delete(key));

      elizaLogger.info(`🧹 Profile cache pruned to ${this.MAX_CACHE_SIZE} entries`);
    }
  }

  async login() {
    const {
      TWITTER_USERNAME,
      TWITTER_PASSWORD,
      TWITTER_EMAIL,
      TWITTER_2FA_SECRET,
      TWITTER_RETRY_LIMIT,
    } = process.env;
    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
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
          await this.scraper.login(
            TWITTER_USERNAME,
            TWITTER_PASSWORD,
            TWITTER_EMAIL,
            TWITTER_2FA_SECRET,
          );
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
      if (!userId) throw new Error(`❌ Unable to fetch user ID for ${username}`);

      this.logger.info(`🔍 Fetching following list for ${username} (ID: ${userId})...`);
      const followingUsers: TwitterUser[] = [];

      let count = 0;
      for await (const profile of this.scraper.getFollowing(userId, 20000)) {
        // ✅ Capped at 30,000
        if (++count > 20000) break; // ✅ Stop if exceeded
        followingUsers.push({
          id: profile.userId,
          username: profile.username,
          name: profile.name,
          bio: profile.biography || '',
        });

        // ✅ Rate-limit API calls (100ms delay between each)
        if (count % 100 === 0) await new Promise((resolve) => setTimeout(resolve, 100));
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

      const storedFollowingIds = await this.getStoredFollowing(username);
      const storedFollowingSet = new Set(storedFollowingIds);

      const newFollows = latestFollowing.filter((f) => !storedFollowingSet.has(f.id));

      if (newFollows.length > 0) {
        await this.bulkInsertTwitterFollowing(
          newFollows.map((follow) => ({
            username,
            following_id: follow.id,
            following_username: follow.username,
            bio: follow.bio,
          })),
        );
      }

      for (const newFollow of newFollows) {
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

  /**
   * Gets stored following IDs for a username from database.
   */
  private async getStoredFollowing(username: string): Promise<string[]> {
    try {
      const db = this.getDatabaseAdapter();

      if ('pool' in db) {
        // PostgreSQL
        const result = await (db as any).pool.query(
          'SELECT following_id FROM twitter_following WHERE username = $1',
          [username],
        );
        return result.rows.map((row: any) => row.following_id);
      } else if ('db' in db) {
        // SQLite
        const result = (db as any).db
          .prepare('SELECT following_id FROM twitter_following WHERE username = ?')
          .all(username);
        return result.map((row: any) => row.following_id);
      } else {
        throw new Error('Unsupported database adapter');
      }
    } catch (error) {
      this.logger.error(`Error getting stored following: ${error.message}`);
      return [];
    }
  }

  /**
   * Bulk inserts Twitter following data.
   */
  private async bulkInsertTwitterFollowing(
    followings: {
      username: string;
      following_id: string;
      following_username: string;
      bio?: string;
    }[],
  ): Promise<void> {
    if (followings.length === 0) return;

    try {
      const db = this.getDatabaseAdapter();

      if ('pool' in db) {
        // PostgreSQL
        const values: any[] = [];
        const placeholders = followings
          .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
          .join(', ');

        followings.forEach((follow) => {
          values.push(
            follow.username,
            follow.following_id,
            follow.following_username,
            follow.bio || null,
          );
        });

        await (db as any).pool.query(
          `INSERT INTO twitter_following (username, following_id, following_username, bio)
           VALUES ${placeholders}
           ON CONFLICT (username, following_id) DO NOTHING`,
          values,
        );
      } else if ('db' in db) {
        // SQLite - we'll do individual inserts as SQLite doesn't support bulk inserts as effectively
        const stmt = (db as any).db.prepare(
          `INSERT OR IGNORE INTO twitter_following (username, following_id, following_username, bio)
           VALUES (?, ?, ?, ?)`,
        );

        for (const follow of followings) {
          stmt.run(
            follow.username,
            follow.following_id,
            follow.following_username,
            follow.bio || null,
          );
        }
      } else {
        throw new Error('Unsupported database adapter');
      }

      this.logger.info(`✅ Successfully inserted ${followings.length} Twitter followings.`);
    } catch (error) {
      this.logger.error(`❌ Error bulk inserting Twitter followings: ${error.message}`);
      throw error;
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

  async fetchWithRetries(url: string, maxRetries = 3): Promise<Response | null> {
    let attempt = 0;
    let delay = 1000; // Start with 1s delay

    while (attempt < maxRetries) {
      if (!this.isMonitoring) return null; // ✅ Stop retries if monitoring is off

      // ✅ Create a new AbortController **for each attempt**
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 10000); // 10s timeout

      try {
        const response = await fetch(url, { signal: abortController.signal });

        if (response.ok) return response; // ✅ Success
        if (response.status === 404) {
          elizaLogger.error(`❌ Fatal error: 404 Not Found (${url})`);
          return null; // ✅ Stop retrying if it's a 404
        }

        elizaLogger.warn(`⚠ Failed response (attempt ${attempt + 1}/${maxRetries}), retrying...`);
      } catch (error) {
        elizaLogger.error(`❌ Network error (${attempt + 1}/${maxRetries}): ${error.message}`);
      } finally {
        clearTimeout(timeout);
      }

      attempt++;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }

    elizaLogger.error(`❌ Max retries exceeded: ${url}`);
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

  async storeAlphaAnalysis(params: {
    tokenMint: string;
    username: string;
    bio?: string;
    followersCount: number;
    followingCount: number;
    tweetsCount: number;
    accountCreated?: Date;
    isMintable: boolean;
    hasPool: boolean;
    wsolPoolAge?: number;
    usdcPoolAge?: number;
    wsolPoolTvl?: number;
    usdcPoolTvl?: number;
    wsolPoolVolume24h?: number;
    usdcPoolVolume24h?: number;
    wsolPoolPrice?: number;
    usdcPoolPrice?: number;
  }) {
    try {
      const db = this.getDatabaseAdapter();

      if ('pool' in db) {
        // PostgreSQL
        await (db as any).pool.query(
          `INSERT INTO alpha_analysis (
            token_mint, username, bio, followers_count, following_count, tweets_count,
            account_created, is_mintable, has_pool, wsol_pool_age, usdc_pool_age,
            wsol_pool_tvl, usdc_pool_tvl, wsol_pool_volume_24h, usdc_pool_volume_24h,
            wsol_pool_price, usdc_pool_price
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (token_mint) DO UPDATE SET
            username = EXCLUDED.username,
            bio = EXCLUDED.bio,
            followers_count = EXCLUDED.followers_count,
            following_count = EXCLUDED.following_count,
            tweets_count = EXCLUDED.tweets_count,
            account_created = EXCLUDED.account_created,
            is_mintable = EXCLUDED.is_mintable,
            has_pool = EXCLUDED.has_pool,
            wsol_pool_age = EXCLUDED.wsol_pool_age,
            usdc_pool_age = EXCLUDED.usdc_pool_age,
            wsol_pool_tvl = EXCLUDED.wsol_pool_tvl,
            usdc_pool_tvl = EXCLUDED.usdc_pool_tvl,
            wsol_pool_volume_24h = EXCLUDED.wsol_pool_volume_24h,
            usdc_pool_volume_24h = EXCLUDED.usdc_pool_volume_24h,
            wsol_pool_price = EXCLUDED.wsol_pool_price,
            usdc_pool_price = EXCLUDED.usdc_pool_price`,
          [
            params.tokenMint,
            params.username,
            params.bio,
            params.followersCount,
            params.followingCount,
            params.tweetsCount,
            params.accountCreated,
            params.isMintable,
            params.hasPool,
            params.wsolPoolAge,
            params.usdcPoolAge,
            params.wsolPoolTvl,
            params.usdcPoolTvl,
            params.wsolPoolVolume24h,
            params.usdcPoolVolume24h,
            params.wsolPoolPrice,
            params.usdcPoolPrice,
          ],
        );
      } else if ('db' in db) {
        // SQLite
        await (db as any).db
          .prepare(
            `INSERT OR REPLACE INTO alpha_analysis (
            token_mint, username, bio, followers_count, following_count, tweets_count,
            account_created, is_mintable, has_pool, wsol_pool_age, usdc_pool_age,
            wsol_pool_tvl, usdc_pool_tvl, wsol_pool_volume_24h, usdc_pool_volume_24h,
            wsol_pool_price, usdc_pool_price
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            params.tokenMint,
            params.username,
            params.bio,
            params.followersCount,
            params.followingCount,
            params.tweetsCount,
            params.accountCreated ? params.accountCreated.getTime() : null, // Convert to epoch timestamp for SQLite
            params.isMintable ? 1 : 0, // Convert boolean to integer for SQLite
            params.hasPool ? 1 : 0, // Convert boolean to integer for SQLite
            params.wsolPoolAge,
            params.usdcPoolAge,
            params.wsolPoolTvl,
            params.usdcPoolTvl,
            params.wsolPoolVolume24h,
            params.usdcPoolVolume24h,
            params.wsolPoolPrice,
            params.usdcPoolPrice,
          );
      } else {
        throw new Error('Unsupported database adapter');
      }

      this.logger.info(`✅ Alpha analysis stored for token: ${params.tokenMint}`);
    } catch (error) {
      this.logger.error(`❌ Failed to store alpha analysis for token: ${params.tokenMint}`, error);
    }
  }

  /**
   * Gets the agent ID from the accounts table
   * @returns The agent ID or null if not found
   */
  public async getAlphaAgentId(): Promise<string | null> {
    try {
      const db = this.getDatabaseAdapter();

      if ('pool' in db) {
        // PostgreSQL
        const result = await (db as any).pool.query(
          'SELECT id FROM accounts WHERE name = \'AlphaAgent\' ORDER BY "createdAt" DESC LIMIT 1',
        );
        return result.rows.length > 0 ? result.rows[0].id : null;
      } else if ('db' in db) {
        // SQLite
        const result = (db as any).db
          .prepare(
            "SELECT id FROM accounts WHERE name = 'AlphaAgent' ORDER BY createdAt DESC LIMIT 1",
          )
          .get();
        return result ? result.id : null;
      } else {
        throw new Error('Unsupported database adapter');
      }
    } catch (error) {
      this.logger.error(`Error getting agent ID from accounts: ${error.message}`);
      return null;
    }
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

    const logInfo = `Complete analysis for @${newFollow.username}:
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
      - USDC pool age: ${raydiumData.poolData.usdcPoolAge}
  
    ${
      raydiumData.poolData
        ? `• Pool Details:
      - WSOL Pool: ${raydiumData.poolData.wsolPool ? `✅ (${raydiumData.poolData.wsolPoolAge.toFixed(2)} days old)` : '❌'}
      - USDC Pool: ${raydiumData.poolData.usdcPool ? `✅ (${raydiumData.poolData.usdcPoolAge.toFixed(2)} days old)` : '❌'}`
        : ''
    }`;

    elizaLogger.info(logInfo);

    // Get agent ID from accounts or fall back to runtime agent ID
    const agentId = (await this.getAlphaAgentId()) || this.runtime.agentId;
    elizaLogger.info(`Using agent ID: ${agentId} for alpha evaluation`);

    // Create a properly formatted single-line message without special characters
    const cleanedLogInfo = logInfo
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .replace(/•/g, '') // Remove bullet points
      .replace(/✅/g, 'Yes') // Replace checkmarks with 'Yes'
      .replace(/❌/g, 'No') // Replace X marks with 'No'
      .replace(/\s{2,}/g, ' ') // Replace multiple spaces with single space
      .trim(); // Remove leading/trailing whitespace

    // USDC on Solana address for the "from" token
    const usdcAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    let agentRes;

    if (Number(raydiumData.poolData.usdcPoolAge.toFixed(2)) < 2) {
      const tokenBalances = await handleUserInput('What are my token balances?', agentId);
      elizaLogger.info(JSON.stringify(tokenBalances), 'token balances');

      agentRes = await handleUserInput(
        `Determine if the following detected signal represents potential alpha. Remember that your task as an alpha detection agent sometimes involves performing risky trades. Only approve a purchase of a token if the USDC pool is less than 2 days old.
  
        If it does reflect potential alpha, your task is to determine how much we should purchase of this token in USDC. If none should be purchased, you can return 0.
  
        Here's the usdc token address on Solana: ${usdcAddress}.
  
        Here are our current token balances: ${JSON.stringify(tokenBalances[1])}.
  
        Here's the token information for you to evaluate ${cleanedLogInfo}.
        
        ONLY respond with a number representing the amount in based on our available USDC balance we should purchase, or zero if none should be purchased.
        `,
        agentId,
      );
    }

    if (agentRes && agentRes[0]) {
      try {
        const numberToBuy = Number(agentRes[0].text);
        if (numberToBuy > 0) {
          await handleUserInput(
            `Execute a trade of ${numberToBuy} "${usdcAddress}" to "${tokenMint}"`,
            agentId,
          );
        }
      } catch (error) {
        this.logger.error(`Error making trade in [AlphaService]: ${error.message}`);
        return null;
      }
    }

    await this.storeAlphaAnalysis({
      tokenMint,
      username: newFollow.username,
      bio: profile?.biography || '',
      followersCount: profile?.followersCount || 0,
      followingCount: profile?.followingCount || 0,
      tweetsCount: profile?.tweetsCount || 0,
      accountCreated: profile?.joined ? new Date(profile.joined) : undefined,
      isMintable: raydiumData.isMintable,
      hasPool: raydiumData.hasPool,
      wsolPoolAge: raydiumData.poolData?.wsolPoolAge,
      usdcPoolAge: raydiumData.poolData?.usdcPoolAge,
      wsolPoolTvl: raydiumData.poolData?.wsolPool?.tvl,
      usdcPoolTvl: raydiumData.poolData?.usdcPool?.tvl,
      wsolPoolVolume24h: raydiumData.poolData?.wsolPool?.day?.volume,
      usdcPoolVolume24h: raydiumData.poolData?.usdcPool?.day?.volume,
      wsolPoolPrice: raydiumData.poolData?.wsolPool?.price,
      usdcPoolPrice: raydiumData.poolData?.usdcPool?.price,
    });
  }

  async cleanup() {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    this.logger.info('🛑 Cleaning up Twitter monitoring service...');
    this.isMonitoring = false;

    if (this.abortController) {
      this.abortController.abort(); // ✅ Cancel any ongoing API requests
      this.abortController = null;
    }

    this.cleanupProfileCache(); // ✅ Ensure cache is cleaned

    if (this.profileCacheCleanupInterval) {
      clearInterval(this.profileCacheCleanupInterval);
      this.profileCacheCleanupInterval = null;
      elizaLogger.info('🧹 Stopped profile cache cleanup.');
    }

    elizaLogger.info('✅ Cleanup completed.');
  }

  /**
   * Retrieves unposted alpha signals from the database.
   * These are alpha analysis entries that haven't been tweeted about yet.
   */
  async getUnpostedAlpha(): Promise<any[]> {
    try {
      const db = this.getDatabaseAdapter();

      if ('pool' in db) {
        // PostgreSQL
        const result = await (db as any).pool.query(`
          SELECT 
            token_mint as "tokenMint",
            username,
            bio,
            followers_count as "followersCount",
            following_count as "followingCount", 
            tweets_count as "tweetsCount",
            account_created as "accountCreated",
            is_mintable as "isMintable",
            has_pool as "hasPool",
            wsol_pool_age as "wsolPoolAge",
            usdc_pool_age as "usdcPoolAge",
            wsol_pool_tvl as "wsolPoolTvl",
            usdc_pool_tvl as "usdcPoolTvl",
            wsol_pool_volume_24h as "wsolPoolVolume24h",
            usdc_pool_volume_24h as "usdcPoolVolume24h",
            wsol_pool_price as "wsolPoolPrice",
            usdc_pool_price as "usdcPoolPrice",
            added_at as "addedAt"
          FROM alpha_analysis
          WHERE tweeted = FALSE
          ORDER BY added_at DESC
          LIMIT 10
        `);
        return result.rows;
      } else if ('db' in db) {
        // SQLite
        const result = (db as any).db
          .prepare(
            `
          SELECT 
            token_mint as tokenMint,
            username,
            bio,
            followers_count as followersCount,
            following_count as followingCount, 
            tweets_count as tweetsCount,
            account_created as accountCreated,
            is_mintable as isMintable,
            has_pool as hasPool,
            wsol_pool_age as wsolPoolAge,
            usdc_pool_age as usdcPoolAge,
            wsol_pool_tvl as wsolPoolTvl,
            usdc_pool_tvl as usdcPoolTvl,
            wsol_pool_volume_24h as wsolPoolVolume24h,
            usdc_pool_volume_24h as usdcPoolVolume24h,
            wsol_pool_price as wsolPoolPrice,
            usdc_pool_price as usdcPoolPrice,
            added_at as addedAt
          FROM alpha_analysis
          WHERE tweeted = 0
          ORDER BY added_at DESC
          LIMIT 10
        `,
          )
          .all();

        // For SQLite, we need to convert values
        return result.map((row: any) => {
          // Convert numeric representations of booleans to actual booleans
          row.isMintable = !!row.isMintable;
          row.hasPool = !!row.hasPool;

          // Convert accountCreated from timestamp to Date if present
          if (row.accountCreated) {
            row.accountCreated = new Date(row.accountCreated);
          }

          // Convert addedAt from timestamp to Date if present
          if (row.addedAt) {
            row.addedAt = new Date(row.addedAt);
          }

          return row;
        });
      } else {
        throw new Error('Unsupported database adapter');
      }
    } catch (error) {
      this.logger.error(`Error getting unposted alpha: ${error.message}`);
      return [];
    }
  }

  /**
   * Marks an alpha analysis entry as tweeted by its token mint.
   * @param tokenMint The token mint of the entry to mark as tweeted.
   */
  async markAlphaAsTweeted(tokenMint: string): Promise<void> {
    try {
      const db = this.getDatabaseAdapter();

      if ('pool' in db) {
        // PostgreSQL
        await (db as any).pool.query(
          'UPDATE alpha_analysis SET tweeted = TRUE WHERE token_mint = $1',
          [tokenMint],
        );
      } else if ('db' in db) {
        // SQLite
        await (db as any).db
          .prepare('UPDATE alpha_analysis SET tweeted = 1 WHERE token_mint = ?')
          .run(tokenMint);
      } else {
        throw new Error('Unsupported database adapter');
      }

      this.logger.info(`Marked alpha signal for token ${tokenMint} as tweeted`);
    } catch (error) {
      this.logger.error(`Error marking alpha as tweeted: ${error.message}`);
      throw error;
    }
  }

  /**
   * Checks recent tweets from a Twitter username for alpha signals and marks them as tweeted if found.
   * @param twitterUsername The Twitter username to check recent tweets for
   * @param count The number of recent tweets to check (default: 3)
   * @returns Array of token mints that were marked as tweeted
   */
  async checkAndMarkTweetedAlphaSignals(
    twitterUsername: string,
    count: number = 3,
  ): Promise<string[]> {
    try {
      if (!twitterUsername) {
        this.logger.error('No Twitter username provided to check recent tweets');
        return [];
      }
      if (!this.scraper || !(await this.scraper.isLoggedIn())) {
        this.scraper = new Scraper();
        await this.login();
      }
      const userId = await this.getUserId(twitterUsername);

      // Fetch recent tweets
      this.logger.info(`Fetching ${count} recent tweets from @${twitterUsername}`);
      const response = await this.scraper.getUserTweets(userId, count);
      elizaLogger.info(JSON.stringify(response));

      // The response has format { tweets: Tweet[], next?: string }
      const tweetsArray = response.tweets || [];

      if (!tweetsArray || tweetsArray.length === 0) {
        this.logger.info(`No recent tweets found for @${twitterUsername}`);
        return [];
      }

      this.logger.info(`Found ${tweetsArray.length} recent tweets from @${twitterUsername}`);

      // Get all unposted alpha usernames
      const db = this.getDatabaseAdapter();
      let alphaEntries: { tokenMint: string; username: string }[] = [];

      if ('pool' in db) {
        // PostgreSQL
        const result = await (db as any).pool.query(
          `SELECT token_mint as "tokenMint", username FROM alpha_analysis WHERE tweeted = FALSE`,
        );
        alphaEntries = result.rows;
      } else if ('db' in db) {
        // SQLite
        const result = (db as any).db
          .prepare(`SELECT token_mint as tokenMint, username FROM alpha_analysis WHERE tweeted = 0`)
          .all();
        alphaEntries = result;
      } else {
        throw new Error('Unsupported database adapter');
      }

      if (alphaEntries.length === 0) {
        this.logger.info('No unposted alpha signals found to check against tweets');
        return [];
      }

      // Check each tweet for alpha usernames
      const markedTokens: string[] = [];
      for (const tweet of tweetsArray) {
        const tweetText = tweet.text.toLowerCase();

        for (const entry of alphaEntries) {
          // Skip if already marked
          if (markedTokens.includes(entry.tokenMint)) continue;

          // Check if the tweet mentions the alpha username
          if (entry.username && tweetText.includes(entry.username.toLowerCase())) {
            await this.markAlphaAsTweeted(entry.tokenMint);
            markedTokens.push(entry.tokenMint);
            this.logger.info(
              `Marked alpha signal for @${entry.username} as tweeted based on tweet: "${tweet.text.slice(0, 50)}..."`,
            );
          }
        }
      }

      if (markedTokens.length > 0) {
        this.logger.info(`Marked ${markedTokens.length} alpha signals as tweeted`);
      } else {
        this.logger.info('No alpha signals were found in recent tweets');
      }

      return markedTokens;
    } catch (error) {
      this.logger.error(
        `Error checking and marking tweeted alpha signals: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
