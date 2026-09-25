// Canvas faces for the holographic surfaces: action item, calendar, scheduled block and the minutes document.
// Dialogue, names and numbers here are ILLUSTRATIVE sample meeting data (the product's output format), not claims.
import { FONT_MONO, FONT_SANS, roundRect, track } from './parts.js'

const LINE = 'rgba(170,215,245,0.16)'
const LINE2 = 'rgba(170,215,245,0.3)'
const DIM = 'rgba(214,228,242,0.55)'
const WHITE = '#eef4fa'
const CYAN = '#62d8ff'

function glassPlate(x, W, H, r, a = 0.7) {
  const g = x.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgba(16,24,34,${a})`); g.addColorStop(1, `rgba(7,11,16,${a})`)
  x.fillStyle = g; roundRect(x, 2, 2, W - 4, H - 4, r); x.fill()
  x.strokeStyle = LINE2; x.lineWidth = 2; roundRect(x, 2, 2, W - 4, H - 4, r); x.stroke()
}

export function drawAction(x, W, H) {
  const u = H / 100
  glassPlate(x, W, H, 5 * u, 0.74)
  x.textBaseline = 'alphabetic'
  track(x, 0.2, 5 * u); x.font = `500 ${5 * u}px ${FONT_MONO}`; x.fillStyle = CYAN; x.fillText('ACTION ITEM', 8 * u, 16 * u)
  x.fillStyle = 'rgba(255,181,71,0.95)'; x.beginPath(); x.arc(W - 10 * u, 14.5 * u, 1.6 * u, 0, 7); x.fill()
  track(x, 0.12, 4 * u); x.font = `400 ${4.2 * u}px ${FONT_MONO}`; x.fillStyle = DIM; x.textAlign = 'right'; x.fillText('DETECTED', W - 14 * u, 16 * u); x.textAlign = 'left'
  x.fillStyle = LINE; x.fillRect(8 * u, 23 * u, W - 16 * u, 2)
  // checkbox + title
  x.strokeStyle = 'rgba(190,230,255,0.8)'; x.lineWidth = 0.7 * u; roundRect(x, 8 * u, 33 * u, 9 * u, 9 * u, 1.6 * u); x.stroke()
  track(x, 0, 1); x.font = `400 ${10 * u}px ${FONT_SANS}`; x.fillStyle = WHITE; x.fillText('Send the revised deck', 23 * u, 41.5 * u)
  const rows = [['OWNER', 'Priya'], ['DUE', 'Friday'], ['SOURCE', 'utterance 00:14:32']]
  rows.forEach(([k, v], i) => {
    const y = 60 * u + i * 12 * u
    track(x, 0.2, 4 * u); x.font = `500 ${4.2 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.4)'; x.fillText(k, 23 * u, y)
    track(x, 0.02, 6 * u); x.font = `400 ${6 * u}px ${FONT_SANS}`; x.fillStyle = 'rgba(234,240,246,0.86)'; x.fillText(v, 50 * u, y)
  })
}

/** Calendar layout in UV (top-left origin) so the scheduled block can dock into a slot. */
export const CAL = { gx: 0.13, gy: 0.2, gw: 0.84, gh: 0.76, cols: 5, rows: 8 }
export const calSlot = (col, row) => ({ u: CAL.gx + (col + 0.5) * CAL.gw / CAL.cols, v: CAL.gy + (row + 0.5) * CAL.gh / CAL.rows, w: CAL.gw / CAL.cols, h: CAL.gh / CAL.rows })

export function drawCalendar(x, W, H) {
  const u = H / 100
  x.clearRect(0, 0, W, H)
  x.fillStyle = 'rgba(8,13,19,0.42)'; roundRect(x, 2, 2, W - 4, H - 4, 3 * u); x.fill()
  x.strokeStyle = LINE2; x.lineWidth = 2; roundRect(x, 2, 2, W - 4, H - 4, 3 * u); x.stroke()
  x.textBaseline = 'alphabetic'
  track(x, 0.22, 3.4 * u); x.font = `500 ${3.4 * u}px ${FONT_MONO}`; x.fillStyle = CYAN; x.fillText('CALENDAR', 4 * u, 8 * u)
  x.fillStyle = DIM; x.textAlign = 'right'; x.fillText('WEEK VIEW', W - 4 * u, 8 * u); x.textAlign = 'left'
  const gx = CAL.gx * W, gy = CAL.gy * H, gw = CAL.gw * W, gh = CAL.gh * H, cw = gw / CAL.cols, rh = gh / CAL.rows
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI']
  track(x, 0.2, 3 * u); x.font = `500 ${3 * u}px ${FONT_MONO}`
  days.forEach((d, i) => { x.fillStyle = i === 4 ? WHITE : DIM; x.fillText(d, gx + i * cw + 1.5 * u, gy - 2.4 * u) })
  for (let r = 0; r < CAL.rows; r++) { x.fillStyle = 'rgba(214,228,242,0.36)'; x.fillText(`${String(9 + r).padStart(2, '0')}:00`, 3.6 * u, gy + r * rh + 3.6 * u) }
  x.strokeStyle = LINE; x.lineWidth = 1.5
  for (let i = 0; i <= CAL.cols; i++) { x.beginPath(); x.moveTo(gx + i * cw, gy); x.lineTo(gx + i * cw, gy + gh); x.stroke() }
  for (let r = 0; r <= CAL.rows; r++) { x.beginPath(); x.moveTo(gx, gy + r * rh); x.lineTo(gx + gw, gy + r * rh); x.stroke() }
  // existing (dim) events: context, not the point
  const ev = [[0, 0, 1, 'Standup'], [1, 4, 2, 'Focus'], [2, 1, 1, 'Standup'], [3, 5, 1, 'Design review'], [0, 6, 1.5, '1:1']]
  track(x, 0.02, 3 * u); x.font = `400 ${3 * u}px ${FONT_SANS}`
  ev.forEach(([c, r, len, t]) => {
    x.fillStyle = 'rgba(120,160,200,0.12)'; roundRect(x, gx + c * cw + 0.8 * u, gy + r * rh + 0.8 * u, cw - 1.6 * u, rh * len - 1.6 * u, 1.2 * u); x.fill()
    x.fillStyle = 'rgba(160,200,235,0.5)'; x.fillRect(gx + c * cw + 0.8 * u, gy + r * rh + 0.8 * u, 0.5 * u, rh * len - 1.6 * u)
    x.fillStyle = 'rgba(214,228,242,0.55)'; x.fillText(t, gx + c * cw + 2.4 * u, gy + r * rh + 4.6 * u)
  })
}

export function drawBlock(x, W, H) {
  const u = H / 100
  const g = x.createLinearGradient(0, 0, W, 0)
  g.addColorStop(0, 'rgba(45,125,255,0.62)'); g.addColorStop(1, 'rgba(98,216,255,0.42)')
  x.fillStyle = g; roundRect(x, 2, 2, W - 4, H - 4, 8 * u); x.fill()
  x.strokeStyle = 'rgba(210,240,255,0.9)'; x.lineWidth = 3; roundRect(x, 2, 2, W - 4, H - 4, 8 * u); x.stroke()
  x.fillStyle = '#eaf6ff'; x.fillRect(4, 8 * u, 5, H - 16 * u)
  x.textBaseline = 'alphabetic'
  track(x, 0.01, 24 * u); x.font = `500 ${22 * u}px ${FONT_SANS}`; x.fillStyle = '#ffffff'; x.fillText('Send revised deck', 12 * u, 42 * u)
  track(x, 0.14, 15 * u); x.font = `500 ${15 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(234,246,255,0.85)'; x.fillText('10:00 · PRIYA', 12 * u, 76 * u)
}

export function drawMinutes(x, W, H) {
  const u = W / 100
  glassPlate(x, W, H, 2.2 * u, 0.8)
  x.textBaseline = 'alphabetic'
  let y = 9 * u
  track(x, 0.24, 2.2 * u); x.font = `500 ${2.2 * u}px ${FONT_MONO}`; x.fillStyle = CYAN; x.fillText('MEETING MINUTES · AUTO-GENERATED', 7 * u, y)
  x.fillStyle = 'rgba(62,230,161,0.95)'; x.beginPath(); x.arc(W - 8 * u, y - 0.8 * u, 0.8 * u, 0, 7); x.fill()
  x.fillStyle = DIM; x.textAlign = 'right'; x.fillText('FINAL', W - 10.5 * u, y); x.textAlign = 'left'
  y += 9 * u
  track(x, -0.02, 6.4 * u); x.font = `300 ${6.4 * u}px ${FONT_SANS}`; x.fillStyle = WHITE; x.fillText('Q3 Launch Sync', 7 * u, y)
  y += 5 * u
  track(x, 0.14, 2 * u); x.font = `400 ${2 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.45)'; x.fillText('6 PARTICIPANTS · 32 MIN · SAMPLE MEETING', 7 * u, y)
  y += 4 * u; x.fillStyle = LINE; x.fillRect(7 * u, y, W - 14 * u, 2)

  const head = (t) => { y += 7.5 * u; track(x, 0.24, 2 * u); x.font = `500 ${2 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.5)'; x.fillText(t, 7 * u, y); y += 5 * u }
  head('SUMMARY')
  track(x, 0, 1); x.font = `300 ${3.1 * u}px ${FONT_SANS}`; x.fillStyle = 'rgba(234,240,246,0.9)'
  const sum = ['The team locked the Q3 launch scope and moved the', 'design review to Thursday. Spend stays inside the', 'current quarter; two backend hires remain open.']
  sum.forEach((l) => { x.fillText(l, 7 * u, y); y += 4.6 * u })

  head('ACTION ITEMS')
  const items = [['Send the revised deck', 'Priya', 'FRI', true], ['Run the design review', 'Marcus', 'THU', false], ['Open two backend roles', 'Lena', 'NEXT WK', false]]
  items.forEach(([t, who, due, sched]) => {
    x.strokeStyle = sched ? CYAN : 'rgba(190,220,245,0.55)'; x.lineWidth = 0.28 * u; roundRect(x, 7 * u, y - 2.7 * u, 3 * u, 3 * u, 0.6 * u); x.stroke()
    if (sched) { x.fillStyle = CYAN; x.fillRect(7.8 * u, y - 1.9 * u, 1.4 * u, 1.4 * u) }
    track(x, 0, 1); x.font = `400 ${3.1 * u}px ${FONT_SANS}`; x.fillStyle = WHITE; x.fillText(t, 12.5 * u, y)
    track(x, 0.12, 2 * u); x.font = `400 ${2 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.55)'
    x.fillText(`${who.toUpperCase()} · ${due}`, 58 * u, y)
    if (sched) { x.fillStyle = CYAN; x.textAlign = 'right'; x.fillText('SCHEDULED', W - 7 * u, y); x.textAlign = 'left' }
    y += 6.4 * u
  })

  head('SENTIMENT')
  const s = [[0.62, '#62d8ff', 'POSITIVE'], [0.29, 'rgba(190,210,230,0.55)', 'NEUTRAL'], [0.09, 'rgba(255,181,71,0.85)', 'CONCERN']]
  let sx = 7 * u; const bw = W - 14 * u
  s.forEach(([f, c]) => { x.fillStyle = c; x.fillRect(sx, y - 1.6 * u, bw * f - 0.6 * u, 1.3 * u); sx += bw * f })
  y += 4.6 * u; sx = 7 * u
  track(x, 0.14, 1.9 * u); x.font = `400 ${1.9 * u}px ${FONT_MONO}`
  s.forEach(([f, c, t]) => { x.fillStyle = 'rgba(214,228,242,0.55)'; x.fillText(`${t} ${Math.round(f * 100)}%`, sx, y); sx += bw * f })

  head('TOPICS')
  const topics = ['LAUNCH', 'DESIGN', 'DELIVERABLES', 'BUDGET', 'HIRING']
  sx = 7 * u; track(x, 0.16, 2 * u); x.font = `500 ${2 * u}px ${FONT_MONO}`
  topics.forEach((t) => {
    const w = x.measureText(t).width + 3.4 * u
    x.strokeStyle = 'rgba(170,215,245,0.3)'; x.lineWidth = 2; roundRect(x, sx, y - 3.2 * u, w, 4.6 * u, 2.3 * u); x.stroke()
    x.fillStyle = 'rgba(234,240,246,0.8)'; x.fillText(t, sx + 1.7 * u, y); sx += w + 1.6 * u
  })
  // footer
  y = H - 5 * u
  x.fillStyle = LINE; x.fillRect(7 * u, y - 5 * u, W - 14 * u, 2)
  track(x, 0.2, 1.9 * u); x.font = `400 ${1.9 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.45)'
  x.fillText('STORED · MONGODB', 7 * u, y); x.textAlign = 'right'; x.fillText('SEARCHABLE · QDRANT', W - 7 * u, y); x.textAlign = 'left'
}

// ---------------------------------------------------------------- latest capabilities
/** The uploaded briefing document (a slide deck), shown as a small holographic slab. */
export function drawBriefDoc(formats) {
  return (x, W, H) => {
    const u = W / 100
    glassPlate(x, W, H, 4 * u, 0.72)
    x.textBaseline = 'alphabetic'
    track(x, 0.22, 4.4 * u); x.font = `500 ${4.4 * u}px ${FONT_MONO}`; x.fillStyle = CYAN; x.fillText('BRIEFING DOC', 8 * u, 12 * u)
    track(x, 0, 1); x.font = `400 ${7.4 * u}px ${FONT_SANS}`; x.fillStyle = WHITE; x.fillText('q3_launch_deck.pptx', 8 * u, 24 * u)
    track(x, 0.14, 3.8 * u); x.font = `400 ${3.8 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.5)'; x.fillText('UPLOADED · PRIYA', 8 * u, 32 * u)
    // slide thumbnails
    for (let i = 0; i < 6; i++) {
      const cx = 8 * u + (i % 3) * 29 * u, cy = 39 * u + Math.floor(i / 3) * 21 * u
      x.strokeStyle = i === 2 ? 'rgba(98,216,255,0.9)' : 'rgba(170,215,245,0.25)'; x.lineWidth = i === 2 ? 3 : 2
      roundRect(x, cx, cy, 26 * u, 17 * u, 1.5 * u); x.stroke()
      x.fillStyle = i === 2 ? 'rgba(98,216,255,0.5)' : 'rgba(170,215,245,0.18)'
      x.fillRect(cx + 3 * u, cy + 4 * u, 14 * u, 1.6 * u); x.fillRect(cx + 3 * u, cy + 8 * u, 19 * u, 1.2 * u); x.fillRect(cx + 3 * u, cy + 11 * u, 12 * u, 1.2 * u)
      track(x, 0.1, 2.8 * u); x.font = `400 ${2.8 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.4)'; x.fillText(String(i + 1), cx + 22 * u, cy + 15 * u)
    }
    let sx = 8 * u
    track(x, 0.14, 3.4 * u); x.font = `500 ${3.4 * u}px ${FONT_MONO}`
    formats.forEach((f) => {
      const w = x.measureText(f).width + 4 * u
      x.strokeStyle = 'rgba(170,215,245,0.3)'; x.lineWidth = 2; roundRect(x, sx, H - 14 * u, w, 7 * u, 3.5 * u); x.stroke()
      x.fillStyle = 'rgba(234,240,246,0.75)'; x.fillText(f, sx + 2 * u, H - 9 * u); sx += w + 2 * u
    })
  }
}

/** Private briefing cue: only the uploader sees it. */
export function drawCue(ex) {
  return (x, W, H) => {
    const u = H / 100
    glassPlate(x, W, H, 6 * u, 0.8)
    x.textBaseline = 'alphabetic'
    track(x, 0.22, 6 * u); x.font = `500 ${6 * u}px ${FONT_MONO}`; x.fillStyle = CYAN; x.fillText('BRIEFING CUE', 7 * u, 16 * u)
    x.fillStyle = 'rgba(214,228,242,0.5)'; x.textAlign = 'right'; x.fillText('PRIVATE', W - 7 * u, 16 * u); x.textAlign = 'left'
    x.fillStyle = LINE; x.fillRect(7 * u, 22 * u, W - 14 * u, 2)
    track(x, -0.01, 16 * u); x.font = `400 ${15 * u}px ${FONT_SANS}`; x.fillStyle = WHITE; x.fillText(ex.answer.charAt(0).toUpperCase() + ex.answer.slice(1), 7 * u, 46 * u)
    track(x, 0.16, 5.6 * u); x.font = `500 ${5.6 * u}px ${FONT_MONO}`
    const src = `SOURCE · ${ex.source.toUpperCase()}`
    const w = x.measureText(src).width + 6 * u
    x.strokeStyle = 'rgba(98,216,255,0.6)'; x.lineWidth = 2; roundRect(x, 7 * u, 54 * u, w, 10 * u, 5 * u); x.stroke()
    x.fillStyle = CYAN; x.fillText(src, 10 * u, 61.5 * u)
    // typed question field
    x.fillStyle = 'rgba(170,215,245,0.08)'; roundRect(x, 7 * u, 74 * u, W - 14 * u, 16 * u, 3 * u); x.fill()
    x.strokeStyle = 'rgba(170,215,245,0.2)'; roundRect(x, 7 * u, 74 * u, W - 14 * u, 16 * u, 3 * u); x.stroke()
    track(x, 0, 1); x.font = `300 ${6.4 * u}px ${FONT_SANS}`; x.fillStyle = 'rgba(214,228,242,0.45)'; x.fillText('Type a question to your documents…', 11 * u, 84.5 * u)
  }
}

/** Per-tool permission switch: ASK FIRST | JUST DO IT. The knob is a separate mesh. */
export function drawSwitch(tool, modes) {
  return (x, W, H) => {
    const u = H / 100
    x.textBaseline = 'alphabetic'
    track(x, 0.2, 13 * u); x.font = `500 ${13 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.6)'; x.fillText(tool.toUpperCase(), 3 * u, 22 * u)
    x.fillStyle = 'rgba(12,19,27,0.75)'; roundRect(x, 2, 34 * u, W - 4, 60 * u, 30 * u); x.fill()
    x.strokeStyle = LINE2; x.lineWidth = 2; roundRect(x, 2, 34 * u, W - 4, 60 * u, 30 * u); x.stroke()
    track(x, 0.18, 15 * u); x.font = `500 ${15 * u}px ${FONT_MONO}`; x.textAlign = 'center'
    x.fillStyle = 'rgba(214,228,242,0.7)'
    x.fillText(modes[0], W * 0.25, 70 * u); x.fillText(modes[1], W * 0.75, 70 * u); x.textAlign = 'left'
  }
}

/** The contact card the agent emails. Values are placeholders (bars), never real data. */
export function drawContact(x, W, H) {
  const u = H / 100
  glassPlate(x, W, H, 6 * u, 0.82)
  x.textBaseline = 'alphabetic'
  track(x, 0.22, 6 * u); x.font = `500 ${6 * u}px ${FONT_MONO}`; x.fillStyle = CYAN; x.fillText('CONTACT CARD', 7 * u, 16 * u)
  x.fillStyle = 'rgba(214,228,242,0.5)'; x.textAlign = 'right'; x.fillText('EMAIL', W - 7 * u, 16 * u); x.textAlign = 'left'
  x.strokeStyle = 'rgba(190,230,255,0.55)'; x.lineWidth = 2; x.beginPath(); x.arc(17 * u, 42 * u, 9 * u, 0, 7); x.stroke()
  track(x, 0, 1); x.font = `400 ${12 * u}px ${FONT_SANS}`; x.fillStyle = WHITE; x.fillText('Lena', 32 * u, 46 * u)
  const rows = ['EMAIL', 'PHONE', 'LINKEDIN']
  rows.forEach((r, i) => {
    const y = 66 * u + i * 10 * u
    track(x, 0.18, 4.6 * u); x.font = `500 ${4.6 * u}px ${FONT_MONO}`; x.fillStyle = 'rgba(214,228,242,0.4)'; x.fillText(r, 7 * u, y)
    x.fillStyle = 'rgba(170,215,245,0.22)'; roundRect(x, 34 * u, y - 4 * u, (38 - i * 6) * u, 4 * u, 2 * u); x.fill()
  })
}
