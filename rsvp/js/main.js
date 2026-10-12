/* CONFIRMAR ASISTENCIA — wiring only. Every decision lives beside this file:
 *
 *   session.js  where the code comes from, where it lives, when it dies
 *   backend.js  the two RPCs, closed allowlist, PostgREST 400 → message
 *   ui.js       the model → the page
 *
 * PRODUCT INVARIANT (locked): there is NO new invitation type. This page
 * answers an EXISTING Smart Invitation ("Enlace de invitación") by its
 * existing code. The code is the only authority the server accepts; this page
 * never sends an event id or an invitation id, never logs, never persists
 * anything beyond the code in sessionStorage, and never writes the code into
 * `document.title`, a meta tag or any outgoing URL other than the app deep
 * link resolved by app-return.js.
 */
import { captureCode, rememberCode, clearCode, normalizeCode } from './session.js?v=20261011a';
import { resolveInvitation, respond, backendConfig, storageUrlResolver } from './backend.js?v=20261011a';
import { renderApp, COPY } from './ui.js?v=20261011a';
import { clear } from './dom.js?v=20261011a';

var ENV = (typeof window !== 'undefined' && window.__ORB_ENV__) || {};
var RETURN = (typeof window !== 'undefined' && window.__ORB_APP_RETURN__) || null;
var LINKS = (typeof window !== 'undefined' && window.__ORB_APP_LINKS__) || null;

var backend = backendConfig();
var storageUrl = backend ? storageUrlResolver(backend.url) : null;

var model = {
    phase: 'loading',
    code: null,
    payload: null,
    view: 'idle',
    editing: null,
    result: null,
    entryError: null,
    retryable: false,
};

function byId(id) { return document.getElementById(id); }

/** The store listing for THIS device — the muted promotion link's target. */
function storeUrl() {
    if (!LINKS || typeof LINKS.storeUrlFor !== 'function') return null;
    var platform = LINKS.detectPlatform(navigator.userAgent || '', 'ontouchend' in document);
    return LINKS.storeUrlFor(platform);
}

/**
 * The app handoff for the event this code answers — resolved EXCLUSIVELY by
 * app-return.js, exactly as the invitation's pass card does. Production gets
 * `vyvent://e/{id}?code=…`; the DEV mirror has no Expo Go return address on
 * this page and therefore gets `{open:false}` — the copy-the-code path.
 */
function handoff() {
    if (!RETURN || typeof RETURN.resolveAppHandoff !== 'function') return null;
    if (!model.payload || !model.payload.event || !model.payload.event.id) return null;
    return RETURN.resolveAppHandoff({
        env: ENV.env,
        appReturn: null,
        kind: 'e',
        id: String(model.payload.event.id),
        isChat: false,
        code: model.code,
    });
}

function smartOpen(h) {
    if (!LINKS || typeof LINKS.smartOpen !== 'function') return null;
    return LINKS.smartOpen(h, { window: window, document: document, navigator: navigator });
}

function render(scrollTo) {
    var root = byId('rsvp-root');
    var h = handoff();
    clear(root);
    root.appendChild(renderApp(model, handlers, {
        document: document,
        storageUrl: storageUrl,
        storeUrl: storeUrl(),
        handoff: h,
        smartOpen: smartOpen(h),
        navigator: navigator,
    }));
    var loading = byId('rsvp-loading');
    if (loading) loading.setAttribute('hidden', '');
    root.removeAttribute('hidden');

    if (scrollTo) {
        var target = root.querySelector(scrollTo);
        if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }
}

function revealDevBadge() {
    if (!ENV.devBadge) return;
    var badge = byId('envBadge');
    if (badge) badge.removeAttribute('hidden');
}

/** Resolve a code. `fromEntry` keeps failures on the entry form, inline. */
async function load(code, fromEntry) {
    model.phase = 'loading';
    render();

    var res = await resolveInvitation(code);
    var status = res && typeof res.status === 'string' ? res.status : null;

    if (status === 'ok') {
        model.code = code;
        model.payload = res;
        model.phase = 'ready';
        model.view = 'idle';
        model.editing = null;
        rememberCode(window, code);
        render();
        return;
    }

    if (fromEntry) {
        model.phase = 'enter-code';
        model.entryError = status === 'not_found' ? COPY.codeNotFound
            : status === 'rate_limited' ? COPY.rateLimited
                : COPY.codeOffline;
        render();
        return;
    }

    // Link arrival: ONE neutral answer. Only not_found is terminal — it kills
    // the stored code so a dead link cannot be reopened from this tab.
    if (status === 'not_found') clearCode(window);
    model.code = status === 'not_found' ? null : code;
    model.phase = 'unavailable';
    model.retryable = status !== 'not_found';
    render();
}

var handlers = {
    onCode: function (raw) {
        var code = normalizeCode(raw);
        if (!code) {
            model.phase = 'enter-code';
            model.entryError = COPY.codeShape;
            render();
            return;
        }
        model.entryError = null;
        void load(code, true);
    },

    onChoose: function (view, party) {
        model.view = view;
        model.editing = party || null;
        model.result = null;
        render('.rsvp-answer');
    },

    onCancel: function () {
        model.view = 'idle';
        model.editing = null;
        render('.rsvp-answer');
    },

    onRetry: function () {
        if (model.code) void load(model.code, false);
    },

    /** @returns {Promise<{ok: boolean, message?: string}>} the form shows `message`. */
    onSubmit: async function (answer) {
        var res = await respond(model.code, answer);
        if (!res) return { ok: false, message: COPY.offline };
        if (res.status === 'error') return { ok: false, message: res.message };
        if (res.status === 'rate_limited') return { ok: false, message: COPY.rateLimited };
        if (res.status === 'not_found') {
            clearCode(window);
            model.code = null;
            model.phase = 'unavailable';
            model.retryable = false;
            render();
            return { ok: true };
        }

        // Re-resolve so the "Tu respuesta actual" cards and the seat numbers
        // are the server's, never a local guess.
        var fresh = await resolveInvitation(model.code);
        if (fresh && fresh.status === 'ok') model.payload = fresh;

        model.result = { status: answer.status, name: answer.name, seats: answer.seats };
        model.view = 'idle';
        model.editing = null;
        render('.rsvp-answer');
        return { ok: true };
    },
};

async function start() {
    revealDevBadge();

    var code = captureCode(window);
    if (!code) {
        model.phase = 'enter-code';
        render();
        return;
    }
    await load(code, false);
}

start().catch(function () {
    model.phase = 'unavailable';
    model.retryable = !!model.code;
    render();
});
