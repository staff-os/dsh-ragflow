/**
 * Service Definition for the RAGFlow knowledge-base retrieval capability seam
 * (`ctx.ragflow`): provider registry and provider-selecting execution for
 * retrieval.
 * @module @deepseek-ai/dsh-ragflow/runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  RagflowRetrieveProvider,
  RagflowRetrieveRequest,
  RagflowRetrieveResult,
} from './types.ts'
import { RagflowError } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    ragflow: RagflowRuntime
  }
}

/**
 * Config for the RAGFlow seam.
 */
export interface RagflowRuntimeConfig {
  /** Explicit retrieval provider id. Omitted = auto-select when exactly one usable. */
  readonly retrieveProvider?: string
}

/**
 * The RAGFlow knowledge-base retrieval service. Registered as `ctx.ragflow`.
 */
export class RagflowRuntime extends Service {
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
   * Register a retrieval provider. Returns a disposer.
   */
  registerRetrieveProvider(provider: RagflowRetrieveProvider): () => void {
    return this.registerProvider(this.retrieveProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new RagflowError(`a ragflow provider with id "${provider.id}" is already registered`, 'RAGFLOW_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'ragflow.registerProvider()')
    return () => void dispose()
  }

  /**
   * Run one retrieval through the selected provider.
   */
  async retrieve(request: RagflowRetrieveRequest, signal?: AbortSignal): Promise<RagflowRetrieveResult> {
    const provider = resolveProvider({
      providers: this.retrieveProviders,
      ...this.retrieveProviderId !== undefined ? { configuredId: this.retrieveProviderId } : {},
    })
    const result = await provider.retrieve(request, signal)
    return capChunks(result, request.topK)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

interface Selection<P> {
  readonly configuredId?: string
  readonly providers: ReadonlyMap<string, P>
}

function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) throw new RagflowError(`configured ragflow provider "${configuredId}" is not registered`, 'RAGFLOW_PROVIDER_CONFIGURED_MISSING')
    if (!provider.available()) throw new RagflowError(`configured ragflow provider "${configuredId}" is registered but unavailable`, 'RAGFLOW_PROVIDER_CONFIGURED_UNAVAILABLE')
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) throw new RagflowError('no usable ragflow provider is registered', 'RAGFLOW_PROVIDER_UNAVAILABLE')
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new RagflowError(`multiple usable ragflow providers are registered (${ids}); configure one explicitly`, 'RAGFLOW_PROVIDER_AMBIGUOUS')
  }
  return single
}

function capChunks(result: RagflowRetrieveResult, topK: number | undefined): RagflowRetrieveResult {
  if (topK === undefined || result.chunks.length <= topK) return result
  return { ...result, chunks: result.chunks.slice(0, topK), truncated: true }
}
