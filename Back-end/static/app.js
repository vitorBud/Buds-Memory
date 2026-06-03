/* =============================================
   NEXUS AI — app.js
   Frontend Logic: SSE Chat, CRUD, Voice, Canvas
   ============================================= */

/* ── Constants ──────────────────────────────── */
const API = {
    SESSIONS: '/api/sessions',
    CHAT_STREAM: '/api/chat/stream',
    CHAT: '/api/chat',
    AUDIO: '/api/audio',
};

const STATE_LABELS = {
    idle: 'Aguardando',
    listening: 'Ouvindo',
    transcribing: 'Transcrevendo',
    thinking: 'Pensando',
    speaking: 'Falando',
    error: 'Erro',
};

/* ── App State ──────────────────────────────── */
const app = {
    currentSessionId: null,
    currentSessionTitle: null,
    messageCount: 0,
    isProcessing: false,
    mediaRecorder: null,
    audioChunks: [],
    recTimerInterval: null,
    recSeconds: 0,
    audioQueue: [],
    isPlayingAudio: false,
    currentAudio: null,
};

/* ── DOM References ─────────────────────────── */
const dom = {
    btnNewChat: document.getElementById('btnNewChat'),
    sessionsList: document.getElementById('sessionsList'),
    sessionsEmpty: document.getElementById('sessionsEmpty'),
    messagesArea: document.getElementById('messagesArea'),
    aiHero: document.getElementById('aiHero'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    micBtn: document.getElementById('micBtn'),
    charCount: document.getElementById('charCount'),
    aiStateBadge: document.getElementById('aiStateBadge'),
    aiStateLabel: document.getElementById('aiStateLabel'),
    topbarSessionTitle: document.getElementById('topbarSessionTitle'),
    statusDotMini: document.getElementById('statusDotMini'),
    statusLabelMini: document.getElementById('statusLabelMini'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    sidebar: document.getElementById('sidebar'),
    recordingOverlay: document.getElementById('recordingOverlay'),
    recTimer: document.getElementById('recTimer'),
    recStopBtn: document.getElementById('recStopBtn'),
    // Session info panel
    siId: document.getElementById('siId'),
    siMsgCount: document.getElementById('siMsgCount'),
    siLatency: document.getElementById('siLatency'),
    // Model activity
    maLLMBar: document.getElementById('maLLMBar'),
    maLLMPct: document.getElementById('maLLMPct'),
    maSTTBar: document.getElementById('maSTTBar'),
    maSTTPct: document.getElementById('maSTTPct'),
    maTTSBar: document.getElementById('maTTSBar'),
    maTTSPct: document.getElementById('maTTSPct'),
    // Status cards
    sttStatus: document.getElementById('sttStatus'),
    llmStatus: document.getElementById('llmStatus'),
    ttsStatus: document.getElementById('ttsStatus'),
};

/* ═══════════════════════════════════════════════
   STATE MANAGEMENT
═══════════════════════════════════════════════ */
function setState(state) {
    dom.aiStateBadge.dataset.state = state;
    dom.aiStateLabel.textContent = STATE_LABELS[state] || state;
}

function updateSessionInfo() {
    if (app.currentSessionId) {
        dom.siId.textContent = app.currentSessionId.split('-')[0] + '...';
        dom.siMsgCount.textContent = app.messageCount;
    } else {
        dom.siId.textContent = '—';
        dom.siMsgCount.textContent = '0';
    }
}

/* ═══════════════════════════════════════════════
   SESSION CRUD
═══════════════════════════════════════════════ */
async function loadSessions() {
    try {
        const res = await fetch(API.SESSIONS);
        const sessions = await res.json();
        renderSessions(sessions);
    } catch (err) {
        console.error('[Sessions] Erro ao carregar sessões:', err);
    }
}

function renderSessions(sessions) {
    dom.sessionsList.innerHTML = '';

    if (!sessions || sessions.length === 0) {
        dom.sessionsList.appendChild(dom.sessionsEmpty);
        dom.sessionsEmpty.style.display = 'flex';
        return;
    }

    sessions.forEach(session => {
        const item = createSessionItem(session);
        dom.sessionsList.appendChild(item);
    });
}

function createSessionItem(session) {
    const el = document.createElement('div');
    el.className = 'session-item' + (session.id === app.currentSessionId ? ' active' : '');
    el.dataset.id = session.id;

    const date = new Date(session.created_at);
    const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    el.innerHTML = `
        <div class="session-item-inner">
            <div class="session-item-title">${escapeHtml(session.title)}</div>
            <div class="session-item-date">${dateStr}</div>
        </div>
        <button class="session-delete-btn" title="Deletar conversa" data-id="${session.id}">✕</button>
    `;

    el.querySelector('.session-item-inner').addEventListener('click', () => selectSession(session.id, session.title));
    el.querySelector('.session-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(session.id, el);
    });

    return el;
}

async function createNewSession() {
    try {
        const res = await fetch(API.SESSIONS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: null }),
        });
        const session = await res.json();
        app.currentSessionId = session.id;
        app.currentSessionTitle = session.title;
        app.messageCount = 0;
        clearChat();
        updateTopbar(session.title);
        updateSessionInfo();
        await loadSessions();
    } catch (err) {
        console.error('[Session] Erro ao criar sessão:', err);
    }
}

async function selectSession(sessionId, title) {
    app.currentSessionId = sessionId;
    app.currentSessionTitle = title;
    app.messageCount = 0;
    clearChat();
    updateTopbar(title);

    // Highlight active
    document.querySelectorAll('.session-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === sessionId);
    });

    // Load messages
    try {
        const res = await fetch(`${API.SESSIONS}/${sessionId}/messages`);
        const messages = await res.json();
        if (messages && messages.length > 0) {
            hideHero();
            messages.forEach(msg => {
                renderMessage(msg.sender === 'user' ? 'user' : 'ai', msg.text, msg.audio_url, new Date(msg.created_at));
                app.messageCount++;
            });
            scrollToBottom();
        } else {
            showHero();
        }
    } catch (err) {
        console.error('[Session] Erro ao carregar mensagens:', err);
    }

    updateSessionInfo();
}

async function deleteSession(sessionId, el) {
    if (!confirm('Deletar esta conversa?')) return;
    try {
        await fetch(`${API.SESSIONS}/${sessionId}`, { method: 'DELETE' });
        el.remove();

        if (app.currentSessionId === sessionId) {
            app.currentSessionId = null;
            app.currentSessionTitle = null;
            app.messageCount = 0;
            clearChat();
            showHero();
            updateTopbar('NEXUS PRIME · ONLINE');
            updateSessionInfo();
        }

        // Check if list is empty
        if (dom.sessionsList.querySelectorAll('.session-item').length === 0) {
            dom.sessionsList.appendChild(dom.sessionsEmpty);
        }
    } catch (err) {
        console.error('[Session] Erro ao deletar sessão:', err);
    }
}

function updateTopbar(title) {
    dom.topbarSessionTitle.textContent = title || 'NEXUS PRIME · ONLINE';
}

/* ═══════════════════════════════════════════════
   CHAT MESSAGING
═══════════════════════════════════════════════ */
function clearChat() {
    dom.messagesArea.innerHTML = '';
}

function showHero() {
    dom.aiHero.style.display = 'flex';
    dom.messagesArea.style.display = 'none';
}

function hideHero() {
    dom.aiHero.style.display = 'none';
    dom.messagesArea.style.display = 'flex';
}

function scrollToBottom() {
    const wrapper = dom.messagesArea.parentElement;
    wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: 'smooth' });
}

function renderMessage(role, text, audioUrl = null, timestamp = new Date()) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${role}`;

    const avatarLabel = role === 'user' ? 'U' : 'AI';
    const timeStr = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let audioBtn = '';
    if (audioUrl && role === 'ai') {
        audioBtn = `<button class="msg-audio-btn" data-url="${audioUrl}">▶ Ouvir voz</button>`;
    }

    msgEl.innerHTML = `
        <div class="msg-avatar">${avatarLabel}</div>
        <div class="msg-body">
            <div class="msg-bubble">${escapeHtml(text)}</div>
            <div class="msg-time">${timeStr}</div>
            ${audioBtn}
        </div>
    `;

    const audioButton = msgEl.querySelector('.msg-audio-btn');
    if (audioButton) {
        audioButton.addEventListener('click', () => {
            const url = audioButton.dataset.url;
            playAudioUrl(url);
        });
    }

    dom.messagesArea.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
}

function createThinkingBubble() {
    const el = document.createElement('div');
    el.className = 'message ai';
    el.id = 'thinking-bubble';
    el.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-body">
            <div class="msg-bubble">
                <div class="msg-thinking">
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                </div>
            </div>
        </div>
    `;
    dom.messagesArea.appendChild(el);
    scrollToBottom();
    return el;
}

function removeThinkingBubble() {
    const el = document.getElementById('thinking-bubble');
    if (el) el.remove();
}

/* ── Send text message ── */
async function sendMessage(text) {
    if (!text || app.isProcessing) return;

    // Ensure session exists
    if (!app.currentSessionId) {
        await createNewSession();
    }

    app.isProcessing = true;
    hideHero();
    setState('thinking');

    // Render user message
    renderMessage('user', text);
    app.messageCount++;
    updateSessionInfo();
    dom.messageInput.value = '';
    updateCharCount();

    // Create streaming AI bubble
    const thinkingBubble = createThinkingBubble();
    let aiMsgBubble = null;
    let fullText = '';
    const startTime = Date.now();

    try {
        const response = await fetch(API.CHAT_STREAM, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, session_id: app.currentSessionId }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        setState('thinking');

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw) continue;

                let event;
                try { event = JSON.parse(raw); } catch { continue; }

                if (event.type === 'transcription') {
                    // No-op for text — already shown
                } else if (event.type === 'token') {
                    // First token: replace thinking with streaming bubble
                    if (!aiMsgBubble) {
                        thinkingBubble.remove();
                        const el = document.createElement('div');
                        el.className = 'message ai';
                        el.innerHTML = `
                            <div class="msg-avatar">AI</div>
                            <div class="msg-body">
                                <div class="msg-bubble streaming" id="ai-streaming-bubble"></div>
                                <div class="msg-time"></div>
                            </div>
                        `;
                        dom.messagesArea.appendChild(el);
                        aiMsgBubble = document.getElementById('ai-streaming-bubble');
                        setState('thinking');
                    }
                    fullText += event.content;
                    aiMsgBubble.textContent = fullText;
                    scrollToBottom();

                } else if (event.type === 'audio_sentence') {
                    // Queue audio for sequential playback
                    setState('speaking');
                    queueAudio(event.url);

                } else if (event.type === 'done') {
                    // Finalize
                    if (aiMsgBubble) {
                        aiMsgBubble.classList.remove('streaming');
                        const timeEl = aiMsgBubble.closest('.message').querySelector('.msg-time');
                        const now = new Date();
                        timeEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    }
                    const latency = Date.now() - startTime;
                    dom.siLatency.textContent = latency + 'ms';
                    app.messageCount++;
                    updateSessionInfo();
                    updateModelActivity('thinking-done');

                } else if (event.type === 'error') {
                    console.error('[Stream] Erro:', event.content);
                    setState('error');
                }
            }
        }
    } catch (err) {
        console.error('[Chat] Erro no streaming:', err);
        removeThinkingBubble();
        renderMessage('ai', '⚠ Erro ao conectar com o servidor. Verifique se o Ollama está rodando.');
        setState('error');
        setTimeout(() => setState('idle'), 3000);
    } finally {
        app.isProcessing = false;
        if (!app.isPlayingAudio) setState('idle');
    }
}

/* ═══════════════════════════════════════════════
   AUDIO QUEUE (Sequential Playback)
═══════════════════════════════════════════════ */
function queueAudio(url) {
    app.audioQueue.push(url);
    if (!app.isPlayingAudio) playNextAudio();
}

function playNextAudio() {
    if (app.audioQueue.length === 0) {
        app.isPlayingAudio = false;
        if (!app.isProcessing) setState('idle');
        updateModelActivity('tts-done');
        return;
    }

    app.isPlayingAudio = true;
    const url = app.audioQueue.shift();
    playAudioUrl(url, () => playNextAudio());
}

function playAudioUrl(url, onEnd = null) {
    if (app.currentAudio) {
        app.currentAudio.pause();
        app.currentAudio = null;
    }
    const audio = new Audio(url);
    app.currentAudio = audio;
    setState('speaking');
    updateModelActivity('tts-active', 90);

    audio.play().catch(err => {
        console.warn('[Audio] Falha ao reproduzir:', err);
        if (onEnd) onEnd();
    });

    audio.onended = () => {
        app.currentAudio = null;
        if (onEnd) onEnd();
    };
}

/* ═══════════════════════════════════════════════
   VOICE RECORDING (MediaRecorder)
═══════════════════════════════════════════════ */
async function startRecording() {
    if (app.mediaRecorder) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        app.audioChunks = [];
        app.recSeconds = 0;

        const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? { mimeType: 'audio/webm;codecs=opus' }
            : { mimeType: 'audio/webm' };

        app.mediaRecorder = new MediaRecorder(stream, options);

        app.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) app.audioChunks.push(e.data);
        };

        app.mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(app.audioChunks, { type: options.mimeType });
            sendAudioBlob(blob);
        };

        app.mediaRecorder.start(200);
        setState('listening');
        dom.micBtn.classList.add('recording');
        showRecordingOverlay();

        // Timer
        app.recTimerInterval = setInterval(() => {
            app.recSeconds++;
            dom.recTimer.textContent = app.recSeconds + 's';
            if (app.recSeconds >= 30) stopRecording(); // Max 30s
        }, 1000);

    } catch (err) {
        console.error('[Mic] Permissão negada ou erro:', err);
        setState('error');
        alert('Erro ao acessar o microfone. Verifique as permissões do navegador.');
        setTimeout(() => setState('idle'), 2000);
    }
}

function stopRecording() {
    if (!app.mediaRecorder) return;
    clearInterval(app.recTimerInterval);
    app.mediaRecorder.stop();
    app.mediaRecorder = null;
    dom.micBtn.classList.remove('recording');
    hideRecordingOverlay();
    setState('transcribing');
    updateModelActivity('stt-active', 80);
}

async function sendAudioBlob(blob) {
    if (!app.currentSessionId) await createNewSession();

    app.isProcessing = true;
    hideHero();

    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    formData.append('session_id', app.currentSessionId);

    const thinkingBubble = createThinkingBubble();
    let aiMsgBubble = null;
    let fullText = '';
    const startTime = Date.now();

    try {
        const response = await fetch(API.CHAT_STREAM, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw) continue;

                let event;
                try { event = JSON.parse(raw); } catch { continue; }

                if (event.type === 'transcription') {
                    // Show user transcription
                    thinkingBubble.remove();
                    if (event.content) {
                        renderMessage('user', event.content);
                        app.messageCount++;
                    }
                    createThinkingBubble();
                    setState('thinking');

                } else if (event.type === 'token') {
                    const existingThinking = document.getElementById('thinking-bubble');
                    if (!aiMsgBubble) {
                        if (existingThinking) existingThinking.remove();
                        const el = document.createElement('div');
                        el.className = 'message ai';
                        el.innerHTML = `
                            <div class="msg-avatar">AI</div>
                            <div class="msg-body">
                                <div class="msg-bubble streaming" id="ai-streaming-bubble"></div>
                                <div class="msg-time"></div>
                            </div>
                        `;
                        dom.messagesArea.appendChild(el);
                        aiMsgBubble = document.getElementById('ai-streaming-bubble');
                    }
                    fullText += event.content;
                    aiMsgBubble.textContent = fullText;
                    scrollToBottom();

                } else if (event.type === 'audio_sentence') {
                    setState('speaking');
                    queueAudio(event.url);

                } else if (event.type === 'done') {
                    if (aiMsgBubble) {
                        aiMsgBubble.classList.remove('streaming');
                        const timeEl = aiMsgBubble.closest('.message').querySelector('.msg-time');
                        const now = new Date();
                        timeEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    }
                    const latency = Date.now() - startTime;
                    dom.siLatency.textContent = latency + 'ms';
                    app.messageCount++;
                    updateSessionInfo();
                    updateModelActivity('stt-done');
                }
            }
        }
    } catch (err) {
        console.error('[Audio] Erro no envio:', err);
        removeThinkingBubble();
        renderMessage('ai', '⚠ Erro ao processar o áudio. Tente novamente.');
        setState('error');
        setTimeout(() => setState('idle'), 3000);
    } finally {
        app.isProcessing = false;
        if (!app.isPlayingAudio) setState('idle');
    }
}

function showRecordingOverlay() {
    dom.recordingOverlay.classList.add('active');
    dom.recTimer.textContent = '0s';
}

function hideRecordingOverlay() {
    dom.recordingOverlay.classList.remove('active');
}

/* ═══════════════════════════════════════════════
   MODEL ACTIVITY PANEL (Simulated + real events)
═══════════════════════════════════════════════ */
function updateModelActivity(event, value = 0) {
    switch (event) {
        case 'thinking-start':
            setActivity(dom.maLLMBar, dom.maLLMPct, 60 + Math.random() * 30, 'Ativo');
            setActivity(dom.maSTTBar, dom.maSTTPct, 0, '–');
            setActivity(dom.maTTSBar, dom.maTTSPct, 0, '–');
            updateStatusCard('llm', 'Processando...', 'busy');
            break;
        case 'thinking-done':
            setActivity(dom.maLLMBar, dom.maLLMPct, 20 + Math.random() * 15, 'Pronto');
            updateStatusCard('llm', 'Pronto', 'ok');
            break;
        case 'stt-active':
            setActivity(dom.maSTTBar, dom.maSTTPct, value || 75, 'Ativo');
            updateStatusCard('stt', 'Transcrevendo...', 'busy');
            break;
        case 'stt-done':
            setActivity(dom.maSTTBar, dom.maSTTPct, 20, 'Pronto');
            updateStatusCard('stt', 'Pronto', 'ok');
            break;
        case 'tts-active':
            setActivity(dom.maTTSBar, dom.maTTSPct, value || 85, 'Ativo');
            updateStatusCard('tts', 'Sintetizando...', 'busy');
            break;
        case 'tts-done':
            setActivity(dom.maTTSBar, dom.maTTSPct, 25, 'Pronto');
            updateStatusCard('tts', 'Pronto', 'ok');
            break;
    }
}

function setActivity(barEl, pctEl, pct, label) {
    barEl.style.width = pct + '%';
    pctEl.textContent = Math.round(pct) + '%';
}

function updateStatusCard(card, text, status) {
    const statusMap = { stt: dom.sttStatus, llm: dom.llmStatus, tts: dom.ttsStatus };
    const el = statusMap[card];
    if (el) el.textContent = text;

    const cardEls = { stt: 'sttCard', llm: 'llmCard', tts: 'ttsCard' };
    const dot = document.querySelector(`#${cardEls[card]} .sc-dot`);
    if (dot) dot.dataset.status = status;
}

/* ═══════════════════════════════════════════════
   CANVAS — PARTICLE NETWORK (Right Panel)
═══════════════════════════════════════════════ */
(function initNetworkCanvas() {
    const canvas = document.getElementById('networkCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const PARTICLE_COUNT = 45;
    const MAX_DIST = 80;
    const particles = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            r: Math.random() * 2 + 1,
        });
    }

    function draw() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Move particles
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

            // Draw node
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,212,255,0.7)';
            ctx.fill();
        });

        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < MAX_DIST) {
                    const alpha = (1 - dist / MAX_DIST) * 0.5;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(0,212,255,${alpha})`;
                    ctx.lineWidth = 0.7;
                    ctx.stroke();
                }
            }
        }
        requestAnimationFrame(draw);
    }
    draw();
})();

/* ═══════════════════════════════════════════════
   CANVAS — ORB VISUALIZER (Hero center)
═══════════════════════════════════════════════ */
(function initOrbCanvas() {
    const canvas = document.getElementById('orbCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const CX = canvas.width / 2;
    const CY = canvas.height / 2;
    let frame = 0;

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const state = document.getElementById('aiStateBadge')?.dataset?.state || 'idle';
        const pulse = Math.sin(frame * 0.04);

        // Outer glow
        const glowR = 70 + pulse * (state === 'thinking' ? 12 : state === 'speaking' ? 10 : 4);
        const grad = ctx.createRadialGradient(CX, CY, 0, CX, CY, glowR);

        let c1, c2;
        switch (state) {
            case 'listening': c1 = 'rgba(0,212,255,0.5)'; c2 = 'rgba(0,212,255,0)'; break;
            case 'transcribing': c1 = 'rgba(255,179,71,0.45)'; c2 = 'rgba(255,179,71,0)'; break;
            case 'thinking': c1 = 'rgba(123,47,247,0.5)'; c2 = 'rgba(123,47,247,0)'; break;
            case 'speaking': c1 = 'rgba(0,255,159,0.45)'; c2 = 'rgba(0,255,159,0)'; break;
            case 'error': c1 = 'rgba(255,68,102,0.5)'; c2 = 'rgba(255,68,102,0)'; break;
            default: c1 = 'rgba(0,212,255,0.25)'; c2 = 'rgba(0,212,255,0)';
        }

        grad.addColorStop(0, c1);
        grad.addColorStop(1, c2);
        ctx.beginPath();
        ctx.arc(CX, CY, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Rotating arcs
        ctx.save();
        ctx.translate(CX, CY);
        ctx.rotate(frame * 0.018);
        ctx.beginPath();
        ctx.arc(0, 0, 45, 0, Math.PI * 1.5);
        ctx.strokeStyle = 'rgba(0,212,255,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(CX, CY);
        ctx.rotate(-frame * 0.012);
        ctx.beginPath();
        ctx.arc(0, 0, 55, Math.PI * 0.25, Math.PI * 1.25);
        ctx.strokeStyle = 'rgba(123,47,247,0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Core dot
        const coreR = 20 + pulse * (state !== 'idle' ? 4 : 2);
        const coreGrad = ctx.createRadialGradient(CX, CY, 0, CX, CY, coreR);
        coreGrad.addColorStop(0, 'rgba(0,212,255,0.9)');
        coreGrad.addColorStop(0.5, 'rgba(0,212,255,0.3)');
        coreGrad.addColorStop(1, 'rgba(0,212,255,0)');
        ctx.beginPath();
        ctx.arc(CX, CY, coreR, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();

        frame++;
        requestAnimationFrame(draw);
    }
    draw();
})();

/* ═══════════════════════════════════════════════
   SIMULATED LIVE STATS (idle ticks)
═══════════════════════════════════════════════ */
setInterval(() => {
    if (app.isProcessing || app.isPlayingAudio) return;
    const llmPct = 10 + Math.random() * 20;
    const sttPct = 5 + Math.random() * 15;
    const ttsPct = 5 + Math.random() * 10;
    setActivity(dom.maLLMBar, dom.maLLMPct, llmPct, Math.round(llmPct) + '%');
    setActivity(dom.maSTTBar, dom.maSTTPct, sttPct, Math.round(sttPct) + '%');
    setActivity(dom.maTTSBar, dom.maTTSPct, ttsPct, Math.round(ttsPct) + '%');
}, 2500);

/* ═══════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════ */

// New chat
dom.btnNewChat.addEventListener('click', createNewSession);

// Send on button click
dom.sendBtn.addEventListener('click', () => {
    const text = dom.messageInput.value.trim();
    if (text) sendMessage(text);
});

// Send on Enter (not Shift+Enter)
dom.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = dom.messageInput.value.trim();
        if (text) sendMessage(text);
    }
});

// Auto-resize textarea
dom.messageInput.addEventListener('input', () => {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 140) + 'px';
    updateCharCount();
});

function updateCharCount() {
    const len = dom.messageInput.value.length;
    dom.charCount.textContent = `${len} / 4000`;
}

// Mic toggle
dom.micBtn.addEventListener('click', () => {
    if (app.mediaRecorder) {
        stopRecording();
    } else {
        startRecording();
    }
});

// Stop recording from overlay
dom.recStopBtn.addEventListener('click', stopRecording);

// Quick action buttons
document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        if (prompt) sendMessage(prompt);
    });
});

// Sidebar toggle (mobile)
dom.sidebarToggle.addEventListener('click', () => {
    dom.sidebar.classList.toggle('open');
});

/* ═══════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════ */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* ═══════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════ */
(async function init() {
    setState('idle');
    showHero();
    await loadSessions();

    // Check if there are sessions, don't auto-select — let user choose
    console.log('[Nexus AI] Interface inicializada.');
})();
