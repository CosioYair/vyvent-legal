/* HISTORY SEARCH PLUMBING — the pure parts, extracted so they are testable
 * without a DOM or a network.
 *
 * A search box at a door is a hostile input source: an operator types fast on
 * a phone with a queue in front of them, and every keystroke must NOT become a
 * database call. Three small tools keep that true:
 *
 *   debounce      one trailing call per typing burst (~300 ms)
 *   staleGuard    a late response from an OLD query can never overwrite the
 *                 results of a newer one
 *   normalizeQuery collapse whitespace and refuse 1-character searches, which
 *                 would match half the history and help nobody
 */

/** Trailing-edge debounce. `cancel()` drops any pending call. */
export function debounce(fn, ms, timers) {
    var t = timers || { set: setTimeout, clear: clearTimeout };
    var pending = null;
    var wrapped = function () {
        var args = arguments;
        if (pending !== null) t.clear(pending);
        pending = t.set(function () {
            pending = null;
            fn.apply(null, args);
        }, ms);
    };
    wrapped.cancel = function () {
        if (pending !== null) t.clear(pending);
        pending = null;
    };
    return wrapped;
}

/**
 * Monotonic sequence: `begin()` mints a ticket, `isCurrent(ticket)` says
 * whether a response that just arrived still speaks for the latest query.
 */
export function createStaleGuard() {
    var seq = 0;
    return {
        begin: function () { seq += 1; return seq; },
        isCurrent: function (ticket) { return ticket === seq; },
    };
}

/**
 * Normalize an operator's query.
 *
 * @returns {?string} '' for "show recent", the cleaned query, or null for
 *   "do not search yet" (a single character).
 */
export function normalizeQuery(raw) {
    if (typeof raw !== 'string') return '';
    var q = raw.replace(/\s+/g, ' ').trim();
    if (q === '') return '';
    if (q.length < 2) return null;
    return q;
}
