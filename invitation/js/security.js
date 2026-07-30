/* SECURITY PRIMITIVES for the invitation renderer.
 *
 * Every value the renderer draws originates from an organizer: names, copy,
 * venue text, links, image references. On a published invitation that content
 * is authored in the mobile editor by one person and read by hundreds of
 * guests, so the renderer treats ALL of it as untrusted input and each helper
 * here FAILS CLOSED — the outcome is a safe value or `null`, never a
 * best-effort approximation of what was asked for.
 *
 * The module is deliberately DOM-free and side-effect free: it is the same code
 * in the browser and under `node --test`, so the guarantees below are asserted
 * against the exact file the site serves.
 *
 * Companion rule enforced elsewhere: text reaches the page only through
 * `dom.js`, which assigns `textContent`. There is no `innerHTML` anywhere in
 * this module tree, so there is no escaping to get wrong — a value simply
 * cannot become markup. `escapeHtml()` below exists for the one payload that
 * leaves the DOM (the .ics download) and as an explicit escaping contract.
 */

/** Bounds for the stored configuration. See invitation/README.md. */
export const LIMITS = {
    /* Text. Generous enough for real copy, small enough that a full
     * configuration stays far below the locked 64 KB JSONB ceiling. */
    NAME: 80,
    HEADING: 120,
    LINE: 200,
    ADDRESS: 300,
    PARAGRAPH: 1200,
    /* One dress-code guideline: a single concrete recommendation or
     * restriction, not a paragraph. Bounded on its own so a long entry cannot
     * turn the list into prose the layout was not designed for. */
    GUIDELINE: 160,

    /* Collections. */
    GALLERY_ITEMS: 12,
    GIFT_LINKS: 6,
    DRESS_CODE_GUIDELINES: 4,
};

/** Schemes an organizer-supplied external link may use. HTTPS only. */
const EXTERNAL_SCHEMES = { 'https:': true };

/**
 * Hosts an organizer-supplied MAP link may point at. The renderer builds its
 * own map URL from the address (see `buildMapUrl`), so this allowlist only
 * exists for the case where an organizer pasted a link of their own; anything
 * outside it is dropped and the built URL is used instead.
 */
const MAP_HOSTS = {
    'www.google.com': true,
    'maps.google.com': true,
    'goo.gl': true,
    'maps.app.goo.gl': true,
    'www.openstreetmap.org': true,
    'openstreetmap.org': true,
    'maps.apple.com': true,
};

/** Image extensions the renderer will load. */
const IMAGE_EXT = /\.(?:jpe?g|png|webp|svg)$/i;

/** A bundled demo asset path: a plain relative path under assets/demo/. */
const DEMO_PATH = /^[a-z0-9][a-z0-9._/-]{0,120}$/i;

/** Supabase Storage bucket naming (mirrors 404.html's `publicUrl`). */
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** Smart-invitation codes, normalized to 12 uppercase alphanumerics by the app
 *  (migration 20260610120000). Bound kept loose, shape kept query-safe — the
 *  same rule `app-return.js` applies. */
const CODE = /^[A-Za-z0-9-]{1,20}$/;

/** Characters that must never survive into an attribute, a URL or CSS. */
const DANGEROUS = /[\x00-\x20\x7f"'`<>\\]/;

/** Control characters: no meaning in rendered copy, and the usual vehicle for
 *  smuggling structure into somewhere that reads it as structure. */
const CONTROL = /[\x00-\x1f\x7f]/g;

/** Same, but preserving U+000A so paragraph breaks survive in body copy. */
const CONTROL_KEEP_LF = /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Normalize a single-line text value: reject non-strings, strip control
 * characters, collapse whitespace runs, trim, and clamp to `max`.
 *
 * Returns '' for anything unusable, so a caller can treat empty as "absent"
 * without a second type check. The value is destined for `textContent`, so no
 * HTML meaning attaches to any character that survives.
 */
export function sanitizeText(value, max) {
    if (typeof value !== 'string') return '';
    const limit = Number.isInteger(max) && max > 0 ? max : LIMITS.LINE;
    const cleaned = value
        .replace(CONTROL, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > limit ? cleaned.slice(0, limit).trim() : cleaned;
}

/**
 * Multi-line variant for body copy. Paragraph breaks are meaningful in an
 * invitation message, so blank lines survive; everything else is normalized as
 * above and the result is clamped to `max`.
 */
export function sanitizeParagraph(value, max) {
    if (typeof value !== 'string') return '';
    const limit = Number.isInteger(max) && max > 0 ? max : LIMITS.PARAGRAPH;
    const cleaned = value
        .replace(/\r\n?/g, '\n')
        .replace(CONTROL_KEEP_LF, '')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n').map((line) => line.trim()).join('\n')
        .trim();
    return cleaned.length > limit ? cleaned.slice(0, limit).trim() : cleaned;
}

/**
 * HTML-escape a string. NOT used to build markup — the renderer never calls
 * `innerHTML` — it exists for the one payload that leaves the DOM (the
 * calendar download) and as an explicit, testable statement of the contract.
 */
export function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split('"').join('&quot;')
        .split("'").join('&#39;');
}

/**
 * Validate an organizer-supplied external link.
 *
 * Survives only if: it is a clean string, parses as an absolute URL, uses
 * `https:`, carries no embedded credentials, and names a host. Everything
 * else — `http:`, `javascript:`, `data:`, `blob:`, `mailto:`, a custom app
 * scheme, a protocol-relative reference, a bare path — returns null.
 *
 * The href returned is the parser's normalized form, never the raw input.
 */
export function safeExternalUrl(raw) {
    if (typeof raw !== 'string' || raw === '') return null;
    if (DANGEROUS.test(raw)) return null;

    let url;
    try {
        url = new URL(raw);
    } catch (_) {
        return null;
    }

    if (!EXTERNAL_SCHEMES[String(url.protocol).toLowerCase()]) return null;
    if (url.username || url.password) return null;
    if (!url.host) return null;
    return url.href;
}

/**
 * Validate an organizer-supplied MAP link: `safeExternalUrl` plus a host
 * allowlist, so a "ver mapa" button can only ever leave for a mapping service.
 */
export function safeMapUrl(raw) {
    const href = safeExternalUrl(raw);
    if (!href) return null;
    try {
        const host = new URL(href).hostname.toLowerCase();
        return Object.prototype.hasOwnProperty.call(MAP_HOSTS, host) ? href : null;
    } catch (_) {
        return null;
    }
}

/**
 * Build a map URL the renderer owns end to end.
 *
 * Preferred over accepting a pasted link: the inputs are a venue name and an
 * address, both already sanitized, and the output is assembled from a constant
 * origin plus one percent-encoded query parameter. Organizer text cannot
 * influence the scheme, the host or the path.
 */
export function buildMapUrl(venueName, address) {
    const query = [venueName, address]
        .map((part) => sanitizeText(part, LIMITS.ADDRESS))
        .filter(Boolean)
        .join(', ');
    if (!query) return null;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}

/**
 * Resolve the map target for a place: an explicit, allowlisted organizer link
 * wins; otherwise one is built from the address. Null when neither is possible.
 */
export function resolveMapUrl(place) {
    if (!place || typeof place !== 'object') return null;
    return safeMapUrl(place.mapUrl) || buildMapUrl(place.venueName, place.address);
}

/**
 * A plain relative asset path: no scheme, no leading slash, no protocol-relative
 * prefix, no empty or traversal segment, no character that could break out of an
 * attribute or a CSS `url()`, and a known image extension.
 */
export function safeAssetPath(p) {
    if (typeof p !== 'string' || p === '') return null;
    if (DANGEROUS.test(p)) return null;
    if (p.charAt(0) === '/' || p.indexOf('//') !== -1) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return null;
    if (!DEMO_PATH.test(p)) return null;
    if (p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
    if (!IMAGE_EXT.test(p)) return null;
    return p;
}

/**
 * Resolve an image reference to a URL, or null.
 *
 * The contract carries a TAGGED reference rather than a bare string, so the
 * renderer never has to guess what a value means:
 *
 *   { source: 'demo',    path: 'wedding-romantic/hero.svg' }
 *       A file bundled with the site. Resolved against `assetBase`, which the
 *       caller derives from `import.meta.url` — so it is correct under the DEV
 *       project path (/vyvent-legal/invitation/) and under the production root
 *       (/invitation/) with no environment-specific string anywhere.
 *
 *   { source: 'storage', bucket: 'event-photos', path: '<uid>/<file>.jpg' }
 *       An uploaded image. Milestone A has no upload path and no Supabase
 *       access, so this FAILS CLOSED and returns null; Milestone B supplies the
 *       `storageUrl` resolver. The shape is validated here and now so the
 *       contract is fixed before anything writes it.
 *
 * Anything else — a bare string, an absolute URL, a traversal, a scheme — is
 * rejected. An invitation can therefore never load a third-party image.
 */
export function resolveImage(ref, opts) {
    if (!ref || typeof ref !== 'object') return null;
    const options = opts || {};

    if (ref.source === 'demo') {
        const path = safeAssetPath(ref.path);
        if (!path || !options.assetBase) return null;
        try {
            const base = new URL('demo/', options.assetBase);
            const url = new URL(path, base);
            // Confirm the result never escaped the bundled asset directory.
            return url.href.indexOf(base.href) === 0 ? url.href : null;
        } catch (_) {
            return null;
        }
    }

    if (ref.source === 'storage') {
        if (typeof ref.bucket !== 'string' || !BUCKET.test(ref.bucket)) return null;
        if (!safeAssetPath(ref.path)) return null;
        return typeof options.storageUrl === 'function'
            ? options.storageUrl(ref.bucket, ref.path)
            : null;
    }

    return null;
}

/** A smart-invitation code, or null. */
export function safeCode(raw) {
    return typeof raw === 'string' && CODE.test(raw) ? raw : null;
}

/**
 * An opaque identifier from the query string (invitation id, preview token,
 * published slug). Not resolved to anything in Milestone A — validated here so
 * the reserved routes cannot become a path- or scheme-injection surface the day
 * they are wired up.
 */
export function safeToken(raw, max) {
    if (typeof raw !== 'string' || raw === '') return null;
    const limit = Number.isInteger(max) && max > 0 ? max : 128;
    if (raw.length > limit) return null;
    return /^[A-Za-z0-9._~-]+$/.test(raw) ? raw : null;
}
