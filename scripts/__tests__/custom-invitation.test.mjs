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

    test('DESIGN FIRST, PASSES SECOND is structural — the descriptor lists nothing else', () => {
        // FROZEN 2026-08-14: the artwork leads the composition; the pass
        // module follows it inside the same shell.
        assert.deepEqual(resolveTemplate(CUSTOM_ID).sections, ['design', 'passes']);
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
    test('with a validated code, the DESIGN leads and the pass module follows', () => {
        const out = renderCustom(customRaw(), '?i=abcd1234abcd1234&code=AAAA2222BBBB');
        assert.equal(out.ok, true);
        assert.deepEqual(sectionsOf(out.node), ['design', 'passes']);
        const html = serialize(out.node);
        assert.ok(html.indexOf('inv-design__img') < html.indexOf('inv-passes'),
            'the pass module rendered before the design');
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
            'inv-actions',
            // The 2026-08-16 page-wide removal, pinned here too: these labels
            // no longer exist for ANY category.
            'Compartir invitación', 'Abrir ubicación']) {
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

    test('a custom draft renders the design first, then the example card', () => {
        const out = renderCustom(customRaw(), DRAFT_ROUTE);
        assert.equal(out.ok, true);
        assert.deepEqual(sectionsOf(out.node), ['design', 'passes']);
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
describe('CU-G · ONE invitation object — the grouping invariant', () => {
    // DOM order alone is not the contract: the design and the pass module
    // must be SIBLINGS inside the SAME template-level shell (the renderer's
    // article), which carries both theme identity and the shell styling. A
    // future change that renders them into separate wrappers must fail here.

    test('with a code: design and passes are direct children of the ONE shell', () => {
        const out = renderCustom(customRaw(), '?i=abcd1234abcd1234&code=AAAA2222BBBB');
        const shell = out.node;
        const cls = shell.getAttribute('class') || '';
        assert.ok(cls.includes('inv-invitation') && cls.includes('tpl-custom-design'),
            'the shell must be the themed inv-invitation article');

        const children = shell.children;
        assert.equal(children.length, 2, 'the shell must contain exactly two sections');
        assert.ok((children[0].getAttribute('class') || '').includes('inv-section--design'));
        assert.ok((children[1].getAttribute('class') || '').includes('inv-passes'));

        const design = shell.querySelector('.inv-section--design');
        const passes = shell.querySelector('.inv-passes');
        assert.equal(design.parentNode, shell, 'design must sit directly in the shell');
        assert.equal(passes.parentNode, shell, 'passes must sit directly in the shell');
        assert.equal(design.parentNode, passes.parentNode, 'ONE parent, one object');
    });

    test('without a code: the shell holds the design alone — no spacer, no residue', () => {
        const out = renderCustom(customRaw(), '?i=abcd1234abcd1234');
        const shell = out.node;
        assert.ok((shell.getAttribute('class') || '').includes('tpl-custom-design'));
        const children = shell.children;
        assert.equal(children.length, 1, 'exactly the design — nothing else in the shell');
        assert.ok((children[0].getAttribute('class') || '').includes('inv-section--design'));
        const html = serialize(shell);
        assert.equal(html.includes('inv-passes'), false);
        assert.equal(html.includes('is-example'), false);
    });

    test('the draft preview groups identically: design then example, one shell', () => {
        const out = renderCustom(customRaw(), '?d=11111111-2222-4333-8444-555555555555&t=tok_tok_tok_tok_16');
        const shell = out.node;
        const children = shell.children;
        assert.equal(children.length, 2);
        assert.ok((children[0].getAttribute('class') || '').includes('inv-section--design'));
        assert.ok((children[1].getAttribute('class') || '').includes('is-example'));
        assert.equal(children[1].parentNode, shell);
    });

    test('a WEDDING page is NOT the custom shell — its article keeps its own theme', () => {
        // The shell styling binds to `.inv-invitation.tpl-custom-design`; a
        // wedding article carries its own theme class, so no wedding page can
        // ever pick up the custom container.
        const template = resolveTemplate('wedding_romantic_v1');
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
            route: parseRoute('?i=abcd1234abcd1234'),
            document: createDocument(),
            assetBase: 'https://x/assets/',
            templateBase: 'https://x/templates/',
            storageUrl: STORAGE_URL,
            now: Date.parse('2026-08-14T12:00:00Z'),
            pageUrl: 'x',
        });
        assert.equal(out.ok, true);
        const cls = out.node.getAttribute('class') || '';
        assert.ok(cls.includes('tpl-wedding-romantic'));
        assert.equal(cls.includes('tpl-custom-design'), false);
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
        // No object-fit exists in this template at all: the sharp invitation
        // FLOWS (width 100%, height from its own ratio — the full-size
        // treatment), and the backdrop covers via background-size, never via
        // a property that could crop a rendered image.
        assert.equal(css.includes('object-fit'), false,
            'object-fit found in the custom template');
        const img = css.match(/\.inv-design__img\s*\{([^}]*)\}/);
        assert.ok(img, 'the design img rule is missing');
        assert.ok(img[1].includes('width: 100%'),
            'the invitation must occupy the card\'s full image width');
        assert.ok(img[1].includes('height: auto'),
            'the invitation\'s height must follow its own aspect ratio — no stage, no letterbox');
        // Button identity may be restyled ONLY inside the pass module (the
        // dark shell makes the base light-surface identity unreadable there,
        // and what replaces it must be the canonical Orbiventt treatment —
        // pinned in the identity test below). Anywhere else, a button rule
        // may tighten layout but never restyle what a button IS.
        for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
            const [, selector, body] = match;
            if (!selector.includes('.inv-btn')) continue;
            const touchesIdentity = ['background', 'color', 'border-radius', 'border:', 'border-color']
                .some((p) => body.includes(p));
            if (touchesIdentity) {
                assert.ok(selector.includes('.inv-passes'),
                    'button identity overridden outside the pass module: ' + selector.trim());
            }
        }
    });

    test('the UNIFIED SHELL contract: one container owns the composition', () => {
        const css = readFileSync(join(ROOT, 'invitation', 'templates', 'custom-design', 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        // The renderer's own article IS the shell: one width, one radius, one
        // surface — and `overflow: hidden` is the only thing that ever touches
        // the image's corners.
        const shell = css.match(/\.inv-invitation\.tpl-custom-design\s*\{([^}]*)\}/);
        assert.ok(shell, 'the article shell rule is missing');
        assert.ok(shell[1].includes('max-width: 27rem'), 'the shell must be phone-stage width');
        assert.ok(shell[1].includes('border-radius'), 'the shell owns the primary radius');
        // NO overflow: hidden on the shell any more — the card backdrop must
        // bleed past it; the image's own corner radii took over the clipping
        // (asserted in the backdrop contract test).
        assert.ok(!shell[1].includes('overflow'),
            'the shell must not clip — the aura has to bleed past the card');
        assert.ok(shell[1].includes('position: relative'),
            'the shell anchors the card backdrop');
        assert.ok(/margin:[^;]*auto/.test(shell[1]), 'the shell must centre itself');
        // …and it never touches the viewport edges on phones.
        assert.ok(/width:\s*calc\(100% - /.test(shell[1]), 'the shell needs side gutters');

        // The sections surrender their geometry to the shell: the image is
        // flush and the pass area continues on the same surface — no second
        // card, no own max-width, no page gap between the two.
        assert.match(css, /\.inv-section--design\s*\{[^}]*padding:\s*0/,
            'the design section must be flush inside the shell');
        assert.match(css, /\.inv-section--passes\s*\{[^}]*padding:\s*0/,
            'the passes section must not re-introduce page padding');
        assert.ok(!/\.inv-passes \.inv-section__inner[^}]*max-width:\s*2\drem/.test(css),
            'the pass area must not carry its own card width inside the shell');

        // The seam: a thin brand-gradient line, never a whitespace gap.
        assert.match(css, /\.tpl-custom-design \.inv-passes\s*\{[^}]*border-image:/,
            'the image→passes seam must be the brand gradient line');
    });

    test('the pass module carries the CANONICAL Orbiventt identity, restrained', () => {
        const css = readFileSync(join(ROOT, 'invitation', 'templates', 'custom-design', 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        assert.match(css, /\.tpl-custom-design \.inv-passes \.inv-section__inner/);
        assert.match(css, /\.tpl-custom-design \.inv-passes__code-value/);
        // The compact-module contract from the previous pass survives inside
        // the shell: eyebrow heading, no decorative rule, ≥44px targets.
        assert.match(css, /\.inv-passes \.inv-heading[^}]*letter-spacing/,
            'the heading must stay an eyebrow');
        assert.match(css, /\.inv-passes \.inv-rule[^}]*display:\s*none/,
            'the decorative rule must stay dropped');
        assert.match(css, /\.inv-passes \.inv-btn[^}]*min-height:\s*4[4-9]px/,
            'buttons must keep a >=44px touch target');

        // The primary CTA is the EXISTING premium treatment (404.html
        // #openApp.btn), identified by its exact canonical gradient stops —
        // a reused brand asset, never an invented gradient.
        assert.ok(css.includes('#8A18EA') && css.includes('#3826CE') && css.includes('#1E74E6'),
            'the canonical purple→blue CTA gradient stops are missing');
        assert.match(css, /\.inv-passes \.inv-btn--solid\s*\{/,
            'the solid CTA must be styled inside the pass module');
        assert.match(css, /\.inv-passes \.inv-btn--ghost\s*\{[^}]*border-color/,
            'the secondary CTA needs a readable outline on the dark shell');
        // Focus stays visible on the dark surface.
        assert.match(css, /\.inv-passes \.inv-btn:focus-visible/,
            'focus-visible treatment missing inside the pass module');

        // The draft example reads as a mockup: dashed, per the is-demo
        // convention, translated to the dark surface.
        assert.match(css, /\.inv-passes\.is-example[\s\S]*?dashed/);

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

    test('the CARD BACKDROP: full-size image in the card, blur BEHIND it — never inside the frame', () => {
        for (const route of [
            '?i=abcd1234abcd1234',                                        // published, no code
            '?i=abcd1234abcd1234&code=AAAA2222BBBB',                      // published, code
            '?d=11111111-2222-4333-8444-555555555555&t=tok_tok_tok_tok_16', // draft
        ]) {
            const out = renderCustom(customRaw(), route);
            const backdrop = out.node.querySelector('.inv-design__backdrop');
            const img = out.node.querySelector('.inv-design__img');
            assert.ok(backdrop && img, 'layers missing on ' + route);

            // THE STAGE IS GONE. The wrong composition — a contained image
            // floating inside a blur-filled box — must be unbuildable.
            assert.equal(out.node.querySelector('.inv-design__stage'), null,
                'the letterboxing stage reappeared');

            // The sharp image is a DIRECT child of the section's inner column
            // (the full-size flow treatment); the backdrop is its flow-neutral
            // sibling, positioned by the SHELL — attached to the outer
            // component, not wrapped around the image.
            assert.equal(img.parentNode, backdrop.parentNode,
                'both layers live in the design section');
            assert.ok((img.parentNode.getAttribute('class') || '').includes('inv-section__inner'));

            // Decorative, and carrying EXACTLY the sharp image's resolved URL
            // — one object, browser-cached, nothing new to fetch or authorize.
            assert.equal(backdrop.getAttribute('aria-hidden'), 'true');
            assert.ok((backdrop.getAttribute('style') || '').includes(img.getAttribute('src')),
                'the backdrop must reuse the sharp image URL');
        }
    });

    test('the backdrop stylesheet contract: anchored by the shell, behind it, never fixed', () => {
        const css = readFileSync(join(ROOT, 'invitation', 'templates', 'custom-design', 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        // No stage rule may exist any more.
        assert.equal(/\.inv-design__stage/.test(css), false,
            'stage CSS survived the correction');

        // THE LIVE-VISIBILITY INVARIANT (measured on the deployed page):
        // base.css paints `html` itself, so body's background does NOT
        // promote to the canvas and covers root-level negative-z layers.
        // The shell must therefore be a positioned element WITH an explicit
        // z-index — a stacking context — so it, and the z:−1 backdrop inside
        // it, paint ABOVE the page ground.
        const shell = css.match(/\.inv-invitation\.tpl-custom-design\s*\{([^}]*)\}/);
        assert.ok(shell[1].includes('position: relative'),
            'the shell must be the backdrop\'s containing block');
        assert.match(shell[1], /z-index:\s*0/,
            'without an explicit z-index the body background buries the backdrop');
        // Inside that context the shell's own border/shadow would paint UNDER
        // the backdrop — they may not exist on the shell itself.
        assert.ok(!/[^-]border:\s/.test(shell[1]),
            'a shell border would be buried under the backdrop — use the ring');
        assert.ok(!shell[1].includes('box-shadow'),
            'a shell shadow would be buried under the backdrop');

        // The hairline lives on the overlay ring instead, above the content.
        const ring = css.match(/\.inv-invitation\.tpl-custom-design::after\s*\{([^}]*)\}/);
        assert.ok(ring, 'the hairline ring is missing');
        assert.match(ring[1], /border:\s*1px solid/);
        assert.match(ring[1], /z-index:\s*1/);
        assert.ok(ring[1].includes('pointer-events: none'));

        // And the pass module paints its OWN dark surface — the article's
        // background is under the backdrop now, and light-on-dark pass text
        // must never sit directly on arbitrary blurred artwork.
        const passes = css.match(/\.tpl-custom-design \.inv-passes\s*\{([^}]*)\}/);
        assert.ok(passes[1].includes('background: var(--tpl-shell)'),
            'the pass module needs its own opaque shell surface');
        assert.match(passes[1], /border-radius:\s*0 0/,
            'the pass module rounds the card\'s bottom corners');

        // The backdrop: absolute, behind the card (z-index −1), bleeding past
        // it vertically AND spanning the FULL VIEWPORT WIDTH horizontally —
        // the calc(50% − 50vw) breakout is what stops the page's light ground
        // from showing beside the card as a white slab.
        const backdrop = css.match(/\.inv-design__backdrop\s*\{([^}]*)\}/);
        assert.ok(backdrop, 'backdrop rule missing');
        assert.ok(backdrop[1].includes('position: absolute'));
        assert.match(backdrop[1], /top:\s*-/,
            'the band must bleed past the card vertically');
        assert.match(backdrop[1], /left:\s*calc\(50% - 50vw\)/,
            'the band must reach the viewport\'s left edge');
        assert.match(backdrop[1], /right:\s*calc\(50% - 50vw\)/,
            'the band must reach the viewport\'s right edge');
        assert.ok(backdrop[1].includes('z-index: -1'),
            'the backdrop must paint behind the card surface');
        assert.ok(backdrop[1].includes('background-size: cover'));
        assert.match(backdrop[1], /filter:[^;]*blur\(/);
        assert.ok(backdrop[1].includes('pointer-events: none'));

        // The viewport-unit band needs the scoped horizontal-overflow guard,
        // or a desktop scrollbar's few extra pixels would let the page pan.
        assert.match(css, /:root\.tpl-custom-design body\s*\{[^}]*overflow-x:\s*hidden/,
            'the scoped overflow-x guard is missing');

        // A LIGHT wash only — the aura carries the invitation's palette.
        const veil = css.match(/\.inv-design__backdrop::after\s*\{([^}]*)\}/);
        assert.ok(veil, 'veil rule missing');
        const alpha = veil[1].match(/rgba\([^)]*,\s*(0?\.\d+)\)/);
        assert.ok(alpha && Number(alpha[1]) <= 0.25,
            'the wash must stay light so the invitation\'s colours read through');

        // Never page-level, never fixed, never on the body.
        assert.equal(css.includes('position: fixed'), false);
        assert.ok(!/body[^{]*\{[^}]*background-image/.test(css));

        // With the shell's overflow gone (the aura must bleed), the IMAGE owns
        // its corner clipping: top pair always, bottom pair when it is the
        // card's last content (a code-less page).
        const img = css.match(/\.inv-design__img\s*\{([^}]*)\}/);
        assert.match(img[1], /border-radius:\s*19px 19px 0 0/,
            'the image must clip the card\'s top corners itself');
        assert.match(css, /\.inv-section--design:last-child \.inv-design__img\s*\{[^}]*border-bottom/,
            'a code-less card needs the image to round the bottom corners too');

        // THE SHARP IMAGE STAYS SHARP: no filter may ever reach it.
        for (const match of css.matchAll(/\.inv-design__img[^{]*\{([^}]*)\}/g)) {
            assert.ok(!match[1].includes('filter'), 'a filter reached the sharp image');
        }
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
