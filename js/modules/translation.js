import { state, saveState } from '../state.js';
import { $, $$, renderMarkdown } from './utils.js';
import { prompts } from './prompts.js';
import { renderSentenceCount } from './settings.js';

// --- API ---

async function callGemini(prompt) {
    if (!state.apiKey) {
        throw { 
            message: "Missing API Key", 
            details: "Please go to Settings and add your Gemini API key to use Translation Practice." 
        };
    }
    const isPreview = state.geminiModel.includes('preview') || state.geminiModel.includes('exp');
    const version = isPreview ? 'v1beta' : 'v1';
    const url = `https://generativelanguage.googleapis.com/${version}/models/${state.geminiModel}:generateContent?key=${state.apiKey}`;
    const payload = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        throw { 
            message: "Network Error", 
            details: "Failed to connect to Gemini API. Please check your internet connection and try again." 
        };
    }

    if (!res.ok) {
        let errText = '';
        try {
            errText = await res.text();
        } catch (e) {
            errText = 'Unable to read error response';
        }
        console.error('[Gemini API Error]', res.status, res.statusText, errText);
        
        let errorMsg = `API Error (${res.status})`;
        let errorDetails = '';
        
        if (res.status === 401) {
            errorMsg = "Invalid API Key";
            errorDetails = "Your Gemini API key appears to be invalid. Please check it in Settings.";
        } else if (res.status === 429) {
            errorMsg = "Rate Limit Exceeded";
            errorDetails = "You've made too many requests. Please wait a moment and try again.";
        } else if (res.status === 400) {
            errorMsg = "Invalid Request";
            errorDetails = "The request to Gemini was malformed. This might be a temporary issue.";
        } else {
            errorDetails = `Server returned: ${res.statusText}. ${errText ? 'Details: ' + errText.substring(0, 200) : ''}`;
        }
        
        throw { message: errorMsg, details: errorDetails };
    }

    let data;
    try {
        data = await res.json();
    } catch (e) {
        throw { 
            message: "Invalid Response", 
            details: "Gemini API returned data that couldn't be parsed. Please try again." 
        };
    }
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw { 
            message: "Empty Response", 
            details: "Gemini API didn't return any text. The model might be unavailable. Please try again." 
        };
    }

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
        throw { 
            message: "Invalid JSON Response", 
            details: "Gemini returned text that couldn't be parsed as JSON. This might be a temporary issue. Please try again." 
        };
    }
}

// --- UI ---

let errorTimeout = null;

function showError(message, details = '') {
    // Clear any existing timeout
    if (errorTimeout) {
        clearTimeout(errorTimeout);
        errorTimeout = null;
    }
    
    // Create or get error container
    let errorContainer = $('#translateError');
    if (!errorContainer) {
        errorContainer = document.createElement('div');
        errorContainer.id = 'translateError';
        errorContainer.className = 'translate-error';
        const container = $('#translateContainer');
        if (container) {
            container.insertBefore(errorContainer, container.firstChild);
        }
    }
    
    errorContainer.innerHTML = `
        <div class="error-content">
            <div class="error-icon">⚠️</div>
            <div class="error-text">
                <div class="error-title">${message}</div>
                ${details ? `<div class="error-details">${details}</div>` : ''}
            </div>
            <button class="btn-close-error" type="button" aria-label="Close">✕</button>
        </div>
    `;
    errorContainer.style.display = 'block';
    
    // Auto-hide after 8 seconds
    errorTimeout = setTimeout(() => {
        hideError();
        errorTimeout = null;
    }, 8000);
    
    // Close button handler
    const closeBtn = errorContainer.querySelector('.btn-close-error');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (errorTimeout) {
                clearTimeout(errorTimeout);
                errorTimeout = null;
            }
            hideError();
        });
    }
}

function hideError() {
    const errorContainer = $('#translateError');
    if (errorContainer) {
        errorContainer.style.display = 'none';
    }
}

function resetUIAfterError() {
    const feedback = $('#translateFeedback');
    const loader = $('#translateLoader');
    const content = $('#feedbackContent');
    const promptBox = $('#translatePromptBox');
    const inputArea = $('#translateInputArea');
    const input = $('#userTranslation');
    const btn = $('#btnSubmitTranslation');
    const skipBtn = $('#btnSkipSentence');
    const nextBtn = $('#btnNextSentence');
    const switchBtn = $('#btnSwitchDirection');
    const promptDiv = $('#promptText');
    
    // Hide loader and feedback
    if (feedback) feedback.style.display = 'none';
    if (loader) loader.style.display = 'none';
    if (content) content.style.display = 'none';
    
    // Show prompt and input
    if (promptBox) promptBox.style.display = '';
    if (inputArea) inputArea.style.display = '';
    
    // Re-enable input
    if (input) {
        input.disabled = false;
    }
    
    // Show buttons
    if (btn) btn.style.display = 'block';
    if (skipBtn) skipBtn.style.display = 'block';
    if (switchBtn) switchBtn.style.display = 'block';
    
    // Hide next button (only shown after successful grading)
    if (nextBtn) nextBtn.style.display = 'none';
    
    // Restore prompt opacity
    if (promptDiv) promptDiv.style.opacity = '1';
}

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
    hideError();
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
        hideError();
        setTranslationDir(state.translationDir); // Refreshes text
        showTranslateA(); // Resets input and hides feedback

    } catch (e) {
        // Handle error object with message/details or plain Error
        const errorMessage = e.message || 'An error occurred';
        const errorDetails = e.details || (e.message && e.message !== errorMessage ? e.message : '');
        
        showError(errorMessage, errorDetails);
        resetUIAfterError();
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

        hideError();
        showFeedback();

    } catch (e) {
        // Handle error object with message/details or plain Error
        const errorMessage = e.message || 'Failed to grade translation';
        const errorDetails = e.details || (e.message && e.message !== errorMessage ? e.message : 'Please try again.');
        
        showError(errorMessage, errorDetails);
        resetUIAfterError();
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
