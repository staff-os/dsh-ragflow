/**
 * Vocabulary for the RAGFlow knowledge-base retrieval capability.
 * @module @deepseek-ai/dsh-ragflow/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * What one retrieval-capable backend is asked to do.
 */
export interface RagflowRetrieveRequest {
  /** The natural-language question to retrieve relevant knowledge for. */
  readonly question: string
  /**
   * RAGFlow dataset ids to search. When omitted, the provider searches all
   * datasets the API key authorizes.
   */
  readonly datasetIds?: readonly string[]
  /**
   * Upper bound on returned chunks; the seam truncates to it. Omitted = no
   * bound beyond the provider's own default.
   */
  readonly topK?: number
}

/**
 * One retrieveable knowledge chunk from a RAGFlow dataset.
 */
export interface RagflowChunk {
  /** The chunk text. */
  readonly content: string
  /** The dataset id this chunk belongs to. */
  readonly datasetId: string
  /** The document id this chunk originates from. */
  readonly documentId: string
  /** The document name (filename) of this chunk's source. */
  readonly documentName?: string
  /** Provider-reported similarity score, typically 0–1. */
  readonly similarity?: number
  /** Optional document metadata key-value pairs. */
  readonly documentMetadata?: Record<string, string>
}

/**
 * Normalized retrieval outcome.
 */
export interface RagflowRetrieveResult {
  /** Relevant knowledge chunks, already truncated to the request's `topK`. */
  readonly chunks: readonly RagflowChunk[]
  /** True when the seam dropped chunks to honor `topK`. */
  readonly truncated: boolean
}

/**
 * A retrieval-capable backend.
 */
export interface RagflowRetrieveProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Retrieve relevant chunks; honor `signal` for cancellation. */
  retrieve(request: RagflowRetrieveRequest, signal?: AbortSignal): Promise<RagflowRetrieveResult>
}

/**
 * Typed RAGFlow error with a machine-routable `code` and chained `cause`.
 */
export class RagflowError extends HarnessError {}
