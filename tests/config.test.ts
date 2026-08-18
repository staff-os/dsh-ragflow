import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import {
  assertRequestAllowed,
  authorityHostname,
  ConfigRequestError,
  errorResponse,
  isLoopbackHostname,
  MAX_BODY_BYTES,
  parseSaveRequest,
  planSectionOps,
  PROVIDER_FIELDS,
  readJsonBody,
  sectionOf,
  TOOL_FIELDS,
} from '../src/config.ts'

/** One request as the fence reads it. */
function request(headers: Record<string, string>): { headers: Record<string, string> } {
  return { headers }
}

describe('isLoopbackHostname', () => {
  it('accepts the loopback names a browser can produce', () => {
    for (const hostname of ['localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]']) {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  })

  it('rejects LAN and public authorities', () => {
    for (const hostname of ['192.168.1.10', '10.0.14.51', 'ragflow.internal', '0.0.0.0']) {
      expect(isLoopbackHostname(hostname)).toBe(false)
    }
  })
})

describe('authorityHostname', () => {
  it('splits the port off an authority', () => {
    expect(authorityHostname('127.0.0.1:3080')).toBe('127.0.0.1')
    expect(authorityHostname('[::1]:3080')).toBe('[::1]')
  })

  it('reports an absent or unusable authority', () => {
    expect(authorityHostname(undefined)).toBeUndefined()
    expect(authorityHostname('')).toBeUndefined()
  })
})

describe('assertRequestAllowed', () => {
  it('admits a loopback read', () => {
    expect(() => assertRequestAllowed(request({ host: '127.0.0.1:3080' }), false)).not.toThrow()
  })

  it('refuses a read arriving on a LAN authority', () => {
    expect(() => assertRequestAllowed(request({ host: '192.168.1.10:3080' }), false))
      .toThrowError(expect.objectContaining({ status: 403, code: 'NOT_LOOPBACK' }))
  })

  it('refuses a request without a Host header', () => {
    expect(() => assertRequestAllowed(request({}), false))
      .toThrowError(expect.objectContaining({ code: 'NOT_LOOPBACK' }))
  })

  it('refuses a write that is not JSON, so a cross-site form cannot reach it', () => {
    const req = request({ host: 'localhost:3080', 'content-type': 'application/x-www-form-urlencoded' })
    expect(() => assertRequestAllowed(req, true))
      .toThrowError(expect.objectContaining({ status: 415, code: 'BAD_MEDIA_TYPE' }))
  })

  it('accepts a JSON media type carrying a charset', () => {
    const req = request({ host: 'localhost:3080', 'content-type': 'application/json; charset=utf-8' })
    expect(() => assertRequestAllowed(req, true)).not.toThrow()
  })

  it('accepts a write whose Origin names this authority', () => {
    const req = request({ host: '127.0.0.1:3080', 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' })
    expect(() => assertRequestAllowed(req, true)).not.toThrow()
  })

  it('refuses a write whose Origin is another site', () => {
    const req = request({ host: '127.0.0.1:3080', 'content-type': 'application/json', origin: 'https://evil.example' })
    expect(() => assertRequestAllowed(req, true))
      .toThrowError(expect.objectContaining({ status: 403, code: 'BAD_ORIGIN' }))
  })

  it('admits a write with no Origin at all — a non-browser caller, already on loopback', () => {
    const req = request({ host: '127.0.0.1:3080', 'content-type': 'application/json' })
    expect(() => assertRequestAllowed(req, true)).not.toThrow()
  })
})

describe('sectionOf', () => {
  const descriptor = (user: unknown): SettingsDescriptor => ({
    ns: settingsNamespace('ragflow-http'),
    schema: {},
    value: { baseURL: 'http://ragflow:9380', similarityThreshold: 0.2 },
    revision: 7,
    applies: 'live',
    ...user === undefined ? {} : { user },
  })

  it('reports an unregistered namespace as unavailable', () => {
    expect(sectionOf(undefined)).toEqual({ available: false, revision: 0, value: {}, overridden: [] })
  })

  it('marks exactly the fields present in the raw user layer', () => {
    expect(sectionOf(descriptor({ baseURL: 'http://ragflow:9380' }))).toEqual({
      available: true,
      revision: 7,
      value: { baseURL: 'http://ragflow:9380', similarityThreshold: 0.2 },
      overridden: ['baseURL'],
    })
  })

  it('treats an absent user layer as nothing overridden', () => {
    expect(sectionOf(descriptor(undefined)).overridden).toEqual([])
  })
})

describe('planSectionOps', () => {
  it('sets a submitted value and unsets an emptied one', () => {
    const ops = planSectionOps({ baseURL: 'http://ragflow:9380', rerankId: null }, PROVIDER_FIELDS)
    expect(ops).toEqual([
      { op: 'set', path: ['baseURL'], value: 'http://ragflow:9380' },
      { op: 'unset', path: ['rerankId'] },
    ])
  })

  it('carries list and boolean fields through unchanged', () => {
    const ops = planSectionOps({ datasetIds: ['a', 'b'], keyword: true }, PROVIDER_FIELDS)
    expect(ops).toEqual([
      { op: 'set', path: ['datasetIds'], value: ['a', 'b'] },
      { op: 'set', path: ['keyword'], value: true },
    ])
  })

  it('refuses a field outside the editable table — apiKey included', () => {
    expect(() => planSectionOps({ apiKey: 'ragflow-secret' }, PROVIDER_FIELDS))
      .toThrowError(expect.objectContaining({ status: 400, code: 'UNKNOWN_FIELD' }))
  })

  it('refuses a value whose type the schema would only reject later', () => {
    expect(() => planSectionOps({ maxChunks: '8' }, TOOL_FIELDS))
      .toThrowError(expect.objectContaining({ code: 'BAD_FIELD_TYPE' }))
    expect(() => planSectionOps({ similarityThreshold: Number.NaN }, PROVIDER_FIELDS))
      .toThrowError(expect.objectContaining({ code: 'BAD_FIELD_TYPE' }))
    expect(() => planSectionOps({ datasetIds: ['a', 2] }, PROVIDER_FIELDS))
      .toThrowError(expect.objectContaining({ code: 'BAD_FIELD_TYPE' }))
  })
})

describe('parseSaveRequest', () => {
  it('accepts a submission carrying both sections and a key', () => {
    const parsed = parseSaveRequest({
      provider: { revision: 3, fields: { baseURL: 'http://ragflow:9380' } },
      tool: { revision: 0, fields: { maxChunks: 8 } },
      apiKey: 'ragflow-xxx',
    })
    expect(parsed).toEqual({
      provider: { revision: 3, fields: { baseURL: 'http://ragflow:9380' } },
      tool: { revision: 0, fields: { maxChunks: 8 } },
      apiKey: 'ragflow-xxx',
    })
  })

  it('accepts a submission that only rotates the key', () => {
    expect(parseSaveRequest({ apiKey: 'ragflow-xxx' })).toEqual({ apiKey: 'ragflow-xxx' })
  })

  it('rejects a body that is not a JSON object', () => {
    for (const body of [null, [], 'nope', 7]) {
      expect(() => parseSaveRequest(body)).toThrowError(expect.objectContaining({ code: 'BAD_BODY' }))
    }
  })

  it('rejects a section without the revision the fence needs', () => {
    expect(() => parseSaveRequest({ provider: { fields: {} } }))
      .toThrowError(expect.objectContaining({ code: 'BAD_BODY' }))
    expect(() => parseSaveRequest({ provider: { revision: 1.5, fields: {} } }))
      .toThrowError(expect.objectContaining({ code: 'BAD_BODY' }))
  })

  it('rejects a non-string key', () => {
    expect(() => parseSaveRequest({ apiKey: 42 })).toThrowError(expect.objectContaining({ code: 'BAD_BODY' }))
  })
})

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    await expect(readJsonBody(Readable.from([Buffer.from('{"apiKey":"x"}')]))).resolves.toEqual({ apiKey: 'x' })
  })

  it('treats an empty body as an empty object', async () => {
    await expect(readJsonBody(Readable.from([]))).resolves.toEqual({})
  })

  it('rejects a malformed body', async () => {
    await expect(readJsonBody(Readable.from([Buffer.from('{')])))
      .rejects.toThrowError(expect.objectContaining({ code: 'BAD_JSON' }))
  })

  it('refuses a body past the size bound instead of buffering it', async () => {
    const oversize = Readable.from([Buffer.alloc(MAX_BODY_BYTES + 1)])
    await expect(readJsonBody(oversize)).rejects.toThrowError(expect.objectContaining({ status: 413 }))
  })
})

describe('errorResponse', () => {
  it('answers a fenced refusal with its own status', () => {
    expect(errorResponse(new ConfigRequestError(403, 'nope', 'NOT_LOOPBACK')))
      .toEqual({ status: 403, body: { error: 'nope', code: 'NOT_LOOPBACK' } })
  })

  it('answers a stale form with 409 rather than overwriting the newer document', () => {
    const conflict = new SettingsConflictError(settingsNamespace('ragflow-http'), 2, 5)
    expect(errorResponse(conflict).status).toBe(409)
    expect(errorResponse(conflict).body.code).toBe('SETTINGS_CONFLICT')
  })

  it('surfaces a seam rejection with its own code', () => {
    const error = Object.assign(new Error('scope missing'), { code: 'RAGFLOW_SCOPE_MISSING' })
    expect(errorResponse(error)).toEqual({ status: 400, body: { error: 'scope missing', code: 'RAGFLOW_SCOPE_MISSING' } })
  })
})
