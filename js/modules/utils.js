export const $ = (q, el = document) => el.querySelector(q);
export const $$ = (q, el = document) => [...el.querySelectorAll(q)];

export function on(sel, type, handler, opts) {
    const el = $(sel);
    if (!el) return false;
    el.addEventListener(type, handler, opts);
    return true;
}

// Asset utilities
export function sanitizeWordName(word) {
    // Remove whitespace and sanitize for filename
    return word.replace(/\s+/g, '').replace(/[^\w\u4e00-\u9fff]/g, '');
}

export function getAssetUrl(word, extension, assetCache) {
    if (!assetCache || !word) return null;
    const sanitized = sanitizeWordName(word);
    const filename = `${sanitized}.${extension}`;
    return assetCache[filename] || assetCache[filename.toLowerCase()] || null;
}

export function hasAsset(word, extension, assetCache) {
    return getAssetUrl(word, extension, assetCache) !== null;
}
