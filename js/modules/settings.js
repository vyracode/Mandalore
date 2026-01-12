import { state, saveState } from '../state.js';
import { $, $$ } from './utils.js';
import { nextCard } from './flashcards.js';
import { prompts } from './prompts.js';
import { generateWordId } from './wordId.js';

export function renderKeyStatus() {
    const s = $('#keyStatus');
    if (s) {
        if (state.apiKey) {
            s.textContent = 'Set';
            s.style.color = 'var(--green)';
        } else {
            s.textContent = 'Not set';
            s.style.color = 'var(--text-muted)';
        }
    }
}

export function saveKey() {
    const input = $('#apiKey');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    state.apiKey = val;
    const modelSel = $('#geminiModel');
    if (modelSel) state.geminiModel = modelSel.value;
    saveState();
    renderKeyStatus();
    input.value = ''; // Clear input for security/cleanliness
}

export function forgetKey() {
    if (!confirm('Forget Gemini API key?')) return;
    state.apiKey = '';
    saveState();
    renderKeyStatus();
    const input = $('#apiKey');
    if (input) input.value = '';
}

export function renderModel() {
    const sel = $('#geminiModel');
    if (sel) sel.value = state.geminiModel;
}

export function handleModelChange() {
    const sel = $('#geminiModel');
    if (sel) {
        state.geminiModel = sel.value;
        saveState();
    }
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
    // Create a map of existing words by WordID for quick lookup
    // WordID is the canonical unique identifier (xxHash of hanzi + toned pinyin)
    const existingMap = new Map();
    if (state.wordlist && state.wordlist.length > 0) {
        for (const word of state.wordlist) {
            // Use existing id, or generate one for legacy entries
            const id = word.id || generateWordId(word.word, word.pinyinToned);
            existingMap.set(id, { ...word, id });
        }
    }
    
    let newCount = 0;
    let updatedCount = 0;
    
    // Process imported data and merge with existing
    for (const item of data) {
        const w = item.word.trim();
        const p = item.pinyin.trim();
        const d = item.definition.trim();
        const { bare, tones } = processPinyin(p);
        
        // Generate the unique WordID
        const id = generateWordId(w, p);

        const wordEntry = {
            id: id,
            word: w,
            pinyinToned: p,
            meaning: d,
            pinyinBare: bare,
            tones: tones
        };
        
        if (existingMap.has(id)) {
            // Word exists (same Hanzi + Pinyin) - update it with new data
            existingMap.set(id, wordEntry);
            updatedCount++;
        } else {
            // New word - add it
            existingMap.set(id, wordEntry);
            newCount++;
        }
    }
    
    // Convert map back to array
    state.wordlist = Array.from(existingMap.values());
    state.imported.deckName = `Imported (${state.wordlist.length} words)`;

    saveState();

    const dn = $('#deckName');
    if (dn) dn.textContent = state.imported.deckName;

    // Start fresh
    nextCard();
    
    // Return counts for user feedback
    return { newCount, updatedCount, total: state.wordlist.length };
}

export function handleImport() {
    const text = ($('#wordlistJson')?.value || '');
    const v = validateWordlistJson(text);
    if (!v.ok) return showImportMessage('error', v.msg);
    
    const counts = applyImportedDeck(v.data);
    let message = `Total: ${counts.total} words`;
    if (counts.newCount > 0) message += ` (${counts.newCount} new)`;
    if (counts.updatedCount > 0) message += ` (${counts.updatedCount} updated)`;
    showImportMessage('ok', message);
}

export function handleForgetList() {
    if (!confirm('Forget all imported words?')) return;
    state.wordlist = [];
    state.cachedSentences = [];
    saveState();
    const wl = $('#wordlistJson');
    if (wl) wl.value = '[]';

    showImportMessage('ok', 'Wordlist forgotten.');

    const dn = $('#deckName');
    if (dn) dn.textContent = 'Empty Wordlist';

    // Refresh card (will show empty state)
    nextCard();
}

export function copyPrompt() {
    const prompt = prompts.wordlistExtraction();

    navigator.clipboard.writeText(prompt).then(() => {
        const btn = $('#btnCopyPrompt');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = original, 2000);
        }
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert('Failed to copy prompt to clipboard.');
    });
}

// --- Browse Import ---

async function callGeminiWithImages(prompt, base64Images) {
    if (!state.apiKey) {
        throw new Error("Missing API Key. Go to Settings to set it.");
    }

    // Always use Gemini 3 Flash for image extraction
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${state.apiKey}`;

    const parts = [{ text: prompt }];
    for (const img of base64Images) {
        parts.push({
            inline_data: {
                mime_type: img.mimeType,
                data: img.data
            }
        });
    }

    const payload = {
        contents: [{ parts }]
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

    // Extract JSON from codeblock if present
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = match ? match[1].trim() : text.trim();

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse JSON from Gemini", jsonStr);
        throw new Error("Gemini returned invalid JSON.");
    }
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve({ data: base64, mimeType: file.type });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function triggerBrowse() {
    const fileInput = $('#fileInput');
    if (fileInput) fileInput.click();
}

export async function handleFileSelect(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const jsonFiles = files.filter(f => f.type === 'application/json' || f.name.endsWith('.json'));
    const imageFiles = files.filter(f => f.type.startsWith('image/'));

    showImportMessage('ok', 'Processing files...');

    try {
        // Handle JSON files
        for (const file of jsonFiles) {
            const text = await file.text();
            const v = validateWordlistJson(text);
            if (!v.ok) {
                showImportMessage('error', `${file.name}: ${v.msg}`);
                return;
            }
            const counts = applyImportedDeck(v.data);
            // Message will be updated after all files are processed
        }

        // Handle image files via Gemini 3 Flash
        if (imageFiles.length > 0) {
            showImportMessage('ok', `Extracting from ${imageFiles.length} image(s)...`);

            const base64Images = await Promise.all(imageFiles.map(readFileAsBase64));

            // First pass: Extract
            const extractPrompt = prompts.wordlistExtraction();
            const firstPass = await callGeminiWithImages(extractPrompt, base64Images);

            if (!Array.isArray(firstPass)) {
                throw new Error("Expected JSON array from image extraction.");
            }

            // Second pass: Verify and correct
            showImportMessage('ok', `Verifying extraction...`);
            const verifyPrompt = prompts.wordlistVerification(JSON.stringify(firstPass, null, 2));
            const verifiedData = await callGeminiWithImages(verifyPrompt, base64Images);

            if (!Array.isArray(verifiedData)) {
                throw new Error("Verification failed to return JSON array.");
            }

            const v = validateWordlistJson(JSON.stringify(verifiedData));
            if (!v.ok) {
                showImportMessage('error', `Image extraction failed: ${v.msg}`);
                return;
            }

            const counts = applyImportedDeck(v.data);
        }

        // Show final summary
        let message = `Total: ${state.wordlist.length} words`;
        showImportMessage('ok', message);

    } catch (e) {
        showImportMessage('error', e.message);
    }

    // Reset file input
    event.target.value = '';
}
