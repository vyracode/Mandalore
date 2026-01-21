/**
 * FSRS-6 Spaced Repetition Module
 * 
 * Manages FSRS subcard scheduling for flashcard practice.
 * Supercards (what user sees) = [Word][FrontMode]
 * Subcards (stored in FSRS) = [Word][FrontMode][BackMode] pairs
 * 
 * KEY PRINCIPLES:
 * 1. Cards we do well at → seen less often (longer FSRS intervals)
 * 2. Cards we do poorly at → seen more often (shorter FSRS intervals)
 * 3. After long absence → prioritize overdue cards over new cards
 * 4. No card should ever be in limbo (always guaranteed selection fallback)
 * 
 * SCORING SYSTEM:
 * - Binary grading: Right (FSRS Rating.Good=3) or Wrong (FSRS Rating.Again=1)
 * - Right answer: FSRS increases stability → longer interval → card shown less often
 * - Wrong answer: FSRS resets/decreases stability → shorter interval → card shown more often
 * 
 * SELECTION ALGORITHM:
 * 1. Calculate overdue score for each supercard based on most urgent subcard
 * 2. Separate into pools: review (has any overdue/due subcards) vs new (all subcards new)
 * 3. Use adaptive mixing ratio based on practice recency
 * 4. Within pool, prioritize by urgency score
 * 5. Anti-limbo guarantees:
 *    a. Force pool switch after MAX_CONSECUTIVE_SAME_POOL picks from same pool
 *    b. Boost priority of cards not shown in LIMBO_BOOST_THRESHOLD_DAYS
 *    c. Track last_shown timestamp for each supercard to detect limbo situations
 */

import { state, saveState } from '../state.js';

// Import FSRS library (exposed as global FSRS from ts-fsrs.js)
// The library is loaded via script tag and exposes FSRS namespace

// Front modes = what can be shown on the front of a card
const FRONT_TYPES = ['hanzi', 'pronunciation', 'meaning'];

// All modalities (pinyin can only be back, never front)
const ALL_MODALITIES = ['hanzi', 'pronunciation', 'meaning', 'pinyin'];

// Time constants (in milliseconds)
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// Anti-limbo constants
const MAX_CONSECUTIVE_SAME_POOL = 10; // Force switch pools after this many picks from same pool
const MAX_CONSECUTIVE_NEW_CARDS = 5; // Force review card after this many consecutive new cards
const LIMBO_BOOST_THRESHOLD_DAYS = 14; // Boost cards not shown for this many days
const LIMBO_BOOST_MULTIPLIER = 50; // Score boost for limbo cards (added to urgency)
const MAX_LIMBO_BOOST = 500; // Cap limbo boost to prevent Infinity issues
const NEVER_SHOWN_DAYS = 9999; // Sentinel value for cards never shown (avoids Infinity)

/**
 * Get back modes for a given front mode
 * @param {string} front - The front modality type
 * @returns {Array<string>} - Array of back mode types
 * 
 * Back modes include all modalities EXCEPT the front:
 * - If front is 'hanzi': back = ['pronunciation', 'meaning', 'pinyin']
 * - If front is 'pronunciation': back = ['hanzi', 'meaning', 'pinyin']
 * - If front is 'meaning': back = ['hanzi', 'pronunciation', 'pinyin']
 * 
 * Note: 'pinyin' can only be a back mode, never a front mode.
 */
export function getBackModesForFront(front) {
    // All modalities except the front itself
    // This includes 'pinyin' which is always on the back (never on front)
    return ALL_MODALITIES.filter(m => m !== front);
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
 * Get supercard key for a word+front combination (used for last_shown tracking)
 * @param {string} wordId - The word's unique ID
 * @param {string} front - The front modality type
 * @returns {string} - Unique key for this supercard
 */
export function getSupercardKey(wordId, front) {
    return `${wordId}_${front}`;
}

/**
 * Record that a supercard was shown to the user (for anti-limbo tracking)
 * @param {string} wordId - The word's unique ID
 * @param {string} front - The front modality type
 */
export function recordSupercardShown(wordId, front) {
    const key = getSupercardKey(wordId, front);
    if (!state.supercardLastShown) {
        state.supercardLastShown = {};
    }
    state.supercardLastShown[key] = new Date().toISOString();
    saveState();
}

/**
 * Get days since a supercard was last shown
 * @param {string} wordId - The word's unique ID
 * @param {string} front - The front modality type
 * @returns {number} - Days since last shown, or NEVER_SHOWN_DAYS if never shown
 */
function getDaysSinceLastShown(wordId, front) {
    const key = getSupercardKey(wordId, front);
    const lastShown = state.supercardLastShown?.[key];
    if (!lastShown) {
        return NEVER_SHOWN_DAYS; // Never shown - use sentinel value instead of Infinity to avoid math issues
    }
    const lastShownDate = new Date(lastShown);
    if (isNaN(lastShownDate.getTime())) {
        return NEVER_SHOWN_DAYS; // Invalid date - treat as never shown
    }
    const now = new Date();
    return Math.max(0, (now - lastShownDate) / MS_PER_DAY);
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
 * Calculate how long since the most recent review across all subcards
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @returns {number} - Milliseconds since last review, or Infinity if never reviewed
 */
function getTimeSinceLastReview(fsrsSubcards) {
    if (!fsrsSubcards || Object.keys(fsrsSubcards).length === 0) {
        return Infinity;
    }
    
    const now = new Date();
    let mostRecentReview = null;
    
    for (const card of Object.values(fsrsSubcards)) {
        if (card.last_review) {
            const reviewDate = new Date(card.last_review);
            if (!mostRecentReview || reviewDate > mostRecentReview) {
                mostRecentReview = reviewDate;
            }
        }
    }
    
    if (!mostRecentReview) {
        return Infinity;
    }
    
    return now - mostRecentReview;
}

/**
 * Calculate adaptive mixing ratio based on practice recency and overdue cards
 * Returns the probability of showing a NEW card (0.0 to 0.5)
 * 
 * Logic:
 * - Just practiced (< 1 hour ago): 40% new cards
 * - Practiced today (1-24 hours): 30% new cards  
 * - Practiced yesterday (1-2 days): 20% new cards
 * - Absent 2-7 days: 10% new cards
 * - Absent > 1 week: 5% new cards (focus on catching up)
 * 
 * @param {number} msSinceLastReview - Milliseconds since last review
 * @param {number} overdueCardCount - Number of overdue cards
 * @param {number} totalDueCards - Total number of due/review cards
 * @returns {number} - Probability of showing new card (0.0 to 0.5)
 */
function getAdaptiveNewCardRatio(msSinceLastReview, overdueCardCount, totalDueCards) {
    // Base ratio starts at 40% for active users
    let baseRatio = 0.4;
    
    // Reduce ratio based on time since last practice
    if (msSinceLastReview === Infinity) {
        // Never practiced - show new cards to get started
        baseRatio = 0.5;
    } else if (msSinceLastReview < MS_PER_HOUR) {
        // Practiced within the hour - normal mix
        baseRatio = 0.4;
    } else if (msSinceLastReview < MS_PER_DAY) {
        // Practiced today - slightly fewer new cards
        baseRatio = 0.35;
    } else if (msSinceLastReview < 2 * MS_PER_DAY) {
        // Practiced yesterday - prioritize reviews
        baseRatio = 0.25;
    } else if (msSinceLastReview < 7 * MS_PER_DAY) {
        // Absent 2-7 days - focus on catching up
        baseRatio = 0.15;
    } else {
        // Absent > 1 week - heavy focus on reviews
        baseRatio = 0.08;
    }
    
    // Further reduce ratio if there are many overdue cards
    if (totalDueCards > 0) {
        const overdueRatio = overdueCardCount / totalDueCards;
        // If > 50% of due cards are actually overdue, reduce new card chance
        if (overdueRatio > 0.5) {
            baseRatio *= (1 - (overdueRatio - 0.5)); // Scale down proportionally
        }
    }
    
    // Clamp to reasonable range
    return Math.max(0.05, Math.min(0.5, baseRatio));
}

/**
 * Calculate relative overdue score for a card
 * A card that's 1 day overdue on a 1-day interval is MORE urgent than
 * a card that's 1 day overdue on a 30-day interval
 * 
 * SCORING SCALE:
 * - New cards: { isNew: true, score: 0 } (handled separately in pool selection)
 * - Not yet due: negative score (days until due, e.g., -5 = due in 5 days)
 * - Due today: score ~0
 * - Overdue: positive score = (relative_overdue * 100) + log(absolute_overdue)
 *   - A card 1 day overdue on 1-day interval: ~100 + 0.69 = ~101
 *   - A card 1 day overdue on 7-day interval: ~14.3 + 0.69 = ~15
 *   - A card 30 days overdue on 90-day interval: ~33.3 + 3.4 = ~37
 * 
 * @param {Object} subcard - FSRS subcard object
 * @param {Date} now - Current time
 * @returns {{isNew: boolean, score: number}} - Score object
 */
function getRelativeOverdueScore(subcard, now) {
    if (!subcard || !subcard.last_review) {
        // New cards - marked separately so we can handle them in pool selection
        return { isNew: true, score: 0 };
    }
    
    const dueDate = subcard.due ? new Date(subcard.due) : new Date();
    const overdueMs = now - dueDate;
    
    if (overdueMs <= 0) {
        // Not overdue - return negative score based on time until due
        // Closer to 0 = more urgent (due sooner)
        const daysUntilDue = Math.abs(overdueMs) / MS_PER_DAY;
        return { isNew: false, score: -daysUntilDue };
    }
    
    // Get the scheduled interval (how long between reviews)
    const scheduledDays = subcard.scheduled_days || 1;
    const scheduledMs = scheduledDays * MS_PER_DAY;
    
    // Calculate relative overdue ratio
    // A card 1 day late on a 1-day interval (ratio=1) is more urgent than
    // a card 1 day late on a 30-day interval (ratio=0.033)
    const overdueRatio = overdueMs / Math.max(scheduledMs, MS_PER_HOUR);
    
    // Add logarithmic component for absolute overdue time (capped at 365 days)
    // This ensures very old cards still get some priority even with long intervals
    const overdueDays = Math.min(overdueMs / MS_PER_DAY, 365);
    const absoluteComponent = Math.log(overdueDays + 1);
    
    // Combined score: relative urgency (dominant) + absolute urgency
    const score = (overdueRatio * 100) + absoluteComponent;
    
    return { isNew: false, score };
}

/**
 * Get the next supercard to review based on FSRS scheduling
 * 
 * SELECTION ALGORITHM:
 * 1. Collect all supercards and calculate their urgency scores
 * 2. Classify into pools: NEW (all subcards never reviewed) vs REVIEW (any subcard reviewed)
 * 3. Apply adaptive mixing ratio based on practice recency
 * 4. Within pool, prioritize by urgency score (overdue cards first)
 * 5. Anti-limbo guarantees ensure all cards are eventually shown
 * 
 * POOL CLASSIFICATION:
 * - NEW pool: All subcards have never been reviewed (completely fresh word+front combo)
 * - REVIEW pool: At least one subcard has been reviewed (includes "partially new")
 *   Note: "Partially new" cards go to REVIEW because reviewed subcards need their schedule maintained
 * 
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @param {string} lastWordId - Last word ID shown (to avoid showing same word twice in a row)
 * @returns {Object|null} - { word, front } or null if no cards available
 */
export function getNextSupercard(wordlist, fsrsSubcards, lastWordId = '') {
    if (!wordlist || wordlist.length === 0) {
        return null;
    }
    
    const now = new Date();
    
    // Calculate time since last practice for adaptive mixing
    const msSinceLastReview = getTimeSinceLastReview(fsrsSubcards);
    
    // Collect all supercards with their scores
    const allSupercards = [];
    let overdueCount = 0;
    let dueNowCount = 0;
    let limboCardCount = 0;
    
    for (const word of wordlist) {
        const wordId = word.id;
        if (!wordId) {
            console.warn('Word missing ID:', word.word);
            continue;
        }
        
        // Skip last word shown (unless it's the only option - handled later)
        const isLastWord = lastWordId && wordId === lastWordId;
        
        for (const front of FRONT_TYPES) {
            const backModes = getBackModesForFront(front);
            
            // Track subcard states for this supercard
            let allSubcardsNew = true;
            let hasOverdueSubcard = false;
            let hasDueSubcard = false;
            let bestReviewScore = -Infinity;
            
            // Analyze all subcards for this supercard
            for (const backMode of backModes) {
                const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
                if (!subcard) continue;
                
                const scoreResult = getRelativeOverdueScore(subcard, now);
                
                if (scoreResult.isNew) {
                    // This subcard has never been reviewed
                    // (allSubcardsNew stays true only if ALL are new)
                } else {
                    // This subcard has been reviewed at least once
                    allSubcardsNew = false;
                    
                    // Track the best (most urgent) score among reviewed subcards
                    if (scoreResult.score > bestReviewScore) {
                        bestReviewScore = scoreResult.score;
                    }
                    
                    // Classify urgency:
                    // score > 0 = overdue
                    // score >= -0.5 = due within ~12 hours (treat as "due now")
                    if (scoreResult.score > 0) {
                        hasOverdueSubcard = true;
                        hasDueSubcard = true;
                    } else if (scoreResult.score >= -0.5) {
                        hasDueSubcard = true;
                    }
                }
            }
            
            // Calculate final urgency score for this supercard
            let urgencyScore;
            if (allSubcardsNew) {
                // Completely new supercard - base score 0 (will be in NEW pool)
                urgencyScore = 0;
            } else {
                // Has some reviewed subcards - use the most urgent one's score
                urgencyScore = bestReviewScore;
            }
            
            // ANTI-LIMBO BOOST: Check if this card hasn't been shown recently
            // Apply a score boost to cards that might be stuck in limbo
            const daysSinceShown = getDaysSinceLastShown(wordId, front);
            let limboBoost = 0;
            let isInLimbo = false;
            const neverShown = daysSinceShown >= NEVER_SHOWN_DAYS;
            
            if (daysSinceShown >= LIMBO_BOOST_THRESHOLD_DAYS) {
                // Card hasn't been shown in a while - boost its priority
                // The boost increases with how long it's been in limbo
                // Use capped calculation to prevent Infinity/overflow issues
                const effectiveDays = Math.min(daysSinceShown, 365); // Cap at 1 year for calculation
                const logFactor = Math.log(Math.max(1, effectiveDays / LIMBO_BOOST_THRESHOLD_DAYS));
                limboBoost = Math.min(
                    LIMBO_BOOST_MULTIPLIER * (1 + logFactor),
                    MAX_LIMBO_BOOST
                );
                // Extra boost for cards that have NEVER been shown (highest priority to break limbo)
                if (neverShown) {
                    limboBoost = MAX_LIMBO_BOOST; // Maximum boost for never-shown cards
                }
                isInLimbo = true;
                limboCardCount++;
                const daysDisplay = neverShown ? 'NEVER' : daysSinceShown.toFixed(1);
                console.log(`⚠️ Limbo boost for ${word.word} [${front}]: +${limboBoost.toFixed(1)} (${daysDisplay} days since shown)`);
            }
            
            urgencyScore += limboBoost;
            
            // ANTI-LIMBO: Always add the supercard (never filter out!)
            allSupercards.push({
                word,
                front,
                urgencyScore,
                isCompletelyNew: allSubcardsNew,
                hasOverdueSubcard,
                hasDueSubcard,
                isLastWord,
                isInLimbo,
                neverShown, // Track if card has NEVER been shown
                daysSinceShown
            });
            
            // Track counts for adaptive ratio (excluding last word)
            if (!isLastWord && !allSubcardsNew) {
                if (hasOverdueSubcard) overdueCount++;
                if (hasDueSubcard) dueNowCount++;
            }
        }
    }
    
    // ANTI-LIMBO: If no cards at all, something is wrong
    if (allSupercards.length === 0) {
        console.error('No supercards available! This should not happen with a non-empty wordlist.');
        return null;
    }
    
    // Separate cards into pools (excluding last word initially)
    const availableCards = allSupercards.filter(sc => !sc.isLastWord);
    
    // ANTI-LIMBO: If excluding last word leaves nothing, allow it
    // Also handle small wordlists (1-2 words) specially
    let cardsToConsider;
    if (availableCards.length === 0) {
        // Only one word/supercard available - must use it
        cardsToConsider = allSupercards;
        console.log('⚠️ Only one option available, using last word');
    } else if (wordlist.length <= 2 && availableCards.length < 3) {
        // Very small wordlist - be more lenient about repetition
        // Include last word with lower priority rather than excluding entirely
        cardsToConsider = allSupercards.map(sc => ({
            ...sc,
            // Penalize last word score to prefer other cards, but don't exclude
            urgencyScore: sc.isLastWord ? sc.urgencyScore - 200 : sc.urgencyScore
        }));
        console.log('ℹ️ Small wordlist - including last word with penalty');
    } else {
        cardsToConsider = availableCards;
    }
    
    // POOL CLASSIFICATION:
    // NEW pool: completely new supercards (all subcards never reviewed)
    // REVIEW pool: supercards with at least one reviewed subcard (includes "partially new")
    const newPool = cardsToConsider.filter(sc => sc.isCompletelyNew);
    const reviewPool = cardsToConsider.filter(sc => !sc.isCompletelyNew);
    
    // Calculate adaptive mixing ratio
    const newCardRatio = getAdaptiveNewCardRatio(msSinceLastReview, overdueCount, dueNowCount);
    
    // Decide which pool to draw from
    let selectedPool;
    let poolName;
    
    const hasNewCards = newPool.length > 0;
    const hasReviewCards = reviewPool.length > 0;
    
    // Initialize consecutive counters if missing
    if (typeof state.consecutiveDueCards !== 'number') {
        state.consecutiveDueCards = 0;
    }
    if (typeof state.consecutiveNewCards !== 'number') {
        state.consecutiveNewCards = 0;
    }
    
    if (hasNewCards && hasReviewCards) {
        // Both pools have cards - use adaptive ratio
        const showNew = Math.random() < newCardRatio;
        
        if (showNew) {
            // Selected new card pool - increment new counter, reset due counter
            state.consecutiveNewCards++;
            state.consecutiveDueCards = 0;
            
            // SYMMETRIC ANTI-LIMBO: Force review card if too many new cards in a row
            if (state.consecutiveNewCards >= MAX_CONSECUTIVE_NEW_CARDS && hasReviewCards) {
                console.log(`⚠️ Anti-limbo: Forcing REVIEW card after ${state.consecutiveNewCards} consecutive new cards`);
                state.consecutiveNewCards = 0;
                selectedPool = reviewPool;
                poolName = 'REVIEW (anti-limbo forced)';
            } else {
                selectedPool = newPool;
                poolName = 'NEW';
            }
        } else {
            // Selected review pool - increment due counter, reset new counter
            state.consecutiveDueCards++;
            state.consecutiveNewCards = 0;
            
            // ANTI-LIMBO GUARANTEE: Force new card if too many reviews in a row
            if (state.consecutiveDueCards >= MAX_CONSECUTIVE_SAME_POOL && hasNewCards) {
                console.log(`⚠️ Anti-limbo: Forcing NEW card after ${state.consecutiveDueCards} consecutive reviews`);
                state.consecutiveDueCards = 0;
                selectedPool = newPool;
                poolName = 'NEW (anti-limbo forced)';
            } else {
                selectedPool = reviewPool;
                poolName = 'REVIEW';
            }
        }
        saveState();
    } else if (hasNewCards) {
        // Only new cards available - reset both counters
        state.consecutiveDueCards = 0;
        state.consecutiveNewCards = 0;
        selectedPool = newPool;
        poolName = 'NEW (only option)';
        saveState();
    } else if (hasReviewCards) {
        // Only review cards available - reset both counters
        state.consecutiveDueCards = 0;
        state.consecutiveNewCards = 0;
        selectedPool = reviewPool;
        poolName = 'REVIEW (only option)';
        saveState();
    } else {
        // ULTIMATE FALLBACK: This shouldn't happen, but safety first
        console.warn('⚠️ No cards in either pool - using all cards as fallback');
        state.consecutiveDueCards = 0;
        state.consecutiveNewCards = 0;
        selectedPool = cardsToConsider;
        poolName = 'FALLBACK (all cards)';
        saveState();
    }
    
    // ANTI-STUCK MECHANISM: Every N cards, force selection from cards not recently shown
    // This ensures variety even if the algorithm keeps picking the same cards
    const VARIETY_INTERVAL = 15; // Force variety every 15 cards
    const totalCardsShown = (state.dailySupercardCount || 0);
    if (totalCardsShown > 0 && totalCardsShown % VARIETY_INTERVAL === 0) {
        // Find cards that haven't been shown recently (not in limbo, but less recently shown)
        const lessRecentCards = selectedPool.filter(sc => sc.daysSinceShown >= 1);
        if (lessRecentCards.length > 0) {
            console.log(`🔄 Variety check (card #${totalCardsShown}): Prioritizing ${lessRecentCards.length} less-recent cards`);
            selectedPool = lessRecentCards;
        }
    }
    
    // Sort pool by urgency score (highest = most urgent)
    // For NEW pool: all scores are 0 unless limbo boosted, so randomness decides
    // For REVIEW pool: overdue cards (positive scores) come first
    selectedPool.sort((a, b) => {
        // Guard against NaN or undefined scores (shouldn't happen but safety first)
        const scoreA = Number.isFinite(a.urgencyScore) ? a.urgencyScore : 0;
        const scoreB = Number.isFinite(b.urgencyScore) ? b.urgencyScore : 0;
        
        // PRIORITY 1: Never-shown cards get highest priority within their pool
        // This ensures new cards in the wordlist don't get stuck forever
        if (a.neverShown && !b.neverShown) return -1;
        if (!a.neverShown && b.neverShown) return 1;
        
        // PRIORITY 2: Urgency score (descending - higher = more urgent)
        const scoreDiff = scoreB - scoreA;
        if (Math.abs(scoreDiff) > 0.001) {
            return scoreDiff;
        }
        
        // PRIORITY 3: Tie-breaker - use consistent hash to avoid bias
        // This provides stable ordering while still distributing selection
        const hashA = (a.word.id || '').charCodeAt(0) + a.front.charCodeAt(0);
        const hashB = (b.word.id || '').charCodeAt(0) + b.front.charCodeAt(0);
        if (hashA !== hashB) return hashA - hashB;
        
        // Final: random for truly equal items
        return Math.random() - 0.5;
    });
    
    // Select from top candidates with some randomness for variety
    // This prevents always showing the exact same card when multiple are equally urgent
    const topCount = Math.min(5, Math.max(2, Math.ceil(selectedPool.length * 0.3)));
    const topCandidates = selectedPool.slice(0, topCount);
    
    // Group by word to add word-level variety
    const byWord = {};
    topCandidates.forEach(sc => {
        const wid = sc.word.id;
        if (!byWord[wid]) byWord[wid] = [];
        byWord[wid].push(sc);
    });
    
    // Pick a random word from top candidates, then a random front for that word
    const wordIds = Object.keys(byWord);
    const randomWordId = wordIds[Math.floor(Math.random() * wordIds.length)];
    const cardsForWord = byWord[randomWordId];
    const selected = cardsForWord[Math.floor(Math.random() * cardsForWord.length)];
    
    // Log final selection
    const selectionFlags = [];
    if (selected.hasOverdueSubcard) selectionFlags.push('OVERDUE');
    if (selected.hasDueSubcard && !selected.hasOverdueSubcard) selectionFlags.push('DUE');
    if (selected.isCompletelyNew) selectionFlags.push('NEW');
    if (selected.neverShown) selectionFlags.push('NEVER-SHOWN');
    if (selected.isInLimbo && !selected.neverShown) selectionFlags.push('LIMBO-BOOSTED');
    
    // Record that this supercard is being shown (for anti-limbo tracking)
    recordSupercardShown(selected.word.id, selected.front);
    
    return {
        word: selected.word,
        front: selected.front
    };
}

/**
 * Get all supercards with pedigree information in selection order
 * Returns all supercards sorted by urgency, with pedigree reasons explaining why each will be shown
 * 
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @param {string} lastWordId - Last word ID shown (for ordering, but include all cards)
 * @returns {Array} - Array of supercard objects with pedigree information
 */
export function getAllSupercardsWithPedigree(wordlist, fsrsSubcards, lastWordId = '') {
    if (!wordlist || wordlist.length === 0) {
        return [];
    }
    
    const now = new Date();
    
    // Collect all supercards with their scores and pedigree info
    const allSupercards = [];
    
    for (const word of wordlist) {
        const wordId = word.id;
        if (!wordId) {
            console.warn('Word missing ID:', word.word);
            continue;
        }
        
        const isLastWord = lastWordId && wordId === lastWordId;
        
        for (const front of FRONT_TYPES) {
            const backModes = getBackModesForFront(front);
            
            // Track subcard states for this supercard
            let allSubcardsNew = true;
            let hasOverdueSubcard = false;
            let hasDueSubcard = false;
            let bestReviewScore = -Infinity;
            let mostUrgentBackMode = null; // Track which back mode drives selection
            
            // Analyze all subcards for this supercard
            for (const backMode of backModes) {
                const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
                if (!subcard) continue;
                
                const scoreResult = getRelativeOverdueScore(subcard, now);
                
                if (scoreResult.isNew) {
                    // This subcard has never been reviewed
                    // (allSubcardsNew stays true only if ALL are new)
                } else {
                    // This subcard has been reviewed at least once
                    allSubcardsNew = false;
                    
                    // Track the best (most urgent) score among reviewed subcards
                    // Also track which back mode produced this score
                    if (scoreResult.score > bestReviewScore) {
                        bestReviewScore = scoreResult.score;
                        mostUrgentBackMode = backMode;
                    }
                    
                    // Classify urgency:
                    // score > 0 = overdue
                    // score >= -0.5 = due within ~12 hours (treat as "due now")
                    if (scoreResult.score > 0) {
                        hasOverdueSubcard = true;
                        hasDueSubcard = true;
                    } else if (scoreResult.score >= -0.5) {
                        hasDueSubcard = true;
                    }
                }
            }
            
            // Calculate final urgency score for this supercard
            let urgencyScore;
            if (allSubcardsNew) {
                // Completely new supercard - base score 0 (will be in NEW pool)
                urgencyScore = 0;
            } else {
                // Has some reviewed subcards - use the most urgent one's score
                urgencyScore = bestReviewScore;
            }
            
            // ANTI-LIMBO BOOST: Check if this card hasn't been shown recently
            const daysSinceShown = getDaysSinceLastShown(wordId, front);
            let limboBoost = 0;
            let isInLimbo = false;
            const neverShown = daysSinceShown >= NEVER_SHOWN_DAYS;
            
            if (daysSinceShown >= LIMBO_BOOST_THRESHOLD_DAYS) {
                const effectiveDays = Math.min(daysSinceShown, 365);
                const logFactor = Math.log(Math.max(1, effectiveDays / LIMBO_BOOST_THRESHOLD_DAYS));
                limboBoost = Math.min(
                    LIMBO_BOOST_MULTIPLIER * (1 + logFactor),
                    MAX_LIMBO_BOOST
                );
                if (neverShown) {
                    limboBoost = MAX_LIMBO_BOOST;
                }
                isInLimbo = true;
            }
            
            urgencyScore += limboBoost;
            
            // Determine pedigree reason
            let pedigree;
            if (allSubcardsNew) {
                pedigree = { reason: 'New' };
            } else if (hasOverdueSubcard || hasDueSubcard) {
                // Practice - include the back mode that's driving selection
                pedigree = { reason: 'Practice', backMode: mostUrgentBackMode };
            } else if (isInLimbo) {
                // In limbo but not overdue/due
                pedigree = { reason: 'Limbo' };
            } else if (daysSinceShown >= 1 && daysSinceShown < LIMBO_BOOST_THRESHOLD_DAYS) {
                // Variety check would apply (not overdue/due, not in limbo, but less recently shown)
                pedigree = { reason: 'Variety' };
            } else {
                // Fallback - not overdue/due, not in limbo, shown recently or never
                // Still show as Practice with the most urgent back mode
                pedigree = { reason: 'Practice', backMode: mostUrgentBackMode };
            }
            
            allSupercards.push({
                word,
                front,
                urgencyScore,
                isCompletelyNew: allSubcardsNew,
                hasOverdueSubcard,
                hasDueSubcard,
                isLastWord,
                isInLimbo,
                neverShown,
                daysSinceShown,
                mostUrgentBackMode,
                pedigree
            });
        }
    }
    
    // Separate cards into pools (excluding last word initially for ordering)
    const availableCards = allSupercards.filter(sc => !sc.isLastWord);
    
    // Handle small wordlists - include last word with penalty
    let cardsToConsider;
    if (availableCards.length === 0) {
        cardsToConsider = allSupercards;
    } else if (wordlist.length <= 2 && availableCards.length < 3) {
        cardsToConsider = allSupercards.map(sc => ({
            ...sc,
            urgencyScore: sc.isLastWord ? sc.urgencyScore - 200 : sc.urgencyScore
        }));
    } else {
        cardsToConsider = availableCards;
    }
    
    // Separate into pools
    const newPool = cardsToConsider.filter(sc => sc.isCompletelyNew);
    const reviewPool = cardsToConsider.filter(sc => !sc.isCompletelyNew);
    
    // Combine pools: NEW pool first (sorted), then REVIEW pool (sorted)
    // This gives deterministic ordering: all new cards first, then all review cards
    const combinedPool = [...newPool, ...reviewPool];
    
    // Sort combined pool by urgency score (highest = most urgent)
    combinedPool.sort((a, b) => {
        // Guard against NaN or undefined scores
        const scoreA = Number.isFinite(a.urgencyScore) ? a.urgencyScore : 0;
        const scoreB = Number.isFinite(b.urgencyScore) ? b.urgencyScore : 0;
        
        // PRIORITY 1: Never-shown cards get highest priority within their pool
        if (a.neverShown && !b.neverShown) return -1;
        if (!a.neverShown && b.neverShown) return 1;
        
        // PRIORITY 2: Urgency score (descending - higher = more urgent)
        const scoreDiff = scoreB - scoreA;
        if (Math.abs(scoreDiff) > 0.001) {
            return scoreDiff;
        }
        
        // PRIORITY 3: Tie-breaker - use consistent hash to avoid bias
        const hashA = (a.word.id || '').charCodeAt(0) + a.front.charCodeAt(0);
        const hashB = (b.word.id || '').charCodeAt(0) + b.front.charCodeAt(0);
        if (hashA !== hashB) return hashA - hashB;
        
        // Final: consistent ordering for truly equal items (no randomness for deterministic list)
        return 0;
    });
    
    return combinedPool;
}

/**
 * Test card selection algorithm by simulating N card picks
 * Returns distribution of selected cards to verify no cards are stuck
 * 
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @param {number} iterations - Number of iterations to run
 * @returns {Object} - Distribution report
 */
export function testSelectionDistribution(wordlist, fsrsSubcards, iterations = 100) {
    if (!wordlist || wordlist.length === 0) {
        return { error: 'No wordlist' };
    }
    
    const distribution = {}; // supercardKey -> count
    const poolDistribution = { NEW: 0, REVIEW: 0 };
    let lastWordId = '';
    
    // Temporarily store state values
    const origConsecutiveDue = state.consecutiveDueCards;
    const origConsecutiveNew = state.consecutiveNewCards;
    
    for (let i = 0; i < iterations; i++) {
        const result = getNextSupercard(wordlist, fsrsSubcards, lastWordId);
        if (result) {
            const key = getSupercardKey(result.word.id, result.front);
            distribution[key] = (distribution[key] || 0) + 1;
            lastWordId = result.word.id;
        }
    }
    
    // Restore state
    state.consecutiveDueCards = origConsecutiveDue;
    state.consecutiveNewCards = origConsecutiveNew;
    
    // Calculate statistics
    const totalSupercards = wordlist.length * FRONT_TYPES.length;
    const selectedSupercards = Object.keys(distribution).length;
    const neverSelected = totalSupercards - selectedSupercards;
    
    // Find most and least selected
    const sortedByCount = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const mostSelected = sortedByCount.slice(0, 5);
    const leastSelected = sortedByCount.slice(-5).reverse();
    
    return {
        iterations,
        totalSupercards,
        selectedAtLeastOnce: selectedSupercards,
        neverSelected,
        coveragePercent: ((selectedSupercards / totalSupercards) * 100).toFixed(1) + '%',
        mostSelected: mostSelected.map(([key, count]) => ({ key, count, percent: ((count / iterations) * 100).toFixed(1) + '%' })),
        leastSelected: leastSelected.map(([key, count]) => ({ key, count, percent: ((count / iterations) * 100).toFixed(1) + '%' })),
        warning: neverSelected > 0 ? `⚠️ ${neverSelected} supercards were never selected in ${iterations} iterations` : null
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

/**
 * Diagnostic function to analyze the current state of all cards
 * Useful for verifying the system is working correctly
 * 
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @returns {Object} - Diagnostic report
 */
export function getDiagnosticReport(wordlist, fsrsSubcards) {
    if (!wordlist || wordlist.length === 0) {
        return { error: 'No wordlist' };
    }
    
    const now = new Date();
    const msSinceLastReview = getTimeSinceLastReview(fsrsSubcards);
    
    const report = {
        timestamp: now.toISOString(),
        timeSinceLastReview: msSinceLastReview === Infinity ? 'never' : `${(msSinceLastReview / MS_PER_DAY).toFixed(2)} days`,
        totalWords: wordlist.length,
        totalSupercards: wordlist.length * FRONT_TYPES.length,
        pools: {
            completelyNew: 0,
            reviewDue: 0,
            reviewOverdue: 0,
            reviewNotYetDue: 0
        },
        limbo: {
            potentialLimboCards: 0,  // Cards not shown in LIMBO_BOOST_THRESHOLD_DAYS+
            neverShownCards: 0,      // Cards that have never been shown
            limboThresholdDays: LIMBO_BOOST_THRESHOLD_DAYS,
            maxLimboBoost: MAX_LIMBO_BOOST,
            neverShownSentinelDays: NEVER_SHOWN_DAYS
        },
        urgencyDistribution: {
            highUrgency: 0,   // score > 50
            mediumUrgency: 0, // score 0-50
            lowUrgency: 0,    // score -1 to 0
            notDue: 0         // score < -1
        },
        antiLimboCounters: {
            consecutiveDueCards: state.consecutiveDueCards || 0,
            consecutiveNewCards: state.consecutiveNewCards || 0,
            maxConsecutiveDue: MAX_CONSECUTIVE_SAME_POOL,
            maxConsecutiveNew: MAX_CONSECUTIVE_NEW_CARDS
        },
        sampleOverdueCards: [],
        sampleNotYetDueCards: [],
        sampleLimboCards: []
    };
    
    for (const word of wordlist) {
        const wordId = word.id;
        if (!wordId) continue;
        
        for (const front of FRONT_TYPES) {
            const backModes = getBackModesForFront(front);
            let allSubcardsNew = true;
            let bestReviewScore = -Infinity;
            let hasOverdue = false;
            let hasDue = false;
            
            for (const backMode of backModes) {
                const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
                if (!subcard) continue;
                
                const scoreResult = getRelativeOverdueScore(subcard, now);
                
                if (!scoreResult.isNew) {
                    allSubcardsNew = false;
                    if (scoreResult.score > bestReviewScore) {
                        bestReviewScore = scoreResult.score;
                    }
                    if (scoreResult.score > 0) hasOverdue = true;
                    if (scoreResult.score >= -0.5) hasDue = true;
                }
            }
            
            // Check for limbo status
            const daysSinceShown = getDaysSinceLastShown(wordId, front);
            if (daysSinceShown >= NEVER_SHOWN_DAYS) {
                report.limbo.neverShownCards++;
            } else if (daysSinceShown >= LIMBO_BOOST_THRESHOLD_DAYS) {
                report.limbo.potentialLimboCards++;
                if (report.sampleLimboCards.length < 5) {
                    report.sampleLimboCards.push({
                        word: word.word,
                        front,
                        daysSinceShown: daysSinceShown.toFixed(1),
                        isNew: allSubcardsNew
                    });
                }
            }
            
            if (allSubcardsNew) {
                report.pools.completelyNew++;
            } else if (hasOverdue) {
                report.pools.reviewOverdue++;
                if (report.sampleOverdueCards.length < 5) {
                    report.sampleOverdueCards.push({
                        word: word.word,
                        front,
                        score: bestReviewScore.toFixed(2),
                        daysSinceShown: daysSinceShown >= NEVER_SHOWN_DAYS ? 'never' : `${daysSinceShown.toFixed(1)} days`
                    });
                }
            } else if (hasDue) {
                report.pools.reviewDue++;
            } else {
                report.pools.reviewNotYetDue++;
                if (report.sampleNotYetDueCards.length < 3) {
                    report.sampleNotYetDueCards.push({
                        word: word.word,
                        front,
                        score: bestReviewScore.toFixed(2),
                        dueIn: `${Math.abs(bestReviewScore).toFixed(1)} days`
                    });
                }
            }
            
            // Urgency distribution
            if (bestReviewScore > 50) {
                report.urgencyDistribution.highUrgency++;
            } else if (bestReviewScore >= 0) {
                report.urgencyDistribution.mediumUrgency++;
            } else if (bestReviewScore >= -1) {
                report.urgencyDistribution.lowUrgency++;
            } else {
                report.urgencyDistribution.notDue++;
            }
        }
    }
    
    // Calculate adaptive ratio for current state
    report.currentNewCardRatio = `${(getAdaptiveNewCardRatio(
        msSinceLastReview, 
        report.pools.reviewOverdue, 
        report.pools.reviewOverdue + report.pools.reviewDue
    ) * 100).toFixed(1)}%`;
    
    return report;
}

/**
 * Verify system invariants - returns any issues found
 * Call this periodically to ensure no cards are stuck in limbo
 * 
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @returns {Array} - List of issues found (empty if none)
 */
export function verifySystemHealth(wordlist, fsrsSubcards) {
    const issues = [];
    const warnings = [];
    const now = new Date();
    
    if (!wordlist || wordlist.length === 0) {
        return ['No wordlist loaded'];
    }
    
    // Check for orphaned subcards (subcards without corresponding words)
    const validWordIds = new Set(wordlist.map(w => w.id).filter(Boolean));
    for (const key of Object.keys(fsrsSubcards || {})) {
        const [wordId] = key.split('_');
        if (!validWordIds.has(wordId)) {
            issues.push(`Orphaned subcard: ${key} (word ID ${wordId} not in wordlist)`);
        }
    }
    
    // Check for cards with invalid dates
    for (const [key, card] of Object.entries(fsrsSubcards || {})) {
        if (card.due) {
            const dueDate = new Date(card.due);
            if (isNaN(dueDate.getTime())) {
                issues.push(`Invalid due date for ${key}: ${card.due}`);
            }
        }
        if (card.last_review) {
            const reviewDate = new Date(card.last_review);
            if (isNaN(reviewDate.getTime())) {
                issues.push(`Invalid last_review date for ${key}: ${card.last_review}`);
            }
            // Check if last_review is in the future (shouldn't happen)
            if (reviewDate > now) {
                issues.push(`Future last_review date for ${key}: ${card.last_review}`);
            }
        }
    }
    
    // Check for cards that might be stuck (very overdue but never showing up)
    // This is a soft check - just for awareness
    const veryOverdueThreshold = 30 * MS_PER_DAY; // 30 days
    for (const [key, card] of Object.entries(fsrsSubcards || {})) {
        if (card.due && card.last_review) {
            const dueDate = new Date(card.due);
            const overdueMs = now - dueDate;
            if (overdueMs > veryOverdueThreshold) {
                warnings.push(`Very overdue card (${Math.floor(overdueMs / MS_PER_DAY)} days): ${key}`);
            }
        }
    }
    
    // Check for supercards that have never been shown
    let neverShownCount = 0;
    for (const word of wordlist) {
        if (!word.id) continue;
        for (const front of FRONT_TYPES) {
            const daysSinceShown = getDaysSinceLastShown(word.id, front);
            if (daysSinceShown >= NEVER_SHOWN_DAYS) {
                neverShownCount++;
            }
        }
    }
    if (neverShownCount > 0) {
        // This is informational, not an error - new cards haven't been shown yet
        warnings.push(`Info: ${neverShownCount} supercards have never been shown`);
    }
    
    // Check for potential infinite loops in state
    if (state.consecutiveDueCards > MAX_CONSECUTIVE_SAME_POOL * 2) {
        issues.push(`Anti-limbo counter too high: consecutiveDueCards = ${state.consecutiveDueCards}`);
    }
    if (state.consecutiveNewCards > MAX_CONSECUTIVE_NEW_CARDS * 2) {
        issues.push(`Anti-limbo counter too high: consecutiveNewCards = ${state.consecutiveNewCards}`);
    }
    
    // Return issues first, then warnings
    return [...issues, ...warnings.map(w => `Warning: ${w}`)];
}
