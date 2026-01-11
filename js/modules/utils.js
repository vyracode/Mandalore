export const $ = (q, el = document) => el.querySelector(q);
export const $$ = (q, el = document) => [...el.querySelectorAll(q)];

export function on(sel, type, handler, opts) {
    const el = $(sel);
    if (!el) return false;
    el.addEventListener(type, handler, opts);
    return true;
}
