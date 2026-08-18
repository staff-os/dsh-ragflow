/**
 * Model-facing `ragflow_retrieve` tool: retrieve relevant knowledge from
 * connected RAGFlow knowledge bases.
 * @module @deepseek-ai/dsh-ragflow/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue } from '@deepseek-ai/dsh-tools'
import type { RagflowRetrieveResult, RagflowChunk } from './types.ts'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { RagflowRuntime } from './runtime.ts'

/** Default upper bound on returned chunks. */
export const RAGFLOW_RETRIEVE_DEFAULT_TOP_K = 10

/** Default cooperative tool-call timeout budget (ms). */
export const DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS = 30_000

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `question`.
 */
export function parseRetrieveArgs(args: { question: string }): { question: string } {
  if (args.question.trim().length === 0) throw new Error('question must be a non-empty string')
  return { question: args.question }
}

/**
 * Format a retrieval result as one model-facing text block.
 */
export function formatRetrieveOutput(result: RagflowRetrieveResult): string {
  const parts: string[] = []
  if (result.chunks.length > 0) {
    const lines = result.chunks.map((chunk, index) => {
      const label = chunk.documentName ?? chunk.documentId
      const meta: string[] = []
      if (chunk.similarity !== undefined) meta.push(`similarity: ${chunk.similarity.toFixed(4)}`)
      const suffix = meta.length > 0 ? ` — ${meta.join(', ')}` : ''
      return `### ${index + 1}. ${label}${suffix}\n\n${chunk.content}`
    })
    parts.push(`Retrieved chunks:\n\n${lines.join('\n\n---\n\n')}`)
  } else {
    parts.push('No relevant chunks found.')
  }

  if (result.truncated) parts.push(`(Showing the first ${result.chunks.length} chunks. Refine the question for more.)`)
  parts.push('Cite the relevant document names and chunk content above in your answer.')
  return parts.join('\n\n')
}

/** Pending-call presentation. */
export function presentRetrieveCall(args: { question: string }): GenericCallView {
  return { card: 'generic', title: args.question, kind: 'search', rawInput: args.question }
}

/** Project one seam chunk into a plain object that omits every absent optional field. */
function projectChunk(chunk: RagflowChunk): {
  content: string
  datasetId: string
  documentId: string
  documentName?: string
  similarity?: number
} {
  return {
    content: chunk.content,
    datasetId: chunk.datasetId,
    documentId: chunk.documentId,
    ...chunk.documentName !== undefined ? { documentName: chunk.documentName } : {},
    ...chunk.similarity !== undefined ? { similarity: chunk.similarity } : {},
  }
}

/** Project a validated output value into its replayable presentation meta. */
export function retrieveMetaFromValue(value: RagflowRetrieveResult): JsonValue {
  return {
    chunks: value.chunks.map(projectChunk),
    truncated: value.truncated,
  }
}

/**
 * Register the `ragflow_retrieve` tool and its system-prompt guidance.
 */
export function applyRagflowRetrieveTool(
  ctx: Context,
  topK: number,
  timeoutMs: number,
  datasetIds?: readonly string[],
): void {
  ctx.systemPrompt.section({
    name: 'tool:ragflow_retrieve',
    order: 110,
    text: 'Use the ragflow_retrieve tool to search connected RAGFlow knowledge bases for relevant information. It returns chunks of text from uploaded documents with similarity scores. Use the retrieved content to answer questions grounded in your knowledge base, and cite the document names in your answer.',
  })

  const ragflow = ctx.ragflow as RagflowRuntime
  ctx.tools.register(defineTool({
    name: 'ragflow_retrieve',
    description: 'Retrieve relevant knowledge chunks from connected RAGFlow knowledge bases. Returns text chunks from documents with similarity scores and source metadata.',
    parameters: {
      question: { type: 'string', required: true, description: 'The natural-language question to retrieve relevant knowledge for.' },
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
      const input = parseRetrieveArgs(args)
      const result = await ragflow.retrieve(
        {
          question: input.question,
          topK,
          ...datasetIds !== undefined && datasetIds.length > 0 ? { datasetIds } : {},
        },
        exec.signal,
      )
      return {
        chunks: result.chunks.map(projectChunk),
        truncated: result.truncated,
      }
    },
    presentCall: presentRetrieveCall,
    presentResult: (args, result) => {
      if (result.isError) return undefined
      return {
        card: 'generic',
        kind: 'search',
        title: args.question,
        rawInput: args.question,
      }
    },
  }))
}
