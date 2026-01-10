import { state, bumpSession } from '../state.js';
import { $, $$ } from './utils.js';

const FRONT_ORDER = ['hanzi', 'pronunciation', 'pinyin', 'meaning'];
const FRONT_LABEL = { hanzi: 'Hanzi', pronunciation: 'Audio', pinyin: 'Pinyin', meaning: 'Meaning' };
const FRONT_HINT = { hanzi: 'Recognize the word', pronunciation: 'Recognize the sound', pinyin: 'Recognize the spelling', meaning: 'Recall the Mandarin' };

export function renderFront() {
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
        const d = document.createElement('div');
        d.className = 'front-meaning';
        d.textContent = state.card.meaning;
        body.appendChild(d);
    } else if (f === 'pinyin') {
        const d = document.createElement('div');
        d.className = 'front-pinyin mono';
        d.textContent = state.card.pinyinToned;
        body.appendChild(d);
    } else {
        const wrap = document.createElement('div');
        wrap.className = 'front-audio';

        const btn = document.createElement('button');
        btn.className = 'sound';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Play pronunciation');
        btn.innerHTML = '<div class="waves" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
        btn.addEventListener('click', () => {
            btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
        });
        wrap.appendChild(btn);

        const d = document.createElement('div');
        d.style.textAlign = 'left';
        d.innerHTML = `<div style="font-weight:950; font-size:16px; letter-spacing:.2px">${state.card.audioLabel}</div><div style="margin-top:4px; color: rgba(255,255,255,.65); font-weight:800; font-size:12px">Tap to play</div>`;
        wrap.appendChild(d);

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

    // clear hanzi grades
    $$('[data-choice]', modCard).forEach(b => { delete b.dataset.grade; });
}

export function resetAllBack() {
    ['#modPron', '#modPinyin', '#modHanzi', '#modMeaning'].forEach(sel => resetModality($(sel)));
}

export function cycleFront() {
    const i = FRONT_ORDER.indexOf(state.card.front);
    state.card.front = FRONT_ORDER[(i + 1) % FRONT_ORDER.length];
    renderFront();
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
        });
    });
}

// Pronunciation: Tone
function checkTone(modCard) {
    const inputEl = $('[data-input="tone"]', modCard);
    const ans = $('[data-role="toneAnswer"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim().replace(/\\s+/g, '');
    const correct = state.card.tones;
    const ok = (input === correct);
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'tone');
    bumpSession(ok ? 1 : 0);

    ans.style.display = 'block';
    ans.innerHTML = `<strong>Tones:</strong> <span class="mono">${correct}</span>`;
}

// Pronunciation: Speak
function checkSpeech(modCard) {
    const a = $('[data-role="speechAnswer"]', modCard);
    const sg = $('[data-role="speechSelf"]', modCard);
    if (a) {
        a.style.display = 'block';
        a.innerHTML = `
      <div class="front-audio">
        <button class="sound" type="button" aria-label="Play example pronunciation">
          <div class="waves" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        </button>
        <div style="text-align:left">
          <div style="font-weight:950; font-size:16px; letter-spacing:.2px">Example audio</div>
          <div style="margin-top:4px; color: rgba(255,255,255,.65); font-weight:800; font-size:12px">Tap to play</div>
        </div>
      </div>
    `;
        wireSoundButtons(a);
    }
    if (sg) sg.style.display = 'flex';
}

// Pinyin spelling
function checkPinyin(modCard) {
    const inputEl = $('[data-input="pinyin"]', modCard);
    const ans = $('[data-role="pinyinAnswer"]', modCard);
    if (!inputEl || !ans) return;

    const input = inputEl.value.trim().toLowerCase();
    const correct = state.card.pinyinBare;
    const ok = (input === correct);
    showResult(modCard, ok, ok ? 'Right' : 'Wrong', 'pinyin');
    bumpSession(ok ? 1 : 0);

    ans.style.display = 'block';
    ans.innerHTML = `<strong>Answer:</strong> <span class="mono">${correct}</span>`;
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
        ans.innerHTML = `<strong>Answer:</strong> ${state.card.meaning}`;
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

        if (t.matches('[data-action="checkTone"]')) return checkTone(modCard);
        if (t.matches('[data-action="checkSpeech"]')) return checkSpeech(modCard);
        if (t.matches('[data-action="checkPinyin"]')) return checkPinyin(modCard);
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
