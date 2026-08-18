/**
 * Vocabulary for the RAGFlow knowledge-base retrieval capability seam
 * (`ctx.ragflow`): the request and result shapes, the provider contract, and
 * the error taxonomy. Providers and consumers depend only on this module, never
 * on each other.
 * @module @deepseek-ai/dsh-ragflow/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * What one retrieval-capable backend is asked to do. The model-facing argument
 * is just a question; scope (`datasetIds` / `documentIds`) and the result bound
 * (`maxChunks`) are product-layer inputs passed through unchanged and enforced
 * on the way back by the seam (see {@link RagflowRetrieveResult}).
 */
export interface RagflowRetrieveRequest {
  /** The natural-language question to retrieve relevant knowledge for. */
  readonly question: string
  /**
   * Knowledge-base ids to search. RAGFlow requires at least one of
   * `datasetIds` / `documentIds`; a provider with neither configured nor
   * requested fails with `RAGFLOW_SCOPE_MISSING`.
   */
  readonly datasetIds?: readonly string[]
  /** Document ids to restrict the search to. */
  readonly documentIds?: readonly string[]
  /**
   * Upper bound on returned chunks; the seam truncates to it. Omitted = no
   * bound beyond the provider's own default. A provider whose API supports a
   * result-count control should apply it at the request layer as a
   * cost/latency optimization; the seam enforces the bound regardless.
   */
  readonly maxChunks?: number
}

/**
 * One retrievable knowledge chunk. `documentName`, `chunkId`, and `similarity`
 * are optional because not every backend or RAGFlow version returns them —
 * forcing adapters to invent them would make the seam lie.
 */
export interface RagflowChunk {
  /** The chunk text. */
  readonly content: string
  /** The dataset (knowledge base) id this chunk belongs to. */
  readonly datasetId: string
  /** The document id this chunk originates from. */
  readonly documentId: string
  /** RAGFlow's own chunk id, when reported. */
  readonly chunkId?: string
  /** The source document's display name (filename), when reported. */
  readonly documentName?: string
  /** Provider-reported combined similarity score, typically 0–1. */
  readonly similarity?: number
}

/**
 * Normalized retrieval outcome. An empty `chunks[]` is a valid result, not an
 * error: "the knowledge base has nothing relevant" is an answer the model must
 * be able to act on.
 */
export interface RagflowRetrieveResult {
  /** Relevant chunks, already truncated to the request's `maxChunks`. */
  readonly chunks: readonly RagflowChunk[]
  /** True when the seam dropped chunks to honor `maxChunks`. */
  readonly truncated: boolean
}

/**
 * A retrieval-capable backend. Registered with
 * `ctx.ragflow.registerRetrieveProvider`. `id` is a stable string, unique
 * within the retrieval capability kind.
 */
export interface RagflowRetrieveProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Retrieve relevant chunks; honor `signal` for cancellation. */
  retrieve(request: RagflowRetrieveRequest, signal?: AbortSignal): Promise<RagflowRetrieveResult>
}

/**
 * Typed RAGFlow error with a machine-routable, open-string `code` and chained
 * `cause`. Shared codes cover unavailable, missing, unusable, ambiguous, or
 * duplicate providers, cancellation, missing credentials, missing search scope,
 * and provider failure. Tool execution exposes the code in structured error
 * metadata.
 */
export class RagflowError extends HarnessError {}
