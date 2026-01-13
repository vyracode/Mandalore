export const $ = (q, el = document) => el.querySelector(q);
export const $$ = (q, el = document) => [...el.querySelectorAll(q)];

export function on(sel, type, handler, opts) {
    const el = $(sel);
    if (!el) return false;
    el.addEventListener(type, handler, opts);
    return true;
}

/**
 * Convert simple markdown to HTML
 * Supports: **bold**, *italic*, and line breaks
 */
export function renderMarkdown(text) {
    if (!text) return '';
    
    // Escape HTML to prevent XSS
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Convert **bold** to <strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Convert *italic* to <em>
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Convert line breaks
    html = html.replace(/\n/g, '<br>');
    
    return html;
}
