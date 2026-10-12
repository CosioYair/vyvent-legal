/* THE INVITATION CODE — how it arrives, where it lives, when it dies.
 *
 * PRODUCT INVARIANT (locked). There is NO new invitation type. The code this
 * page captures is the EXISTING Smart Invitation code ("Enlace de
 * invitación"), the same 12 characters the app's claim flow reads. This page
 * is simply another way to answer that invitation — without an account.
 *
 * ── Why the FRAGMENT ─────────────────────────────────────────────────────────
 * `#c=…` is never sent in the HTTP request line, so the code cannot land in a
 * GitHub Pages log, a Cloudflare log or a `Referer` header. The canonical link
 * is therefore `rsvp/#c=XXXX-XXXX-XXXX`.
 *
 * ── Why legacy query forms are ALSO accepted, once ───────────────────────────
 * The invitation link a guest already holds carries the code as `?code=`
 * (`/invitation/?i=slug&code=…`, `/e/{id}?code=…`). A guest who retypes or
 * reshapes one of those onto this page must not be turned away, so `?code=`
 * is read on arrival — and then NORMALIZED: the code goes into sessionStorage
 * and the address bar is rewritten to the bare pathname. After that first
 * paint the code is in neither the query nor the fragment.
 *
 * ── Why sessionStorage ───────────────────────────────────────────────────────
 * Memory alone loses the code on a reload mid-form. `localStorage` would leave
 * it on a shared phone indefinitely. `sessionStorage` survives reload, dies
 * with the tab, and is same-origin only. It is cleared on the one terminal
 * answer — `not_found` — because at that point the link is dead.
 *
 * NEVER logged, never sent to analytics, never placed in a DOM attribute other
 * than the app deep link's own href.
 */

var STORAGE_KEY = 'orb.rsvp.code';

/** The shape the database mints: exactly 12 uppercase alphanumerics. */
var CODE_LENGTH = 12;

/**
 * Normalize whatever a guest or a link supplied — `XXXX-XXXX-XXXX`, lowercase,
 * spaces — to the canonical form, or null when it cannot be a code at all.
 * The SERVER is what decides whether a code is real; this is a cheap shape
 * check so an obviously broken value fails fast without a request.
 */
export function normalizeCode(raw) {
    if (typeof raw !== 'string') return null;
    var compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return compact.length === CODE_LENGTH ? compact : null;
}

/** The code as a guest reads it: XXXX-XXXX-XXXX. Mirrors the app. */
export function displayCode(code) {
    var normalized = normalizeCode(code);
    if (!normalized) return String(code || '');
    return normalized.replace(/(.{4})(?=.)/g, '$1-');
}

function paramFrom(source, name) {
    if (typeof source !== 'string') return null;
    var first = source.charAt(0);
    var raw = first === '#' || first === '?' ? source.slice(1) : source;
    if (!raw) return null;
    try {
        return new URLSearchParams(raw).get(name);
    } catch (_) {
        return null;
    }
}

/** `c=` from the fragment — the canonical transport. */
export function parseFragment(hash) {
    return normalizeCode(paramFrom(hash, 'c'));
}

/** `code=` from the query — the legacy invitation-link transport. */
export function parseLegacyQuery(search) {
    return normalizeCode(paramFrom(search, 'code'));
}

export function rememberCode(win, code) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!w || !normalizeCode(code)) return;
    try {
        w.sessionStorage.setItem(STORAGE_KEY, normalizeCode(code));
    } catch (_) {
        /* Held in memory by the caller regardless. */
    }
}

export function clearCode(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return;
    try {
        w.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {
        /* nothing to do */
    }
}

/** Rewrite the address bar to the bare pathname: no query, no fragment. */
export function stripAddressBar(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!w || !w.history || !w.location) return;
    try {
        w.history.replaceState(null, '', w.location.pathname);
    } catch (_) {
        /* Cosmetic only; the code is already captured. */
    }
}

/**
 * Capture the code for this tab.
 *
 * Order matters: read the URL, persist, THEN strip. Stripping first would lose
 * the code if persistence threw (private mode, quota).
 *
 * @returns {?string} the normalized code, or null when neither the URL nor
 *   this tab's storage holds one — the page then offers manual entry.
 */
export function captureCode(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return null;
    var loc = w.location || {};

    var found = parseFragment(loc.hash) || parseLegacyQuery(loc.search);
    if (found) {
        rememberCode(w, found);
        stripAddressBar(w);
        return found;
    }

    // A reload after the URL was stripped: recover from this tab.
    try {
        return normalizeCode(w.sessionStorage.getItem(STORAGE_KEY));
    } catch (_) {
        return null;
    }
}

export { STORAGE_KEY };
