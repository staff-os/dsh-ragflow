/**
 * `@deepseek-ai/dsh-ragflow/tool`: the model-facing `ragflow_retrieve` tool over
 * `ctx.ragflow`. This module owns the schema, argument validation, the
 * chunk-count bound, prompt guidance, and presentation — never provider
 * selection or network access. Execution goes through the seam.
 *
 * The tool stays registered when no provider is usable: an enabled tool that
 * fails with a structured error at execution time is more debuggable than a
 * tool that silently disappears from the model's list.
 *
 * @module @deepseek-ai/dsh-ragflow/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { RagflowChunk, RagflowRetrieveResult } from './types.ts'
import type {} from './index.ts'

/**
 * Default upper bound on returned chunks. Owned by the consumer, not the
 * provider or the model: the model just asks a question; the product controls
 * how much context comes back.
 */
export const RAGFLOW_MAX_CHUNKS = 8

/** Default cooperative tool-call timeout budget (ms). */
export const DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS = 30_000

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-ragflow'

/** Services required by the RAGFlow tool. */
export const inject = ['tools', 'ragflow', 'systemPrompt']

/** Plugin config: the chunk bound and the per-call timeout budget. */
export interface Config {
  /** Upper bound on chunks returned by one call. Defaults to 8. */
  maxChunks?: number
  /** Cooperative timeout budget (ms) for one call. Defaults to 30000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxChunks: z.number().step(1).min(1).default(RAGFLOW_MAX_CHUNKS),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `question`. Throws a plain `Error` otherwise.
 *
 * @param args - the schema-validated `ragflow_retrieve` arguments.
 * @returns the accepted arguments, passed through unchanged.
 */
export function parseRetrieveArgs(args: { question: string }): { question: string } {
  if (args.question.trim().length === 0) throw new Error('question must be a non-empty string')
  return { question: args.question }
}

/**
 * Format a retrieval result as one model-facing text block.
 *
 * @param result - the seam's retrieval outcome.
 * @returns the numbered chunks with their source and similarity metadata (or a
 *   no-results line), a refine-the-question note when truncated, and a standing
 *   cite-your-sources instruction.
 */
export function formatRetrieveOutput(result: RagflowRetrieveResult): string {
  const parts: string[] = []
  if (result.chunks.length > 0) {
    const blocks = result.chunks.map((chunk, index) => {
      const label = chunkLabel(chunk)
      const suffix = chunk.similarity !== undefined ? ` — similarity ${chunk.similarity.toFixed(4)}` : ''
      return `### ${index + 1}. ${label}${suffix}\n\n${chunk.content}`
    })
    parts.push(`Retrieved chunks:\n\n${blocks.join('\n\n---\n\n')}`)
  } else {
    parts.push('No relevant chunks found. The knowledge base has nothing matching this question;'
      + ' answer from other sources or say so, and do not invent a citation.')
  }

  if (result.truncated) parts.push(`(Showing the first ${result.chunks.length} chunks. Refine the question for more.)`)
  if (result.chunks.length > 0) parts.push('Cite the document names above in your answer.')
  return parts.join('\n\n')
}

/** Display label for a chunk: its document name, else its document id. */
function chunkLabel(chunk: RagflowChunk): string {
  if (chunk.documentName !== undefined && chunk.documentName.length > 0) return chunk.documentName
  return chunk.documentId.length > 0 ? chunk.documentId : 'unknown document'
}

/**
 * Pending-call presentation: a search card titled by the question.
 *
 * @param args - the raw tool arguments; only `question` feeds the view.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export function presentRetrieveCall(args: { question: string }): GenericCallView {
  return { card: 'generic', title: args.question, kind: 'search', rawInput: args.question }
}

/**
 * Project one seam chunk into a plain object that omits every absent optional
 * field. Shared by the canonical `execute` result and its replayable
 * presentation meta so both carry byte-identical chunk shapes.
 */
function projectChunk(chunk: RagflowChunk): {
  content: string
  datasetId: string
  documentId: string
  chunkId?: string
  documentName?: string
  similarity?: number
} {
  return {
    content: chunk.content,
    datasetId: chunk.datasetId,
    documentId: chunk.documentId,
    ...chunk.chunkId !== undefined ? { chunkId: chunk.chunkId } : {},
    ...chunk.documentName !== undefined ? { documentName: chunk.documentName } : {},
    ...chunk.similarity !== undefined ? { similarity: chunk.similarity } : {},
  }
}

/**
 * Project a validated output value into its replayable presentation meta. The
 * render text is lossy, so this projection is the only faithful route to the
 * per-chunk fields a replayed session card needs.
 *
 * @param value - the canonical `ragflow_retrieve` output value.
 * @returns the structured chunks and the truncation flag as opaque JSON.
 */
export function retrieveMetaFromValue(value: RagflowRetrieveResult): JsonValue {
  return {
    chunks: value.chunks.map(projectChunk),
    truncated: value.truncated,
  }
}

/**
 * Register the `ragflow_retrieve` tool and its system-prompt guidance. The
 * registrations are effect-scoped, so an HMR reload or an uninstall removes
 * both without manual teardown.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { maxChunks, timeoutMs } = config as ResolvedConfig

  ctx.systemPrompt.section({
    name: 'tool:ragflow_retrieve',
    order: 110,
    text: 'Use the ragflow_retrieve tool to search the connected RAGFlow knowledge bases before'
      + ' answering questions about internal, project-specific, or uploaded documents. It returns'
      + ' text chunks with similarity scores and their source document names. Ground the answer in'
      + ' the retrieved chunks and cite the document names; when it returns nothing, say the'
      + ' knowledge base has no relevant content rather than inventing a citation.',
  })

  ctx.tools.register(defineTool({
    name: 'ragflow_retrieve',
    description: 'Retrieve relevant knowledge chunks from the connected RAGFlow knowledge bases.'
      + ' Returns text chunks from indexed documents with similarity scores and source metadata.',
    parameters: {
      question: {
        type: 'string',
        required: true,
        description: 'The natural-language question to retrieve relevant knowledge for.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                datasetId: { type: 'string', required: true },
                documentId: { type: 'string', required: true },
                chunkId: { type: 'string' },
                documentName: { type: 'string' },
                similarity: { type: 'number' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatRetrieveOutput(value) }],
      presentationMeta: (_args, value) => retrieveMetaFromValue(value),
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { question } = parseRetrieveArgs(args)
      const result = await ctx.ragflow.retrieve({ question, maxChunks }, exec.signal)
      return {
        chunks: result.chunks.map(projectChunk),
        truncated: result.truncated,
      }
    },
    presentCall: presentRetrieveCall,
    presentResult: (args, result) => {
      if (result.isError) return undefined
      return { card: 'generic', kind: 'search', title: args.question, rawInput: args.question }
    },
  }))
}
