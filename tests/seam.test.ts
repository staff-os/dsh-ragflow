import { describe, expect, it } from 'vitest'
import { capChunks } from '../src/index.ts'
import type { RagflowChunk, RagflowRetrieveResult } from '../src/types.ts'

function chunks(count: number): RagflowChunk[] {
  return Array.from({ length: count }, (_unused, index) => ({
    content: `chunk ${index}`,
    datasetId: 'ds-1',
    documentId: `doc-${index}`,
  }))
}

const result = (count: number): RagflowRetrieveResult => ({ chunks: chunks(count), truncated: false })

describe('capChunks', () => {
  it('passes a result through when it fits the bound', () => {
    expect(capChunks(result(3), 8)).toEqual({ chunks: chunks(3), truncated: false })
  })

  it('passes a result through when no bound is set', () => {
    expect(capChunks(result(40), undefined).chunks).toHaveLength(40)
  })

  it('truncates an over-returning provider and flags it', () => {
    const capped = capChunks(result(40), 8)
    expect(capped.chunks).toHaveLength(8)
    expect(capped.truncated).toBe(true)
  })

  it('does not flag truncation at exactly the bound', () => {
    expect(capChunks(result(8), 8).truncated).toBe(false)
  })
})
