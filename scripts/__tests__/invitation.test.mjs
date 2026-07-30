/**
 * Tests for the digital-invitation renderer.
 *
 *   node --test scripts/__tests__/
 *
 * Every assertion runs against THE EXACT FILES GITHUB PAGES SERVES — the module
 * tree under `invitation/`, imported directly. There is no copy, no bundle and
 * no re-implementation, so nothing here can pass against code that has drifted
 * from what a guest's phone downloads.
 *
 * The DOM is `dom-stub.mjs`, a ~200-line shim whose `innerHTML` setter THROWS.
 * That is not a limitation, it is an assertion: if any renderer ever builds
 * markup from a string, this suite fails instead of quietly accepting a new
 * injection surface.
 *
 * The properties under test pull in two directions, which is why they are worth
 * writing down:
 *
 *   • The page must render a complete, polished invitation from data an
 *     organizer typed.
 *   • None of that data may ever be able to become markup, a script, a
 *     cross-origin request, or a URL the renderer did not build.
 *
 * Plus the Milestone A boundary: demo mode reaches no backend, and there is no
 * database object for it to reach.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

import { createDocument, serialize, sectionsOf } from './dom-stub.mjs';

import { resolveTemplate, listTemplates, matchesConfig, CATEGORIES } from '../../invitation/js/registry.js';
import { demoConfig, listDemoIds } from '../../invitation/js/demo-data.js';
import { normalizeConfig, CONTRACT_VERSION, REQUIRED_SECTIONS, OPTIONAL_SECTIONS, parseInstant } from '../../invitation/js/config.js';
import { renderInvitation } from '../../invitation/js/renderer.js';
import { parseRoute, MODE } from '../../invitation/js/route.js';
import { moduleBases, templateResourceUrl } from '../../invitation/js/paths.js';
import {
    LIMITS, sanitizeText, sanitizeParagraph, safeExternalUrl, safeMapUrl,
    buildMapUrl, resolveImage, safeAssetPath, safeCode, safeToken,
} from '../../invitation/js/security.js';
import { countdownParts, countdownLabel } from '../../invitation/js/countdown.js';
import { buildIcs, escapeIcsText, icsFileName } from '../../invitation/js/calendar.js';
import { calendarEventFromConfig } from '../../invitation/js/sections/actions.js';
import { sectionIds, resolveSection } from '../../invitation/js/sections/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INVITATION = join(ROOT, 'invitation');
const DEMO_ID = 'wedding_romantic_v1';

/* The two roots this module is served from. Both are exercised; neither string
 * may appear inside the module tree. */
const DEV_MODULE_URL = 'https://cosioyair.github.io/vyvent-legal/invitation/js/main.js';
const PROD_MODULE_URL = 'https://orbiventt.com/invitation/js/main.js';

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Every .js file in the invitation module tree, as {rel, source}. */
function moduleSources() {
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) { walk(abs); continue; }
            if (!entry.name.endsWith('.js')) continue;
            out.push({
                rel: relative(ROOT, abs).split(sep).join('/'),
                source: readFileSync(abs, 'utf8'),
            });
        }
    };
    walk(INVITATION);
    return out;
}

/** Source with comments removed, so a doc-comment cannot satisfy an assertion
 *  that is about executable code. */
function codeOnly(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

const INDEX_HTML = readFileSync(join(INVITATION, 'index.html'), 'utf8');

/** A rendered demo invitation. */
function renderDemo(over = {}) {
    const template = over.template || resolveTemplate(DEMO_ID);
    const raw = over.raw || demoConfig(DEMO_ID);
    const { ok, config, errors } = normalizeConfig(raw);
    assert.equal(ok, true, 'demo configuration did not normalize: ' + errors.join(', '));
    const document = createDocument();
    const result = renderInvitation({
        template,
        config,
        route: over.route || parseRoute('?demo=' + DEMO_ID),
        document,
        assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
        now: over.now === undefined ? Date.parse('2026-08-01T12:00:00Z') : over.now,
        pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/?demo=' + DEMO_ID,
    });
    return { ...result, config, document };
}

/** A raw demo configuration with one section replaced. */
function withSection(name, value) {
    const raw = demoConfig(DEMO_ID);
    raw.sections[name] = value;
    return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 2 · The registry is a closed set
// ─────────────────────────────────────────────────────────────────────────────
describe('1 + 2 · template registry', () => {
    test('1 · wedding_romantic_v1 resolves, with a consistent identity', () => {
        const t = resolveTemplate(DEMO_ID);
        assert.ok(t, 'wedding_romantic_v1 did not resolve');
        assert.equal(t.categoryKey, 'wedding');
        assert.equal(t.templateKey, 'wedding_romantic');
        assert.equal(t.templateVersion, 1);
        assert.equal(t.id, t.templateKey + '_v' + t.templateVersion);
        assert.ok(Object.prototype.hasOwnProperty.call(CATEGORIES, t.categoryKey));
        assert.ok(Array.isArray(t.sections) && t.sections.length > 0);
    });

    test('2 · every unknown identifier is rejected — including prototype keys', () => {
        const rejected = [
            'wedding_romantic_v2', 'wedding_romantic', 'WEDDING_ROMANTIC_V1',
            'unknown_v1', '', ' ', '../../etc/passwd', 'https://evil.example/t.js',
            '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty',
            null, undefined, 42, {}, [],
        ];
        for (const id of rejected) {
            assert.equal(resolveTemplate(id), null, 'accepted ' + JSON.stringify(id));
        }
    });

    test('2 · the section table is closed too', () => {
        for (const id of ['__proto__', 'constructor', 'toString', 'nope', '', null, 42]) {
            assert.equal(resolveSection(id), null, 'accepted section ' + JSON.stringify(id));
        }
        for (const id of resolveTemplate(DEMO_ID).sections) {
            assert.ok(resolveSection(id), 'template declares an unknown section: ' + id);
        }
    });

    test('a configuration may only be drawn by the template that authored it', () => {
        const t = resolveTemplate(DEMO_ID);
        const { config } = normalizeConfig(demoConfig(DEMO_ID));
        assert.equal(matchesConfig(t, config), true);
        assert.equal(matchesConfig(t, { ...config, templateVersion: 2 }), false);
        assert.equal(matchesConfig(t, { ...config, templateKey: 'wedding_modern' }), false);
        assert.equal(matchesConfig(t, { ...config, categoryKey: 'birthday' }), false);

        const mismatch = renderInvitation({
            template: t,
            config: { ...config, templateVersion: 9 },
            document: createDocument(),
        });
        assert.equal(mismatch.ok, false);
        assert.equal(mismatch.reason, 'template-mismatch');
        assert.equal(mismatch.node, null);
    });

    test('every registered template ships a demo configuration, and vice versa', () => {
        assert.deepEqual(listTemplates().map((t) => t.id).sort(), listDemoIds().sort());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 + 16 + 17 · The Milestone A data boundary
// ─────────────────────────────────────────────────────────────────────────────
describe('3 + 16 + 17 · demo mode has no backend', () => {
    const sources = moduleSources();

    test('3 · no network primitive exists anywhere in the module tree', () => {
        const forbidden = [
            'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource',
            'sendBeacon', 'navigator.connection',
        ];
        for (const { rel, source } of sources) {
            const code = codeOnly(source);
            for (const needle of forbidden) {
                assert.ok(!code.includes(needle), `${rel} contains ${needle}`);
            }
        }
    });

    test('every dynamic import specifier is a LITERAL, never derived from input', () => {
        // A dynamic import is how demo data is kept off the real routes, so it
        // cannot be banned outright — but a computed specifier would reopen the
        // arbitrary-module-loading hole the registry exists to close.
        for (const { rel, source } of sources) {
            const code = codeOnly(source);
            for (const m of code.matchAll(/\bimport\s*\(([^)]*)\)/g)) {
                const specifier = m[1].trim();
                assert.match(specifier, /^'\.\/[a-z-]+\.js'$/,
                    `${rel} has a non-literal dynamic import: ${specifier}`);
            }
        }
    });

    test('17 · no Supabase reference of any kind survives in executable code', () => {
        for (const { rel, source } of sources) {
            const code = codeOnly(source).toLowerCase();
            for (const needle of ['supabase', 'supaurl', 'supaanon', 'rest/v1', 'apikey']) {
                assert.ok(!code.includes(needle), `${rel} references ${needle}`);
            }
        }
    });

    test('17 · the page declares connect-src \'none\', so a request is impossible', () => {
        const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(INDEX_HTML);
        assert.ok(csp, 'no CSP meta tag');
        assert.match(csp[1], /connect-src 'none'/);
        assert.match(csp[1], /img-src 'self'/);
        assert.match(csp[1], /object-src 'none'/);
        assert.match(csp[1], /base-uri 'self'/);
        assert.match(csp[1], /form-action 'none'/);
        // No inline script is permitted on this page at all.
        assert.match(csp[1], /script-src 'self'/);
        assert.ok(!/script-src[^;]*unsafe-inline/.test(csp[1]));
        assert.ok(!/script-src[^;]*unsafe-eval/.test(csp[1]));
    });

    test('17 · the page contains no inline script', () => {
        const inline = /<script(?![^>]*\bsrc=)[^>]*>/i.exec(INDEX_HTML);
        assert.equal(inline, null, 'index.html has an inline <script>');
    });

    test('16 · no invitation database object is referenced', () => {
        for (const { rel, source } of sources) {
            const code = codeOnly(source).toLowerCase();
            for (const needle of ['rpc/', 'select ', 'insert into', 'invitations_config', 'from public.']) {
                assert.ok(!code.includes(needle), `${rel} references ${needle}`);
            }
        }
        // And no migration was created anywhere in this repository.
        assert.ok(!readdirSync(ROOT).includes('supabase'), 'a supabase/ directory appeared in the web repo');
    });

    test('3 · demo data is a literal, and each call gets its own copy', () => {
        const a = demoConfig(DEMO_ID);
        const b = demoConfig(DEMO_ID);
        assert.notEqual(a, b);
        a.sections.hero.partnerA = 'mutated';
        assert.equal(demoConfig(DEMO_ID).sections.hero.partnerA, 'Valentina');
    });

    test('3 · unknown demo identifiers return null rather than anything fetchable', () => {
        for (const id of ['nope_v1', '__proto__', '', null, 42]) {
            assert.equal(demoConfig(id), null);
        }
    });

    test('no evaluator or dynamic code path exists', () => {
        for (const { rel, source } of sources) {
            const code = codeOnly(source);
            for (const needle of ['eval(', 'new Function', 'setTimeout("', "setTimeout('", 'document.write']) {
                assert.ok(!code.includes(needle), `${rel} contains ${needle}`);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Required sections render
// ─────────────────────────────────────────────────────────────────────────────
describe('4 · required sections', () => {
    test('the demo renders hero, message and ceremony', () => {
        const { ok, node, rendered } = renderDemo();
        assert.equal(ok, true);
        for (const id of REQUIRED_SECTIONS) {
            assert.ok(rendered.includes(id), 'required section not rendered: ' + id);
        }
        const ids = sectionsOf(node);
        for (const id of REQUIRED_SECTIONS) assert.ok(ids.includes(id));
    });

    test('the section order comes from the template descriptor', () => {
        const template = resolveTemplate(DEMO_ID);
        const { rendered, skipped } = renderDemo();
        const seen = [...rendered];
        const expected = template.sections.filter((id) => !skipped.includes(id));
        assert.deepEqual(seen, expected);
    });

    test('there is exactly one <h1>, and it names the couple', () => {
        const { node } = renderDemo();
        const h1s = node.querySelectorAll('h1');
        assert.equal(h1s.length, 1);
        assert.match(h1s[0].textContent, /Valentina/);
        assert.match(h1s[0].textContent, /Mateo/);
    });

    test('a missing required section makes the whole configuration unusable', () => {
        for (const name of REQUIRED_SECTIONS) {
            const { ok, config, errors } = normalizeConfig(withSection(name, undefined));
            assert.equal(ok, false, name + ' was allowed to be missing');
            assert.equal(config, null);
            assert.ok(errors.includes('section:' + name));
        }
    });

    test('an unsupported contract version is refused outright', () => {
        for (const version of [0, 2, '1', null, undefined, {}]) {
            const raw = demoConfig(DEMO_ID);
            raw.contractVersion = version;
            const { ok, errors } = normalizeConfig(raw);
            assert.equal(ok, false, 'accepted contractVersion ' + JSON.stringify(version));
            assert.deepEqual(errors, ['config:unsupported-version']);
        }
        assert.equal(CONTRACT_VERSION, 1);
    });

    test('a non-object configuration is refused rather than crashing', () => {
        for (const raw of [null, undefined, 'x', 42, []]) {
            const result = normalizeConfig(raw);
            assert.equal(result.ok, false);
            assert.equal(result.config, null);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 + 6 · Optional sections
// ─────────────────────────────────────────────────────────────────────────────
describe('5 · disabled optional sections do not render', () => {
    test('each optional section disappears when `enabled` is not exactly true', () => {
        for (const name of OPTIONAL_SECTIONS) {
            for (const enabled of [false, undefined, null, 0, 'true', 1]) {
                const raw = demoConfig(DEMO_ID);
                raw.sections[name] = { ...raw.sections[name], enabled };
                const { ok, config } = normalizeConfig(raw);
                assert.equal(ok, true);
                assert.equal(config.sections[name], null,
                    `${name} rendered with enabled=${JSON.stringify(enabled)}`);
            }
        }
    });

    test('a disabled section leaves no element behind', () => {
        const raw = demoConfig(DEMO_ID);
        for (const name of OPTIONAL_SECTIONS) raw.sections[name].enabled = false;
        const { config } = normalizeConfig(raw);
        const result = renderInvitation({
            template: resolveTemplate(DEMO_ID),
            config,
            document: createDocument(),
            assetBase: 'https://example.test/invitation/assets/',
            now: Date.now(),
        });
        const ids = sectionsOf(result.node);
        for (const name of OPTIONAL_SECTIONS) {
            assert.ok(!ids.includes(name), name + ' left an element behind');
        }
        // The required ones are untouched.
        for (const name of REQUIRED_SECTIONS) assert.ok(ids.includes(name));
    });
});

describe('6 · invalid optional sections are skipped safely', () => {
    const broken = {
        countdown: { enabled: true, targetAt: 'not-a-date', heading: 'x' },
        reception: { enabled: true, venueName: 'Hacienda', address: 'x' },   // no startsAt
        dressCode: { enabled: true, title: 'Formal' },   // a title alone is not content
        gallery: { enabled: true, items: [{ image: 'a-bare-string' }, { image: null }] },
        gifts: { enabled: true, links: [{ label: 'x', url: 'javascript:alert(1)' }] },
        closing: { enabled: true, body: '   ' },
    };

    for (const [name, value] of Object.entries(broken)) {
        test(`${name} is dropped, and the rest of the page still renders`, () => {
            const { ok, config } = normalizeConfig(withSection(name, value));
            assert.equal(ok, true, name + ' took the whole configuration down');
            assert.equal(config.sections[name], null);

            const result = renderInvitation({
                template: resolveTemplate(DEMO_ID),
                config,
                document: createDocument(),
                assetBase: 'https://example.test/invitation/assets/',
                now: Date.now(),
            });
            assert.equal(result.ok, true);
            for (const id of REQUIRED_SECTIONS) assert.ok(result.rendered.includes(id));
        });
    }

    test('a section whose data THROWS while being read is skipped, not fatal', () => {
        const hostile = {
            enabled: true,
            title: 'Formal',
            description: 'Vestido largo.',
            get guidelines() { throw new Error('boom'); },
        };
        const { ok, config } = normalizeConfig(withSection('dressCode', hostile));
        assert.equal(ok, true);
        assert.equal(config.sections.dressCode, null);
    });

    test('an unknown section id in a descriptor is skipped, never resolved', () => {
        const template = resolveTemplate(DEMO_ID);
        const synthetic = {
            ...template,
            sections: ['hero', '__proto__', 'nope', 'constructor', 'message'],
        };
        const { config } = normalizeConfig(demoConfig(DEMO_ID));
        const result = renderInvitation({
            template: synthetic,
            config,
            document: createDocument(),
            assetBase: 'https://example.test/invitation/assets/',
            now: Date.now(),
        });
        assert.deepEqual(result.rendered, ['hero', 'message']);
        assert.deepEqual(result.skipped, ['__proto__', 'nope', 'constructor']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO DEFAULT INVITATION CONTENT
//
// The product rule this suite exists to make mechanical: a real draft or
// published invitation must never show a value the organizer did not enter.
// Not a name, not a date, not a venue, not an image, not a link — and not a
// heading that looks like something they wrote.
// ─────────────────────────────────────────────────────────────────────────────
describe('no real invitation can inherit demonstration content', () => {
    const MAIN = readFileSync(join(INVITATION, 'js', 'main.js'), 'utf8');

    test('demo data is not in the module graph of the real routes', () => {
        const code = codeOnly(MAIN);
        // A static import would pull the entire fictional wedding into every
        // route's graph, one mistaken line away from a real draft.
        assert.ok(!/^\s*import\s[^\n]*demo-data/m.test(code),
            'main.js statically imports demo-data.js');
        // It is reached exactly once, through a literal dynamic import.
        const dynamic = [...code.matchAll(/import\s*\(\s*'\.\/demo-data\.js'\s*\)/g)];
        assert.equal(dynamic.length, 1, 'expected exactly one dynamic demo-data import');
    });

    test('nothing but main.js and the tests may reference demo data at all', () => {
        for (const { rel, source } of moduleSources()) {
            if (rel.endsWith('js/main.js') || rel.endsWith('js/demo-data.js')) continue;
            const code = codeOnly(source);
            assert.ok(!code.includes('demo-data'), `${rel} references demo-data`);
            assert.ok(!code.includes('demoConfig'), `${rel} references demoConfig`);
        }
    });

    test('the demo values appear in demo-data.js and nowhere else', () => {
        const FICTION = [
            'Valentina', 'Mateo', 'San Miguel de Allende', 'Santa Cruz',
            'Los Arcos', 'Rosal', 'Serrano', 'Herrera', 'Lozano',
            '2027-04-17', 'liverpool', 'amazon.com.mx', 'lluvia de sobres',
            'Etiqueta jard', 'tacón de aguja',
        ];
        for (const { rel, source } of moduleSources()) {
            if (rel.endsWith('js/demo-data.js')) continue;
            for (const needle of FICTION) {
                assert.ok(!source.toLowerCase().includes(needle.toLowerCase()),
                    `${rel} contains the demonstration value "${needle}"`);
            }
        }
        // …including the template, which is the other place a default could hide.
        const tpl = readFileSync(join(INVITATION, 'templates', 'wedding-romantic', 'template.js'), 'utf8');
        for (const needle of FICTION) {
            assert.ok(!tpl.toLowerCase().includes(needle.toLowerCase()),
                `the template descriptor contains "${needle}"`);
        }
    });

    test('the demo artwork is reachable only through a demo image reference', () => {
        // `{source:'demo'}` is the only way to address the bundled SVGs, and the
        // editor never writes one — real images are storage references.
        const ASSET = 'https://example.test/invitation/assets/';
        assert.ok(resolveImage({ source: 'demo', path: 'wedding-romantic/hero.svg' }, { assetBase: ASSET }));
        assert.equal(resolveImage({ source: 'storage', bucket: 'event-photos', path: 'wedding-romantic/hero.svg' },
            { assetBase: ASSET }), null, 'a storage ref resolved into the demo asset directory');
    });

    test('no organizer-content field carries a built-in default', () => {
        // Every value below is content a guest reads as the couple's own. If any
        // of them can be produced without the organizer having typed it, the
        // product rule is broken.
        const bare = {
            contractVersion: 1,
            categoryKey: 'wedding',
            templateKey: 'wedding_romantic',
            templateVersion: 1,
            sections: {
                hero: { partnerA: 'A', partnerB: 'B', date: '2030-01-01T12:00:00-06:00' },
                message: { body: 'Cuerpo.' },
                ceremony: { startsAt: '2030-01-01T12:00:00-06:00', venueName: 'Lugar' },
            },
        };
        const { ok, config } = normalizeConfig(bare);
        assert.equal(ok, true);

        const h = config.sections.hero;
        assert.equal(h.eyebrow, '');
        assert.equal(h.location, '');
        assert.equal(h.image, null);
        assert.equal(h.imageAlt, '');
        assert.equal(config.sections.message.heading, '');
        assert.equal(config.sections.message.hosts, '');
        assert.equal(config.sections.ceremony.address, '');
        assert.equal(config.sections.ceremony.note, '');
        // Every optional section is absent, not example-filled.
        for (const name of OPTIONAL_SECTIONS) {
            assert.equal(config.sections[name], null, name + ' materialized without organizer input');
        }

        // And the rendered page shows only what was entered.
        const { node } = renderDemo({ raw: bare });
        const text = node.textContent;
        for (const fiction of ['Valentina', 'Mateo', 'San Miguel', 'Liverpool', 'Amazon', '2027']) {
            assert.ok(!text.includes(fiction), `a bare invitation rendered "${fiction}"`);
        }
        assert.ok(text.includes('A') && text.includes('B') && text.includes('Cuerpo.'));
        assert.equal(node.querySelectorAll('img').length, 0, 'a bare invitation rendered an image');
    });

    test('section headings are template UI copy, not stored content', () => {
        // A heading the organizer never wrote must not be persisted as if they
        // had — otherwise "no default content" is true only by accident.
        const { config } = normalizeConfig(demoConfig(DEMO_ID));
        for (const name of ['ceremony', 'reception', 'dressCode', 'gallery', 'gifts', 'countdown']) {
            const section = config.sections[name];
            if (section) assert.equal(section.heading, undefined, name + ' stored a heading');
        }
        assert.equal(config.sections.hero.conjunction, undefined, 'hero stored the ampersand');

        // They still reach the page — from the template.
        const labels = resolveTemplate(DEMO_ID).labels;
        const { node } = renderDemo();
        for (const key of ['ceremonyHeading', 'receptionHeading', 'dressCodeHeading', 'galleryHeading', 'giftsHeading', 'countdownHeading']) {
            assert.ok(labels[key], 'template label missing: ' + key);
            assert.ok(node.textContent.includes(labels[key]), 'heading not rendered: ' + labels[key]);
        }
    });
});

describe('optional sections that are ON but empty are reported, never filled', () => {
    const cases = {
        reception: { enabled: true, venueName: 'Solo el nombre' },     // no startsAt
        dressCode: { enabled: true, title: 'Formal' },                 // no description, no guidelines
        gallery: { enabled: true, items: [] },
        gifts: { enabled: true, links: [] },
        closing: { enabled: true, body: '   ' },
    };

    for (const [name, value] of Object.entries(cases)) {
        test(`${name}: omitted from the page and named as incomplete`, () => {
            const { ok, config, incomplete } = normalizeConfig(withSection(name, value));
            assert.equal(ok, true, 'an empty optional section broke the whole config');
            assert.equal(config.sections[name], null);
            assert.ok(incomplete.includes(name), `${name} was not reported as incomplete`);

            const { node } = renderDemo({ raw: withSection(name, value) });
            assert.ok(!sectionsOf(node).includes(name), `${name} rendered anyway`);
        });
    }

    test('a section switched OFF is not incomplete — it is just off', () => {
        const raw = demoConfig(DEMO_ID);
        for (const name of OPTIONAL_SECTIONS) raw.sections[name] = { enabled: false };
        const { ok, incomplete } = normalizeConfig(raw);
        assert.equal(ok, true);
        assert.deepEqual(incomplete, []);
    });

    test('a complete demo configuration reports nothing incomplete', () => {
        const { incomplete } = normalizeConfig(demoConfig(DEMO_ID));
        assert.deepEqual(incomplete, []);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dress code — the clarified v1 contract
//
// `guidelines` (formerly `notes`) is the short list INSIDE the dress-code
// section. The rules worth pinning down are the ones a future editor could
// quietly break: that it is not a section of its own, that description and
// guidelines are each independently sufficient, and that a blank row an
// organizer left behind never becomes an empty bullet.
// ─────────────────────────────────────────────────────────────────────────────
describe('dress code · description and guidelines are independently sufficient', () => {
    const dress = (over) => withSection('dressCode', { enabled: true, ...over });

    test('description alone renders the section', () => {
        const { config } = normalizeConfig(dress({ description: 'Vestido largo y traje oscuro.' }));
        assert.ok(config.sections.dressCode);
        assert.deepEqual(config.sections.dressCode.guidelines, []);

        const { node, rendered } = renderDemo({ raw: dress({ description: 'Vestido largo y traje oscuro.' }) });
        assert.ok(rendered.includes('dressCode'));
        assert.equal(node.querySelectorAll('.inv-dress__description').length, 1);
        // No empty list is left behind.
        assert.equal(node.querySelectorAll('.inv-dress__guidelines').length, 0);
    });

    test('guidelines alone render the section', () => {
        const raw = dress({ guidelines: ['Evita el tacón de aguja.'] });
        const { config } = normalizeConfig(raw);
        assert.ok(config.sections.dressCode);
        assert.equal(config.sections.dressCode.description, '');

        const { node, rendered } = renderDemo({ raw });
        assert.ok(rendered.includes('dressCode'));
        assert.equal(node.querySelectorAll('.inv-dress__guideline').length, 1);
        // No empty paragraph is left behind.
        assert.equal(node.querySelectorAll('.inv-dress__description').length, 0);
    });

    test('neither one means the section is empty and is omitted', () => {
        for (const over of [
            {},
            { title: 'Formal · Etiqueta jardín' },
            { title: 'Formal', description: '   ', guidelines: [] },
            { title: 'Formal', description: '', guidelines: ['', '   ', null, 42] },
            { title: 'Formal', guidelines: 'no soy un arreglo' },
        ]) {
            const { ok, config } = normalizeConfig(dress(over));
            assert.equal(ok, true, 'an empty dress code took the page down');
            assert.equal(config.sections.dressCode, null,
                'rendered with nothing to say: ' + JSON.stringify(over));
        }
    });

    test('a title is optional, and never keeps an empty section alive on its own', () => {
        const withTitle = normalizeConfig(dress({ title: 'Formal', description: 'x' })).config;
        assert.equal(withTitle.sections.dressCode.title, 'Formal');

        const withoutTitle = normalizeConfig(dress({ description: 'x' })).config;
        assert.equal(withoutTitle.sections.dressCode.title, '');
        const { node } = renderDemo({ raw: dress({ description: 'x' }) });
        assert.equal(node.querySelectorAll('.inv-dress__title').length, 0);
    });
});

describe('dress code · each guideline is trimmed, non-empty, bounded and semantic', () => {
    const dress = (guidelines) => withSection('dressCode', { enabled: true, title: 'Formal', guidelines });

    test('entries are trimmed and whitespace-collapsed', () => {
        const { config } = normalizeConfig(dress(['   Evita   el  tacón   ', '\tLa noche refresca.\n']));
        assert.deepEqual(config.sections.dressCode.guidelines,
            ['Evita el tacón', 'La noche refresca.']);
    });

    test('empty and non-string entries are dropped, not rendered as empty bullets', () => {
        const raw = dress(['Válida', '', '   ', null, undefined, 42, {}, [], 'También válida']);
        const { config } = normalizeConfig(raw);
        assert.deepEqual(config.sections.dressCode.guidelines, ['Válida', 'También válida']);

        const { node } = renderDemo({ raw });
        const items = node.querySelectorAll('.inv-dress__guideline');
        assert.equal(items.length, 2);
        for (const li of items) assert.ok(li.textContent.trim().length > 0);
    });

    test('each entry is clamped to its own limit', () => {
        const { config } = normalizeConfig(dress(['x'.repeat(400), 'y'.repeat(50)]));
        assert.equal(config.sections.dressCode.guidelines[0].length, LIMITS.GUIDELINE);
        assert.equal(LIMITS.GUIDELINE, 160);
        // A short entry is untouched.
        assert.equal(config.sections.dressCode.guidelines[1].length, 50);
    });

    test('the list is a real <ul> of <li>, in the order the organizer gave', () => {
        const order = ['Primera', 'Segunda', 'Tercera'];
        const { node } = renderDemo({ raw: dress(order) });
        const list = node.querySelector('.inv-dress__guidelines');
        assert.equal(list.tagName, 'ul');
        assert.deepEqual(list.children.map((c) => c.tagName), ['li', 'li', 'li']);
        assert.deepEqual(list.children.map((c) => c.textContent), order);
    });

    test('a guideline can never become markup', () => {
        const payload = '<img src=x onerror=alert(1)>';
        const { node } = renderDemo({ raw: dress([payload]) });
        const li = node.querySelector('.inv-dress__guideline');
        assert.equal(li.textContent, payload);
        assert.equal(node.querySelectorAll('img').length > 0, true);   // hero + gallery only
        assert.equal(li.querySelectorAll('img').length, 0);
        assert.ok(serialize(li).includes('&lt;img'));
    });

    test('guidelines belong to the dress code and are not a section of their own', () => {
        assert.ok(!sectionIds().includes('guidelines'));
        assert.ok(!sectionIds().includes('notes'));
        assert.ok(!resolveTemplate(DEMO_ID).sections.includes('guidelines'));
        assert.ok(!OPTIONAL_SECTIONS.includes('guidelines'));
        assert.ok(!REQUIRED_SECTIONS.includes('guidelines'));

        const { node } = renderDemo();
        const list = node.querySelector('.inv-dress__guidelines');
        assert.ok(list, 'the demo renders no guideline list');
        // It lives inside the dress-code section, not beside it.
        assert.equal(node.querySelectorAll('[data-section="guidelines"]').length, 0);
        let ancestor = list.parentNode;
        while (ancestor && ancestor.getAttribute?.('data-section') === null) ancestor = ancestor.parentNode;
        assert.equal(ancestor.getAttribute('data-section'), 'dressCode');
    });

    test('the retired name is gone from the contract, with no compatibility alias', () => {
        // No invitation has ever been persisted, so a legacy alias would be
        // dead code guarding data that does not exist.
        const { config } = normalizeConfig(demoConfig(DEMO_ID));
        assert.equal(config.sections.dressCode.notes, undefined);
        assert.equal(config.sections.dressCode.label, undefined);
        assert.ok(Array.isArray(config.sections.dressCode.guidelines));

        for (const { rel, source } of moduleSources()) {
            const code = codeOnly(source);
            assert.ok(!/\bnotes\b/.test(code), `${rel} still refers to \`notes\``);
            assert.ok(!/raw\.label/.test(code), `${rel} still reads \`label\` on the dress code`);
        }
        // `notes` is not silently accepted as an alias.
        const aliased = normalizeConfig(withSection('dressCode', {
            enabled: true, title: 'Formal', notes: ['no debería aparecer'],
        }));
        assert.equal(aliased.config.sections.dressCode, null);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 · Organizer text is escaped
// ─────────────────────────────────────────────────────────────────────────────
describe('7 · organizer text can never become markup', () => {
    const PAYLOADS = [
        '<img src=x onerror=alert(1)>',
        '</h1><script>alert(1)</script>',
        '"><svg onload=alert(1)>',
        "'; alert(1); //",
        '<iframe src="javascript:alert(1)">',
    ];

    for (const payload of PAYLOADS) {
        test(`renders ${JSON.stringify(payload)} as text`, () => {
            const raw = demoConfig(DEMO_ID);
            raw.sections.hero.partnerA = payload;
            raw.sections.message.body = payload;
            raw.sections.ceremony.venueName = payload;

            const { ok, config } = normalizeConfig(raw);
            assert.equal(ok, true);

            const document = createDocument();
            const { node } = renderInvitation({
                template: resolveTemplate(DEMO_ID),
                config,
                document,
                assetBase: 'https://example.test/invitation/assets/',
                now: Date.now(),
            });

            // No element of the injected kind was created…
            assert.equal(node.querySelectorAll('script').length, 0);
            assert.equal(node.querySelectorAll('iframe').length, 0);
            assert.equal(node.querySelectorAll('svg').length, 0);

            // …the payload survives as literal text…
            assert.ok(node.textContent.includes(payload));

            // …no element acquired an event-handler or other unsafe attribute…
            // (a substring check on the serialized output would be wrong here:
            // `onerror=` legitimately appears INSIDE the escaped text, which is
            // exactly the harmless outcome under test.)
            for (const element of node.querySelectorAll('*')) {
                for (const name of element.attributes.keys()) {
                    assert.ok(!/^on/i.test(name), `element gained ${name}`);
                    assert.ok(name !== 'srcdoc' && name !== 'style', `element gained ${name}`);
                }
            }

            // …and every angle bracket re-encodes as escaped markup.
            const html = serialize(node);
            assert.ok(!html.includes('<script'), 'a <script> reached the output');
            assert.ok(!html.includes('<iframe'), 'an <iframe> reached the output');
            assert.ok(!html.includes('<svg'), 'an <svg> reached the output');
            if (payload.includes('<')) {
                assert.ok(html.includes('&lt;'), 'the payload was not escaped on serialization');
            }
        });
    }

    test('control characters are stripped and lengths are clamped', () => {
        assert.equal(sanitizeText('a\u0000b\u001fc', 80), 'abc');
        assert.equal(sanitizeText('  spaced   out  ', 80), 'spaced out');
        assert.equal(sanitizeText('x'.repeat(300), LIMITS.NAME).length, LIMITS.NAME);
        assert.equal(sanitizeText(42), '');
        assert.equal(sanitizeText(null), '');
        // Paragraph breaks survive; control characters still do not.
        assert.equal(sanitizeParagraph('one\n\n\n\ntwo\u0007'), 'one\n\ntwo');
        assert.equal(sanitizeParagraph('a\r\nb'), 'a\nb');
    });

    test('no renderer builds markup from a string', () => {
        for (const { rel, source } of moduleSources()) {
            const code = codeOnly(source);
            for (const needle of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createContextualFragment']) {
                assert.ok(!code.includes(needle), `${rel} uses ${needle}`);
            }
        }
    });

    test('an attribute outside the allowlist is dropped', () => {
        const raw = demoConfig(DEMO_ID);
        raw.sections.hero.imageAlt = 'ok';
        const { config } = normalizeConfig(raw);
        const { node } = renderInvitation({
            template: resolveTemplate(DEMO_ID),
            config,
            document: createDocument(),
            assetBase: 'https://example.test/invitation/assets/',
            now: Date.now(),
        });
        const html = serialize(node);
        for (const attr of ['onclick', 'onerror', 'onload', 'srcdoc', 'style=', 'formaction']) {
            assert.ok(!html.includes(attr), 'output carries ' + attr);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 · Unsafe external links are rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('8 · external link validation', () => {
    const REJECTED = {
        'plain http': 'http://example.com/registry',
        'javascript:': 'javascript:alert(1)',
        'javascript with newline': 'java\nscript:alert(1)',
        'data:': 'data:text/html,<script>alert(1)</script>',
        'blob:': 'blob:https://evil.example/x',
        'file:': 'file:///etc/passwd',
        'mailto:': 'mailto:someone@example.com',
        'the app scheme': 'vyvent://e/1',
        'an arbitrary scheme': 'evilapp://x',
        'protocol-relative': '//evil.example/x',
        'a bare path': '/registry',
        'embedded credentials': 'https://user:pass@evil.example/x',
        'an embedded quote': 'https://example.com/x" onclick="alert(1)',
        'an embedded angle bracket': 'https://example.com/<script>',
        'a backslash': 'https://example.com\\x',
        'leading whitespace': '  https://example.com/x',
        'a CRLF injection attempt': 'https://example.com/x\r\nLocation: https://evil.example',
        'empty': '',
        'a non-string': 42,
        'an object pretending to be a URL': { toString: () => 'https://example.com' },
    };

    for (const [label, url] of Object.entries(REJECTED)) {
        test(`rejects ${label}`, () => assert.equal(safeExternalUrl(url), null));
    }

    test('accepts ordinary https links and returns the normalized href', () => {
        assert.equal(safeExternalUrl('https://example.com'), 'https://example.com/');
        assert.equal(
            safeExternalUrl('https://mesaderegalos.liverpool.com.mx/'),
            'https://mesaderegalos.liverpool.com.mx/',
        );
    });

    test('map links additionally require an allowlisted host', () => {
        assert.equal(safeMapUrl('https://www.google.com/maps/search/?api=1&query=x'),
            'https://www.google.com/maps/search/?api=1&query=x');
        assert.equal(safeMapUrl('https://www.openstreetmap.org/?mlat=1&mlon=2'),
            'https://www.openstreetmap.org/?mlat=1&mlon=2');
        for (const url of ['https://evil.example/maps', 'https://google.com.evil.example/maps', 'http://maps.google.com/x']) {
            assert.equal(safeMapUrl(url), null, 'accepted ' + url);
        }
    });

    test('the built map URL is assembled, never echoed', () => {
        const built = buildMapUrl('Parroquia "X"', 'Calle <script> 1');
        assert.ok(built.startsWith('https://www.google.com/maps/search/?api=1&query='));
        assert.ok(!built.includes('<'));
        assert.ok(!built.includes('"'));
        assert.equal(buildMapUrl('', ''), null);
    });

    test('an organizer link that fails validation is DROPPED, not rendered inert', () => {
        const { config } = normalizeConfig(withSection('gifts', {
            enabled: true,
            links: [
                { label: 'malo', url: 'javascript:alert(1)' },
                { label: 'bueno', url: 'https://example.com/mesa' },
                { label: '', url: 'https://example.com/sin-etiqueta' },
            ],
        }));
        assert.equal(config.sections.gifts.links.length, 1);
        assert.equal(config.sections.gifts.links[0].label, 'bueno');
    });

    test('every external link opens safely', () => {
        const { node } = renderDemo();
        const links = node.querySelectorAll('a').filter((a) => (a.getAttribute('href') || '').startsWith('https://'));
        assert.ok(links.length > 0, 'the demo rendered no external links');
        for (const a of links) {
            assert.equal(a.getAttribute('target'), '_blank');
            assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
            assert.match(a.textContent, /se abre en una pestaña nueva/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9 · Unsafe image references fail closed
// ─────────────────────────────────────────────────────────────────────────────
describe('9 · image references fail closed', () => {
    const ASSET_BASE = 'https://cosioyair.github.io/vyvent-legal/invitation/assets/';

    test('a tagged demo reference resolves under the bundled asset directory', () => {
        const url = resolveImage({ source: 'demo', path: 'wedding-romantic/hero.svg' }, { assetBase: ASSET_BASE });
        assert.equal(url, ASSET_BASE + 'demo/wedding-romantic/hero.svg');
    });

    const REJECTED = [
        'a bare string',
        { path: 'wedding-romantic/hero.svg' },                              // no source
        { source: 'http', path: 'x.svg' },
        { source: 'demo', path: '../../../env.js' },
        { source: 'demo', path: '/etc/passwd.png' },
        { source: 'demo', path: '//evil.example/x.png' },
        { source: 'demo', path: 'https://evil.example/x.png' },
        { source: 'demo', path: 'javascript:alert(1)' },
        { source: 'demo', path: 'wedding-romantic/hero.svg"' },
        { source: 'demo', path: 'wedding-romantic/hero.svg onerror=alert(1)' },
        { source: 'demo', path: 'wedding-romantic/hero.exe' },
        { source: 'demo', path: 'wedding-romantic/./hero.svg' },
        { source: 'demo', path: '' },
        { source: 'demo' },
        null,
        undefined,
        42,
    ];

    for (const ref of REJECTED) {
        test(`rejects ${JSON.stringify(ref)}`, () => {
            assert.equal(resolveImage(ref, { assetBase: ASSET_BASE }), null);
        });
    }

    test('a storage reference fails closed until Milestone B supplies a resolver', () => {
        const ref = { source: 'storage', bucket: 'event-photos', path: 'uid/photo.jpg' };
        assert.equal(resolveImage(ref, { assetBase: ASSET_BASE }), null);
        // Shape is still validated now, so the contract is fixed before anything writes it.
        assert.equal(resolveImage({ ...ref, bucket: '../evil' }, { assetBase: ASSET_BASE, storageUrl: () => 'x' }), null);
        assert.equal(resolveImage(ref, { assetBase: ASSET_BASE, storageUrl: () => 'https://ok.test/x.jpg' }), 'https://ok.test/x.jpg');
    });

    test('a gallery item with an unusable image is dropped', () => {
        const { config } = normalizeConfig(withSection('gallery', {
            enabled: true,
            items: [
                { image: { source: 'demo', path: 'wedding-romantic/story-01.svg' }, alt: 'ok' },
                { image: { source: 'demo', path: '../../secret.png' }, alt: 'malo' },
                { image: 'bare string' },
            ],
        }));
        assert.equal(config.sections.gallery.items.length, 1);
        assert.equal(config.sections.gallery.items[0].alt, 'ok');
    });

    test('safeAssetPath rejects traversal, schemes and dangerous characters directly', () => {
        assert.equal(safeAssetPath('wedding-romantic/hero.svg'), 'wedding-romantic/hero.svg');
        for (const p of ['../x.png', 'a//b.png', '/a.png', 'https://x/a.png', 'a b.png', 'a`.png', 'a.txt', '']) {
            assert.equal(safeAssetPath(p), null, 'accepted ' + JSON.stringify(p));
        }
    });

    test('every image the demo renders points at a bundled asset', () => {
        const { node } = renderDemo();
        const imgs = node.querySelectorAll('img');
        assert.ok(imgs.length >= 7, 'expected the hero plus the gallery');
        for (const img of imgs) {
            assert.ok(img.getAttribute('src').startsWith(ASSET_BASE + 'demo/'),
                'image escaped the asset directory: ' + img.getAttribute('src'));
            // Reserved geometry: no layout shift when the bytes land.
            assert.ok(img.hasAttribute('width'));
            assert.ok(img.hasAttribute('height'));
        }
    });

    test('below-the-fold images are lazy; the hero is not', () => {
        const { node } = renderDemo();
        assert.equal(node.querySelector('.inv-hero__art').getAttribute('loading'), null);
        const gallery = node.querySelectorAll('.inv-gallery__img');
        assert.ok(gallery.length > 0);
        for (const img of gallery) {
            assert.equal(img.getAttribute('loading'), 'lazy');
            assert.equal(img.getAttribute('decoding'), 'async');
        }
    });

    test('every bundled demo asset the configuration names actually exists', () => {
        const raw = demoConfig(DEMO_ID);
        const refs = [raw.sections.hero.image, ...raw.sections.gallery.items.map((i) => i.image)];
        for (const ref of refs) {
            const abs = join(INVITATION, 'assets', 'demo', ...ref.path.split('/'));
            assert.ok(statSync(abs).isFile(), 'missing bundled asset: ' + ref.path);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10 + 11 · Collection limits
// ─────────────────────────────────────────────────────────────────────────────
describe('10 + 11 · collection limits are enforced', () => {
    test('10 · the gallery is capped at LIMITS.GALLERY_ITEMS', () => {
        const items = Array.from({ length: 40 }, (_, i) => ({
            image: { source: 'demo', path: 'wedding-romantic/story-01.svg' },
            alt: 'imagen ' + i,
        }));
        const { config } = normalizeConfig(withSection('gallery', { enabled: true, items }));
        assert.equal(config.sections.gallery.items.length, LIMITS.GALLERY_ITEMS);
        // The cap holds all the way to the DOM.
        const { node } = renderDemo({ raw: withSection('gallery', { enabled: true, items }) });
        assert.equal(node.querySelectorAll('.inv-gallery__item').length, LIMITS.GALLERY_ITEMS);
    });

    test('11 · gift links are capped at LIMITS.GIFT_LINKS', () => {
        const links = Array.from({ length: 25 }, (_, i) => ({
            label: 'Mesa ' + i,
            url: 'https://example.com/mesa/' + i,
        }));
        const { config } = normalizeConfig(withSection('gifts', { enabled: true, links }));
        assert.equal(config.sections.gifts.links.length, LIMITS.GIFT_LINKS);
        const { node } = renderDemo({ raw: withSection('gifts', { enabled: true, links }) });
        assert.equal(node.querySelectorAll('.inv-gifts__item').length, LIMITS.GIFT_LINKS);
    });

    test('dress-code guidelines are capped at LIMITS.DRESS_CODE_GUIDELINES', () => {
        const guidelines = Array.from({ length: 20 }, (_, i) => 'indicación ' + i);
        const { config } = normalizeConfig(withSection('dressCode', {
            enabled: true, title: 'Formal', guidelines,
        }));
        assert.equal(config.sections.dressCode.guidelines.length, LIMITS.DRESS_CODE_GUIDELINES);
        assert.equal(LIMITS.DRESS_CODE_GUIDELINES, 4);

        const { node } = renderDemo({
            raw: withSection('dressCode', { enabled: true, title: 'Formal', guidelines }),
        });
        assert.equal(node.querySelectorAll('.inv-dress__guideline').length, LIMITS.DRESS_CODE_GUIDELINES);
    });

    test('the accepted v1 limits are the ones actually enforced', () => {
        assert.equal(LIMITS.GALLERY_ITEMS, 12);
        assert.equal(LIMITS.GIFT_LINKS, 6);
        assert.equal(LIMITS.DRESS_CODE_GUIDELINES, 4);
    });

    test('a fully populated configuration stays far below the 64 KB ceiling', () => {
        const bytes = Buffer.byteLength(JSON.stringify(demoConfig(DEMO_ID)), 'utf8');
        assert.ok(bytes < 64 * 1024, 'demo configuration is ' + bytes + ' bytes');
        assert.ok(bytes < 12 * 1024, 'demo configuration is unexpectedly large: ' + bytes);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12 · Countdown states
// ─────────────────────────────────────────────────────────────────────────────
describe('12 · countdown handles both states', () => {
    const TARGET = Date.parse('2027-04-17T17:00:00-06:00');

    test('future: whole units, no zeros, no negatives', () => {
        const parts = countdownParts(TARGET - (3 * 86400000 + 4 * 3600000 + 5 * 60000 + 6000), TARGET);
        assert.deepEqual(parts, { done: false, days: 3, hours: 4, minutes: 5, seconds: 6, remainingMs: 273906000 });
        assert.match(countdownLabel(parts), /^Faltan 3 días, 4 horas, 5 minutos\.$/);
    });

    test('singular units read correctly', () => {
        const parts = countdownParts(TARGET - (86400000 + 3600000 + 60000), TARGET);
        assert.equal(countdownLabel(parts), 'Faltan 1 día, 1 hora, 1 minuto.');
    });

    test('completed: never a negative or frozen counter', () => {
        for (const offset of [0, 1000, 86400000 * 400]) {
            const parts = countdownParts(TARGET + offset, TARGET);
            assert.equal(parts.done, true);
            assert.equal(parts.days, 0);
            assert.equal(parts.remainingMs, 0);
            assert.equal(countdownLabel(parts, '¡Hoy nos casamos!'), '¡Hoy nos casamos!');
        }
    });

    test('unusable instants yield null, so the section is skipped rather than zeroed', () => {
        assert.equal(countdownParts(NaN, TARGET), null);
        assert.equal(countdownParts(0, NaN), null);
        assert.equal(countdownParts(undefined, TARGET), null);
    });

    test('the rendered counter is announced in words, not as bare digits', () => {
        const { node } = renderDemo({ now: TARGET - 86400000 * 30 });
        const list = node.querySelector('.inv-countdown');
        assert.equal(list.getAttribute('aria-hidden'), 'true');
        assert.equal(list.hasAttribute('hidden'), false);

        const status = node.querySelectorAll('[role="status"]').find((n) => /Faltan/.test(n.textContent));
        assert.ok(status, 'no spoken countdown summary');
        assert.equal(status.getAttribute('aria-live'), 'polite');

        // Each unit carries its own visible text label — meaning never depends
        // on layout, colour or motion.
        const labels = node.querySelectorAll('.inv-countdown__label').map((n) => n.textContent);
        assert.deepEqual(labels, ['días', 'horas', 'minutos', 'segundos']);
    });

    test('after the date, the counter hides and the completed message shows', () => {
        const { node } = renderDemo({ now: TARGET + 86400000 });
        assert.equal(node.querySelector('.inv-countdown').hasAttribute('hidden'), true);
        const done = node.querySelector('.inv-countdown__done');
        assert.equal(done.hasAttribute('hidden'), false);
        assert.equal(done.textContent, '¡Hoy nos casamos!');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13 + 14 · Both deployment roots
// ─────────────────────────────────────────────────────────────────────────────
describe('13 + 14 · the same bytes work under both deployment roots', () => {
    test('13 · DEV project path', () => {
        const bases = moduleBases(DEV_MODULE_URL);
        assert.equal(bases.root, 'https://cosioyair.github.io/vyvent-legal/invitation/');
        assert.equal(bases.assets, 'https://cosioyair.github.io/vyvent-legal/invitation/assets/');
        assert.equal(bases.templates, 'https://cosioyair.github.io/vyvent-legal/invitation/templates/');
        assert.equal(
            templateResourceUrl(bases.templates, resolveTemplate(DEMO_ID).stylesheet),
            'https://cosioyair.github.io/vyvent-legal/invitation/templates/wedding-romantic/template.css',
        );
        assert.equal(
            resolveImage({ source: 'demo', path: 'wedding-romantic/hero.svg' }, { assetBase: bases.assets }),
            'https://cosioyair.github.io/vyvent-legal/invitation/assets/demo/wedding-romantic/hero.svg',
        );
    });

    test('14 · production root', () => {
        const bases = moduleBases(PROD_MODULE_URL);
        assert.equal(bases.root, 'https://orbiventt.com/invitation/');
        assert.equal(bases.assets, 'https://orbiventt.com/invitation/assets/');
        assert.equal(
            templateResourceUrl(bases.templates, resolveTemplate(DEMO_ID).stylesheet),
            'https://orbiventt.com/invitation/templates/wedding-romantic/template.css',
        );
        assert.equal(
            resolveImage({ source: 'demo', path: 'wedding-romantic/hero.svg' }, { assetBase: bases.assets }),
            'https://orbiventt.com/invitation/assets/demo/wedding-romantic/hero.svg',
        );
    });

    test('no deployment-specific string appears in the module tree', () => {
        for (const { rel, source } of moduleSources()) {
            const code = codeOnly(source);
            for (const needle of ['github.io', 'vyvent-legal', 'orbiventt.com', '/invitation/']) {
                assert.ok(!code.includes(needle), `${rel} hard-codes ${needle}`);
            }
        }
    });

    test('a template resource path cannot escape the templates directory', () => {
        const base = 'https://orbiventt.com/invitation/templates/';
        for (const p of ['../../env.js', '/etc/x.css', 'https://evil.example/x.css', 'a//b.css', 'x.js', '', null]) {
            assert.equal(templateResourceUrl(base, p), null, 'accepted ' + JSON.stringify(p));
        }
    });

    test('the page resolves its own relative URLs through the single <base> tag', () => {
        assert.ok(INDEX_HTML.includes('<base href="/vyvent-legal/">'));
        assert.ok(INDEX_HTML.includes('src="invitation/js/main.js"'));
        assert.ok(INDEX_HTML.includes('href="invitation/css/base.css"'));
        assert.ok(INDEX_HTML.includes('<script src="env.js"></script>'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15 · Generic Open Graph metadata
// ─────────────────────────────────────────────────────────────────────────────
describe('15 · the link preview is category-neutral', () => {
    const TITLE = 'Invitación digital · Orbiventt';
    const DESCRIPTION = 'Abre esta invitación para conocer los detalles del evento y reclamar tus pases en Orbiventt.';

    test('the approved title and description are present', () => {
        assert.ok(INDEX_HTML.includes('<title>' + TITLE + '</title>'));
        assert.ok(INDEX_HTML.includes('content="' + TITLE + '"'));
        assert.ok(INDEX_HTML.includes('content="' + DESCRIPTION + '"'));
        for (const property of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name']) {
            assert.ok(INDEX_HTML.includes('property="' + property + '"'), 'missing ' + property);
        }
        for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
            assert.ok(INDEX_HTML.includes('name="' + name + '"'), 'missing ' + name);
        }
    });

    test('nothing category-specific leaks into the metadata', () => {
        const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'));
        const meta = head.split('\n').filter((l) => /<meta|<title/.test(l)).join('\n').toLowerCase();
        for (const word of ['boda', 'wedding', 'novia', 'novio', 'anillo', 'valentina', 'mateo', 'romantic']) {
            assert.ok(!meta.includes(word), 'metadata mentions ' + word);
        }
    });

    test('the OG image is a raster of the right size and exists', () => {
        assert.ok(INDEX_HTML.includes('assets/og-invitation.jpg'));
        assert.ok(INDEX_HTML.includes('content="1200"'));
        assert.ok(INDEX_HTML.includes('content="630"'));
        const file = statSync(join(INVITATION, 'assets', 'og-invitation.jpg'));
        assert.ok(file.isFile());
        // WhatsApp starts skipping preview images around 300 KB.
        assert.ok(file.size < 300 * 1024, 'OG image is ' + file.size + ' bytes');
    });

    test('an invitation page is never indexed, in either environment', () => {
        assert.ok(/<meta name="robots" content="noindex, nofollow">/.test(INDEX_HTML));
        // Deliberately NOT the DEV-only block, which promotion strips.
        assert.ok(!INDEX_HTML.includes('ENV-SPECIFIC: DEV mirror only'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route contract
// ─────────────────────────────────────────────────────────────────────────────
describe('the route contract', () => {
    test('demo mode', () => {
        const r = parseRoute('?demo=wedding_romantic_v1');
        assert.equal(r.mode, MODE.DEMO);
        assert.equal(r.demoId, 'wedding_romantic_v1');
        assert.equal(r.code, null);
    });

    test('an unrecognized demo value stays in demo mode with no id', () => {
        for (const value of ['', 'nope', '../x', '<script>', 'a'.repeat(200)]) {
            const r = parseRoute('?demo=' + encodeURIComponent(value));
            assert.equal(r.mode, MODE.DEMO);
            assert.equal(r.demoId, null, 'accepted ' + JSON.stringify(value));
        }
    });

    test('the reserved routes are recognized but carry no data source', () => {
        const draft = parseRoute('?d=abc123&t=tok-en_1');
        assert.equal(draft.mode, MODE.DRAFT);
        assert.equal(draft.invitationId, 'abc123');
        assert.equal(draft.previewToken, 'tok-en_1');

        const published = parseRoute('?i=valentina-y-mateo');
        assert.equal(published.mode, MODE.PUBLISHED);
        assert.equal(published.slug, 'valentina-y-mateo');

        const claim = parseRoute('?i=valentina-y-mateo&code=ABCDEFGHIJKL');
        assert.equal(claim.mode, MODE.PUBLISHED);
        assert.equal(claim.code, 'ABCDEFGHIJKL');
    });

    test('hostile parameters are refused, never partially trusted', () => {
        assert.equal(parseRoute('?d=' + encodeURIComponent('../../etc')).mode, MODE.NONE);
        assert.equal(parseRoute('?i=' + encodeURIComponent('a b')).mode, MODE.NONE);
        assert.equal(parseRoute('?d=abc&t=' + encodeURIComponent('<script>')).previewToken, null);
        assert.equal(parseRoute('?demo=x_v1&code=' + encodeURIComponent('../evil')).code, null);
        assert.equal(parseRoute('').mode, MODE.NONE);
        assert.equal(parseRoute(null).mode, MODE.NONE);
        assert.equal(parseRoute(42).mode, MODE.NONE);
    });

    test('codes and tokens use the same rules as the rest of the site', () => {
        assert.equal(safeCode('ABCDEFGHIJKL'), 'ABCDEFGHIJKL');
        for (const c of ['', 'a b', '<script>', 'x'.repeat(40), '../x', null]) assert.equal(safeCode(c), null);
        assert.equal(safeToken('abc-123_x.y~z', 64), 'abc-123_x.y~z');
        for (const t of ['a/b', 'a b', '', 'x'.repeat(200), null]) assert.equal(safeToken(t, 64), null);
    });

    test('"Reclamar pases" appears only when a valid code is present', () => {
        const without = renderDemo();
        assert.ok(!without.rendered.includes('passes'));
        assert.ok(!sectionsOf(without.node).includes('passes'));

        const withCode = renderDemo({ route: parseRoute('?demo=' + DEMO_ID + '&code=ABCDEFGHIJKL') });
        assert.ok(withCode.rendered.includes('passes'));
        const node = withCode.node.querySelector('[data-section="passes"]');
        assert.match(node.textContent, /ABCDEFGHIJKL/);
        // It explains; it never claims.
        assert.match(node.textContent, /Demostración/);
        assert.equal(node.querySelectorAll('button').length, 0);

        // An invalid code shows nothing at all.
        const bogus = renderDemo({ route: parseRoute('?demo=' + DEMO_ID + '&code=' + encodeURIComponent('a b')) });
        assert.ok(!bogus.rendered.includes('passes'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Automatic actions
// ─────────────────────────────────────────────────────────────────────────────
describe('automatic actions', () => {
    test('the calendar payload is derived from the configuration', () => {
        const { config } = normalizeConfig(demoConfig(DEMO_ID));
        const event = calendarEventFromConfig(config);
        assert.equal(event.title, 'Boda de Valentina y Mateo');
        assert.equal(event.startMs, Date.parse('2027-04-17T17:00:00-06:00'));
        // The reception, not the ceremony, sets the end of the day.
        assert.equal(event.endMs, Date.parse('2027-04-17T19:30:00-06:00') + 5 * 3600000);
        assert.match(event.location, /Parroquia de la Santa Cruz/);
    });

    test('the .ics escapes every structural character', () => {
        assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
        const ics = buildIcs({
            uid: 'x', title: 'Boda; de, Valentina\nMateo', location: 'Calle 1, Centro',
            startMs: Date.parse('2027-04-17T23:00:00Z'), endMs: Date.parse('2027-04-18T06:00:00Z'),
            stampMs: Date.parse('2026-08-01T00:00:00Z'),
        });
        assert.ok(ics.includes('SUMMARY:Boda\\; de\\, Valentina\\nMateo'));
        assert.ok(ics.includes('DTSTART:20270417T230000Z'));
        assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
        assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
        // No content line exceeds the folding limit.
        for (const line of ics.split('\r\n')) assert.ok(line.length <= 75, 'unfolded line: ' + line);
    });

    test('unusable instants produce no calendar rather than a broken one', () => {
        assert.equal(buildIcs({ startMs: NaN, endMs: 1 }), null);
        assert.equal(buildIcs({}), null);
        assert.equal(calendarEventFromConfig(null), null);
        assert.equal(calendarEventFromConfig({ sections: {} }), null);
    });

    test('the download name is filesystem-safe', () => {
        assert.equal(icsFileName('Boda de Valentina y Mateo'), 'boda-de-valentina-y-mateo.ics');
        assert.equal(icsFileName('../../etc/passwd'), 'etc-passwd.ics');
        assert.equal(icsFileName(''), 'invitacion.ics');
    });

    test('the demo renders a calendar download and a share control', () => {
        const { node } = renderDemo();
        const download = node.querySelectorAll('a').find((a) => a.hasAttribute('download'));
        assert.ok(download, 'no calendar download');
        assert.ok(download.getAttribute('href').startsWith('data:text/calendar;charset=utf-8,'));
        assert.equal(download.getAttribute('download'), 'boda-de-valentina-y-mateo.ics');

        const buttons = node.querySelectorAll('button');
        assert.equal(buttons.length, 1);
        assert.equal(buttons[0].getAttribute('type'), 'button');
    });

    test('an action switched off in the configuration is absent', () => {
        const raw = demoConfig(DEMO_ID);
        raw.actions = { calendar: false, share: false, map: false };
        const { node, rendered } = renderDemo({ raw });
        assert.ok(!rendered.includes('actions'));
        assert.equal(node.querySelectorAll('button').length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility + document semantics
// ─────────────────────────────────────────────────────────────────────────────
describe('document semantics', () => {
    test('every section is labelled by its own heading', () => {
        const { node } = renderDemo();
        for (const section of node.querySelectorAll('section')) {
            const labelledby = section.getAttribute('aria-labelledby');
            if (!labelledby) continue;                       // the actions block has no heading
            const heading = node.querySelector('[id="' + labelledby + '"]');
            assert.ok(heading, 'aria-labelledby points at nothing: ' + labelledby);
            assert.ok(heading.textContent.length > 0);
        }
    });

    test('heading ids are unique', () => {
        const { node } = renderDemo();
        const ids = node.querySelectorAll('[id]').map((n) => n.getAttribute('id'));
        assert.equal(new Set(ids).size, ids.length, 'duplicate id: ' + ids.join(', '));
    });

    test('the heading level below the <h1> is <h2> throughout', () => {
        const { node } = renderDemo();
        assert.equal(node.querySelectorAll('h1').length, 1);
        assert.ok(node.querySelectorAll('h2').length >= 5);
        for (const tag of ['h3', 'h4', 'h5', 'h6']) {
            assert.equal(node.querySelectorAll(tag).length, 0, 'unexpected ' + tag);
        }
    });

    test('every image carries an alt attribute; decorative ones are hidden', () => {
        const { node } = renderDemo();
        for (const img of node.querySelectorAll('img')) {
            assert.ok(img.hasAttribute('alt'), 'image without alt: ' + img.getAttribute('src'));
            if (img.getAttribute('alt') === '') {
                assert.equal(img.getAttribute('aria-hidden'), 'true');
            }
        }
    });

    test('dates carry a machine-readable instant', () => {
        const { node } = renderDemo();
        const times = node.querySelectorAll('time');
        assert.ok(times.length >= 3);
        for (const t of times) {
            assert.ok(parseInstant(t.getAttribute('datetime')), 'unparseable datetime');
        }
    });

    test('the shell exposes the elements main.js drives', () => {
        for (const id of ['invitation-loading', 'invitation-root', 'invitation-state',
            'invitation-state-title', 'invitation-state-body', 'envBadge']) {
            assert.ok(INDEX_HTML.includes('id="' + id + '"'), 'missing #' + id);
        }
        assert.ok(INDEX_HTML.includes('<noscript>'));
    });

    test('the section table and the descriptor agree on what exists', () => {
        const ids = sectionIds();
        for (const id of [...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS, 'passes', 'actions']) {
            assert.ok(ids.includes(id), 'no renderer for ' + id);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source hygiene
// ─────────────────────────────────────────────────────────────────────────────
describe('source hygiene', () => {
    test('no stray control byte survived authoring', () => {
        // A literal control character inside a regex or string is invisible in a
        // diff, makes the file binary to `grep`, and silently changes behaviour.
        // The test files are scanned too: this suite is where that bug actually
        // happened — a raw NUL typed into a control-character assertion — so
        // covering only the shipped module tree would have missed it.
        const scanned = [
            ...moduleSources(),
            ...['invitation.test.mjs', 'dom-stub.mjs', 'app-return.test.mjs'].map((name) => ({
                rel: 'scripts/__tests__/' + name,
                source: readFileSync(join(ROOT, 'scripts', '__tests__', name), 'utf8'),
            })),
        ];
        for (const { rel, source } of scanned) {
            const bad = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.exec(source);
            assert.equal(bad, null, `${rel} contains a control byte at index ${bad && bad.index}`);
        }
    });

    test('no secret-looking value is present', () => {
        for (const { rel, source } of moduleSources()) {
            assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(source), `${rel} looks like it carries a JWT`);
            assert.ok(!/service_role/.test(source), `${rel} mentions service_role`);
        }
        assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(INDEX_HTML));
    });
});
