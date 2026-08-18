# dsh-ragflow

English | [中文](README.zh.md)

RAGFlow knowledge-base retrieval for the [DeepSeek Harness](https://deepseekdocs.com). It gives the
agent a `ragflow_retrieve` tool that queries your RAGFlow datasets and returns document chunks with
similarity scores and source names.

## Design

The package follows the Harness [three-role capability
pattern](https://deepseekdocs.com/docs/learn/dev/practice): one seam, one provider, one consumer —
shipped as one package with four plugin entry points (the fourth is the configuration page over the
same values), so a profile can override, replace, or drop any single role without touching the
others.

| Role | Module | Plugin name | Responsibility |
|---|---|---|---|
| Service Definition | [src/index.ts](src/index.ts) | `@deepseek-ai/dsh-ragflow` | Owns `ctx.ragflow`: provider registry, order-independent selection, `maxChunks` enforcement |
| Service Provider | [src/http.ts](src/http.ts) | `@deepseek-ai/dsh-ragflow/http` | Calls `POST /api/v1/retrieval`, resolves credentials, normalizes chunks |
| Consumer | [src/tool.ts](src/tool.ts) | `@deepseek-ai/dsh-ragflow/tool` | The model-facing tool: schema, prompt guidance, chunk bound, presentation |
| Consumer | [src/config.ts](src/config.ts) | `@deepseek-ai/dsh-ragflow/config` | The person-facing configuration page over the same settings and credential seams |

The provider and the consumer depend only on the Service Definition, never on each other. Replacing
the backend means replacing one row:

```yaml
- id: ragflow-http
  name: 'your-own-ragflow-provider'
```

## Prerequisites

1. **A running RAGFlow instance** — self-hosted or cloud. Defaults to `http://localhost:9380`.
2. **An API key** — create one in RAGFlow.
3. **A dataset with parsed documents** — RAGFlow rejects a retrieval that names no dataset and no
   document, so at least one dataset id must be configured.

## Install

```sh
dsh plugin --profile web add "github:staff-os/dsh-ragflow#main"
```

`dsh plugin add` forwards the source to pnpm as-is, so any pnpm-recognized source works:

```sh
dsh plugin --profile web add link:/path/to/dsh-ragflow   # local development
```

`lib/` is committed, so no build script runs at install time and pnpm needs no build allowance.
Restart `dsh web` afterwards, then verify the four rows landed:

```sh
dsh --profile web --dump-config | grep ragflow
```

## Configure

Three ways in, one set of values. The configuration page is the easy one; the environment and the
YAML rows remain exactly what they were.

### The configuration page

With `dsh web` running, open **http://127.0.0.1:3080/ragflow** (whatever port the web surface
printed). It edits the endpoint, the datasets, the retrieval options, and the tool bound, and it
stores the API key through the credential service — the key never reaches a settings file, and the
field reports only whether one is configured.

Every field is *leave empty to inherit*: the box holds your own override, the placeholder names the
value in effect without one. Clearing a box is how a field goes back to inheriting the composition
row, the environment variable, or the schema default. **Test retrieval** runs one live retrieval so
a saved endpoint can be confirmed rather than assumed.

The page is served on loopback only, whatever `dsh web --host` binds, because it reads deployment
configuration and writes a credential. Move it with the row's `path`, or take it out entirely:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: ragflow-config
  disabled: true
```

Saved values land in `~/.dsh/settings.yaml` under the `ragflow-http` and `tool-ragflow` namespaces,
which layer over the composition rows: schema defaults, then the `cordis.patch.yml` entry, then
your saved section. They apply to the next retrieval without a restart — except `timeoutMs`, which
the tool registry reads once when the tool registers.

### Environment variables

Set the environment the plugin reads — no YAML and no page needed for the common case:

```sh
export RAGFLOW_API_KEY=ragflow-xxx
export RAGFLOW_BASE_URL=http://your-ragflow-host:9380     # optional, defaults to localhost:9380
export RAGFLOW_DATASET_IDS=dataset_id_1,dataset_id_2      # required unless set in YAML
```

The API key resolves through the DSH credentials service when one is mounted
(`~/.dsh/.credentials.yaml`), and through the launch environment otherwise. Never inline a key in a
config file.

To override a row, restate it in your profile's `cordis.patch.yml` — a patch replaces a row's whole
`config` rather than merging into it, so state every key that row needs:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: ragflow-http
      name: '@deepseek-ai/dsh-ragflow/http'
      config:
        baseURL: http://your-ragflow-host:9380
        datasetIds: ['dataset_id_1']
        similarityThreshold: 0.3
        vectorTopK: 1024
```

### `@deepseek-ai/dsh-ragflow` (seam)

| Config | Default | Description |
|---|---|---|
| `retrieveProvider` | auto | Provider id to pin. Unset auto-selects when exactly one is usable. Also `$DSH_RAGFLOW_PROVIDER`. |

### `@deepseek-ai/dsh-ragflow/http` (provider)

| Config | Default | Description |
|---|---|---|
| `apiKey` | — | Literal key. Prefer `apiKeyEnv`. |
| `apiKeyEnv` | `RAGFLOW_API_KEY` | Credential reference resolved per retrieval. |
| `baseURL` | `$RAGFLOW_BASE_URL` → `http://localhost:9380` | Endpoint base; `/api/v1/retrieval` is appended. |
| `datasetIds` | `$RAGFLOW_DATASET_IDS` | Datasets searched by default. |
| `documentIds` | — | Narrows the search below dataset level. |
| `similarityThreshold` | `0.2` | Chunks below this combined similarity are dropped. |
| `vectorTopK` | RAGFlow's `1024` | RAGFlow's `top_k`: the vector candidate pool, **not** the result count. |
| `vectorSimilarityWeight` | RAGFlow's `0.3` | Vector weight in RAGFlow's hybrid score. |
| `keyword` | `false` | Run RAGFlow's keyword pass alongside vector search. |
| `rerankId` | — | Rerank model applied to the candidate pool. |

### `@deepseek-ai/dsh-ragflow/tool` (consumer)

| Config | Default | Description |
|---|---|---|
| `maxChunks` | `8` | Upper bound on chunks per call; sent as RAGFlow's `page_size` and enforced again by the seam. |
| `timeoutMs` | `30000` | Cooperative per-call timeout budget. Read at registration: a change applies at the next start. |

### `@deepseek-ai/dsh-ragflow/config` (configuration page)

| Config | Default | Description |
|---|---|---|
| `path` | `/ragflow` | Pathname the page and its JSON endpoints (`/state`, `/save`, `/probe`) are served under. |

## Retrieval flow

1. The model calls `ragflow_retrieve` with a `question`.
2. The tool validates it and calls `ctx.ragflow.retrieve({ question, maxChunks }, signal)`.
3. The seam selects the usable provider and forwards the request.
4. The provider posts to `/api/v1/retrieval` and normalizes `data.chunks[]`.
5. The seam caps the result to `maxChunks`; the tool renders it as cited text plus structured
   metadata that survives session replay.

An empty result is a result: the tool tells the model the knowledge base has nothing relevant and
not to invent a citation.

## Develop

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown → lib/{index,http,tool,config}.js
```

`lib/` is committed; rebuild and commit it with any `src/` change.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `RAGFLOW_SCOPE_MISSING` | No dataset or document in scope | Set `datasetIds` or `$RAGFLOW_DATASET_IDS` |
| `RAGFLOW_PROVIDER_CREDENTIAL_MISSING` | No key for the credential reference | Set `$RAGFLOW_API_KEY`, or match `apiKeyEnv` to your credentials key |
| `RAGFLOW_PROVIDER_UNAUTHORIZED` | RAGFlow rejected the key | Reissue the key in RAGFlow |
| `RAGFLOW_PROVIDER_UNAVAILABLE` | Provider row missing or its options invalid | Check `--dump-config` for the `ragflow-http` row |
| `RAGFLOW_PROVIDER_AMBIGUOUS` | Two usable providers registered | Pin one with the seam's `retrieveProvider` |
| `ragflow_retrieve` absent from the tool list | Bundle not loaded | `dsh --dump-config \| grep ragflow`; restart `dsh web` |
| Fewer chunks than expected | `vectorTopK` is not the result count | Raise `maxChunks` on the tool row |
| The page answers `NOT_LOOPBACK` | Reached over a LAN address | Open it from the host itself, or tunnel the port |
| The page answers `SETTINGS_CONFLICT` | The settings document moved since the page loaded | Reload the page and reapply |
| The API key field is read-only | A launch-environment `RAGFLOW_API_KEY` shadows the store | Change the variable and restart `dsh`, or unset it to manage the key from the page |
| No page at `/ragflow` | Surface without a web server, or the row is disabled | `dsh --dump-config \| grep ragflow-config` |

## Known limitations

- Retrieval only — no dataset or document management (create, upload, parse).
- The page is this plugin's own, not a card in DSH's **Settings → Plugins** tab: that tab renders
  only the settings namespaces the host api-proxy allowlists (`WEB_SETTINGS_NAMESPACES`), which a
  plugin distributed outside the harness repository cannot join without patching a released
  package. If that allowlist ever moves to `settings.register()`, these same namespaces become a
  card there with no change here.
- No streaming; the full response is awaited.
- The result renders as the generic search card, not a bespoke citation card.
- RAGFlow's `cross_languages`, `metadata_condition`, `highlight`, and `use_kg` options are not
  surfaced yet.
