import { state, saveState } from '../state.js';
import { $, $$, renderMarkdown } from './utils.js';
import { prompts } from './prompts.js';
import { renderSentenceCount } from './settings.js';

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

    // Clean markdown code blocks and any preamble text
    let clean = text.trim();
    
    // Remove markdown code blocks
    clean = clean.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Try to extract JSON if there's text before it
    // Look for the first { and last }
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        clean = clean.substring(firstBrace, lastBrace + 1);
    }

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
    
    // Update switch button to show opposite direction
    const switchBtn = $('#btnSwitchDirection');
    if (switchBtn) {
        switchBtn.textContent = onENZH ? '中文 → EN' : 'EN → 中文';
    }

    const label = $('#translateLabel');
    const prompt = $('#promptText');
    const textarea = $('#userTranslation');
    if (label) label.textContent = onENZH ? 'Translate into 中文' : 'Translate into English';

    // Refresh prompt text based on current sentence
    if (prompt) prompt.textContent = onENZH ? state.translation.promptEN : state.translation.promptZH;

    // Update placeholder based on translation direction
    if (textarea) {
        textarea.placeholder = onENZH ? 'Type Hanzi and/or Pinyin' : 'Type English';
    }

    showTranslateA();
}

export function switchTranslationDir() {
    const newDir = state.translationDir === 'ENZH' ? 'ZHEN' : 'ENZH';
    setTranslationDir(newDir);
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
    body.innerHTML = renderMarkdown(tok.detail);
}

export function showTranslateA() {
    const input = $('#userTranslation');
    const feedback = $('#translateFeedback');
    const btn = $('#btnSubmitTranslation');
    const promptBox = $('#translatePromptBox');
    const inputArea = $('#translateInputArea');
    const skipBtn = $('#btnSkipSentence');
    const switchBtn = $('#btnSwitchDirection');
    if (input) {
        input.disabled = false;
        input.value = '';
        input.focus({ preventScroll: true });
    }
    if (feedback) feedback.style.display = 'none';
    if (promptBox) promptBox.style.display = '';
    if (inputArea) inputArea.style.display = '';
    if (btn) btn.style.display = 'block';
    if (skipBtn) skipBtn.style.display = 'block';
    if (switchBtn) switchBtn.style.display = 'block';
}

function showFeedback() {
    const feedback = $('#translateFeedback');
    const loader = $('#translateLoader');
    const content = $('#feedbackContent');
    const inputArea = $('#translateInputArea');
    const ov = $('#fbOverview');
    const btn = $('#btnSubmitTranslation');
    const nextBtn = $('#btnNextSentence');
    if (ov) ov.innerHTML = renderMarkdown(state.translation.feedbackOverview);
    renderFeedbackTokens();
    if (feedback) feedback.style.display = 'block';
    if (loader) loader.style.display = 'none';
    if (content) content.style.display = 'block';
    if (inputArea) inputArea.style.display = 'none';
    if (btn) btn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'block';
}

function showLoader() {
    const feedback = $('#translateFeedback');
    const loader = $('#translateLoader');
    const content = $('#feedbackContent');
    const promptBox = $('#translatePromptBox');
    const inputArea = $('#translateInputArea');
    const skipBtn = $('#btnSkipSentence');
    const nextBtn = $('#btnNextSentence');
    const switchBtn = $('#btnSwitchDirection');
    if (feedback) feedback.style.display = 'block';
    if (loader) loader.style.display = 'block';
    if (content) content.style.display = 'none';
    if (promptBox) promptBox.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (skipBtn) skipBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (switchBtn) switchBtn.style.display = 'none';
}

// --- LOGIC ---

export async function newSentence() {
    const promptDiv = $('#promptText');
    const nextBtn = $('#btnNextSentence');
    const skipBtn = $('#btnSkipSentence');

    if (state.wordlist.length < 5) {
        if (promptDiv) promptDiv.textContent = "Please add at least 5 words to your wordlist in Settings first.";
        return;
    }

    // Hide buttons and show loader
    if (nextBtn) nextBtn.style.display = 'none';
    if (skipBtn) skipBtn.style.display = 'none';
    showLoader();
    if (promptDiv) promptDiv.style.opacity = '0.5';

    try {
        // Get existing sentences from cache (up to 100 most recent)
        const recentCached = state.cachedSentences.slice(-100);
        
        // Extract source language sentences based on translation direction
        const isEnglishToChinese = state.translationDir === 'ENZH';
        const existingSentences = recentCached
            .map(cached => isEnglishToChinese ? cached.promptEN : cached.promptZH)
            .filter(s => s && s.trim()); // Filter out empty/null sentences
        
        // Construct prompt
        const words = state.wordlist.map(w => w.word).join(', ');
        const prompt = prompts.generateSentence(words, existingSentences);

        const data = await callGemini(prompt);

        state.translation = {
            promptEN: data.english,
            promptZH: data.mandarin,
            feedbackOverview: '',
            tokens: []
        };

        // Save to cache (limit to 100 most recent)
        state.cachedSentences.push(state.translation);
        if (state.cachedSentences.length > 100) state.cachedSentences.shift();
        saveState();
        renderSentenceCount();

        // Update UI and reset
        setTranslationDir(state.translationDir); // Refreshes text
        showTranslateA(); // Resets input and hides feedback

    } catch (e) {
        alert(e.message);
        // Re-show buttons on error
        const switchBtn = $('#btnSwitchDirection');
        if (nextBtn) nextBtn.style.display = 'block';
        if (skipBtn) skipBtn.style.display = 'block';
        if (switchBtn) switchBtn.style.display = 'block';
        const feedback = $('#translateFeedback');
        if (feedback) feedback.style.display = 'none';
    } finally {
        if (promptDiv) promptDiv.style.opacity = '1';
    }
}

export async function checkTranslation() {
    const input = $('#userTranslation');
    const btn = $('#btnSubmitTranslation');
    if (!input || !btn) return;

    const userText = input.value.trim();
    if (!userText) return;

    // Disable input, hide button, show loader, hide skip button
    input.disabled = true;
    btn.style.display = 'none';
    showLoader();

    try {
        const isEnglishToChinese = state.translationDir === 'ENZH';
        const srcText = isEnglishToChinese ? state.translation.promptEN : state.translation.promptZH;

        const prompt = isEnglishToChinese
            ? prompts.evaluateEnglishToChinese(srcText, state.translation.promptZH, userText)
            : prompts.evaluateChineseToEnglish(srcText, userText);

        const data = await callGemini(prompt);

        state.translation.feedbackOverview = data.overview;
        state.translation.tokens = data.words;

        showFeedback();

    } catch (e) {
        alert(e.message);
        // Re-enable on error
        input.disabled = false;
        btn.style.display = 'block';
        const feedback = $('#translateFeedback');
        if (feedback) feedback.style.display = 'none';
        const skipBtn = $('#btnSkipSentence');
        const switchBtn = $('#btnSwitchDirection');
        if (skipBtn) skipBtn.style.display = 'block';
        if (switchBtn) switchBtn.style.display = 'block';
    }
}

export function handleFeedbackClick(e) {
    const t = e.target;
    const btn = (t instanceof HTMLElement) ? t.closest('button.w') : null;
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (Number.isFinite(idx)) setDetail(idx);
}

export function skipSentence() {
    showLoader();
    newSentence();
}
