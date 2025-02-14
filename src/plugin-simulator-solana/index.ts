import { Plugin } from '@elizaos/core';
import { TradingService } from './services/trading.service.ts';
import { getBalancesAction } from './actions/get-balances.ts';

export const tradingSimulatorPlugin: Plugin = {
  name: 'Trading Simulator Plugin',
  description: 'Simulates trading on Solana',
  actions: [getBalancesAction],
  //   evaluators: [knowledgeEvaluator],
  providers: [],
  services: [TradingService.getInstance()],
};

export default tradingSimulatorPlugin;
