import { SearchMode, type Tweet } from 'agent-twitter-client';
import {
  composeContext,
  generateShouldRespond,
  messageCompletionFooter,
  shouldRespondFooter,
  type Content,
  type HandlerCallback,
  type Memory,
  ModelClass,
  type State,
  stringToUuid,
  elizaLogger,
  getEmbeddingZeroVector,
  type IImageDescriptionService,
  ServiceType,
  parseJSONObjectFromText,
} from '@elizaos/core';
import type { ClientBase } from './base';
import { generateText } from './interactionMethods.ts';
import { buildConversationThread, sendTweet, wait } from './utils.ts';
import { ICotAgentRuntime } from '../../types/index.ts';

export const twitterMessageHandlerTemplate =
  `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# TASK: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:

Current Post:
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Generate a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}). You MUST include an action if the current post text includes a prompt that is similar to one of the available actions mentioned here:
{{actionNames}}
{{actions}}

Think step-by-step before responding.

Please follow these steps in your chain-of-thought:
1. Identify the key elements in the conversation, including references from the context you have from your knowledge base, recent messages, and the current post.
2. Break down the problem into smaller logical steps, thinking logically about how to incorporate all the information you have at your disposal.
3. Analyze the relevant data-oriented, knowledge-based, and personality-driven details, context, and past interactions.
4. Formulate a preliminary conclusion or solution based on your aggregated findings, explaining your reasoning, and then further refine it.
5. Use the above reasoning to generate your final, well-structured technical response.

# FORMAT: Please format your response using the following structure:

<chain-of-thought>
(full chain-of-thought logs go here, incorporating the injected market data, blockchain insights, and recent messages)
</chain-of-thought>

Final Answer:
{{finalAnswer}}

# Example Response

Keep in mind that the following examples are for reference only. Do not use the information from them in your response. The example uses a specific imaginary token, but you can write a post generally aligned with {{agentName}}'s expertise.

The following is an example chain-of-thought log and final answer in relation to this imaginary post: 

# Start of example post
"They knew what they are getting into, they are just gamblers it's OK if they lose money"

Be very cautious of folks with this opinion for they have no moral code, they lack empathy and are quick to judge others

# End of example post

<chain-of-thought>
1. The post suggests a dismissive attitude toward traders losing money, implying that risk-taking absolves responsibility.
2. This perspective ignores the reality that many traders lack full information and are often misled by bad actors.
3. Evaluating market sentiment, those who justify financial losses with "they knew what they were getting into" often fail to account for manipulative practices, insider advantages, and asymmetric information.
4. Ethical trading intelligence includes warning traders about **red flags**, not just analyzing profitable opportunities.
5. Engaging constructively means addressing **both risk and responsibility**, promoting awareness rather than indifference.
</chain-of-thought>

Final Answer:
Markets thrive on informed participants, not blind gamblers. Dismissing losses as "they knew what they were getting into" ignores the role of asymmetric information and market manipulation. A trader’s best edge is knowledge—not apathy to risk

**Keep in mind that the examples are for reference only. If you do not have a specific token or project in mind, you can write a post generally aligned with {{agentName}}'s expertise.**

Here is the current post text again. Remember to include an action if the current post text includes a prompt that asks for one of the available actions mentioned above (does not need to be exact)
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}
` + messageCompletionFooter;

export const twitterShouldRespondTemplate = (targetUsersStr: string) =>
  `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

PRIORITY RULE: ALWAYS RESPOND to these users regardless of topic or message content: ${targetUsersStr}. Topic relevance should be ignored for these users.

For other users:
- {{agentName}} should RESPOND to messages directed at them
- {{agentName}} should RESPOND to conversations relevant to their background
- {{agentName}} should IGNORE irrelevant messages
- {{agentName}} should IGNORE very short messages unless directly addressed
- {{agentName}} should STOP if asked to stop
- {{agentName}} should STOP if conversation is concluded
- {{agentName}} is in a room with other users and wants to be conversational, but not annoying.

IMPORTANT:
- {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.
- For users not in the priority list, {{agentName}} (@{{twitterUserName}}) should err on the side of IGNORE rather than RESPOND if in doubt.

Recent Posts:
{{recentPosts}}

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# Think step-by-step before responding

Please follow these steps in your chain-of-thought:
1. Identify the key elements in the conversation, including references from the context you have from your knowledge base, recent messages, and the current post.
2. Break down the problem into smaller logical steps, thinking logically about how to incorporate all the information you have at your disposal.
3. Analyze the relevant data-oriented, knowledge-based, and personality-driven details, context, and past interactions.
4. Formulate a preliminary conclusion or solution based on your aggregated findings, explaining your reasoning, and then further refine it.
5. Use the above reasoning to generate your final, well-structured technical response.

# FORMAT: Please structure your response as follows:

<chain-of-thought>
(full chain-of-thought logs go here, incorporating the injected market data, blockchain insights, and recent messages)
</chain-of-thought>

Final Answer:
{{finalAnswer}}

---

# Example Response

Keep in mind that the following examples are for reference only. Do not use the information from them in your response.

### **Example 1: Responding to a High-Signal Alpha Mention**
<chain-of-thought>
1. **Context Check:** The tweet is from a well-known trader who has a history of early calls on emerging tokens.
2. **Alpha Signal Analysis:** The trader mentioned a newly listed Solana token and included a wallet address tied to early liquidity movement.
3. **Relevance Filter:** This aligns with my expertise—tracking early trading signals based on social and on-chain activity.
4. **Engagement Quality:** The tweet has multiple high-value replies from other respected accounts, indicating genuine interest.
5. **Actionable Opportunity:** I checked Raydium, and liquidity was just added. This suggests early-stage positioning.
6. **Risk Assessment:** No obvious signs of engagement farming or scam activity.
</chain-of-thought>

Final Answer: RESPOND

---

### **Example 2: Ignoring a Low-Value Engagement**
<chain-of-thought>
1. **Context Check:** The tweet is from an anonymous account with no history of providing credible alpha.
2. **Alpha Signal Analysis:** The tweet mentions a random low-cap token with no known wallet accumulation or liquidity injection.
3. **Relevance Filter:** The project is outside my usual scope, with no clear Solana or on-chain relevance.
4. **Engagement Quality:** Replies are mostly giveaway hunters and bots—low-quality engagement.
5. **Actionable Opportunity:** No indication of real alpha or insider positioning.
6. **Risk Assessment:** This is likely a low-effort pump or engagement farming attempt.
</chain-of-thought>

Final Answer: IGNORE

---

### **Example 3: Stopping Engagement in a Concluded Conversation**
<chain-of-thought>
1. **Context Check:** The conversation started about a new presale token but has now derailed into unrelated discussion.
2. **Alpha Signal Analysis:** No further alpha insights can be extracted—wallet tracking has shown no additional movement.
3. **Relevance Filter:** The discussion has shifted from actionable trade signals to speculation.
4. **Engagement Quality:** Replies are mostly off-topic, with no additional reputable traders adding value.
5. **Actionable Opportunity:** No further trade setups—continuing the conversation adds no alpha.
6. **Risk Assessment:** Engaging further would be unnecessary and could dilute focus.
</chain-of-thought>

Final Answer: STOP

---

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;

export class TwitterInteractionClient {
  client: ClientBase;
  runtime: ICotAgentRuntime;
  private isDryRun: boolean;
  constructor(client: ClientBase, runtime: ICotAgentRuntime) {
    this.client = client;
    this.runtime = runtime;
    this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN;
  }

  async start() {
    const handleTwitterInteractionsLoop = () => {
      this.handleTwitterInteractions();
      setTimeout(
        handleTwitterInteractionsLoop,
        // Defaults to 2 minutes
        this.client.twitterConfig.TWITTER_POLL_INTERVAL * 1000,
      );
    };
    handleTwitterInteractionsLoop();
  }

  async handleTwitterInteractions() {
    elizaLogger.log('Checking Twitter interactions');

    const twitterUsername = this.client.profile.username;
    try {
      // Check for mentions
      const mentionCandidates = (
        await this.client.fetchSearchTweets(`@${twitterUsername}`, 20, SearchMode.Latest)
      ).tweets;

      elizaLogger.log('Completed checking mentioned tweets:', mentionCandidates.length);
      let uniqueTweetCandidates = [...mentionCandidates];
      // Only process target users if configured
      if (this.client.twitterConfig.TWITTER_TARGET_USERS.length) {
        const TARGET_USERS = this.client.twitterConfig.TWITTER_TARGET_USERS;

        elizaLogger.log('Processing target users:', TARGET_USERS);

        if (TARGET_USERS.length > 0) {
          // Create a map to store tweets by user
          const tweetsByUser = new Map<string, Tweet[]>();

          // Fetch tweets from all target users
          for (const username of TARGET_USERS) {
            try {
              const userTweets = (
                await this.client.twitterClient.fetchSearchTweets(
                  `from:${username}`,
                  3,
                  SearchMode.Latest,
                )
              ).tweets;

              // Filter for unprocessed, non-reply, recent tweets
              const validTweets = userTweets.filter((tweet) => {
                const isUnprocessed =
                  !this.client.lastCheckedTweetId ||
                  Number.parseInt(tweet.id) > this.client.lastCheckedTweetId;
                const isRecent = Date.now() - tweet.timestamp * 1000 < 8 * 60 * 60 * 1000;

                elizaLogger.log(`Tweet ${tweet.id} checks:`, {
                  isUnprocessed,
                  isRecent,
                  isReply: tweet.isReply,
                  isRetweet: tweet.isRetweet,
                });

                return isUnprocessed && !tweet.isReply && !tweet.isRetweet && isRecent;
              });

              if (validTweets.length > 0) {
                tweetsByUser.set(username, validTweets);
                elizaLogger.log(`Found ${validTweets.length} valid tweets from ${username}`);
              }
            } catch (error) {
              elizaLogger.error(`Error fetching tweets for ${username}:`, error);
              continue;
            }
          }

          // Select one tweet from each user that has tweets
          const selectedTweets: Tweet[] = [];
          for (const [username, tweets] of tweetsByUser) {
            if (tweets.length > 0) {
              // Randomly select one tweet from this user
              const randomTweet = tweets[Math.floor(Math.random() * tweets.length)];
              selectedTweets.push(randomTweet);
              elizaLogger.log(
                `Selected tweet from ${username}: ${randomTweet.text?.substring(0, 100)}`,
              );
            }
          }

          // Add selected tweets to candidates
          uniqueTweetCandidates = [...mentionCandidates, ...selectedTweets];
        }
      } else {
        elizaLogger.log('No target users configured, processing only mentions');
      }

      // Sort tweet candidates by ID in ascending order
      uniqueTweetCandidates
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((tweet) => tweet.userId !== this.client.profile.id);

      // for each tweet candidate, handle the tweet
      for (const tweet of uniqueTweetCandidates) {
        if (!this.client.lastCheckedTweetId || BigInt(tweet.id) > this.client.lastCheckedTweetId) {
          // Generate the tweetId UUID the same way it's done in handleTweet
          const tweetId = stringToUuid(tweet.id + '-' + this.runtime.agentId);

          // Check if we've already processed this tweet
          const existingResponse = await this.runtime.messageManager.getMemoryById(tweetId);

          if (existingResponse) {
            elizaLogger.log(`Already responded to tweet ${tweet.id}, skipping`);
            continue;
          }
          elizaLogger.log('New Tweet found', tweet.permanentUrl);

          const roomId = stringToUuid(tweet.conversationId + '-' + this.runtime.agentId);

          const userIdUUID =
            tweet.userId === this.client.profile.id
              ? this.runtime.agentId
              : stringToUuid(tweet.userId!);

          await this.runtime.ensureConnection(
            userIdUUID,
            roomId,
            tweet.username,
            tweet.name,
            'twitter',
          );

          const thread = await buildConversationThread(tweet, this.client);

          const message = {
            content: {
              text: tweet.text,
              imageUrls: tweet.photos?.map((photo) => photo.url) || [],
            },
            agentId: this.runtime.agentId,
            userId: userIdUUID,
            roomId,
          };

          await this.handleTweet({
            tweet,
            message,
            thread,
          });

          // Update the last checked tweet ID after processing each tweet
          this.client.lastCheckedTweetId = BigInt(tweet.id);
        }
      }

      // Save the latest checked tweet ID to the file
      await this.client.cacheLatestCheckedTweetId();

      elizaLogger.log('Finished checking Twitter interactions');
    } catch (error) {
      elizaLogger.error('Error handling Twitter interactions:', error);
    }
  }

  private async handleTweet({
    tweet,
    message,
    thread,
  }: {
    tweet: Tweet;
    message: Memory;
    thread: Tweet[];
  }) {
    // Only skip if tweet is from self AND not from a target user
    if (
      tweet.userId === this.client.profile.id &&
      !this.client.twitterConfig.TWITTER_TARGET_USERS.includes(tweet.username)
    ) {
      return;
    }

    if (!message.content.text) {
      elizaLogger.log('Skipping Tweet with no text', tweet.id);
      return { text: '', action: 'IGNORE' };
    }

    elizaLogger.log('Processing Tweet: ', tweet.id);
    const formatTweet = (tweet: Tweet) => {
      return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
    };
    const currentPost = formatTweet(tweet);

    const formattedConversation = thread
      .map(
        (tweet) => `@${tweet.username} (${new Date(tweet.timestamp * 1000).toLocaleString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        })}):
        ${tweet.text}`,
      )
      .join('\n\n');

    const imageDescriptionsArray = [];
    try {
      for (const photo of tweet.photos) {
        const description = await this.runtime
          .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
          .describeImage(photo.url);
        imageDescriptionsArray.push(description);
      }
    } catch (error) {
      // Handle the error
      elizaLogger.error('Error Occured during describing image: ', error);
    }

    let state = await this.runtime.composeState(message, {
      twitterClient: this.client.twitterClient,
      twitterUserName: this.client.twitterConfig.TWITTER_USERNAME,
      currentPost,
      formattedConversation,
      imageDescriptions:
        imageDescriptionsArray.length > 0
          ? `\nImages in Tweet:\n${imageDescriptionsArray
              .map(
                (desc, i) =>
                  `Image ${i + 1}: Title: ${desc.title}\nDescription: ${desc.description}`,
              )
              .join('\n\n')}`
          : '',
    });

    // check if the tweet exists, save if it doesn't
    const tweetId = stringToUuid(tweet.id + '-' + this.runtime.agentId);
    const tweetExists = await this.runtime.messageManager.getMemoryById(tweetId);

    if (!tweetExists) {
      elizaLogger.log('tweet does not exist, saving');
      const userIdUUID = stringToUuid(tweet.userId as string);
      const roomId = stringToUuid(tweet.conversationId);

      const message = {
        id: tweetId,
        agentId: this.runtime.agentId,
        content: {
          text: tweet.text,
          url: tweet.permanentUrl,
          imageUrls: tweet.photos?.map((photo) => photo.url) || [],
          inReplyTo: tweet.inReplyToStatusId
            ? stringToUuid(tweet.inReplyToStatusId + '-' + this.runtime.agentId)
            : undefined,
        },
        userId: userIdUUID,
        roomId,
        createdAt: tweet.timestamp * 1000,
      };
      this.client.saveRequestMessage(message, state);
    }

    // get usernames into str
    const validTargetUsersStr = this.client.twitterConfig.TWITTER_TARGET_USERS.join(',');

    const shouldRespondContext = composeContext({
      state,
      template:
        this.runtime.character.templates?.twitterShouldRespondTemplate ||
        this.runtime.character?.templates?.shouldRespondTemplate ||
        twitterShouldRespondTemplate(validTargetUsersStr),
    });

    const shouldRespond = await generateShouldRespond({
      runtime: this.runtime,
      context: shouldRespondContext,
      modelClass: ModelClass.MEDIUM,
    });

    // Promise<"RESPOND" | "IGNORE" | "STOP" | null> {
    if (shouldRespond !== 'RESPOND') {
      elizaLogger.log('Not responding to message');
      return { text: 'Response Decision:', action: shouldRespond };
    }

    const context = composeContext({
      state: {
        ...state,
        // Convert actionNames array to string
        actionNames: Array.isArray(state.actionNames)
          ? state.actionNames.join(', ')
          : state.actionNames || '',
        actions: Array.isArray(state.actions) ? state.actions.join('\n') : state.actions || '',
        // Ensure character examples are included
        characterPostExamples: this.runtime.character.messageExamples
          ? this.runtime.character.messageExamples
              .map((example) =>
                example
                  .map(
                    (msg) =>
                      `${msg.user}: ${msg.content.text}${msg.content.action ? ` [Action: ${msg.content.action}]` : ''}`,
                  )
                  .join('\n'),
              )
              .join('\n\n')
          : '',
      },
      template:
        this.runtime.character.templates?.twitterMessageHandlerTemplate ||
        this.runtime.character?.templates?.messageHandlerTemplate ||
        twitterMessageHandlerTemplate,
    });

    // Call `generateText` directly to leverage the chain-of-thought prompt
    const gen = await generateText({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.LARGE,
    });
    const alteredGen = gen;
    elizaLogger.info('Generated response:', JSON.stringify(alteredGen, null, 2));
    const parsedContent = parseJSONObjectFromText(alteredGen) as Content;

    const finalAnswerMarker = 'Final Answer:';
    let chainOfThoughtText = '';

    if (alteredGen.includes(finalAnswerMarker)) {
      const parts = alteredGen.split(finalAnswerMarker);
      chainOfThoughtText = parts[0].trim();
      chainOfThoughtText = chainOfThoughtText.replace(/<\/?chain-of-thought>/g, '').trim();

      // Log chain-of-thought reasoning into the database
      await this.runtime.databaseAdapter.logMemory({
        userId: message.userId,
        agentId: message.agentId,
        type: 'chain-of-thought',
        body: JSON.stringify({
          log: chainOfThoughtText,
          userMessage: tweet.text,
        }),
        roomId: message.roomId,
      });
    }

    const removeQuotes = (str: string) => str.replace(/^['"](.*)['"]$/, '$1');

    const stringId = stringToUuid(tweet.id + '-' + this.runtime.agentId);

    parsedContent.inReplyTo = stringId;

    parsedContent.text = removeQuotes(parsedContent.text);

    if (parsedContent.text) {
      if (this.isDryRun) {
        elizaLogger.info(
          `Dry run: Selected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${parsedContent.text}`,
        );
      } else {
        try {
          const callback: HandlerCallback = async (response: Content, tweetId?: string) => {
            const memories = await sendTweet(
              this.client,
              response,
              message.roomId,
              this.client.twitterConfig.TWITTER_USERNAME,
              tweetId || tweet.id,
            );
            return memories;
          };

          const action = this.runtime.actions.find((a) => a.name === parsedContent.action);
          const shouldSuppressInitialMessage = action?.suppressInitialMessage;

          let responseMessages = [];

          if (!shouldSuppressInitialMessage) {
            responseMessages = await callback(parsedContent);
          } else {
            const memory: Memory = {
              id: stringToUuid(tweet.id + '-' + this.runtime.agentId),
              userId: this.runtime.agentId,
              agentId: this.runtime.agentId,
              content: parsedContent,
              roomId: message.roomId,
              createdAt: Date.now(),
            };

            const embeddedMemory = await this.runtime.messageManager.addEmbeddingToMemory(memory);

            responseMessages = [embeddedMemory];
          }

          state = (await this.runtime.updateRecentMessageState(state)) as State;

          for (const responseMessage of responseMessages) {
            if (responseMessage === responseMessages[responseMessages.length - 1]) {
              responseMessage.content.action = parsedContent.action;
            } else {
              responseMessage.content.action = 'CONTINUE';
            }
            await this.runtime.messageManager.createMemory(responseMessage);
          }

          const responseTweetId = responseMessages[responseMessages.length - 1]?.content?.tweetId;

          await this.runtime.processActions(
            message,
            responseMessages,
            state,
            (response: Content) => {
              return callback(response, responseTweetId);
            },
          );

          const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${parsedContent.text}`;

          await this.runtime.cacheManager.set(
            `twitter/tweet_generation_${tweet.id}.txt`,
            responseInfo,
          );
          await wait();
        } catch (error) {
          elizaLogger.error(`Error sending response tweet: ${error}`);
        }
      }
    }
  }

  async buildConversationThread(tweet: Tweet, maxReplies = 10): Promise<Tweet[]> {
    const thread: Tweet[] = [];
    const visited: Set<string> = new Set();

    async function processThread(currentTweet: Tweet, depth = 0) {
      elizaLogger.log('Processing tweet:', {
        id: currentTweet.id,
        inReplyToStatusId: currentTweet.inReplyToStatusId,
        depth: depth,
      });

      if (!currentTweet) {
        elizaLogger.log('No current tweet found for thread building');
        return;
      }

      if (depth >= maxReplies) {
        elizaLogger.log('Reached maximum reply depth', depth);
        return;
      }

      // Handle memory storage
      const memory = await this.runtime.messageManager.getMemoryById(
        stringToUuid(currentTweet.id + '-' + this.runtime.agentId),
      );
      if (!memory) {
        const roomId = stringToUuid(currentTweet.conversationId + '-' + this.runtime.agentId);
        const userId = stringToUuid(currentTweet.userId);

        await this.runtime.ensureConnection(
          userId,
          roomId,
          currentTweet.username,
          currentTweet.name,
          'twitter',
        );

        const memory: Memory = {
          id: stringToUuid(currentTweet.id + '-' + this.runtime.agentId),
          agentId: this.runtime.agentId,
          content: {
            text: currentTweet.text,
            source: 'twitter',
            url: currentTweet.permanentUrl,
            imageUrls: currentTweet.photos?.map((photo) => photo.url) || [],
            inReplyTo: currentTweet.inReplyToStatusId
              ? stringToUuid(currentTweet.inReplyToStatusId + '-' + this.runtime.agentId)
              : undefined,
          },
          createdAt: currentTweet.timestamp * 1000,
          roomId,
          userId:
            currentTweet.userId === this.twitterUserId
              ? this.runtime.agentId
              : stringToUuid(currentTweet.userId),
        };

        const embeddedMemory = await this.runtime.messageManager.addEmbeddingToMemory(memory);

        this.runtime.messageManager.createMemory(embeddedMemory);
      }

      if (visited.has(currentTweet.id)) {
        elizaLogger.log('Already visited tweet:', currentTweet.id);
        return;
      }

      visited.add(currentTweet.id);
      thread.unshift(currentTweet);

      if (currentTweet.inReplyToStatusId) {
        elizaLogger.log('Fetching parent tweet:', currentTweet.inReplyToStatusId);
        try {
          const parentTweet = await this.twitterClient.getTweet(currentTweet.inReplyToStatusId);

          if (parentTweet) {
            elizaLogger.log('Found parent tweet:', {
              id: parentTweet.id,
              text: parentTweet.text?.slice(0, 50),
            });
            await processThread(parentTweet, depth + 1);
          } else {
            elizaLogger.log('No parent tweet found for:', currentTweet.inReplyToStatusId);
          }
        } catch (error) {
          elizaLogger.log('Error fetching parent tweet:', {
            tweetId: currentTweet.inReplyToStatusId,
            error,
          });
        }
      } else {
        elizaLogger.log('Reached end of reply chain at:', currentTweet.id);
      }
    }

    // Need to bind this context for the inner function
    await processThread.bind(this)(tweet, 0);

    return thread;
  }
}
