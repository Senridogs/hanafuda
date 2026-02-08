import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outFile = join(tmpdir(), 'hanafuda-ai-lab.mjs')

await build({
  entryPoints: ['scripts/ai-lab.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: outFile,
  sourcemap: false,
  logLevel: 'silent',
})

const mod = await import(pathToFileURL(outFile).href)
if (typeof mod.main !== 'function') {
  throw new Error('ai-lab entrypoint `main` not found')
}
mod.main(process.argv.slice(2))
