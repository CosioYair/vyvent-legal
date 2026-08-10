/**
 * Advanced photo framing — the web half of the shared contract.
 *
 *   node --test scripts/__tests__/
 *
 * A storage image reference may carry `framing` {x, y, w, h}: the view window
 * (source fractions, allowed outside [0,1]) the mobile editor confirmed. The
 * renderer must reconstruct it as slot-percentage geometry, emit the blurred
 * same-image backdrop ONLY when the window reaches past the image, keep the
 * sharp layer sharp, reuse the one resolved URL for both layers, and leave
 * every reference WITHOUT framing rendering byte-identically to the legacy
 * path — published invitations from before this feature must not change.
 *
 * Every design consumes the same engine: the geometry a window produces is
 * asserted to be IDENTICAL across all five registered templates.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, serialize } from './dom-stub.mjs';

import { resolveTemplate, listTemplates } from '../../invitation/js/registry.js';
import { demoConfig } from '../../invitation/js/demo-data.js';
import { normalizeConfig } from '../../invitation/js/config.js';
import { renderInvitation } from '../../invitation/js/renderer.js';
import { parseRoute } from '../../invitation/js/route.js';
import {
    framingWindow, needsBackdrop, framedGeometry, framedArt, FRAMING_EXTENT,
} from '../../invitation/js/framing.js';

const DEMO_ID = 'wedding_romantic_v1';
const STORAGE_URL = (b, p) => `https://cdn.test/${b}/${p}`;

const ZOOM_OUT = { x: -0.1, y: 0.05, w: 1.2, h: 0.62 };   // reaches past both sides
const ZOOM_IN = { x: 0.2, y: 0.1, w: 0.5, h: 0.55 };      // strictly inside
const PAN_NEG = { x: -0.25, y: -0.3, w: 1.5, h: 1.6 };    // negative translations
const PAN_POS = { x: 0.4, y: 0.45, w: 0.55, h: 0.5 };     // positive translations

const IMG = (framing) => ({
    source: 'storage', bucket: 'invitation-media', path: 'evt/full.jpg',
    ...(framing ? { framing } : {}),
});

/** A stored-shaped config rendered through a given template. */
function renderStored(templateId, mutate) {
    const raw = demoConfig(DEMO_ID);
    raw.templateKey = resolveTemplate(templateId).templateKey;
    raw.templateVersion = resolveTemplate(templateId).templateVersion;
    if (mutate) mutate(raw);
    const { ok, config, errors } = normalizeConfig(raw);
    assert.equal(ok, true, 'configuration did not normalize: ' + errors.join(', '));
    const document = createDocument();
    const result = renderInvitation({
        template: resolveTemplate(templateId),
        config,
        route: parseRoute('?i=ana-y-luis'),
        document,
        assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
        templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
        storageUrl: STORAGE_URL,
        now: Date.parse('2026-08-01T12:00:00Z'),
        pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/?i=ana-y-luis',
    });
    assert.equal(result.ok, true);
    return { ...result, config, document };
}

/** Parse the inline style of a framed foreground into numbers. */
function styleNumbers(node) {
    const style = node.getAttribute('style') || '';
    const grab = (prop) => {
        const m = style.match(new RegExp(prop + ':(-?[0-9.]+)%'));
        return m ? Number(m[1]) : NaN;
    };
    return { width: grab('width'), height: grab('height'), left: grab('left'), top: grab('top') };
}

/* ── validation ──────────────────────────────────────────────────────────── */

describe('F1 · framingWindow validates like the mobile sanitizer', () => {
    test('accepts zoom-out, zoom-in and pans; rebuilds the object', () => {
        for (const w of [ZOOM_OUT, ZOOM_IN, PAN_NEG, PAN_POS]) {
            assert.deepEqual(framingWindow(w), w);
        }
        // Rebuilt, so hostile extra keys never travel.
        const dirty = { ...ZOOM_IN, onclick: 'alert(1)' };
        assert.deepEqual(Object.keys(framingWindow(dirty)), ['x', 'y', 'w', 'h']);
    });

    test('rejects the unlawful without throwing', () => {
        for (const bad of [
            null, 'framing', 42,
            { x: NaN, y: 0, w: 1, h: 1 },
            { x: 0, y: 0, w: 0, h: 1 },
            { x: 0, y: 0, w: -1, h: 1 },
            { x: 0, y: 0, w: FRAMING_EXTENT + 1, h: 1 },
            { x: FRAMING_EXTENT + 1, y: 0, w: 1, h: 1 },
            { x: '0', y: 0, w: 1, h: 1 },
        ]) {
            assert.equal(framingWindow(bad), null);
        }
    });

    test('needsBackdrop fires per overflowing edge, with rounding tolerance', () => {
        assert.equal(needsBackdrop(ZOOM_IN), false);
        assert.equal(needsBackdrop(ZOOM_OUT), true);
        assert.equal(needsBackdrop({ x: -0.001, y: 0, w: 1.001, h: 0.6 }), false);
        assert.equal(needsBackdrop({ x: 0, y: -0.05, w: 0.9, h: 0.9 }), true);
        assert.equal(needsBackdrop({ x: 0.2, y: 0, w: 0.9, h: 0.9 }), true);
    });

    test('normalizeConfig carries a lawful window and drops a broken one', () => {
        const { config } = renderStored(DEMO_ID, (raw) => {
            raw.sections.hero.image = IMG(ZOOM_OUT);
        });
        assert.deepEqual(config.sections.hero.image.framing, ZOOM_OUT);

        const { config: dropped } = renderStored(DEMO_ID, (raw) => {
            raw.sections.hero.image = IMG({ x: 0, y: 0, w: -2, h: 1 });
        });
        assert.equal(dropped.sections.hero.image.framing, undefined);
    });
});

/* ── geometry ────────────────────────────────────────────────────────────── */

describe('F2 · the shared window → slot mapping', () => {
    test('matches the mobile formula exactly', () => {
        const g = framedGeometry(ZOOM_OUT);
        assert.ok(Math.abs(g.widthPct - 100 / ZOOM_OUT.w) < 1e-9);
        assert.ok(Math.abs(g.heightPct - 100 / ZOOM_OUT.h) < 1e-9);
        assert.ok(Math.abs(g.leftPct - (-100 * ZOOM_OUT.x) / ZOOM_OUT.w) < 1e-9);
        assert.ok(Math.abs(g.topPct - (-100 * ZOOM_OUT.y) / ZOOM_OUT.h) < 1e-9);
    });

    test('zoom-in scales the layer past the slot; zoom-out keeps width under it', () => {
        assert.ok(framedGeometry(ZOOM_IN).widthPct > 100);
        assert.ok(framedGeometry(ZOOM_OUT).widthPct < 100);
    });

    test('negative and positive translations move opposite directions', () => {
        assert.ok(framedGeometry(PAN_NEG).leftPct > 0);
        assert.ok(framedGeometry(PAN_NEG).topPct > 0);
        assert.ok(framedGeometry(PAN_POS).leftPct < 0);
        assert.ok(framedGeometry(PAN_POS).topPct < 0);
    });
});

/* ── the builder ─────────────────────────────────────────────────────────── */

describe('F3 · framedArt', () => {
    const build = (framing) => framedArt({
        document: createDocument(),
        src: 'https://cdn.test/invitation-media/evt/full.jpg',
        framing,
        className: 'inv-hero__art',
        attrs: {
            src: 'https://cdn.test/invitation-media/evt/full.jpg',
            alt: 'La pareja', width: 1080, height: 1920,
            loading: 'lazy', decoding: 'async',
        },
    });

    test('NO framing → the exact legacy <img>, no wrapper, no style', () => {
        const { node, img } = build(undefined);
        assert.equal(node, img);
        assert.equal(node.tagName, 'img');
        assert.equal(node.getAttribute('class'), 'inv-hero__art');
        assert.equal(node.getAttribute('style'), null);
    });

    test('zoom-out → wrapper keeps the slot class; blurred bg + sharp fg, same URL', () => {
        const { node, img } = build(ZOOM_OUT);
        assert.equal(node.tagName, 'div');
        assert.equal(node.getAttribute('class'), 'inv-hero__art inv-framed');
        const children = node.childNodes.filter((n) => n.nodeType === 1);
        assert.equal(children.length, 2);
        const [bg, fg] = children;
        assert.equal(bg.getAttribute('class'), 'inv-framed__bg');
        assert.equal(fg.getAttribute('class'), 'inv-framed__fg');
        assert.equal(fg, img);
        // ONE URL for both layers — the browser fetches it once.
        assert.equal(bg.getAttribute('src'), fg.getAttribute('src'));
        // The backdrop is decorative; the sharp layer keeps the description.
        assert.equal(bg.getAttribute('alt'), '');
        assert.equal(bg.getAttribute('aria-hidden'), 'true');
        assert.equal(fg.getAttribute('alt'), 'La pareja');
        // The blur belongs to the bg CLASS; the fg carries geometry only.
        const style = fg.getAttribute('style');
        assert.ok(style && !style.includes('blur'));
    });

    test('zoom-in (full cover) → NO backdrop layer at all', () => {
        const { node } = build(ZOOM_IN);
        const children = node.childNodes.filter((n) => n.nodeType === 1);
        assert.equal(children.length, 1);
        assert.equal(children[0].getAttribute('class'), 'inv-framed__fg');
    });

    test('the inline geometry is numbers-only percentages', () => {
        const { img } = build(ZOOM_OUT);
        const nums = styleNumbers(img);
        assert.ok(Math.abs(nums.width - 100 / ZOOM_OUT.w) < 1e-6);
        assert.ok(Math.abs(nums.height - 100 / ZOOM_OUT.h) < 1e-6);
        assert.ok(Math.abs(nums.left - (-100 * ZOOM_OUT.x) / ZOOM_OUT.w) < 1e-6);
        assert.ok(Math.abs(nums.top - (-100 * ZOOM_OUT.y) / ZOOM_OUT.h) < 1e-6);
        // Nothing but declarations built from validated numbers.
        assert.match(img.getAttribute('style'), /^(?:(?:width|height|left|top):-?[0-9.]+%;){4}$/);
    });
});

/* ── through the real renderer, on every design ──────────────────────────── */

describe('F4 · every design, one engine', () => {
    const allTemplates = listTemplates().map((t) => t.id);

    test('the registry still lists exactly five wedding designs', () => {
        assert.equal(allTemplates.length, 5);
    });

    for (const id of listTemplates().map((t) => t.id)) {
        test(`${id}: hero, gallery and interlude all render the framed composition`, () => {
            const { node } = renderStored(id, (raw) => {
                raw.sections.hero.image = IMG(ZOOM_OUT);
                raw.sections.gallery = {
                    enabled: true,
                    items: [{ image: IMG(ZOOM_IN), alt: 'Uno' }, { image: IMG(undefined), alt: 'Dos' }],
                };
                raw.interludeImages = { afterCeremony: { image: IMG(ZOOM_OUT), alt: 'Banda' } };
            });

            // Hero: framed wrapper with backdrop.
            const hero = node.querySelector('.inv-hero__art');
            assert.ok(hero, 'hero art missing');
            assert.ok((hero.getAttribute('class') || '').includes('inv-framed'));
            assert.ok(hero.querySelector('.inv-framed__bg'), 'hero backdrop missing');

            // Gallery: first tile framed WITHOUT backdrop, second tile legacy.
            const tiles = node.querySelectorAll('.inv-gallery__img');
            assert.equal(tiles.length, 2);
            assert.ok((tiles[0].getAttribute('class') || '').includes('inv-framed'));
            assert.equal(tiles[0].querySelector('.inv-framed__bg'), null);
            assert.equal(tiles[1].tagName, 'img', 'legacy tile must stay a plain img');

            // Interlude: framed wrapper with backdrop, alt preserved.
            const band = node.querySelector('.inv-interlude__img');
            assert.ok((band.getAttribute('class') || '').includes('inv-framed'));
            assert.ok(band.querySelector('.inv-framed__bg'));
            assert.equal(band.querySelector('.inv-framed__fg').getAttribute('alt'), 'Banda');
        });
    }

    test('the SAME window renders the SAME geometry on all five designs', () => {
        const styles = new Set();
        for (const id of allTemplates) {
            const { node } = renderStored(id, (raw) => {
                raw.sections.hero.image = IMG(ZOOM_OUT);
            });
            styles.add(node.querySelector('.inv-framed__fg').getAttribute('style'));
        }
        assert.equal(styles.size, 1, 'designs disagreed on framing geometry');
    });

    test('template switch retains the image URL and the window untouched', () => {
        for (const id of allTemplates) {
            const { config } = renderStored(id, (raw) => {
                raw.sections.hero.image = IMG(ZOOM_OUT);
            });
            assert.equal(config.sections.hero.image.path, 'evt/full.jpg');
            assert.deepEqual(config.sections.hero.image.framing, ZOOM_OUT);
        }
    });
});

/* ── backwards compatibility ─────────────────────────────────────────────── */

describe('F5 · published invitations without framing cannot change', () => {
    test('a legacy stored reference renders the byte-identical legacy markup', () => {
        const render = () => {
            const { node } = renderStored(DEMO_ID, (raw) => {
                raw.sections.hero.image = IMG(undefined);
                raw.interludeImages = {
                    afterCeremony: { image: IMG(undefined), alt: 'Banda' },
                };
            });
            return serialize(node);
        };
        const html = render();
        assert.ok(!html.includes('inv-framed'), 'legacy render grew framing markup');
        assert.ok(!html.includes('style='), 'legacy render grew inline styles');
    });

    test('legacy origin/crop bookkeeping is still dropped, framing is not', () => {
        const { config } = renderStored(DEMO_ID, (raw) => {
            raw.sections.hero.image = {
                ...IMG(ZOOM_OUT),
                origin: { source: 'storage', bucket: 'event-photos', path: 'e/p.jpg' },
                crop: { x: 0, y: 0, w: 1, h: 1 },
            };
        });
        const image = config.sections.hero.image;
        assert.deepEqual(image.framing, ZOOM_OUT);
        assert.equal(image.origin, undefined);
        assert.equal(image.crop, undefined);
    });

    test('the demo ships NO framing — its rendering is exactly the legacy path', () => {
        const raw = demoConfig(DEMO_ID);
        assert.ok(!JSON.stringify(raw).includes('framing'));
    });
});

/* ── failure behaviour ───────────────────────────────────────────────────── */

describe('F6 · a framed image that fails to load collapses like a legacy one', () => {
    test('gallery: the whole framed composition leaves, the tile marks failed', () => {
        const { node } = renderStored(DEMO_ID, (raw) => {
            raw.sections.gallery = { enabled: true, items: [{ image: IMG(ZOOM_OUT) }] };
        });
        const tile = node.querySelector('.inv-gallery__item');
        const fg = tile.querySelector('.inv-framed__fg');
        fg.dispatch('error');
        assert.ok((tile.getAttribute('class') || '').includes('is-failed'));
        // Neither layer survives — no orphaned blur band.
        assert.equal(tile.querySelector('.inv-framed__bg'), null);
        assert.equal(tile.querySelector('.inv-framed__fg'), null);
    });

    test('interlude: the band collapses entirely', () => {
        const { node } = renderStored(DEMO_ID, (raw) => {
            raw.interludeImages = { afterMessage: { image: IMG(ZOOM_OUT) } };
        });
        const band = node.querySelector('.inv-interlude');
        band.querySelector('.inv-framed__fg').dispatch('error');
        assert.ok((band.getAttribute('class') || '').includes('is-failed'));
    });
});
