import { Scraper } from "agent-twitter-client";
import { elizaLogger } from "@elizaos/core";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import pg from "pg";

type Pool = pg.Pool;

interface TwitterUser {
  id: string;
  username: string;
  name: string;
  bio?: string;
}

const accounts = process.env.TWITTER_ACCOUNTS?.split(",") || [];

export class TwitterService {
  private scraper: Scraper;
  private pool: Pool;
  private accounts: string[] = accounts;
  private readonly logger = elizaLogger;

  constructor() {
    this.scraper = new Scraper();

    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set in the environment variables");
    }

    this.pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  async initialize() {
    await this.pool.query(`
        CREATE TABLE IF NOT EXISTS twitter_following (
          username VARCHAR(255) NOT NULL,
          following_id VARCHAR(255) NOT NULL,
          following_username VARCHAR(255) NOT NULL,
          first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          bio TEXT,
          PRIMARY KEY (username, following_id)
        );
      `);
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
      throw new Error(
        "Twitter credentials are missing in environment variables"
      );
    }

    let retries = TWITTER_RETRY_LIMIT ? parseInt(TWITTER_RETRY_LIMIT) : 3;
    const cachedCookies = await this.scraper.getCookies();
    if (cachedCookies && cachedCookies.length > 0) {
      this.logger.info("🍪 Using cached cookies...");
      await this.scraper.setCookies(cachedCookies);
      return;
    }

    this.logger.log("🔑 Waiting for Twitter login...");
    while (retries > 0) {
      try {
        if (await this.scraper.isLoggedIn()) {
          this.logger.info("✅ Successfully logged in using cookies.");
          break;
        } else {
          await this.scraper.login(
            TWITTER_USERNAME,
            TWITTER_PASSWORD,
            TWITTER_EMAIL,
            TWITTER_2FA_SECRET
          );
          if (await this.scraper.isLoggedIn()) {
            this.logger.info("✅ Successfully logged in.");
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
        throw new Error("Twitter login failed after maximum retries.");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async getUserId(username: string): Promise<string | null> {
    try {
      this.logger.info(`🔍 Fetching user ID for ${username}...`);
      const userId = await this.scraper.getUserIdByScreenName(username);
      if (!userId) throw new Error("User ID not found");
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

      this.logger.info(
        `🔍 Fetching full following list for ${username} (ID: ${userId})...`
      );
      const followingUsers: TwitterUser[] = [];

      for await (const profile of this.scraper.getFollowing(userId, 100000)) {
        followingUsers.push({
          id: profile.userId,
          username: profile.username,
          name: profile.name,
          bio: profile.biography || "", // Store bio for filtering pump signals
        });
      }

      this.logger.info(
        `✅ Retrieved ${followingUsers.length} following users for ${username}.`
      );
      return followingUsers;
    } catch (error) {
      this.logger.error(`❌ Error fetching follows for ${username}:`, error);
      return [];
    }
  }

  async checkForNewFollowing(username: string): Promise<TwitterUser[]> {
    const latestFollowing = await this.getFollowing(username);

    const storedFollowing = await this.pool.query(
      "SELECT following_id FROM twitter_following WHERE username = $1",
      [username]
    );
    const storedFollowingIds = new Set(
      storedFollowing.rows.map((row) => row.following_id)
    );

    const newFollows = latestFollowing.filter(
      (f) => !storedFollowingIds.has(f.id)
    );

    for (const newFollow of newFollows) {
      await this.pool.query(
        `INSERT INTO twitter_following (username, following_id, following_username, bio) 
       VALUES ($1, $2, $3, $4) ON CONFLICT (username, following_id) DO NOTHING`,
        [username, newFollow.id, newFollow.username, newFollow.bio]
      );

      this.logger.info(
        `🚀 ${username} just followed ${newFollow.username} (${newFollow.id}) - Bio: ${newFollow.bio}`
      );

      // Evaluate if this is an alpha opportunity
      await this.evaluatePotentialAlpha(newFollow);
    }
    return newFollows;
  }

  async hasRaydiumPoolWithPump(tokenMint: string): Promise<boolean> {
    try {
      const poolType = "all";
      const poolSortField = "default";
      const sortType = "desc";
      const pageSize = 1;
      const page = 1;

      // Construct the URL with query parameters
      const baseUrl = "https://api-v3.raydium.io/pools/info/mint";
      const url = new URL(baseUrl);
      url.searchParams.append("mint1", tokenMint);
      url.searchParams.append("poolType", poolType);
      url.searchParams.append("poolSortField", poolSortField);
      url.searchParams.append("sortType", sortType);
      url.searchParams.append("pageSize", pageSize.toString());
      url.searchParams.append("page", page.toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        elizaLogger.error(
          `❌ Error fetching Raydium pool for ${tokenMint}: ${response.statusText}`
        );
      }
      const data = await response.json();

      elizaLogger.info(JSON.stringify(data.data));

      // Ensure `data.data` exists and is properly structured
      if (!data.success || !data.data || !data.data.data) {
        console.log(`❌ No pool found for token: ${tokenMint}`);
        return false;
      }

      // Extract pool token addresses safely
      const tokenMints = data.data.data
        .flatMap((pool: any) => [pool.mintA?.address, pool.mintB?.address])
        .filter(Boolean); // Filter out any `undefined` values

      // Check if any token mint contains "pump"
      const hasPumpToken = tokenMints.some((mint: string) =>
        mint.toLowerCase().includes("pump")
      );

      if (hasPumpToken) {
        console.log(`🚀 Pool found with "pump" token: ${tokenMints}`);
      } else {
        console.log(
          `❌ Pool found, but no "pump" token detected: ${tokenMints}`
        );
      }

      return hasPumpToken;
    } catch (error: any) {
      console.error(`❌ Error checking Raydium pool for ${tokenMint}:`, error);
      return false;
    }
  }

  extractTokenMintFromBio(bio: string): string | null {
    if (!bio) return null;

    const words = bio.split(/\s+/); // Split by whitespace
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // Rough Solana address pattern

    // Find a token address that contains "pump"
    for (const word of words) {
      if (
        word.toLowerCase().includes("pump") &&
        solanaAddressRegex.test(word)
      ) {
        return word;
      }
    }

    return null; // No valid token found
  }

  async evaluatePotentialAlpha(newFollow: TwitterUser) {
    if (!newFollow.bio) return;

    // Fetch the user's profile to get their follower count
    const profile = await this.scraper.getProfile(newFollow.username);
    const followerCount = profile.followersCount || 0; // Default to 0 if undefined

    const tokenMint = this.extractTokenMintFromBio(newFollow.bio);

    if (!tokenMint) {
      this.logger.info(
        `❌ No pump-related token found in ${newFollow.username}'s bio.`
      );
      return;
    }

    // Check if the token has a Raydium pool with a "pump" token
    const raydiumPoolHasPump = await this.hasRaydiumPoolWithPump(tokenMint);

    if (raydiumPoolHasPump) {
      this.logger.info(
        `🚀 Alpha signal detected: ${newFollow.username} (${newFollow.id}) - ` +
          `Followers: ${followerCount} - Bio: ${newFollow.bio} - Token Mint: ${tokenMint} - Raydium Pool: ✅`
      );

      // Add logic here to trigger a buy, notify, or further analyze
    } else {
      this.logger.info(
        `❌ Not a buy signal: ${newFollow.username} - Token Mint: ${tokenMint} - Raydium Pool: ❌`
      );
    }
  }

  async startMonitoring(intervalMinutes: number = 5) {
    this.logger.info("🚀 Starting Twitter Follow Monitoring...");
    await this.login();
    for (const account of this.accounts) {
      await this.checkForNewFollowing(account);
    }
    setInterval(async () => {
      for (const account of this.accounts) {
        await this.checkForNewFollowing(account).catch((error) =>
          this.logger.error(`❌ Error monitoring ${account}:`, error)
        );
      }
    }, intervalMinutes * 60 * 1000);
  }

  async cleanup() {
    this.logger.info("🛑 Closing database connection...");
    await this.pool.end();
  }
}
