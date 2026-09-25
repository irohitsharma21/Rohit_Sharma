import './styles/base.css'
import { Engine } from './engine/engine.js'

const engine = new Engine(document.getElementById('app'))
window.__engine = engine
engine.boot().catch((e) => {
  console.error('[boot] failed', e)
  document.documentElement.classList.add('boot-failed')
})
