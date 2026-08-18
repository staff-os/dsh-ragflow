import { describe, expect, it } from 'vitest'
import {
  formatRetrieveOutput,
  parseRetrieveArgs,
  presentRetrieveCall,
  retrieveMetaFromValue,
} from '../src/tool.ts'
import type { RagflowRetrieveResult } from '../src/types.ts'

const twoChunks: RagflowRetrieveResult = {
  chunks: [
    {
      content: 'Plugins export apply(ctx, config).',
      datasetId: 'ds-1',
      documentId: 'doc-1',
      documentName: 'hello-plugin.md',
      similarity: 0.8123,
    },
    { content: 'Services are injected.', datasetId: 'ds-1', documentId: 'doc-2' },
  ],
  truncated: false,
}

describe('parseRetrieveArgs', () => {
  it('accepts a real question', () => {
    expect(parseRetrieveArgs({ question: 'how do plugins load?' })).toEqual({ question: 'how do plugins load?' })
  })

  it('rejects a blank question', () => {
    expect(() => parseRetrieveArgs({ question: '   ' })).toThrowError(/non-empty/u)
  })
})

describe('formatRetrieveOutput', () => {
  it('numbers chunks, labels them, and shows similarity when present', () => {
    const text = formatRetrieveOutput(twoChunks)
    expect(text).toContain('### 1. hello-plugin.md — similarity 0.8123')
    // A chunk with no document name falls back to its document id.
    expect(text).toContain('### 2. doc-2')
    expect(text).toContain('Cite the document names above')
  })

  it('renders an empty knowledge base as a usable answer, not a failure', () => {
    const text = formatRetrieveOutput({ chunks: [], truncated: false })
    expect(text).toContain('No relevant chunks found.')
    expect(text).not.toContain('Cite the document names')
  })

  it('tells the model how to get more when truncated', () => {
    expect(formatRetrieveOutput({ ...twoChunks, truncated: true })).toContain('Showing the first 2 chunks')
  })
})

describe('retrieveMetaFromValue', () => {
  it('projects chunks faithfully and omits absent optional fields', () => {
    expect(retrieveMetaFromValue(twoChunks)).toEqual({
      chunks: [
        {
          content: 'Plugins export apply(ctx, config).',
          datasetId: 'ds-1',
          documentId: 'doc-1',
          documentName: 'hello-plugin.md',
          similarity: 0.8123,
        },
        { content: 'Services are injected.', datasetId: 'ds-1', documentId: 'doc-2' },
      ],
      truncated: false,
    })
  })
})

describe('presentRetrieveCall', () => {
  it('titles the pending search card with the question', () => {
    expect(presentRetrieveCall({ question: 'how do plugins load?' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'how do plugins load?',
      rawInput: 'how do plugins load?',
    })
  })
})
