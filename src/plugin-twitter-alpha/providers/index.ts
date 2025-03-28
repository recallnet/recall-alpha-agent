import { IAgentRuntime, Memory, Provider, State, ServiceType, elizaLogger } from '@elizaos/core';
import { AlphaService } from '../services/alpha.service.ts';

/**
 * Provider that retrieves unposted alpha signals for use in Twitter posts.
 * This provider gets alpha data from the database via the Alpha service.
 */
export const unpostedAlphaProvider: Provider = {
  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<Error | string> => {
    try {
      // Get the alpha service and type cast it correctly
      const service = runtime.services.get('alpha' as ServiceType) as AlphaService;
      const unpostedAlpha = await service.getUnpostedAlpha();

      if (!unpostedAlpha || unpostedAlpha.length === 0) {
        elizaLogger.info('No unposted alpha signals found');
        return JSON.stringify({ found: false, message: 'No unposted alpha signals available' });
      }

      elizaLogger.info(`Retrieved ${unpostedAlpha.length} unposted alpha signals`);

      // Format the response with enriched data for the agent
      const formattedAlpha = unpostedAlpha.map((entry) => {
        return {
          tokenMint: entry.tokenMint,
          username: entry.username,
          bio: entry.bio,
          followersCount: entry.followersCount,
          followingCount: entry.followingCount,
          tweetsCount: entry.tweetsCount,
          accountCreated: entry.accountCreated,
          isMintable: entry.isMintable,
          hasPool: entry.hasPool,
          poolData: {
            wsolPoolAge: entry.wsolPoolAge,
            usdcPoolAge: entry.usdcPoolAge,
            wsolPoolTvl: entry.wsolPoolTvl,
            usdcPoolTvl: entry.usdcPoolTvl,
            wsolPoolVolume24h: entry.wsolPoolVolume24h,
            usdcPoolVolume24h: entry.usdcPoolVolume24h,
            wsolPoolPrice: entry.wsolPoolPrice,
            usdcPoolPrice: entry.usdcPoolPrice,
          },
          addedAt: entry.addedAt,
        };
      });
      _state.knowledge =
        `Use the following alpha signal to create a post about this potential opportunity: \n` +
        JSON.stringify(formattedAlpha[0], null, 2) +
        `\n NOTE: if this field exists, you should absolutely create a Twitter post as your action`;
      await runtime.updateRecentMessageState(_state);
      return (
        `Use the following alpha signal to create a post about this potential opportunity: \n` +
        JSON.stringify(formattedAlpha[0], null, 2)
      );
    } catch (error) {
      elizaLogger.error(
        `Error fetching unposted alpha: ${error instanceof Error ? error.message : String(error)}`,
      );
      return error instanceof Error ? error.message : 'Unable to get unposted alpha signals';
    }
  },
};
