// Canvas-drawn UI for the Command Runbook world: a terminal pane and the Runbook side panel.
// Everything is drawn from a plain state object, so the 3D panes are a pure function of scroll.

const MONO = '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace'
const SANS = '"Geist", "Inter", system-ui, sans-serif'
const C = {
  bg: 'rgba(7, 10, 14, 0.86)', bgTop: 'rgba(16, 22, 30, 0.9)', line: 'rgba(190, 215, 240, 0.12)', lineStrong: 'rgba(190, 215, 240, 0.22)',
  white: '#eaf0f6', dim: 'rgba(220, 232, 244, 0.55)', faint: 'rgba(220, 232, 244, 0.28)', smoke: '#6b7684',
  cyan: '#62d8ff', blue: '#2d7dff', green: '#3ee6a1', amber: '#ffb547',
}

export const CMD = 'docker compose up --build -d'
export const DESC = 'Rebuild and start all services in the background'
export const SAVED = [
  { cmd: 'git log --oneline -n 20', desc: 'Show the last 20 commits, one per line' },
  { cmd: 'docker compose logs -f api', desc: 'Follow live logs from the api service' },
  { cmd: 'uvicorn app.main:app --reload', desc: 'Start the FastAPI dev server with auto-reload' },
  { cmd: 'docker compose up -d redis mongo', desc: 'Start only the data services' },
  { cmd: 'pytest -q -k stream', desc: 'Run the streaming tests quietly' },
]
export const OUTPUT = [
  ['dim', '[+] Building 14.2s (18/18) FINISHED'],
  ['faint', ' => [api internal] load build definition'],
  ['faint', ' => [api 4/6] RUN pip install -r requirements.txt'],
  ['faint', ' => [web 3/5] RUN npm ci'],
  ['faint', ' => exporting to image'],
  ['dim', '[+] Running 4/4'],
  ['ok', 'Network app_default      Created'],
  ['ok', 'Container redis          Started'],
  ['ok', 'Container api            Started'],
  ['ok', 'Container web            Started'],
]

function check(g, x, y, s, color, w = 3) {
  g.save(); g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath(); g.moveTo(x, y + s * 0.55); g.lineTo(x + s * 0.38, y + s * 0.9); g.lineTo(x + s, y + s * 0.1); g.stroke(); g.restore()
}

function frame(g, W, H, title, right) {
  g.clearRect(0, 0, W, H)
  const r = 26
  g.save()
  g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, r); g.clip()
  const grd = g.createLinearGradient(0, 0, 0, H)
  grd.addColorStop(0, C.bgTop); grd.addColorStop(0.18, C.bg); grd.addColorStop(1, C.bg)
  g.fillStyle = grd; g.fillRect(0, 0, W, H)
  // title bar
  g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(0, 0, W, 66)
  g.fillStyle = C.line; g.fillRect(0, 66, W, 2)
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(36 + i * 24, 33, 6.5, 0, Math.PI * 2); g.fillStyle = 'rgba(190,215,240,0.16)'; g.fill() }
  g.font = `500 21px ${MONO}`; g.letterSpacing = '3px'; g.fillStyle = C.dim; g.textBaseline = 'middle'
  g.fillText(title, 124, 34)
  if (right) { g.textAlign = 'right'; g.fillStyle = C.faint; g.fillText(right, W - 32, 34); g.textAlign = 'left' }
  g.restore()
  g.strokeStyle = C.lineStrong; g.lineWidth = 2
  g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, r); g.stroke()
  g.letterSpacing = '0px'
}

/**
 * Terminal: s = { typed, enter, saved, runCmd, out, done, cursor }
 */
export function drawTerminal(g, W, H, s) {
  frame(g, W, H, 'ZSH  ·  ~/meetai', 'TERMINAL')
  const x0 = 48, lh = 50
  let y = 118
  g.textBaseline = 'alphabetic'
  const prompt = (yy) => {
    g.font = `500 30px ${MONO}`; g.fillStyle = C.cyan; g.fillText('~/meetai', x0, yy)
    g.fillStyle = C.faint; g.fillText('$', x0 + g.measureText('~/meetai ').width, yy)
    return x0 + g.measureText('~/meetai $ ').width
  }
  // history (quiet)
  g.font = `400 26px ${MONO}`; g.fillStyle = C.faint
  g.fillText('# pulled main · 3 files changed', x0, y); y += lh
  // the command being typed / run
  let px = prompt(y)
  g.font = `500 30px ${MONO}`; g.fillStyle = C.white
  const text = s.runCmd ? CMD : CMD.slice(0, s.typed)
  g.fillText(text, px, y)
  const cw = g.measureText(text).width
  if (!s.enter && s.cursor) { g.fillStyle = C.cyan; g.fillRect(px + cw + 4, y - 26, 15, 32) }
  y += lh
  if (s.saved > 0) {
    g.globalAlpha = Math.min(1, s.saved)
    g.font = `400 24px ${MONO}`; g.fillStyle = C.blue
    g.fillText('↳ saved to Runbook', x0 + 28, y - 6)
    g.fillStyle = C.faint; g.fillText('· description written automatically', x0 + 28 + g.measureText('↳ saved to Runbook ').width, y - 6)
    g.globalAlpha = 1
    y += lh - 6
  }
  // output stream
  if (s.out > 0) {
    y += 6
    const n = Math.min(OUTPUT.length, Math.floor(s.out))
    for (let i = 0; i < n; i++) {
      const [k, t] = OUTPUT[i]
      g.font = `400 25px ${MONO}`
      if (k === 'ok') { check(g, x0 + 4, y - 20, 20, C.green, 3); g.fillStyle = C.dim; g.fillText(t, x0 + 40, y) }
      else { g.fillStyle = k === 'dim' ? C.dim : C.faint; g.fillText(t, x0, y) }
      y += 40
    }
  }
  if (s.done > 0) {
    g.globalAlpha = Math.min(1, s.done)
    y += 14
    g.strokeStyle = 'rgba(62,230,161,0.35)'; g.lineWidth = 2
    g.beginPath(); g.roundRect(x0, y - 36, 470, 56, 12); g.stroke()
    g.fillStyle = 'rgba(62,230,161,0.08)'; g.fill()
    check(g, x0 + 20, y - 22, 26, C.green, 4)
    g.font = `500 26px ${MONO}`; g.fillStyle = C.green; g.fillText('done · 4 services up', x0 + 66, y + 1)
    g.globalAlpha = 1
    y += 64
    const px2 = prompt(y)
    if (s.cursor) { g.fillStyle = C.cyan; g.fillRect(px2 + 4, y - 26, 15, 32) }
  }
}

/**
 * Runbook side panel: s = { insert (0..1), desc (chars), query (string), filter (0..1 per item via fn), selected, play, cursor }
 */
export function drawPanel(g, W, H, s) {
  frame(g, W, H, 'COMMAND RUNBOOK', '')
  const x0 = 34
  let y = 104
  // search field
  g.save()
  g.strokeStyle = s.query ? 'rgba(98,216,255,0.55)' : C.lineStrong; g.lineWidth = 2
  g.fillStyle = 'rgba(255,255,255,0.03)'
  g.beginPath(); g.roundRect(x0, y, W - x0 * 2, 62, 14); g.fill(); g.stroke()
  g.strokeStyle = s.query ? C.cyan : C.smoke; g.lineWidth = 2.5
  g.beginPath(); g.arc(x0 + 32, y + 29, 10, 0, Math.PI * 2); g.stroke()
  g.beginPath(); g.moveTo(x0 + 39, y + 36); g.lineTo(x0 + 47, y + 44); g.stroke()
  g.font = `400 25px ${MONO}`; g.textBaseline = 'middle'
  if (s.query) {
    g.fillStyle = C.white; g.fillText(s.query, x0 + 64, y + 32)
    if (s.cursor && s.typingQuery) { const w = g.measureText(s.query).width; g.fillStyle = C.cyan; g.fillRect(x0 + 66 + w, y + 18, 3, 28) }
  } else { g.fillStyle = C.faint; g.fillText('Search commands…', x0 + 64, y + 32) }
  g.restore()
  y += 96
  g.font = `500 17px ${MONO}`; g.letterSpacing = '3px'; g.fillStyle = C.smoke; g.textBaseline = 'alphabetic'
  g.fillText(s.query ? `RESULTS · ${s.matches}` : `SAVED · ${SAVED.length + (s.insert > 0.5 ? 1 : 0)}`, x0, y)
  g.letterSpacing = '0px'
  y += 22

  const items = []
  if (s.insert > 0) items.push({ cmd: CMD, desc: DESC.slice(0, s.desc), fresh: true, full: s.desc >= DESC.length })
  for (const it of SAVED) items.push({ ...it, full: true })
  const itemH = 118
  let yy = y
  items.forEach((it, i) => {
    const v = s.visible(it, i) // { a: opacity, h: height factor }
    const ins = it.fresh ? smoothIn(s.insert) : 1
    const hf = v.h * ins
    if (v.a <= 0.001 || hf <= 0.001) { yy += itemH * hf; return }
    const top = yy - (it.fresh ? (1 - ins) * 24 : 0)
    g.save()
    g.beginPath(); g.rect(0, yy - 2, W, itemH * hf + 2); g.clip()
    g.globalAlpha = v.a * ins
    const sel = it.fresh && s.selected > 0
    if (sel || (it.fresh && s.insert < 1)) {
      const a = sel ? s.selected : (1 - s.insert) * 0.8 + 0.2
      g.fillStyle = `rgba(45,125,255,${0.13 * a})`
      g.beginPath(); g.roundRect(x0 - 12, top + 4, W - x0 * 2 + 24, itemH - 12, 12); g.fill()
      g.fillStyle = `rgba(98,216,255,${0.9 * a})`; g.fillRect(x0 - 12, top + 18, 4, itemH - 40)
    }
    // command
    g.font = `500 25px ${MONO}`; g.fillStyle = C.white
    g.fillText(fit(g, it.cmd, W - x0 * 2 - 70), x0 + 6, top + 48)
    // description
    g.font = `400 21px ${SANS}`
    g.fillStyle = it.fresh ? (it.full ? C.dim : 'rgba(98,216,255,0.9)') : C.faint
    const d = it.desc
    g.fillText(fit(g, d, W - x0 * 2 - 70), x0 + 6, top + 84)
    if (it.fresh && !it.full && s.desc > 0 && s.cursor) { const w = g.measureText(d).width; g.fillStyle = C.cyan; g.fillRect(x0 + 8 + w, top + 66, 3, 24) }
    if (it.fresh && s.desc > 0) {
      g.font = `500 14px ${MONO}`; g.letterSpacing = '2px'
      const tagT = it.full ? 'AUTO' : 'WRITING'
      const tw = g.measureText(tagT).width
      g.strokeStyle = 'rgba(98,216,255,0.5)'; g.lineWidth = 1.5
      g.beginPath(); g.roundRect(W - x0 - tw - 28, top + 24, tw + 22, 30, 8); g.stroke()
      g.fillStyle = C.cyan; g.fillText(tagT, W - x0 - tw - 16, top + 45)
      g.letterSpacing = '0px'
    }
    // play button
    const bx = W - x0 - 22, by = top + 82
    const pr = it.fresh && s.play > 0 ? s.play : 0
    g.beginPath(); g.arc(bx, by, 17, 0, Math.PI * 2)
    g.fillStyle = pr > 0 ? `rgba(62,230,161,${0.15 + 0.25 * pr})` : 'rgba(255,255,255,0.04)'; g.fill()
    g.strokeStyle = pr > 0 ? C.green : C.lineStrong; g.lineWidth = 1.5; g.stroke()
    g.fillStyle = pr > 0 ? C.green : C.dim
    g.beginPath(); g.moveTo(bx - 5, by - 8); g.lineTo(bx + 8, by); g.lineTo(bx - 5, by + 8); g.closePath(); g.fill()
    // divider
    g.fillStyle = C.line; g.fillRect(x0, top + itemH - 2, W - x0 * 2, 1.5)
    g.restore()
    yy += itemH * hf
  })
  // details for the selected command (fills the space the filtered list leaves behind)
  if (s.details > 0.001) {
    g.save(); g.globalAlpha = s.details
    let dy = yy + 44 + (1 - s.details) * 16
    g.font = `500 17px ${MONO}`; g.letterSpacing = '3px'; g.fillStyle = C.smoke
    g.fillText('DETAILS', x0, dy); g.letterSpacing = '0px'
    dy += 22
    g.fillStyle = C.line; g.fillRect(x0, dy, W - x0 * 2, 1.5)
    dy += 46
    const rows = [['cwd', '~/meetai'], ['source', 'terminal · auto-saved'], ['services', 'api · web · redis'], ['runs in', 'integrated terminal']]
    for (const [k, v] of rows) {
      g.font = `400 20px ${MONO}`; g.fillStyle = C.faint; g.fillText(k, x0 + 6, dy)
      g.font = `400 21px ${MONO}`; g.fillStyle = C.dim; g.fillText(v, x0 + 170, dy)
      dy += 42
    }
    dy += 14
    const pr = s.play
    g.beginPath(); g.roundRect(x0, dy, W - x0 * 2, 64, 14)
    g.fillStyle = pr > 0 ? `rgba(62,230,161,${0.08 + 0.14 * pr})` : 'rgba(45,125,255,0.10)'; g.fill()
    g.strokeStyle = pr > 0 ? 'rgba(62,230,161,0.7)' : 'rgba(98,216,255,0.45)'; g.lineWidth = 2; g.stroke()
    g.fillStyle = pr > 0 ? C.green : C.cyan
    const bx = x0 + 40, by = dy + 32
    g.beginPath(); g.moveTo(bx - 6, by - 10); g.lineTo(bx + 10, by); g.lineTo(bx - 6, by + 10); g.closePath(); g.fill()
    g.font = `500 22px ${MONO}`; g.letterSpacing = '2px'; g.textBaseline = 'middle'
    g.fillText(pr > 0.5 ? 'RUNNING IN TERMINAL' : 'RUN IN TERMINAL', x0 + 72, by + 1)
    g.letterSpacing = '0px'; g.textBaseline = 'alphabetic'
    g.restore()
  }
  // footer
  g.font = `500 16px ${MONO}`; g.letterSpacing = '3px'; g.fillStyle = C.faint
  g.fillText('VS CODE · OPEN SOURCE · MIT', x0, H - 34)
  g.letterSpacing = '0px'
}

function smoothIn(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t) }
function fit(g, t, w) {
  if (g.measureText(t).width <= w) return t
  while (t.length > 3 && g.measureText(t + '…').width > w) t = t.slice(0, -1)
  return t + '…'
}
