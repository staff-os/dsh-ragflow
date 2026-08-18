/**
 * `@deepseek-ai/dsh-ragflow/http`: registers a RAGFlow-HTTP-backed
 * {@link RagflowRetrieveProvider} with `ctx.ragflow`. A function/namespace
 * plugin (NOT a default-export service): a retrieval provider does not own the
 * `ctx.ragflow` key — it registers INTO the seam's provider registry. The key
 * is owned by `@deepseek-ai/dsh-ragflow`.
 *
 * Every option this plugin resolves — endpoint, scope, credential reference —
 * may also come from the launch environment, so a deployment can be configured
 * without editing any YAML.
 *
 * @module @deepseek-ai/dsh-ragflow/http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type {} from './index.ts'
import { RAGFLOW_HTTP_SETTINGS_NAMESPACE } from './settings.ts'
import {
  RAGFLOW_DEFAULT_BASE_URL,
  RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD,
  RagflowHttpProvider,
} from './provider.ts'
import type { RagflowHttpProviderOptions } from './provider.ts'

export { RAGFLOW_HTTP_SETTINGS_NAMESPACE } from './settings.ts'
export {
  buildRetrievalBody,
  mapRagflowChunk,
  mapRagflowResponse,
  RAGFLOW_DEFAULT_BASE_URL,
  RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD,
  RAGFLOW_PROVIDER_ID,
  RagflowHttpProvider,
} from './provider.ts'
export type { RagflowApiChunk, RagflowApiEnvelope, RagflowHttpProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ragflow-http'

/** The RAGFlow seam this provider registers into. */
export const inject = ['ragflow']

/** Credential reference resolved when no literal `apiKey` is configured. */
export const DEFAULT_API_KEY_ENV = 'RAGFLOW_API_KEY'

/** Launch-environment variable naming the endpoint base. */
export const BASE_URL_ENV = 'RAGFLOW_BASE_URL'

/** Launch-environment variable naming the default datasets (comma-separated). */
export const DATASET_IDS_ENV = 'RAGFLOW_DATASET_IDS'

/** Plugin config. Every field is optional — `apply` fills env-var and constant defaults. */
export interface Config {
  /** Literal RAGFlow API key; prefer {@link apiKeyEnv} so no secret enters a config file. */
  apiKey?: string
  /** Credential reference resolved per retrieval. Defaults to `RAGFLOW_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/api/v1/retrieval` is appended. Falls back to `$RAGFLOW_BASE_URL`. */
  baseURL?: string
  /** Datasets searched by default. Falls back to `$RAGFLOW_DATASET_IDS` (comma-separated). */
  datasetIds?: string[]
  /** Documents searched by default; narrows the search further than `datasetIds`. */
  documentIds?: string[]
  /** Chunks below this combined similarity are dropped. Defaults to 0.2. */
  similarityThreshold?: number
  /** RAGFlow's `top_k`: vector-similarity candidate pool size. Omitted = RAGFlow's own default. */
  vectorTopK?: number
  /** RAGFlow's `vector_similarity_weight` in [0, 1]. Omitted = RAGFlow's own default. */
  vectorSimilarityWeight?: number
  /** Run RAGFlow's keyword-matching pass alongside vector search. */
  keyword?: boolean
  /** Rerank model id applied to the candidate pool. */
  rerankId?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  datasetIds: z.array(z.string()),
  documentIds: z.array(z.string()),
  similarityThreshold: z.number().min(0).max(1).default(RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD),
  vectorTopK: z.number().step(1).min(1),
  vectorSimilarityWeight: z.number().min(0).max(1),
  keyword: z.boolean(),
  rerankId: z.string(),
})

/** Split a comma-separated environment value into non-blank ids. */
export function parseIdList(raw: string | undefined): string[] {
  if (raw === undefined) return []
  return raw.split(',').map(id => id.trim()).filter(id => id.length > 0)
}

/**
 * Resolve provider options from config and the launch environment. Called per
 * retrieval so a credential or environment change takes effect without a
 * reload; the provider snapshots it once per operation.
 *
 * @param ctx - the plugin context (owns the credentials seam and launch env).
 * @param config - the schema-validated plugin config.
 * @returns the fully resolved provider options.
 */
export function resolveProviderOptions(ctx: Context, config: Config): RagflowHttpProviderOptions {
  const env = launchEnvironmentOf(ctx)
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const datasetIds = config.datasetIds !== undefined && config.datasetIds.length > 0
    ? config.datasetIds
    : parseIdList(env.get(DATASET_IDS_ENV)?.value)
  return {
    ...config.apiKey !== undefined && config.apiKey.length > 0 ? { apiKey: config.apiKey } : {},
    resolveApiKey: async () => {
      // The managed store wins when mounted; otherwise the product trusts the
      // environment it was launched in.
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = env.get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? env.get(BASE_URL_ENV)?.value ?? RAGFLOW_DEFAULT_BASE_URL,
    ...datasetIds.length > 0 ? { datasetIds } : {},
    ...config.documentIds !== undefined && config.documentIds.length > 0 ? { documentIds: config.documentIds } : {},
    similarityThreshold: config.similarityThreshold ?? RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD,
    ...config.vectorTopK !== undefined ? { vectorTopK: config.vectorTopK } : {},
    ...config.vectorSimilarityWeight !== undefined ? { vectorSimilarityWeight: config.vectorSimilarityWeight } : {},
    ...config.keyword !== undefined ? { keyword: config.keyword } : {},
    ...config.rerankId !== undefined && config.rerankId.length > 0 ? { rerankId: config.rerankId } : {},
  }
}

/**
 * Register the RAGFlow HTTP retrieval provider with `ctx.ragflow`. The
 * registration is an effect owned by this plugin's fiber, so an HMR reload or
 * an uninstall unregisters it without manual teardown.
 *
 * The authoritative config is a thunk, not the entry object: while a settings
 * provider is mounted, `installSettingsSection` points it at the resolved
 * `ragflow-http` section, so a value saved in the configuration page reaches
 * the NEXT retrieval without a reload. Options are resolved per operation
 * already, so nothing here needs to react to a change.
 */
export function apply(ctx: Context, config: Config): void {
  let current = () => config
  installSettingsSection(ctx, RAGFLOW_HTTP_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  ctx.ragflow.registerRetrieveProvider(new RagflowHttpProvider(() => resolveProviderOptions(ctx, current())))
}
