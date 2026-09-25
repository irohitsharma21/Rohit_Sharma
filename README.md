# Rohit Sharma · AI Engineer

**The Machine Behind Intelligence**: a cinematic, real-time 3D portfolio. The visitor doesn't scroll a page; they travel through the infrastructure of an AI system, one physical environment per project.

Built with Three.js (WebGL 2), vanilla JavaScript and Vite. No frameworks, no 3D model files, no audio files: every scene, shader and sound is generated in code.

## The journey

| # | World | What it shows |
|---|---|---|
| 00 | System Core | The hero: a machined computation core cycling VOICE → INTELLIGENCE → ACTION |
| 01 | Voice AI | SPEECH → STT → LLM → TOOL CALL → TTS → RESPONSE as physical hardware (30× TTS throughput, <300 ms TTFB) |
| 02 | Real-Time Systems | A multi-region network: WebRTC, WebSockets, SIP, Redis pub/sub, FastAPI |
| 03 | Siren Eyes | A night intersection turned perception system: YOLOv8 + log-mel siren CNN + stereo DoA → signal preemption (ICACIS 2026) |
| 04 | MeetAI | A holographic meeting room: transcription → understanding → commitments → calendar → minutes, plus briefing cues, a personal meeting agent and an AI fallback chain |
| 05 | Continuum | StarForge 2026 winner: a voice agent that resumes dropped calls from Qdrant semantic memory |
| 06 | Knowledge Network | A living embedding space telling the RAG story, with cited answers |
| 07 | Infrastructure | AWS/GCP halls, Kubernetes, CI/CD, Prometheus/Grafana |
| 08 | Command Runbook | The open-source VS Code extension as a developer workstation |
| 09 | ShieldX | An AI security-operations pipeline (college final-year project) |
| 10 | Signal Received | Achievements |
| 11 | Production | Founding AI Engineer experience as a vertical machine |
| 12 | Stack | An explorable technology constellation |
| 13 | Complete System | Every world connected into one network, plus contact |

## Controls

Scroll or swipe. Keyboard: `↓ ↑` glide · `→ ←` next / previous world · `Space` / `Shift+Space` one screen · `Home` / `End` · `1`–`5` jump to a section · `M` sound · `?` key map.

## Develop

```bash
npm install
npm run dev        # http://127.0.0.1:5199
npm run build      # production build in dist/
npm run preview    # serve dist/ on :5198
```

Debug parameters: `?w=<world-id>&p=<0..1>` jumps to a world at a scroll position, `&k=<0..1>` to mid-flight toward the next world, `?only=<world-id>` loads a single world, `?q=low` forces low quality.

Visual QA: `node scripts/shot.mjs --w siren --p 0,0.5,1` writes screenshots to `shots/` (needs a local Chrome or Edge).

## Structure

```
src/
  content.js          all facts shown on the site (single source of truth)
  engine/             renderer, scroll-driven camera rail, flights, post-processing,
                      cursor, nav/HUD, keyboard, generative soundscape
  lib/                shared materials, 3D text labels, GLSL noise, math helpers
  worlds/<id>/        one self-contained module per environment
```

Each world extends `World` (`src/engine/World.js`): it builds its scene, describes its camera path as a pure function of scroll progress, and animates itself. The engine flies the camera between worlds.

## Deploy

It's a static site: `npm run build` outputs `dist/`.

- **Vercel:** import the repo; `vercel.json` sets the build and cache headers.
- **Render:** new *Static Site*, build command `npm ci && npm run build`, publish directory `dist`.
- **Railway:** a static deployment with the same build command, serving `dist`.

## Performance

Tuned for integrated GPUs: no dynamic lights or shadow maps, GPU-animated particles, shaders compiled in the background after the first world, adaptive resolution, and per-world rendering (only the current and next world draw).

---

© 2026 Rohit Sharma · [rohitqwer0@gmail.com](mailto:rohitqwer0@gmail.com) · [LinkedIn](https://linkedin.com/in/irohitsharma21) · [GitHub](https://github.com/irohitsharma21)
