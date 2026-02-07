import { access, chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const scriptsDir = path.dirname(currentFile)
const projectRoot = path.resolve(scriptsDir, '..')
const distDir = path.join(projectRoot, 'dist')
const releaseRoot = path.join(projectRoot, 'release')

const pkgJsonPath = path.join(projectRoot, 'package.json')
const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
const version = pkgJson.version ?? '0.0.0'
const packageName = `hanafuda-v${version}`
const packageDir = path.join(releaseRoot, packageName)
const webDir = path.join(packageDir, 'web')

function toDistAssetPath(relativePath) {
  const cleaned = relativePath.replace(/^\.?\//, '')
  return path.join(distDir, cleaned)
}

async function buildStandaloneHtml() {
  let html = await readFile(path.join(distDir, 'index.html'), 'utf8')
  const inlineScripts = []

  const cssTags = [...html.matchAll(/<link[^>]*href="([^"]+\.css)"[^>]*>/g)]
  for (const match of cssTags) {
    const cssPath = match[1]
    const css = await readFile(toDistAssetPath(cssPath), 'utf8')
    html = html.replace(match[0], () => `<style>\n${css}\n</style>`)
  }

  const jsTags = [...html.matchAll(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/g)]
  for (const match of jsTags) {
    const jsPath = match[1]
    const js = await readFile(toDistAssetPath(jsPath), 'utf8')
    inlineScripts.push(js.replaceAll('</script', '<\\/script'))
    html = html.replace(match[0], '')
  }

  html = html.replace(/<link[^>]*href="[^"]*vite\.svg"[^>]*>\s*/g, '')
  if (inlineScripts.length > 0) {
    const scriptBlock = inlineScripts.map((js) => `<script type="module">\n${js}\n</script>`).join('\n')
    html = html.replace('</body>', () => `${scriptBlock}\n</body>`)
  }
  return html
}

try {
  await access(distDir)
} catch {
  throw new Error('dist が見つかりません。先に `npm run build` を実行してください。')
}

await rm(packageDir, { recursive: true, force: true })
await mkdir(packageDir, { recursive: true })
await cp(distDir, webDir, { recursive: true })

const packageReadme = `Hanafuda Portable Package (${version})

使い方:
1. このフォルダ全体を他PCへコピーします
2. まずは hanafuda-standalone.html をブラウザで開きます（推奨）
3. もし開けない場合は、同梱のローカルサーバースクリプトを実行します
   - macOS / Linux: ./start-local-server.sh
   - Windows(推奨): web フォルダで PowerShell を開き、py -3 -m http.server 4173 を実行
   - Windows(代替): start-local-server.bat (SmartScreen で警告される場合があります)
4. ブラウザで http://localhost:4173 を開きます

補足:
- Node.js は不要です
- 札画像は Wikimedia Commons から取得するため、インターネット接続は必要です
`

const startServerSh = `#!/usr/bin/env bash
set -eu
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR/web"
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server 4173
elif command -v python >/dev/null 2>&1; then
  python -m http.server 4173
else
  echo "Python が見つかりません。Python 3 をインストールしてください。"
  exit 1
fi
`

const startServerBat = `@echo off
cd /d %~dp0web
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 -m http.server 4173
  goto :eof
)
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -m http.server 4173
  goto :eof
)
echo Python が見つかりません。Python 3 をインストールしてください。
exit /b 1
`

await writeFile(path.join(packageDir, 'README-PORTABLE.txt'), packageReadme, 'utf8')
await writeFile(path.join(packageDir, 'start-local-server.sh'), startServerSh, 'utf8')
await writeFile(path.join(packageDir, 'start-local-server.bat'), startServerBat, 'utf8')
await writeFile(path.join(packageDir, 'hanafuda-standalone.html'), await buildStandaloneHtml(), 'utf8')
await chmod(path.join(packageDir, 'start-local-server.sh'), 0o755)

console.log(`Portable package created: ${path.relative(projectRoot, packageDir)}`)
