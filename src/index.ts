/**
 * `@deepseek-ai/dsh-ragflow`: RAGFlow knowledge-base retrieval capability for
 * the DeepSeek Harness. This single package combines all three capability-seam
 * roles:
 *
 * - **Service Definition**: {@link RagflowRuntime} registered as `ctx.ragflow`
 * - **Service Provider**: {@link RagflowProvider} calls the RAGFlow HTTP API
 * - **Consumer / Tool**: `ragflow_retrieve` model-facing tool
 *
 * When loaded as a Cordis plugin, `apply` registers all three. The `Config`
 * schema carries provider and tool options; credentials resolve through the
 * `ctx.credentials` seam or the launch environment.
 *
 * @module @deepseek-ai/dsh-ragflow
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { RagflowRuntime } from './runtime.ts'
import type { RagflowProviderOptions } from './provider.ts'
import {
  RagflowProvider,
  RAGFLOW_DEFAULT_BASE_URL,
  RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD,
  RAGFLOW_DEFAULT_TOP_K,
} from './provider.ts'
import {
  applyRagflowRetrieveTool,
  DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS,
  RAGFLOW_RETRIEVE_DEFAULT_TOP_K,
} from './tool.ts'

export {
  RagflowError,
} from './types.ts'
export type {
  RagflowChunk,
  RagflowRetrieveProvider,
  RagflowRetrieveRequest,
  RagflowRetrieveResult,
} from './types.ts'
export { RagflowRuntime } from './runtime.ts'
export type { RagflowRuntimeConfig } from './runtime.ts'
export {
  RagflowProvider,
  RAGFLOW_DEFAULT_BASE_URL,
  RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD,
  RAGFLOW_DEFAULT_TOP_K,
  RAGFLOW_PROVIDER_ID,
} from './provider.ts'
export type { RagflowProviderOptions } from './provider.ts'
export {
  applyRagflowRetrieveTool,
  DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS,
  RAGFLOW_RETRIEVE_DEFAULT_TOP_K,
  formatRetrieveOutput,
  parseRetrieveArgs,
  presentRetrieveCall,
  retrieveMetaFromValue,
} from './tool.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ragflow'

/** Services required by this plugin. */
export const inject = ['tools', 'systemPrompt']

/** Environment variable names. */
const DEFAULT_API_KEY_ENV = 'RAGFLOW_API_KEY'
const RAGFLOW_BASE_URL_ENV = 'RAGFLOW_BASE_URL'

/** Plugin config. */
export interface Config {
  /** Literal RAGFlow API key; prefer {@link apiKeyEnv}. */
  apiKey?: string
  /** Credential reference; defaults to `RAGFLOW_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/api/v1/retrieval` is appended. */
  baseURL?: string
  /** Default dataset ids to search. */
  datasetIds?: string[]
  /** Provider-level chunk count default. */
  topK?: number
  /** Similarity threshold; chunks below this score are filtered. */
  similarityThreshold?: number
  /** Tool-level chunk cap. */
  retrieveTopK?: number
  /** Tool cooperative timeout (ms). */
  retrieveTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  datasetIds: z.array(z.string()),
  topK: z.number().step(1).min(1),
  similarityThreshold: z.number().min(0).max(1),
  retrieveTopK: z.number().step(1).min(1).default(RAGFLOW_RETRIEVE_DEFAULT_TOP_K),
  retrieveTimeoutMs: z.number().step(1).min(1).default(DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS),
})

/**
 * Resolve provider options from config and environment.
 */
function resolveProviderOptions(ctx: Context, config: Config): RagflowProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(RAGFLOW_BASE_URL_ENV)?.value
      ?? RAGFLOW_DEFAULT_BASE_URL,
    ...config.datasetIds !== undefined && config.datasetIds.length > 0 ? { datasetIds: config.datasetIds } : {},
    ...config.topK !== undefined ? { topK: config.topK } : { topK: RAGFLOW_DEFAULT_TOP_K },
    similarityThreshold: config.similarityThreshold ?? RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD,
  }
}

/**
 * Register the RAGFlow capability seam, the HTTP API provider, and the
 * `ragflow_retrieve` model-facing tool. All three are effect-scoped and
 * unregister on plugin dispose.
 */
export function apply(ctx: Context, config: Config): void {
  // 1. Register the Service Definition (ctx.ragflow)
  ctx.plugin(RagflowRuntime, {})

  // 2. Register the HTTP API provider into ctx.ragflow
  ctx.ragflow.registerRetrieveProvider(new RagflowProvider(() => resolveProviderOptions(ctx, config)))

  // 3. Register the model-facing tool
  const retrieveTopK = config.retrieveTopK ?? RAGFLOW_RETRIEVE_DEFAULT_TOP_K
  const retrieveTimeoutMs = config.retrieveTimeoutMs ?? DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS
  const datasetIds = config.datasetIds
  applyRagflowRetrieveTool(ctx, retrieveTopK, retrieveTimeoutMs, datasetIds)
}
