import { defineConfig } from 'tsdown'

/**
 * Build runtime JS for the dsh-ragflow plugin: one entry per capability role,
 * matching the three rows in `cordis.patch.yml`.
 *
 * `@deepseek-ai/schemastery` is force-bundled via `deps.alwaysBundle` because a
 * DSH profile's node_modules may carry a source-only vendor copy without
 * `lib/index.mjs`; bundling avoids that runtime resolution failure.
 *
 * The remaining `@deepseek-ai/*` packages are external (neverBundle): the DSH
 * profile's bundle layer provides them, and a duplicate copy would break
 * `instanceof` checks and split the `ctx.ragflow` service registry.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/http.ts', 'src/tool.ts', 'src/config.ts'],
  outDir: 'lib',
  format: 'esm',
  fixedExtension: false,
  dts: false,
  clean: true,
  // `lib/` is committed, so shared-chunk names must be stable across rebuilds —
  // a content hash would churn the diff on every unrelated edit.
  hash: false,
  deps: {
    alwaysBundle: ['@deepseek-ai/schemastery'],
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-launch-environment',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-tools',
    ],
  },
})
