import { elizaLogger, Evaluator, IAgentRuntime, Memory, State, ServiceType } from '@elizaos/core';
import { AlphaService } from '../services/alpha.service.ts';

/**
 * AlphaTweetEvaluator
 *
 * This evaluator runs after the agent has generated responses
 * and checks if any recent tweets from the agent's Twitter account
 * mention alpha signals. If so, it marks those signals as tweeted
 * in the database to prevent duplicate recommendations.
 */
export const alphaTweetEvaluator: Evaluator = {
  name: 'ALPHA_TWEET_EVALUATOR',
  similes: ['ALPHA_TWEET_CHECK', 'VERIFY_ALPHA_TWEET'],
  description: 'Checks if recent tweets mention alpha signals and marks them as tweeted',
  alwaysRun: false, // Only run when validate returns true

  /**
   * Validation logic to determine if the evaluator should run
   */
  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    try {
      // Run this evaluator only on a cycle (every 10 messages)

      // Check if the TWITTER_USERNAME env var is set
      const twitterUsername = process.env.TWITTER_USERNAME;
      if (!twitterUsername) {
        elizaLogger.warn(
          'TWITTER_USERNAME environment variable not set, skipping alpha tweet evaluation',
        );
        return false;
      }

      return true;
    } catch (error) {
      elizaLogger.error(
        `Error in alpha tweet evaluator validation: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  },

  /**
   * Handler that performs the actual evaluation
   */
  handler: async (runtime: IAgentRuntime, _message: Memory, _state?: State) => {
    try {
      const service = runtime.services.get('alpha' as ServiceType) as AlphaService;
      const twitterUsername = process.env.TWITTER_USERNAME;

      if (!twitterUsername) {
        throw new Error('TWITTER_USERNAME environment variable not set');
      }

      // Get the count from env var or default to 3
      const count = process.env.ALPHA_TWEET_CHECK_COUNT
        ? parseInt(process.env.ALPHA_TWEET_CHECK_COUNT, 10)
        : 3;

      // Check recent tweets and mark alpha signals as tweeted
      const markedTokens = await service.checkAndMarkTweetedAlphaSignals(twitterUsername, count);

      // Log the evaluation results
      if (markedTokens.length > 0) {
        elizaLogger.info(`Alpha Tweet Evaluator marked ${markedTokens.length} signals as tweeted`);

        // We can't directly add to memory, so we'll just log the event
        elizaLogger.info(
          `Alpha signal update: ${markedTokens.length} signals marked as tweeted for @${twitterUsername}`,
        );
      }

      return {
        result: 'evaluation complete',
        markedTokens,
        totalChecked: count,
      };
    } catch (error) {
      elizaLogger.error(
        `Error in alpha tweet evaluator: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        result: 'evaluation failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  // Example showing how the evaluator works
  examples: [],
};
