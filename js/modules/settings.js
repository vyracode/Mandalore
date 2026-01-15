import { state, saveState } from '../state.js';
import { $, $$ } from './utils.js';
import { nextCard } from './flashcards.js';
import { prompts } from './prompts.js';
import { generateWordId } from './wordId.js';
import { getCardKey, getOrCreateCard } from './fsrs.js';

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
    
    // Update FSRS stats if settings tab is active
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

/**
 * Calculate FSRS statistics
 */
function calculateFSRSStats() {
    const FRONT_TYPES = ['hanzi', 'pronunciation', 'meaning'];
    const now = new Date();
    const stats = {
        totalCards: 0,
        newCards: 0,
        learningCards: 0,
        reviewCards: 0,
        relearningCards: 0,
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
    let cardsWithStats = 0;
    
    // FSRS State enum values (from ts-fsrs)
    const State = typeof FSRS !== 'undefined' ? FSRS.State : {
        New: 0,
        Learning: 1,
        Review: 2,
        Relearning: 3
    };
    
    for (const word of state.wordlist) {
        const wordId = word.id || generateWordId(word.word, word.pinyinToned);
        
        for (const front of FRONT_TYPES) {
            stats.totalCards++;
            
            const cardKey = getCardKey(wordId, front);
            const card = state.fsrsCards[cardKey];
            
            if (!card) {
                stats.newCards++;
                continue;
            }
            
            // Count by state
            const cardState = card.state !== undefined ? card.state : State.New;
            if (cardState === State.New) stats.newCards++;
            else if (cardState === State.Learning) stats.learningCards++;
            else if (cardState === State.Review) stats.reviewCards++;
            else if (cardState === State.Relearning) stats.relearningCards++;
            
            // Count due cards
            if (card.due) {
                const dueDate = new Date(card.due);
                const hoursUntilDue = (dueDate - now) / (1000 * 60 * 60);
                
                if (dueDate <= now) {
                    stats.dueNow++;
                } else if (hoursUntilDue <= 24) {
                    stats.dueSoon++;
                }
            } else {
                // No due date means it's new/never reviewed
                stats.dueNow++;
            }
            
            // Accumulate stats
            if (card.reps !== undefined) stats.totalReviews += card.reps;
            if (card.lapses !== undefined) stats.totalLapses += card.lapses;
            
            if (card.stability !== undefined && card.stability > 0) {
                totalStability += card.stability;
                cardsWithStats++;
            }
            
            if (card.difficulty !== undefined && card.difficulty > 0) {
                totalDifficulty += card.difficulty;
            }
            
            if (card.scheduled_days !== undefined && card.scheduled_days > 0) {
                totalInterval += card.scheduled_days;
            }
        }
    }
    
    // Calculate averages
    if (cardsWithStats > 0) {
        stats.avgStability = totalStability / cardsWithStats;
        stats.avgDifficulty = totalDifficulty / cardsWithStats;
        stats.avgInterval = totalInterval / cardsWithStats;
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
    
    if (stats.totalCards === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: rgba(255,255,255,.5);">
                No cards yet. Import a wordlist to start tracking FSRS statistics.
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
            <div style="background: rgba(255,255,255,.04); border-radius: 8px; padding: 12px;">
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Total Cards</div>
                <div style="font-size: 20px; font-weight: 700;">${stats.totalCards}</div>
            </div>
            <div style="background: rgba(255,255,255,.04); border-radius: 8px; padding: 12px;">
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Due Now</div>
                <div style="font-size: 20px; font-weight: 700; color: var(--orange);">${stats.dueNow}</div>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px;">
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">New</div>
                <div style="font-size: 16px; font-weight: 650;">${stats.newCards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Learning</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--cyan);">${stats.learningCards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Review</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--green);">${stats.reviewCards}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 4px;">Relearning</div>
                <div style="font-size: 16px; font-weight: 650; color: var(--purple);">${stats.relearningCards}</div>
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
