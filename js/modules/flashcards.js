import { state, bumpSession, saveState, incrementDailySupercardCount, getDailySupercardCount } from '../state.js';
import { $, $$ } from './utils.js';
import getCandidates from '../lib/pinyin-ime.esm.js';
import { generateWordId } from './wordId.js';
import { getSubcardKey, getOrCreateSubcard, getNextSupercard, recordReview, getBackModesForFront, commitSupercardSelection } from './fsrs.js';

const FRONT_ORDER = ['hanzi', 'pronunciation', 'meaning'];
export const FRONT_LABEL = { hanzi: 'Hanzi', pronunciation: 'Audio', pinyin: 'Pinyin', meaning: 'Meaning' };
const FRONT_HINT = { hanzi: 'Recognize the word', pronunciation: 'Recognize the sound', pinyin: 'Recognize the spelling', meaning: 'Recall the Mandarin' };

// Track if user has separated inputs for current card (resets on next card)
let inputsSeparated = false;

// Track card performance for FSRS review
let cardPerformance = {
    gradedModalities: {}, // modality -> ok (true/false)
    selfGradedModalities: {} // modality -> ok (true/false/undefined)
};

// Track which subcards have been recorded to avoid double-recording
let recordedSubcards = new Set(); // Set of subcard keys (wordId_front_backMode)

// Track if we've already counted this supercard to avoid double-counting
let currentSupercardCounted = false;

// Track current card's pool name for deferred state updates
let currentCardPoolName = null;

// Track if write-cover tests have been completed correctly (first correct answer)
let writeCoverCompleted = {
    pinyin: false,
    hanziTyping: false
};

// Track user's first answer for finished state display
let firstAnswers = {
    pinyin: null,
    hanziTyping: null,
    hanzi: null,
    tone: null
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
    console.log('FSRS subcards count:', Object.keys(state.fsrsSubcards || {}).length);
    
    // Reset separated state for new card
    inputsSeparated = false;
    
    // Reset recorded subcards tracking for new card
    recordedSubcards.clear();
    
    // Reset supercard counting flag for new card
    currentSupercardCounted = false;
    
    // Reset pool name tracking for new card
    currentCardPoolName = null;
    
    // Reset performance tracking for new card
    cardPerformance = {
        gradedModalities: {},
        selfGradedModalities: {}
    };
    
    // Reset write-cover completion tracking
    writeCoverCompleted = {
        pinyin: false,
        hanziTyping: false
    };
    
    // Reset first answers tracking
    firstAnswers = {
        pinyin: null,
        hanziTyping: null,
        hanzi: null,
        tone: null
    };
    
    if (!state.wordlist || state.wordlist.length === 0) {
        // Empty state
        console.log('Empty wordlist, showing empty state');
        state.card.word = null;
        state.card.id = '';
        state.lastWordId = '';
        renderFront();
        resetAllBack();
        return;
    }

    // Use FSRS to get the next supercard to review (excluding last word shown)
    const next = getNextSupercard(state.wordlist, state.fsrsSubcards, state.lastWordId);
    
    if (!next) {
        // Fallback to random if FSRS fails (avoiding last word if possible)
        let availableWords = state.wordlist;
        if (state.lastWordId && state.wordlist.length > 1) {
            availableWords = state.wordlist.filter(w => {
                const wordId = w.id || generateWordId(w.word, w.pinyinToned);
                return wordId !== state.lastWordId;
            });
            // If filtering removed all words, use original list
            if (availableWords.length === 0) {
                availableWords = state.wordlist;
            }
        }
        
        console.log('Using random fallback. Available words:', availableWords.length);
        const item = availableWords[Math.floor(Math.random() * availableWords.length)];
        const front = FRONT_ORDER[Math.floor(Math.random() * FRONT_ORDER.length)];
        
        state.card.id = item.id || generateWordId(item.word, item.pinyinToned);
        state.card.word = item.word;
        state.card.pinyinToned = item.pinyinToned;
        state.card.pinyinBare = item.pinyinBare;
        state.card.tones = item.tones;
        state.card.meaning = item.meaning;
        state.card.front = front;
        
        // Set fallback pool name (don't update lastWordId until completion)
        currentCardPoolName = 'FALLBACK';
        
        console.log('Selected random card:', {
            wordId: state.card.id,
            word: state.card.word,
            front: state.card.front
        });
    } else {
        // Use FSRS-selected supercard
        const item = next.word;
        const front = next.front;
        
        state.card.id = item.id || generateWordId(item.word, item.pinyinToned);
        state.card.word = item.word;
        state.card.pinyinToned = item.pinyinToned;
        state.card.pinyinBare = item.pinyinBare;
        state.card.tones = item.tones;
        state.card.meaning = item.meaning;
        state.card.front = front;
        
        // Store pool name for deferred commit (don't update lastWordId until completion)
        currentCardPoolName = next.poolName;
        
        console.log('Selected FSRS card:', {
            wordId: state.card.id,
            word: state.card.word,
            front: state.card.front
        });
        
        const backModes = getBackModesForFront(front);
    }

    renderFront();
    resetAllBack();
}

/**
 * Calculate total number of supercards (words * 3 front types)
 */
function getTotalSupercards() {
    if (!state.wordlist || state.wordlist.length === 0) {
        return 0;
    }
    const FRONT_TYPES = ['hanzi', 'pronunciation', 'meaning'];
    return state.wordlist.length * FRONT_TYPES.length;
}

/**
 * Update the daily supercard counter display
 */
export function updateDailySupercardCounter() {
    const counterEl = $('#dailySupercardCounter');
    if (counterEl) {
        const dailyCount = getDailySupercardCount();
        const totalSupercards = getTotalSupercards();
        counterEl.textContent = `${dailyCount}/${totalSupercards}`;
    }
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
        updateDailySupercardCounter();
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
    
    updateDailySupercardCounter();
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
    $$('input', modCard).forEach(i => { 
        i.value = '';
        i.disabled = false;
        i.style.opacity = '';
    });
    
    // Clear result indicators
    $$('.checked-result', modCard).forEach(r => { 
        r.classList.remove('good', 'bad', 'retries'); 
    });
    
    // Clear answer content
    $$('.checked-answer', modCard).forEach(a => { a.innerHTML = ''; });
    $$('.checked-audio', modCard).forEach(a => { a.innerHTML = ''; });
    
    // Clear finished state containers
    $$('.finished-answer', modCard).forEach(a => { a.innerHTML = ''; });
    
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
    
    // Reset validation state (disable check buttons when inputs are empty)
    if (modCard.id === 'modHanziTyping') {
        validateHanziTypingInput(modCard);
    }
    if (modCard.id === 'modPinyin') {
        validatePinyinInput(modCard);
    }
    if (modCard.id === 'modPronunciation') {
        validateToneInput(modCard);
    }
}

/**
 * Record a single subcard review immediately
 * @param {string} backMode - The back mode (hanzi, pinyin, pronunciation, meaning)
 * @param {boolean} passed - Whether the user passed this subcard
 */
function recordSubcardReview(backMode, passed) {
    if (!state.card.word || !state.card.id || !state.card.front) {
        console.log('recordSubcardReview: Missing card data, skipping');
        return;
    }
    
    const wordId = state.card.id;
    const front = state.card.front;
    const subcardKey = getSubcardKey(wordId, front, backMode);
    
    // Avoid double-recording
    if (recordedSubcards.has(subcardKey)) {
        console.log('Already recorded this subcard, skipping');
        return;
    }
    
    // Get or create subcard
    let subcard = getOrCreateSubcard(wordId, front, backMode, state.fsrsSubcards);
    
    if (!subcard) {
        console.warn(`FSRS subcard creation failed for ${subcardKey}, skipping review recording`);
        return;
    }
    
    // Record review
    const now = new Date();
    const rating = passed ? 3 : 1; // Good = 3, Again = 1
    const result = recordReview(subcard, now, rating);
    
    if (result && result.card) {
        state.fsrsSubcards[subcardKey] = result.card;
        recordedSubcards.add(subcardKey);
        saveState();
    } else {
        console.warn(`FSRS review recording failed for ${subcardKey}`);
    }
}

export function resetAllBack() {
    // Hide the bottom Next button (shown again when all modalities are finished)
    const btnNextBottom = $('#btnNextBottom');
    if (btnNextBottom) {
        btnNextBottom.style.display = 'none';
    }
    
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
    
    const modVisibility = [];
    
    allMods.forEach(sel => {
        const modCard = $(sel);
        if (!modCard) return;
        
        if (sel === frontMod) {
            // Hide the front modality
            modCard.style.display = 'none';
            modVisibility.push(`${sel}: hidden (front)`);
        } else if (sel === '#modHanziTyping') {
            // Show Hanzi Typing only when both Hanzi and Pinyin are on back and not separated
            if (showHanziTyping) {
                modCard.style.display = '';
                resetModality(modCard);
                modVisibility.push(`${sel}: visible`);
            } else {
                modCard.style.display = 'none';
                modVisibility.push(`${sel}: hidden (not combined mode)`);
            }
        } else if ((sel === '#modHanzi' || sel === '#modPinyin') && showHanziTyping) {
            // Hide individual Hanzi and Pinyin when showing Hanzi Typing
            modCard.style.display = 'none';
            modVisibility.push(`${sel}: hidden (using HanziTyping)`);
        } else {
            modCard.style.display = '';
            resetModality(modCard);
            modVisibility.push(`${sel}: visible`);
        }
    });
}

function showResult(modCard, ok, msg, role) {
    const result = modCard ? $(`[data-role="${role}Result"]`, modCard) : null;
    const textEl = modCard ? $(`[data-role="${role}Msg"]`, modCard) : null;
    if (!result) return;
    result.classList.toggle('good', !!ok);
    result.classList.toggle('bad', !ok);
    if (textEl) textEl.textContent = msg;
}

/**
 * Show the finished state for a modality
 * @param {HTMLElement} modCard - The modality card element
 * @param {string} modality - The modality name (pinyin, hanziTyping, hanzi, meaning, tone, speech)
 * @param {boolean} ok - Whether the answer was correct
 * @param {string} userAnswer - The user's answer (null if correct, shown only when wrong)
 * @param {string} correctAnswer - The correct answer
 * @param {boolean} isPronBlock - Whether this is a pronunciation block (uses data-pron-state)
 * @param {boolean} retriesNeeded - Whether retries were needed to get correct (for write-cover modes)
 */
function showFinishedState(modCard, modality, ok, userAnswer, correctAnswer, isPronBlock = false, retriesNeeded = false) {
    if (!modCard) return;
    
    // Set the finished state
    if (isPronBlock) {
        modCard.dataset.pronState = 'finished';
    } else {
        modCard.dataset.state = 'finished';
    }
    
    // Find header result indicator (Correct/Incorrect/Retries goes in header, same line as label)
    const headerResult = $(`[data-role="${modality}HeaderResult"]`, modCard);
    const headerMsg = $(`[data-role="${modality}HeaderMsg"]`, modCard);
    
    // For hanzi, the header result uses different naming (hanziResult/hanziMsg)
    const hanziHeaderResult = modality === 'hanzi' ? $(`[data-role="hanziResult"]`, modCard) : null;
    const hanziHeaderMsg = modality === 'hanzi' ? $(`[data-role="hanziMsg"]`, modCard) : null;
    
    // Set header result indicator
    const resultEl = headerResult || hanziHeaderResult;
    const msgEl = headerMsg || hanziHeaderMsg;
    
    // Determine result class and message
    // For write-cover modes: ok means finished (always correct eventually)
    // retriesNeeded distinguishes first-try correct vs correct after retries
    let resultClass, resultMsg;
    if (ok) {
        if (retriesNeeded) {
            resultClass = 'retries';
            resultMsg = 'Correct after retries';
        } else {
            resultClass = 'good';
            resultMsg = 'Correct';
        }
    } else {
        resultClass = 'bad';
        resultMsg = 'Incorrect';
    }
    
    if (resultEl) {
        resultEl.classList.remove('good', 'bad', 'retries');
        resultEl.classList.add(resultClass);
    }
    if (msgEl) {
        msgEl.textContent = resultMsg;
    }
    
    // Find finished answer container in body
    const finishedAnswer = $(`[data-role="${modality}FinishedAnswer"]`, modCard);
    
    // Build answer content
    if (finishedAnswer) {
        let html = '';
        
        if (ok && !retriesNeeded) {
            // Correct on first try: just show "Answer:"
            html += `<div class="finished-line correct-answer">
                <span class="label">Answer:</span>
                <span class="value">${escapeHtml(correctAnswer)}</span>
            </div>`;
        } else {
            // Incorrect OR correct after retries: show "Your Answer:" and "Correct Answer:"
            if (userAnswer !== null && userAnswer !== undefined) {
                html += `<div class="finished-line user-answer">
                    <span class="label">Your Answer:</span>
                    <span class="value">${escapeHtml(userAnswer)}</span>
                </div>`;
            }
            html += `<div class="finished-line correct-answer">
                <span class="label">Correct Answer:</span>
                <span class="value">${escapeHtml(correctAnswer)}</span>
            </div>`;
        }
        
        finishedAnswer.innerHTML = html;
    }
    
    // Check if all modalities are now finished
    checkAllFinished();
}

/**
 * Check if all visible modalities are in the "finished" state
 * If so, show the bottom Next button and increment daily counter
 */
function checkAllFinished() {
    const btnNextBottom = $('#btnNextBottom');
    if (!btnNextBottom) return;
    
    // Get all visible modality cards
    const allMods = ['#modPron', '#modPinyin', '#modHanzi', '#modMeaning', '#modHanziTyping'];
    let allFinished = true;
    let visibleCount = 0;
    const modStates = [];
    
    for (const sel of allMods) {
        const modCard = $(sel);
        if (!modCard) continue;
        
        // Skip hidden cards
        if (modCard.style.display === 'none') {
            modStates.push(`${sel}: hidden`);
            continue;
        }
        
        visibleCount++;
        
        // Check if this card is in finished state
        if (sel === '#modPron') {
            // Pronunciation has two blocks - both must be finished
            const toneBlock = $('.pron-tone', modCard);
            const speakBlock = $('.pron-speak', modCard);
            const toneFinished = toneBlock && toneBlock.dataset.pronState === 'finished';
            const speakFinished = speakBlock && speakBlock.dataset.pronState === 'finished';
            modStates.push(`${sel}: tone=${toneFinished}, speech=${speakFinished}`);
            if (!toneFinished || !speakFinished) {
                allFinished = false;
            }
        } else {
            const state = modCard.dataset.state;
            modStates.push(`${sel}: ${state}`);
            if (state !== 'finished') {
                allFinished = false;
            }
        }
    }
    
    // Show/hide the bottom Next button
    if (allFinished && visibleCount > 0) {
        btnNextBottom.style.display = 'flex';
        
        // Commit supercard selection when all modalities are finished
        // Only count once per supercard (tracked by currentSupercardCounted flag)
        if (!currentSupercardCounted && state.card.word && state.card.id) {
            // Commit the deferred state updates (counters, supercardLastShown, lastWordId)
            commitSupercardSelection(state.card.id, state.card.front, currentCardPoolName);
            
            incrementDailySupercardCount();
            updateDailySupercardCounter();
            currentSupercardCounted = true;
        }
    } else {
        btnNextBottom.style.display = 'none';
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    const toneBlock = $('.pron-tone', modCard);
    if (!inputEl || !toneBlock) return;

    const input = inputEl.value.trim().replace(/\\s+/g, '');
    const correct = state.card.tones || '';
    const ok = (input === correct);
    
    // Store first answer for display
    if (firstAnswers.tone === null) {
        firstAnswers.tone = input;
    }
    
    // Track performance for FSRS
    cardPerformance.gradedModalities['tone'] = ok;
    
    // Check if pronunciation subcard can be recorded (needs both tone and speech)
    const front = state.card.front;
    const backModes = getBackModesForFront(front);
    if (backModes.includes('pronunciation')) {
        const speechResult = cardPerformance.selfGradedModalities['speech'];
        if (speechResult !== undefined) {
            // Both tone and speech are complete, record pronunciation subcard
            const pronunciationPassed = (ok === true && speechResult === true);
            recordSubcardReview('pronunciation', pronunciationPassed);
        }
    }
    
    // Immediately show finished state for tone (no cover option)
    showFinishedState(toneBlock, 'tone', ok, ok ? null : input, correct, true);
    bumpSession(ok ? 1 : 0);
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
    const inputRow = $('.mod-input', modCard);
    const checkBtn = $('#btnCheckPinyin', modCard) || $('[data-action="checkPinyin"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim().toLowerCase();
    const correct = state.card.pinyinBare || '';
    const ok = (input === correct);
    
    // Store first answer for finished state display
    if (firstAnswers.pinyin === null) {
        firstAnswers.pinyin = input;
    }
    
    // Track performance for FSRS (only record initial attempt)
    if (cardPerformance.gradedModalities['pinyin'] === undefined) {
        cardPerformance.gradedModalities['pinyin'] = ok;
        
        // Record immediately if this is a pinyin subcard
        const front = state.card.front;
        const backModes = getBackModesForFront(front);
        if (backModes.includes('pinyin')) {
            // Check if we're in separated mode (pinyin tested independently)
            // or regular pinyin mode (not part of HanziTyping)
            if (inputsSeparated || !backModes.includes('hanzi')) {
                recordSubcardReview('pinyin', ok);
            }
        }
    }
    
    if (ok && !writeCoverCompleted.pinyin) {
        // First correct answer - show finished state
        writeCoverCompleted.pinyin = true;
        const retriesNeeded = cardPerformance.gradedModalities['pinyin'] === false;
        const displayUserAnswer = retriesNeeded ? firstAnswers.pinyin : null;
        // For write-cover, ok is always true when finished (they got it right eventually)
        // retriesNeeded indicates if they needed retries
        showFinishedState(modCard, 'pinyin', true, displayUserAnswer, correct, false, retriesNeeded);
        bumpSession(1);
    } else if (ok && writeCoverCompleted.pinyin) {
        // Already finished, just stay in finished state
        modCard.dataset.state = 'finished';
    } else {
        // Wrong: show checked state with cover option
        modCard.dataset.state = 'checked';
        showResult(modCard, ok, ok ? 'Correct' : 'Incorrect', 'pinyin');
        
        // Keep input visible but disabled, show answer for comparison
        if (inputRow) {
            inputRow.style.display = 'flex';
        }
        if (inputEl) {
            inputEl.disabled = true;
            inputEl.style.opacity = '0.5';
        }
        // Hide Check button since we've already checked
        if (checkBtn) {
            checkBtn.style.display = 'none';
        }
        ans.innerHTML = `<strong>Correct:</strong> ${correct}`;
    }
}

// Cover the answer and allow retry (Look, Cover, Write, Check, Repeat)
function coverPinyin(modCard) {
    // If already finished, don't allow cover
    if (writeCoverCompleted.pinyin) {
        return;
    }
    
    const inputEl = $('[data-input="pinyin"]', modCard);
    const inputRow = $('.mod-input', modCard);
    const checkBtn = $('#btnCheckPinyin', modCard) || $('[data-action="checkPinyin"]', modCard);
    
    // Switch back to input state
    modCard.dataset.state = 'input';
    
    // Don't reset performance tracking - FSRS only counts initial attempt
    // The cover-write-check loop is for practice only
    
    // Re-enable and reset input
    if (inputEl) {
        inputEl.disabled = false;
        inputEl.style.opacity = '';
        inputEl.value = '';
        inputEl.focus();
        // Re-check for Hanzi characters after clearing
        validatePinyinInput(modCard);
    }
    
    // Reset input row display (let CSS handle it)
    if (inputRow) {
        inputRow.style.display = '';
    }
    
    // Show Check button again
    if (checkBtn) {
        checkBtn.style.display = '';
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
    const userAnswer = btn.textContent.trim();

    all.forEach(b => {
        b.dataset.picked = 'false';
        delete b.dataset.grade;
    });

    const ok = (userAnswer === correctText);
    btn.dataset.picked = 'true';

    if (ok) {
        btn.dataset.grade = 'correct';
    } else {
        btn.dataset.grade = 'wrong';
        if (correctBtn) correctBtn.dataset.grade = 'correct';
    }

    // Store first answer
    if (firstAnswers.hanzi === null) {
        firstAnswers.hanzi = userAnswer;
    }
    
    // Track performance for FSRS
    cardPerformance.gradedModalities['hanzi'] = ok;
    
    // Record immediately if this is a hanzi subcard
    const front = state.card.front;
    const backModes = getBackModesForFront(front);
    if (backModes.includes('hanzi')) {
        // Check if we're in separated mode (hanzi tested independently)
        // or regular hanzi mode (not part of HanziTyping)
        if (inputsSeparated || !backModes.includes('pinyin')) {
            recordSubcardReview('hanzi', ok);
        }
    }
    
    // Show result in header (compact)
    showResult(modCard, ok, ok ? 'Correct' : 'Incorrect', 'hanzi');
    
    // Show finished state (multiple choice finishes immediately)
    showFinishedState(modCard, 'hanzi', ok, ok ? null : userAnswer, correctText);
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
    
    // Record immediately based on role
    const front = state.card.front;
    const backModes = getBackModesForFront(front);
    
    if (role === 'meaning' && backModes.includes('meaning')) {
        // Meaning subcard - record immediately
        recordSubcardReview('meaning', ok);
        
        // Show finished state for meaning
        const correctAnswer = state.card.meaning || '';
        showFinishedState(modCard, 'meaning', ok, null, correctAnswer);
    } else if (role === 'speech' && backModes.includes('pronunciation')) {
        // Speech is part of pronunciation - check if tone is also done
        const toneResult = cardPerformance.gradedModalities['tone'];
        if (toneResult !== undefined) {
            // Both tone and speech are complete, record pronunciation subcard
            const pronunciationPassed = (toneResult === true && ok === true);
            recordSubcardReview('pronunciation', pronunciationPassed);
        }
        
        // Show finished state for speech (no audio button, just result)
        const speakBlock = $('.pron-speak', modCard);
        if (speakBlock) {
            showFinishedState(speakBlock, 'speech', ok, null, 'Self-graded', true);
        }
    }
    
    bumpSession(ok ? 1 : 0);
}

// Hanzi Typing: combined Hanzi + Pinyin test
function checkHanziTyping(modCard) {
    const inputEl = $('[data-input="hanziTyping"]', modCard);
    const ans = $('[data-role="hanziTypingAnswer"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim();
    const correct = state.card.word || '';
    const correctDisplay = `${correct} (${state.card.pinyinBare || ''})`;
    const ok = (input === correct);
    
    // Store first answer for finished state display
    if (firstAnswers.hanziTyping === null) {
        firstAnswers.hanziTyping = input;
    }
    
    // Track performance for FSRS (only record initial attempt)
    // hanziTyping tests both hanzi and pinyin
    if (cardPerformance.gradedModalities['hanziTyping'] === undefined) {
        cardPerformance.gradedModalities['hanziTyping'] = ok;
        
        // Record immediately if in combined mode (tests both hanzi and pinyin together)
        const front = state.card.front;
        const backModes = getBackModesForFront(front);
        if (!inputsSeparated && backModes.includes('hanzi') && backModes.includes('pinyin')) {
            // Combined mode - record both subcards with same result
            recordSubcardReview('hanzi', ok);
            recordSubcardReview('pinyin', ok);
        }
    }
    
    if (ok && !writeCoverCompleted.hanziTyping) {
        // First correct answer - show finished state
        writeCoverCompleted.hanziTyping = true;
        const retriesNeeded = cardPerformance.gradedModalities['hanziTyping'] === false;
        const displayUserAnswer = retriesNeeded ? firstAnswers.hanziTyping : null;
        // For write-cover, ok is always true when finished (they got it right eventually)
        // retriesNeeded indicates if they needed retries
        showFinishedState(modCard, 'hanziTyping', true, displayUserAnswer, correctDisplay, false, retriesNeeded);
        // Hanzi Typing tests both Hanzi recognition and Pinyin spelling, so count as 2
        bumpSession(2);
    } else if (ok && writeCoverCompleted.hanziTyping) {
        // Already finished, just stay in finished state
        modCard.dataset.state = 'finished';
    } else {
        // Wrong: show checked state with cover option
        modCard.dataset.state = 'checked';
        showResult(modCard, ok, ok ? 'Correct' : 'Incorrect', 'hanziTyping');
        ans.innerHTML = `<strong>Answer:</strong> ${correct} <span style="color: rgba(255,255,255,.5); margin-left: 8px">(${state.card.pinyinBare || ''})</span>`;
    }
}

// Cover the answer and allow retry for Hanzi Typing
function coverHanziTyping(modCard) {
    // If already finished, don't allow cover
    if (writeCoverCompleted.hanziTyping) {
        return;
    }
    
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
    const isEmpty = value.trim() === '';
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
    } else if (isEmpty) {
        // Hide reminder but disable check button
        if (hintEl) {
            hintEl.style.display = 'none';
        }
        if (checkBtn) {
            checkBtn.disabled = true;
        }
    } else {
        // Hide reminder and enable check button
        if (hintEl) {
            hintEl.style.display = 'none';
        }
        if (checkBtn) {
            checkBtn.disabled = false;
        }
    }
}

/**
 * Check if input contains Hanzi characters and show reminder/disable check button
 */
function validatePinyinInput(modCard) {
    const inputEl = $('[data-input="pinyin"]', modCard);
    const checkBtn = $('#btnCheckPinyin', modCard) || $('[data-action="checkPinyin"]', modCard);
    const hintEl = $('#pinyinHint', modCard);
    
    if (!inputEl) return;
    
    const value = inputEl.value;
    const isEmpty = value.trim() === '';
    // Check for Hanzi characters (CJK Unified Ideographs)
    const hasHanzi = /[\u4e00-\u9fff]/.test(value);
    
    if (hasHanzi) {
        // Show polite reminder
        if (hintEl) {
            hintEl.textContent = 'This field is for typing Pinyin spelling (latin letters only). Please type the pronunciation, not the Hanzi characters.';
            hintEl.style.display = 'block';
        }
        // Disable check button
        if (checkBtn) {
            checkBtn.disabled = true;
        }
    } else if (isEmpty) {
        // Hide reminder but disable check button
        if (hintEl) {
            hintEl.style.display = 'none';
        }
        if (checkBtn) {
            checkBtn.disabled = true;
        }
    } else {
        // Hide reminder and enable check button
        if (hintEl) {
            hintEl.style.display = 'none';
        }
        if (checkBtn) {
            checkBtn.disabled = false;
        }
    }
}

/**
 * Validate tone input - disable check button if empty
 */
function validateToneInput(modCard) {
    const inputEl = $('[data-input="tone"]', modCard);
    const checkBtn = $('[data-action="checkTone"]', modCard);
    
    if (!inputEl) return;
    
    const value = inputEl.value;
    const isEmpty = value.trim() === '';
    
    if (checkBtn) {
        checkBtn.disabled = isEmpty;
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
                // Only allow check if no Hanzi characters
                const checkBtn = $('#btnCheckPinyin', modCard) || $('[data-action="checkPinyin"]', modCard);
                if (checkBtn && !checkBtn.disabled) {
                    checkPinyin(modCard);
                }
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
    
    // Add input validation for Pinyin Spelling
    if (modCard.id === 'modPinyin') {
        const inputEl = $('[data-input="pinyin"]', modCard);
        if (inputEl) {
            inputEl.addEventListener('input', () => validatePinyinInput(modCard));
            // Initial validation
            validatePinyinInput(modCard);
        }
    }
    
    // Add input validation for Tone
    if (modCard.id === 'modPronunciation') {
        const inputEl = $('[data-input="tone"]', modCard);
        if (inputEl) {
            inputEl.addEventListener('input', () => validateToneInput(modCard));
            // Initial validation
            validateToneInput(modCard);
        }
    }
}
