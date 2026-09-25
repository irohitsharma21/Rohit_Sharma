// Single source of truth, transcribed from resume_out/Rohit_Sharma_Resume.pdf.
// Worlds must read facts from here rather than hard-coding them, and must never invent new ones.

export const profile = {
  name: 'Rohit Sharma',
  role: 'AI Engineer',
  tagline: 'Generative AI · Voice Systems · Real-Time AI',
  closing: 'Building intelligent systems that see, hear, reason and act.',
  summary:
    'AI Engineer specializing in Generative AI, Voice AI, and real-time systems, with production experience building conversational agents, fine-tuning speech models, optimizing inference, and shipping scalable backend infrastructure.',
  location: 'Noida, UP (201309)',
  phone: '+91 8439381549',
  email: 'rohitqwer0@gmail.com',
  links: [
    { id: 'email', label: 'Email', value: 'rohitqwer0@gmail.com', href: 'mailto:rohitqwer0@gmail.com' },
    { id: 'linkedin', label: 'LinkedIn', value: 'linkedin.com/in/irohitsharma21', href: 'https://linkedin.com/in/irohitsharma21' },
    { id: 'github', label: 'GitHub', value: 'github.com/irohitsharma21', href: 'https://github.com/irohitsharma21' },
    { id: 'phone', label: 'Phone', value: '+91 8439381549', href: 'tel:+918439381549' },
  ],
}

export const experience = {
  title: 'Founding AI Engineer',
  company: 'IndusLabs AI',
  location: 'Noida',
  period: 'Mar 2025 – Present',
  bullets: [
    'Architected and deployed a production-grade Voice AI Agent along with scalable FastAPI backend infrastructure.',
    'Fine-tuned the TTS model for high-fidelity, emotionally expressive speech generation with controllable prosody.',
    'Increased concurrent real-time TTS throughput by 30x while reducing TTFB to under 300 ms.',
    'Built a scalable multilingual speech dataset preparation pipeline for TTS model fine-tuning.',
    'Developed low-latency AI pipelines integrating LLMs, STT, TTS, tool calling, and enterprise business workflows.',
    'Deployed, monitored, and maintained production AI services on AWS/GCP using Docker, Prometheus & Grafana.',
  ],
  // The BUILD → OPTIMIZE → SCALE → DEPLOY → MONITOR machine maps each stage to real bullets above.
  stages: [
    { id: 'build', label: 'BUILD', text: 'Production-grade Voice AI Agent with scalable FastAPI backend infrastructure.' },
    { id: 'optimize', label: 'OPTIMIZE', text: 'Fine-tuned TTS for emotionally expressive speech with controllable prosody.' },
    { id: 'scale', label: 'SCALE', text: '30× concurrent real-time TTS throughput, TTFB under 300 ms.' },
    { id: 'deploy', label: 'DEPLOY', text: 'Low-latency pipelines: LLMs, STT, TTS, tool calling, enterprise workflows.' },
    { id: 'monitor', label: 'MONITOR', text: 'Production AI services on AWS/GCP with Docker, Prometheus & Grafana.' },
  ],
  metrics: [
    { label: 'TTS THROUGHPUT', value: '30×', note: 'concurrent real-time' },
    { label: 'TTFB', value: '<300 ms', note: 'time to first byte' },
  ],
}

export const projects = {
  siren: {
    name: 'Siren Eyes',
    full: 'Siren Eyes: Multimodal Ambulance Detection & Signal Preemption',
    period: '2024 – 2026',
    stack: ['PyTorch', 'YOLOv8', 'FastAPI', 'React', 'Docker'],
    github: 'https://github.com/irohitsharma21/siren-eyes',
    demo: 'https://siren-eyes.onrender.com',
    bullets: [
      'Fused YOLOv8 detection, a log-mel CNN siren classifier (ROC-AUC 0.986) and stereo direction-of-arrival into a safety-gated traffic preemption pipeline, streamed per frame over WebSockets at ~110 ms/frame on CPU.',
      'Retrained the siren model after proving the original did not discriminate; shipped a tunable, exportable analysis dashboard. Paper accepted at ICACIS 2026.',
    ],
    metrics: [
      { label: 'ROC-AUC', value: '0.986', note: 'log-mel CNN siren classifier' },
      { label: 'FRAME', value: '~110 ms', note: 'per frame on CPU' },
      { label: 'PUBLISHED', value: 'ICACIS 2026', note: 'paper accepted' },
    ],
    paper: 'Stereo-Aware Multi-Modal Ambulance Detection System',
  },
  meetai: {
    name: 'MeetAI',
    full: 'MeetAI: Real-Time Meeting Platform with AI Minutes',
    period: '2024 – 2026',
    stack: ['FastAPI', 'React', 'LiveKit', 'Deepgram', 'LLMs', 'Qdrant', 'MongoDB'],
    github: 'https://github.com/irohitsharma21/meetai',
    demo: 'https://meetai-beta.vercel.app',
    bullets: [
      'Built a Meet-grade call on LiveKit WebRTC: waiting room, host controls, chat, reactions, hand raise, background blur, pinning and live captions from a resilient Deepgram streaming pipeline (~1.7 s transcription latency).',
      'LLM pass over each utterance detects commitments for one-click calendar scheduling; generates minutes, summary and sentiment, plus cited semantic search across all meetings. Deployed on Vercel and Render.',
    ],
    metrics: [
      { label: 'TRANSCRIPTION', value: '~1.7 s', note: 'streaming latency' },
    ],
    features: ['waiting room', 'host controls', 'chat', 'reactions', 'hand raise', 'background blur', 'pinning', 'live captions'],
    // Newest capabilities (in active development, supplied by Rohit).
    latest: [
      {
        id: 'briefing',
        label: 'BRIEFING CUES',
        text: 'Upload a PDF, PowerPoint, Word, text or Markdown file. When someone asks something your document answers, only you get a private popup with the answer and its source. You can also type questions to your documents.',
        example: { answer: 'latency is 350 ms', source: 'Slide 3' },
        formats: ['PDF', 'PPTX', 'DOCX', 'TXT', 'MD'],
      },
      {
        id: 'agent',
        label: 'PERSONAL MEETING AGENT',
        text: 'Say "Hey MeetAI, send my contact details to Rohit" and it emails your contact card. It can share saved snippets, email your documents, draft emails for your approval and save notes. It only does tasks you have enabled, each set to "ask first" or "just do it".',
        wake: 'Hey MeetAI, send my contact details to Rohit',
        tools: ['send contact card', 'share snippets', 'email documents', 'draft emails', 'save notes'],
        modes: ['ASK FIRST', 'JUST DO IT'],
      },
      {
        id: 'storage',
        label: 'QDRANT CLOUD',
        text: 'Uploaded documents are stored in Qdrant Cloud, so they survive server restarts.',
      },
      {
        id: 'fallback',
        label: 'AI FALLBACK CHAIN',
        text: 'Cerebras, Gemini, OpenRouter and Groq in a fallback chain, so one failing provider does not break the AI.',
        providers: ['Cerebras', 'Gemini', 'OpenRouter', 'Groq'],
      },
    ],
  },
  runbook: {
    name: 'Command Runbook',
    full: 'Command Runbook: VS Code Extension',
    period: '2026',
    github: 'https://github.com/irohitsharma21/command-runbook',
    marketplace: 'https://marketplace.visualstudio.com/search?term=Command%20Runbook&target=VSCode',
    bullets: [
      'Saves terminal commands with auto-written descriptions, searchable and re-runnable in one click. Open source (MIT).',
    ],
    license: 'MIT',
  },
  // StarForge 2026 hackathon winner (Track 01 · VoxForge). Facts from github.com/irohitsharma21/hack_voice README.
  // It was a team build ("we"), so phrase it as "built for / won", never as a solo claim.
  continuum: {
    name: 'Continuum',
    full: 'Continuum: The Voice Agent That Never Starts From Zero',
    tagline: 'The voice agent that never starts from zero.',
    context: 'StarForge 2026 · Winner · Track 01 VoxForge',
    github: 'https://github.com/irohitsharma21/hack_voice',
    summary: 'A multilingual, context-preserving voice commerce agent with semantic memory, real-time interruption handling and PII security. When a call drops and the caller rings back, it resumes exactly where they left off, cart and language included.',
    contributions: [
      { label: 'SEMANTIC TASK RESUMPTION', text: 'Qdrant vector memory retrieves unfinished tasks by intent across sessions. A Hindi question retrieves an English task summary via multilingual embeddings.' },
      { label: 'INTERRUPTION-AWARE STATE', text: 'On barge-in, TTS-aligned transcripts reveal what audio was actually heard; state reconciles against only that.' },
      { label: 'DUAL-STORE ISOLATION', text: 'Qdrant for semantic routing, MongoDB for authoritative state, with four layers of isolation so one caller’s data never leaks into another’s session.' },
    ],
    metrics: [
      { label: 'SCENARIOS', value: '12 / 12', note: 'evaluation suite, nothing mocked' },
      { label: 'RETRIEVAL', value: '8.1 ms', note: 'Qdrant mean · p95 10.7 ms' },
      { label: 'CROSS-USER LEAKS', value: '0', note: 'payload-filtered isolation' },
      { label: 'PERCEIVED LATENCY', value: '~0.9–1.3 s', note: 'caller stops speaking → first syllable' },
    ],
    pipeline: ['LIVEKIT WEBRTC', 'DEEPGRAM STT', 'TURN DETECTION', 'LANGUAGE', 'QDRANT HYBRID · RRF', 'MONGODB STATE', 'LLM', 'RIME TTS'],
    stack: ['LiveKit', 'Deepgram nova-3', 'Qdrant', 'MongoDB', 'Rime TTS', 'Groq / Bedrock / Claude', 'React'],
  },
  // Own college final-year project (not on the resume). Only facts visible on the public demo page.
  shieldx: {
    name: 'ShieldX',
    full: 'ShieldX: AI Security Operations Center',
    context: 'College final-year project · research prototype',
    demo: 'https://shieldx-dashboard.vercel.app',
    summary: 'ML detects and scores; the LLM analyst only reasons over verified evidence.',
    pipeline: ['INGEST', 'DETECT', 'CORRELATE', 'ATT&CK', 'ANALYST', 'POLICY', 'RESPOND'],
    pipelineNotes: ['flow replay', 'XGBoost + Isolation Forest', 'alerts → incidents', 'technique mapping', 'LLM reasoning', 'deny by default', 'sandboxed action'],
    stack: ['XGBoost', 'Isolation Forest', 'LLM analyst', 'MITRE ATT&CK', 'WebSockets'],
    dataset: 'CIC-IDS2017 replay',
    note: 'All response actions are simulated inside a sandboxed lab.',
  },
}

export const achievements = [
  { id: 'icacis', year: '2026', title: 'ICACIS 2026', status: 'PAPER ACCEPTED', detail: '"Stereo-Aware Multi-Modal Ambulance Detection System"' },
  { id: 'starforge', year: '2026', title: 'STARFORGE 2026', status: 'HACKATHON WINNER', detail: 'E-Cell, JSSATEN Noida', prize: 'INR 20,000' },
  { id: 'gate', year: '2026', title: 'GATE 2026', status: 'QUALIFIED', detail: 'Computer Science and Information Technology (CS)' },
]

export const education = {
  degree: 'Bachelor of Technology, Computer Science and Engineering',
  school: 'JSS Academy of Technical Education, Noida',
  expected: 'August 2027',
  cgpa: '7.93/10',
  certifications: ['Data Structures & Algorithms, CodeHelp - Love Babbar', 'Data Science with Generative AI (150+ Hours), PW Skills'],
}

// Constellation groups (as specified in the design brief; every item appears in the resume).
export const skillGroups = [
  { id: 'intelligence', label: 'INTELLIGENCE', items: ['LLMs', 'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'Agentic AI', 'PyTorch', 'Hugging Face'] },
  { id: 'genai', label: 'GENERATIVE AI', items: ['RAG', 'LoRA', 'PEFT', 'Fine-Tuning', 'Tool Calling', 'MCP', 'LangChain', 'Prompt Engineering'] },
  { id: 'speech', label: 'SPEECH', items: ['STT', 'TTS', 'SNAC', 'Prosody Control', 'LiveKit', 'Voice Cloning', 'vLLM', 'Inference Optimization'] },
  { id: 'systems', label: 'SYSTEMS', items: ['FastAPI', 'WebSockets', 'WebRTC', 'Redis', 'MongoDB', 'Qdrant', 'Microservices', 'SIP Telephony'] },
  { id: 'infra', label: 'INFRASTRUCTURE', items: ['AWS', 'GCP', 'Docker', 'Kubernetes', 'Prometheus', 'Grafana', 'CI/CD', 'Linux'] },
]

// Cross-ecosystem links for the constellation (tools that are genuinely used together in the resume's projects).
export const skillLinks = [
  ['LLMs', 'RAG'], ['LLMs', 'Tool Calling'], ['LLMs', 'Fine-Tuning'], ['RAG', 'Qdrant'], ['Tool Calling', 'MCP'],
  ['LoRA', 'PEFT'], ['PEFT', 'Fine-Tuning'], ['Fine-Tuning', 'TTS'], ['TTS', 'SNAC'], ['TTS', 'Prosody Control'],
  ['TTS', 'Voice Cloning'], ['STT', 'LiveKit'], ['LiveKit', 'WebRTC'], ['STT', 'WebSockets'], ['vLLM', 'Inference Optimization'],
  ['LLMs', 'vLLM'], ['FastAPI', 'WebSockets'], ['FastAPI', 'Docker'], ['FastAPI', 'Redis'], ['Docker', 'Kubernetes'],
  ['Prometheus', 'Grafana'], ['Kubernetes', 'Prometheus'], ['AWS', 'Docker'], ['GCP', 'Docker'], ['CI/CD', 'Docker'],
  ['Computer Vision', 'PyTorch'], ['Deep Learning', 'PyTorch'], ['Agentic AI', 'Tool Calling'], ['Agentic AI', 'LangChain'],
  ['NLP', 'LLMs'], ['MongoDB', 'FastAPI'], ['SIP Telephony', 'WebRTC'], ['Hugging Face', 'Fine-Tuning'], ['Microservices', 'Kubernetes'],
]

export const allSkills = {
  Programming: ['Python', 'C++', 'Java', 'TypeScript', 'React', 'SQL'],
  'AI/ML': ['Machine Learning', 'Deep Learning', 'NLP', 'Agentic AI', 'Computer Vision', 'PyTorch', 'Hugging Face'],
  'Generative AI': ['LLMs', 'Prompt Engineering', 'RAG', 'LangChain', 'AI Agents', 'LoRA', 'PEFT', 'MCP', 'Fine-Tuning', 'Tool Calling'],
  'Speech AI': ['STT', 'TTS', 'Voice AI', 'SNAC', 'Prosody Control', 'LiveKit', 'vLLM', 'Inference Optimization', 'Voice Cloning'],
  Backend: ['FastAPI', 'REST APIs', 'WebSockets', 'WebRTC', 'Async Python', 'Microservices', 'Redis', 'MongoDB', 'Vector Databases (Qdrant)'],
  'Cloud & DevOps': ['AWS', 'S3', 'GCP', 'Docker', 'Kubernetes', 'Linux', 'Git', 'GitHub Actions', 'CI/CD', 'Prometheus', 'Grafana'],
  'Real-Time Systems': ['SIP Telephony', 'Low-Latency Streaming', 'Distributed Systems'],
  'Core CS': ['DSA (300+ Problems)', 'OOP', 'DBMS', 'Operating Systems', 'Computer Networks', 'System Design'],
}
