import { state, saveState } from '../state.js';
import { $, $$ } from './utils.js';
import { nextCard } from './flashcards.js';
import { prompts } from './prompts.js';
import { generateWordId } from './wordId.js';
import { getSubcardKey, getOrCreateSubcard, getBackModesForFront } from './fsrs.js';

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Get computed styles
    const computedStyle = window.getComputedStyle(textarea);
    const minHeight = parseFloat(computedStyle.minHeight) || 44;
    const maxHeight = parseFloat(computedStyle.maxHeight) || 264;
    
    // Calculate the content height
    const contentHeight = textarea.scrollHeight;
    
    // Set the height, respecting min and max
    const newHeight = Math.max(minHeight, Math.min(maxHeight, contentHeight));
    textarea.style.height = `${newHeight}px`;
    
    // Enable/disable scrolling based on whether we hit max height
    if (contentHeight > maxHeight) {
        textarea.style.overflowY = 'auto';
    } else {
        textarea.style.overflowY = 'hidden';
    }
}

export function setupTextareaAutoResize() {
    const textarea = $('#wordlistJson');
    if (!textarea) return;
    
    // Set initial height
    autoResizeTextarea(textarea);
    
    // Auto-resize on input
    textarea.addEventListener('input', () => autoResizeTextarea(textarea));
}

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
    
    // Update word count and FSRS stats if settings tab is active
    renderWordCount();
    if (state.tab === 'settings') {
        renderFSRSStats();
    }
    
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
    if (wl) {
        wl.value = '[]';
        autoResizeTextarea(wl);
    }

    showImportMessage('ok', 'Wordlist forgotten.');

    const dn = $('#deckName');
    if (dn) dn.textContent = 'Empty Wordlist';

    // Update word count
    renderWordCount();

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

export function clearCacheAndReload() {
    if (!confirm('Clear cache and reload? This will refresh the page with the latest files, but will keep your API key and wordlist.')) return;
    
    // Clear service worker cache if it exists
    if ('serviceWorker' in navigator && 'caches' in window) {
        caches.keys().then(names => {
            return Promise.all(names.map(name => caches.delete(name)));
        }).catch(err => {
            console.warn('Failed to clear caches:', err);
        });
    }
    
    // Force a hard reload (bypass cache) - equivalent to Ctrl+F5
    // Try the deprecated but widely-supported reload(true) first
    // Fallback to location.replace with cache-busting parameter
    if (typeof location.reload === 'function') {
        // Most browsers still support reload(true) for hard reload
        location.reload(true);
    } else {
        // Fallback: use location.replace with cache-busting
        const url = new URL(location.href);
        url.searchParams.set('_nocache', Date.now().toString());
        location.replace(url.toString());
    }
}

export async function loadVersionInfo() {
    const versionEl = $('#versionInfo');
    if (!versionEl) return;

    try {
        // Fetch commits from GitHub API
        const repo = 'vyracode/Mandalore';
        
        // Get latest commit and commit count
        const commitsUrl = `https://api.github.com/repos/${repo}/commits?per_page=1`;
        const response = await fetch(commitsUrl);
        if (!response.ok) throw new Error('Failed to fetch commits');
        
        const commits = await response.json();
        if (!commits || commits.length === 0) throw new Error('No commits found');
        
        const latestCommit = commits[0];
        const commitDate = new Date(latestCommit.commit.author.date);
        
        // Get commit count by checking Link header for pagination
        // Parse Link header to find total pages, or fetch multiple pages
        let commitCount = 0;
        let page = 1;
        let hasMore = true;
        
        // Fetch commits in batches to count them
        while (hasMore && page <= 10) { // Limit to 10 pages (1000 commits max) to avoid rate limits
            const pageResponse = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=100&page=${page}`);
            if (!pageResponse.ok) break;
            
            const pageCommits = await pageResponse.json();
            commitCount += pageCommits.length;
            
            // Check if there are more pages
            const linkHeader = pageResponse.headers.get('Link');
            hasMore = linkHeader && linkHeader.includes('rel="next"');
            page++;
            
            // If we got less than 100 commits, we're done
            if (pageCommits.length < 100) break;
        }
        
        // Format date in attractive human-readable local time
        const formatter = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        
        const formattedDate = formatter.format(commitDate);
        
        // Display version info
        versionEl.innerHTML = `v0.${commitCount || '?'}&nbsp;&nbsp;|&nbsp;&nbsp;${formattedDate}`;
    } catch (error) {
        console.warn('Failed to load version info:', error);
        versionEl.innerHTML = 'v0.?&nbsp;&nbsp;|&nbsp;&nbsp;Unknown';
    }
}

export function renderSentenceCount() {
    const countEl = $('#sentenceCount');
    if (countEl) {
        countEl.textContent = state.cachedSentences.length.toString();
    }
}

export function renderWordCount() {
    const countEl = $('#wordCount');
    if (countEl) {
        countEl.textContent = (state.wordlist?.length || 0).toString();
    }
}

/**
 * Calculate FSRS statistics (both supercards and subcards)
 */
function calculateFSRSStats() {
    const FRONT_TYPES = ['hanzi', 'pronunciation', 'meaning'];
    const now = new Date();
    const stats = {
        // Supercard stats
        totalSupercards: 0,
        newSupercards: 0,
        learningSupercards: 0,
        reviewSupercards: 0,
        relearningSupercards: 0,
        dueNowSupercards: 0,
        dueSoonSupercards: 0,
        // Subcard stats
        totalSubcards: 0,
        newSubcards: 0,
        learningSubcards: 0,
        reviewSubcards: 0,
        relearningSubcards: 0,
        dueNow: 0,
        dueSoon: 0, // Next 24 hours
        totalReviews: 0,
        totalLapses: 0,
        avgStability: 0,
        avgDifficulty: 0,
        avgInterval: 0
    };
    
    if (!state.wordlist || state.wordlist.length === 0) {
        return stats;
    }
    
    let totalStability = 0;
    let totalDifficulty = 0;
    let totalInterval = 0;
    let subcardsWithStats = 0;
    
    // FSRS State enum values (from ts-fsrs)
    const State = typeof FSRS !== 'undefined' ? FSRS.State : {
        New: 0,
        Learning: 1,
        Review: 2,
        Relearning: 3
    };
    
    // Track supercards for aggregation
    const supercardMap = new Map(); // wordId_front -> { subcards: [], states: Set, dueDates: [] }
    
    for (const word of state.wordlist) {
        const wordId = word.id || generateWordId(word.word, word.pinyinToned);
        
        for (const front of FRONT_TYPES) {
            stats.totalSupercards++;
            const supercardKey = `${wordId}_${front}`;
            const supercardData = {
                subcards: [],
                states: new Set(),
                dueDates: [],
                hasDue: false,
                hasDueSoon: false
            };
            
            const backModes = getBackModesForFront(front);
            
            for (const backMode of backModes) {
                stats.totalSubcards++;
                
                const subcardKey = getSubcardKey(wordId, front, backMode);
                const subcard = state.fsrsSubcards[subcardKey];
                
                supercardData.subcards.push(subcard);
                
                if (!subcard) {
                    stats.newSubcards++;
                    supercardData.states.add(State.New);
                    supercardData.hasDue = true; // New = due
                    continue;
                }
                
                // Count subcard by state
                const subcardState = subcard.state !== undefined ? subcard.state : State.New;
                supercardData.states.add(subcardState);
                
                if (subcardState === State.New) stats.newSubcards++;
                else if (subcardState === State.Learning) stats.learningSubcards++;
                else if (subcardState === State.Review) stats.reviewSubcards++;
                else if (subcardState === State.Relearning) stats.relearningSubcards++;
                
                // Count due subcards
                if (subcard.due) {
                    const dueDate = new Date(subcard.due);
                    supercardData.dueDates.push(dueDate);
                    const hoursUntilDue = (dueDate - now) / (1000 * 60 * 60);
                    
                    if (dueDate <= now) {
                        stats.dueNow++;
                        supercardData.hasDue = true;
                    } else if (hoursUntilDue <= 24) {
                        stats.dueSoon++;
                        supercardData.hasDueSoon = true;
                    }
                } else {
                    // No due date means it's new/never reviewed
                    stats.dueNow++;
                    supercardData.hasDue = true;
                }
                
                // Accumulate stats
                if (subcard.reps !== undefined) stats.totalReviews += subcard.reps;
                if (subcard.lapses !== undefined) stats.totalLapses += subcard.lapses;
                
                if (subcard.stability !== undefined && subcard.stability > 0) {
                    totalStability += subcard.stability;
                    subcardsWithStats++;
                }
                
                if (subcard.difficulty !== undefined && subcard.difficulty > 0) {
                    totalDifficulty += subcard.difficulty;
                }
                
                if (subcard.scheduled_days !== undefined && subcard.scheduled_days > 0) {
                    totalInterval += subcard.scheduled_days;
                }
            }
            
            // Determine supercard state (priority: Relearning > Learning > Review > New)
            let supercardState = State.New;
            if (supercardData.states.has(State.Relearning)) {
                supercardState = State.Relearning;
            } else if (supercardData.states.has(State.Learning)) {
                supercardState = State.Learning;
            } else if (supercardData.states.has(State.Review) && supercardData.states.size === 1) {
                // All subcards are Review
                supercardState = State.Review;
            }
            
            // Count supercards by state
            if (supercardState === State.New) stats.newSupercards++;
            else if (supercardState === State.Learning) stats.learningSupercards++;
            else if (supercardState === State.Review) stats.reviewSupercards++;
            else if (supercardState === State.Relearning) stats.relearningSupercards++;
            
            // Count due supercards
            if (supercardData.hasDue) {
                stats.dueNowSupercards++;
            }
            if (supercardData.hasDueSoon) {
                stats.dueSoonSupercards++;
            }
        }
    }
    
    // Calculate averages
    if (subcardsWithStats > 0) {
        stats.avgStability = totalStability / subcardsWithStats;
        stats.avgDifficulty = totalDifficulty / subcardsWithStats;
        stats.avgInterval = totalInterval / subcardsWithStats;
    }
    
    return stats;
}

/**
 * Render FSRS statistics in the settings UI
 */
export function renderFSRSStats() {
    const container = $('#fsrsStatsContainer');
    if (!container) return;
    
    const stats = calculateFSRSStats();
    
    // Format numbers
    const formatNumber = (n, decimals = 0) => {
        if (n === 0) return '0';
        if (!Number.isFinite(n)) return '—';
        return n.toFixed(decimals).replace(/\.?0+$/, '');
    };
    
    const formatDays = (days) => {
        if (!Number.isFinite(days) || days === 0) return '—';
        if (days < 1) return '<1 day';
        if (days < 7) return `${formatNumber(days, 1)} days`;
        if (days < 30) return `${formatNumber(days / 7, 1)} weeks`;
        if (days < 365) return `${formatNumber(days / 30, 1)} months`;
        return `${formatNumber(days / 365, 1)} years`;
    };
    
    if (stats.totalSubcards === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: rgba(255,255,255,.5);">
                No subcards yet. Import a wordlist to start tracking FSRS statistics.
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
            <div style="background: rgba(255,255,255,.04); border-radius: 8px; padding: 12px;">
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Total Supercards</div>
                <div style="font-size: 20px; font-weight: 700;">${stats.totalSupercards}</div>
            </div>
            <div style="background: rgba(255,255,255,.04); border-radius: 8px; padding: 12px;">
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Total Subcards</div>
                <div style="font-size: 20px; font-weight: 700;">${stats.totalSubcards}</div>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
            <div style="background: rgba(255,255,255,.04); border-radius: 8px; padding: 12px;">
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Due Now (Supercards)</div>
                <div style="font-size: 20px; font-weight: 700; color: var(--orange);">${stats.dueNowSupercards}</div>
            </div>
            <div style="background: rgba(255,255,255,.04); border-radius: 8px; padding: 12px;">
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Due Now (Subcards)</div>
                <div style="font-size: 20px; font-weight: 700; color: var(--orange);">${stats.dueNow}</div>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px;">
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">New (Supercards)</div>
                <div style="font-size: 16px; font-weight: 650;">${stats.newSupercards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">New (Subcards)</div>
                <div style="font-size: 16px; font-weight: 650;">${stats.newSubcards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Learning (Supercards)</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--cyan);">${stats.learningSupercards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Learning (Subcards)</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--cyan);">${stats.learningSubcards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Review (Supercards)</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--green);">${stats.reviewSupercards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Review (Subcards)</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--green);">${stats.reviewSubcards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Relearning (Supercards)</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--purple);">${stats.relearningSupercards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Relearning (Subcards)</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--purple);">${stats.relearningSubcards}</div>
            </div>
        </div>
        
        <div style="border-top: 1px solid rgba(255,255,255,.1); padding-top: 12px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Total Reviews</div>
                <div style="font-size: 16px; font-weight: 650;">${stats.totalReviews}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Total Lapses</div>
                <div style="font-size: 16px; font-weight: 650;">${stats.totalLapses}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Avg Stability</div>
                <div style="font-size: 16px; font-weight: 650;">${formatNumber(stats.avgStability, 1)}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Avg Difficulty</div>
                <div style="font-size: 16px; font-weight: 650;">${formatNumber(stats.avgDifficulty, 1)}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Avg Interval</div>
                <div style="font-size: 16px; font-weight: 650;">${formatDays(stats.avgInterval)}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Due Soon (24h)</div>
                <div style="font-size: 16px; font-weight: 650;">${stats.dueSoon}</div>
            </div>
        </div>
    `;
}

export function viewSentences() {
    const modal = $('#sentencesModal');
    const container = $('#sentencesListContainer');
    
    if (!modal || !container) return;
    
    // Clear existing content
    container.innerHTML = '';
    
    if (state.cachedSentences.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,.5); font-weight: 650;">No sentences generated yet.</div>';
    } else {
        // Render sentences in reverse order (newest first)
        const sentences = [...state.cachedSentences].reverse();
        sentences.forEach(sentence => {
            const item = document.createElement('div');
            item.className = 'sentence-item';
            
            item.innerHTML = `
                <div class="sentence-pair">
                    <div class="sentence-lang">English</div>
                    <div class="sentence-text">${sentence.promptEN || ''}</div>
                </div>
                <div class="sentence-pair">
                    <div class="sentence-lang">中文</div>
                    <div class="sentence-text zh">${sentence.promptZH || ''}</div>
                </div>
            `;
            
            container.appendChild(item);
        });
    }
    
    // Show modal
    modal.style.display = 'flex';
}

export function closeModal() {
    const modal = $('#sentencesModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

export function forgetSentences() {
    if (!confirm('Forget all generated sentences?')) return;
    
    state.cachedSentences = [];
    saveState();
    renderSentenceCount();
    
    // If modal is open, update it
    const modal = $('#sentencesModal');
    if (modal && modal.style.display !== 'none') {
        viewSentences();
    }
}

export function forgetFSRS() {
    if (!confirm('Forget all FSRS-6 learning data? This will reset all spaced repetition progress.')) return;
    
    state.fsrsSubcards = {};
    saveState();
    renderFSRSStats();
}

/**
 * View all flashcard statistics in a modal
 */
export function viewFlashcardStats() {
    const modal = $('#flashcardStatsModal');
    const container = $('#flashcardStatsContainer');
    
    if (!modal || !container) return;
    
    // Clear existing content
    container.innerHTML = '';
    
    if (!state.wordlist || state.wordlist.length === 0) {
        container.innerHTML = '<div class="stats-empty-state">No words loaded. Import a wordlist to start tracking statistics.</div>';
        modal.style.display = 'flex';
        return;
    }
    
    const FRONT_TYPES = ['hanzi', 'pronunciation', 'meaning'];
    const FRONT_LABELS = { hanzi: 'Hanzi', pronunciation: 'Audio', meaning: 'Meaning' };
    
    // FSRS State enum values
    const State = typeof FSRS !== 'undefined' ? FSRS.State : {
        New: 0,
        Learning: 1,
        Review: 2,
        Relearning: 3
    };
    
    const getStateLabel = (stateValue) => {
        switch (stateValue) {
            case State.New: return { label: 'New', class: 'prof-new' };
            case State.Learning: return { label: 'Learning', class: 'prof-learning' };
            case State.Review: return { label: 'Review', class: 'prof-review' };
            case State.Relearning: return { label: 'Relearning', class: 'prof-relearning' };
            default: return { label: 'New', class: 'prof-new' };
        }
    };
    
    /**
     * Calculate word dueness (maximum priority across all supercards for this word)
     * Matches the logic used in getNextSupercard for card selection
     * Returns { priority: number|Infinity, earliestDueDate: Date|null }
     */
    const calculateWordDueness = (wordId) => {
        const now = new Date();
        let wordMaxPriority = -Infinity;
        let wordEarliestDueDate = null;
        
        // Check all supercards for this word
        for (const front of FRONT_TYPES) {
            const backModes = getBackModesForFront(front);
            let mostDuePriority = Infinity;
            let mostDueDate = null;
            let hasAnyDue = false;
            
            // Find most due subcard for this supercard (exactly matching getNextSupercard logic)
            for (const backMode of backModes) {
                const subcard = getOrCreateSubcard(wordId, front, backMode, state.fsrsSubcards);
                if (!subcard) continue;
                
                const dueDate = subcard.due ? new Date(subcard.due) : new Date(0);
                const isDue = dueDate <= now;
                
                if (isDue || !subcard.last_review) {
                    hasAnyDue = true;
                    const priority = isDue ? (now - dueDate) : Infinity;
                    
                    // Track most due subcard (largest priority = most overdue)
                    if ((mostDuePriority === Infinity && priority !== Infinity) || 
                        (priority !== Infinity && mostDuePriority !== Infinity && priority > mostDuePriority) ||
                        (priority === Infinity && mostDuePriority === Infinity && (!mostDueDate || dueDate < mostDueDate))) {
                        mostDueDate = dueDate;
                        mostDuePriority = priority;
                    }
                } else {
                    // Not due yet, but check if it's earlier than current most due
                    if (!mostDueDate || dueDate < mostDueDate) {
                        mostDueDate = dueDate;
                        mostDuePriority = Infinity;
                    }
                }
            }
            
            // Update word-level max priority (take maximum across all supercards)
            if (hasAnyDue || mostDueDate) {
                if (mostDuePriority === Infinity) {
                    // This supercard is not overdue
                    if (wordMaxPriority === -Infinity || wordMaxPriority === Infinity) {
                        // Track earliest due date across all supercards
                        if (!wordEarliestDueDate || (mostDueDate && mostDueDate < wordEarliestDueDate)) {
                            wordEarliestDueDate = mostDueDate;
                        }
                        if (wordMaxPriority === -Infinity) {
                            wordMaxPriority = Infinity;
                        }
                    }
                } else {
                    // This supercard is overdue - use it if it's higher priority
                    if (wordMaxPriority === -Infinity || wordMaxPriority === Infinity || mostDuePriority > wordMaxPriority) {
                        wordMaxPriority = mostDuePriority;
                        wordEarliestDueDate = mostDueDate;
                    }
                }
            }
        }
        
        // If no supercards found, return Infinity
        if (wordMaxPriority === -Infinity) {
            wordMaxPriority = Infinity;
        }
        
        return {
            priority: wordMaxPriority,
            earliestDueDate: wordEarliestDueDate
        };
    };
    
    /**
     * Get color class for dueness based on priority
     */
    const getDuenessColorClass = (priority) => {
        if (priority === Infinity) {
            return 'dueness-not-due';
        }
        
        // Priority is milliseconds overdue
        const ms = priority;
        const hours = ms / (1000 * 60 * 60);
        const days = hours / 24;
        
        // Color coding based on how overdue:
        // Very overdue (>7 days): red
        // Moderately overdue (1-7 days): orange
        // Slightly overdue (<1 day): yellow
        if (days >= 7) {
            return 'dueness-very-overdue';
        } else if (days >= 1) {
            return 'dueness-moderately-overdue';
        } else {
            return 'dueness-slightly-overdue';
        }
    };
    
    /**
     * Format dueness value for display
     */
    const formatDueness = (dueness) => {
        if (dueness.priority === Infinity) {
            if (dueness.earliestDueDate) {
                const daysUntil = Math.ceil((dueness.earliestDueDate - new Date()) / (1000 * 60 * 60 * 24));
                if (daysUntil <= 0) {
                    return 'Due';
                } else if (daysUntil === 1) {
                    return 'Due tomorrow';
                } else {
                    return `Due in ${daysUntil} days`;
                }
            }
            return 'Not due';
        } else {
            // Priority is milliseconds overdue
            const ms = dueness.priority;
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) {
                return `${days.toFixed(1)}d overdue`;
            } else if (hours > 0) {
                return `${hours.toFixed(1)}h overdue`;
            } else if (minutes > 0) {
                return `${minutes.toFixed(1)}m overdue`;
            } else {
                return `${seconds.toFixed(0)}s overdue`;
            }
        }
    };
    
    // Build table
    let html = `
        <table class="flashcard-stats-table">
            <thead>
                <tr>
                    <th>Word</th>
                    <th>Pinyin</th>
                    <th>Meaning</th>
                    <th>Dueness</th>
    `;
    
    // Add headers for each front → back modality mapping
    for (const front of FRONT_TYPES) {
        const backModes = getBackModesForFront(front);
        for (const backMode of backModes) {
            const frontLabel = FRONT_LABELS[front];
            const backLabel = FRONT_LABELS[backMode] || backMode;
            html += `
                <th class="modality-cell">
                    <div class="modality-header">
                        <span class="modality-front">${frontLabel} →</span>
                        <span class="modality-back">${backLabel}</span>
                    </div>
                </th>
            `;
        }
    }
    
    html += `
                </tr>
            </thead>
            <tbody>
    `;
    
    // Calculate dueness for all words and prepare for sorting
    const wordsWithDueness = state.wordlist.map(word => {
        const wordId = word.id || generateWordId(word.word, word.pinyinToned);
        const dueness = calculateWordDueness(wordId);
        return {
            word,
            wordId,
            dueness
        };
    });
    
    // Sort by priority (highest priority = most overdue first)
    // Infinity values go to the end
    wordsWithDueness.sort((a, b) => {
        const aPriority = a.dueness.priority;
        const bPriority = b.dueness.priority;
        
        // Both are Infinity - sort by earliest due date
        if (aPriority === Infinity && bPriority === Infinity) {
            if (!a.dueness.earliestDueDate && !b.dueness.earliestDueDate) return 0;
            if (!a.dueness.earliestDueDate) return 1;
            if (!b.dueness.earliestDueDate) return -1;
            return a.dueness.earliestDueDate - b.dueness.earliestDueDate;
        }
        
        // One is Infinity - non-Infinity comes first
        if (aPriority === Infinity) return 1;
        if (bPriority === Infinity) return -1;
        
        // Both are numbers - higher priority (more overdue) comes first
        return bPriority - aPriority;
    });
    
    // Determine which words are in the "top candidates" pool
    // The selection algorithm picks from top 20% most overdue (or top 3, whichever is larger)
    // We'll highlight words that have at least one supercard in the top pool
    const overdueWords = wordsWithDueness.filter(w => w.dueness.priority !== Infinity);
    const topCount = Math.max(3, Math.ceil(overdueWords.length * 0.2));
    const topWordsSet = new Set();
    
    if (overdueWords.length > 0) {
        // Get top N words by priority
        const topWords = overdueWords.slice(0, topCount);
        topWords.forEach(w => topWordsSet.add(w.wordId));
    }
    
    // Render sorted rows
    for (const { word, wordId, dueness } of wordsWithDueness) {
        const duenessDisplay = formatDueness(dueness);
        const duenessColorClass = getDuenessColorClass(dueness.priority);
        const isTopCandidate = topWordsSet.has(wordId);
        const topCandidateClass = isTopCandidate ? 'top-candidate' : '';
        
        html += `
            <tr>
                <td class="word-cell">${escapeHtml(word.word)}</td>
                <td class="pinyin-cell">${escapeHtml(word.pinyinToned || '')}</td>
                <td class="meaning-cell" title="${escapeHtml(word.meaning || '')}">${escapeHtml(word.meaning || '')}</td>
                <td class="dueness-cell ${duenessColorClass} ${topCandidateClass}" title="Priority: ${dueness.priority === Infinity ? 'Infinity' : dueness.priority.toFixed(0)}ms">${duenessDisplay}</td>
        `;
        
        // Add cells for each front → back modality mapping
        for (const front of FRONT_TYPES) {
            const backModes = getBackModesForFront(front);
            for (const backMode of backModes) {
                const subcardKey = getSubcardKey(wordId, front, backMode);
                const subcard = state.fsrsSubcards[subcardKey];
                
                let reps = 0;
                let stateInfo = getStateLabel(State.New);
                
                if (subcard) {
                    reps = subcard.reps || 0;
                    const subcardState = subcard.state !== undefined ? subcard.state : State.New;
                    stateInfo = getStateLabel(subcardState);
                }
                
                html += `
                    <td class="modality-cell">
                        <div class="stat-value stat-reps">${reps}</div>
                        <div class="stat-proficiency ${stateInfo.class}">${stateInfo.label}</div>
                    </td>
                `;
            }
        }
        
        html += `</tr>`;
    }
    
    html += `
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
    
    // Show modal
    modal.style.display = 'flex';
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Close the flashcard stats modal
 */
export function closeFlashcardStatsModal() {
    const modal = $('#flashcardStatsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}
