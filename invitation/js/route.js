/* ROUTE CONTRACT for /invitation/.
 *
 * One page serves every way an invitation can be reached. The mode is decided
 * ONLY by the query string, and every recognized parameter is validated before
 * it is handed on — an unparseable or hostile query resolves to a controlled
 * state, never to a partially-trusted one.
 *
 *   ?demo={registryId}                MILESTONE A — bundled demonstration data.
 *                                     No database record, no authentication, no
 *                                     preview token, no network at all.
 *
 *   ?d={invitationId}&t={previewToken}  RESERVED — organizer draft preview.
 *   ?i={slug}                           RESERVED — published invitation.
 *   ?i={slug}&code={smartInvitationCode} RESERVED — published + pass claim.
 *
 * The reserved modes are RECOGNIZED here, deliberately, and resolve to an
 * explicit "not available yet" state. Recognizing them now fixes the contract
 * before anything mints a URL against it, and leaves no ambiguity about which
 * shapes Milestone B has to honor. Nothing simulates their network behavior:
 * there is no mock fetch, no fake payload and no placeholder record.
 *
 * `demo` is NOT a way to reach stored data. It selects a registry key, and the
 * registry is a closed set of literals — see registry.js.
 */
import { safeCode, safeToken } from './security.js';

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

    const slug = safeToken(get('i'), 96);
    if (slug) {
        return { ...empty, mode: MODE.PUBLISHED, slug, code };
    }

    return { ...empty, code };
}
