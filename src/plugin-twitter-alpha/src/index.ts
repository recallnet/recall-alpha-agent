import type { Plugin } from '@elizaos/core';
import { postAction } from './actions/post.ts';
import { AlphaService } from '../services/alpha.service.ts';

export const twitterAlphaPlugin: Plugin = {
  name: 'twitter',
  description: 'Twitter integration plugin for posting tweets',
  // actions: [postAction],
  evaluators: [],
  providers: [],
  services: [new AlphaService()],
};

export default twitterAlphaPlugin;
