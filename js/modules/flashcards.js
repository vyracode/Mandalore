import { state, bumpSession } from '../state.js';
import { $, $$ } from './utils.js';
import getCandidates from '../lib/pinyin-ime.esm.js';
import { generateWordId } from './wordId.js';

const FRONT_ORDER = ['hanzi', 'pronunciation', 'meaning'];
const FRONT_LABEL = { hanzi: 'Hanzi', pronunciation: 'Audio', pinyin: 'Pinyin', meaning: 'Meaning' };
const FRONT_HINT = { hanzi: 'Recognize the word', pronunciation: 'Recognize the sound', pinyin: 'Recognize the spelling', meaning: 'Recall the Mandarin' };

// FlashCardo audio mappings: wordId -> audioNum
let flashCardoMappings = null;

/**
 * Load FlashCardo audio mappings from JSON file
 */
async function loadFlashCardoMappings() {
    if (flashCardoMappings !== null) return; // Already loaded
    try {
        const response = await fetch('/asset/FlashCardoMappings.json');
        if (response.ok) {
            flashCardoMappings = await response.json();
            console.log(`Loaded ${Object.keys(flashCardoMappings).length} FlashCardo audio mappings`);
        } else {
            console.warn('Failed to load FlashCardo mappings:', response.status);
            flashCardoMappings = {};
        }
    } catch (e) {
        console.error('Error loading FlashCardo mappings:', e);
        flashCardoMappings = {};
    }
}

// Load mappings on module init
loadFlashCardoMappings();

function speak(text) {
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.8;
    window.speechSynthesis.speak(u);
}

/**
 * Play audio for a word using FlashCardo audio if available, otherwise TTS
 * @param {string} wordId - The word's unique ID
 * @param {string} word - The Hanzi word (for TTS fallback)
 * @returns {Promise<boolean>} - True if FlashCardo audio was found and played
 */
async function playAudioAsset(wordId, word) {
    // Ensure mappings are loaded
    await loadFlashCardoMappings();
    
    // Check if wordId exists in FlashCardo mappings
    if (flashCardoMappings && wordId && flashCardoMappings[wordId]) {
        const audioNum = flashCardoMappings[wordId];
        const audioUrl = `https://flashcardo.com/audio/0/${audioNum}.mp3`;
        const audio = new Audio(audioUrl);
        audio.play().catch(e => {
            console.error('Failed to play FlashCardo audio:', e);
            // Fall back to TTS on error
            speak(word);
        });
        return true;
    }
    
    // Debug logging
    if (wordId && flashCardoMappings) {
        console.debug(`FlashCardo audio not found for wordId: ${wordId} (word: ${word})`);
    }
    
    return false;
}

/**
 * Get image URL for a word (placeholder for future image support)
 * @param {string} wordId - The word's unique ID
 * @param {string} word - The Hanzi word
 * @returns {string|null} - Image URL or null if not available
 */
function getImageAssetUrl(wordId, word) {
    // No image assets currently available
    // This function is kept for future image support
    return null;
}

function createAudioButton(wordId, word, autoplay = false) {
    const wrap = document.createElement('div');
    wrap.className = 'front-audio';

    const btn = document.createElement('button');
    btn.className = 'sound';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Play pronunciation');
    btn.innerHTML = '<div class="waves" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
    
    const playAudio = async () => {
        btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
        // Try asset first, fallback to TTS
        if (!(await playAudioAsset(wordId, word))) {
            speak(word);
        }
    };
    
    btn.addEventListener('click', playAudio);
    
    // Autoplay if requested
    if (autoplay) {
        setTimeout(() => playAudio(), 100);
    }
    
    wrap.appendChild(btn);

    const d = document.createElement('div');
    d.style.textAlign = 'left';
    d.innerHTML = `<div style="font-family:'Google Sans',system-ui,-apple-system,sans-serif; font-weight:950; font-size:16px; letter-spacing:.2px">${state.card.audioLabel}</div><div style="margin-top:4px; color: rgba(255,255,255,.65); font-family:'Google Sans',system-ui,-apple-system,sans-serif; font-weight:800; font-size:12px">Tap to play</div>`;
    wrap.appendChild(d);

    return wrap;
}

function generateHanziChoices(targetWord, targetPinyin, count = 5) {
    let pool = new Set();

    // We might have toned or bare pinyin. The library expects bare pinyin usually,
    // or pinyin without tones? The spec/context says "pinyinBare".
    // Let's assume input is bare pinyin (a-z).
    let query = (targetPinyin || '').toLowerCase().replace(/[^a-z]/g, '');

    // Retry loop for progressively shorter pinyin
    while (pool.size < count && query.length > 0) {
        const candidates = getCandidates(query);
        for (const c of candidates) {
            if (c !== targetWord) {
                pool.add(c);
            }
            if (pool.size >= count) break;
        }
        if (pool.size < count) {
            query = query.slice(0, -1);
        }
    }

    let result = Array.from(pool);

    // Fill if still not enough? (Highly unlikely with single letter fallback, unless library empty)

    result.push(targetWord);

    // Shuffle
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

export function nextCard() {
    if (!state.wordlist || state.wordlist.length === 0) {
        // Empty state
        state.card.word = null;
        state.card.id = '';
        renderFront();
        resetAllBack();
        return;
    }

    // Pick random word
    const item = state.wordlist[Math.floor(Math.random() * state.wordlist.length)];

    // Pick random front
    const front = FRONT_ORDER[Math.floor(Math.random() * FRONT_ORDER.length)];

    // Use stored id, or generate on-the-fly for legacy wordlists without ids
    state.card.id = item.id || generateWordId(item.word, item.pinyinToned);
    state.card.word = item.word;
    state.card.pinyinToned = item.pinyinToned;
    state.card.pinyinBare = item.pinyinBare;
    state.card.tones = item.tones;
    state.card.meaning = item.meaning;
    state.card.front = front;

    // For audio front, we should label it?
    // Already handled by renderFront logic logic

    renderFront();
    resetAllBack();
}

export function renderFront() {
    // Handle empty state
    if (!state.card.word) {
        const body = $('#frontBody');
        const fl = $('#frontLabel');
        const fh = $('#frontHint');
        if (fl) fl.textContent = 'Mandalore';
        if (fh) fh.textContent = '';
        if (body) {
            body.innerHTML = '<div style="font-size:16px; color:rgba(255,255,255,0.7)">No words loaded.<br>Go to Settings to import a wordlist.</div>';
        }
        return;
    }

    const f = state.card.front;
    const fl = $('#frontLabel');
    const fh = $('#frontHint');
    const body = $('#frontBody');
    if (!fl || !fh || !body) return;

    fl.textContent = FRONT_LABEL[f];
    fh.textContent = FRONT_HINT[f];
    body.innerHTML = '';

    if (f === 'hanzi') {
        const d = document.createElement('div');
        d.className = 'front-hanzi';
        d.textContent = state.card.word;
        body.appendChild(d);
    } else if (f === 'meaning') {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '16px';
        
        const d = document.createElement('div');
        d.className = 'front-meaning';
        // Capitalize first letter of English definition
        const meaning = state.card.meaning || '';
        d.textContent = meaning.charAt(0).toUpperCase() + meaning.slice(1);
        container.appendChild(d);
        
        // Add image if available
        const imageUrl = getImageAssetUrl(state.card.id, state.card.word);
        if (imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.style.maxWidth = '120px';
            img.style.maxHeight = '120px';
            img.style.borderRadius = '12px';
            img.style.objectFit = 'cover';
            img.style.border = '1px solid rgba(255, 255, 255, .12)';
            img.alt = state.card.meaning;
            container.appendChild(img);
        }
        
        body.appendChild(container);
    } else if (f === 'pinyin') {
        const d = document.createElement('div');
        d.className = 'front-pinyin';
        d.textContent = state.card.pinyinToned;
        body.appendChild(d);
    } else {
        // Pronunciation front - autoplay audio
        const wrap = createAudioButton(state.card.id, state.card.word, true);
        body.appendChild(wrap);
    }

    const dot = $('#frontBadge .dot');
    if (dot) {
        const c = { hanzi: 'var(--cyan)', pronunciation: 'var(--green)', pinyin: 'var(--purple)', meaning: 'var(--orange)' }[f];
        dot.style.background = c;
    }
}

function resetModality(modCard) {
    if (!modCard) return;
    
    // Reset state to input
    modCard.dataset.state = 'input';
    modCard.classList.remove('is-correct');
    
    // Reset pron-block states
    $$('.pron-block', modCard).forEach(block => {
        block.dataset.pronState = 'input';
    });
    
    // Clear inputs and choices
    $$('[data-choice]', modCard).forEach(b => {
        b.dataset.picked = 'false';
        delete b.dataset.grade;
    });
    $$('input', modCard).forEach(i => { i.value = ''; });
    
    // Clear result indicators
    $$('.checked-result', modCard).forEach(r => { 
        r.classList.remove('good', 'bad'); 
    });
    
    // Clear answer content
    $$('.checked-answer', modCard).forEach(a => { a.innerHTML = ''; });
    $$('.checked-audio', modCard).forEach(a => { a.innerHTML = ''; });
    
    // Re-enable grade buttons
    $$('.btn-grade', modCard).forEach(btn => { btn.disabled = false; });

    // If hanzi mod, repopulate choices using IME
    if (modCard.id === 'modHanzi' && state.card.word && state.card.pinyinBare) {
        const choicesInDOM = $$('[data-choice]', modCard);

        const options = generateHanziChoices(
            state.card.word,
            state.card.pinyinBare,
            choicesInDOM.length - 1
        );

        choicesInDOM.forEach((b, i) => {
            if (options[i]) {
                b.textContent = options[i];
                b.style.display = 'block';
            } else {
                b.style.display = 'none';
            }
        });
    }
}

export function resetAllBack() {
    // Map front types to mod-card selectors
    const frontToMod = {
        'pronunciation': '#modPron',
        'pinyin': '#modPinyin',
        'hanzi': '#modHanzi',
        'meaning': '#modMeaning'
    };
    
    // Hide the front modality, show all others
    const allMods = ['#modPron', '#modPinyin', '#modHanzi', '#modMeaning'];
    const frontMod = state.card.front ? frontToMod[state.card.front] : null;
    
    allMods.forEach(sel => {
        const modCard = $(sel);
        if (modCard) {
            // Hide if it's the front modality, show otherwise
            if (sel === frontMod) {
                modCard.style.display = 'none';
            } else {
                modCard.style.display = ''; // Remove inline style to use default CSS
                resetModality(modCard);
            }
        }
    });
}

export function cycleFront() {
    // Legacy: used to just cycle. Now handled by nextCard randomly.
    // But if we want to "reveal" we don't cycle front.
    // The "NEXT" button should trigger nextCard().
    nextCard();
}

function showResult(modCard, ok, msg, role) {
    const result = modCard ? $(`[data-role="${role}Result"]`, modCard) : null;
    const textEl = modCard ? $(`[data-role="${role}Msg"]`, modCard) : null;
    if (!result) return;
    result.classList.toggle('good', !!ok);
    result.classList.toggle('bad', !ok);
    if (textEl) textEl.textContent = msg;
}

function wireSoundButtons(scope = document) {
    scope.querySelectorAll('.sound').forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        if (btn.dataset.bound === 'true') return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', async () => {
            btn.animate(
                [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
                { duration: 220, easing: 'ease-out' }
            );
            // Try asset first, fallback to TTS
            if (!(await playAudioAsset(state.card.id, state.card.word))) {
                speak(state.card.word);
            }
        });
    });
}

// Pronunciation: Tone
function checkTone(modCard) {
    const inputEl = $('[data-input="tone"]', modCard);
    const ans = $('[data-role="toneAnswer"]', modCard);
    const toneBlock = $('.pron-tone', modCard);
    if (!inputEl || !ans || !toneBlock) return;

    const input = inputEl.value.trim().replace(/\\s+/g, '');
    const correct = state.card.tones || '';
    const ok = (input === correct);
    
    // Switch to checked state
    toneBlock.dataset.pronState = 'checked';
    
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'tone');
    bumpSession(ok ? 1 : 0);

    ans.innerHTML = `<strong>Tones:</strong> ${correct}`;
}

// Pronunciation: Speak
function checkSpeech(modCard) {
    const audioContainer = $('[data-role="speechAnswer"]', modCard);
    const speakBlock = $('.pron-speak', modCard);
    if (!audioContainer || !speakBlock) return;
    
    // Switch to checked state
    speakBlock.dataset.pronState = 'checked';
    
    // Create audio button with autoplay
    audioContainer.innerHTML = '';
    const audioWrap = createAudioButton(state.card.id, state.card.word, true);
    // Compact label
    const divs = audioWrap.querySelectorAll('div');
    if (divs.length > 1) {
        const labelDiv = divs[1];
        labelDiv.innerHTML = `<div style="font-family:'Google Sans',system-ui,-apple-system,sans-serif; font-weight:950; font-size:14px">Listen</div>`;
    }
    audioContainer.appendChild(audioWrap);
}

// Pinyin spelling - Look, Cover, Write, Check, Repeat
function checkPinyin(modCard) {
    const inputEl = $('[data-input="pinyin"]', modCard);
    const ans = $('[data-role="pinyinAnswer"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim().toLowerCase();
    const correct = state.card.pinyinBare || '';
    const ok = (input === correct);
    
    // Switch to checked state
    modCard.dataset.state = 'checked';
    
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'pinyin');
    ans.innerHTML = `<strong>Answer:</strong> ${correct}`;
    
    if (ok) {
        modCard.classList.add('is-correct');
        bumpSession(1);
    }
    // If wrong, Cover button is visible and allows retry
}

// Cover the answer and allow retry (Look, Cover, Write, Check, Repeat)
function coverPinyin(modCard) {
    const inputEl = $('[data-input="pinyin"]', modCard);
    
    // Switch back to input state
    modCard.dataset.state = 'input';
    
    // Clear input for retry
    if (inputEl) {
        inputEl.value = '';
        inputEl.focus();
    }
    
    // Clear result indicator
    const result = $('[data-role="pinyinResult"]', modCard);
    if (result) {
        result.classList.remove('good', 'bad');
    }
}

// Hanzi: pick
function pickHanzi(modCard, btn) {
    if (!modCard || !btn) return;

    const all = $$('[data-choice]', modCard);
    const correctText = state.card.word;
    const correctBtn = all.find(b => b.textContent.trim() === correctText) || null;

    all.forEach(b => {
        b.dataset.picked = 'false';
        delete b.dataset.grade;
    });

    const ok = (btn.textContent.trim() === correctText);
    btn.dataset.picked = 'true';

    if (ok) {
        btn.dataset.grade = 'correct';
    } else {
        btn.dataset.grade = 'wrong';
        if (correctBtn) correctBtn.dataset.grade = 'correct';
    }

    // Switch to checked state (shows result in header)
    modCard.dataset.state = 'checked';
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'hanzi');
    bumpSession(ok ? 1 : 0);
}

// Meaning: check then self-grade
function checkMeaning(modCard) {
    const ans = $('[data-role="meaningAnswer"]', modCard);
    if (!ans) return;
    
    // Switch to checked state
    modCard.dataset.state = 'checked';
    
    // Build answer content
    let content = `<strong>${state.card.meaning}</strong>`;
    
    // Add image thumbnail if available
    const imageUrl = getImageAssetUrl(state.card.id, state.card.word);
    if (imageUrl) {
        content = `<img src="${imageUrl}" alt="" style="width:28px; height:28px; border-radius:6px; object-fit:cover; margin-right:8px; vertical-align:middle" />${content}`;
    }
    
    ans.innerHTML = content;
}

function selfGrade(modCard, ok, role) {
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', role);
    bumpSession(ok ? 1 : 0);
    
    // Disable grade buttons after selection
    const selfContainer = $(`[data-role="${role}Self"]`, modCard);
    if (selfContainer) {
        $$('.btn-grade', selfContainer).forEach(btn => { btn.disabled = true; });
    }
}

export function bindModality(modCard) {
    if (!modCard) return;
    modCard.addEventListener('click', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;

        if (state.card.word === null) return; // Disable interactions if empty

        if (t.matches('[data-action="checkTone"]')) return checkTone(modCard);
        if (t.matches('[data-action="checkSpeech"]')) return checkSpeech(modCard);
        if (t.matches('[data-action="checkPinyin"]')) return checkPinyin(modCard);
        if (t.matches('[data-action="coverPinyin"]')) return coverPinyin(modCard);
        if (t.matches('[data-action="checkMeaning"]')) return checkMeaning(modCard);

        if (t.matches('[data-action="selfRight"]')) {
            const role = t.closest('[data-role="speechSelf"]') ? 'speech' : 'meaning';
            return selfGrade(modCard, true, role);
        }
        if (t.matches('[data-action="selfWrong"]')) {
            const role = t.closest('[data-role="speechSelf"]') ? 'speech' : 'meaning';
            return selfGrade(modCard, false, role);
        }

        if (t.matches('[data-choice]')) return pickHanzi(modCard, t);
    });
    
    // Add Enter key support for input fields
    modCard.addEventListener('keydown', (e) => {
        if (state.card.word === null) return; // Disable interactions if empty
        
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            const input = e.target;
            if (input.matches('[data-input="tone"]')) {
                e.preventDefault();
                checkTone(modCard);
            } else if (input.matches('[data-input="pinyin"]')) {
                e.preventDefault();
                checkPinyin(modCard);
            }
        }
    });
}
