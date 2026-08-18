/**
 * `RagflowHttpProvider`: a {@link RagflowRetrieveProvider} backed by the RAGFlow
 * HTTP API (`POST /api/v1/retrieval`).
 *
 * Two RAGFlow contract details this module owns:
 * - RAGFlow answers with HTTP 200 and an envelope `{ code, message, data }`; a
 *   non-zero `code` is the error channel, so status alone never decides.
 * - `top_k` sizes the vector-similarity candidate pool (RAGFlow default 1024),
 *   while `page_size` (default 30) caps the returned chunks. The seam's
 *   `maxChunks` therefore maps to `page_size`, not to `top_k`.
 *
 * @module @deepseek-ai/dsh-ragflow/provider
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { RagflowError } from './types.ts'
import type {
  RagflowChunk,
  RagflowRetrieveProvider,
  RagflowRetrieveRequest,
  RagflowRetrieveResult,
} from './types.ts'

/** Stable id this provider registers under. */
export const RAGFLOW_PROVIDER_ID = 'ragflow-http'

/** Default RAGFlow API endpoint base for a local deployment. */
export const RAGFLOW_DEFAULT_BASE_URL = 'http://localhost:9380'

/** Default similarity threshold; RAGFlow's own default for `/api/v1/retrieval`. */
export const RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD = 0.2

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-ragflow/0.2.0'

/** The retrieval operation appended to the configured base URL. */
const RETRIEVAL_PATH = '/api/v1/retrieval'

/** Resolved provider options (the plugin's `apply` supplies every default). */
export interface RagflowHttpProviderOptions {
  /** Literal RAGFlow API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current RAGFlow API key for one retrieval operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/api/v1/retrieval` is appended. */
  baseURL: string
  /** Dataset ids searched when a request carries no scope of its own. */
  datasetIds?: readonly string[]
  /** Document ids searched when a request carries no scope of its own. */
  documentIds?: readonly string[]
  /** Chunks below this combined similarity are dropped by RAGFlow. */
  similarityThreshold: number
  /** RAGFlow's `top_k`: the vector-similarity candidate pool size. */
  vectorTopK?: number
  /** RAGFlow's `vector_similarity_weight` in [0, 1]. */
  vectorSimilarityWeight?: number
  /** Request RAGFlow's keyword-matching pass alongside vector search. */
  keyword?: boolean
  /** Rerank model id applied to the candidate pool. */
  rerankId?: string
}

/** One chunk item inside a RAGFlow retrieval response. */
export interface RagflowApiChunk {
  content?: string | null
  content_with_weight?: string | null
  id?: string | null
  chunk_id?: string | null
  dataset_id?: string | null
  kb_id?: string | null
  document_id?: string | null
  doc_id?: string | null
  document_keyword?: string | null
  document_name?: string | null
  docnm_kwd?: string | null
  similarity?: number | null
}

/** RAGFlow's uniform response envelope; `code === 0` means success. */
export interface RagflowApiEnvelope {
  code?: number
  message?: string
  data?: { chunks?: RagflowApiChunk[] | null; total?: number | null } | null
}

/** First non-blank string among the candidates, else `undefined`. */
function firstNonBlank(...candidates: (string | null | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return undefined
}

/**
 * Map one RAGFlow API chunk to a normalized chunk, or `undefined` when it
 * carries no content (an empty chunk has nothing citable, and inventing text
 * would make the seam lie).
 *
 * Field names differ across RAGFlow versions and surfaces — `content_with_weight`,
 * `kb_id`, `doc_id`, and `docnm_kwd` are the legacy spellings of `content`,
 * `dataset_id`, `document_id`, and `document_keyword`, and the Python SDK
 * normalizes the last one to `document_name` — so every spelling is accepted.
 *
 * @param chunk - one entry of the response's `data.chunks[]`.
 * @returns the normalized chunk, or `undefined` when it has no content.
 */
export function mapRagflowChunk(chunk: RagflowApiChunk): RagflowChunk | undefined {
  const content = firstNonBlank(chunk.content, chunk.content_with_weight)?.trim()
  if (content === undefined) return undefined
  const chunkId = firstNonBlank(chunk.id, chunk.chunk_id)
  const documentName = firstNonBlank(chunk.document_keyword, chunk.document_name, chunk.docnm_kwd)
  return {
    content,
    datasetId: firstNonBlank(chunk.dataset_id, chunk.kb_id) ?? '',
    documentId: firstNonBlank(chunk.document_id, chunk.doc_id) ?? '',
    ...chunkId !== undefined ? { chunkId } : {},
    ...documentName !== undefined ? { documentName } : {},
    ...typeof chunk.similarity === 'number' ? { similarity: chunk.similarity } : {},
  }
}

/**
 * Map a RAGFlow response envelope to a normalized retrieval result.
 *
 * A zero-chunk response is a legitimate outcome ("nothing in the knowledge base
 * matched"), not an error: the consumer renders it as such.
 *
 * @param envelope - the parsed `POST /api/v1/retrieval` response body.
 * @returns the normalized result; content-less entries are dropped.
 * @throws {RagflowError} `RAGFLOW_PROVIDER_ERROR` when `code` is non-zero.
 */
export function mapRagflowResponse(envelope: RagflowApiEnvelope): RagflowRetrieveResult {
  if (envelope.code !== undefined && envelope.code !== 0) {
    const detail = firstNonBlank(envelope.message) ?? `code ${envelope.code}`
    throw new RagflowError(`RAGFlow retrieval failed: ${detail}`, 'RAGFLOW_PROVIDER_ERROR')
  }
  const chunks = (envelope.data?.chunks ?? [])
    .map(mapRagflowChunk)
    .filter((chunk): chunk is RagflowChunk => chunk !== undefined)
  // The seam owns the final `maxChunks` truncation, so this provider reports
  // `truncated: false` even when it asked RAGFlow to page.
  return { chunks, truncated: false }
}

/**
 * Build the `POST /api/v1/retrieval` request body from a seam request and the
 * provider's configured defaults. A request's own scope wins over the
 * configured scope as a whole, so a caller narrowing to one dataset does not
 * silently inherit configured document ids.
 *
 * @param request - the seam-level retrieval request.
 * @param options - the resolved provider options.
 * @returns the RAGFlow request body.
 * @throws {RagflowError} `RAGFLOW_SCOPE_MISSING` when neither dataset nor
 *   document ids are known — RAGFlow requires at least one.
 */
export function buildRetrievalBody(
  request: RagflowRetrieveRequest,
  options: RagflowHttpProviderOptions,
): Record<string, unknown> {
  const requestScoped = (request.datasetIds?.length ?? 0) > 0 || (request.documentIds?.length ?? 0) > 0
  const datasetIds = requestScoped ? request.datasetIds ?? [] : options.datasetIds ?? []
  const documentIds = requestScoped ? request.documentIds ?? [] : options.documentIds ?? []
  if (datasetIds.length === 0 && documentIds.length === 0) {
    throw new RagflowError(
      'RAGFlow retrieval needs at least one dataset id or document id; set "datasetIds" in the'
      + ' provider config or export $RAGFLOW_DATASET_IDS',
      'RAGFLOW_SCOPE_MISSING',
    )
  }
  return {
    question: request.question,
    ...datasetIds.length > 0 ? { dataset_ids: [...datasetIds] } : {},
    ...documentIds.length > 0 ? { document_ids: [...documentIds] } : {},
    similarity_threshold: options.similarityThreshold,
    // `page_size` — not `top_k` — is what bounds the returned chunk count.
    ...request.maxChunks !== undefined ? { page: 1, page_size: request.maxChunks } : {},
    ...options.vectorTopK !== undefined ? { top_k: options.vectorTopK } : {},
    ...options.vectorSimilarityWeight !== undefined ? { vector_similarity_weight: options.vectorSimilarityWeight } : {},
    ...options.keyword !== undefined ? { keyword: options.keyword } : {},
    ...options.rerankId !== undefined && options.rerankId.length > 0 ? { rerank_id: options.rerankId } : {},
  }
}

/** The RAGFlow-HTTP-backed retrieval provider; HTTP redirects fail as `RAGFLOW_PROVIDER_ERROR`. */
export class RagflowHttpProvider implements RagflowRetrieveProvider {
  readonly id = RAGFLOW_PROVIDER_ID

  constructor(private readonly resolveOptions: () => RagflowHttpProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.similarityThreshold >= 0 && options.similarityThreshold <= 1
      && (options.vectorTopK === undefined || isPositiveInteger(options.vectorTopK))
  }

  async retrieve(request: RagflowRetrieveRequest, signal?: AbortSignal): Promise<RagflowRetrieveResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const body = buildRetrievalBody(request, options)
    const apiKey = await this.resolveApiKey(options, signal)
    throwIfAborted(signal)

    let response: Response
    try {
      response = await fetch(`${options.baseURL}${RETRIEVAL_PATH}`, {
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
      if (isAborted(signal, error)) throw retrieveAborted(signal, error)
      throw new RagflowError(`RAGFlow retrieval request failed: ${String(error)}`, 'RAGFLOW_PROVIDER_ERROR', { cause: error })
    }

    let envelope: RagflowApiEnvelope
    try {
      envelope = await response.json() as RagflowApiEnvelope
    } catch (error: unknown) {
      // An abort fired mid-body must surface as RAGFLOW_ABORTED, not be
      // swallowed into a generic parse error — cancellation is not a provider
      // error (the seam's cancellation contract).
      if (isAborted(signal, error)) throw retrieveAborted(signal, error)
      if (!response.ok) {
        // A malformed or non-JSON error body is normal for gateway 5xx/429s;
        // the status is the only fact available, and it is enough.
        throw new RagflowError(`RAGFlow API error (HTTP ${response.status})`, httpErrorCode(response.status), { cause: error })
      }
      throw new RagflowError(`RAGFlow returned an unprocessable response body: ${String(error)}`, 'RAGFLOW_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const detail = firstNonBlank(envelope.message)
      throw new RagflowError(detail ?? `RAGFlow API error (HTTP ${response.status})`, httpErrorCode(response.status))
    }
    // RAGFlow reports application errors as HTTP 200 with a non-zero `code`.
    return mapRagflowResponse(envelope)
  }

  private async resolveApiKey(options: RagflowHttpProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.()
    } catch (error: unknown) {
      if (isAborted(signal, error)) throw retrieveAborted(signal, error)
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

/** An authentication failure is worth its own code; everything else is generic. */
function httpErrorCode(status: number): string {
  return status === 401 || status === 403 ? 'RAGFLOW_PROVIDER_UNAUTHORIZED' : 'RAGFLOW_PROVIDER_ERROR'
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw retrieveAborted(signal)
}

function isAborted(signal: AbortSignal | undefined, error: unknown): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')
}

function retrieveAborted(signal?: AbortSignal, fallback?: unknown): RagflowError {
  return new RagflowError('RAGFlow retrieval aborted', 'RAGFLOW_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}
