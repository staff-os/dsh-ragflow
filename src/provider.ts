/**
 * RAGFlow HTTP API provider: calls `POST /api/v1/retrieval` and maps the
 * response to normalized {@link RagflowChunk} objects.
 * @module @deepseek-ai/dsh-ragflow/provider
 */

import { RagflowError } from './types.ts'
import type {
  RagflowRetrieveProvider,
  RagflowRetrieveRequest,
  RagflowRetrieveResult,
  RagflowChunk,
} from './types.ts'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Stable id this provider registers under. */
export const RAGFLOW_PROVIDER_ID = 'ragflow'

/** Default RAGFlow API endpoint base. */
export const RAGFLOW_DEFAULT_BASE_URL = 'http://localhost:9380'

/** Default number of chunks to retrieve per request. */
export const RAGFLOW_DEFAULT_TOP_K = 10

/** Default similarity threshold; chunks below this score are filtered. */
export const RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD = 0.2

/** Attribution header sent on every request. */
const USER_AGENT = 'dsh-ragflow/0.1.0'

/** Resolved provider options. */
export interface RagflowProviderOptions {
  /** Literal RAGFlow API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current RAGFlow API key for one retrieval operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/api/v1/retrieval` is appended. */
  baseURL: string
  /** Default dataset ids to search when a request carries none. */
  datasetIds?: readonly string[]
  /** Default chunk count when a request carries no `topK`. */
  topK?: number
  /** Similarity threshold; chunks below this score are filtered. */
  similarityThreshold: number
}

/** One chunk item inside a RAGFlow retrieval response. */
interface RagflowApiChunk {
  content?: string | null
  dataset_id?: string | null
  document_id?: string | null
  document_name?: string | null
  similarity?: number | null
  document_metadata?: Record<string, string> | null
}

/** RAGFlow retrieval response envelope. */
interface RagflowRetrieveResponse {
  chunks?: Record<string, RagflowApiChunk>
}

/** RAGFlow error response envelope. */
interface RagflowApiError {
  code?: number
  message?: string
}

/**
 * Map one RAGFlow API chunk to a normalized chunk, or `undefined` when it
 * carries no content.
 */
export function mapRagflowChunk(chunk: RagflowApiChunk): RagflowChunk | undefined {
  const content = chunk.content?.trim()
  if (content === undefined || content.length === 0) return undefined
  return {
    content,
    datasetId: chunk.dataset_id ?? '',
    documentId: chunk.document_id ?? '',
    ...chunk.document_name != null && chunk.document_name.length > 0 ? { documentName: chunk.document_name } : {},
    ...chunk.similarity != null ? { similarity: chunk.similarity } : {},
    ...chunk.document_metadata != null && Object.keys(chunk.document_metadata).length > 0 ? { documentMetadata: chunk.document_metadata } : {},
  }
}

/**
 * Map a RAGFlow retrieval response to a normalized retrieval result.
 */
export function mapRagflowResponse(response: RagflowRetrieveResponse, similarityThreshold: number): RagflowRetrieveResult {
  const rawChunks = response.chunks
  if (rawChunks === undefined || Object.keys(rawChunks).length === 0) {
    throw new RagflowError(
      'RAGFlow returned no chunks; the retrieval may not have matched any documents',
      'RAGFLOW_PROVIDER_ERROR',
    )
  }

  const chunks: RagflowChunk[] = []
  for (const key of Object.keys(rawChunks)) {
    const raw = rawChunks[key]
    if (raw === undefined) continue
    const mapped = mapRagflowChunk(raw)
    if (mapped === undefined) continue
    if (mapped.similarity !== undefined && mapped.similarity < similarityThreshold) continue
    chunks.push(mapped)
  }

  return { chunks, truncated: false }
}

/** The RAGFlow-backed retrieval provider. */
export class RagflowProvider implements RagflowRetrieveProvider {
  readonly id = RAGFLOW_PROVIDER_ID

  constructor(private readonly resolveOptions: () => RagflowProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.similarityThreshold >= 0
  }

  async retrieve(request: RagflowRetrieveRequest, signal?: AbortSignal): Promise<RagflowRetrieveResult> {
    const options = this.resolveOptions()
    const apiKey = await this.resolveApiKey(options, signal)
    throwIfAborted(signal)
    const endpoint = `${options.baseURL}/api/v1/retrieval`
    const datasetIds = request.datasetIds ?? options.datasetIds
    const topK = request.topK ?? options.topK
    const body: Record<string, unknown> = {
      question: request.question,
      ...datasetIds !== undefined && datasetIds.length > 0 ? { dataset_ids: datasetIds } : {},
      ...topK !== undefined ? { top_k: topK } : {},
      similarity_threshold: options.similarityThreshold,
    }
    throwIfAborted(signal)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error)
      throw new RagflowError(`RAGFlow retrieval request failed: ${String(error)}`, 'RAGFLOW_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `RAGFlow API error (HTTP ${status})`
      try {
        const parsed = await response.json() as RagflowApiError
        const detail = parsed.message ?? (typeof parsed.code === 'number' ? `code ${parsed.code}` : undefined)
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error)
      }
      throw new RagflowError(message, 'RAGFLOW_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as RagflowRetrieveResponse
      return mapRagflowResponse(payload, options.similarityThreshold)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error)
      if (error instanceof RagflowError) throw error
      throw new RagflowError(`RAGFlow returned an unprocessable response body: ${String(error)}`, 'RAGFLOW_PROVIDER_ERROR', { cause: error })
    }
  }

  private async resolveApiKey(options: RagflowProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error)
      throw new RagflowError(
        `RAGFlow credential resolution failed: ${String(error)}`,
        'RAGFLOW_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'RAGFLOW_API_KEY'
    throw new RagflowError(
      `RAGFlow retrieval has no API key for "${ref}"; store it through the credentials service`
      + ', export it in the launching environment, or set a literal "apiKey" in the config',
      'RAGFLOW_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(retrieveAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(retrieveAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error })) },
    )
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw retrieveAborted(signal)
}

function retrieveAborted(signal?: AbortSignal, fallback?: unknown): RagflowError {
  return new RagflowError('RAGFlow retrieval aborted', 'RAGFLOW_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
