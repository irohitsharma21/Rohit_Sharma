// Screenshot harness for visual QA of individual worlds.
//
//   node scripts/shot.mjs --w voice --p 0,0.3,0.6,1           # several scroll positions in one run
//   node scripts/shot.mjs --w siren --p 1 --k 0.5             # mid-flight to the next world
//   node scripts/shot.mjs --w skills --p 0.5 --mx 0.2 --my 0.1 # pointer at NDC (x,y) to test hover
//   node scripts/shot.mjs --w hero --only hero                 # load a single world (faster, isolated)
//   --size 1440x900   --wait 1200 (ms after each jump)   --url http://127.0.0.1:5199   --mobile
//
// Writes shots/<w>-<p>[-k<k>].png and prints any console errors / page errors.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
  return acc
}, []))
const w = args.w || 'hero'
const ps = String(args.p ?? '0').split(',').map(Number)
const k = args.k ? Number(args.k) : 0
const [W, H] = (args.size || (args.mobile ? '390x844' : '1440x900')).split('x').map(Number)
const wait = Number(args.wait || 1400)
const base = args.url || 'http://127.0.0.1:5199'
const outDir = path.resolve('shots')
fs.mkdirSync(outDir, { recursive: true })

const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p))

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`, '--hide-scrollbars'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1, isMobile: !!args.mobile, hasTouch: !!args.mobile },
})
const errors = []
try {
  const page = await browser.newPage()
  page.on('console', (m) => { if (['error', 'warning', 'warn'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`) })
  // Serve Vite's HMR client with full-page reloads disabled, so other agents' saves can't kill a run.
  let viteClient = null
  try { const res = await fetch(base + '/@vite/client'); if (res.ok) viteClient = (await res.text()).replaceAll('location.reload()', 'void 0') } catch {}
  if (viteClient) {
    await page.setRequestInterception(true)
    page.on('request', (r) => r.url().endsWith('/@vite/client') ? r.respond({ status: 200, contentType: 'application/javascript', body: viteClient }) : r.continue())
  }
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  const q = new URLSearchParams({ w, p: String(ps[0]), ...(k ? { k: String(k) } : {}), ...(args.only ? { only: args.only } : {}), ...(args.q ? { q: args.q } : {}) })
  await page.goto(`${base}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction('window.__ready === true', { timeout: 90000 })
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' })
  console.log(`gpu: ${gpu}`)
  if (args.mx != null) {
    const mx = (Number(args.mx) + 1) / 2 * W, my = (1 - Number(args.my ?? 0)) / 2 * H
    await page.mouse.move(W / 2, H / 2)
    await page.mouse.move(mx, my, { steps: 12 })
  }
  for (const p of ps) {
    await page.evaluate((w, p, k) => window.__engine.goTo(w, p, true, k), w, p, k)
    await new Promise((r) => setTimeout(r, wait))
    const fps = await page.evaluate(() => window.__engine.hud?.frameMs?.toFixed(1))
    const file = path.join(outDir, `${w}-${p}${k ? `-k${k}` : ''}${args.mobile ? '-m' : ''}${args.size ? '-' + args.size : ''}.png`)
    await page.screenshot({ path: file })
    console.log(`shot: ${file}  (frame ${fps} ms)`)
  }
} finally {
  await browser.close()
  if (errors.length) console.log('--- console errors/warnings ---\n' + [...new Set(errors)].slice(0, 30).join('\n'))
  else console.log('no console errors')
}
