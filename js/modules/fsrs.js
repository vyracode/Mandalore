/**
 * FSRS-6 Spaced Repetition Module
 * 
 * Manages FSRS card scheduling for flashcard practice.
 * Each word+front combination is tracked as a separate FSRS card.
 */

// Import FSRS library (exposed as global FSRS from ts-fsrs.js)
// The library is loaded via script tag and exposes FSRS namespace

const FRONT_TYPES = ['hanzi', 'pronunciation', 'meaning'];

/**
 * Get FSRS card key for a word+front combination
 * @param {string} wordId - The word's unique ID
 * @param {string} front - The front modality type
 * @returns {string} - Unique key for this card
 */
export function getCardKey(wordId, front) {
    return `${wordId}_${front}`;
}

/**
 * Initialize FSRS instance with default parameters
 */
let fsrsInstance = null;

function getFSRS() {
    if (!fsrsInstance) {
        // Check if FSRS is available (from ts-fsrs.js)
        if (typeof FSRS === 'undefined') {
            console.error('FSRS library not loaded');
            return null;
        }
        
        // Create FSRS instance with default parameters
        // We use binary grading: Good (Right) and Again (Wrong)
        fsrsInstance = new FSRS.FSRS({
            request_retention: 0.9,
            maximum_interval: 36500, // ~100 years
            enable_fuzz: true,
            enable_short_term: true
        });
    }
    return fsrsInstance;
}

/**
 * Create an empty FSRS card
 * @param {Date} due - Optional due date (defaults to now)
 * @returns {Object} - Empty FSRS card
 */
export function createEmptyCard(due = null) {
    if (typeof FSRS === 'undefined') {
        console.error('FSRS library not loaded');
        return null;
    }
    return FSRS.createEmptyCard(due);
}

/**
 * Get or create FSRS card for a word+front combination
 * @param {string} wordId - The word's unique ID
 * @param {string} front - The front modality type
 * @param {Object} fsrsCards - Map of existing FSRS cards
 * @returns {Object} - FSRS card object
 */
export function getOrCreateCard(wordId, front, fsrsCards) {
    const key = getCardKey(wordId, front);
    
    if (fsrsCards && fsrsCards[key]) {
        // Return existing card, ensuring dates are Date objects
        const card = fsrsCards[key];
        return {
            ...card,
            due: card.due ? new Date(card.due) : new Date(),
            last_review: card.last_review ? new Date(card.last_review) : undefined
        };
    }
    
    // Create new card
    return createEmptyCard();
}

/**
 * Get scheduling preview for a card (all possible ratings)
 * @param {Object} card - FSRS card object
 * @param {Date} now - Current date/time
 * @returns {Object} - RecordLog with scheduling for all ratings
 */
export function previewCard(card, now = new Date()) {
    const fsrs = getFSRS();
    if (!fsrs || !card) return null;
    
    try {
        return fsrs.repeat(card, now);
    } catch (e) {
        console.error('Error previewing card:', e);
        return null;
    }
}

/**
 * Record a review and get updated card
 * @param {Object} card - FSRS card object
 * @param {Date} now - Current date/time
 * @param {number} rating - Rating: 1 (Again/Wrong) or 3 (Good/Right)
 * @returns {Object|null} - Updated card and log, or null on error
 */
export function recordReview(card, now = new Date(), rating) {
    const fsrs = getFSRS();
    if (!fsrs || !card) return null;
    
    // Map our binary ratings to FSRS ratings
    // Rating.Again = 1 (Wrong)
    // Rating.Good = 3 (Right)
    const fsrsRating = rating === 1 ? FSRS.Rating.Again : FSRS.Rating.Good;
    
    try {
        const result = fsrs.next(card, now, fsrsRating);
        return result;
    } catch (e) {
        console.error('Error recording review:', e);
        return null;
    }
}

/**
 * Get the next card to review based on FSRS scheduling
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsCards - Map of FSRS cards
 * @returns {Object|null} - { word, front, card } or null if no cards due
 */
export function getNextCard(wordlist, fsrsCards) {
    if (!wordlist || wordlist.length === 0) return null;
    
    const now = new Date();
    const dueCards = [];
    
    // Collect all cards that are due or overdue
    for (const word of wordlist) {
        const wordId = word.id;
        if (!wordId) continue;
        
        for (const front of FRONT_TYPES) {
            const card = getOrCreateCard(wordId, front, fsrsCards);
            if (!card) continue;
            
            const dueDate = card.due ? new Date(card.due) : new Date(0);
            const isDue = dueDate <= now;
            
            if (isDue || !card.last_review) {
                // Card is due or never reviewed
                dueCards.push({
                    word,
                    front,
                    card,
                    dueDate,
                    priority: isDue ? (now - dueDate) : Infinity // Earlier due = higher priority
                });
            }
        }
    }
    
    if (dueCards.length === 0) {
        // No cards due, return earliest upcoming card
        const upcomingCards = [];
        for (const word of wordlist) {
            const wordId = word.id;
            if (!wordId) continue;
            
            for (const front of FRONT_TYPES) {
                const card = getOrCreateCard(wordId, front, fsrsCards);
                if (!card) continue;
                
                const dueDate = card.due ? new Date(card.due) : new Date();
                upcomingCards.push({
                    word,
                    front,
                    card,
                    dueDate
                });
            }
        }
        
        if (upcomingCards.length === 0) return null;
        
        // Sort by due date and return earliest
        upcomingCards.sort((a, b) => a.dueDate - b.dueDate);
        const next = upcomingCards[0];
        return {
            word: next.word,
            front: next.front,
            card: next.card
        };
    }
    
    // Sort by priority (most overdue first)
    dueCards.sort((a, b) => a.priority - b.priority);
    
    // Randomly select from top 20% most overdue cards (or top 3, whichever is larger)
    // This adds some variety while prioritizing overdue cards
    const topCount = Math.max(3, Math.ceil(dueCards.length * 0.2));
    const topCards = dueCards.slice(0, topCount);
    const selected = topCards[Math.floor(Math.random() * topCards.length)];
    
    return {
        word: selected.word,
        front: selected.front,
        card: selected.card
    };
}

/**
 * Serialize FSRS card for storage
 * @param {Object} card - FSRS card object
 * @returns {Object} - Serialized card (dates as ISO strings)
 */
export function serializeCard(card) {
    if (!card) return null;
    
    return {
        ...card,
        due: card.due ? card.due.toISOString() : null,
        last_review: card.last_review ? card.last_review.toISOString() : null
    };
}

/**
 * Deserialize FSRS card from storage
 * @param {Object} data - Serialized card data
 * @returns {Object} - FSRS card object (dates as Date objects)
 */
export function deserializeCard(data) {
    if (!data) return null;
    
    return {
        ...data,
        due: data.due ? new Date(data.due) : new Date(),
        last_review: data.last_review ? new Date(data.last_review) : undefined
    };
}
