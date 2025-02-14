import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionExample,
  elizaLogger,
  ServiceType,
} from '@elizaos/core';
import { TradingService } from '../services/trading.service.ts';

const balanceKeywords = ['check balance', 'show balance', 'get balance', 'view balance'];

export const getBalancesAction: Action = {
  name: 'GET_BALANCES',
  similes: ['CHECK_BALANCES', 'SHOW_BALANCES', 'VIEW_BALANCES', 'LIST_BALANCES'],

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text.toLowerCase();

    // Check if message contains a balance check request
    return balanceKeywords.some((keyword) => text.includes(keyword));
  },

  description: 'Retrieves and displays all token balances in the trading account.',

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<boolean> => {
    let text = '';

    try {
      let currentState = state;
      if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
      } else {
        currentState = await runtime.updateRecentMessageState(currentState);
      }

      elizaLogger.info(`GET_BALANCES Handler triggered: ${message.content.text}`);

      // Initialize trading module
      const tradingService = runtime.services.get('trading' as ServiceType) as TradingService;

      // Get all balances
      const balances = tradingService.getAllBalances();

      if (balances.length === 0) {
        text = '❌ No token balances found in the account.';
        elizaLogger.warn('GET_BALANCES: No balances found');
      } else {
        // Format balances into a readable message
        const balanceLines = balances.map(({ token, amount }) => {
          // Map well-known token addresses to symbols for readability
          const symbolMap: { [key: string]: string } = {
            So11111111111111111111111111111111111111112: 'SOL',
            EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
            Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
          };

          const symbol = symbolMap[token] || token.slice(0, 8) + '...';
          return `**${symbol}**: ${amount}`;
        });

        text = '💰 Current Account Balances:\n' + balanceLines.join('\n');
        elizaLogger.info('GET_BALANCES: Successfully retrieved balances');
      }
    } catch (error) {
      text = '⚠️ An error occurred while retrieving balances. Please try again later.';
      elizaLogger.error(`GET_BALANCES error: ${error.message}`);
    }

    // Create a new memory entry for the response
    const newMemory: Memory = {
      ...message,
      userId: message.agentId,
      content: {
        text,
        action: 'GET_BALANCES',
        source: message.content.source,
      },
    };

    // Save to memory
    await runtime.messageManager.createMemory(newMemory);

    // Call callback AFTER saving memory
    await callback?.({ text });

    return true;
  },

  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Check my balances' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: '💰 Current Account Balances:\n**SOL**: 10\n**USDC**: 1000\n**USDT**: 1000',
          action: 'GET_BALANCES',
        },
      },
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Show me my token balances' },
      },
      {
        user: '{{agentName}}',
        content: {
          text: '💰 Current Account Balances:\n**SOL**: 10\n**USDC**: 1000\n**USDT**: 1000',
          action: 'GET_BALANCES',
        },
      },
    ],
  ] as ActionExample[][],
};
