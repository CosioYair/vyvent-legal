/* RESOLVING A STORED INVITATION — the draft and published routes.
 *
 * Extracted from `main.js` so the whole decision can be executed under
 * `node --test` with a stub RPC: which endpoint a route may contact, with which
 * parameters, and what every failure resolves to. Those are the properties that
 * matter most on this page, and asserting them against the shipped file is
 * worth more than asserting them against a description of it.
 *
 * DOM-FREE and side-effect free. It fetches, it decides, it returns a verdict;
 * drawing is `main.js`'s job.
 *
 * ── THE CALL TABLE ──────────────────────────────────────────────────────────
 * A closed map from route mode to the ONE request that mode may make. It is
 * data, not branching, so "what can the published route contact" is a line you
 * read rather than a path you trace — and `callRpc` in backend.js independently
 * refuses anything outside its own allowlist, so both layers would have to be
 * wrong at once.
 *
 *   draft      get_invitation_draft     { p_invitation_id, p_token }
 *   published  get_published_invitation { p_slug }
 *
 * The published request carries NO token. It cannot: publishing is what makes an
 * invitation resolvable, and a token in a link meant to be forwarded to two
 * hundred guests would be a secret that is not one.
 *
 * ── ONE FAILURE, ONE ANSWER ─────────────────────────────────────────────────
 * Unknown slug, malformed slug, a draft, an unpublished invitation, a deleted
 * one, a moderated event, a template this build does not have, a configuration
 * that will not normalize, a network error: `unavailable`, every time. A guest
 * cannot learn from this page whether a private invitation exists.
 *
 * The single exception is the ORGANIZER's own draft that is merely unfinished —
 * `incomplete` — which is not an error and is only ever reachable by someone
 * holding the unforgeable preview token for that specific invitation.
 */
import { MODE } from './route.js';

/** Verdicts. `ok` carries a template and a normalized config; the rest do not. */
export const RESULT = {
    OK: 'ok',
    UNAVAILABLE: 'unavailable',
    INCOMPLETE: 'incomplete',
};

/** The closed call table. Returns null for a mode that reaches no backend. */
export function storedRequest(route) {
    if (!route) return null;

    if (route.mode === MODE.DRAFT) {
        // BOTH parts are required. A draft link without a token is answered
        // without a request, because there is nothing a request could add.
        if (!route.invitationId || !route.previewToken) return null;
        return {
            rpc: 'get_invitation_draft',
            params: { p_invitation_id: route.invitationId, p_token: route.previewToken },
        };
    }

    if (route.mode === MODE.PUBLISHED) {
        if (!route.slug) return null;
        return { rpc: 'get_published_invitation', params: { p_slug: route.slug } };
    }

    return null;
}

/**
 * Fetch and validate a stored invitation.
 *
 * @param {object} route     from `parseRoute`
 * @param {object} deps      { callRpc, resolveTemplate, normalizeConfig }
 * @returns {Promise<{result: string, template?: object, config?: object,
 *                    invitation?: object}>}
 */
export async function resolveStored(route, deps) {
    const request = storedRequest(route);
    if (!request) return { result: RESULT.UNAVAILABLE };

    const payload = await deps.callRpc(request.rpc, request.params);
    if (!payload || payload.not_found || !payload.invitation) {
        return { result: RESULT.UNAVAILABLE };
    }

    const invitation = payload.invitation;

    // FAIL CLOSED on a template this build does not have. There is no "closest
    // match" and no default design: rendering somebody's wedding with a
    // template they did not choose is worse than not rendering it.
    const template = deps.resolveTemplate(
        String(invitation.templateKey) + '_v' + String(invitation.templateVersion),
    );
    if (!template) return { result: RESULT.UNAVAILABLE };

    const normalized = deps.normalizeConfig(invitation.config);
    if (!normalized || !normalized.ok) {
        // A DRAFT that will not normalize is simply unfinished, and the person
        // looking at it is its author. A PUBLISHED one that will not normalize
        // should have been stopped by the publish gate — so it is treated as
        // any other unavailable invitation rather than explained to a guest.
        return {
            result: route.mode === MODE.DRAFT ? RESULT.INCOMPLETE : RESULT.UNAVAILABLE,
        };
    }

    return {
        result: RESULT.OK,
        template,
        config: normalized.config,
        // Identity only — never the organizer id, the event id or the raw row.
        invitation: {
            categoryKey: invitation.categoryKey,
            templateKey: invitation.templateKey,
            templateVersion: invitation.templateVersion,
        },
    };
}
