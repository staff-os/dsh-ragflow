# dsh-ragflow

English | [中文](README.zh.md)

RAGFlow knowledge-base retrieval plugin for the DeepSeek Harness. It gives the agent a `ragflow_retrieve` tool to query connected RAGFlow datasets for relevant document chunks with similarity scores.

## Structure

This single package combines all three capability-seam roles:

| Role | Component | Responsibility |
|---|---|---|
| Service Definition | `RagflowRuntime` (`src/runtime.ts`) | `ctx.ragflow` provider registry, selection semantics, result caps |
| Service Provider | `RagflowProvider` (`src/provider.ts`) | Calls RAGFlow HTTP API `POST /api/v1/retrieval` |
| Consumer / Tool | `ragflow_retrieve` (`src/tool.ts`) | Model-facing tool: schema, prompt guidance, formatting |

## Prerequisites

1. **Run a RAGFlow instance**: self-hosted or cloud. Default connects to `http://localhost:9380`; override through `RAGFLOW_BASE_URL`.
2. **Acquire an API key**: create an API key in RAGFlow and supply it through `RAGFLOW_API_KEY` or the DSH credentials service.
3. **Create a dataset**: create at least one dataset in RAGFlow and upload and parse documents.
4. **(Optional) Specify datasets**: set `RAGFLOW_DATASET_IDS` (comma-separated).

## Install

DSH supports two plugin installation paths. Choose based on your scenario.

### Path A — Bundle plugin (recommended for standalone repo)

When this plugin lives in its own git repository (with `lib/` built and committed, or a build script available), install it into a running DSH profile with one command:

```sh
dsh plugin --profile web add "github:staff-os/dsh-ragflow#main"
```

`dsh plugin add` forwards the source to `pnpm` as-is, so any pnpm-recognized source works: git URLs, `link:` for local development, etc.

```sh
# Local directory (development)
dsh plugin --profile web add link:/path/to/dsh-ragflow
```

After installation, **restart `dsh web`** for the bundle to take effect. Verify the composition tree:

```sh
dsh web --dump-config | grep ragflow
```

### Path B — Manual patch overlay (for in-workspace development)

If you are working inside the `deepseek-harness` monorepo, the workspace `examples/package.json` already declares `@deepseek-ai/dsh-ragflow` as a workspace dependency. Run `pnpm install` to link it, then pass the overlay at launch:

```sh
dsh web --patch examples/dsh-ragflow/cordis.patch.yml
```

To persist across runs, merge the `insert` entries into `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: ragflow
      name: '@deepseek-ai/dsh-ragflow'
      config:
        baseURL: http://your-ragflow-host:9380
        topK: 10
        similarityThreshold: 0.2
```

### Build (standalone repo only)

If `lib/` is not committed, build before install:

```sh
pnpm install
pnpm build    # tsdown → lib/index.js + .d.ts
```

The `package.json` `dsh.bundle.patch` field points the DSH plugin loader to `cordis.patch.yml`.

## Credentials

Supply the RAGFlow API key through one of these channels (in priority order):

| Method | Where | Notes |
|---|---|---|
| DSH credentials service | `~/.dsh/.credentials.yaml` | Managed, atomic 0600 permissions |
| Environment variable | `RAGFLOW_API_KEY` in `.env` or shell | Process env > cwd `.env` > `~/.dsh/.env` |

```sh
# Option 1: ~/.dsh/.credentials.yaml
ragflow-api-key: ragflow-xxx

# Option 2: shell export or .env
export RAGFLOW_API_KEY=ragflow-xxx
export RAGFLOW_BASE_URL=http://your-ragflow-host:9380   # optional
export RAGFLOW_DATASET_IDS=dataset_id_1,dataset_id_2    # optional
```

## Configuration

| Config | Default | Description |
|---|---|---|
| `apiKey` | — | RAGFlow API key (prefer `apiKeyEnv`) |
| `apiKeyEnv` | `RAGFLOW_API_KEY` | Credential reference name |
| `baseURL` | `http://localhost:9380` | RAGFlow API endpoint base |
| `datasetIds` | — | Default dataset IDs to search |
| `topK` | `10` | Provider-level chunk limit |
| `similarityThreshold` | `0.2` | Chunks below this similarity are filtered |
| `retrieveTopK` | `10` | Tool-level chunk upper bound |
| `retrieveTimeoutMs` | `30000` | Cooperative timeout (ms) |

`config` in `cordis.patch.yml` is **whole-object replacement**, not deep merge. Always specify all fields you need.

## Verify

```sh
# Check the plugin is loaded in the composition tree
dsh web --dump-config | grep ragflow

# In the Web UI: Settings → Plugins → look for "ragflow"
```

The `ragflow_retrieve` tool appears in the model's tool list once the plugin is active.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ragflow_retrieve` not in tool list | Bundle not built or not loaded | Run `pnpm build`; restart `dsh web` |
| Bare `cordis`/`schemastery` resolve error | Closure only has `@deepseek-ai/*` packages | Ensure imports use `@deepseek-ai/schemastery` |
| Patch applied but no effect | `name` mismatch → silent skip | Verify `name: '@deepseek-ai/dsh-ragflow'` in patch |
| API key not found | Credential reference mismatch | Check `apiKeyEnv` matches the credential key |
| Uninstall leaves patch residue | `dsh plugin remove` does not rewrite patch layer | Manually delete the `insert` block from `cordis.patch.yml` |

## Retrieval flow

1. The model calls `ragflow_retrieve` with a `question`.
2. The tool delegates to `ctx.ragflow.retrieve()`.
3. The provider sends `POST /api/v1/retrieval` to RAGFlow.
4. Response chunks are normalized with content, document source, and similarity.
5. The result returns to the model as formatted text with structured metadata.

## Known Limitations and Deferred Work

- No streaming retrieval; the full response is awaited before returning.
- No dataset management (create/delete/upload); retrieval only.
- No UI presentation card beyond the generic search card.
