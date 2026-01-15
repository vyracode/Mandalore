import { state, bumpSession, saveState } from '../state.js';
import { $, $$ } from './utils.js';
import getCandidates from '../lib/pinyin-ime.esm.js';
import { generateWordId } from './wordId.js';
import { getCardKey, getOrCreateCard, getNextCard, recordReview } from './fsrs.js';

const FRONT_ORDER = ['hanzi', 'pronunciation', 'meaning'];
const FRONT_LABEL = { hanzi: 'Hanzi', pronunciation: 'Audio', pinyin: 'Pinyin', meaning: 'Meaning' };
const FRONT_HINT = { hanzi: 'Recognize the word', pronunciation: 'Recognize the sound', pinyin: 'Recognize the spelling', meaning: 'Recall the Mandarin' };

// Track if user has separated inputs for current card (resets on next card)
let inputsSeparated = false;

// Track card performance for FSRS review
let cardPerformance = {
    gradedModalities: {}, // modality -> ok (true/false)
    selfGradedModalities: {} // modality -> ok (true/false/undefined)
};

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
    // Record review for previous card if it exists
    if (state.card.word && state.card.id) {
        recordCardReview();
    }
    
    // Reset separated state for new card
    inputsSeparated = false;
    
    if (!state.wordlist || state.wordlist.length === 0) {
        // Empty state
        state.card.word = null;
        state.card.id = '';
        renderFront();
        resetAllBack();
        return;
    }

    // Use FSRS to get the next card to review
    const next = getNextCard(state.wordlist, state.fsrsCards);
    
    if (!next) {
        // Fallback to random if FSRS fails
        const item = state.wordlist[Math.floor(Math.random() * state.wordlist.length)];
        const front = FRONT_ORDER[Math.floor(Math.random() * FRONT_ORDER.length)];
        
        state.card.id = item.id || generateWordId(item.word, item.pinyinToned);
        state.card.word = item.word;
        state.card.pinyinToned = item.pinyinToned;
        state.card.pinyinBare = item.pinyinBare;
        state.card.tones = item.tones;
        state.card.meaning = item.meaning;
        state.card.front = front;
    } else {
        // Use FSRS-selected card
        const item = next.word;
        const front = next.front;
        
        state.card.id = item.id || generateWordId(item.word, item.pinyinToned);
        state.card.word = item.word;
        state.card.pinyinToned = item.pinyinToned;
        state.card.pinyinBare = item.pinyinBare;
        state.card.tones = item.tones;
        state.card.meaning = item.meaning;
        state.card.front = front;
        
        // Store the FSRS card for this word+front combination
        const cardKey = getCardKey(state.card.id, front);
        state.fsrsCards[cardKey] = next.card;
    }

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
    
    // Reset Hanzi Typing validation state
    if (modCard.id === 'modHanziTyping') {
        validateHanziTypingInput(modCard);
    }
}

/**
 * Record FSRS review for the current card based on performance
 */
function recordCardReview() {
    if (!state.card.word || !state.card.id || !state.card.front) return;
    
    // Determine overall performance
    // Good (Right) if all graded modalities passed
    // Again (Wrong) if any graded modality failed
    let allGradedPassed = true;
    const gradedKeys = Object.keys(cardPerformance.gradedModalities);
    
    if (gradedKeys.length === 0) {
        // No graded modalities completed, don't record review
        // (User might have skipped the card without answering)
        return;
    }
    
    // Check if all graded modalities passed
    for (const modality of gradedKeys) {
        if (cardPerformance.gradedModalities[modality] !== true) {
            allGradedPassed = false;
            break;
        }
    }
    
    // Get or create FSRS card
    const cardKey = getCardKey(state.card.id, state.card.front);
    let fsrsCard = getOrCreateCard(state.card.id, state.card.front, state.fsrsCards);
    
    if (!fsrsCard) {
        // FSRS library might not be loaded, skip recording
        console.warn('FSRS card creation failed, skipping review recording');
        return;
    }
    
    // Record review: 3 = Good (Right), 1 = Again (Wrong)
    const rating = allGradedPassed ? 3 : 1;
    const result = recordReview(fsrsCard, new Date(), rating);
    
    if (result && result.card) {
        // Update stored card
        state.fsrsCards[cardKey] = result.card;
        saveState();
        // Note: FSRS stats will update when user switches to settings tab
    } else {
        console.warn('FSRS review recording failed');
    }
    
    // Reset performance tracking
    cardPerformance = {
        gradedModalities: {},
        selfGradedModalities: {}
    };
}

export function resetAllBack() {
    // Map front types to mod-card selectors
    const frontToMod = {
        'pronunciation': '#modPron',
        'pinyin': '#modPinyin',
        'hanzi': '#modHanzi',
        'meaning': '#modMeaning'
    };
    
    // Check if both Hanzi and Pinyin should be on the back
    // This happens when front is 'pronunciation' or 'meaning'
    const front = state.card.front;
    const showHanziTyping = (front === 'pronunciation' || front === 'meaning') && !inputsSeparated;
    
    // Hide the front modality, show all others
    const allMods = ['#modPron', '#modPinyin', '#modHanzi', '#modMeaning', '#modHanziTyping'];
    const frontMod = state.card.front ? frontToMod[state.card.front] : null;
    
    allMods.forEach(sel => {
        const modCard = $(sel);
        if (!modCard) return;
        
        if (sel === frontMod) {
            // Hide the front modality
            modCard.style.display = 'none';
        } else if (sel === '#modHanziTyping') {
            // Show Hanzi Typing only when both Hanzi and Pinyin are on back and not separated
            if (showHanziTyping) {
                modCard.style.display = '';
                resetModality(modCard);
            } else {
                modCard.style.display = 'none';
            }
        } else if ((sel === '#modHanzi' || sel === '#modPinyin') && showHanziTyping) {
            // Hide individual Hanzi and Pinyin when showing Hanzi Typing
            modCard.style.display = 'none';
        } else {
            modCard.style.display = '';
            resetModality(modCard);
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
    
    // Track performance for FSRS
    cardPerformance.gradedModalities['tone'] = ok;
    
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
    
    // Track performance for FSRS (only record initial attempt)
    if (cardPerformance.gradedModalities['pinyin'] === undefined) {
        cardPerformance.gradedModalities['pinyin'] = ok;
    }
    
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
    
    // Don't reset performance tracking - FSRS only counts initial attempt
    // The cover-write-check loop is for practice only
    
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
    
    // Track performance for FSRS
    cardPerformance.gradedModalities['hanzi'] = ok;
    
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
    // Track performance for FSRS (self-graded modalities)
    cardPerformance.selfGradedModalities[role] = ok;
    
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', role);
    bumpSession(ok ? 1 : 0);
    
    // Disable grade buttons after selection
    const selfContainer = $(`[data-role="${role}Self"]`, modCard);
    if (selfContainer) {
        $$('.btn-grade', selfContainer).forEach(btn => { btn.disabled = true; });
    }
}

// Hanzi Typing: combined Hanzi + Pinyin test
function checkHanziTyping(modCard) {
    const inputEl = $('[data-input="hanziTyping"]', modCard);
    const ans = $('[data-role="hanziTypingAnswer"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim();
    const correct = state.card.word || '';
    const ok = (input === correct);
    
    // Switch to checked state
    modCard.dataset.state = 'checked';
    
    // Track performance for FSRS (only record initial attempt)
    // hanziTyping tests both hanzi and pinyin
    if (cardPerformance.gradedModalities['hanziTyping'] === undefined) {
        cardPerformance.gradedModalities['hanziTyping'] = ok;
    }
    
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'hanziTyping');
    ans.innerHTML = `<strong>Answer:</strong> ${correct} <span style="color: rgba(255,255,255,.5); margin-left: 8px">(${state.card.pinyinBare || ''})</span>`;
    
    if (ok) {
        modCard.classList.add('is-correct');
        // Hanzi Typing tests both Hanzi recognition and Pinyin spelling, so count as 2
        bumpSession(2);
    }
    // If wrong, Cover button is visible and allows retry
}

// Cover the answer and allow retry for Hanzi Typing
function coverHanziTyping(modCard) {
    const inputEl = $('[data-input="hanziTyping"]', modCard);
    
    // Switch back to input state
    modCard.dataset.state = 'input';
    
    // Don't reset performance tracking - FSRS only counts initial attempt
    // The cover-write-check loop is for practice only
    
    // Clear input for retry
    if (inputEl) {
        inputEl.value = '';
        inputEl.focus();
        // Re-check for latin characters after clearing
        validateHanziTypingInput(modCard);
    }
    
    // Clear result indicator
    const result = $('[data-role="hanziTypingResult"]', modCard);
    if (result) {
        result.classList.remove('good', 'bad');
    }
}

/**
 * Check if input contains latin characters and show reminder/disable check button
 */
function validateHanziTypingInput(modCard) {
    const inputEl = $('[data-input="hanziTyping"]', modCard);
    const checkBtn = $('#btnCheckHanziTyping', modCard) || $('[data-action="checkHanziTyping"]', modCard);
    const hintEl = $('#hanziTypingHint', modCard);
    
    if (!inputEl) return;
    
    const value = inputEl.value;
    // Check for latin characters (a-z, A-Z)
    const hasLatinChars = /[a-zA-Z]/.test(value);
    
    if (hasLatinChars) {
        // Show polite reminder
        if (hintEl) {
            hintEl.textContent = 'This field is for typing Hanzi characters. Please use a Pinyin keyboard to input Hanzi.';
            hintEl.style.display = 'block';
        }
        // Disable check button
        if (checkBtn) {
            checkBtn.disabled = true;
        }
    } else {
        // Hide reminder
        if (hintEl) {
            hintEl.style.display = 'none';
        }
        // Enable check button
        if (checkBtn) {
            checkBtn.disabled = false;
        }
    }
}

// Separate into individual Hanzi choice and Pinyin spelling inputs
function separateInputs() {
    inputsSeparated = true;
    resetAllBack();
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
        if (t.matches('[data-action="checkHanziTyping"]')) return checkHanziTyping(modCard);
        if (t.matches('[data-action="coverHanziTyping"]')) return coverHanziTyping(modCard);
        if (t.matches('[data-action="separateInputs"]')) return separateInputs();

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
            } else if (input.matches('[data-input="hanziTyping"]')) {
                e.preventDefault();
                // Only allow check if no latin characters
                const checkBtn = $('#btnCheckHanziTyping', modCard) || $('[data-action="checkHanziTyping"]', modCard);
                if (checkBtn && !checkBtn.disabled) {
                    checkHanziTyping(modCard);
                }
            }
        }
    });
    
    // Add input validation for Hanzi Typing
    if (modCard.id === 'modHanziTyping') {
        const inputEl = $('[data-input="hanziTyping"]', modCard);
        if (inputEl) {
            inputEl.addEventListener('input', () => validateHanziTypingInput(modCard));
            // Initial validation
            validateHanziTypingInput(modCard);
        }
    }
}
