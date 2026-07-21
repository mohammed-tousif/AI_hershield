'use strict';
/**
 * Server-side HTML stripping for any free-text field that gets stored and
 * later displayed (community posts, broadcast messages, incident
 * descriptions, verification-rejection reasons, live-tracker trip details,
 * etc).
 *
 * Why this exists even though render points already escape (e.g. `esc()` in
 * community.html / admin-dashboard.html): client-side escaping at display
 * time is a single, fragile line of defense — the moment any future render
 * point forgets to call it, stored content becomes live markup. Stripping
 * tags at write time means the stored value can never carry executable
 * markup in the first place, regardless of how it's rendered later.
 */
const sanitizeHtml = require('sanitize-html');

/** Strips ALL HTML tags/attributes, keeping plain text only. Non-strings pass through unchanged. */
function stripHtml(input) {
    if (typeof input !== 'string') return input;
    return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
}

/** Applies stripHtml to a whitelist of string fields on an object, in place-safe (returns a new object). */
function stripFields(obj, fields) {
    const out = { ...obj };
    for (const f of fields) {
        if (typeof out[f] === 'string') out[f] = stripHtml(out[f]);
    }
    return out;
}

module.exports = { stripHtml, stripFields };
