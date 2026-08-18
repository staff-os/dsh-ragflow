import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  buildRetrievalBody,
  mapRagflowChunk,
  mapRagflowResponse,
  RagflowHttpProvider,
} from '../src/provider.ts'
import type { RagflowHttpProviderOptions } from '../src/provider.ts'
import { RagflowError } from '../src/types.ts'

const baseOptions: RagflowHttpProviderOptions = {
  apiKey: 'ragflow-test-key',
  baseURL: 'http://localhost:9380',
  datasetIds: ['ds-1'],
  similarityThreshold: 0.2,
}

/** A RAGFlow success envelope with one chunk, as the documented API returns it. */
function successEnvelope(): unknown {
  return {
    code: 0,
    data: {
      chunks: [{
        content: 'The harness loads plugins through cordis.',
        content_ltks: 'the harness load plugin',
        document_id: 'doc-1',
        document_keyword: 'architecture.md',
        highlight: 'plugins',
        id: 'chunk-1',
        dataset_id: 'ds-1',
        similarity: 0.87,
        term_similarity: 0.9,
        vector_similarity: 0.8,
      }],
      doc_aggs: [{ count: 1, doc_id: 'doc-1', doc_name: 'architecture.md' }],
      total: 1,
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapRagflowChunk', () => {
  it('maps the documented field names', () => {
    expect(mapRagflowChunk({
      content: 'body',
      id: 'chunk-1',
      dataset_id: 'ds-1',
      document_id: 'doc-1',
      document_keyword: 'guide.md',
      similarity: 0.5,
    })).toEqual({
      content: 'body',
      chunkId: 'chunk-1',
      datasetId: 'ds-1',
      documentId: 'doc-1',
      documentName: 'guide.md',
      similarity: 0.5,
    })
  })

  it('accepts the legacy field spellings', () => {
    expect(mapRagflowChunk({
      content_with_weight: 'body',
      chunk_id: 'chunk-1',
      kb_id: 'ds-1',
      doc_id: 'doc-1',
      docnm_kwd: 'guide.md',
    })).toEqual({
      content: 'body',
      chunkId: 'chunk-1',
      datasetId: 'ds-1',
      documentId: 'doc-1',
      documentName: 'guide.md',
    })
  })

  it('accepts the Python SDK spelling of the document name', () => {
    expect(mapRagflowChunk({ content: 'body', document_name: 'guide.md' })?.documentName).toBe('guide.md')
  })

  it('drops a chunk with no content', () => {
    expect(mapRagflowChunk({ content: '   ', document_id: 'doc-1' })).toBeUndefined()
  })

  it('omits absent optional fields rather than inventing them', () => {
    expect(mapRagflowChunk({ content: 'body' })).toEqual({
      content: 'body',
      datasetId: '',
      documentId: '',
    })
  })
})

describe('mapRagflowResponse', () => {
  it('reads chunks from the data envelope', () => {
    const result = mapRagflowResponse(successEnvelope() as never)
    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0]?.documentName).toBe('architecture.md')
    expect(result.truncated).toBe(false)
  })

  it('treats an empty knowledge base as a result, not an error', () => {
    expect(mapRagflowResponse({ code: 0, data: { chunks: [], total: 0 } }))
      .toEqual({ chunks: [], truncated: false })
  })

  it('treats a non-zero code as a provider error', () => {
    expect(() => mapRagflowResponse({ code: 102, message: 'Dataset not found.' }))
      .toThrowError(/Dataset not found/u)
  })
})

describe('buildRetrievalBody', () => {
  it('maps maxChunks to page_size, not top_k', () => {
    const body = buildRetrievalBody({ question: 'q', maxChunks: 8 }, { ...baseOptions, vectorTopK: 1024 })
    expect(body).toMatchObject({ page: 1, page_size: 8, top_k: 1024 })
  })

  it('falls back to the configured scope', () => {
    expect(buildRetrievalBody({ question: 'q' }, baseOptions)).toMatchObject({ dataset_ids: ['ds-1'] })
  })

  it('lets a request scope replace the configured scope wholesale', () => {
    const body = buildRetrievalBody(
      { question: 'q', documentIds: ['doc-9'] },
      { ...baseOptions, datasetIds: ['ds-1'], documentIds: ['doc-1'] },
    )
    expect(body).not.toHaveProperty('dataset_ids')
    expect(body).toMatchObject({ document_ids: ['doc-9'] })
  })

  it('fails loudly when no dataset or document is in scope', () => {
    expect(() => buildRetrievalBody({ question: 'q' }, { ...baseOptions, datasetIds: [] }))
      .toThrowError(expect.objectContaining({ code: 'RAGFLOW_SCOPE_MISSING' }) as Error)
  })

  it('omits every option RAGFlow should default itself', () => {
    const body = buildRetrievalBody({ question: 'q' }, baseOptions)
    expect(Object.keys(body).sort()).toEqual(['dataset_ids', 'question', 'similarity_threshold'])
  })
})

describe('RagflowHttpProvider', () => {
  it('is unavailable without a key and available with one', () => {
    expect(new RagflowHttpProvider(() => ({ ...baseOptions, apiKey: '' })).available()).toBe(false)
    expect(new RagflowHttpProvider(() => baseOptions).available()).toBe(true)
  })

  it('is unavailable with an unparseable base URL or an out-of-range threshold', () => {
    expect(new RagflowHttpProvider(() => ({ ...baseOptions, baseURL: 'not a url' })).available()).toBe(false)
    expect(new RagflowHttpProvider(() => ({ ...baseOptions, similarityThreshold: 1.5 })).available()).toBe(false)
  })

  it('posts to /api/v1/retrieval with a bearer key and maps the response', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(successEnvelope())))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new RagflowHttpProvider(() => baseOptions).retrieve({ question: 'how?', maxChunks: 8 })

    expect(result.chunks).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:9380/api/v1/retrieval')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ragflow-test-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ question: 'how?', page_size: 8 })
  })

  it('surfaces an HTTP-200 application error', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse({ code: 102, message: 'no dataset' })))
    await expect(new RagflowHttpProvider(() => baseOptions).retrieve({ question: 'q' }))
      .rejects.toThrowError(/no dataset/u)
  })

  it('codes a 401 as unauthorized', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse({ code: 401, message: 'bad key' }, 401)))
    await expect(new RagflowHttpProvider(() => baseOptions).retrieve({ question: 'q' }))
      .rejects.toThrowError(expect.objectContaining({ code: 'RAGFLOW_PROVIDER_UNAUTHORIZED' }) as Error)
  })

  it('reports a missing credential before touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = new RagflowHttpProvider(() => ({
      ...baseOptions,
      apiKey: '',
      resolveApiKey: () => Promise.resolve(undefined),
    }))
    await expect(provider.retrieve({ question: 'q' }))
      .rejects.toThrowError(expect.objectContaining({ code: 'RAGFLOW_PROVIDER_CREDENTIAL_MISSING' }) as Error)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports cancellation as RAGFLOW_ABORTED', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('aborted', 'AbortError')))
    const controller = new AbortController()
    controller.abort()
    const error = await new RagflowHttpProvider(() => baseOptions)
      .retrieve({ question: 'q' }, controller.signal)
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(RagflowError)
    expect((error as RagflowError).code).toBe('RAGFLOW_ABORTED')
  })
})
