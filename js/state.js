export const state = {
    tab: 'flash',
    sessionCount: 12,
    translationDir: 'ENZH',
    card: {
        front: 'hanzi',
        id: '',           // WordID (xxHash of canonicalized hanzi + toned pinyin)
        word: '',
        pinyinToned: '',
        pinyinBare: '',
        tones: '',
        meaning: '',
        audioLabel: 'Pronunciation',
    },
    wordlist: [], // { id, word, pinyinToned, meaning, pinyinBare, tones }
    translation: {
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
        ],
    },
    imported: { deckName: 'My Wordlist' },
    apiKey: '',
    geminiModel: 'gemini-2.0-flash',
    cachedSentences: [], // [ { promptEN, promptZH, feedbackOverview, tokens } ]
    fsrsSubcards: {}, // Map of subcardKey -> FSRS subcard data: { wordId_front_backMode -> card }
    lastWordId: '', // Track last word ID shown to avoid showing same word twice in a row
    dailySupercardCount: 0, // Count of supercards completed today
    dailySupercardDate: null, // Date string (YYYY-MM-DD) for the day this count is for
    consecutiveDueCards: 0, // Track consecutive review card picks to ensure new cards are shown
    consecutiveNewCards: 0, // Track consecutive new card picks to ensure review cards are shown
    supercardLastShown: {} // Map of supercardKey (wordId_front) -> ISO timestamp of last shown
};

const STORAGE_KEY = 'mandalore_state_v1';

export function saveState() {
    try {
        // Serialize FSRS subcards (convert Date objects to ISO strings)
        const serializedFsrsSubcards = {};
        for (const [key, card] of Object.entries(state.fsrsSubcards)) {
            serializedFsrsSubcards[key] = {
                ...card,
                due: card.due ? card.due.toISOString() : null,
                last_review: card.last_review ? card.last_review.toISOString() : null
            };
        }
        
        const data = {
            wordlist: state.wordlist,
            deckName: state.imported.deckName,
            apiKey: state.apiKey,
            geminiModel: state.geminiModel,
            cachedSentences: state.cachedSentences,
            fsrsSubcards: serializedFsrsSubcards,
            dailySupercardCount: state.dailySupercardCount,
            dailySupercardDate: state.dailySupercardDate,
            consecutiveDueCards: state.consecutiveDueCards || 0,
            consecutiveNewCards: state.consecutiveNewCards || 0,
            supercardLastShown: state.supercardLastShown || {}
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('Failed to save state', e);
    }
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (Array.isArray(data.wordlist)) {
            state.wordlist = data.wordlist;
        }
        if (data.deckName) {
            state.imported.deckName = data.deckName;
        }
        if (data.apiKey) state.apiKey = data.apiKey;
        if (data.geminiModel) state.geminiModel = data.geminiModel;
        if (Array.isArray(data.cachedSentences)) state.cachedSentences = data.cachedSentences;
        
        // Deserialize FSRS subcards (convert ISO strings to Date objects)
        // Start fresh - ignore old fsrsCards if present
        if (data.fsrsSubcards && typeof data.fsrsSubcards === 'object') {
            state.fsrsSubcards = {};
            for (const [key, card] of Object.entries(data.fsrsSubcards)) {
                state.fsrsSubcards[key] = {
                    ...card,
                    due: card.due ? new Date(card.due) : new Date(),
                    last_review: card.last_review ? new Date(card.last_review) : undefined
                };
            }
        } else {
            state.fsrsSubcards = {};
        }
        
        // Load daily supercard count
        if (typeof data.dailySupercardCount === 'number') {
            state.dailySupercardCount = data.dailySupercardCount;
        }
        if (data.dailySupercardDate) {
            state.dailySupercardDate = data.dailySupercardDate;
        }
        
        // Load consecutive pool counters
        if (typeof data.consecutiveDueCards === 'number') {
            state.consecutiveDueCards = data.consecutiveDueCards;
        } else {
            state.consecutiveDueCards = 0;
        }
        if (typeof data.consecutiveNewCards === 'number') {
            state.consecutiveNewCards = data.consecutiveNewCards;
        } else {
            state.consecutiveNewCards = 0;
        }
        
        // Load supercard last shown timestamps (for anti-limbo tracking)
        if (data.supercardLastShown && typeof data.supercardLastShown === 'object') {
            state.supercardLastShown = data.supercardLastShown;
        } else {
            state.supercardLastShown = {};
        }
        
        // Reset counter if it's a new day
        checkAndResetDailyCounter();
        
        return true;
    } catch (e) {
        console.error('Failed to load state', e);
        return false;
    }
}

export function bumpSession(n) {
    state.sessionCount = Math.max(0, state.sessionCount + n);
}

/**
 * Get today's date string (YYYY-MM-DD) in local timezone
 */
function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Check if we need to reset the daily counter (new day)
 */
export function checkAndResetDailyCounter() {
    const today = getTodayDateString();
    if (state.dailySupercardDate !== today) {
        state.dailySupercardCount = 0;
        state.dailySupercardDate = today;
        saveState();
    }
}

/**
 * Increment daily supercard counter
 */
export function incrementDailySupercardCount() {
    checkAndResetDailyCounter();
    state.dailySupercardCount++;
    saveState();
}

/**
 * Get current daily supercard count
 */
export function getDailySupercardCount() {
    checkAndResetDailyCounter();
    return state.dailySupercardCount;
}
