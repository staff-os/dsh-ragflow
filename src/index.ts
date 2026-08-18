/**
 * Service Definition for the RAGFlow knowledge-base retrieval capability seam
 * (`ctx.ragflow`): the provider registry and provider-selecting execution for
 * retrieval. Duplicate ids are rejected. At execution time a configured
 * provider must exist and be usable; without one, exactly one usable provider
 * is required, so selection never depends on registration order.
 *
 * This module owns the `ctx.ragflow` key and nothing else — no HTTP, no tool.
 * The provider lives in `@deepseek-ai/dsh-ragflow/http`, the model-facing tool
 * in `@deepseek-ai/dsh-ragflow/tool`.
 *
 * @module @deepseek-ai/dsh-ragflow
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  RagflowRetrieveProvider,
  RagflowRetrieveRequest,
  RagflowRetrieveResult,
} from './types.ts'
import { RagflowError } from './types.ts'

export { RagflowError } from './types.ts'
export type {
  RagflowChunk,
  RagflowRetrieveProvider,
  RagflowRetrieveRequest,
  RagflowRetrieveResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    ragflow: RagflowRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Config for the RAGFlow seam. `retrieveProvider` pins which provider wins; it
 * is optional (a single registered usable provider auto-selects). Operational
 * overrides such as environment variables must feed this same field rather than
 * introduce a hidden priority chain.
 */
export interface RagflowRuntimeConfig {
  /** Explicit retrieval provider id. Omitted = auto-select when exactly one usable. */
  readonly retrieveProvider?: string
}

/**
 * The RAGFlow knowledge-base retrieval service. Registered as `ctx.ragflow`
 * (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `RAGFLOW_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `RAGFLOW_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `RAGFLOW_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `RAGFLOW_PROVIDER_UNAVAILABLE`.
 */
export class RagflowRuntime extends Service {
  /**
   * Provider selection config. The operational env override feeds the SAME
   * field: `$DSH_RAGFLOW_PROVIDER` is equivalent to `retrieveProvider` and is
   * NOT a hidden priority chain.
   */
  static Config: z<RagflowRuntimeConfig> = z.object({
    retrieveProvider: z.string(),
  })

  private retrieveProviders = new Map<string, RagflowRetrieveProvider>()
  private readonly retrieveProviderId: string | undefined

  constructor(ctx: Context, config: RagflowRuntimeConfig = {}) {
    super(ctx, 'ragflow')
    this.retrieveProviderId = config.retrieveProvider ?? process.env.DSH_RAGFLOW_PROVIDER
  }

  /**
   * Register a retrieval provider. Throws {@link RagflowError}
   * `RAGFLOW_DUPLICATE_PROVIDER` if its id is already registered. Returns a
   * disposer; disposed with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerRetrieveProvider(provider: RagflowRetrieveProvider): () => void {
    if (this.retrieveProviders.has(provider.id)) {
      throw new RagflowError(`a ragflow provider with id "${provider.id}" is already registered`, 'RAGFLOW_DUPLICATE_PROVIDER')
    }
    const store = this.retrieveProviders
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'ragflow.registerRetrieveProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one retrieval through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link RagflowError} when
   * the capability cannot run. The seam enforces `request.maxChunks` on the
   * result: if the provider over-returns, `chunks[]` is truncated and
   * `truncated` set. An empty result is not an error.
   * @param request - the question, optional scope, and optional result bound.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's chunks, capped to `request.maxChunks`.
   */
  async retrieve(request: RagflowRetrieveRequest, signal?: AbortSignal): Promise<RagflowRetrieveResult> {
    const provider = resolveProvider({
      providers: this.retrieveProviders,
      ...this.retrieveProviderId !== undefined ? { configuredId: this.retrieveProviderId } : {},
    })
    const result = await provider.retrieve(request, signal)
    return capChunks(result, request.maxChunks)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/** Resolve the selected provider or throw the matching {@link RagflowError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new RagflowError(`configured ragflow provider "${configuredId}" is not registered`, 'RAGFLOW_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new RagflowError(`configured ragflow provider "${configuredId}" is registered but unavailable`, 'RAGFLOW_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new RagflowError('no usable ragflow provider is registered', 'RAGFLOW_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new RagflowError(`multiple usable ragflow providers are registered (${ids}); configure one explicitly`, 'RAGFLOW_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Enforce `maxChunks` on a retrieval result: truncate `chunks[]` and flag it. */
export function capChunks(result: RagflowRetrieveResult, maxChunks: number | undefined): RagflowRetrieveResult {
  if (maxChunks === undefined || result.chunks.length <= maxChunks) return result
  return { ...result, chunks: result.chunks.slice(0, maxChunks), truncated: true }
}

export default RagflowRuntime
