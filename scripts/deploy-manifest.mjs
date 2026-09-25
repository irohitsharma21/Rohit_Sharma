// Vercel source-deploy helper (for deploying through the Vercel MCP / REST API without the CLI).
//
//   node scripts/deploy-manifest.mjs                 # JSON manifest [{file, sha, size}] of every deployable source file
//   node scripts/deploy-manifest.mjs --files         # same, but in the exact shape create_deployment's `files` wants
//   node scripts/deploy-manifest.mjs --b64 <file>    # base64 body of one file (for upload_file)
//   node scripts/deploy-manifest.mjs --only a,b      # manifest restricted to the listed files (e.g. the "missing" list)
//   node scripts/deploy-manifest.mjs --diff old.json # only files whose sha changed vs a previous manifest
//   node scripts/deploy-manifest.mjs --check         # also verifies every file is valid UTF-8 text (non-zero exit if not)
//
// Upload is content-addressed by SHA1: unchanged files never need re-uploading. If create_deployment
// answers `missing_files`, upload exactly the listed shas and call it again.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT_FILES = ['index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'vercel.json']
const DIRS = ['public', 'src']
const SKIP = new Set(['node_modules', 'dist', 'shots', 'scripts', '.git', '.vercel'])
const TEXT = /\.(js|mjs|cjs|json|html|css|glsl|vert|frag|svg|txt|md)$/i

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

function entry(abs) {
  const buf = fs.readFileSync(abs)
  return {
    file: path.relative(root, abs).split(path.sep).join('/'),
    sha: crypto.createHash('sha1').update(buf).digest('hex'),
    size: buf.length,
  }
}

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }

if (flag('--b64')) {
  const f = val('--b64')
  process.stdout.write(fs.readFileSync(path.resolve(root, f)).toString('base64'))
  process.exit(0)
}

const abs = [
  ...ROOT_FILES.map((f) => path.join(root, f)).filter((p) => fs.existsSync(p)),
  ...DIRS.flatMap((d) => (fs.existsSync(path.join(root, d)) ? walk(path.join(root, d), []) : [])),
]
let manifest = abs.map(entry).sort((a, b) => a.file.localeCompare(b.file))

if (flag('--check')) {
  const dec = new TextDecoder('utf-8', { fatal: true })
  const bad = manifest.filter((m) => TEXT.test(m.file)).filter((m) => {
    try { dec.decode(fs.readFileSync(path.join(root, m.file))); return false } catch { return true }
  })
  if (bad.length) { console.error('not valid UTF-8:', bad.map((b) => b.file).join(', ')); process.exitCode = 1 }
}
if (val('--only')) {
  const want = new Set(val('--only').split(','))
  manifest = manifest.filter((m) => want.has(m.file) || want.has(m.sha))
}
if (val('--diff')) {
  const old = new Map(JSON.parse(fs.readFileSync(val('--diff'), 'utf8')).map((m) => [m.file, m.sha]))
  manifest = manifest.filter((m) => old.get(m.file) !== m.sha)
}

console.log(JSON.stringify(manifest, null, flag('--pretty') ? 2 : 0))
if (!flag('--quiet')) {
  const total = manifest.reduce((s, m) => s + m.size, 0)
  console.error(`${manifest.length} files, ${(total / 1024).toFixed(1)} KiB`)
}
