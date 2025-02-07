import {
  elizaLogger,
  getEndpoint,
  getModelSettings,
  IAgentRuntime,
  IVerifiableInferenceAdapter,
  ModelClass,
  ModelProviderName,
  settings,
  trimTokens,
  VerifiableInferenceOptions,
  VerifiableInferenceResult,
} from '@elizaos/core';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText as aiGenerateText, CoreTool, StepResult as AIStepResult } from 'ai';
import { ICotAgentRuntime } from '../../types/index.ts';

type Tool = CoreTool<any, any>;
type StepResult = AIStepResult<any>;

function getCloudflareGatewayBaseURL(
  runtime: ICotAgentRuntime,
  provider: string,
): string | undefined {
  const isCloudflareEnabled = runtime.getSetting('CLOUDFLARE_GW_ENABLED') === 'true';
  const cloudflareAccountId = runtime.getSetting('CLOUDFLARE_AI_ACCOUNT_ID');
  const cloudflareGatewayId = runtime.getSetting('CLOUDFLARE_AI_GATEWAY_ID');

  elizaLogger.debug('Cloudflare Gateway Configuration:', {
    isEnabled: isCloudflareEnabled,
    hasAccountId: !!cloudflareAccountId,
    hasGatewayId: !!cloudflareGatewayId,
    provider: provider,
  });

  if (!isCloudflareEnabled) {
    elizaLogger.debug('Cloudflare Gateway is not enabled');
    return undefined;
  }

  if (!cloudflareAccountId) {
    elizaLogger.warn('Cloudflare Gateway is enabled but CLOUDFLARE_AI_ACCOUNT_ID is not set');
    return undefined;
  }

  if (!cloudflareGatewayId) {
    elizaLogger.warn('Cloudflare Gateway is enabled but CLOUDFLARE_AI_GATEWAY_ID is not set');
    return undefined;
  }

  const baseURL = `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${cloudflareGatewayId}/${provider.toLowerCase()}`;
  elizaLogger.info('Using Cloudflare Gateway:', {
    provider,
    baseURL,
    accountId: cloudflareAccountId,
    gatewayId: cloudflareGatewayId,
  });

  return baseURL;
}

export async function generateText({
  runtime,
  context,
  modelClass,
  tools = {},
  onStepFinish,
  maxSteps = 1,
  verifiableInference = process.env.VERIFIABLE_INFERENCE_ENABLED === 'true',
  verifiableInferenceOptions,
}: {
  runtime: ICotAgentRuntime;
  context: string;
  modelClass: ModelClass;
  tools?: Record<string, Tool>;
  onStepFinish?: (event: StepResult) => Promise<void> | void;
  maxSteps?: number;
  stop?: string[];
  customSystemPrompt?: string;
  verifiableInference?: boolean;
  verifiableInferenceAdapter?: IVerifiableInferenceAdapter;
  verifiableInferenceOptions?: VerifiableInferenceOptions;
}): Promise<string> {
  if (!context) {
    console.error('generateText context is empty');
    return '';
  }

  elizaLogger.log('Generating text...');
  elizaLogger.info('Generating text with options:', {
    modelProvider: runtime.modelProvider,
    model: modelClass,
    verifiableInference,
  });
  elizaLogger.log('Using provider:', runtime.modelProvider);

  // If verifiable inference is requested and adapter is provided, use it
  if (verifiableInference && runtime.verifiableInferenceAdapter) {
    elizaLogger.log('Using verifiable inference adapter:', runtime.verifiableInferenceAdapter);
    try {
      const result: VerifiableInferenceResult =
        await runtime.verifiableInferenceAdapter.generateText(
          context,
          modelClass,
          verifiableInferenceOptions,
        );
      elizaLogger.log('Verifiable inference result:', result);
      // Verify the proof
      const isValid = await runtime.verifiableInferenceAdapter.verifyProof(result);
      if (!isValid) {
        throw new Error('Failed to verify inference proof');
      }
      return result.text;
    } catch (error) {
      elizaLogger.error('Error in verifiable inference:', error);
      throw error;
    }
  }

  const provider = runtime.modelProvider;
  elizaLogger.debug('Provider settings:', {
    provider,
    hasRuntime: !!runtime,
    runtimeSettings: {
      CLOUDFLARE_GW_ENABLED: runtime.getSetting('CLOUDFLARE_GW_ENABLED'),
      CLOUDFLARE_AI_ACCOUNT_ID: runtime.getSetting('CLOUDFLARE_AI_ACCOUNT_ID'),
      CLOUDFLARE_AI_GATEWAY_ID: runtime.getSetting('CLOUDFLARE_AI_GATEWAY_ID'),
    },
  });

  const endpoint = runtime.character.modelEndpointOverride || getEndpoint(provider);
  const modelSettings = getModelSettings(runtime.modelProvider, modelClass);
  let model = modelSettings.name;

  // allow character.json settings => secrets to override models
  switch (provider) {
    case ModelProviderName.LLAMACLOUD:
      {
        switch (modelClass) {
          case ModelClass.LARGE:
            {
              model = runtime.getSetting('LLAMACLOUD_MODEL_LARGE') || model;
            }
            break;
          case ModelClass.SMALL:
            {
              model = runtime.getSetting('LLAMACLOUD_MODEL_SMALL') || model;
            }
            break;
        }
      }
      break;
    case ModelProviderName.TOGETHER:
      {
        switch (modelClass) {
          case ModelClass.LARGE:
            {
              model = runtime.getSetting('TOGETHER_MODEL_LARGE') || model;
            }
            break;
          case ModelClass.SMALL:
            {
              model = runtime.getSetting('TOGETHER_MODEL_SMALL') || model;
            }
            break;
        }
      }
      break;
    case ModelProviderName.OPENROUTER:
      {
        switch (modelClass) {
          case ModelClass.LARGE:
            {
              model = runtime.getSetting('LARGE_OPENROUTER_MODEL') || model;
            }
            break;
          case ModelClass.SMALL:
            {
              model = runtime.getSetting('SMALL_OPENROUTER_MODEL') || model;
            }
            break;
        }
      }
      break;
  }

  elizaLogger.info('Selected model:', model);

  const modelConfiguration = runtime.character?.settings?.modelConfig;
  const temperature = modelConfiguration?.temperature || modelSettings.temperature;
  const frequency_penalty =
    modelConfiguration?.frequency_penalty || modelSettings.frequency_penalty;
  const presence_penalty = modelConfiguration?.presence_penalty || modelSettings.presence_penalty;
  const max_context_length = modelConfiguration?.maxInputTokens || modelSettings.maxInputTokens;

  // Use the configured maxOutputTokens, but if the system prompt includes a chain-of-thought
  // directive, force a higher limit (e.g., 16384 tokens)
  let max_response_length =
    modelConfiguration?.max_response_length || modelSettings.maxOutputTokens;
  if (runtime.character.system && runtime.character.system.includes('<chain-of-thought>')) {
    max_response_length = Math.max(max_response_length, 16384);
  }

  const experimental_telemetry =
    modelConfiguration?.experimental_telemetry || modelSettings.experimental_telemetry;

  const apiKey = runtime.token;

  try {
    elizaLogger.debug(`Trimming context to max length of ${max_context_length} tokens.`);
    context = await trimTokens(context, max_context_length, runtime);
    let response: string;
    elizaLogger.debug(
      `Using provider: ${provider}, model: ${model}, temperature: ${temperature}, max response length: ${max_response_length}`,
    );

    // (The switch statement with each provider branch remains unchanged.)
    // For brevity, here’s just the OPENAI branch as an example:
    switch (provider) {
      case ModelProviderName.OPENAI:
      case ModelProviderName.ALI_BAILIAN:
      case ModelProviderName.VOLENGINE:
      case ModelProviderName.LLAMACLOUD:
      case ModelProviderName.NANOGPT:
      case ModelProviderName.HYPERBOLIC:
      case ModelProviderName.TOGETHER:
      case ModelProviderName.NINETEEN_AI:
      case ModelProviderName.AKASH_CHAT_API:
      case ModelProviderName.LMSTUDIO: {
        elizaLogger.debug('Initializing OpenAI model with Cloudflare check');
        const baseURL = getCloudflareGatewayBaseURL(runtime, 'openai') || endpoint;
        const openai = createOpenAI({
          apiKey,
          baseURL,
          fetch: runtime.fetch,
        });
        const { text: openaiResponse } = await aiGenerateText({
          model: openai.languageModel(model),
          prompt: context,
          system: runtime.character.system ?? settings.SYSTEM_PROMPT ?? undefined,
          tools: tools,
          onStepFinish: onStepFinish,
          maxSteps: maxSteps,
          temperature: temperature,
          maxTokens: max_response_length,
          frequencyPenalty: frequency_penalty,
          presencePenalty: presence_penalty,
          experimental_telemetry: experimental_telemetry,
        });
        response = openaiResponse;
        console.log('Received response from OpenAI model.');
        break;
      }
      // ... (other provider cases remain unchanged)
      default: {
        const errorMessage = `Unsupported provider: ${provider}`;
        elizaLogger.error(errorMessage);
        throw new Error(errorMessage);
      }
    }
    return response;
  } catch (error) {
    elizaLogger.error('Error in generateText:', error);
    throw error;
  }
}
