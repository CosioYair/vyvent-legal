/* ROUTE CONTRACT for /invitation/.
 *
 * One page serves every way an invitation can be reached. The mode is decided
 * ONLY by the query string, and every recognized parameter is validated before
 * it is handed on — an unparseable or hostile query resolves to a controlled
 * state, never to a partially-trusted one.
 *
 *   ?demo={registryId}                  bundled demonstration data. No database
 *                                       record, no authentication, no preview
 *                                       token, no network at all.
 *
 *   ?d={invitationId}&t={previewToken}  the ORGANIZER's private draft preview.
 *                                       Token-gated; renders any status.
 *
 *   ?i={slug}                           the PUBLISHED invitation. Anonymous,
 *                                       and resolvable only while the
 *                                       invitation is actually published.
 *
 *   ?i={slug}&code={smartInvitationCode} published + a pass-claim code. The code
 *                                       is PARSED and carried, and nothing acts
 *                                       on it — the claim lifecycle is a later
 *                                       milestone. Accepting the shape now is
 *                                       what keeps those links from breaking.
 *
 * The three data modes stay isolated: each reaches exactly one source, and no
 * mode can fall through to another's. Demo data is not even in the module graph
 * of the two stored routes.
 *
 * `demo` is NOT a way to reach stored data. It selects a registry key, and the
 * registry is a closed set of literals — see registry.js.
 */
import { safeCode, safeToken, safeSlug } from './security.js';

export const MODE = {
    DEMO: 'demo',
    DRAFT: 'draft',
    PUBLISHED: 'published',
    NONE: 'none',
};

/** Registry identifiers are `{category}_{template}_v{n}` — a closed shape. */
const REGISTRY_ID = /^[a-z][a-z0-9_]{2,48}_v[0-9]{1,3}$/;

/**
 * Parse a query string into a route.
 *
 * @param {string} search  e.g. `location.search`
 * @returns {{mode: string, demoId: ?string, invitationId: ?string,
 *            previewToken: ?string, slug: ?string, code: ?string}}
 */
export function parseRoute(search) {
    const empty = {
        mode: MODE.NONE,
        demoId: null,
        invitationId: null,
        previewToken: null,
        slug: null,
        code: null,
    };

    let params;
    try {
        params = new URLSearchParams(typeof search === 'string' ? search : '');
    } catch (_) {
        return empty;
    }

    const get = (name) => {
        try {
            const value = params.get(name);
            return typeof value === 'string' ? value : null;
        } catch (_) {
            return null;
        }
    };

    const code = safeCode(get('code'));

    const demo = get('demo');
    if (demo !== null) {
        const demoId = typeof demo === 'string' && REGISTRY_ID.test(demo) ? demo : null;
        // An unrecognized `?demo=` value is still DEMO mode: the renderer must
        // answer "that template does not exist", not fall through to a route
        // the visitor never asked for.
        return { ...empty, mode: MODE.DEMO, demoId, code };
    }

    const invitationId = safeToken(get('d'), 64);
    if (invitationId) {
        return {
            ...empty,
            mode: MODE.DRAFT,
            invitationId,
            previewToken: safeToken(get('t'), 128),
            code,
        };
    }

    // The published slug is validated against the DATABASE's shape rule, not the
    // looser token rule: a value the database could not have stored resolves to
    // NONE, so it never becomes a request. See `safeSlug`.
    const slug = safeSlug(get('i'));
    if (slug) {
        return { ...empty, mode: MODE.PUBLISHED, slug, code };
    }

    return { ...empty, code };
}
