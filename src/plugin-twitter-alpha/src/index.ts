import type { Plugin } from '@elizaos/core';
import { postAction } from './actions/post.ts';
import { AlphaService } from '../services/alpha.service.ts';

export const twitterPlugin: Plugin = {
  name: 'twitter',
  description: 'Twitter integration plugin for posting tweets',
  actions: [postAction],
  evaluators: [],
  providers: [],
  services: [AlphaService.getInstance()],
};

export default twitterPlugin;
