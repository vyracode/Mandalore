/**
 * FSRS-6 Spaced Repetition Module
 * 
 * Manages FSRS subcard scheduling for flashcard practice.
 * Supercards (what user sees) = [Word][FrontMode]
 * Subcards (stored in FSRS) = [Word][FrontMode][BackMode] pairs
 */

// Import FSRS library (exposed as global FSRS from ts-fsrs.js)
// The library is loaded via script tag and exposes FSRS namespace

const FRONT_TYPES = ['hanzi', 'pronunciation', 'meaning'];

/**
 * Get back modes for a given front mode
 * @param {string} front - The front modality type
 * @returns {Array<string>} - Array of back mode types
 */
export function getBackModesForFront(front) {
    // All fronts have the same back modes (the other 3 modalities)
    // Excluding the front itself
    return FRONT_TYPES.filter(f => f !== front);
}

/**
 * Get FSRS subcard key for a word+front+back combination
 * @param {string} wordId - The word's unique ID
 * @param {string} front - The front modality type
 * @param {string} backMode - The back modality type
 * @returns {string} - Unique key for this subcard
 */
export function getSubcardKey(wordId, front, backMode) {
    return `${wordId}_${front}_${backMode}`;
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
 * Get or create FSRS subcard for a word+front+back combination
 * @param {string} wordId - The word's unique ID
 * @param {string} front - The front modality type
 * @param {string} backMode - The back modality type
 * @param {Object} fsrsSubcards - Map of existing FSRS subcards
 * @returns {Object} - FSRS subcard object
 */
export function getOrCreateSubcard(wordId, front, backMode, fsrsSubcards) {
    const key = getSubcardKey(wordId, front, backMode);
    
    if (fsrsSubcards && fsrsSubcards[key]) {
        // Return existing subcard, ensuring dates are Date objects
        const card = fsrsSubcards[key];
        return {
            ...card,
            due: card.due ? new Date(card.due) : new Date(),
            last_review: card.last_review ? new Date(card.last_review) : undefined
        };
    }
    
    // Create new subcard
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
 * Get the next supercard to review based on FSRS scheduling
 * Supercard dueness = most due subcard's dueness
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @param {string} lastWordId - Last word ID shown (to avoid showing same word twice in a row)
 * @returns {Object|null} - { word, front } or null if no cards due
 */
export function getNextSupercard(wordlist, fsrsSubcards, lastWordId = '') {
    if (!wordlist || wordlist.length === 0) return null;
    
    const now = new Date();
    const supercards = []; // Array of { word, front, mostDueSubcard, mostDueDate, priority }
    
    // Group subcards by supercard and find most due subcard for each
    for (const word of wordlist) {
        const wordId = word.id;
        if (!wordId) continue;
        
        // Skip if this is the same word as the last one shown
        if (lastWordId && wordId === lastWordId) continue;
        
        for (const front of FRONT_TYPES) {
            const backModes = getBackModesForFront(front);
            let mostDueSubcard = null;
            let mostDueDate = null;
            let mostDuePriority = Infinity;
            let hasAnyDue = false;
            
            // Check all subcards for this supercard
            for (const backMode of backModes) {
                const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
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
                        mostDueSubcard = subcard;
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
            
            // Add supercard if it has any subcards (due or upcoming)
            if (hasAnyDue || mostDueDate) {
                supercards.push({
                    word,
                    front,
                    mostDueSubcard,
                    mostDueDate: mostDueDate || new Date(),
                    priority: mostDuePriority
                });
            }
        }
    }
    
    // If no supercards available after filtering, allow the same word (fallback)
    if (supercards.length === 0 && lastWordId) {
        // Re-collect without filtering
        for (const word of wordlist) {
            const wordId = word.id;
            if (!wordId) continue;
            
            for (const front of FRONT_TYPES) {
                const backModes = getBackModesForFront(front);
                let mostDueSubcard = null;
                let mostDueDate = null;
                let mostDuePriority = Infinity;
                let hasAnyDue = false;
                
                for (const backMode of backModes) {
                    const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
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
                            mostDueSubcard = subcard;
                            mostDueDate = dueDate;
                            mostDuePriority = priority;
                        }
                    } else {
                        if (!mostDueDate || dueDate < mostDueDate) {
                            mostDueDate = dueDate;
                            mostDuePriority = Infinity;
                        }
                    }
                }
                
                if (hasAnyDue || mostDueDate) {
                    supercards.push({
                        word,
                        front,
                        mostDueSubcard,
                        mostDueDate: mostDueDate || new Date(),
                        priority: mostDuePriority
                    });
                }
            }
        }
    }
    
    if (supercards.length === 0) {
        // No supercards due, return earliest upcoming supercard (excluding last word if possible)
        const upcomingSupercards = [];
        for (const word of wordlist) {
            const wordId = word.id;
            if (!wordId) continue;
            
            // Skip if this is the same word as the last one shown
            if (lastWordId && wordId === lastWordId) continue;
            
            for (const front of FRONT_TYPES) {
                const backModes = getBackModesForFront(front);
                let earliestDueDate = null;
                
                for (const backMode of backModes) {
                    const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
                    if (!subcard) continue;
                    
                    const dueDate = subcard.due ? new Date(subcard.due) : new Date();
                    if (!earliestDueDate || dueDate < earliestDueDate) {
                        earliestDueDate = dueDate;
                    }
                }
                
                if (earliestDueDate) {
                    upcomingSupercards.push({
                        word,
                        front,
                        mostDueDate: earliestDueDate
                    });
                }
            }
        }
        
        // If no upcoming supercards after filtering, allow the same word (fallback)
        if (upcomingSupercards.length === 0 && lastWordId) {
            for (const word of wordlist) {
                const wordId = word.id;
                if (!wordId) continue;
                
                for (const front of FRONT_TYPES) {
                    const backModes = getBackModesForFront(front);
                    let earliestDueDate = null;
                    
                    for (const backMode of backModes) {
                        const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
                        if (!subcard) continue;
                        
                        const dueDate = subcard.due ? new Date(subcard.due) : new Date();
                        if (!earliestDueDate || dueDate < earliestDueDate) {
                            earliestDueDate = dueDate;
                        }
                    }
                    
                    if (earliestDueDate) {
                        upcomingSupercards.push({
                            word,
                            front,
                            mostDueDate: earliestDueDate
                        });
                    }
                }
            }
        }
        
        if (upcomingSupercards.length === 0) return null;
        
        // Sort by due date and return earliest
        upcomingSupercards.sort((a, b) => a.mostDueDate - b.mostDueDate);
        const next = upcomingSupercards[0];
        return {
            word: next.word,
            front: next.front
        };
    }
    
    // Sort by priority (most overdue first)
    supercards.sort((a, b) => b.priority - a.priority);
    
    // Randomly select from top 20% most overdue supercards (or top 3, whichever is larger)
    const topCount = Math.max(3, Math.ceil(supercards.length * 0.2));
    const topSupercards = supercards.slice(0, topCount);
    const selected = topSupercards[Math.floor(Math.random() * topSupercards.length)];
    
    return {
        word: selected.word,
        front: selected.front
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
