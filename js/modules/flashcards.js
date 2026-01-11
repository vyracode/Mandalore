import { state, bumpSession } from '../state.js';
import { $, $$, getAssetUrl, hasAsset } from './utils.js';
import getCandidates from '../lib/pinyin-ime.esm.js';

const FRONT_ORDER = ['hanzi', 'pronunciation', 'pinyin', 'meaning'];
const FRONT_LABEL = { hanzi: 'Hanzi', pronunciation: 'Audio', pinyin: 'Pinyin', meaning: 'Meaning' };
const FRONT_HINT = { hanzi: 'Recognize the word', pronunciation: 'Recognize the sound', pinyin: 'Recognize the spelling', meaning: 'Recall the Mandarin' };

function speak(text) {
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.8;
    window.speechSynthesis.speak(u);
}

function playAudioAsset(word) {
    // Try different audio extensions
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'aac'];
    for (const ext of audioExts) {
        const url = getAssetUrl(word, ext, state.assetCache);
        if (url) {
            const audio = new Audio(url);
            audio.play().catch(e => console.error('Failed to play audio:', e));
            return true;
        }
    }
    return false;
}

function getImageAssetUrl(word) {
    // Try different image extensions
    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    for (const ext of imageExts) {
        const url = getAssetUrl(word, ext, state.assetCache);
        if (url) return url;
    }
    return null;
}

function createAudioButton(word, autoplay = false) {
    const wrap = document.createElement('div');
    wrap.className = 'front-audio';

    const btn = document.createElement('button');
    btn.className = 'sound';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Play pronunciation');
    btn.innerHTML = '<div class="waves" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
    
    const playAudio = () => {
        btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
        // Try asset first, fallback to TTS
        if (!playAudioAsset(word)) {
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
        renderFront();
        resetAllBack();
        return;
    }

    // Pick random word
    const item = state.wordlist[Math.floor(Math.random() * state.wordlist.length)];

    // Pick random front
    const front = FRONT_ORDER[Math.floor(Math.random() * FRONT_ORDER.length)];

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
        d.textContent = state.card.meaning;
        container.appendChild(d);
        
        // Add image if available
        const imageUrl = getImageAssetUrl(state.card.word);
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
        const wrap = createAudioButton(state.card.word, true);
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
    $$('[data-choice]', modCard).forEach(b => b.dataset.picked = 'false');
    $$('input', modCard).forEach(i => { i.value = ''; });
    $$('[data-role$="Result"]', modCard).forEach(r => { r.style.display = 'none'; r.classList.remove('good', 'bad'); });
    $$('[data-role$="Answer"]', modCard).forEach(a => { a.style.display = 'none'; a.innerHTML = ''; });
    $$('[data-role$="Self"]', modCard).forEach(s => { s.style.display = 'none'; });
    $$('.selfgrade', modCard).forEach(s => { s.style.display = 'none'; });
    // Remove any cover buttons (for Look, Cover, Write, Check, Repeat)
    $$('[data-action="coverPinyin"]', modCard).forEach(btn => btn.remove());

    // clear hanzi grades
    $$('[data-choice]', modCard).forEach(b => { delete b.dataset.grade; });

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
    ['#modPron', '#modPinyin', '#modHanzi', '#modMeaning'].forEach(sel => resetModality($(sel)));
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
    result.style.display = 'flex';
    result.classList.toggle('good', !!ok);
    result.classList.toggle('bad', !ok);
    if (textEl) textEl.textContent = msg;
}

function wireSoundButtons(scope = document) {
    scope.querySelectorAll('.sound').forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        if (btn.dataset.bound === 'true') return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', () => {
            btn.animate(
                [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
                { duration: 220, easing: 'ease-out' }
            );
            // Try asset first, fallback to TTS
            if (!playAudioAsset(state.card.word)) {
                speak(state.card.word);
            }
        });
    });
}

// Pronunciation: Tone
function checkTone(modCard) {
    const inputEl = $('[data-input="tone"]', modCard);
    const ans = $('[data-role="toneAnswer"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim().replace(/\\s+/g, '');
    const correct = state.card.tones || '';
    const ok = (input === correct);
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'tone');
    bumpSession(ok ? 1 : 0);

    ans.style.display = 'block';
    ans.innerHTML = `<strong>Tones:</strong> <span>${correct}</span>`;
}

// Pronunciation: Speak
function checkSpeech(modCard) {
    const a = $('[data-role="speechAnswer"]', modCard);
    const sg = $('[data-role="speechSelf"]', modCard);
    if (a) {
        a.style.display = 'block';
        a.innerHTML = '';
        // Use createAudioButton with autoplay for reveal
        const audioWrap = createAudioButton(state.card.word, true);
        // Update label
        const labelDiv = audioWrap.querySelector('div');
        if (labelDiv) {
            labelDiv.innerHTML = `<div style="font-family:'Google Sans',system-ui,-apple-system,sans-serif; font-weight:950; font-size:16px; letter-spacing:.2px">Example audio</div><div style="margin-top:4px; color: rgba(255,255,255,.65); font-family:'Google Sans',system-ui,-apple-system,sans-serif; font-weight:800; font-size:12px">Tap to play</div>`;
        }
        a.appendChild(audioWrap);
    }
    if (sg) sg.style.display = 'flex';
}

// Pinyin spelling - Look, Cover, Write, Check, Repeat
function checkPinyin(modCard) {
    const inputEl = $('[data-input="pinyin"]', modCard);
    const ans = $('[data-role="pinyinAnswer"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim().toLowerCase();
    const correct = state.card.pinyinBare || '';
    const ok = (input === correct);
    
    if (ok) {
        // Correct! Show success and bump session
        showResult(modCard, ok, 'Right', 'pinyin');
        bumpSession(1);
        ans.style.display = 'block';
        ans.innerHTML = `<strong>Answer:</strong> <span>${correct}</span>`;
        // Remove any cover button if it exists
        const coverBtn = $('[data-action="coverPinyin"]', modCard);
        if (coverBtn) coverBtn.remove();
    } else {
        // Wrong - Show answer with "Cover" button for Look, Cover, Write, Check, Repeat
        showResult(modCard, ok, 'Wrong', 'pinyin');
        ans.style.display = 'block';
        ans.innerHTML = `
            <div style="margin-bottom: 8px;"><strong>Answer:</strong> <span>${correct}</span></div>
            <button class="btn" data-action="coverPinyin" type="button">Cover</button>
        `;
        // Don't bump session yet - wait until they get it right
    }
}

// Cover the answer and allow retry (Look, Cover, Write, Check, Repeat)
function coverPinyin(modCard) {
    const inputEl = $('[data-input="pinyin"]', modCard);
    const ans = $('[data-role="pinyinAnswer"]', modCard);
    const coverBtn = $('[data-action="coverPinyin"]', modCard);
    
    if (inputEl) {
        inputEl.value = ''; // Clear input for retry
        inputEl.focus(); // Focus the input
    }
    if (ans) {
        ans.style.display = 'none'; // Hide the answer
    }
    if (coverBtn) {
        coverBtn.remove(); // Remove cover button
    }
    // Clear the result display
    const result = $('[data-role="pinyinResult"]', modCard);
    if (result) {
        result.style.display = 'none';
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

    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'hanzi');
    bumpSession(ok ? 1 : 0);

    const ans = $('[data-role="hanziAnswer"]', modCard);
    if (ans) {
        ans.style.display = 'block';
        ans.innerHTML = `<strong>Answer:</strong> <span style="font-size:18px">${correctText}</span>`;
    }
}

// Meaning: check then self-grade
function checkMeaning(modCard) {
    const ans = $('[data-role="meaningAnswer"]', modCard);
    const sg = $('[data-role="meaningSelf"]', modCard);
    if (ans) {
        ans.style.display = 'block';
        
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '16px';
        
        const textDiv = document.createElement('div');
        textDiv.innerHTML = `<strong>Answer:</strong> ${state.card.meaning}`;
        container.appendChild(textDiv);
        
        // Add image if available
        const imageUrl = getImageAssetUrl(state.card.word);
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
        
        ans.innerHTML = '';
        ans.appendChild(container);
    }
    if (sg) sg.style.display = 'flex';
}

function selfGrade(modCard, ok, role) {
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', role);
    bumpSession(ok ? 1 : 0);
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
}
