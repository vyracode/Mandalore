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
 * Create a seeded random number generator using Linear Congruential Generator
 * @param {number} seed - Initial seed value
 * @returns {Object} - RNG object with random() method (same API as Math.random)
 */
function createSeededRNG(seed) {
    let currentSeed = seed;
    return {
        random() {
            currentSeed = (currentSeed * 1664525 + 1013904223) & 0x7FFFFFFF;
            return (currentSeed >>> 0) / 0x7FFFFFFF;
        },
        getSeed() { return currentSeed; }
    };
}

/**
 * Generate deterministic seed from current state
 * @param {Object} state - Application state object
 * @param {string} lastWordId - Last word ID shown
 * @returns {number} - Integer seed value
 */
function generateDeterministicSeed(state, lastWordId) {
    const hash = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    };
    
    const seedString = [
        state.dailySupercardCount || 0,
        state.consecutiveDueCards || 0,
        state.consecutiveNewCards || 0,
        lastWordId || ''
    ].join('-');
    
    return hash(seedString);
}

/**
 * Get ordered supercard candidates with selection logic
 * Shared function used by both getNextSupercard and getAllSupercardsWithPedigree
 * 
 * @param {Array} wordlist - List of words
 * @param {Object} fsrsSubcards - Map of FSRS subcards
 * @param {string} lastWordId - Last word ID shown
 * @param {Object} options - Options object
 * @param {Function} options.randomFn - Random function (Math.random or seeded RNG)
 * @param {boolean} options.applyVarietyCheck - Whether to apply variety check filtering
 * @param {Object} options.snapshotState - Snapshot of state values (for variety check)
 * @param {boolean} options.selectCard - Whether to actually select a card (false for just ordering)
 * @returns {Object} - { selectedCard, orderedCandidates, poolName }
 */
function getOrderedSupercardCandidates(wordlist, fsrsSubcards, lastWordId, options = {}) {
    const {
        randomFn = Math.random,
        applyVarietyCheck = true,
        snapshotState = {},
        selectCard = true
    } = options;
    
    if (!wordlist || wordlist.length === 0) {
        return { selectedCard: null, orderedCandidates: [], poolName: null };
    }
    
    const now = new Date();
    
    // Calculate time since last practice for adaptive mixing
    const msSinceLastReview = getTimeSinceLastReview(fsrsSubcards);
    
    // Collect all supercards with their scores
    const allSupercards = [];
    let overdueCount = 0;
    let dueNowCount = 0;
    
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
            
            // Analyze all subcards for this supercard
            for (const backMode of backModes) {
                const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
                if (!subcard) continue;
                
                const scoreResult = getRelativeOverdueScore(subcard, now);
                
                if (scoreResult.isNew) {
                    // This subcard has never been reviewed
                } else {
                    allSubcardsNew = false;
                    
                    if (scoreResult.score > bestReviewScore) {
                        bestReviewScore = scoreResult.score;
                    }
                    
                    if (scoreResult.score > 0) {
                        hasOverdueSubcard = true;
                        hasDueSubcard = true;
                    } else if (scoreResult.score >= -0.5) {
                        hasDueSubcard = true;
                    }
                }
            }
            
            // Calculate final urgency score
            let urgencyScore;
            if (allSubcardsNew) {
                urgencyScore = 0;
            } else {
                urgencyScore = bestReviewScore;
            }
            
            // ANTI-LIMBO BOOST
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
                daysSinceShown
            });
            
            // Track counts for adaptive ratio
            if (!isLastWord && !allSubcardsNew) {
                if (hasOverdueSubcard) overdueCount++;
                if (hasDueSubcard) dueNowCount++;
            }
        }
    }
    
    if (allSupercards.length === 0) {
        return { selectedCard: null, orderedCandidates: [], poolName: null };
    }
    
    // Separate cards into pools
    const availableCards = allSupercards.filter(sc => !sc.isLastWord);
    
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
    
    // POOL CLASSIFICATION
    const newPool = cardsToConsider.filter(sc => sc.isCompletelyNew);
    const reviewPool = cardsToConsider.filter(sc => !sc.isCompletelyNew);
    
    // Calculate adaptive mixing ratio
    const newCardRatio = getAdaptiveNewCardRatio(msSinceLastReview, overdueCount, dueNowCount);
    
    // Decide which pool to draw from (use randomFn for deterministic selection)
    let selectedPool;
    let poolName;
    
    const hasNewCards = newPool.length > 0;
    const hasReviewCards = reviewPool.length > 0;
    
    // Use snapshot state for consecutive counters if provided, otherwise use live state
    const consecutiveDueCards = snapshotState.consecutiveDueCards !== undefined ? 
        snapshotState.consecutiveDueCards : (state.consecutiveDueCards || 0);
    const consecutiveNewCards = snapshotState.consecutiveNewCards !== undefined ? 
        snapshotState.consecutiveNewCards : (state.consecutiveNewCards || 0);
    
    if (hasNewCards && hasReviewCards) {
        const showNew = randomFn() < newCardRatio;
        
        if (showNew) {
            if (consecutiveNewCards >= MAX_CONSECUTIVE_NEW_CARDS && hasReviewCards) {
                selectedPool = reviewPool;
                poolName = 'REVIEW (anti-limbo forced)';
            } else {
                selectedPool = newPool;
                poolName = 'NEW';
            }
        } else {
            if (consecutiveDueCards >= MAX_CONSECUTIVE_SAME_POOL && hasNewCards) {
                selectedPool = newPool;
                poolName = 'NEW (anti-limbo forced)';
            } else {
                selectedPool = reviewPool;
                poolName = 'REVIEW';
            }
        }
    } else if (hasNewCards) {
        selectedPool = newPool;
        poolName = 'NEW (only option)';
    } else if (hasReviewCards) {
        selectedPool = reviewPool;
        poolName = 'REVIEW (only option)';
    } else {
        selectedPool = cardsToConsider;
        poolName = 'FALLBACK (all cards)';
    }
    
    // Apply variety check if enabled
    let varietyFilteredPool = selectedPool;
    if (applyVarietyCheck) {
        const VARIETY_INTERVAL = 15;
        const totalCardsShown = snapshotState.dailySupercardCount !== undefined ? 
            snapshotState.dailySupercardCount : (state.dailySupercardCount || 0);
        if (totalCardsShown > 0 && totalCardsShown % VARIETY_INTERVAL === 0) {
            const lessRecentCards = selectedPool.filter(sc => sc.daysSinceShown >= 1);
            if (lessRecentCards.length > 0) {
                varietyFilteredPool = lessRecentCards;
            }
        }
    }
    
    // Sort both pools for ordering
    const sortPool = (pool) => {
        pool.sort((a, b) => {
            const scoreA = Number.isFinite(a.urgencyScore) ? a.urgencyScore : 0;
            const scoreB = Number.isFinite(b.urgencyScore) ? b.urgencyScore : 0;
            
            // PRIORITY 1: Never-shown cards
            if (a.neverShown && !b.neverShown) return -1;
            if (!a.neverShown && b.neverShown) return 1;
            
            // PRIORITY 2: Urgency score
            const scoreDiff = scoreB - scoreA;
            if (Math.abs(scoreDiff) > 0.001) {
                return scoreDiff;
            }
            
            // PRIORITY 3: Hash tie-breaker
            const hashA = (a.word.id || '').charCodeAt(0) + a.front.charCodeAt(0);
            const hashB = (b.word.id || '').charCodeAt(0) + b.front.charCodeAt(0);
            if (hashA !== hashB) return hashA - hashB;
            
            // PRIORITY 4: Random tie-breaker (uses randomFn)
            return randomFn() - 0.5;
        });
    };
    
    // Sort the selected pool (for selection and ordering)
    sortPool(varietyFilteredPool);
    
    // Sort the other pool as well (for complete ordering)
    const otherPool = selectedPool === newPool ? reviewPool : newPool;
    if (otherPool.length > 0) {
        sortPool(otherPool);
    }
    
    // Build ordered candidates list: selected pool first, then other pool
    // This ensures the order matches what would actually be selected
    const orderedCandidates = [...varietyFilteredPool];
    if (otherPool.length > 0 && selectedPool !== otherPool) {
        orderedCandidates.push(...otherPool);
    }
    
    // Select card if requested
    let selectedCard = null;
    if (selectCard && varietyFilteredPool.length > 0) {
        const topCount = Math.min(5, Math.max(2, Math.ceil(varietyFilteredPool.length * 0.3)));
        const topCandidates = varietyFilteredPool.slice(0, topCount);
        
        // Group by word
        const byWord = {};
        topCandidates.forEach(sc => {
            const wid = sc.word.id;
            if (!byWord[wid]) byWord[wid] = [];
            byWord[wid].push(sc);
        });
        
        // Pick random word, then random front
        const wordIds = Object.keys(byWord);
        const randomWordId = wordIds[Math.floor(randomFn() * wordIds.length)];
        const cardsForWord = byWord[randomWordId];
        selectedCard = cardsForWord[Math.floor(randomFn() * cardsForWord.length)];
    }
    
    return {
        selectedCard,
        orderedCandidates,
        poolName
    };
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
    // Initialize consecutive counters if missing
    if (typeof state.consecutiveDueCards !== 'number') {
        state.consecutiveDueCards = 0;
    }
    if (typeof state.consecutiveNewCards !== 'number') {
        state.consecutiveNewCards = 0;
    }
    
    // Get ordered candidates using Math.random (non-deterministic for actual selection)
    const result = getOrderedSupercardCandidates(wordlist, fsrsSubcards, lastWordId, {
        randomFn: Math.random,
        applyVarietyCheck: true,
        snapshotState: {
            dailySupercardCount: state.dailySupercardCount,
            consecutiveDueCards: state.consecutiveDueCards,
            consecutiveNewCards: state.consecutiveNewCards
        },
        selectCard: true
    });
    
    if (!result.selectedCard) {
        return null;
    }
    
    // Update consecutive counters based on which pool was selected
    const selected = result.selectedCard;
    const wasNewPool = result.poolName && result.poolName.startsWith('NEW');
    
    if (wasNewPool) {
        state.consecutiveNewCards++;
        state.consecutiveDueCards = 0;
        
        // Check for anti-limbo forcing
        if (result.poolName === 'REVIEW (anti-limbo forced)') {
            state.consecutiveNewCards = 0;
        }
    } else {
        state.consecutiveDueCards++;
        state.consecutiveNewCards = 0;
        
        // Check for anti-limbo forcing
        if (result.poolName === 'NEW (anti-limbo forced)') {
            state.consecutiveDueCards = 0;
        }
    }
    
    // Reset counters if only one pool available
    if (result.poolName && (result.poolName.includes('only option') || result.poolName === 'FALLBACK')) {
        state.consecutiveDueCards = 0;
        state.consecutiveNewCards = 0;
    }
    
    saveState();
    
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
 * Uses deterministic seeding based on current state to ensure consistent ordering
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
    
    // Generate deterministic seed from current state
    const baseSeed = generateDeterministicSeed(state, lastWordId);
    
    // Create seeded RNG for deterministic ordering
    const seededRNG = createSeededRNG(baseSeed);
    
    // Get ordered candidates using seeded RNG (deterministic)
    const result = getOrderedSupercardCandidates(wordlist, fsrsSubcards, lastWordId, {
        randomFn: seededRNG.random.bind(seededRNG),
        applyVarietyCheck: true,
        snapshotState: {
            dailySupercardCount: state.dailySupercardCount,
            consecutiveDueCards: state.consecutiveDueCards || 0,
            consecutiveNewCards: state.consecutiveNewCards || 0
        },
        selectCard: false // We want the full ordered list, not just one card
    });
    
    const orderedCandidates = result.orderedCandidates || [];
    
    // Add pedigree information to each supercard
    const now = new Date();
    const supercardsWithPedigree = orderedCandidates.map((supercard, index) => {
        const { word, front } = supercard;
        const wordId = word.id;
        const backModes = getBackModesForFront(front);
        
        // Find most urgent back mode for pedigree
        let mostUrgentBackMode = null;
        let bestReviewScore = -Infinity;
        
        for (const backMode of backModes) {
            const subcard = getOrCreateSubcard(wordId, front, backMode, fsrsSubcards);
            if (!subcard) continue;
            
            const scoreResult = getRelativeOverdueScore(subcard, now);
            if (!scoreResult.isNew && scoreResult.score > bestReviewScore) {
                bestReviewScore = scoreResult.score;
                mostUrgentBackMode = backMode;
            }
        }
        
        // Determine pedigree reason
        let pedigree;
        if (supercard.isCompletelyNew) {
            pedigree = { reason: 'New' };
        } else if (supercard.hasOverdueSubcard || supercard.hasDueSubcard) {
            pedigree = { reason: 'Practice', backMode: mostUrgentBackMode };
        } else if (supercard.isInLimbo) {
            pedigree = { reason: 'Limbo' };
        } else if (supercard.daysSinceShown >= 1 && supercard.daysSinceShown < LIMBO_BOOST_THRESHOLD_DAYS) {
            pedigree = { reason: 'Variety' };
        } else {
            pedigree = { reason: 'Practice', backMode: mostUrgentBackMode };
        }
        
        return {
            ...supercard,
            mostUrgentBackMode,
            pedigree
        };
    });
    
    return supercardsWithPedigree;
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
