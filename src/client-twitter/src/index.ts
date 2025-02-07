import { type Client, elizaLogger, type IAgentRuntime } from '@elizaos/core';
import { ClientBase } from './base.ts';
import { validateTwitterConfig, type TwitterConfig } from './environment.ts';
import { TwitterInteractionClient } from './interactions.ts';
import { TwitterPostClient } from './post.ts';
import { TwitterSearchClient } from './search.ts';
import { CotAgentRuntime, ICotAgentRuntime } from '../../types/index.ts';

/**
 * A manager that orchestrates all specialized Twitter logic:
 * - client: base operations (login, timeline caching, etc.)
 * - post: autonomous posting logic
 * - search: searching tweets / replying logic
 * - interaction: handling mentions, replies
 * - space: launching and managing Twitter Spaces (optional)
 */
class TwitterManager {
  client: ClientBase;
  post: TwitterPostClient;
  search: TwitterSearchClient;
  interaction: TwitterInteractionClient;

  constructor(runtime: ICotAgentRuntime, twitterConfig: TwitterConfig) {
    // Pass twitterConfig to the base client
    this.client = new ClientBase(runtime, twitterConfig);

    // Posting logic
    this.post = new TwitterPostClient(this.client, runtime);

    // Optional search logic (enabled if TWITTER_SEARCH_ENABLE is true)
    if (twitterConfig.TWITTER_SEARCH_ENABLE) {
      elizaLogger.warn('Twitter/X client running in a mode that:');
      elizaLogger.warn('1. violates consent of random users');
      elizaLogger.warn('2. burns your rate limit');
      elizaLogger.warn('3. can get your account banned');
      elizaLogger.warn('use at your own risk');
      this.search = new TwitterSearchClient(this.client, runtime);
    }

    // Mentions and interactions
    this.interaction = new TwitterInteractionClient(this.client, runtime);

    // Optional Spaces logic (enabled if TWITTER_SPACES_ENABLE is true)
  }
}

export const TwitterClientInterface: Client = {
  async start(runtime: ICotAgentRuntime) {
    const twitterConfig: TwitterConfig = await validateTwitterConfig(runtime);

    elizaLogger.log('Twitter client started');

    const manager = new TwitterManager(runtime, twitterConfig);

    // Initialize login/session
    await manager.client.init();

    // Start the posting loop
    await manager.post.start();

    // Start the search logic if it exists
    if (manager.search) {
      await manager.search.start();
    }

    // Start interactions (mentions, replies)
    await manager.interaction.start();

    return manager;
  },

  async stop(_runtime: CotAgentRuntime) {
    elizaLogger.warn('Twitter client does not support stopping yet');
  },
};

export default TwitterClientInterface;
