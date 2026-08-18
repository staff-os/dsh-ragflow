import { defineConfig } from 'tsdown'

/**
 * Build runtime JS for the dsh-ragflow plugin.
 *
 * `@deepseek-ai/schemastery` is force-bundled via `deps.alwaysBundle`
 * because the DSH profile's node_modules may carry a source-only vendor
 * copy without `lib/index.mjs`; bundling avoids the runtime resolution
 * failure.
 *
 * The remaining `@deepseek-ai/*` packages are external (neverBundle):
 * they are provided by the DSH profile's bundle layer (dual-anchor +
 * flat-closure resolution) and must not be duplicated.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: 'esm',
  fixedExtension: false,
  dts: false,
  clean: true,
  deps: {
    alwaysBundle: ['@deepseek-ai/schemastery'],
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-invariants',
      '@deepseek-ai/dsh-launch-environment',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-tools',
    ],
  },
})
