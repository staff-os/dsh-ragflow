import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { apply, type Config } from '../src/config.ts'

/** A settings stand-in recording what the page asked it to write. */
class FakeSettings {
  readonly writes: { ns: string, ops: readonly SettingsPathOp[], expected?: number }[] = []
  readonly documentPath = '/home/dev/.dsh/settings.yaml'

  constructor(
    private readonly sections: Record<string, { value: Record<string, unknown>, user?: object, revision: number }>,
    private readonly refuse?: Error,
  ) {}

  describe(): unknown[] {
    return Object.entries(this.sections).map(([ns, section]) => ({
      ns,
      schema: {},
      value: section.value,
      revision: section.revision,
      applies: 'live',
      ...section.user === undefined ? {} : { user: section.user },
    }))
  }

  get(ns: string): unknown {
    return this.sections[ns]?.value
  }

  async mutate(ns: string, ops: readonly SettingsPathOp[], expected?: number): Promise<void> {
    if (this.refuse !== undefined) throw this.refuse
    this.writes.push({ ns, ops, ...expected === undefined ? {} : { expected } })
  }
}

/** A credential stand-in that never reveals a value, like the real seam. */
class FakeCredentials {
  readonly stored: { ref: string, value: string }[] = []
  constructor(
    private readonly info: { configured: boolean, writable: boolean, source?: string },
    private readonly refuse?: Error,
  ) {}

  async describe(): Promise<{ configured: boolean, writable: boolean, source?: string }> {
    return this.info
  }

  async set(ref: string, value: string): Promise<void> {
    if (this.refuse !== undefined) throw this.refuse
    this.stored.push({ ref: String(ref), value })
  }
}

/** The captured response: status, headers, and body the handler wrote. */
interface Captured {
  status?: number
  headers?: Record<string, string>
  body: string
}

function response(): { res: ServerResponse, captured: Captured } {
  const captured: Captured = { body: '' }
  const res = {
    headersSent: false,
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status
      captured.headers = headers
      this.headersSent = true
      return this
    },
    end(chunk?: string) {
      if (chunk !== undefined) captured.body = chunk
    },
  }
  return { res: res as unknown as ServerResponse, captured }
}

function get(url: string, headers: Record<string, string> = { host: '127.0.0.1:3080' }): IncomingMessage {
  return Object.assign(Readable.from([]), { url, method: 'GET', headers }) as unknown as IncomingMessage
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))])
  return Object.assign(stream, {
    url,
    method: 'POST',
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', ...headers },
  }) as unknown as IncomingMessage
}

/** Mount the plugin against stand-in services and hand back the route handler. */
function mount(options: {
  settings?: FakeSettings
  credentials?: FakeCredentials
  ragflow?: { retrieve: (request: unknown, signal?: AbortSignal) => Promise<{ chunks: unknown[], truncated: boolean }> }
  config?: Config
} = {}) {
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
  const services: Record<string, unknown> = {
    ...options.settings === undefined ? {} : { settings: options.settings },
    ...options.credentials === undefined ? {} : { credentials: options.credentials },
    ...options.ragflow === undefined ? {} : { ragflow: options.ragflow },
    launchEnvironment: { get: () => undefined },
  }
  const ctx = {
    get: (key: string) => services[key],
    effect: (factory: () => unknown) => {
      factory()
      return () => {}
    },
    webServer: {
      port: 3080,
      register: (route: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) => {
        handler = route.handler
        return () => {}
      },
    },
    logger: { info: vi.fn() },
  } as unknown as Context

  apply(ctx, options.config ?? { path: '/ragflow' })
  if (handler === undefined) throw new Error('the plugin registered no route')
  return { handler, ctx }
}

const providerSection = {
  value: { apiKeyEnv: 'RAGFLOW_API_KEY', similarityThreshold: 0.2, datasetIds: ['ds-1'] },
  user: { datasetIds: ['ds-1'] },
  revision: 4,
}
const toolSection = { value: { maxChunks: 8, timeoutMs: 30_000 }, revision: 0 }

function settings(): FakeSettings {
  return new FakeSettings({ 'ragflow-http': providerSection, 'tool-ragflow': toolSection })
}

describe('the configuration route', () => {
  it('serves the page on loopback', async () => {
    const { handler } = mount({ settings: settings() })
    const { res, captured } = response()
    await handler(get('/ragflow'), res)
    expect(captured.status).toBe(200)
    expect(captured.headers?.['content-type']).toBe('text/html; charset=utf-8')
    expect(captured.body).toContain('<title>RAGFlow</title>')
  })

  it('refuses the page on a LAN authority, whatever the server bound', async () => {
    const { handler } = mount({ settings: settings() })
    const { res, captured } = response()
    await handler(get('/ragflow', { host: '192.168.1.10:3080' }), res)
    expect(captured.status).toBe(403)
    expect(JSON.parse(captured.body).code).toBe('NOT_LOOPBACK')
  })

  it('reports the current state, including which fields the user overrode', async () => {
    const { handler } = mount({
      settings: settings(),
      credentials: new FakeCredentials({ configured: true, writable: true, source: 'file' }),
    })
    const { res, captured } = response()
    await handler(get('/ragflow/state'), res)
    const state = JSON.parse(captured.body)
    expect(captured.status).toBe(200)
    expect(state.provider.overridden).toEqual(['datasetIds'])
    expect(state.provider.revision).toBe(4)
    expect(state.credential).toEqual({ ref: 'RAGFLOW_API_KEY', configured: true, writable: true, source: 'file' })
    expect(state.effective).toEqual({ baseURL: 'http://localhost:9380', datasetIds: ['ds-1'] })
    expect(state.documentPath).toBe('/home/dev/.dsh/settings.yaml')
    expect(JSON.stringify(state)).not.toContain('apiKey"')
  })

  it('saves settings edits under the revision the page read, and stores the key out of band', async () => {
    const store = settings()
    const credentials = new FakeCredentials({ configured: false, writable: true })
    const { handler } = mount({ settings: store, credentials })
    const { res, captured } = response()
    await handler(post('/ragflow/save', {
      provider: { revision: 4, fields: { baseURL: 'http://ragflow:9380', rerankId: null } },
      tool: { revision: 0, fields: { maxChunks: 12 } },
      apiKey: 'ragflow-xxx',
    }), res)

    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body).saved).toBe(true)
    expect(store.writes).toEqual([
      {
        ns: 'ragflow-http',
        expected: 4,
        ops: [
          { op: 'set', path: ['baseURL'], value: 'http://ragflow:9380' },
          { op: 'unset', path: ['rerankId'] },
        ],
      },
      { ns: 'tool-ragflow', expected: 0, ops: [{ op: 'set', path: ['maxChunks'], value: 12 }] },
    ])
    expect(credentials.stored).toEqual([{ ref: 'RAGFLOW_API_KEY', value: 'ragflow-xxx' }])
  })

  it('refuses a save that is not JSON, so a cross-site form cannot write settings', async () => {
    const store = settings()
    const { handler } = mount({ settings: store })
    const { res, captured } = response()
    await handler(post('/ragflow/save', {}, { 'content-type': 'text/plain' }), res)
    expect(captured.status).toBe(415)
    expect(store.writes).toEqual([])
  })

  it('refuses a save whose Origin is another site', async () => {
    const store = settings()
    const { handler } = mount({ settings: store })
    const { res, captured } = response()
    await handler(post('/ragflow/save', {}, { origin: 'https://evil.example' }), res)
    expect(captured.status).toBe(403)
    expect(store.writes).toEqual([])
  })

  it('answers a probe with the chunk count the seam returned', async () => {
    const retrieve = vi.fn(async () => ({ chunks: [{ content: 'hit' }], truncated: false }))
    const { handler } = mount({ settings: settings(), ragflow: { retrieve } })
    const { res, captured } = response()
    await handler(post('/ragflow/probe', { question: 'what is dsh' }), res)
    expect(JSON.parse(captured.body)).toEqual({ ok: true, chunks: 1, truncated: false })
    expect(retrieve).toHaveBeenCalledWith({ question: 'what is dsh', maxChunks: 1 }, expect.anything())
  })

  it('reports a retrieval failure with the seam error code the page shows', async () => {
    const retrieve = vi.fn(async () => {
      throw Object.assign(new Error('no dataset'), { code: 'RAGFLOW_SCOPE_MISSING' })
    })
    const { handler } = mount({ settings: settings(), ragflow: { retrieve } })
    const { res, captured } = response()
    await handler(post('/ragflow/probe', {}), res)
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body).code).toBe('RAGFLOW_SCOPE_MISSING')
  })

  it('renders read-only rather than pretending to save when no settings provider is mounted', async () => {
    const { handler } = mount({})
    const { res, captured } = response()
    await handler(get('/ragflow/state'), res)
    const state = JSON.parse(captured.body)
    expect(state.settingsAvailable).toBe(false)
    expect(state.provider.available).toBe(false)

    const write = response()
    await handler(post('/ragflow/save', { provider: { revision: 0, fields: {} } }), write.res)
    expect(write.captured.status).toBe(503)
    expect(JSON.parse(write.captured.body).code).toBe('SETTINGS_ABSENT')
  })

  it('answers a stale form with 409 — detected by the seam code, not by class identity', async () => {
    // A linked or duplicated settings package makes `instanceof` silently false,
    // which is why the route reads the seam's own `code`.
    const conflict = Object.assign(new Error('namespace changed since it was read'), { code: 'SETTINGS_CONFLICT' })
    const { handler } = mount({ settings: new FakeSettings({ 'ragflow-http': providerSection }, conflict) })
    const { res, captured } = response()
    await handler(post('/ragflow/save', { provider: { revision: 1, fields: { rerankId: null } } }), res)
    expect(captured.status).toBe(409)
    expect(JSON.parse(captured.body).code).toBe('SETTINGS_CONFLICT')
  })

  it('reports a schema rejection as a rejected save, with the seam message', async () => {
    const rejection = new Error('$.similarityThreshold expected number <= 1 but got 5')
    const { handler } = mount({ settings: new FakeSettings({ 'ragflow-http': providerSection }, rejection) })
    const { res, captured } = response()
    await handler(post('/ragflow/save', { provider: { revision: 4, fields: { similarityThreshold: 5 } } }), res)
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body)).toEqual({ error: rejection.message, code: 'SETTINGS_REJECTED' })
  })

  it('reports a key the credential seam refuses, rather than storing something nothing resolves', async () => {
    const shadowed = new Error('a read-only source shadows RAGFLOW_API_KEY')
    const credentials = new FakeCredentials({ configured: true, writable: false, source: 'env' }, shadowed)
    const { handler } = mount({ settings: settings(), credentials })
    const { res, captured } = response()
    await handler(post('/ragflow/save', { apiKey: 'ragflow-xxx' }), res)
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body).code).toBe('CREDENTIAL_REJECTED')
    expect(credentials.stored).toEqual([])
  })

  it('answers an unknown endpoint under its prefix with 404', async () => {
    const { handler } = mount({ settings: settings() })
    const { res, captured } = response()
    await handler(get('/ragflow/nope'), res)
    expect(captured.status).toBe(404)
  })

  it('mounts on a configured path', async () => {
    const { handler } = mount({ settings: settings(), config: { path: '/kb/ragflow/' } })
    const { res, captured } = response()
    await handler(get('/kb/ragflow'), res)
    expect(captured.status).toBe(200)
    expect(captured.headers?.['content-type']).toBe('text/html; charset=utf-8')
  })
})
