/**
 * Single-file client + ESM host build for dsh-session-hub.
 *
 * The web server serves exactly one file per plugin (/plugins/dsh-session-hub/client.js),
 * so the client half is one CJS bundle wrapped in the ModuleLoader factory
 * handshake; @deepseek-ai/dsh-* and react stay external (the profile's healed
 * node_modules and the app's module system provide them). The host half is
 * plain ESM for Node, externalizing @deepseek-ai/dsh-* plus cordis while
 * bundling zod (the Loader validates Config against the schema).
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

// ssh2 stays external: it carries an optional native accelerator and loads
// crypto bindings dynamically, neither of which survives bundling. It is a
// real dependency, so the profile's install provides it.
const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-*', 'ssh2']

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  logLevel: 'info',
})

await build({
  entryPoints: ['src/invariant.ts'],
  outfile: 'lib/invariant.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  external: [...dshExternal, 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'dsh-session-hub', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// Resolve tsc through the local package (PATH-independent, cross-platform).
execFileSync(process.execPath, [require.resolve('typescript/lib/tsc.js'), '-p', 'tsconfig.json'], { stdio: 'inherit' })