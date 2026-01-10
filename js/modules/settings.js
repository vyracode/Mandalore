import { state, saveState } from '../state.js';
import { $, $$ } from './utils.js';
import { nextCard, renderFront, resetAllBack } from './flashcards.js';

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

function processPinyin(pinyinToned) {
    // Very basic tone extraction (1-4)
    // Returns { bare: "miànbāo" -> "mianbao", tones: "miànbāo" -> "41" }
    // Note: This matches the user's rudimentary request.

    // Map of toned chars to {char, tone}
    // We can do a simpler regex pass for digits if the user provides numbers, 
    // but the example is "huānyíng". 
    // We will just strip diacritics for bare, and look for specific chars for tones if we wanted to be fancy.
    // BUT the prompt implies we should just handle it. 
    // Let's TRY to extract tones if we can. 
    // Mappings:
    // ā=1, á=2, ǎ=3, à=4
    // ē=1, é=2, ě=3, è=4
    // ī=1, í=2, ǐ=3, ì=4
    // ō=1, ó=2, ǒ=3, ò=4
    // ū=1, ú=2, ǔ=3, ù=4
    // ǖ=1, ǘ=2, ǚ=3, ǜ=4

    const map = {
        'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
        'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
        'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
        'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
        'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
        'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4
    };

    let tones = '';
    let bare = pinyinToned.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // strip diacritics for bare

    // Extract tones from original string
    // This is imperfect because "mian" is one syllable but might have no tone mark?
    // Actually, iterating chars is safer.

    for (const char of pinyinToned.toLowerCase()) {
        if (map[char]) {
            tones += map[char];
        }
    }

    // If no tones found, maybe they used numbers?
    if (tones.length === 0) {
        const numbers = pinyinToned.match(/[1-5]/g);
        if (numbers) tones = numbers.join('');
    }

    bare = bare.replace(/[^a-z]/g, ''); // keep only letters

    return { bare, tones };
}

function applyImportedDeck(data) {
    const list = [];
    for (const item of data) {
        const w = item.word.trim();
        const p = item.pinyin.trim();
        const d = item.definition.trim();
        const { bare, tones } = processPinyin(p);

        list.push({
            word: w,
            pinyinToned: p,
            meaning: d,
            pinyinBare: bare,
            tones: tones
        });
    }

    state.wordlist = list;
    state.imported.deckName = `Imported (${list.length} words)`;

    saveState();

    const dn = $('#deckName');
    if (dn) dn.textContent = state.imported.deckName;

    // Start fresh
    nextCard();
}

export function handleImport() {
    const text = ($('#wordlistJson')?.value || '');
    const v = validateWordlistJson(text);
    if (!v.ok) return showImportMessage('error', v.msg);
    applyImportedDeck(v.data);
    showImportMessage('ok', `Imported ${state.wordlist.length} words.`);
}

export function handleClear() {
    state.wordlist = [];
    saveState();
    const wl = $('#wordlistJson');
    if (wl) wl.value = '[]';

    showImportMessage('ok', 'Wordlist cleared.');

    const dn = $('#deckName');
    if (dn) dn.textContent = 'Empty Wordlist';

    // Refresh card (will show empty state)
    nextCard();
}
