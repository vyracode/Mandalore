export const $ = (q, el = document) => el.querySelector(q);
export const $$ = (q, el = document) => [...el.querySelectorAll(q)];

export function on(sel, type, handler, opts) {
    const el = $(sel);
    if (!el) return false;
    el.addEventListener(type, handler, opts);
    return true;
}

// Asset utilities

/**
 * @deprecated Use WordID-based asset lookup instead
 * Legacy function for backward compatibility with old asset naming
 */
export function sanitizeWordName(word) {
    // Remove whitespace and sanitize for filename
    return word.replace(/\s+/g, '').replace(/[^\w\u4e00-\u9fff]/g, '');
}

/**
 * Get asset URL using WordID (primary) or legacy Hanzi-based naming (fallback)
 * 
 * @param {string} wordId - The word's unique ID (from generateWordId)
 * @param {string} word - The Hanzi word (for legacy fallback)
 * @param {string} extension - File extension (without dot)
 * @param {Object} assetCache - The asset cache object
 * @returns {string|null} - Data URL of the asset or null if not found
 */
export function getAssetUrl(wordId, word, extension, assetCache) {
    if (!assetCache) return null;
    
    // Primary: Try WordID-based filename
    if (wordId) {
        const idFilename = `${wordId}.${extension}`;
        if (assetCache[idFilename]) return assetCache[idFilename];
        if (assetCache[idFilename.toLowerCase()]) return assetCache[idFilename.toLowerCase()];
    }
    
    // Fallback: Try legacy Hanzi-based filename for backward compatibility
    if (word) {
        const sanitized = sanitizeWordName(word);
        const legacyFilename = `${sanitized}.${extension}`;
        if (assetCache[legacyFilename]) return assetCache[legacyFilename];
        if (assetCache[legacyFilename.toLowerCase()]) return assetCache[legacyFilename.toLowerCase()];
    }
    
    return null;
}

/**
 * Check if an asset exists for a word
 * 
 * @param {string} wordId - The word's unique ID
 * @param {string} word - The Hanzi word (for legacy fallback)
 * @param {string} extension - File extension
 * @param {Object} assetCache - The asset cache object
 * @returns {boolean}
 */
export function hasAsset(wordId, word, extension, assetCache) {
    return getAssetUrl(wordId, word, extension, assetCache) !== null;
}
