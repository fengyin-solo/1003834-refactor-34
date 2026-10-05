// 用项目自带 esbuild 把 TS 冒烟入口打成临时 ESM，再交由 node 执行。
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(root, 'scripts/smoke-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(root, 'scripts/smoke-bundle.mjs'),
  alias: { '@': path.join(root, 'src') },
  logLevel: 'silent',
})

const result = spawnSync(process.execPath, [path.join(root, 'scripts/smoke-conservation.mjs')], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
