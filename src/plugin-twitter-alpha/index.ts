import { Plugin } from '@elizaos/core';
import { alphaTweetEvaluator } from './evaluators/alpha-tweet-evaluator.ts';
import { unpostedAlphaProvider } from './providers/index.ts';

export const twitterAlphaPlugin: Plugin = {
  name: 'Twitter Alpha Plugin',
  description: 'Collects alpha signals from Twitter',
  actions: [],
  evaluators: [alphaTweetEvaluator],
  providers: [unpostedAlphaProvider],
  services: [],
};

export default twitterAlphaPlugin;
