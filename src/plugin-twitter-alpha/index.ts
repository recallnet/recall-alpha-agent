import { Plugin } from '@elizaos/core';
import { unpostedAlphaProvider } from './providers/index.ts';

export const twitterAlphaPlugin: Plugin = {
  name: 'Twitter Alpha Plugin',
  description: 'Collects alpha signals from Twitter',
  actions: [],
  evaluators: [],
  // providers: [unpostedAlphaProvider],
  services: [],
};

export default twitterAlphaPlugin;
