import { state, saveState } from '../state.js';
import { $, $$ } from './utils.js';
import { prompts } from './prompts.js';

// --- API ---

async function callGemini(prompt) {
    if (!state.apiKey) {
        throw new Error("Missing API Key. Go to Settings to set it.");
    }
    const isPreview = state.geminiModel.includes('preview') || state.geminiModel.includes('exp');
    const version = isPreview ? 'v1beta' : 'v1';
    const url = `https://generativelanguage.googleapis.com/${version}/models/${state.geminiModel}:generateContent?key=${state.apiKey}`;
    const payload = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const err = await res.text();
        console.error('[Gemini API Error]', res.status, res.statusText, err);
        throw new Error(`Gemini API Error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("No response text from Gemini.");

    // Clean markdown code blocks if any
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        return JSON.parse(clean);
    } catch (e) {
        console.error("Failed to parse JSON from Gemini", clean);
        throw new Error("Gemini returned invalid JSON.");
    }
}

// --- UI ---

export function setTranslationDir(dir) {
    state.translationDir = dir;
    const onENZH = (dir === 'ENZH');
    const b1 = $('#dirENZH');
    const b2 = $('#dirZHEN');
    if (b1) { b1.dataset.on = String(onENZH); b1.setAttribute('aria-selected', onENZH ? 'true' : 'false'); }
    if (b2) { b2.dataset.on = String(!onENZH); b2.setAttribute('aria-selected', onENZH ? 'false' : 'true'); }

    const label = $('#translateLabel');
    const prompt = $('#promptText');
    if (label) label.textContent = onENZH ? 'Translate into 中文' : 'Translate into English';

    // Refresh prompt text based on current sentence
    if (prompt) prompt.textContent = onENZH ? state.translation.promptEN : state.translation.promptZH;

    showTranslateA();
}

export function renderFeedbackTokens() {
    const host = $('#fbSentence');
    if (!host) return;
    host.innerHTML = '';

    if (!state.translation.tokens) return;

    state.translation.tokens.forEach((tok, idx) => {
        const b = document.createElement('button');
        b.className = `w ${tok.cls}`;
        b.type = 'button';
        b.dataset.idx = String(idx);
        b.dataset.selected = 'false';
        b.textContent = tok.text;
        host.appendChild(b);
    });

    setDetail(null);
}

function setDetail(idx) {
    const detail = $('#fbDetail');
    const tag = $('#detailTag');
    const body = $('#detailBody');
    if (!detail || !tag || !body) return;

    $$('#fbSentence .w').forEach(b => b.dataset.selected = 'false');

    if (idx === null) {
        detail.style.display = 'none';
        tag.textContent = '';
        body.textContent = '';
        return;
    }

    const tok = state.translation.tokens[idx];
    const btn = $(`#fbSentence .w[data-idx="${idx}"]`);
    if (btn) btn.dataset.selected = 'true';

    detail.style.display = 'flex';
    tag.textContent = tok.text;
    body.innerHTML = tok.detail;
}

export function showTranslateA() {
    const a = $('#translateA');
    const b = $('#translateB');
    if (a) a.style.display = 'flex';
    if (b) b.style.display = 'none';
    const input = $('#userTranslation');
    if (input) input.focus({ preventScroll: true });
}

export function showTranslateB() {
    const a = $('#translateA');
    const b = $('#translateB');
    if (a) a.style.display = 'none';
    if (b) b.style.display = 'flex';

    const ov = $('#fbOverview');
    if (ov) ov.textContent = state.translation.feedbackOverview;
    renderFeedbackTokens();
}

// --- LOGIC ---

export async function newSentence() {
    const btn = $('#btnNewSentence');
    const promptDiv = $('#promptText');

    if (state.wordlist.length < 5) {
        if (promptDiv) promptDiv.textContent = "Please add at least 5 words to your wordlist in Settings first.";
        return;
    }

    if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }
    if (promptDiv) promptDiv.style.opacity = '0.5';

    try {
        // Construct prompt
        const words = state.wordlist.map(w => w.word).join(', ');
        const prompt = prompts.generateSentence(words);

        const data = await callGemini(prompt);

        state.translation = {
            promptEN: data.english,
            promptZH: data.mandarin,
            feedbackOverview: '',
            tokens: []
        };

        // Save to cache (optional, based on specs but good for persistence)
        state.cachedSentences.push(state.translation);
        if (state.cachedSentences.length > 50) state.cachedSentences.shift(); // Limit cache
        saveState();

        // Update UI
        setTranslationDir(state.translationDir); // Refreshes text
        const input = $('#userTranslation');
        if (input) input.value = '';

    } catch (e) {
        alert(e.message);
    } finally {
        if (btn) { btn.textContent = 'New sentence'; btn.disabled = false; }
        if (promptDiv) promptDiv.style.opacity = '1';
    }
}

export async function checkTranslation() {
    const input = $('#userTranslation');
    const btn = $('#btnSubmitTranslation');
    if (!input || !btn) return;

    const userText = input.value.trim();
    if (!userText) return;

    btn.textContent = 'Checking...';
    btn.disabled = true;

    try {
        const targetLang = (state.translationDir === 'ENZH') ? 'Mandarin' : 'English';
        const srcText = (state.translationDir === 'ENZH') ? state.translation.promptEN : state.translation.promptZH;

        const prompt = prompts.evaluateTranslation(srcText, targetLang, userText);

        const data = await callGemini(prompt);

        state.translation.feedbackOverview = data.overview;
        state.translation.tokens = data.words;

        showTranslateB();

    } catch (e) {
        alert(e.message);
    } finally {
        btn.textContent = 'Check';
        btn.disabled = false;
    }
}

export function handleFeedbackClick(e) {
    const t = e.target;
    const btn = (t instanceof HTMLElement) ? t.closest('button.w') : null;
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (Number.isFinite(idx)) setDetail(idx);
}
