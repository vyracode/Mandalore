import { state } from '../state.js';
import { $, $$ } from './utils.js';
import { renderFront, resetAllBack } from './flashcards.js';

export function renderKeyStatus() {
    const v = ($('#apiKey')?.value || '').trim();
    const s = $('#keyStatus');
    if (s) s.textContent = v ? 'Set' : 'Not set';
}

function showImportMessage(kind, msg) {
    const err = $('#importError');
    const ok = $('#importOk');
    if (err) err.style.display = 'none';
    if (ok) ok.style.display = 'none';
    if (kind === 'error' && err) { err.textContent = msg; err.style.display = 'block'; }
    if (kind === 'ok' && ok) { ok.textContent = msg; ok.style.display = 'block'; }
}

function validateWordlistJson(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, msg: "That JSON can't be parsed. Paste a JSON array: [ {\"word\":\"…\",\"pinyin\":\"…\",\"definition\":\"…\"} ]" }; }
    if (!Array.isArray(data)) return { ok: false, msg: 'Top level must be a JSON array.' };
    if (data.length === 0) return { ok: false, msg: 'Array is empty. Paste at least one word.' };

    for (let i = 0; i < Math.min(30, data.length); i++) {
        const it = data[i];
        if (!it || typeof it !== 'object') return { ok: false, msg: `Item ${i + 1} must be an object.` };
        for (const k of ['word', 'pinyin', 'definition']) {
            if (!(k in it)) return { ok: false, msg: `Item ${i + 1} is missing \"${k}\".` };
            if (typeof it[k] !== 'string') return { ok: false, msg: `Item ${i + 1} \"${k}\" must be a string.` };
            if (it[k].trim().length === 0) return { ok: false, msg: `Item ${i + 1} \"${k}\" is empty.` };
        }
    }
    return { ok: true, data };
}

function applyImportedDeck(data) {
    const first = data[0];
    state.card.word = first.word.trim();
    state.card.pinyinToned = first.pinyin.trim();
    state.card.meaning = first.definition.trim();

    state.card.pinyinBare = first.pinyin
        .toLowerCase()
        .replace(/[1-5]/g, '')
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .replace(/\\s+/g, '')
        .trim();

    const dn = $('#deckName');
    if (dn) dn.textContent = state.imported.deckName;

    renderFront();
    resetAllBack();

    const choices = $$('[data-choice]', $('#modHanzi'));
    const distractors = ['环境', '欢影', '欢迎吧', '缓应', '欢饮', '换应'];
    const arr = [state.card.word, ...distractors].slice(0, choices.length);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor((i * 7 + 3) % (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    choices.forEach((b, i) => b.textContent = arr[i] || state.card.word);
}

export function handleImport() {
    const text = ($('#wordlistJson')?.value || '');
    const v = validateWordlistJson(text);
    if (!v.ok) return showImportMessage('error', v.msg);
    showImportMessage('ok', `Imported ${v.data.length} word${v.data.length === 1 ? '' : 's'}.`);
    applyImportedDeck(v.data);
}

export function handleClear() {
    const wl = $('#wordlistJson');
    if (wl) wl.value = '[]';
    const err = $('#importError');
    const ok = $('#importOk');
    if (err) err.style.display = 'none';
    if (ok) ok.style.display = 'none';
}
