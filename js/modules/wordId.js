/**
 * WordID Generation Module
 * 
 * Generates deterministic unique identifiers for words based on canonicalized
 * Hanzi + Toned Pinyin using xxHash32.
 * 
 * WordID = xxHash32("[CanonicalizedHanzi]|[CanonicalizedTonedPinyin]|")
 */

// ============================================================================
// xxHash32 Pure JavaScript Implementation
// Based on the xxHash specification: https://github.com/Cyan4973/xxHash
// ============================================================================

const PRIME32_1 = 0x9E3779B1;
const PRIME32_2 = 0x85EBCA77;
const PRIME32_3 = 0xC2B2AE3D;
const PRIME32_4 = 0x27D4EB2F;
const PRIME32_5 = 0x165667B1;

/**
 * Rotate left (circular shift) for 32-bit integers
 */
function rotl32(x, r) {
    return ((x << r) | (x >>> (32 - r))) >>> 0;
}

/**
 * Convert string to UTF-8 byte array
 */
function stringToUtf8Bytes(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
}

/**
 * Read a 32-bit little-endian integer from byte array
 */
function readU32LE(bytes, offset) {
    return (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
    ) >>> 0;
}

/**
 * xxHash32 implementation
 * @param {string} input - The string to hash
 * @param {number} seed - Optional seed value (default: 0)
 * @returns {string} - Hex string of the 32-bit hash
 */
function xxHash32(input, seed = 0) {
    const bytes = stringToUtf8Bytes(input);
    const len = bytes.length;
    let h32;
    let offset = 0;

    if (len >= 16) {
        // Process blocks of 16 bytes
        let v1 = (seed + PRIME32_1 + PRIME32_2) >>> 0;
        let v2 = (seed + PRIME32_2) >>> 0;
        let v3 = seed >>> 0;
        let v4 = (seed - PRIME32_1) >>> 0;

        const limit = len - 16;
        while (offset <= limit) {
            v1 = Math.imul(rotl32((v1 + Math.imul(readU32LE(bytes, offset), PRIME32_2)) >>> 0, 13), PRIME32_1) >>> 0;
            offset += 4;
            v2 = Math.imul(rotl32((v2 + Math.imul(readU32LE(bytes, offset), PRIME32_2)) >>> 0, 13), PRIME32_1) >>> 0;
            offset += 4;
            v3 = Math.imul(rotl32((v3 + Math.imul(readU32LE(bytes, offset), PRIME32_2)) >>> 0, 13), PRIME32_1) >>> 0;
            offset += 4;
            v4 = Math.imul(rotl32((v4 + Math.imul(readU32LE(bytes, offset), PRIME32_2)) >>> 0, 13), PRIME32_1) >>> 0;
            offset += 4;
        }

        h32 = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0;
    } else {
        h32 = (seed + PRIME32_5) >>> 0;
    }

    h32 = (h32 + len) >>> 0;

    // Process remaining 4-byte chunks
    while (offset <= len - 4) {
        h32 = (h32 + Math.imul(readU32LE(bytes, offset), PRIME32_3)) >>> 0;
        h32 = Math.imul(rotl32(h32, 17), PRIME32_4) >>> 0;
        offset += 4;
    }

    // Process remaining bytes
    while (offset < len) {
        h32 = (h32 + Math.imul(bytes[offset], PRIME32_5)) >>> 0;
        h32 = Math.imul(rotl32(h32, 11), PRIME32_1) >>> 0;
        offset++;
    }

    // Final avalanche
    h32 ^= h32 >>> 15;
    h32 = Math.imul(h32, PRIME32_2) >>> 0;
    h32 ^= h32 >>> 13;
    h32 = Math.imul(h32, PRIME32_3) >>> 0;
    h32 ^= h32 >>> 16;

    // Return as hex string (8 characters, zero-padded)
    return h32.toString(16).padStart(8, '0');
}

// ============================================================================
// Canonicalization Functions
// ============================================================================

/**
 * Unicode punctuation regex pattern
 * Matches CJK punctuation, general punctuation, and common marks
 */
const PUNCTUATION_REGEX = /[\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E\u00A0-\u00BF\u2010-\u2027\u2030-\u205E]/g;

/**
 * Whitespace regex pattern (including non-breaking, full-width, and all unicode whitespace)
 */
const WHITESPACE_REGEX = /[\s\u00A0\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/g;

/**
 * Canonicalize Hanzi for ID generation
 * - Unicode normalize (NFKC)
 * - Trim and remove ALL whitespace (including non-breaking/full-width)
 * - Remove punctuation
 * 
 * @param {string} hanzi - The Hanzi string to canonicalize
 * @returns {string} - Canonicalized Hanzi
 */
export function canonicalizeHanzi(hanzi) {
    if (!hanzi || typeof hanzi !== 'string') return '';
    
    return hanzi
        .normalize('NFKC')           // Unicode normalize
        .replace(WHITESPACE_REGEX, '') // Remove all whitespace
        .replace(PUNCTUATION_REGEX, ''); // Remove punctuation
}

/**
 * Canonicalize Pinyin for ID generation
 * - Lowercase only (preserves tone marks)
 * 
 * @param {string} pinyin - The toned pinyin string to canonicalize
 * @returns {string} - Canonicalized pinyin (lowercase)
 */
export function canonicalizePinyin(pinyin) {
    if (!pinyin || typeof pinyin !== 'string') return '';
    
    return pinyin.toLowerCase();
}

// ============================================================================
// WordID Generation
// ============================================================================

/**
 * Generate a unique WordID from Hanzi and Toned Pinyin
 * 
 * Format: xxHash32("[CanonicalizedHanzi]|[CanonicalizedTonedPinyin]|")
 * 
 * @param {string} hanzi - The Hanzi word
 * @param {string} tonedPinyin - The toned pinyin
 * @returns {string} - 8-character hex hash
 */
export function generateWordId(hanzi, tonedPinyin) {
    const canonicalHanzi = canonicalizeHanzi(hanzi);
    const canonicalPinyin = canonicalizePinyin(tonedPinyin);
    
    // Create the canonical string for hashing
    const hashInput = `${canonicalHanzi}|${canonicalPinyin}|`;
    
    return xxHash32(hashInput);
}

/**
 * Generate an asset filename from a WordID
 * This replaces the old sanitizeWordName function for asset matching
 * 
 * @param {string} wordId - The word's unique ID
 * @param {string} extension - File extension (without dot)
 * @returns {string} - Filename for asset lookup
 */
export function getAssetFilename(wordId, extension) {
    return `${wordId}.${extension}`;
}

// Export xxHash32 for potential other uses
export { xxHash32 };
