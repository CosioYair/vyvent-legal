/**
 * THE CUSTOM (Personalizada) CATEGORY — "Tu diseño".
 *
 *   node --test scripts/__tests__/
 *
 * The first bring-your-own-design invitation: ONE uploaded image is the whole
 * invitation. This suite pins the category's frozen contract against the exact
 * files GitHub Pages serves:
 *
 *   CU-A  registry identity and category
 *   CU-B  normalization: its own shape, never the wedding's
 *   CU-C  the rendered page: passes FIRST, design SECOND, nothing else
 *   CU-D  the full image renders — no crop is possible by construction
 *   CU-E  fail-closed behavior for drafts and hostile documents
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createDocument, serialize, sectionsOf } from './dom-stub.mjs';

import { resolveTemplate, CATEGORIES, matchesConfig } from '../../invitation/js/registry.js';
import { normalizeConfig, CUSTOM_CATEGORY_KEY } from '../../invitation/js/config.js';
import { renderInvitation } from '../../invitation/js/renderer.js';
import { parseRoute } from '../../invitation/js/route.js';
import { resolveStored, RESULT } from '../../invitation/js/resolve.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CUSTOM_ID = 'custom_design_v1';

const STORAGE_URL = (bucket, path) =>
    'https://project.supabase.co/storage/v1/object/public/' + bucket + '/' + path;

/** A well-formed stored custom document. */
function customRaw(over = {}) {
    return {
        contractVersion: 1,
        categoryKey: 'custom',
        templateKey: 'custom_design',
        templateVersion: 1,
        sections: {
            design: {
                image: { source: 'storage', bucket: 'invitation-media', path: 'evt-1/design.jpg' },
                imageAlt: 'Invitación de la fiesta',
                width: 1080,
                height: 1920,
                ...(over.design || {}),
            },
            ...(over.sections || {}),
        },
        ...over.top,
    };
}

function renderCustom(raw, routeQuery) {
    const { ok, config, errors } = normalizeConfig(raw);
    assert.equal(ok, true, 'custom document did not normalize: ' + (errors || []).join(', '));
    const template = resolveTemplate(CUSTOM_ID);
    const document = createDocument();
    const result = renderInvitation({
        template,
        config,
        route: parseRoute(routeQuery || '?i=abcd1234abcd1234'),
        document,
        assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
        templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
        storageUrl: STORAGE_URL,
        now: Date.parse('2026-08-13T12:00:00Z'),
        pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/?i=abcd1234abcd1234',
    });
    return { ...result, config, document };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('CU-A · registry identity', () => {
    test('custom_design_v1 resolves with a consistent identity under Personalizada', () => {
        const t = resolveTemplate(CUSTOM_ID);
        assert.ok(t, 'custom_design_v1 did not resolve');
        assert.equal(t.categoryKey, 'custom');
        assert.equal(t.templateKey, 'custom_design');
        assert.equal(t.templateVersion, 1);
        assert.equal(t.contractVersion, 1);
        assert.equal(t.label, 'Tu diseño');
        assert.equal(t.themeClass, 'tpl-custom-design');
        assert.equal(t.stylesheet, 'custom-design/template.css');
        assert.equal(CATEGORIES.custom.label, 'Personalizada');
        assert.equal(CUSTOM_CATEGORY_KEY, 'custom');
    });

    test('PASSES FIRST, DESIGN SECOND is structural — the descriptor lists nothing else', () => {
        assert.deepEqual(resolveTemplate(CUSTOM_ID).sections, ['passes', 'design']);
    });

    test('near-miss identities fail closed', () => {
        for (const bad of ['custom_design_v2', 'custom_design', 'custom_v1',
            'personalizada_v1', 'custom-design_v1']) {
            assert.equal(resolveTemplate(bad), null, 'accepted ' + bad);
        }
    });

    test('a custom config never matches a wedding template, nor the reverse', () => {
        const { config } = renderCustom(customRaw());
        assert.equal(matchesConfig(resolveTemplate('wedding_romantic_v1'), config), false);
        assert.equal(matchesConfig(resolveTemplate(CUSTOM_ID), config), true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CU-B · normalization is the category’s own', () => {
    test('a valid document normalizes to design-only sections', () => {
        const { ok, config } = normalizeConfig(customRaw());
        assert.equal(ok, true);
        assert.deepEqual(Object.keys(config.sections), ['design']);
        assert.equal(config.sections.design.image.path, 'evt-1/design.jpg');
        assert.equal(config.sections.design.width, 1080);
        assert.equal(config.sections.design.height, 1920);
        assert.equal(config.sections.design.alt, 'Invitación de la fiesta');
        assert.deepEqual(config.interludeImages, {});
        assert.deepEqual(config.actions, { calendar: false, share: false, map: false });
    });

    test('wedding sections inside a custom document are DROPPED, never rendered', () => {
        const raw = customRaw({
            sections: {
                hero: { partnerA: 'Ana', partnerB: 'Luis', date: '2027-04-17T18:00:00-06:00' },
                message: { body: 'Los esperamos.' },
                ceremony: { startsAt: '2027-04-17T18:00:00-06:00', venueName: 'Jardín' },
                gifts: { enabled: true, intro: 'Regalos' },
            },
        });
        const { ok, config } = normalizeConfig(raw);
        assert.equal(ok, true);
        assert.deepEqual(Object.keys(config.sections), ['design']);
    });

    test('a missing, template, or demo image refuses with section:design', () => {
        for (const image of [
            undefined,
            null,
            { source: 'template', assetKey: 'hero-default' },
            { source: 'demo', path: 'wedding-romantic/hero.svg' },
            { source: 'storage', bucket: 'avatars', path: 'x/y.jpg' },
            'evt-1/design.jpg',
        ]) {
            const { ok, errors } = normalizeConfig(customRaw({ design: { image } }));
            assert.equal(ok, false, JSON.stringify(image) + ' was accepted');
            assert.deepEqual(errors, ['section:design']);
        }
    });

    test('a framing window never survives — the FULL image is the contract', () => {
        const { ok, config } = normalizeConfig(customRaw({
            design: {
                image: {
                    source: 'storage', bucket: 'invitation-media', path: 'evt-1/design.jpg',
                    framing: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
                },
            },
        }));
        assert.equal(ok, true);
        assert.equal(config.sections.design.image.framing, undefined);
    });

    test('unusable dimensions are dropped as a pair, and the image still renders', () => {
        for (const dims of [
            { width: 0, height: 1920 },
            { width: 1080, height: -5 },
            { width: 1.5, height: 1920 },
            { width: 99999, height: 1920 },
            { width: '1080', height: '1920' },
            { width: 1080, height: undefined },
        ]) {
            const { ok, config } = normalizeConfig(customRaw({ design: dims }));
            assert.equal(ok, true);
            assert.equal(config.sections.design.width, undefined);
            assert.equal(config.sections.design.height, undefined);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CU-C · the rendered page: passes first, design second, nothing else', () => {
    test('with a validated code, the pass card is the FIRST content', () => {
        const out = renderCustom(customRaw(), '?i=abcd1234abcd1234&code=AAAA2222BBBB');
        assert.equal(out.ok, true);
        assert.deepEqual(sectionsOf(out.node), ['passes', 'design']);
        const html = serialize(out.node);
        assert.ok(html.indexOf('inv-passes') < html.indexOf('inv-design__img'),
            'the design rendered before the pass card');
    });

    test('without a code, no empty pass frame renders — the design is first', () => {
        const out = renderCustom(customRaw(), '?i=abcd1234abcd1234');
        assert.equal(out.ok, true);
        assert.deepEqual(sectionsOf(out.node), ['design']);
        assert.equal(serialize(out.node).includes('inv-passes'), false);
    });

    test('no wedding section can ever appear on a custom page', () => {
        const out = renderCustom(customRaw({
            sections: {
                hero: { partnerA: 'Ana', partnerB: 'Luis', date: '2027-04-17T18:00:00-06:00' },
                message: { body: 'Los esperamos.' },
                ceremony: { startsAt: '2027-04-17T18:00:00-06:00', venueName: 'Jardín' },
            },
        }), '?i=abcd1234abcd1234&code=AAAA2222BBBB');
        const html = serialize(out.node);
        for (const marker of ['inv-hero', 'inv-message', 'inv-ceremony', 'inv-countdown',
            'inv-gallery', 'inv-gifts', 'inv-dress', 'inv-closing', 'inv-interlude',
            'inv-actions']) {
            assert.equal(html.includes(marker), false, marker + ' leaked onto a custom page');
        }
    });

    test('the design section carries no heading — the image speaks for itself', () => {
        const out = renderCustom(customRaw());
        const section = out.node.querySelector('.inv-section--design');
        assert.ok(section);
        assert.equal(serialize(section).includes('inv-heading'), false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CU-C2 · the DRAFT preview shows the pass EXAMPLE — and only there', () => {
    const DRAFT_ROUTE = '?d=11111111-2222-4333-8444-555555555555&t=tok_tok_tok_tok_16';

    test('a custom draft renders the example card first, then the design', () => {
        const out = renderCustom(customRaw(), DRAFT_ROUTE);
        assert.equal(out.ok, true);
        assert.deepEqual(sectionsOf(out.node), ['passes', 'design']);
        const card = out.node.querySelector('.inv-passes');
        assert.ok((card.getAttribute('class') || '').includes('is-example'),
            'the draft card must be marked as an example');
        const html = serialize(card);
        assert.ok(html.includes('XXXX-XXXX-XXXX'), 'placeholder code missing');
        assert.ok(html.includes('no se reclama ningún pase'));
        assert.ok(html.includes('sin código'),
            'the example must say what happens without a code');
    });

    test('the example is non-interactive: no button, no link, no handoff', () => {
        const out = renderCustom(customRaw(), DRAFT_ROUTE);
        const card = out.node.querySelector('.inv-passes');
        assert.equal(card.querySelectorAll('button').length, 0);
        assert.equal(card.querySelectorAll('a').length, 0);
        const html = serialize(card);
        assert.equal(html.includes('Copiar código'), false);
        assert.equal(html.includes('Abrir Orbiventt'), false);
    });

    test('a draft link carrying a code STILL renders the example, never the real card', () => {
        const out = renderCustom(customRaw(), DRAFT_ROUTE + '&code=AAAA2222BBBB');
        const card = out.node.querySelector('.inv-passes');
        assert.ok((card.getAttribute('class') || '').includes('is-example'));
        const html = serialize(card);
        assert.equal(html.includes('AAAA2222BBBB'), false, 'a real code leaked into the example');
        assert.equal(html.includes('Copiar código'), false);
    });

    test('the PUBLISHED page is untouched: no example without a code, the real card with one', () => {
        const noCode = renderCustom(customRaw(), '?i=abcd1234abcd1234');
        assert.deepEqual(sectionsOf(noCode.node), ['design']);
        assert.equal(serialize(noCode.node).includes('is-example'), false);

        const withCode = renderCustom(customRaw(), '?i=abcd1234abcd1234&code=AAAA2222BBBB');
        const card = withCode.node.querySelector('.inv-passes');
        assert.ok(card);
        assert.equal((card.getAttribute('class') || '').includes('is-example'), false);
        assert.ok(serialize(card).includes('Copiar código'));
    });

    test('a WEDDING draft still renders no pass section at all', () => {
        const template = resolveTemplate('wedding_romantic_v1');
        // A minimal valid wedding document, drawn on the draft route.
        const { ok, config } = normalizeConfig({
            contractVersion: 1,
            categoryKey: 'wedding',
            templateKey: 'wedding_romantic',
            templateVersion: 1,
            sections: {
                hero: { partnerA: 'Ana', partnerB: 'Luis', date: '2027-04-17T18:00:00-06:00' },
                message: { body: 'Los esperamos.' },
                ceremony: { startsAt: '2027-04-17T18:00:00-06:00', venueName: 'Jardín' },
            },
        });
        assert.equal(ok, true);
        const out = renderInvitation({
            template,
            config,
            route: parseRoute(DRAFT_ROUTE + '&code=AAAA2222BBBB'),
            document: createDocument(),
            assetBase: 'https://x/assets/',
            templateBase: 'https://x/templates/',
            storageUrl: STORAGE_URL,
            now: Date.parse('2026-08-14T12:00:00Z'),
            pageUrl: 'x',
        });
        assert.equal(out.ok, true);
        assert.equal(serialize(out.node).includes('inv-passes'), false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CU-D · the full image renders — cropping is impossible by construction', () => {
    test('the design is a plain flowing <img> with intrinsic dimensions', () => {
        const out = renderCustom(customRaw());
        const img = out.node.querySelector('.inv-design__img');
        assert.ok(img, 'design image missing');
        assert.equal(img.tagName.toLowerCase(), 'img');
        assert.equal(img.getAttribute('src'),
            STORAGE_URL('invitation-media', 'evt-1/design.jpg'));
        assert.equal(img.getAttribute('width'), '1080');
        assert.equal(img.getAttribute('height'), '1920');
        assert.equal(img.getAttribute('alt'), 'Invitación de la fiesta');
        // No inline geometry: the stylesheet's width:100%/height:auto flow is
        // the whole layout, so there is nothing here that could crop.
        assert.equal(img.getAttribute('style'), null);
    });

    test('a document without stored dimensions still renders the image, unsized', () => {
        const { ok, config } = normalizeConfig(customRaw({ design: { width: undefined, height: undefined } }));
        assert.equal(ok, true);
        const out = renderCustom(customRaw({ design: { width: undefined, height: undefined } }));
        const img = out.node.querySelector('.inv-design__img');
        assert.ok(img);
        assert.equal(img.getAttribute('width'), null);
        assert.equal(img.getAttribute('height'), null);
        assert.ok(config.sections.design.image.path);
    });

    test('the stylesheet forbids the crop primitives on the design', () => {
        // Comments stripped: prose explaining WHY a property is forbidden must
        // not satisfy — or trip — an assertion about executable declarations.
        const css = readFileSync(join(ROOT, 'invitation', 'templates', 'custom-design', 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal(css.includes('object-fit'), false, 'object-fit found in the custom template');
        assert.match(css, /\.inv-design__img[\s\S]*?height:\s*auto/,
            'the design img must flow at its own aspect ratio');
        assert.match(css, /\.inv-design__img[\s\S]*?width:\s*100%/);
        // No fixed height may ever bound the design's box. (The lookahead sits
        // directly after the colon so `\s*` cannot backtrack around it.)
        assert.ok(!/\.inv-design__img[^{]*\{[^}]*[^-]height:(?!\s*auto)/.test(css),
            'a non-auto height appeared on the design img');
        // Buttons keep the shared shell's identity everywhere.
        assert.equal(css.includes('.inv-btn'), false);
    });

    test('the visual contract: full-bleed on phones, a phone-width stage on desktop', () => {
        const css = readFileSync(join(ROOT, 'invitation', 'templates', 'custom-design', 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        // Base (phone) rules: the design section drops the horizontal gutter
        // entirely — a portrait design renders edge to edge, no side fill.
        assert.match(css, /\.inv-section--design\s*\{[^}]*padding:\s*[0-9.]+rem 0 /,
            'the phone layout must have zero horizontal padding');
        // Desktop: the stage is phone-shaped, never the full 46rem column.
        assert.match(css, /@media \(min-width: 48rem\)/);
        assert.match(css, /max-width:\s*27rem/,
            'the desktop stage must be phone-width');
    });

    test('the pass card gets the same scoped treatment the wedding designs give it', () => {
        // Every wedding template styles `.tpl-X .inv-passes …` (surface, code
        // pill, is-demo dashed variant). The custom template follows the SAME
        // convention on its neutral palette — a bare, unstyled claim card was
        // exactly the "improvised" look this pass removes.
        const css = readFileSync(join(ROOT, 'invitation', 'templates', 'custom-design', 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        assert.match(css, /\.tpl-custom-design \.inv-passes \.inv-section__inner/);
        assert.match(css, /\.tpl-custom-design \.inv-passes__code-value/);
        // The draft example reads as a mockup: dashed, like is-demo elsewhere.
        assert.match(css, /\.tpl-custom-design \.inv-passes\.is-example[\s\S]*?border-style:\s*dashed/);
        // Everything stays scoped: no bare `.inv-passes` selector that could
        // leak into another template's page.
        for (const line of css.split('\n')) {
            if (line.includes('.inv-passes') && line.includes('{')) {
                assert.ok(line.includes('.tpl-custom-design'),
                    'unscoped pass-card selector: ' + line.trim());
            }
        }
    });

    test('alt text is accessibility, never visibility', () => {
        const out = renderCustom(customRaw({ design: { imageAlt: undefined } }));
        const img = out.node.querySelector('.inv-design__img');
        assert.ok(img, 'image must render without alt text');
        assert.equal(img.getAttribute('alt'), '');
        assert.equal(img.getAttribute('aria-hidden'), 'true');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CU-E · fail-closed behavior', () => {
    function storedDeps(payload) {
        return {
            callRpc: async () => payload,
            resolveTemplate,
            normalizeConfig,
        };
    }

    function payloadFor(raw) {
        return {
            payload_version: 1,
            mode: 'published',
            invitation: {
                id: '11111111-2222-4333-8444-555555555555',
                eventId: '99999999-8888-4777-8666-555555555555',
                categoryKey: raw.categoryKey,
                templateKey: raw.templateKey,
                templateVersion: raw.templateVersion,
                contractVersion: 1,
                slug: 'abcd1234abcd1234',
                config: raw,
            },
        };
    }

    test('a published custom payload resolves and renders end to end', async () => {
        const route = parseRoute('?i=abcd1234abcd1234');
        const resolved = await resolveStored(route, storedDeps(payloadFor(customRaw())));
        assert.equal(resolved.result, RESULT.OK);
        assert.equal(resolved.template.id, CUSTOM_ID);
        assert.equal(resolved.invitation.categoryKey, 'custom');
    });

    test('a DRAFT without its image reads as incomplete; PUBLISHED as unavailable', async () => {
        const broken = customRaw({ design: { image: undefined } });

        const draftRoute = parseRoute('?d=11111111-2222-4333-8444-555555555555&t=tok_tok_tok_tok_16');
        const draft = await resolveStored(draftRoute, storedDeps({
            ...payloadFor(broken), mode: 'draft',
        }));
        assert.equal(draft.result, RESULT.INCOMPLETE);

        const pubRoute = parseRoute('?i=abcd1234abcd1234');
        const published = await resolveStored(pubRoute, storedDeps(payloadFor(broken)));
        assert.equal(published.result, RESULT.UNAVAILABLE);
    });

    test('a custom payload naming a wedding template fails closed as a mismatch', () => {
        const raw = customRaw();
        const template = resolveTemplate('wedding_romantic_v1');
        const { ok, config } = normalizeConfig(raw);
        assert.equal(ok, true);
        const out = renderInvitation({
            template,
            config,
            route: parseRoute('?i=abcd1234abcd1234'),
            document: createDocument(),
            assetBase: 'https://x/assets/',
            templateBase: 'https://x/templates/',
            storageUrl: STORAGE_URL,
            now: 0,
            pageUrl: 'x',
        });
        assert.equal(out.ok, false);
        assert.equal(out.reason, 'template-mismatch');
    });
});
