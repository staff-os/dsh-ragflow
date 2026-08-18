/**
 * `@deepseek-ai/dsh-ragflow/config`: a loopback-only configuration page for the
 * RAGFlow rows, served by this plugin itself.
 *
 * DSH's built-in **Settings → Plugins** tab renders only the settings
 * namespaces its host api-proxy allowlists (`WEB_SETTINGS_NAMESPACES`), so a
 * plugin distributed outside that repository cannot appear there without
 * patching a released package. Everything that page NEEDS, though, is public
 * plugin API: `ctx.settings` owns the layered document, `ctx.credentials` owns
 * the key, and `ctx.webServer` takes a route. This module composes those three
 * into an equivalent page of our own at `/ragflow`.
 *
 * Fence: every request must arrive on a loopback authority, because this page
 * both reads the deployment's endpoint configuration and writes a credential —
 * `dsh web --host 0.0.0.0` must not expose it to the LAN it serves the chat UI
 * to. Mutations additionally require a JSON media type (so a cross-site
 * "simple request" can never reach them) and, when the browser sends an
 * `Origin`, that it match the request authority.
 *
 * @module @deepseek-ai/dsh-ragflow/config
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { SettingsDescriptor, SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from './index.ts'
import {
  BASE_URL_ENV,
  DATASET_IDS_ENV,
  DEFAULT_API_KEY_ENV,
  parseIdList,
} from './http.ts'
import { RAGFLOW_DEFAULT_BASE_URL, RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD } from './provider.ts'
import { RAGFLOW_HTTP_SETTINGS_NAMESPACE, RAGFLOW_TOOL_SETTINGS_NAMESPACE } from './settings.ts'
import { CONFIG_PAGE_HTML } from './config-page.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ragflow-config'

/** The HTTP carrier this page mounts on; absent in headless/TUI compositions. */
export const inject = ['webServer']

/** Largest accepted request body; the page posts a handful of scalar fields. */
export const MAX_BODY_BYTES = 64 * 1024

/** Default mount path of the configuration page. */
export const DEFAULT_CONFIG_PATH = '/ragflow'

/** Plugin config: where the page is mounted. */
export interface Config {
  /** Absolute pathname the page and its JSON endpoints are served under. */
  path?: string
}

export const Config: z<Config> = z.object({
  path: z.string().default(DEFAULT_CONFIG_PATH),
})

/** Accepted type of one editable field, used to reject a malformed wire value. */
export type FieldKind = 'string' | 'string[]' | 'number' | 'boolean'

/**
 * The provider fields this page edits. `apiKey` is deliberately absent: a
 * literal secret in the settings document is exactly what the credential seam
 * exists to avoid, so the page writes the key through `ctx.credentials`.
 */
export const PROVIDER_FIELDS: Readonly<Record<string, FieldKind>> = {
  apiKeyEnv: 'string',
  baseURL: 'string',
  datasetIds: 'string[]',
  documentIds: 'string[]',
  similarityThreshold: 'number',
  vectorTopK: 'number',
  vectorSimilarityWeight: 'number',
  keyword: 'boolean',
  rerankId: 'string',
}

/** The tool fields this page edits. */
export const TOOL_FIELDS: Readonly<Record<string, FieldKind>> = {
  maxChunks: 'number',
  timeoutMs: 'number',
}

/** One namespace as the page sees it. */
export interface SectionState {
  /** Whether the owning row is mounted and its namespace registered. */
  available: boolean
  /** Revision the page echoes back so a stale form is refused, not merged. */
  revision: number
  /** Resolved value: schema defaults, then the composition entry, then the user layer. */
  value: Record<string, unknown>
  /** Field names present in the raw user layer — what the page marks as overridden. */
  overridden: string[]
}

/** Everything one page render needs. */
export interface ConfigState {
  provider: SectionState
  tool: SectionState
  /** Credential facts for the resolved reference — never the value. */
  credential: { ref: string, configured: boolean, writable: boolean, source?: string }
  /** Launch-environment fallbacks, so the page can name what an empty field inherits. */
  env: { baseURL?: string, datasetIds?: string }
  /** The endpoint and scope a retrieval would use right now. */
  effective: { baseURL: string, datasetIds: string[] }
  /** Constants the page shows as placeholders. */
  defaults: { baseURL: string, similarityThreshold: number, apiKeyEnv: string }
  /** Absent settings service: the page renders read-only rather than lying about saves. */
  settingsAvailable: boolean
  /** Absent credential service: the key field is read-only for the same reason. */
  credentialsAvailable: boolean
  /** The user-editable settings document, when the provider owns one. */
  documentPath?: string
}

/** A refusal carrying the status the route answers with. */
export class ConfigRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'REQUEST_REJECTED') {
    super(message)
  }
}

/** Whether a hostname names this machine's loopback interface. */
export function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (bare === 'localhost' || bare === '::1' || bare === '0:0:0:0:0:0:0:1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
}

/** Parse a `Host`-style authority into its hostname, or undefined when unusable. */
export function authorityHostname(authority: string | undefined): string | undefined {
  if (authority === undefined || authority.length === 0) return undefined
  try {
    return new URL(`http://${authority}`).hostname
  } catch {
    return undefined
  }
}

/** The request headers the fence reads; `IncomingMessage` satisfies it. */
export interface FenceableRequest {
  headers: { host?: string | undefined, origin?: string | undefined, 'content-type'?: string | undefined }
}

/**
 * Apply the request fence. Throws {@link ConfigRequestError} carrying the status
 * the caller answers with; returns normally when the request may proceed.
 *
 * @param req - the incoming request.
 * @param mutating - whether this request writes (adds the media-type and
 *   same-origin requirements a cross-site form must not be able to satisfy).
 */
export function assertRequestAllowed(req: FenceableRequest, mutating: boolean): void {
  const hostname = authorityHostname(req.headers.host)
  if (hostname === undefined || !isLoopbackHostname(hostname)) {
    throw new ConfigRequestError(403, 'the RAGFlow configuration page is served on loopback only', 'NOT_LOOPBACK')
  }
  if (!mutating) return
  const mediaType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new ConfigRequestError(415, 'expected an application/json request body', 'BAD_MEDIA_TYPE')
  }
  const origin = req.headers.origin
  // An absent Origin is a non-browser caller, already fenced to loopback above;
  // a present one must name this very authority.
  if (origin === undefined || origin === 'null') return
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    throw new ConfigRequestError(403, `unusable Origin header "${origin}"`, 'BAD_ORIGIN')
  }
  if (originUrl.host !== req.headers.host || !isLoopbackHostname(originUrl.hostname)) {
    throw new ConfigRequestError(403, `Origin "${origin}" does not match this authority`, 'BAD_ORIGIN')
  }
}

/** Project one settings descriptor into the page's section view. */
export function sectionOf(descriptor: SettingsDescriptor | undefined): SectionState {
  if (descriptor === undefined) return { available: false, revision: 0, value: {}, overridden: [] }
  const user = descriptor.user
  return {
    available: true,
    revision: descriptor.revision,
    value: (descriptor.value ?? {}) as Record<string, unknown>,
    overridden: user !== null && typeof user === 'object' ? Object.keys(user as object) : [],
  }
}

/**
 * Turn one submitted section into path edits. A null field is an `unset` — the
 * page's "leave empty to inherit" — and every other field is a `set`. Edits are
 * path-addressed rather than a wholesale replace because the page holds a
 * REDACTED view: a replace rebuilt from it would delete the `apiKey` field the
 * wire never carried.
 *
 * @param fields - the submitted values, already JSON-decoded.
 * @param allowed - the editable field table for this section.
 * @returns the ordered ops for `settings.mutate`.
 */
export function planSectionOps(fields: Record<string, unknown>, allowed: Readonly<Record<string, FieldKind>>): SettingsPathOp[] {
  const ops: SettingsPathOp[] = []
  for (const [key, value] of Object.entries(fields)) {
    const kind = allowed[key]
    if (kind === undefined) throw new ConfigRequestError(400, `unknown field "${key}"`, 'UNKNOWN_FIELD')
    if (value === null || value === undefined) {
      ops.push({ op: 'unset', path: [key] })
      continue
    }
    assertFieldKind(key, kind, value)
    ops.push({ op: 'set', path: [key], value })
  }
  return ops
}

/** Reject a wire value whose type the schema would only discover later. */
function assertFieldKind(key: string, kind: FieldKind, value: unknown): void {
  const ok = kind === 'string'
    ? typeof value === 'string'
    : kind === 'boolean'
      ? typeof value === 'boolean'
      : kind === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : Array.isArray(value) && value.every(entry => typeof entry === 'string')
  if (!ok) throw new ConfigRequestError(400, `field "${key}" expects ${kind}`, 'BAD_FIELD_TYPE')
}

/** One submitted section: the revision it was read at, and its editable fields. */
export interface SaveSection {
  revision: number
  fields: Record<string, unknown>
}

/** The submitted form, as the save endpoint accepts it. */
export interface SaveRequest {
  provider?: SaveSection
  tool?: SaveSection
  /** New credential value; absent or blank keeps whatever is already stored. */
  apiKey?: string
}

/** Validate the submitted shape before any of it reaches the settings seam. */
export function parseSaveRequest(body: unknown): SaveRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConfigRequestError(400, 'expected a JSON object body', 'BAD_BODY')
  }
  const raw = body as Record<string, unknown>
  const section = (key: 'provider' | 'tool'): SaveSection | undefined => {
    const value = raw[key]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ConfigRequestError(400, `"${key}" must be an object`, 'BAD_BODY')
    }
    const { revision, fields } = value as Record<string, unknown>
    if (typeof revision !== 'number' || !Number.isInteger(revision)) {
      throw new ConfigRequestError(400, `"${key}.revision" must be an integer`, 'BAD_BODY')
    }
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new ConfigRequestError(400, `"${key}.fields" must be an object`, 'BAD_BODY')
    }
    return { revision, fields: fields as Record<string, unknown> }
  }
  const apiKey = raw['apiKey']
  if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') {
    throw new ConfigRequestError(400, '"apiKey" must be a string', 'BAD_BODY')
  }
  const provider = section('provider')
  const tool = section('tool')
  return {
    ...provider === undefined ? {} : { provider },
    ...tool === undefined ? {} : { tool },
    ...typeof apiKey === 'string' ? { apiKey } : {},
  }
}

/** Read a bounded JSON body, rejecting anything past {@link MAX_BODY_BYTES}. */
export async function readJsonBody(req: AsyncIterable<Buffer | string>): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new ConfigRequestError(413, 'request body is too large', 'BODY_TOO_LARGE')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ConfigRequestError(400, 'request body is not valid JSON', 'BAD_JSON')
  }
}

/** Collect everything one page render needs from the mounted services. */
export async function buildState(ctx: Context): Promise<ConfigState> {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  const descriptors = settings?.describe({ redactSecrets: true }) ?? []
  const find = (ns: string): SettingsDescriptor | undefined => descriptors.find(entry => String(entry.ns) === ns)
  const provider = sectionOf(find(String(RAGFLOW_HTTP_SETTINGS_NAMESPACE)))
  const tool = sectionOf(find(String(RAGFLOW_TOOL_SETTINGS_NAMESPACE)))

  const env = launchEnvironmentOf(ctx)
  const envBaseURL = env.get(BASE_URL_ENV)?.value
  const envDatasetIds = env.get(DATASET_IDS_ENV)?.value

  const configuredApiKeyEnv = provider.value['apiKeyEnv']
  const apiKeyEnv = typeof configuredApiKeyEnv === 'string' && configuredApiKeyEnv.length > 0
    ? configuredApiKeyEnv
    : DEFAULT_API_KEY_ENV
  const info = credentials === undefined ? undefined : await credentials.describe(credentialRef(apiKeyEnv))

  const configuredBaseURL = provider.value['baseURL']
  const configuredDatasetIds = Array.isArray(provider.value['datasetIds'])
    ? provider.value['datasetIds'] as string[]
    : []

  return {
    provider,
    tool,
    credential: {
      ref: apiKeyEnv,
      configured: info?.configured ?? false,
      writable: info?.writable ?? false,
      ...info?.source === undefined ? {} : { source: info.source },
    },
    env: {
      ...envBaseURL === undefined ? {} : { baseURL: envBaseURL },
      ...envDatasetIds === undefined ? {} : { datasetIds: envDatasetIds },
    },
    effective: {
      baseURL: typeof configuredBaseURL === 'string' && configuredBaseURL.length > 0
        ? configuredBaseURL
        : envBaseURL ?? RAGFLOW_DEFAULT_BASE_URL,
      datasetIds: configuredDatasetIds.length > 0 ? configuredDatasetIds : parseIdList(envDatasetIds),
    },
    defaults: {
      baseURL: RAGFLOW_DEFAULT_BASE_URL,
      similarityThreshold: RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
    },
    settingsAvailable: settings !== undefined,
    credentialsAvailable: credentials !== undefined,
    ...settings?.documentPath === undefined ? {} : { documentPath: settings.documentPath },
  }
}

/** The machine code a thrown value carries, when it carries one. */
export function codeOf(error: unknown): string | undefined {
  const raw = (error as { code?: unknown } | null | undefined)?.code
  return typeof raw === 'string' ? raw : undefined
}

/**
 * Map a settings-seam refusal to the answer the page acts on. Detection is by
 * the seam's machine `code`, never `instanceof`: a linked or duplicated copy of
 * the settings package would make the class check silently false and downgrade
 * a conflict into a generic failure.
 */
function settingsWriteError(error: unknown): ConfigRequestError {
  if (codeOf(error) === 'SETTINGS_CONFLICT') {
    return new ConfigRequestError(409, 'the settings document changed since this page loaded; reload and reapply', 'SETTINGS_CONFLICT')
  }
  return new ConfigRequestError(400, error instanceof Error ? error.message : String(error), 'SETTINGS_REJECTED')
}

/** Run one section write, translating every seam refusal into a page answer. */
async function writeSection(
  settings: SettingsProvider,
  section: SaveSection,
  ns: Parameters<SettingsProvider['mutate']>[0],
  allowed: Readonly<Record<string, FieldKind>>,
): Promise<void> {
  const ops = planSectionOps(section.fields, allowed)
  try {
    await settings.mutate(ns, ops, section.revision)
  } catch (error) {
    throw settingsWriteError(error)
  }
}

/**
 * Apply one submitted form: the settings edits first (each fenced by the
 * revision the page read), then the credential. The key is written last so a
 * rejected section never leaves a rotated secret behind an unsaved endpoint.
 *
 * @param ctx - the plugin context owning the settings and credential planes.
 * @param request - the validated submission.
 */
export async function applySave(ctx: Context, request: SaveRequest): Promise<void> {
  const settings = ctx.get('settings')
  if (request.provider !== undefined || request.tool !== undefined) {
    if (settings === undefined) {
      throw new ConfigRequestError(503, 'this deployment mounts no settings provider, so values cannot be saved', 'SETTINGS_ABSENT')
    }
    if (request.provider !== undefined) {
      await writeSection(settings, request.provider, RAGFLOW_HTTP_SETTINGS_NAMESPACE, PROVIDER_FIELDS)
    }
    if (request.tool !== undefined) {
      await writeSection(settings, request.tool, RAGFLOW_TOOL_SETTINGS_NAMESPACE, TOOL_FIELDS)
    }
  }
  const apiKey = request.apiKey?.trim()
  if (apiKey === undefined || apiKey.length === 0) return
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new ConfigRequestError(503, 'this deployment mounts no credential provider, so the API key cannot be saved', 'CREDENTIALS_ABSENT')
  }
  const resolved = settings?.get(RAGFLOW_HTTP_SETTINGS_NAMESPACE) as { apiKeyEnv?: string } | undefined
  try {
    await credentials.set(credentialRef(resolved?.apiKeyEnv ?? DEFAULT_API_KEY_ENV), apiKey)
  } catch (error) {
    // The seam refuses a write a read-only layer would shadow (a key in the
    // launch environment); saying so beats storing a value nothing resolves.
    throw new ConfigRequestError(400, error instanceof Error ? error.message : String(error), 'CREDENTIAL_REJECTED')
  }
}

/** Run one live retrieval so the page can report whether the settings work. */
export async function runProbe(ctx: Context, question: string): Promise<{ chunks: number, truncated: boolean }> {
  const ragflow = ctx.get('ragflow')
  if (ragflow === undefined) {
    throw new ConfigRequestError(503, 'the ragflow service is not mounted in this composition', 'RAGFLOW_ABSENT')
  }
  const result = await ragflow.retrieve({ question, maxChunks: 1 }, AbortSignal.timeout(20_000))
  return { chunks: result.chunks.length, truncated: result.truncated }
}

/** Map a thrown value to the status and body the endpoints answer with. */
export function errorResponse(error: unknown): { status: number, body: { error: string, code: string } } {
  if (error instanceof ConfigRequestError) return { status: error.status, body: { error: error.message, code: error.code } }
  if (codeOf(error) === 'SETTINGS_CONFLICT') {
    return { status: 409, body: { error: 'the settings document changed since this page loaded; reload and reapply', code: 'SETTINGS_CONFLICT' } }
  }
  return { status: 400, body: { error: error instanceof Error ? error.message : String(error), code: codeOf(error) ?? 'INTERNAL' } }
}

/** Send one JSON response with caching disabled — this page reports live state. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Mount the configuration page and its JSON endpoints under `config.path`. The
 * route is an effect on this plugin's fiber, so an uninstall or an HMR reload
 * removes it without manual teardown.
 */
export function apply(ctx: Context, config: Config): void {
  const base = (config.path ?? DEFAULT_CONFIG_PATH).replace(/\/+$/, '') || DEFAULT_CONFIG_PATH

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const route = pathname.slice(base.length) || '/'
    try {
      if (route === '/' || route === '/index.html') {
        assertRequestAllowed(req, false)
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new ConfigRequestError(405, 'method not allowed', 'BAD_METHOD')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(req.method === 'HEAD' ? undefined : CONFIG_PAGE_HTML)
        return
      }
      if (route === '/state') {
        assertRequestAllowed(req, false)
        if (req.method !== 'GET') throw new ConfigRequestError(405, 'method not allowed', 'BAD_METHOD')
        sendJson(res, 200, await buildState(ctx))
        return
      }
      if (route === '/save') {
        if (req.method !== 'POST') throw new ConfigRequestError(405, 'method not allowed', 'BAD_METHOD')
        assertRequestAllowed(req, true)
        await applySave(ctx, parseSaveRequest(await readJsonBody(req)))
        sendJson(res, 200, { saved: true, state: await buildState(ctx) })
        return
      }
      if (route === '/probe') {
        if (req.method !== 'POST') throw new ConfigRequestError(405, 'method not allowed', 'BAD_METHOD')
        assertRequestAllowed(req, true)
        const body = await readJsonBody(req) as { question?: unknown }
        const question = typeof body.question === 'string' && body.question.trim().length > 0
          ? body.question.trim()
          : 'ping'
        sendJson(res, 200, { ok: true, ...await runProbe(ctx, question) })
        return
      }
      throw new ConfigRequestError(404, 'no such endpoint', 'NOT_FOUND')
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      const { status, body } = errorResponse(error)
      sendJson(res, status, body)
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, handler }), 'ragflow-config: page route')
  ctx.logger.info('RAGFlow configuration page: http://127.0.0.1:%d%s', ctx.webServer.port, base)
}
