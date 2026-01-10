import { state } from '../state.js';
import { $, $$ } from './utils.js';

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
    if (prompt) prompt.textContent = onENZH ? state.translation.promptEN : state.translation.promptZH;

    showTranslateA();
}

export function renderFeedbackTokens() {
    const host = $('#fbSentence');
    if (!host) return;
    host.innerHTML = '';

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

export function newSentence() {
    const alt = {
        promptEN: 'Why do you want bread?',
        promptZH: '你为什么想要面包？',
        feedbackOverview: 'Good direction. One word is still off.',
        tokens: [
            { text: '你', cls: 'ok', detail: 'Correct.' },
            { text: '为什么', cls: 'ok', detail: 'Correct.' },
            { text: '想要', cls: 'ok', detail: 'Correct.' },
            { text: '面包', cls: 'spelling', detail: 'Spelling in your pinyin was off. Correct: miànbāo (面包).' },
        ]
    };

    const base = {
        promptEN: 'Welcome home. Do you want bread?',
        promptZH: '欢迎回家。你想要面包吗？',
        feedbackOverview: 'Nice structure. Two word choices are off, and one word is missing.',
        tokens: [
            { text: '欢迎', cls: 'ok', detail: 'Correct.' },
            { text: '回家', cls: 'ok', detail: 'Correct.' },
            { text: '你', cls: 'missing', detail: 'Missing word. Add 你 before 想要.' },
            { text: '想要', cls: 'spelling', detail: 'Form is slightly off. Preferred: 想要.' },
            { text: '面包', cls: 'wrong', detail: 'Wrong word choice. Use 面包 (miànbāo) for bread.' },
            { text: '吗', cls: 'extra', detail: 'Extra word. Your sentence already forms a question.' },
        ]
    };

    const isBase = (state.translation.promptEN === base.promptEN);
    Object.assign(state.translation, isBase ? alt : base);

    const prompt = $('#promptText');
    if (prompt) {
        prompt.textContent = (state.translationDir === 'ENZH') ? state.translation.promptEN : state.translation.promptZH;
    }
    const input = $('#userTranslation');
    if (input) input.value = '';
    showTranslateA();
}

export function handleFeedbackClick(e) {
    const t = e.target;
    const btn = (t instanceof HTMLElement) ? t.closest('button.w') : null;
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (Number.isFinite(idx)) setDetail(idx);
}
