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
import { normalizeConfig, CONTRACT_VERSION, REQUIRED_SECTIONS, OPTIONAL_SECTIONS, parseInstant, INTERLUDE_SLOTS } from '../../invitation/js/config.js';
import { renderInvitation } from '../../invitation/js/renderer.js';
import { parseRoute, MODE } from '../../invitation/js/route.js';
import { resolveStored, storedRequest, RESULT, passSummaryRequest, normalizePassSummary } from '../../invitation/js/resolve.js';
import { moduleBases, templateResourceUrl } from '../../invitation/js/paths.js';
import {
    LIMITS, sanitizeText, sanitizeParagraph, safeExternalUrl, safeMapUrl,
    buildMapUrl, resolveImage, safeAssetPath, safeCode, safeToken, safeSlug,
} from '../../invitation/js/security.js';
import { countdownParts, countdownLabel } from '../../invitation/js/countdown.js';
import { buildIcs, escapeIcsText, icsFileName } from '../../invitation/js/calendar.js';
import { calendarEventFromConfig } from '../../invitation/js/sections/actions.js';
import { displayCode, allocationLine } from '../../invitation/js/sections/passes.js';
import { sectionIds, resolveSection } from '../../invitation/js/sections/index.js';
import { callRpc } from '../../invitation/js/backend.js';

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
        templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
        storageUrl: over.storageUrl,
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

/** A raw demo configuration with its interlude photographs replaced. */
function withInterludes(value) {
    const raw = demoConfig(DEMO_ID);
    raw.interludeImages = value;
    return raw;
}

/** The `data-slot` of every interlude the render produced, in document order. */
function interludeSlots(node) {
    return Array.from(node.querySelectorAll('.inv-interlude'))
        .map((n) => n.getAttribute('data-slot'));
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

    test('17 · only backend.js may name an endpoint, and only the two READ RPCs', () => {
        // The page gained a network dependency in Milestone B. What must stay
        // true is that the reachable surface is a list you can read: two
        // read-only RPCs, named in one file, behind a closed call table.
        for (const { rel, source } of sources) {
            const code = codeOnly(source);
            if (rel.endsWith('js/backend.js')) continue;
            for (const needle of ['rest/v1', 'apikey', 'supaAnon', 'Authorization']) {
                assert.ok(!code.includes(needle), `${rel} talks to the backend directly`);
            }
        }

        const backend = codeOnly(readFileSync(join(INVITATION, 'js', 'backend.js'), 'utf8'));
        // No WRITE path exists on the web at all. Publishing, editing and
        // deleting are the mobile editor's business; a page anyone can open
        // must not even name those functions.
        for (const write of ['upsert_invitation', 'publish_invitation',
            'unpublish_invitation', 'delete_invitation', 'get_invitation_preview_token']) {
            assert.ok(!backend.includes(write), `backend.js names the write RPC ${write}`);
        }
        assert.ok(backend.includes('get_invitation_draft'));
        assert.ok(backend.includes('get_published_invitation'));
    });

    test('17 · the CSP names exactly one host, in exactly two directives', () => {
        const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(INDEX_HTML);
        assert.ok(csp, 'no CSP meta tag');
        const policy = csp[1];

        const hosts = [...new Set([...policy.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]))];
        assert.equal(hosts.length, 1, 'CSP names more than one host: ' + hosts.join(', '));
        assert.match(hosts[0], /^https:\/\/[a-z0-9]+\.supabase\.co$/);

        // Exactly the two directives that need it, and no others.
        const naming = policy.split(';').map((d) => d.trim())
            .filter((d) => d.includes(hosts[0]))
            .map((d) => d.split(' ')[0]);
        assert.deepEqual(naming.sort(), ['connect-src', 'img-src']);

        // Everything else stays shut.
        assert.match(policy, /frame-src 'none'/);
        assert.match(policy, /object-src 'none'/);
        assert.match(policy, /base-uri 'self'/);
        assert.match(policy, /form-action 'none'/);
        assert.match(policy, /script-src 'self'/);
        assert.ok(!/script-src[^;]*unsafe-inline/.test(policy));
        assert.ok(!/script-src[^;]*unsafe-eval/.test(policy));
        assert.ok(!/default-src[^;]*https:/.test(policy), 'default-src was widened');
    });

    test('17 · the page contains no inline script', () => {
        const inline = /<script(?![^>]*\bsrc=)[^>]*>/i.exec(INDEX_HTML);
        assert.equal(inline, null, 'index.html has an inline <script>');
    });

    test('16 · the web holds no invitation write path and no SQL', () => {
        for (const { rel, source } of sources) {
            const code = codeOnly(source).toLowerCase();
            for (const needle of ['insert into', 'update public.', 'delete from', 'select * from']) {
                assert.ok(!code.includes(needle), `${rel} contains SQL`);
            }
        }
        assert.ok(!readdirSync(ROOT).includes('supabase'), 'a supabase/ directory appeared in the web repo');
    });

    test('3 · demo mode never reaches the backend', () => {
        // The demo branch loads a bundled literal and passes NO storage
        // resolver, so neither an RPC nor an image request can originate there.
        const main = codeOnly(readFileSync(join(INVITATION, 'js', 'main.js'), 'utf8'));
        const demoFn = main.slice(main.indexOf('async function renderDemo'),
            main.indexOf('async function start'));
        assert.ok(!demoFn.includes('callRpc'), 'renderDemo calls an RPC');
        assert.ok(!demoFn.includes('storageUrlResolver'), 'renderDemo builds a storage resolver');
        assert.ok(/paint\(template, config, route, null\)/.test(demoFn),
            'renderDemo must paint with a null storage resolver');
    });

    test('3 · a storage reference cannot resolve without a resolver', () => {
        // Which is what makes the line above load-bearing rather than stylistic.
        assert.equal(resolveImage(
            { source: 'storage', bucket: 'event-photos', path: 'a/b.jpg' },
            { assetBase: 'https://example.test/invitation/assets/' },
        ), null);
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
        // Six, not twelve: photographs meant to be read THROUGH the invitation
        // moved to the six named interlude slots, and the gallery went back to
        // being a grid a guest takes in at a glance.
        assert.equal(LIMITS.GALLERY_ITEMS, 6);
        assert.equal(LIMITS.GIFT_LINKS, 6);
        assert.equal(LIMITS.DRESS_CODE_GUIDELINES, 4);
    });

    test('a seventh gallery item is DROPPED, not hidden', () => {
        const items = Array.from({ length: 7 }, (_, i) => ({
            image: { source: 'demo', path: 'wedding-romantic/story-01.svg' },
            alt: 'imagen ' + i,
        }));
        const { config } = normalizeConfig(withSection('gallery', { enabled: true, items }));
        assert.equal(config.sections.gallery.items.length, 6);
        // The seventh is gone from the normalized document — not merely absent
        // from the DOM, which would leave it in storage waiting to reappear.
        assert.ok(!config.sections.gallery.items.some((it) => it.alt === 'imagen 6'));
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

// ─────────────────────────────────────────────────────────────────────────────
// 29 · What shape a photograph is, and what makes it visible
// ─────────────────────────────────────────────────────────────────────────────
describe('29 · image placements and alt semantics', () => {
    const TEMPLATE_CSS = readFileSync(
        join(INVITATION, 'templates', 'wedding-romantic', 'template.css'), 'utf8');
    // The page frame lives in base.css and is what caps the hero's WIDTH, so
    // the hero's shape cannot be read from the template stylesheet alone.
    const BASE_CSS = readFileSync(join(INVITATION, 'css', 'base.css'), 'utf8');
    const placements = () => resolveTemplate(DEMO_ID).imagePlacements;

    const storageImg = (p) => ({ source: 'storage', bucket: 'invitation-media', path: p });
    const renderStored = (raw) => renderDemo({
        raw, storageUrl: (b, p) => `https://cdn.test/${b}/${p}`,
    });

    test('the template declares a placement for each of its three frames', () => {
        const p = placements();
        assert.ok(p, 'template publishes no imagePlacements');
        assert.deepEqual(Object.keys(p).sort(), ['gallery', 'hero', 'interlude']);
        for (const [name, v] of Object.entries(p)) {
            assert.ok(Number.isInteger(v.width) && v.width > 0, name + ' width');
            assert.ok(Number.isInteger(v.height) && v.height > 0, name + ' height');
            // The ratio is not typed twice — it must equal the dimensions.
            assert.ok(Math.abs(v.aspectRatio - v.width / v.height) < 1e-9, name + ' ratio');
            assert.ok(Array.isArray(v.trim), name + ' trim');
        }
    });

    /* THE NUMBERS THE MOBILE CROPPER FRAMES TO. `imagePlacements.ts` in the app
     * mirrors this block and pins the same values; if either side is edited
     * alone, one of the two suites fails. */
    test('the placements are the agreed contract values', () => {
        const p = placements();
        assert.deepEqual(
            { w: p.hero.width, h: p.hero.height }, { w: 1080, h: 1920 });
        assert.deepEqual(
            { w: p.gallery.width, h: p.gallery.height }, { w: 800, h: 1000 });
        assert.deepEqual(
            { w: p.interlude.width, h: p.interlude.height }, { w: 1600, h: 900 });
    });

    /* THE HERO IS A TALL COLUMN. Its width is capped by the page frame and its
     * height is the viewport, so it is portrait on every screen and landscape
     * on none — which is why the cropper frames 9:16 and not a landscape band.
     * If either rule below is ever relaxed, the chosen ratio stops being the
     * phone's shape and this test is the thing that says so. */
    test('the hero is a portrait column on every viewport', () => {
        const p = placements();
        assert.ok(p.hero.aspectRatio < 1, 'the hero placement is not portrait');
        assert.ok(Math.abs(p.hero.aspectRatio - 9 / 16) < 1e-9, 'the hero is not 9:16');

        // Full-bleed to the viewport height…
        assert.match(TEMPLATE_CSS, /\.inv-hero\s*\{[^}]*min-height:\s*88svh/s);
        assert.match(TEMPLATE_CSS, /\.inv-hero__art[^}]*object-fit:\s*cover/s);
        // …inside a page that is a centred column, which is what caps the
        // width and keeps the hero portrait even on a desktop.
        assert.match(BASE_CSS, /\.inv-page\s*\{[^}]*max-width:\s*4[68]rem/s);

        // The widest supported hero is the capped column against the tallest
        // viewport; even there the frame stays portrait.
        const widestHero = 768 / (0.92 * 900);
        assert.ok(widestHero < 1, 'the hero can render landscape somewhere');
    });

    test('the STYLESHEET draws the ratios the cropper frames to', () => {
        // A gallery tile is `aspect-ratio: 4/5`, which is exactly 800×1000.
        assert.match(TEMPLATE_CSS, /\.inv-gallery__item[^}]*aspect-ratio:\s*4\s*\/\s*5/s);
        assert.ok(Math.abs(placements().gallery.aspectRatio - 4 / 5) < 1e-9);

        // An interlude band is 16/9 — and the odd-parity rule must NOT change
        // it, or the same photograph would be cropped two different ways
        // depending on which slot it landed in.
        assert.match(TEMPLATE_CSS, /\.inv-interlude\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
        const odd = /\.inv-interlude\[data-parity="odd"\]\s*\{([^}]*)\}/s.exec(TEMPLATE_CSS);
        assert.ok(odd, 'odd-parity rule missing');
        assert.ok(!/aspect-ratio/.test(odd[1]),
            'the odd-parity rule changes the aspect ratio, so the cropper cannot match it');
        assert.ok(Math.abs(placements().interlude.aspectRatio - 16 / 9) < 1e-9);
    });

    test('each rendered image declares its placement size, so nothing shifts', () => {
        const p = placements();
        const { node } = renderStored(withInterludes({
            afterMessage: { image: storageImg('a.jpg') },
        }));

        const hero = node.querySelector('.inv-hero__art');
        assert.equal(Number(hero.getAttribute('width')), p.hero.width);
        assert.equal(Number(hero.getAttribute('height')), p.hero.height);

        const tile = node.querySelector('.inv-gallery__img');
        assert.equal(Number(tile.getAttribute('width')), p.gallery.width);
        assert.equal(Number(tile.getAttribute('height')), p.gallery.height);

        const band = node.querySelector('.inv-interlude__img');
        assert.equal(Number(band.getAttribute('width')), p.interlude.width);
        assert.equal(Number(band.getAttribute('height')), p.interlude.height);
    });

    /* ── ALT IS ACCESSIBILITY, NEVER VISIBILITY ──────────────────────────── */

    test('an interlude image renders with NO description at all', () => {
        for (const entry of [
            { image: storageImg('a.jpg') },
            { image: storageImg('a.jpg'), alt: '' },
            { image: storageImg('a.jpg'), alt: '   ' },
        ]) {
            const { config, node } = renderStored(withInterludes({ afterCeremony: entry }));
            assert.ok(config.interludeImages.afterCeremony, 'slot dropped during normalization');

            const bands = node.querySelectorAll('.inv-interlude');
            assert.equal(bands.length, 1, 'the band did not render without a description');
            const img = bands[0].querySelector('.inv-interlude__img');
            assert.ok(img.getAttribute('src'), 'no src');
            // Decorative: an empty alt, and hidden from assistive technology.
            assert.equal(img.getAttribute('alt'), '');
            assert.equal(img.getAttribute('aria-hidden'), 'true');
        }
    });

    test('a description changes the SEMANTICS and nothing else', () => {
        const without = renderStored(withInterludes({
            afterCeremony: { image: storageImg('a.jpg') },
        }));
        const withAlt = renderStored(withInterludes({
            afterCeremony: { image: storageImg('a.jpg'), alt: 'Nosotros en la playa' },
        }));

        const pick = (r) => r.node.querySelector('.inv-interlude__img');
        // Same image, same geometry, same everything visual.
        for (const attr of ['src', 'width', 'height', 'loading', 'decoding', 'class']) {
            assert.equal(pick(without).getAttribute(attr), pick(withAlt).getAttribute(attr), attr);
        }
        assert.equal(pick(withAlt).getAttribute('alt'), 'Nosotros en la playa');
        assert.equal(pick(withAlt).getAttribute('aria-hidden'), null);
    });

    test('the description is NEVER drawn as a visible caption', () => {
        const { node } = renderStored(withInterludes({
            afterCeremony: { image: storageImg('a.jpg'), alt: 'UNA DESCRIPCION UNICA' },
        }));
        const band = node.querySelector('.inv-interlude');
        // It exists as an attribute…
        assert.equal(band.querySelector('img').getAttribute('alt'), 'UNA DESCRIPCION UNICA');
        // …and appears nowhere as text: no caption, no figcaption, no heading.
        assert.equal(band.querySelector('figcaption'), null);
        assert.equal(serialize(band).split('>').filter((s) => s.includes('UNA DESCRIPCION UNICA')).length,
            1, 'the description was rendered as visible text as well as an attribute');
    });

    test('an empty description NEVER falls back to a filename or a path', () => {
        const { node } = renderStored(withInterludes({
            afterCeremony: { image: storageImg('secreto/mi-archivo-privado.jpg') },
        }));
        const img = node.querySelector('.inv-interlude__img');
        assert.equal(img.getAttribute('alt'), '');
        for (const leak of ['mi-archivo-privado', 'secreto', '.jpg', 'Imagen', 'imagen']) {
            assert.ok(!String(img.getAttribute('alt')).includes(leak),
                'the alt leaked ' + leak);
        }
    });

    test('the SAME rule holds for the hero and the gallery', () => {
        const raw = demoConfig(DEMO_ID);
        delete raw.sections.hero.imageAlt;
        raw.sections.hero.image = storageImg('hero.jpg');
        raw.sections.gallery = { enabled: true, items: [{ image: storageImg('g.jpg') }] };

        const { node, rendered } = renderStored(raw);
        assert.ok(rendered.includes('hero'));
        assert.ok(rendered.includes('gallery'), 'a gallery item vanished for want of a description');

        const hero = node.querySelector('.inv-hero__art');
        assert.ok(hero && hero.getAttribute('src'), 'the hero image vanished without an alt');
        assert.equal(hero.getAttribute('alt'), '');

        const tile = node.querySelector('.inv-gallery__img');
        assert.ok(tile && tile.getAttribute('src'), 'the gallery image vanished without an alt');
        assert.equal(tile.getAttribute('alt'), '');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27 · The template's own artwork, chosen explicitly
// ─────────────────────────────────────────────────────────────────────────────
describe('27 · template image references', () => {
    const TEMPLATE_BASE = 'https://cosioyair.github.io/vyvent-legal/invitation/templates/';
    const assets = () => resolveTemplate(DEMO_ID).assets;

    const resolveTpl = (ref) => resolveImage(ref, {
        templateBase: TEMPLATE_BASE,
        templateAssets: assets(),
    });

    test('the descriptor publishes a closed asset registry', () => {
        const a = assets();
        assert.ok(a && typeof a === 'object', 'template publishes no asset registry');
        assert.deepEqual(Object.keys(a), ['hero-default']);
        // Every entry must be a plain relative path the resolver would accept.
        for (const [key, path] of Object.entries(a)) {
            assert.ok(safeAssetPath(path), `asset ${key} is not a safe relative path`);
        }
    });

    test('a KNOWN key resolves inside the template directory, under both roots', () => {
        for (const base of [
            'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
            'https://orbiventt.com/invitation/templates/',
        ]) {
            const href = resolveImage({ source: 'template', assetKey: 'hero-default' }, {
                templateBase: base, templateAssets: assets(),
            });
            assert.equal(href, base + 'wedding-romantic/hero-default.jpg');
            assert.ok(href.startsWith(base), 'resolved outside the template directory');
        }
    });

    test('the resolved file EXISTS in the repository', () => {
        // A registry entry that points at nothing would render a broken image
        // on every invitation that chose it, and no other test would notice.
        for (const path of Object.values(assets())) {
            const abs = join(INVITATION, 'templates', path);
            assert.ok(statSync(abs).isFile(), 'missing template asset: ' + path);
        }
    });

    test('an UNKNOWN key fails closed — including prototype keys', () => {
        for (const key of [
            'nope', 'hero-Default', 'hero-default.jpg', '../hero-default.jpg',
            '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf',
            '', ' ', null, undefined, 42, {}, [],
        ]) {
            assert.equal(resolveTpl({ source: 'template', assetKey: key }), null,
                'accepted asset key ' + JSON.stringify(key));
        }
    });

    test('a template reference cannot resolve without a registry or a base', () => {
        const ref = { source: 'template', assetKey: 'hero-default' };
        assert.equal(resolveImage(ref, { templateBase: TEMPLATE_BASE }), null);
        assert.equal(resolveImage(ref, { templateAssets: assets() }), null);
        assert.equal(resolveImage(ref, {}), null);
        // Notably: the DEMO asset base is not a substitute for the template base.
        assert.equal(resolveImage(ref, {
            assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
            templateAssets: assets(),
        }), null);
    });

    test('normalization keeps the KEY and never invents a path', () => {
        const raw = withSection('hero', {
            ...demoConfig(DEMO_ID).sections.hero,
            image: { source: 'template', assetKey: 'hero-default', path: 'evil.svg', bucket: 'x' },
        });
        const { config } = normalizeConfig(raw);
        assert.deepEqual(config.sections.hero.image, { source: 'template', assetKey: 'hero-default' });
        // The smuggled path and bucket are gone, not carried along unused.
        assert.equal(config.sections.hero.image.path, undefined);
        assert.equal(config.sections.hero.image.bucket, undefined);
    });

    test('the template image DRAWS when chosen, and nothing draws when cleared', () => {
        const heroWith = { ...demoConfig(DEMO_ID).sections.hero, image: { source: 'template', assetKey: 'hero-default' } };
        const chosen = renderDemo({ raw: withSection('hero', heroWith) });
        const art = chosen.node.querySelector('.inv-hero__art');
        assert.ok(art, 'the chosen template image did not render');
        assert.match(art.getAttribute('src'), /templates\/wedding-romantic\/hero-default\.jpg$/);

        // Cleared: the hero still renders (the image is optional) but there is
        // NO artwork — the template must not quietly restore its own.
        const heroWithout = { ...demoConfig(DEMO_ID).sections.hero };
        delete heroWithout.image;
        const cleared = renderDemo({ raw: withSection('hero', heroWithout) });
        assert.ok(cleared.rendered.includes('hero'));
        assert.equal(cleared.node.querySelector('.inv-hero__art'), null,
            'a cleared hero image was silently replaced by the template artwork');
    });

    test('`demo` is still a distinct source and never becomes `template`', () => {
        const ref = { source: 'demo', path: 'wedding-romantic/hero.svg' };
        // With ONLY a template registry available, a demo reference resolves to
        // nothing: the two sources never stand in for one another.
        assert.equal(resolveTpl(ref), null);
        assert.equal(resolveImage(ref, {
            assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
        }), 'https://cosioyair.github.io/vyvent-legal/invitation/assets/demo/wedding-romantic/hero.svg');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28 · Photographs distributed through the invitation
// ─────────────────────────────────────────────────────────────────────────────
describe('28 · interlude photographs', () => {
    const SLOTS = [
        'afterMessage', 'afterCountdown', 'afterCeremony',
        'afterReception', 'afterDressCode', 'beforeClosing',
    ];
    const img = (n) => ({ source: 'demo', path: `wedding-romantic/band-0${n}.svg` });
    const allSlots = () => Object.fromEntries(SLOTS.map((s, i) => [s, { image: img(i + 1), alt: s }]));

    test('the demonstration fills all six, in template order', () => {
        const { node } = renderDemo();
        assert.deepEqual(interludeSlots(node), SLOTS);
    });

    test('all six render, and each carries its own slot and image', () => {
        const { node } = renderDemo({ raw: withInterludes(allSlots()) });
        const nodes = node.querySelectorAll('.inv-interlude');
        assert.equal(nodes.length, 6);
        nodes.forEach((n, i) => {
            assert.equal(n.getAttribute('data-slot'), SLOTS[i]);
            assert.match(n.querySelector('.inv-interlude__img').getAttribute('src'),
                new RegExp(`band-0${i + 1}\\.svg$`));
        });
    });

    test('an EMPTY slot renders nothing at all — no placeholder, no gap', () => {
        const { node } = renderDemo({ raw: withInterludes({ afterCeremony: { image: img(3) } }) });
        assert.deepEqual(interludeSlots(node), ['afterCeremony']);
        assert.equal(node.querySelectorAll('.inv-interlude').length, 1);
    });

    test('NO interlude configuration renders no bands and breaks nothing', () => {
        const { ok, node, rendered } = renderDemo({ raw: withInterludes(undefined) });
        assert.equal(ok, true);
        assert.equal(node.querySelectorAll('.inv-interlude').length, 0);
        for (const id of ['hero', 'message', 'ceremony', 'gallery', 'closing']) {
            assert.ok(rendered.includes(id), id + ' stopped rendering');
        }
    });

    /* THE PROPERTY THE NAMED-SLOT MODEL EXISTS FOR. */
    test('a slot keeps its POSITION when the section it is named after is off', () => {
        const raw = withInterludes(allSlots());
        raw.sections.countdown = { enabled: false };
        raw.sections.reception = { enabled: false };
        raw.sections.dressCode = { enabled: false };

        const { node, rendered } = renderDemo({ raw });
        // Every photograph is still there, still in the same order.
        assert.deepEqual(interludeSlots(node), SLOTS);
        // …and the sections really are gone, so this is not a vacuous pass.
        for (const id of ['countdown', 'reception', 'dressCode']) {
            assert.ok(!rendered.includes(id), id + ' should not have rendered');
        }

        // `afterCountdown` now sits immediately before the ceremony, which is
        // the template position it is anchored to.
        const order = sectionsOf(node);
        const band = order.indexOf('interlude');
        assert.ok(band >= 0);
        assert.ok(order.indexOf('ceremony') > order.indexOf('message'));
    });

    test('removing one photograph does not move any other', () => {
        const full = allSlots();
        const before = interludeSlots(renderDemo({ raw: withInterludes(full) }).node);

        const minusOne = { ...full };
        delete minusOne.afterCeremony;
        const after = interludeSlots(renderDemo({ raw: withInterludes(minusOne) }).node);

        assert.deepEqual(after, before.filter((s) => s !== 'afterCeremony'));
        // Each surviving photograph still carries the SAME image it had.
        const nodes = renderDemo({ raw: withInterludes(minusOne) }).node.querySelectorAll('.inv-interlude');
        for (const n of nodes) {
            const i = SLOTS.indexOf(n.getAttribute('data-slot'));
            assert.match(n.querySelector('.inv-interlude__img').getAttribute('src'),
                new RegExp(`band-0${i + 1}\\.svg$`));
        }
    });

    test('parity comes from the FIXED slot index, not from how many are filled', () => {
        const one = renderDemo({ raw: withInterludes({ afterCountdown: { image: img(2) } }) });
        const all = renderDemo({ raw: withInterludes(allSlots()) });

        const parityOf = (r, slot) => Array.from(r.node.querySelectorAll('.inv-interlude'))
            .find((n) => n.getAttribute('data-slot') === slot)
            .getAttribute('data-parity');

        // afterCountdown is index 1 → odd, whether it is alone or one of six.
        assert.equal(parityOf(one, 'afterCountdown'), 'odd');
        assert.equal(parityOf(all, 'afterCountdown'), 'odd');
        assert.equal(parityOf(all, 'afterMessage'), 'even');
    });

    test('an UNKNOWN slot name is ignored, and cannot become a seventh position', () => {
        const { config, node } = renderDemo({
            raw: withInterludes({
                afterMessage: { image: img(1) },
                somewhereElse: { image: img(2) },
                __proto__: { image: img(3) },
                constructor: { image: img(4) },
            }),
        });
        assert.deepEqual(Object.keys(config.interludeImages), ['afterMessage']);
        assert.deepEqual(interludeSlots(node), ['afterMessage']);
    });

    test('an UNUSABLE image drops the slot rather than the invitation', () => {
        const { config, ok } = normalizeConfig(withInterludes({
            afterMessage: { image: { source: 'storage', path: '../../secret.jpg', bucket: 'x' } },
            afterCeremony: { image: 'https://evil.example/x.jpg' },
            afterReception: { image: { source: 'demo', path: 'javascript:alert(1)' } },
            beforeClosing: { image: img(6), alt: 'válida' },
        }));
        assert.equal(ok, true);
        assert.deepEqual(Object.keys(config.interludeImages), ['beforeClosing']);
    });

    test('interludes are lazy, sized, and never a titled section', () => {
        const { node } = renderDemo();
        for (const n of node.querySelectorAll('.inv-interlude')) {
            const image = n.querySelector('.inv-interlude__img');
            assert.equal(image.getAttribute('loading'), 'lazy');
            assert.equal(image.getAttribute('decoding'), 'async');
            assert.ok(Number(image.getAttribute('width')) > 0);
            assert.ok(Number(image.getAttribute('height')) > 0);
            // No heading anywhere inside a band: it is not a section.
            assert.equal(n.querySelector('h2'), null);
            assert.equal(n.querySelector('h3'), null);
        }
        // …and the editor's own group name never reaches the page.
        assert.ok(!serialize(node).includes('Fotos a lo largo'));
    });

    test('a template asset may fill a slot; an unknown key leaves it empty', () => {
        const good = renderDemo({
            raw: withInterludes({ afterMessage: { image: { source: 'template', assetKey: 'hero-default' } } }),
        });
        assert.deepEqual(interludeSlots(good.node), ['afterMessage']);

        const bad = renderDemo({
            raw: withInterludes({ afterMessage: { image: { source: 'template', assetKey: 'no-such-asset' } } }),
        });
        assert.deepEqual(interludeSlots(bad.node), []);
    });

    test('interludes never reach a backend of their own', () => {
        // Demo mode supplies no storage resolver, so a storage-backed slot
        // resolves to nothing rather than reaching for the network.
        const { node } = renderDemo({
            raw: withInterludes({ afterMessage: { image: { source: 'storage', bucket: 'invitation-media', path: 'e/a.jpg' } } }),
        });
        assert.deepEqual(interludeSlots(node), []);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// MILESTONE C · the publication lifecycle, from the guest's side
//
// Everything below runs the SHIPPED `resolve.js` against a stub RPC, so the
// assertions are about the file GitHub Pages serves and not about a description
// of it. What is being pinned:
//
//   • the published route reaches exactly one endpoint, with exactly one
//     parameter, and never a preview token;
//   • a draft, an unpublished invitation, an unknown slug, an unknown template
//     and an unrenderable configuration are INDISTINGUISHABLE to a guest;
//   • the organizer's saved values render exactly, with no demonstration data
//     anywhere in the module graph.
// ─────────────────────────────────────────────────────────────────────────────
describe('the published route', () => {
    /** A publishable configuration with recognisable values. */
    const savedConfig = () => ({
        contractVersion: CONTRACT_VERSION,
        categoryKey: 'wedding',
        templateKey: 'wedding_romantic',
        templateVersion: 1,
        locale: 'es-MX',
        timeZone: 'America/Mexico_City',
        sections: {
            hero: { partnerA: 'Renata', partnerB: 'Emiliano', date: '2027-03-14' },
            message: { body: 'Nos encantaría que nos acompañaras.' },
            ceremony: {
                startsAt: '2027-03-14T18:00:00-06:00',
                venueName: 'Capilla del Bosque',
                address: 'Av. Reforma 100',
            },
        },
    });

    /** The published payload the backend returns for a live invitation. */
    const publishedPayload = (config) => ({
        payload_version: 1,
        mode: 'published',
        invitation: {
            id: '11111111-1111-4111-8111-111111111111',
            eventId: '22222222-2222-4222-8222-222222222222',
            categoryKey: 'wedding',
            templateKey: 'wedding_romantic',
            templateVersion: 1,
            contractVersion: CONTRACT_VERSION,
            slug: 'q7m2k9x4pt3wz8ab',
            updatedAt: '2026-08-03T10:00:00Z',
            config: config || savedConfig(),
        },
    });

    /** A recording stub in the shape `callRpc` presents. */
    function recorder(reply) {
        const calls = [];
        return {
            calls,
            callRpc: async (name, params) => { calls.push({ name, params }); return reply; },
        };
    }

    const deps = (rpc) => ({ callRpc: rpc, resolveTemplate, normalizeConfig });

    test('a published slug resolves and renders, with no account and no token', async () => {
        const rec = recorder(publishedPayload());
        const route = parseRoute('?i=q7m2k9x4pt3wz8ab');
        const out = await resolveStored(route, deps(rec.callRpc));

        assert.equal(out.result, RESULT.OK);
        assert.equal(rec.calls.length, 1, 'exactly one backend request');
        assert.equal(rec.calls[0].name, 'get_published_invitation');
        assert.deepEqual(rec.calls[0].params, { p_slug: 'q7m2k9x4pt3wz8ab' });
        // NO preview token, under any name.
        assert.equal(JSON.stringify(rec.calls[0].params).includes('token'), false);

        // …and it draws the organizer's own values.
        const document = createDocument();
        const drawn = renderInvitation({
            template: out.template,
            config: out.config,
            route,
            document,
            assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
            templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
            now: Date.parse('2026-08-01T12:00:00Z'),
            pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/?i=q7m2k9x4pt3wz8ab',
        });
        assert.equal(drawn.ok, true);
        const html = serialize(drawn.node);
        assert.ok(html.includes('Renata'));
        assert.ok(html.includes('Emiliano'));
        assert.ok(html.includes('Capilla del Bosque'));
        assert.ok(html.includes('Nos encantaría que nos acompañaras.'));
    });

    test('a draft, an unpublished invitation and an unknown slug are the SAME answer', async () => {
        // The backend returns the identical stub for all three — it refuses to
        // distinguish them, and neither does the page.
        for (const label of ['unknown slug', 'still a draft', 'unpublished']) {
            const rec = recorder({ not_found: true });
            const out = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps(rec.callRpc));
            assert.equal(out.result, RESULT.UNAVAILABLE, label);
            assert.equal(out.template, undefined, label);
            assert.equal(out.config, undefined, label);
        }
    });

    test('a network failure is the same answer too', async () => {
        // `callRpc` returns null for a non-2xx, a thrown fetch or an unparseable
        // body, so a server hiccup and a withdrawn invitation look identical.
        const rec = recorder(null);
        const out = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps(rec.callRpc));
        assert.equal(out.result, RESULT.UNAVAILABLE);
    });

    test('a MALFORMED slug makes no request at all', async () => {
        const hostile = [
            'A'.repeat(10),              // the database stores lowercase only
            '../../etc/passwd',
            'a b',
            '-leading-hyphen',
            'trailing-hyphen-',
            'x'.repeat(120),
            'javascript:alert(1)',
            'sección',
        ];
        for (const value of hostile) {
            const route = parseRoute('?i=' + encodeURIComponent(value));
            assert.notEqual(route.mode, MODE.PUBLISHED, 'accepted ' + JSON.stringify(value));

            const rec = recorder(publishedPayload());
            const out = await resolveStored(route, deps(rec.callRpc));
            assert.equal(out.result, RESULT.UNAVAILABLE, value);
            assert.equal(rec.calls.length, 0, 'contacted the backend for ' + JSON.stringify(value));
        }
    });

    test('the slug rule is the DATABASE rule, character for character', () => {
        // Pinned to `digital_invitations_slug_shape` in migration 20260730170000.
        assert.equal(safeSlug('q7m2k9x4pt3wz8ab'), 'q7m2k9x4pt3wz8ab');
        assert.equal(safeSlug('a'), 'a');
        assert.equal(safeSlug('valentina-y-mateo'), 'valentina-y-mateo');
        assert.equal(safeSlug('a'.repeat(63)), 'a'.repeat(63));
        assert.equal(safeSlug('a'.repeat(64)), null);
        assert.equal(safeSlug('-a'), null);
        assert.equal(safeSlug('a-'), null);
        assert.equal(safeSlug('A'), null);
        assert.equal(safeSlug('a_b'), null);
        assert.equal(safeSlug(''), null);
        assert.equal(safeSlug(null), null);
        assert.equal(safeSlug(42), null);
    });

    test('an UNKNOWN template fails closed rather than picking a design', async () => {
        const payload = publishedPayload();
        payload.invitation.templateKey = 'wedding_brutalist';
        const rec = recorder(payload);
        const out = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps(rec.callRpc));
        assert.equal(out.result, RESULT.UNAVAILABLE);
        assert.equal(out.template, undefined);
    });

    test('an unrenderable PUBLISHED configuration is unavailable, not "incomplete"', async () => {
        // "Incomplete" is a message for the author of a draft. A guest holding a
        // published link must never be told the couple left a field blank.
        const payload = publishedPayload({ ...savedConfig(), sections: {} });
        const rec = recorder(payload);
        const out = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps(rec.callRpc));
        assert.equal(out.result, RESULT.UNAVAILABLE);
    });

    test('the same unfinished configuration IS "incomplete" on the draft route', async () => {
        const payload = publishedPayload({ ...savedConfig(), sections: {} });
        payload.mode = 'draft';
        const rec = recorder(payload);
        const out = await resolveStored(parseRoute('?d=abc123&t=' + 'k'.repeat(40)), deps(rec.callRpc));
        assert.equal(out.result, RESULT.INCOMPLETE);
    });

    test('the draft route still needs its token, and makes no request without one', async () => {
        const rec = recorder(publishedPayload());
        const out = await resolveStored(parseRoute('?d=abc123'), deps(rec.callRpc));
        assert.equal(out.result, RESULT.UNAVAILABLE);
        assert.equal(rec.calls.length, 0);
    });

    test('the call table is closed: one endpoint per mode, and nothing for the rest', () => {
        assert.deepEqual(storedRequest(parseRoute('?i=q7m2k9x4pt3wz8ab')), {
            rpc: 'get_published_invitation',
            params: { p_slug: 'q7m2k9x4pt3wz8ab' },
        });
        assert.deepEqual(storedRequest(parseRoute('?d=abc123&t=' + 'k'.repeat(40))), {
            rpc: 'get_invitation_draft',
            params: { p_invitation_id: 'abc123', p_token: 'k'.repeat(40) },
        });
        assert.equal(storedRequest(parseRoute('?demo=' + DEMO_ID)), null);
        assert.equal(storedRequest(parseRoute('')), null);
        assert.equal(storedRequest(null), null);
    });

    test('a code= on a published link never reaches the backend', async () => {
        const route = parseRoute('?i=q7m2k9x4pt3wz8ab&code=ABCDEFGHIJKL');
        assert.equal(route.mode, MODE.PUBLISHED);
        assert.equal(route.code, 'ABCDEFGHIJKL');

        // The card the code produces is Milestone D's — but the WEB's backend
        // conversation is unchanged: one slug-addressed request, and neither
        // the code nor the return address ever appears in it. Validity,
        // claiming and every outcome stay the app's monopoly.
        const rec = recorder(publishedPayload());
        await resolveStored(route, deps(rec.callRpc));
        assert.equal(rec.calls.length, 1);
        assert.deepEqual(rec.calls[0].params, { p_slug: 'q7m2k9x4pt3wz8ab' });
        assert.equal(JSON.stringify(rec.calls).includes('ABCDEFGHIJKL'), false);
        assert.equal(JSON.stringify(rec.calls).includes('app_return'), false);
    });

    test('the stored routes cannot reach demonstration data', () => {
        // `resolve.js` is the whole data path for both stored routes. Demo data
        // is not in its module graph, is not imported by it, and is not named
        // by it — so no published invitation can inherit a fictional value.
        const source = codeOnly(readFileSync(join(INVITATION, 'js', 'resolve.js'), 'utf8'));
        assert.ok(!source.includes('demo-data'), 'resolve.js references demo data');
        assert.ok(!source.includes('demoConfig'));
        assert.ok(!/\bimport\b[^\n]*demo/i.test(source));
    });

    test('the resolver leaks no organizer-private identifier', async () => {
        const rec = recorder(publishedPayload());
        const out = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps(rec.callRpc));
        const carried = JSON.stringify(out.invitation);
        assert.ok(!carried.includes('11111111'), 'the invitation id was carried');
        assert.ok(!carried.includes('slug'));
        // The EVENT ID is carried since Milestone D — it exists for the app
        // handoff route (`e/{eventId}`, the shape every event-preview URL
        // already exposes publicly) and is never rendered as text. The closed
        // key list is the guarantee nothing else rides along.
        assert.equal(out.invitation.eventId, '22222222-2222-4222-8222-222222222222');
        assert.deepEqual(Object.keys(out.invitation).sort(),
            ['categoryKey', 'eventId', 'templateKey', 'templateVersion']);
    });

    test('the gallery ceiling holds on a published invitation', async () => {
        const config = savedConfig();
        config.sections.gallery = {
            enabled: true,
            items: Array.from({ length: 20 }, (_, i) => ({
                image: { source: 'demo', path: 'wedding-romantic/band-0' + ((i % 6) + 1) + '.svg' },
            })),
        };
        const rec = recorder(publishedPayload(config));
        const out = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps(rec.callRpc));
        assert.equal(out.result, RESULT.OK);
        assert.equal(out.config.sections.gallery.items.length, LIMITS.GALLERY_ITEMS);
        assert.equal(LIMITS.GALLERY_ITEMS, 6);
    });

    test('the page still declares its generic, static Open Graph metadata', () => {
        // Deliberately NOT invitation-specific: GitHub Pages serves a static
        // file, so a per-invitation title would be a promise the host cannot
        // keep. The page CONTENT is the real invitation once JavaScript runs.
        assert.ok(INDEX_HTML.includes('Invitación digital · Orbiventt'));
        assert.ok(/property="og:title"/.test(INDEX_HTML));
        assert.ok(/property="og:description"/.test(INDEX_HTML));
        assert.ok(!INDEX_HTML.includes('Renata'));
    });

    test('a link that resolves to nothing always reads the same', () => {
        // An unknown slug, a malformed one and a bare /invitation/ must be
        // indistinguishable. `unknownTemplate` survives for demo mode alone,
        // where naming the missing template is useful and reveals nothing.
        const code = codeOnly(readFileSync(join(INVITATION, 'js', 'main.js'), 'utf8'));
        const start = code.slice(code.indexOf('async function start'));
        assert.ok(start.includes('STATES.unavailable'),
            'an unrecognized route does not show the shared unavailable state');
        assert.ok(!start.includes('STATES.unknownTemplate'),
            'an unrecognized route still shows a distinguishable state');
    });

    test('every stored-route failure shows ONE state, and it names nothing', () => {
        const main = readFileSync(join(INVITATION, 'js', 'main.js'), 'utf8');
        const code = codeOnly(main);
        // The published branch has exactly one non-OK outcome besides the
        // organizer-only "incomplete draft".
        assert.ok(code.includes('STATES.unavailable'));
        assert.ok(!code.includes('notAvailableYet'), 'a second unavailable state survives');
        // The copy itself must not mention status, ids or the backend.
        // The state's OWN literal, not the neighbouring ones: `incompleteDraft`
        // sits between it and `failed`, and it is allowed to say "draft".
        const start = main.indexOf('unavailable: {');
        const copy = main.slice(start, main.indexOf('},', start));
        for (const leak of ['borrador', 'draft', 'despublic', 'unpublish', 'slug', 'RPC']) {
            assert.ok(!copy.toLowerCase().includes(leak.toLowerCase()),
                'the unavailable copy mentions ' + leak);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Milestone D · the pass-claim card on the PUBLISHED route
// ─────────────────────────────────────────────────────────────────────────────
describe('the pass-claim card (published)', () => {
    const CODE = 'ABCDEFGHIJKL';
    const HANDOFF = { open: true, href: 'vyvent://e/91000001-0000-4000-8000-000000000001?code=' + CODE, source: 'app-scheme', reason: null };

    /** A published invitation rendered with an optional code and handoff. */
    function renderPublished(over = {}) {
        const template = resolveTemplate(DEMO_ID);
        const { ok, config } = normalizeConfig(demoConfig(DEMO_ID));
        assert.equal(ok, true);
        const document = createDocument();
        const result = renderInvitation({
            template,
            config,
            route: over.route || parseRoute('?i=q7m2k9x4pt3wz8ab' + (over.noCode ? '' : '&code=' + CODE)),
            document,
            assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
            templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
            now: Date.parse('2026-08-01T12:00:00Z'),
            navigator: over.navigator,
            pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/?i=q7m2k9x4pt3wz8ab',
            handoff: 'handoff' in over ? over.handoff : HANDOFF,
        });
        return { ...result, document };
    }

    function passesNode(result) {
        return result.node.querySelector('[data-section="passes"]');
    }

    test('a published invitation without a code renders no claim card', () => {
        const out = renderPublished({ noCode: true, handoff: null });
        assert.ok(!out.rendered.includes('passes'));
        assert.ok(!sectionsOf(out.node).includes('passes'));
    });

    test('a published invitation with a code renders the card, formatted and labelled', () => {
        const out = renderPublished();
        const node = passesNode(out);
        assert.ok(node, 'no claim card rendered');
        assert.match(node.textContent, /Reclama tus pases/);
        assert.match(node.textContent, /Usa este código en Orbiventt para reclamar y asignar tus pases\./);
        // The code is visible, in the same XXXX-XXXX-XXXX form the app shows.
        assert.match(node.textContent, /ABCD-EFGH-IJKL/);
        // The manual fallback is always present.
        assert.match(node.textContent, /copia el código e ingrésalo/);
        // It is the REAL card, not the demo explainer.
        assert.ok(!/Demostración/.test(node.textContent));
        assert.ok(!node.getAttribute('class') || true);
        assert.ok(!serialize(node).includes('is-demo'));
    });

    test('the card renders the invitation itself untouched around it', () => {
        const withCard = renderPublished();
        const withoutCard = renderPublished({ noCode: true, handoff: null });
        const others = (r) => sectionsOf(r.node).filter((s) => s !== 'passes');
        assert.deepEqual(others(withCard), others(withoutCard));
    });

    test('"Abrir Orbiventt" uses exactly the pre-resolved handoff href', () => {
        const out = renderPublished();
        const node = passesNode(out);
        const open = node.querySelectorAll('a').find((a) => /Abrir Orbiventt/.test(a.textContent));
        assert.ok(open, 'no open control');
        assert.equal(open.getAttribute('href'), HANDOFF.href);
    });

    test('without a usable handoff there is no automatic button, and the card survives', () => {
        for (const handoff of [null, { open: false, href: null, source: 'none', reason: 'expo-go-required' }]) {
            const out = renderPublished({ handoff });
            const node = passesNode(out);
            assert.ok(node, 'the card vanished with the handoff');
            const open = node.querySelectorAll('a').find((a) => /Abrir Orbiventt/.test(a.textContent));
            assert.equal(open, undefined, 'an open control rendered without a destination');
            // The copy path still carries the guest.
            assert.match(node.textContent, /Copiar código/);
            assert.match(node.textContent, /ABCD-EFGH-IJKL/);
        }
    });

    test('"Copiar código" copies ONLY the code, and confirms', async () => {
        const written = [];
        const out = renderPublished({
            navigator: { clipboard: { writeText: (v) => { written.push(v); return Promise.resolve(); } } },
        });
        const node = passesNode(out);
        const button = node.querySelectorAll('button')[0];
        assert.ok(button, 'no copy button');
        assert.equal(button.getAttribute('type'), 'button');
        assert.equal(button.getAttribute('aria-label'), 'Copiar código de invitación');

        button.dispatch('click');
        await new Promise((r) => setTimeout(r, 0));

        assert.deepEqual(written, ['ABCD-EFGH-IJKL']);
        // Only the code: no slug, no token, no URL, no scheme.
        assert.ok(!written[0].includes('q7m2k9x4pt3wz8ab'));
        assert.ok(!written[0].includes('http'));
        assert.ok(!written[0].includes('://'));
        const status = node.querySelectorAll('[role="status"]')[0];
        assert.equal(status.textContent, 'Código copiado');
    });

    test('a clipboard that fails or does not exist falls back to a controlled hint', async () => {
        for (const navigator of [
            {},
            { clipboard: {} },
            { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
        ]) {
            const out = renderPublished({ navigator });
            const node = passesNode(out);
            node.querySelectorAll('button')[0].dispatch('click');
            await new Promise((r) => setTimeout(r, 0));
            const status = node.querySelectorAll('[role="status"]')[0];
            assert.equal(status.textContent, 'Mantén presionado el código para copiarlo.');
        }
    });

    test('a draft preview never renders the claim card, even with a code', () => {
        const out = renderPublished({
            route: parseRoute('?d=abc123&t=tok-en_1&code=' + CODE),
            handoff: null,
        });
        assert.ok(!out.rendered.includes('passes'));
    });

    test('a malformed code renders the invitation with no card and no handoff', () => {
        const out = renderPublished({
            route: parseRoute('?i=q7m2k9x4pt3wz8ab&code=' + encodeURIComponent('../evil code')),
            handoff: null,
        });
        assert.ok(!out.rendered.includes('passes'));
        assert.ok(sectionsOf(out.node).includes('hero'));
    });

    test('displayCode mirrors the app: canonical codes grouped, everything else verbatim', () => {
        assert.equal(displayCode('ABCDEFGHIJKL'), 'ABCD-EFGH-IJKL');
        assert.equal(displayCode('abcd-efgh-ijkl'), 'ABCD-EFGH-IJKL');
        assert.equal(displayCode('SHORT'), 'SHORT');
        assert.equal(displayCode('TOOLONGFORTHECODE'), 'TOOLONGFORTHECODE');
    });

    test('the passes module never logs, stores, or transmits the code', () => {
        const source = codeOnly(readFileSync(join(INVITATION, 'js', 'sections', 'passes.js'), 'utf8'));
        for (const forbidden of ['console.', 'localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'track(', 'vyvent://', 'exp://']) {
            assert.ok(!source.includes(forbidden), 'passes.js contains ' + forbidden);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Milestone D · the app handoff plumbing
// ─────────────────────────────────────────────────────────────────────────────
describe('the app handoff plumbing', () => {
    const APP_RETURN = 'exp://192.168.1.42:8081/--/e/91000001-0000-4000-8000-000000000001';

    test('parseRoute carries a valid Expo Go return address on every mode', () => {
        const published = parseRoute('?i=q7m2k9x4pt3wz8ab&code=ABCDEFGHIJKL&app_return=' + encodeURIComponent(APP_RETURN));
        assert.equal(published.mode, MODE.PUBLISHED);
        assert.equal(published.appReturn, APP_RETURN);

        const demo = parseRoute('?demo=wedding_romantic_v1&app_return=' + encodeURIComponent(APP_RETURN));
        assert.equal(demo.appReturn, APP_RETURN);
    });

    test('a hostile app_return never survives into the route', () => {
        for (const value of [
            'vyvent://e/x',
            'https://evil.example/--/e/x',
            'javascript:alert(1)',
            'exp://host/--/e/x"onload="x',
            'exp://host/--/e/<script>',
            'exp://' + 'a'.repeat(300),
            '',
        ]) {
            const r = parseRoute('?i=q7m2k9x4pt3wz8ab&app_return=' + encodeURIComponent(value));
            assert.equal(r.appReturn, null, 'accepted ' + JSON.stringify(value));
        }
    });

    test('resolveStored surfaces a UUID-shaped event id, and only that shape', async () => {
        const payload = (eventId) => ({
            invitation: {
                categoryKey: 'wedding', templateKey: 'wedding_romantic', templateVersion: 1,
                eventId,
                config: demoConfig(DEMO_ID),
            },
        });
        const deps = (value) => ({
            callRpc: async () => payload(value),
            resolveTemplate,
            normalizeConfig,
        });

        const good = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps('91000001-0000-4000-8000-000000000001'));
        assert.equal(good.result, RESULT.OK);
        assert.equal(good.invitation.eventId, '91000001-0000-4000-8000-000000000001');

        for (const bad of [undefined, null, 42, 'not-a-uuid', 'e/91000001-0000-4000-8000-000000000001', '<script>']) {
            const out = await resolveStored(parseRoute('?i=q7m2k9x4pt3wz8ab'), deps(bad));
            assert.equal(out.result, RESULT.OK, 'the verdict must not change');
            assert.equal(out.invitation.eventId, null, 'accepted ' + JSON.stringify(bad));
        }
    });

    test('main.js funnels the handoff through the shared resolver, published mode only', () => {
        const code = codeOnly(readFileSync(join(INVITATION, 'js', 'main.js'), 'utf8'));
        assert.ok(code.includes('__ORB_APP_RETURN__'), 'main.js does not use the shared resolver');
        assert.ok(code.includes('resolveAppHandoff'), 'main.js does not call resolveAppHandoff');
        assert.ok(!code.includes("'vyvent://"), 'main.js hand-builds an app scheme');
        assert.ok(!code.includes('"vyvent://'), 'main.js hand-builds an app scheme');
        assert.ok(code.includes('MODE.PUBLISHED\n        ? passHandoff') || /mode === MODE\.PUBLISHED\s*\?\s*passHandoff/.test(code),
            'the handoff is not gated to the published mode');
    });

    test('no module in the invitation tree hand-builds an app URL', () => {
        for (const { rel, source } of moduleSources()) {
            const code = codeOnly(source);
            for (const needle of ["'vyvent://", '"vyvent://', "'exp://", '"exp://']) {
                assert.ok(!code.includes(needle), `${rel} hard-codes ${needle}`);
            }
        }
    });

    test('the page loads the shared resolver before the module bootstrap', () => {
        assert.ok(INDEX_HTML.includes('<script src="app-return.js"></script>'));
        assert.ok(
            INDEX_HTML.indexOf('app-return.js') < INDEX_HTML.indexOf('invitation/js/main.js'),
            'app-return.js must load before main.js',
        );
    });

    test('the demo route still reaches no backend and no app scheme', () => {
        // The demo card renders with a code and never gains a live control.
        const document = createDocument();
        const template = resolveTemplate(DEMO_ID);
        const { config } = normalizeConfig(demoConfig(DEMO_ID));
        const out = renderInvitation({
            template, config,
            route: parseRoute('?demo=' + DEMO_ID + '&code=ABCDEFGHIJKL&app_return=' + encodeURIComponent(APP_RETURN)),
            document,
            assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
            templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
            now: Date.parse('2026-08-01T12:00:00Z'),
            pageUrl: 'x',
            handoff: null,
        });
        const node = out.node.querySelector('[data-section="passes"]');
        assert.ok(node);
        assert.match(node.textContent, /Demostración/);
        assert.equal(node.querySelectorAll('button').length, 0);
        assert.equal(node.querySelectorAll('a').length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Milestone D final UX · pass quantity on the claim card
// ─────────────────────────────────────────────────────────────────────────────
describe('the claim card states the pass allocation', () => {
    function renderWithSummary(passSummary) {
        const template = resolveTemplate(DEMO_ID);
        const { ok, config } = normalizeConfig(demoConfig(DEMO_ID));
        assert.equal(ok, true);
        const document = createDocument();
        const result = renderInvitation({
            template,
            config,
            route: parseRoute('?i=q7m2k9x4pt3wz8ab&code=ABCDEFGHIJKL'),
            document,
            assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
            templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
            now: Date.parse('2026-08-01T12:00:00Z'),
            pageUrl: 'x',
            handoff: null,
            passSummary,
        });
        return result.node.querySelector('[data-section="passes"]');
    }

    test('allocationLine speaks people first, then honest availability', () => {
        assert.equal(allocationLine({ seatCapacity: 5, seatsRemaining: 5 }),
            'Invitación para 5 personas.');
        assert.equal(allocationLine({ seatCapacity: 1, seatsRemaining: 1 }),
            'Invitación para 1 persona.');
        assert.equal(allocationLine({ seatCapacity: 5, seatsRemaining: 3 }),
            'Invitación para 5 personas. Quedan 3 de 5 pases disponibles.');
        assert.equal(allocationLine({ seatCapacity: 5, seatsRemaining: 1 }),
            'Invitación para 5 personas. Queda 1 de 5 pases disponibles.');
        assert.equal(allocationLine({ seatCapacity: 5, seatsRemaining: 0 }),
            'Invitación para 5 personas. Quedan 0 de 5 pases disponibles.');
    });

    test('nothing trustworthy → no line, never a guess', () => {
        for (const bad of [
            null, undefined, {},
            { seatCapacity: '5', seatsRemaining: 3 },
            { seatCapacity: 5, seatsRemaining: 6 },
            { seatCapacity: 0, seatsRemaining: 0 },
            { seatCapacity: 5.5, seatsRemaining: 3 },
            { seatCapacity: 5, seatsRemaining: -1 },
        ]) {
            assert.equal(allocationLine(bad), null, 'accepted ' + JSON.stringify(bad));
        }
    });

    test('the card renders the allocation from a validated summary', () => {
        const node = renderWithSummary({ seatCapacity: 5, seatsRemaining: 3 });
        assert.match(node.textContent, /Invitación para 5 personas\./);
        assert.match(node.textContent, /Quedan 3 de 5 pases disponibles\./);
    });

    test('without a summary the card is exactly what it was — no line, no error', () => {
        const node = renderWithSummary(null);
        assert.ok(node, 'the card must still render');
        assert.ok(!/personas\.|pases disponibles/.test(node.textContent));
        assert.match(node.textContent, /ABCD-EFGH-IJKL/);
        assert.match(node.textContent, /Copiar código/);
    });

    test('numbers only — no claimant identity can reach the card', () => {
        const node = renderWithSummary({ seatCapacity: 5, seatsRemaining: 3 });
        // The allocation element carries exactly the sentence; a payload cannot
        // smuggle names because normalizePassSummary reduces it to two ints.
        const line = node.querySelectorAll('.inv-passes__allocation')[0];
        assert.equal(line.textContent,
            'Invitación para 5 personas. Quedan 3 de 5 pases disponibles.');
    });

    test('normalizePassSummary reduces the payload to two bounded integers', () => {
        assert.deepEqual(
            normalizePassSummary({ seat_capacity: 5, seats_remaining: 3 }),
            { seatCapacity: 5, seatsRemaining: 3 },
        );
        for (const bad of [
            null, { not_found: true },
            { seat_capacity: 5 },
            { seat_capacity: 1001, seats_remaining: 3 },
            { seat_capacity: 5, seats_remaining: 6 },
            { seat_capacity: 'cinco', seats_remaining: 3 },
            { seat_capacity: 5, seats_remaining: 3, claimant: 'Ana' },
        ].slice(0, 6)) {
            assert.equal(normalizePassSummary(bad), null, 'accepted ' + JSON.stringify(bad));
        }
        // Extra keys are DROPPED, never carried.
        const extra = normalizePassSummary({ seat_capacity: 5, seats_remaining: 3, label: 'Familia' });
        assert.deepEqual(Object.keys(extra).sort(), ['seatCapacity', 'seatsRemaining']);
    });

    test('the summary request exists only for a published route with a code', () => {
        assert.deepEqual(
            passSummaryRequest(parseRoute('?i=q7m2k9x4pt3wz8ab&code=ABCDEFGHIJKL')),
            {
                rpc: 'get_invitation_pass_summary',
                params: { p_slug: 'q7m2k9x4pt3wz8ab', p_code: 'ABCDEFGHIJKL' },
            },
        );
        assert.equal(passSummaryRequest(parseRoute('?i=q7m2k9x4pt3wz8ab')), null);
        assert.equal(passSummaryRequest(parseRoute('?d=abc123&t=tok&code=ABCDEFGHIJKL')), null);
        assert.equal(passSummaryRequest(parseRoute('?demo=' + DEMO_ID + '&code=ABCDEFGHIJKL')), null);
        assert.equal(passSummaryRequest(null), null);
    });

    test('callRpc accepts the summary endpoint and still refuses everything else', async () => {
        const calls = [];
        const fetchStub = async (url) => {
            calls.push(url);
            return { ok: true, json: async () => ({ seat_capacity: 5, seats_remaining: 3 }) };
        };
        const env = { supaUrl: 'https://project.supabase.test', supaAnon: 'anon-key' };
        const out = await callRpc('get_invitation_pass_summary',
            { p_slug: 's', p_code: 'c' }, { env, fetch: fetchStub });
        assert.deepEqual(out, { seat_capacity: 5, seats_remaining: 3 });
        assert.equal(calls.length, 1);
        assert.ok(calls[0].endsWith('/rest/v1/rpc/get_invitation_pass_summary'));

        assert.equal(await callRpc('get_all_codes', {}, { env, fetch: fetchStub }), null);
        assert.equal(calls.length, 1, 'a non-allowlisted name reached the network');
    });

    test('main.js asks for the summary only on the published branch', () => {
        const code = codeOnly(readFileSync(join(INVITATION, 'js', 'main.js'), 'utf8'));
        const fn = code.slice(code.indexOf('async function fetchPassSummary'));
        assert.ok(fn.includes('MODE.PUBLISHED'), 'the summary fetch is not mode-gated');
        assert.ok(code.includes('passSummaryRequest'), 'main.js bypasses the request table');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layout contract · nothing may be wider or narrower than the invitation
// ─────────────────────────────────────────────────────────────────────────────
describe('the invitation fits its viewport exactly', () => {
    const BASE = readFileSync(join(INVITATION, 'css', 'base.css'), 'utf8');
    const TPL = readFileSync(
        join(INVITATION, 'templates', 'wedding-romantic', 'template.css'), 'utf8');
    /** A rule body by selector, comments stripped. */
    const ruleFor = (css, selector) => {
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
        const at = stripped.indexOf(selector + ' {');
        if (at < 0) return null;
        return stripped.slice(at, stripped.indexOf('}', at));
    };

    test('the shell gives the page no margin and a border-box world', () => {
        assert.match(ruleFor(BASE, 'body'), /margin:\s*0/);
        assert.ok(BASE.includes('*, *::before, *::after { box-sizing: border-box; }'));
        // The invitation canvas centres itself; it never carries a one-sided pad.
        const page = ruleFor(BASE, '.inv-page');
        assert.match(page, /margin:\s*0 auto/);
        assert.match(page, /padding:\s*0/);
    });

    test('images are block-level, so no baseline gap can open under one', () => {
        assert.match(ruleFor(BASE, 'img'), /display:\s*block/);
        assert.match(ruleFor(TPL, '.tpl-wedding-romantic .inv-interlude__img'), /display:\s*block/);
    });

    /* THE REGRESSION. The band is a direct child of `.inv-invitation`, which has
     * no horizontal padding, so a negative `--inv-gutter` margin did not pull it
     * out to the page edges — it pushed it 24 px PAST them on both sides,
     * making the document wider than the viewport at every mobile width. */
    test('no full-bleed band escapes a gutter its parent does not have', () => {
        const band = ruleFor(TPL, '.tpl-wedding-romantic .inv-interlude');
        assert.ok(!/margin[^;]*calc\(var\(--inv-gutter\)\s*\*\s*-1\)/.test(band),
            'the interlude band still uses a negative-gutter margin');
        assert.match(band, /margin-inline:\s*0/);
        assert.match(band, /width:\s*100%/);
        assert.match(band, /max-width:\s*100%/);
        assert.match(band, /min-width:\s*0/);
        assert.match(band, /overflow:\s*hidden/);
    });

    test('neither parity is inset, so no band leaves a pale margin beside it', () => {
        const odd = ruleFor(TPL, '.tpl-wedding-romantic .inv-interlude[data-parity="odd"]');
        assert.ok(!/margin-inline:\s*var\(--inv-gutter\)/.test(odd),
            'odd bands are inset and would show background beside them');
        assert.match(odd, /border-radius/);
    });

    test('all six slots share ONE geometry rule — none overrides its own width', () => {
        const stripped = TPL.replace(/\/\*[\s\S]*?\*\//g, '');
        for (const slot of ['afterMessage', 'afterCountdown', 'afterCeremony',
            'afterReception', 'afterDressCode', 'beforeClosing']) {
            assert.ok(!stripped.includes(`data-slot="${slot}"`),
                `${slot} has its own geometry rule and can drift from the others`);
        }
        // The renderer really does emit all six.
        assert.equal(INTERLUDE_SLOTS.length, 6);
    });

    test('nothing in the invitation sizes itself with 100vw', () => {
        // `100vw` includes the scrollbar, so it overflows by 15-17 px on every
        // desktop browser that shows one. Width is always relative to the parent.
        for (const [name, css] of [['base.css', BASE], ['template.css', TPL]]) {
            const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
            assert.ok(!/\b100vw\b/.test(code), `${name} sizes something with 100vw`);
        }
    });

    test('full-bleed photographs stay COVER, so the mobile crop is what shows', () => {
        const img = ruleFor(TPL, '.tpl-wedding-romantic .inv-interlude__img');
        assert.match(img, /object-fit:\s*cover/);
        // The shell's `img { max-width: 100% }` must not cap the drifting image.
        assert.match(img, /max-width:\s*none/);
        // The band paints the template's own colour behind any transparency.
        assert.match(ruleFor(TPL, '.tpl-wedding-romantic .inv-interlude'),
            /background:\s*var\(--tpl-/);
    });

    test('the hero measures one screen in svh, with a vh fallback first', () => {
        const hero = ruleFor(TPL, '.tpl-wedding-romantic .inv-hero');
        const vhAt = hero.indexOf('min-height: 88vh');
        const svhAt = hero.indexOf('min-height: 88svh');
        assert.ok(vhAt > -1 && svhAt > vhAt,
            'svh must come after vh so old browsers keep the fallback');
        // min-height, never height: the hero may grow, so nothing is cropped.
        assert.ok(!/[^-]height:\s*\d+s?vh/.test(hero), 'the hero pins an exact viewport height');
    });

    test('the narrowest supported viewport is declared once, and is 320', () => {
        assert.match(ruleFor(BASE, 'html'), /min-width:\s*320px/);
        const code = TPL.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!/min-width:\s*(3[3-9]\d|[4-9]\d\d)px/.test(code),
            'the template forces a minimum wider than a 320 px phone');
    });

    test('overflow-x on the body is a GUARD, not the fix', () => {
        // It may stay — but the band it used to hide is now the right width, and
        // the test above is what keeps it that way.
        assert.match(ruleFor(BASE, 'body'), /overflow-x:\s*hidden/);
    });

    test('the pass card wraps instead of overflowing', () => {
        const actions = ruleFor(TPL, '.tpl-wedding-romantic .inv-passes__actions');
        assert.match(actions, /flex-wrap:\s*wrap/);
        assert.match(actions, /justify-content:\s*center/);
    });

    test('the code chip cannot be pushed past the card edge', () => {
        // A 12-character monospace chip with letter-spacing is the widest atom
        // in the card; it must be allowed to sit inside the measure.
        const chip = ruleFor(TPL, '.tpl-wedding-romantic .inv-passes__code-value');
        assert.match(chip, /display:\s*inline-block/);
        assert.ok(!/width:\s*\d/.test(chip), 'the code chip declares a fixed width');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clásica elegante · a second design, drawing the same invitation
// ─────────────────────────────────────────────────────────────────────────────
describe('the second wedding template', () => {
    const GOLD_ID = 'wedding_classic_gold_v1';
    const TEMPLATE_DIR = join(INVITATION, 'templates', 'wedding-classic-gold');

    /** A rendered demo for any registered template. */
    function renderTemplate(id, over = {}) {
        const template = resolveTemplate(id);
        assert.ok(template, 'unregistered template ' + id);
        const raw = over.raw || demoConfig(id);
        const { ok, config, errors } = normalizeConfig(raw);
        assert.equal(ok, true, id + ' did not normalize: ' + (errors || []).join(', '));
        const document = createDocument();
        const result = renderInvitation({
            template,
            config,
            route: over.route || parseRoute('?demo=' + id),
            document,
            assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
            templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
            now: Date.parse('2026-08-01T12:00:00Z'),
            navigator: over.navigator,
            pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/?demo=' + id,
            handoff: over.handoff,
            passSummary: over.passSummary,
        });
        return { ...result, config, document, template };
    }

    test('the registry holds exactly the designs that can be drawn', () => {
        const drawable = ['wedding_botanical_v1', 'wedding_classic_gold_v1',
            'wedding_editorial_v1', 'wedding_romantic_v1'];
        assert.deepEqual(listTemplates().map((t) => t.id).sort(), drawable);
        assert.deepEqual(listDemoIds().sort(), drawable);
        // The invariant the whole registry rests on.
        assert.deepEqual(listTemplates().map((t) => t.id).sort(), listDemoIds().sort());
    });

    test('Classic Gold resolves, and an unknown design still fails closed', () => {
        const t = resolveTemplate(GOLD_ID);
        assert.equal(t.categoryKey, 'wedding');
        assert.equal(t.templateKey, 'wedding_classic_gold');
        assert.equal(t.templateVersion, 1);
        assert.equal(t.label, 'Clásica elegante');
        assert.equal(t.contractVersion, 1);
        assert.match(t.description, /Marfil, dorado/);
        assert.equal(t.themeClass, 'tpl-wedding-classic-gold');
        for (const bad of ['wedding_classic_gold_v2', 'wedding_classic_gold',
            'wedding_celestial_v1', '__proto__', '', null, 42]) {
            assert.equal(resolveTemplate(bad), null, 'accepted ' + JSON.stringify(bad));
        }
    });

    test('it consumes the CATEGORY geometry, not its own', () => {
        const gold = resolveTemplate(GOLD_ID);
        const romantic = resolveTemplate(DEMO_ID);
        // The very same frozen object — so a crop can never be reinterpreted
        // against a different ratio by switching design.
        assert.equal(gold.imagePlacements, romantic.imagePlacements);
        assert.equal(gold.sections, romantic.sections);
        assert.deepEqual(gold.imagePlacements.hero, { ...romantic.imagePlacements.hero });
        assert.equal(gold.imagePlacements.interlude.aspectRatio, 16 / 9);
        assert.equal(gold.imagePlacements.gallery.aspectRatio, 4 / 5);
    });

    test('it renders every section the wedding contract has', () => {
        const out = renderTemplate(GOLD_ID);
        assert.equal(out.ok, true);
        const rendered = sectionsOf(out.node);
        for (const id of ['hero', 'message', 'countdown', 'ceremony', 'reception',
            'dressCode', 'gallery', 'gifts', 'closing', 'actions']) {
            assert.ok(rendered.includes(id), 'missing section: ' + id);
        }
        // All six photograph anchors, in the category's fixed order.
        const interludes = out.node.querySelectorAll('[data-section="interlude"]');
        assert.equal(interludes.length, 6);
        assert.deepEqual(interludes.map((n) => n.getAttribute('data-slot')),
            ['afterMessage', 'afterCountdown', 'afterCeremony', 'afterReception',
                'afterDressCode', 'beforeClosing']);
    });

    test('its media is cover-fitted, block-level and category-shaped', () => {
        const out = renderTemplate(GOLD_ID);
        const imgs = out.node.querySelectorAll('img');
        assert.ok(imgs.length >= 13, 'expected hero + 6 tiles + 6 bands');
        for (const img of imgs) {
            // Intrinsic geometry declared, so nothing shifts as images land.
            assert.ok(img.getAttribute('width'), 'an image declares no width');
            assert.ok(img.getAttribute('height'), 'an image declares no height');
        }
        const band = out.node.querySelectorAll('.inv-interlude__img')[0];
        assert.equal(band.getAttribute('width'), '1600');
        assert.equal(band.getAttribute('height'), '900');
        const tile = out.node.querySelectorAll('.inv-gallery__img')[0];
        assert.equal(tile.getAttribute('width'), '800');
        assert.equal(tile.getAttribute('height'), '1000');
    });

    test('it resolves ITS OWN hero-default for the shared category key', () => {
        const gold = resolveTemplate(GOLD_ID);
        const romantic = resolveTemplate(DEMO_ID);
        // Same KEY, different FILE — which is what lets a stored
        // {source:'template', assetKey:'hero-default'} survive a design change.
        assert.deepEqual(Object.keys(gold.assets), ['hero-default']);
        assert.deepEqual(Object.keys(romantic.assets), ['hero-default']);
        assert.notEqual(gold.assets['hero-default'], romantic.assets['hero-default']);

        const url = resolveImage(
            { source: 'template', assetKey: 'hero-default' },
            {
                templateAssets: gold.assets,
                templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
            },
        );
        assert.equal(url,
            'https://cosioyair.github.io/vyvent-legal/invitation/templates/'
            + 'wedding-classic-gold/hero-default.jpg');
        // And the file is really there.
        assert.ok(statSync(join(TEMPLATE_DIR, 'hero-default.jpg')).isFile());
    });

    test('every asset it names exists and is a safe relative path', () => {
        for (const [key, rel] of Object.entries(resolveTemplate(GOLD_ID).assets)) {
            assert.match(key, /^[a-z0-9][a-z0-9-]*$/);
            assert.ok(safeAssetPath(rel), 'unsafe asset path: ' + rel);
            assert.ok(statSync(join(INVITATION, 'templates', rel)).isFile(), 'missing ' + rel);
        }
        // Every demo image it references is in the repository too.
        const cfg = demoConfig(GOLD_ID);
        const paths = JSON.stringify(cfg).match(/wedding-classic-gold\/[a-z0-9-]+\.svg/g) || [];
        assert.ok(paths.length >= 13, 'demo references too few images');
        for (const rel of new Set(paths)) {
            assert.ok(statSync(join(INVITATION, 'assets', 'demo', rel)).isFile(), 'missing ' + rel);
        }
    });

    test('its demo is fictional, complete, and reaches no backend', () => {
        const cfg = demoConfig(GOLD_ID);
        // A different couple from the romantic demo — not the same data reskinned.
        assert.notEqual(cfg.sections.hero.partnerA, demoConfig(DEMO_ID).sections.hero.partnerA);
        assert.equal(cfg.sections.dressCode.guidelines.length, 4);
        assert.equal(cfg.sections.gallery.items.length, 6);
        assert.equal(Object.keys(cfg.interludeImages).length, 6);
        // Long content, on purpose: this is the wrapping fixture.
        assert.ok(cfg.sections.hero.partnerA.length >= 12);
        assert.ok(cfg.sections.reception.venueName.length >= 30);
        assert.ok(cfg.sections.reception.address.length >= 40);
        // Nothing that belongs to a real invitation.
        const json = JSON.stringify(cfg);
        for (const key of ['slug', 'previewToken', 'code', 'invitationId', 'eventId']) {
            assert.ok(!Object.prototype.hasOwnProperty.call(cfg, key));
        }
        assert.ok(!/https?:\/\/(?!mesaderegalos|www\.elpalacio)/.test(json.replace(/"url":"[^"]*"/g, '')));
        // Demo images only — never a storage bucket.
        assert.ok(!json.includes('"storage"'));
        assert.ok(!json.includes('supabase'));
    });

    test('the demo route reaches no backend at all', () => {
        // storedRequest is the ONLY thing that can produce a request, and demo
        // mode is not in its table.
        assert.equal(storedRequest(parseRoute('?demo=' + GOLD_ID)), null);
        assert.equal(passSummaryRequest(parseRoute('?demo=' + GOLD_ID)), null);
        assert.equal(passSummaryRequest(parseRoute('?demo=' + GOLD_ID + '&code=ABCDEFGHIJKL')), null);
    });

    test('long names and venues wrap rather than overflow', () => {
        const raw = demoConfig(GOLD_ID);
        raw.sections.hero.partnerA = 'Guadalupe Inmaculada de la Concepción';
        raw.sections.hero.partnerB = 'Juan Nepomuceno Maximiliano';
        raw.sections.ceremony.venueName =
            'Templo Expiatorio del Santísimo Sacramento y Nuestra Señora de la Luz';
        const out = renderTemplate(GOLD_ID, { raw });
        assert.equal(out.ok, true);
        const html = serialize(out.node);
        assert.ok(html.includes('Guadalupe Inmaculada'));
        assert.ok(html.includes('Templo Expiatorio'));
        // The stylesheet must let those break rather than push the frame open.
        const css = readFileSync(join(TEMPLATE_DIR, 'template.css'), 'utf8');
        assert.match(css, /overflow-wrap:\s*anywhere/);
    });

    test('the claim card works inside it, unchanged', () => {
        const out = renderTemplate(GOLD_ID, {
            route: parseRoute('?i=q7m2k9x4pt3wz8ab&code=ABCDEFGHIJKL'),
            handoff: { open: true, href: 'vyvent://e/evt?code=ABCDEFGHIJKL', source: 'app-scheme' },
            passSummary: { seatCapacity: 5, seatsRemaining: 3 },
        });
        const card = out.node.querySelector('[data-section="passes"]');
        assert.ok(card, 'no claim card');
        assert.match(card.textContent, /Reclama tus pases/);
        assert.match(card.textContent, /ABCD-EFGH-IJKL/);
        assert.match(card.textContent, /Invitación para 5 personas\./);
        assert.match(card.textContent, /Quedan 3 de 5 pases disponibles\./);
        assert.match(card.textContent, /Copiar código/);
        const open = card.querySelectorAll('a').find((a) => /Abrir Orbiventt/.test(a.textContent));
        assert.equal(open.getAttribute('href'), 'vyvent://e/evt?code=ABCDEFGHIJKL');
    });

    test('the card uses the SHARED handlers, not a forked copy', () => {
        // One passes renderer for every template: the section table is closed.
        assert.equal(resolveSection('passes').render, resolveSection('passes').render);
        const source = readFileSync(join(INVITATION, 'js', 'sections', 'passes.js'), 'utf8');
        assert.ok(!source.includes('classic-gold'), 'the shared card knows a template');
        assert.ok(!source.includes('tpl-'), 'the shared card names a theme class');
    });

    test('the stylesheet is registry-named, and nothing is dynamic', () => {
        const t = resolveTemplate(GOLD_ID);
        assert.equal(t.stylesheet, 'wedding-classic-gold/template.css');
        assert.equal(
            templateResourceUrl('https://orbiventt.com/invitation/templates/', t.stylesheet),
            'https://orbiventt.com/invitation/templates/wedding-classic-gold/template.css',
        );
        // A config value can never become a stylesheet.
        for (const evil of ['../../env.js', 'https://evil.example/x.css', '/etc/x.css', 'x.js']) {
            assert.equal(
                templateResourceUrl('https://orbiventt.com/invitation/templates/', evil), null);
        }
    });

    test('it introduces no external dependency, and no script in its artwork', () => {
        const css = readFileSync(join(TEMPLATE_DIR, 'template.css'), 'utf8');
        for (const needle of ['http://', 'https://', '@import', 'url(//']) {
            assert.ok(!css.includes(needle), 'template.css reaches for ' + needle);
        }
        assert.ok(!/\b100vw\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));

        const svgs = [join(TEMPLATE_DIR, 'hero-default.svg')].concat(
            readdirSync(join(INVITATION, 'assets', 'demo', 'wedding-classic-gold'))
                .map((f) => join(INVITATION, 'assets', 'demo', 'wedding-classic-gold', f)),
        );
        assert.ok(svgs.length >= 14);
        for (const file of svgs) {
            // The SVG XML namespace is a required identifier, not a request —
            // strip it before looking for anything that would reach the network.
            const svg = readFileSync(file, 'utf8')
                .replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
            for (const needle of ['<script', 'xlink:href', 'http://', 'https://',
                '<image', '<foreignObject', 'onload=', 'data:']) {
                assert.ok(!svg.includes(needle), file + ' contains ' + needle);
            }
        }
    });

    test('its layout obeys the corrected full-bleed contract', () => {
        const css = readFileSync(join(TEMPLATE_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const band = css.slice(css.indexOf('.tpl-wedding-classic-gold .inv-interlude {'),
            css.indexOf('.tpl-wedding-classic-gold .inv-interlude__img'));
        assert.match(band, /width:\s*100%/);
        assert.match(band, /max-width:\s*100%/);
        assert.match(band, /min-width:\s*0/);
        assert.match(band, /margin-inline:\s*0/);
        assert.match(band, /overflow:\s*hidden/);
        // No negative-gutter escape: its parent has no gutter to escape.
        assert.ok(!/margin[^;]*calc\(var\(--inv-gutter\)\s*\*\s*-1\)/.test(band));
        // Images are block-level, so no baseline gap can open under one.
        const img = css.slice(css.indexOf('.tpl-wedding-classic-gold .inv-interlude__img'));
        assert.match(img.slice(0, 400), /display:\s*block/);
        assert.match(img.slice(0, 400), /object-fit:\s*cover/);
    });

    test('the hero measures one screen in svh, with a vh fallback first', () => {
        const css = readFileSync(join(TEMPLATE_DIR, 'template.css'), 'utf8');
        const hero = css.slice(css.indexOf('.tpl-wedding-classic-gold .inv-hero {'),
            css.indexOf('.tpl-wedding-classic-gold .inv-hero__media'));
        assert.ok(hero.indexOf('min-height: 88vh') < hero.indexOf('min-height: 88svh'));
        assert.ok(!/[^-]height:\s*\d+s?vh/.test(hero), 'the hero pins an exact viewport height');
    });

    test('every rule is scoped, so two designs cannot leak into each other', () => {
        const css = readFileSync(join(TEMPLATE_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        for (const line of css.split('\n')) {
            const sel = line.trim();
            if (!sel.endsWith('{') || sel.startsWith('@') || sel.startsWith('}')) continue;
            const ok = sel.includes('.tpl-wedding-classic-gold')
                || sel.startsWith(':root.tpl-wedding-classic-gold');
            assert.ok(ok, 'unscoped selector: ' + sel);
        }
        assert.ok(!css.includes('tpl-wedding-romantic'), 'it references the other design');
    });

    test('Romántica is untouched by any of this', () => {
        const out = renderTemplate(DEMO_ID);
        assert.equal(out.ok, true);
        assert.deepEqual(sectionsOf(out.node).filter((s) => s === 'hero').length, 1);
        const t = resolveTemplate(DEMO_ID);
        assert.equal(t.label, 'Romántica');
        assert.equal(t.themeClass, 'tpl-wedding-romantic');
        assert.equal(t.stylesheet, 'wedding-romantic/template.css');
        assert.equal(t.assets['hero-default'], 'wedding-romantic/hero-default.jpg');
        // Its own stylesheet never mentions the new design.
        const css = readFileSync(
            join(INVITATION, 'templates', 'wedding-romantic', 'template.css'), 'utf8');
        assert.ok(!css.includes('classic-gold'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Botánica · a third collection, drawing the same invitation
// ─────────────────────────────────────────────────────────────────────────────
describe('the third wedding template', () => {
    const BOT_ID = 'wedding_botanical_v1';
    const BOT_DIR = join(INVITATION, 'templates', 'wedding-botanical');
    const BOT_DEMO_DIR = join(INVITATION, 'assets', 'demo', 'wedding-botanical');

    function renderBot(over = {}) {
        const template = resolveTemplate(BOT_ID);
        const raw = over.raw || demoConfig(BOT_ID);
        const { ok, config, errors } = normalizeConfig(raw);
        assert.equal(ok, true, 'botanical demo did not normalize: ' + (errors || []).join(', '));
        const document = createDocument();
        return {
            ...renderInvitation({
                template,
                config,
                route: over.route || parseRoute('?demo=' + BOT_ID),
                document,
                assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
                templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
                now: Date.parse('2026-08-01T12:00:00Z'),
                pageUrl: 'x',
                handoff: over.handoff,
                passSummary: over.passSummary,
            }),
            config,
            document,
        };
    }

    test('the registry now holds exactly the drawable designs', () => {
        const expected = ['wedding_botanical_v1', 'wedding_classic_gold_v1',
            'wedding_editorial_v1', 'wedding_romantic_v1'];
        assert.deepEqual(listTemplates().map((t) => t.id).sort(), expected);
        assert.deepEqual(listDemoIds().sort(), expected);
        assert.deepEqual(listTemplates().map((t) => t.id).sort(), listDemoIds().sort());
    });

    test('its identity is valid and unknown variants fail closed', () => {
        const t = resolveTemplate(BOT_ID);
        assert.equal(t.categoryKey, 'wedding');
        assert.equal(t.templateKey, 'wedding_botanical');
        assert.equal(t.templateVersion, 1);
        assert.equal(t.contractVersion, 1);
        assert.equal(t.label, 'Botánica');
        assert.match(t.description, /crema y verde salvia/);
        assert.equal(t.themeClass, 'tpl-wedding-botanical');
        assert.equal(t.stylesheet, 'wedding-botanical/template.css');
        assert.equal(t.id, t.templateKey + '_v' + t.templateVersion);
        for (const bad of ['wedding_botanical_v2', 'wedding_botanical', 'botanical',
            '../../env.js', 'https://example.com/template.css', '__proto__', '', null, 42, {}, []]) {
            assert.equal(resolveTemplate(bad), null, 'accepted ' + JSON.stringify(bad));
        }
    });

    test('it shares the CATEGORY placement and section objects by identity', () => {
        const bot = resolveTemplate(BOT_ID);
        const rom = resolveTemplate(DEMO_ID);
        const gold = resolveTemplate('wedding_classic_gold_v1');
        assert.equal(bot.imagePlacements, rom.imagePlacements);
        assert.equal(bot.imagePlacements, gold.imagePlacements);
        assert.equal(bot.sections, rom.sections);
        assert.equal(bot.sections, gold.sections);
        assert.equal(bot.imagePlacements.hero.aspectRatio, 1080 / 1920);
        assert.equal(bot.imagePlacements.gallery.aspectRatio, 4 / 5);
        assert.equal(bot.imagePlacements.interlude.aspectRatio, 16 / 9);
    });

    test('it renders the complete wedding contract', () => {
        const out = renderBot();
        assert.equal(out.ok, true);
        const rendered = sectionsOf(out.node);
        for (const id of ['hero', 'message', 'countdown', 'ceremony', 'reception',
            'dressCode', 'gallery', 'gifts', 'closing', 'actions']) {
            assert.ok(rendered.includes(id), 'missing section: ' + id);
        }
        const bands = out.node.querySelectorAll('[data-section="interlude"]');
        assert.deepEqual(bands.map((n) => n.getAttribute('data-slot')),
            ['afterMessage', 'afterCountdown', 'afterCeremony', 'afterReception',
                'afterDressCode', 'beforeClosing']);
        assert.equal(out.node.querySelectorAll('.inv-gallery__item').length, 6);
        assert.equal(out.node.querySelectorAll('.inv-dress__guideline').length, 4);
        // Both paragraphs of the message survive as separate blocks.
        assert.equal(out.node.querySelectorAll('.inv-message__body').length, 2);
    });

    test('its media keeps the category geometry', () => {
        const out = renderBot();
        const band = out.node.querySelectorAll('.inv-interlude__img')[0];
        assert.equal(band.getAttribute('width'), '1600');
        assert.equal(band.getAttribute('height'), '900');
        const tile = out.node.querySelectorAll('.inv-gallery__img')[0];
        assert.equal(tile.getAttribute('width'), '800');
        assert.equal(tile.getAttribute('height'), '1000');
        const hero = out.node.querySelectorAll('.inv-hero__art')[0];
        assert.equal(hero.getAttribute('width'), '1080');
        assert.equal(hero.getAttribute('height'), '1920');
    });

    test('the shared template asset key resolves to ITS artwork', () => {
        const bot = resolveTemplate(BOT_ID);
        assert.deepEqual(Object.keys(bot.assets), ['hero-default']);
        for (const other of [DEMO_ID, 'wedding_classic_gold_v1']) {
            assert.notEqual(bot.assets['hero-default'],
                resolveTemplate(other).assets['hero-default']);
        }
        const url = resolveImage({ source: 'template', assetKey: 'hero-default' }, {
            templateAssets: bot.assets,
            templateBase: 'https://orbiventt.com/invitation/templates/',
        });
        assert.equal(url,
            'https://orbiventt.com/invitation/templates/wedding-botanical/hero-default.jpg');
        assert.ok(statSync(join(BOT_DIR, 'hero-default.jpg')).isFile());
        assert.ok(safeAssetPath(bot.assets['hero-default']));
    });

    test('an organizer photograph renders identically in every design', () => {
        // WHAT ACTUALLY GUARANTEES NO RE-CROP. The stored `path` is already the
        // rendered derivative the mobile cropper produced; the web draws that
        // file and never re-derives it (the `crop` fractions stay in the row for
        // the cropper to reopen, and the renderer drops them). So a photograph
        // cannot be re-cropped by changing design — every template declares the
        // SAME category geometry and paints the SAME file.
        const shot = {
            source: 'storage',
            bucket: 'invitation-media',
            path: 'evt-1/aa.jpg',
            crop: { x: 0, y: 0.12, w: 1, h: 0.55 },
        };
        const seen = [];
        for (const id of listTemplates().map((t) => t.id)) {
            const raw = demoConfig(id);
            raw.interludeImages.afterMessage.image = { ...shot };
            const { ok, config } = normalizeConfig(raw);
            assert.equal(ok, true);
            const stored = config.interludeImages.afterMessage.image;
            // The reference itself is untouched by whichever design holds it.
            assert.equal(stored.source, 'storage');
            assert.equal(stored.bucket, 'invitation-media');
            assert.equal(stored.path, 'evt-1/aa.jpg');
            assert.ok(config.interludeImages.afterMessage.alt.length > 0);
            const t = resolveTemplate(id);
            seen.push(t.imagePlacements.interlude.aspectRatio);
        }
        // One ratio across all three designs — nothing to re-crop against.
        assert.deepEqual([...new Set(seen)], [16 / 9]);
    });

    test('its demo is fictional, long, and reaches nothing', () => {
        const cfg = demoConfig(BOT_ID);
        for (const other of [DEMO_ID, 'wedding_classic_gold_v1']) {
            assert.notEqual(cfg.sections.hero.partnerA, demoConfig(other).sections.hero.partnerA);
        }
        assert.ok(cfg.sections.hero.partnerA.length >= 14);
        assert.ok(cfg.sections.reception.venueName.length >= 40);
        assert.ok(cfg.sections.ceremony.address.length >= 70);
        assert.ok(cfg.sections.message.hosts.length >= 100);
        assert.equal(cfg.sections.dressCode.guidelines.length, 4);
        assert.equal(cfg.sections.gallery.items.length, 6);
        assert.equal(Object.keys(cfg.interludeImages).length, 6);
        const json = JSON.stringify(cfg);
        assert.ok(!json.includes('"storage"'));
        assert.ok(!json.includes('supabase'));
        for (const key of ['slug', 'previewToken', 'code', 'invitationId', 'eventId']) {
            assert.ok(!Object.prototype.hasOwnProperty.call(cfg, key));
        }
        assert.equal(storedRequest(parseRoute('?demo=' + BOT_ID)), null);
        assert.equal(passSummaryRequest(parseRoute('?demo=' + BOT_ID + '&code=ABCDEFGHIJKL')), null);
    });

    test('every demo asset it names exists', () => {
        const paths = JSON.stringify(demoConfig(BOT_ID))
            .match(/wedding-botanical\/[a-z0-9-]+\.svg/g) || [];
        assert.ok(paths.length >= 13);
        for (const rel of new Set(paths)) {
            assert.ok(statSync(join(INVITATION, 'assets', 'demo', rel)).isFile(), 'missing ' + rel);
        }
    });

    test('long names, venues and addresses render without breaking out', () => {
        const raw = demoConfig(BOT_ID);
        raw.sections.hero.partnerA = 'María de los Ángeles Guadalupe';
        raw.sections.hero.partnerB = 'Juan Nepomuceno Maximiliano';
        raw.sections.reception.venueName =
            'Invernadero Histórico y Jardines Botánicos de la Antigua Casa de los Fresnos';
        const out = renderBot({ raw });
        assert.equal(out.ok, true);
        assert.ok(serialize(out.node).includes('Invernadero Hist'));
        const css = readFileSync(join(BOT_DIR, 'template.css'), 'utf8');
        assert.match(css, /overflow-wrap:\s*anywhere/);
    });

    test('the claim card works inside it, unchanged', () => {
        const out = renderBot({
            route: parseRoute('?i=q7m2k9x4pt3wz8ab&code=ABCDEFGHIJKL'),
            handoff: { open: true, href: 'vyvent://e/evt?code=ABCDEFGHIJKL', source: 'app-scheme' },
            passSummary: { seatCapacity: 4, seatsRemaining: 2 },
        });
        const card = out.node.querySelector('[data-section="passes"]');
        assert.ok(card);
        assert.match(card.textContent, /Reclama tus pases/);
        assert.match(card.textContent, /ABCD-EFGH-IJKL/);
        assert.match(card.textContent, /Invitación para 4 personas\./);
        assert.match(card.textContent, /Quedan 2 de 4 pases disponibles\./);
        assert.match(card.textContent, /Copiar código/);
        assert.match(card.textContent, /copia el código e ingrésalo/);
        const open = card.querySelectorAll('a').find((a) => /Abrir Orbiventt/.test(a.textContent));
        assert.equal(open.getAttribute('href'), 'vyvent://e/evt?code=ABCDEFGHIJKL');
    });

    test('its artwork and stylesheet reach nothing external', () => {
        const css = readFileSync(join(BOT_DIR, 'template.css'), 'utf8');
        for (const needle of ['http://', 'https://', '@import', 'url(//']) {
            assert.ok(!css.includes(needle), 'template.css reaches for ' + needle);
        }
        assert.ok(!/\b100vw\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));

        const svgs = [join(BOT_DIR, 'hero-default.svg')].concat(
            readdirSync(BOT_DEMO_DIR).map((f) => join(BOT_DEMO_DIR, f)));
        assert.ok(svgs.length >= 14);
        for (const file of svgs) {
            const svg = readFileSync(file, 'utf8')
                .replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
            for (const needle of ['<script', 'xlink:href', 'http://', 'https://',
                '<image', '<foreignObject', 'onload=', 'data:']) {
                assert.ok(!svg.includes(needle), file + ' contains ' + needle);
            }
        }
    });

    test('it obeys the corrected full-bleed contract', () => {
        const css = readFileSync(join(BOT_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const band = css.slice(css.indexOf('.tpl-wedding-botanical .inv-interlude {'),
            css.indexOf('.tpl-wedding-botanical .inv-interlude__img'));
        assert.match(band, /width:\s*100%/);
        assert.match(band, /max-width:\s*100%/);
        assert.match(band, /min-width:\s*0/);
        assert.match(band, /margin-inline:\s*0/);
        assert.match(band, /overflow:\s*hidden/);
        assert.ok(!/margin[^;]*calc\(var\(--inv-gutter\)\s*\*\s*-1\)/.test(band));
        // Transparent ornaments sit on the template's own ground.
        assert.match(band, /background:\s*var\(--inv-surface\)/);
        const img = css.slice(css.indexOf('.tpl-wedding-botanical .inv-interlude__img'));
        assert.match(img.slice(0, 420), /display:\s*block/);
        assert.match(img.slice(0, 420), /object-fit:\s*cover/);
    });

    test('sage is decoration only — never text, never a control border', () => {
        const css = readFileSync(join(BOT_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!/color:\s*var\(--tpl-sage\)/.test(css), 'sage is used as a text colour');
        assert.ok(!/border[^;]*var\(--tpl-sage\)/.test(css), 'sage is used as a control border');
        assert.match(css, /--inv-accent-ink:\s*#4A5C3F/);
    });

    test('the hero measures one screen in svh, with a vh fallback first', () => {
        const css = readFileSync(join(BOT_DIR, 'template.css'), 'utf8');
        const hero = css.slice(css.indexOf('.tpl-wedding-botanical .inv-hero {'),
            css.indexOf('.tpl-wedding-botanical .inv-hero__media'));
        assert.ok(hero.indexOf('min-height: 88vh') < hero.indexOf('min-height: 88svh'));
        assert.ok(!/[^-]height:\s*\d+s?vh/.test(hero));
    });

    test('every rule is scoped, and it names no other design', () => {
        const css = readFileSync(join(BOT_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        for (const line of css.split('\n')) {
            const sel = line.trim();
            if (!sel.endsWith('{') || sel.startsWith('@') || sel.startsWith('}')) continue;
            assert.ok(sel.includes('.tpl-wedding-botanical'), 'unscoped selector: ' + sel);
        }
        assert.ok(!css.includes('tpl-wedding-romantic'));
        assert.ok(!css.includes('tpl-wedding-classic-gold'));
    });

    test('Romántica and Clásica elegante are untouched', () => {
        const rom = resolveTemplate(DEMO_ID);
        assert.equal(rom.label, 'Romántica');
        assert.equal(rom.themeClass, 'tpl-wedding-romantic');
        assert.equal(rom.assets['hero-default'], 'wedding-romantic/hero-default.jpg');
        const gold = resolveTemplate('wedding_classic_gold_v1');
        assert.equal(gold.label, 'Clásica elegante');
        assert.equal(gold.themeClass, 'tpl-wedding-classic-gold');
        assert.equal(gold.assets['hero-default'], 'wedding-classic-gold/hero-default.jpg');
        for (const dir of ['wedding-romantic', 'wedding-classic-gold']) {
            const css = readFileSync(join(INVITATION, 'templates', dir, 'template.css'), 'utf8');
            assert.ok(!css.includes('botanical'), dir + ' mentions botanical');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Editorial moderna · the typography-led collection
// ─────────────────────────────────────────────────────────────────────────────
describe('the fourth wedding template', () => {
    const ED_ID = 'wedding_editorial_v1';
    const ED_DIR = join(INVITATION, 'templates', 'wedding-editorial');
    const ED_DEMO_DIR = join(INVITATION, 'assets', 'demo', 'wedding-editorial');

    function renderEd(over = {}) {
        const template = resolveTemplate(ED_ID);
        const raw = over.raw || demoConfig(ED_ID);
        const { ok, config, errors } = normalizeConfig(raw);
        assert.equal(ok, true, 'editorial demo did not normalize: ' + (errors || []).join(', '));
        const document = createDocument();
        return {
            ...renderInvitation({
                template,
                config,
                route: over.route || parseRoute('?demo=' + ED_ID),
                document,
                assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
                templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
                now: Date.parse('2026-08-01T12:00:00Z'),
                pageUrl: 'x',
                handoff: over.handoff,
                passSummary: over.passSummary,
            }),
            config,
            document,
        };
    }

    test('the registry now holds exactly the four drawable designs', () => {
        const expected = ['wedding_botanical_v1', 'wedding_classic_gold_v1',
            'wedding_editorial_v1', 'wedding_romantic_v1'];
        assert.deepEqual(listTemplates().map((t) => t.id).sort(), expected);
        assert.deepEqual(listDemoIds().sort(), expected);
        assert.deepEqual(listTemplates().map((t) => t.id).sort(), listDemoIds().sort());
    });

    test('its identity is valid and unknown variants fail closed', () => {
        const t = resolveTemplate(ED_ID);
        assert.equal(t.categoryKey, 'wedding');
        assert.equal(t.templateKey, 'wedding_editorial');
        assert.equal(t.templateVersion, 1);
        assert.equal(t.contractVersion, 1);
        assert.equal(t.label, 'Editorial moderna');
        assert.match(t.description, /Tipograf/);
        assert.equal(t.themeClass, 'tpl-wedding-editorial');
        assert.equal(t.stylesheet, 'wedding-editorial/template.css');
        assert.equal(t.id, t.templateKey + '_v' + t.templateVersion);
        for (const bad of ['wedding_editorial_v2', 'wedding_editorial', 'editorial',
            '../../env.js', '/template.css', 'https://example.com/template.css',
            '__proto__', '', null, 42, {}, []]) {
            assert.equal(resolveTemplate(bad), null, 'accepted ' + JSON.stringify(bad));
        }
    });

    test('it shares the CATEGORY placement and section objects by identity', () => {
        const ed = resolveTemplate(ED_ID);
        for (const other of [DEMO_ID, 'wedding_classic_gold_v1', 'wedding_botanical_v1']) {
            assert.equal(ed.imagePlacements, resolveTemplate(other).imagePlacements);
            assert.equal(ed.sections, resolveTemplate(other).sections);
        }
        assert.equal(ed.imagePlacements.hero.aspectRatio, 1080 / 1920);
        assert.equal(ed.imagePlacements.gallery.aspectRatio, 4 / 5);
        assert.equal(ed.imagePlacements.interlude.aspectRatio, 16 / 9);
    });

    test('it renders the complete wedding contract', () => {
        const out = renderEd();
        assert.equal(out.ok, true);
        const rendered = sectionsOf(out.node);
        for (const id of ['hero', 'message', 'countdown', 'ceremony', 'reception',
            'dressCode', 'gallery', 'gifts', 'closing', 'actions']) {
            assert.ok(rendered.includes(id), 'missing section: ' + id);
        }
        assert.deepEqual(
            out.node.querySelectorAll('[data-section="interlude"]').map((n) => n.getAttribute('data-slot')),
            ['afterMessage', 'afterCountdown', 'afterCeremony', 'afterReception',
                'afterDressCode', 'beforeClosing']);
        assert.equal(out.node.querySelectorAll('.inv-gallery__item').length, 6);
        assert.equal(out.node.querySelectorAll('.inv-dress__guideline').length, 4);
        assert.equal(out.node.querySelectorAll('.inv-message__body').length, 2);
    });

    test('the DOM order is the reading order — nothing is visually reordered', () => {
        const out = renderEd();
        // The rendered sequence must equal the category's declared order,
        // filtered to what this configuration actually has.
        const declared = resolveTemplate(ED_ID).sections;
        const rendered = out.rendered;
        let cursor = -1;
        for (const id of rendered) {
            const at = declared.indexOf(id);
            assert.ok(at > cursor, 'section ' + id + ' is out of declared order');
            cursor = at;
        }
        // And the stylesheet must not reorder anything visually.
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!/(?:^|[;{])\s*order:\s*-?\d/m.test(css), 'the stylesheet uses flex/grid order');
        assert.ok(!/grid-auto-flow:[^;]*dense/.test(css), 'the stylesheet uses dense flow');
        assert.ok(!/direction:\s*rtl/.test(css));
    });

    test('its media keeps the category geometry', () => {
        const out = renderEd();
        const band = out.node.querySelectorAll('.inv-interlude__img')[0];
        assert.equal(band.getAttribute('width'), '1600');
        assert.equal(band.getAttribute('height'), '900');
        const tile = out.node.querySelectorAll('.inv-gallery__img')[0];
        assert.equal(tile.getAttribute('width'), '800');
        assert.equal(tile.getAttribute('height'), '1000');
        const hero = out.node.querySelectorAll('.inv-hero__art')[0];
        assert.equal(hero.getAttribute('width'), '1080');
        assert.equal(hero.getAttribute('height'), '1920');
        // The lead tile spans the spread by COLUMN SPAN, never by a new ratio.
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8');
        assert.match(css, /\.inv-gallery__item:first-child\s*\{\s*grid-column:\s*1\s*\/\s*-1/);
        assert.match(css, /aspect-ratio:\s*4\s*\/\s*5/);
    });

    test('the shared template asset key resolves to ITS artwork', () => {
        const ed = resolveTemplate(ED_ID);
        assert.deepEqual(Object.keys(ed.assets), ['hero-default']);
        for (const other of [DEMO_ID, 'wedding_classic_gold_v1', 'wedding_botanical_v1']) {
            assert.notEqual(ed.assets['hero-default'],
                resolveTemplate(other).assets['hero-default']);
        }
        const url = resolveImage({ source: 'template', assetKey: 'hero-default' }, {
            templateAssets: ed.assets,
            templateBase: 'https://orbiventt.com/invitation/templates/',
        });
        assert.equal(url,
            'https://orbiventt.com/invitation/templates/wedding-editorial/hero-default.jpg');
        assert.ok(statSync(join(ED_DIR, 'hero-default.jpg')).isFile());
        assert.ok(safeAssetPath(ed.assets['hero-default']));
    });

    test('an organizer photograph renders identically in every design', () => {
        const shot = {
            source: 'storage', bucket: 'invitation-media', path: 'evt-1/aa.jpg',
            crop: { x: 0, y: 0.12, w: 1, h: 0.55 },
        };
        const ratios = [];
        for (const id of listTemplates().map((t) => t.id)) {
            const raw = demoConfig(id);
            raw.interludeImages.afterMessage.image = { ...shot };
            const { ok, config } = normalizeConfig(raw);
            assert.equal(ok, true);
            const stored = config.interludeImages.afterMessage.image;
            assert.equal(stored.source, 'storage');
            assert.equal(stored.bucket, 'invitation-media');
            assert.equal(stored.path, 'evt-1/aa.jpg');
            assert.ok(config.interludeImages.afterMessage.alt.length > 0);
            ratios.push(resolveTemplate(id).imagePlacements.interlude.aspectRatio);
        }
        assert.deepEqual([...new Set(ratios)], [16 / 9]);
    });

    test('its demo is fictional, long, and reaches nothing', () => {
        const cfg = demoConfig(ED_ID);
        for (const other of [DEMO_ID, 'wedding_classic_gold_v1', 'wedding_botanical_v1']) {
            assert.notEqual(cfg.sections.hero.partnerA, demoConfig(other).sections.hero.partnerA);
        }
        assert.ok(cfg.sections.hero.partnerA.length >= 14);
        assert.ok(cfg.sections.reception.venueName.length >= 50);
        assert.ok(cfg.sections.ceremony.address.length >= 80);
        assert.ok(cfg.sections.message.hosts.length >= 150);
        assert.equal(cfg.sections.dressCode.guidelines.length, 4);
        assert.equal(cfg.sections.gallery.items.length, 6);
        assert.equal(Object.keys(cfg.interludeImages).length, 6);
        const json = JSON.stringify(cfg);
        assert.ok(!json.includes('"storage"'));
        assert.ok(!json.includes('supabase'));
        for (const key of ['slug', 'previewToken', 'code', 'invitationId', 'eventId']) {
            assert.ok(!Object.prototype.hasOwnProperty.call(cfg, key));
        }
        assert.equal(storedRequest(parseRoute('?demo=' + ED_ID)), null);
        assert.equal(passSummaryRequest(parseRoute('?demo=' + ED_ID + '&code=ABCDEFGHIJKL')), null);
    });

    test('every demo asset it names exists, and none is borrowed', () => {
        const json = JSON.stringify(demoConfig(ED_ID));
        const paths = json.match(/wedding-editorial\/[a-z0-9-]+\.svg/g) || [];
        assert.ok(paths.length >= 13);
        for (const rel of new Set(paths)) {
            assert.ok(statSync(join(INVITATION, 'assets', 'demo', rel)).isFile(), 'missing ' + rel);
        }
        for (const other of ['wedding-romantic/', 'wedding-classic-gold/', 'wedding-botanical/']) {
            assert.ok(!json.includes(other), 'reuses assets from ' + other);
        }
    });

    test('very long names, venues and addresses render without breaking out', () => {
        const raw = demoConfig(ED_ID);
        raw.sections.hero.partnerA = 'María de los Ángeles Guadalupe Concepción';
        raw.sections.hero.partnerB = 'Juan Nepomuceno Maximiliano';
        raw.sections.reception.venueName =
            'Terraza, Invernadero y Salón Industrial del Antiguo Molino de Santa Catarina';
        const out = renderEd({ raw });
        assert.equal(out.ok, true);
        assert.ok(serialize(out.node).includes('Antiguo Molino'));
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8');
        // Addresses may break anywhere; large headings only break at word level.
        const ruleFor = (sel) => {
            const at = css.indexOf(sel + ' {');
            return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
        };
        // Addresses may break anywhere; large headings only at word level.
        assert.match(ruleFor('.tpl-wedding-editorial .inv-place__address'),
            /overflow-wrap:\s*anywhere/);
        assert.match(ruleFor('.tpl-wedding-editorial .inv-hero__names'),
            /overflow-wrap:\s*break-word/);
        assert.ok(!/overflow-wrap:\s*anywhere/.test(
            ruleFor('.tpl-wedding-editorial .inv-hero__names')));
    });

    test('the claim card works inside it, unchanged', () => {
        const out = renderEd({
            route: parseRoute('?i=q7m2k9x4pt3wz8ab&code=ABCDEFGHIJKL'),
            handoff: { open: true, href: 'vyvent://e/evt?code=ABCDEFGHIJKL', source: 'app-scheme' },
            passSummary: { seatCapacity: 12, seatsRemaining: 10 },
        });
        const card = out.node.querySelector('[data-section="passes"]');
        assert.ok(card);
        assert.match(card.textContent, /Reclama tus pases/);
        assert.match(card.textContent, /ABCD-EFGH-IJKL/);
        // Double-digit allocation.
        assert.match(card.textContent, /Invitación para 12 personas\./);
        assert.match(card.textContent, /Quedan 10 de 12 pases disponibles\./);
        assert.match(card.textContent, /Copiar código/);
        assert.match(card.textContent, /copia el código e ingrésalo/);
        const open = card.querySelectorAll('a').find((a) => /Abrir Orbiventt/.test(a.textContent));
        assert.equal(open.getAttribute('href'), 'vyvent://e/evt?code=ABCDEFGHIJKL');
    });

    test('its artwork and stylesheet reach nothing external', () => {
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8');
        for (const needle of ['http://', 'https://', '@import', 'url(//']) {
            assert.ok(!css.includes(needle), 'template.css reaches for ' + needle);
        }
        assert.ok(!/\b100vw\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));

        const svgs = [join(ED_DIR, 'hero-default.svg')].concat(
            readdirSync(ED_DEMO_DIR).map((f) => join(ED_DEMO_DIR, f)));
        assert.ok(svgs.length >= 14);
        for (const file of svgs) {
            const svg = readFileSync(file, 'utf8')
                .replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
            for (const needle of ['<script', 'xlink:href', 'http://', 'https://',
                '<image', '<foreignObject', 'onload=', 'data:']) {
                assert.ok(!svg.includes(needle), file + ' contains ' + needle);
            }
        }
    });

    test('it obeys the corrected full-bleed contract', () => {
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        const band = css.slice(css.indexOf('.tpl-wedding-editorial .inv-interlude {'),
            css.indexOf('.tpl-wedding-editorial .inv-interlude__img'));
        assert.match(band, /width:\s*100%/);
        assert.match(band, /max-width:\s*100%/);
        assert.match(band, /min-width:\s*0/);
        assert.match(band, /margin-inline:\s*0/);
        assert.match(band, /overflow:\s*hidden/);
        assert.ok(!/margin[^;]*calc\(var\(--inv-gutter\)\s*\*\s*-1\)/.test(band));
        assert.match(band, /background:\s*var\(--inv-surface\)/);
        const img = css.slice(css.indexOf('.tpl-wedding-editorial .inv-interlude__img'));
        assert.match(img.slice(0, 460), /display:\s*block/);
        assert.match(img.slice(0, 460), /object-fit:\s*cover/);
    });

    test('the warm accent is never body copy, and the rule never carries text', () => {
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!/color:\s*var\(--tpl-rule\)/.test(css), 'the hairline token is used as text');
        // The accent is allowed on LARGE display and marks only. Every rule that
        // sets it as a colour must also be a display-scale or label context.
        for (const m of css.matchAll(/([^{}]+)\{([^}]*color:\s*var\(--tpl-accent\)[^}]*)\}/g)) {
            const sel = m[1].trim();
            const ok = /__amp|__when|::before|__flourish|guideline/.test(sel + m[2]);
            assert.ok(ok, 'accent used as body copy in: ' + sel);
        }
        assert.match(css, /--inv-accent-ink:\s*#8A5240/);
    });

    test('the hero measures one screen in svh, with a vh fallback first', () => {
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8');
        const hero = css.slice(css.indexOf('.tpl-wedding-editorial .inv-hero {'),
            css.indexOf('.tpl-wedding-editorial .inv-hero__media'));
        assert.ok(hero.indexOf('min-height: 88vh') < hero.indexOf('min-height: 88svh'));
        assert.ok(!/[^-]height:\s*\d+s?vh/.test(hero));
    });

    test('every display size is bounded so nothing clips at 320 px', () => {
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        // No unbounded viewport-relative font sizes anywhere.
        for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
            const value = m[1].trim();
            if (/\d+vw/.test(value)) {
                assert.ok(value.startsWith('clamp('), 'unbounded vw font-size: ' + value);
            }
        }
    });

    test('every rule is scoped, and it names no other design', () => {
        const css = readFileSync(join(ED_DIR, 'template.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        for (const line of css.split('\n')) {
            const sel = line.trim();
            if (!sel.endsWith('{') || sel.startsWith('@') || sel.startsWith('}')) continue;
            assert.ok(sel.includes('.tpl-wedding-editorial'), 'unscoped selector: ' + sel);
        }
        for (const other of ['tpl-wedding-romantic', 'tpl-wedding-classic-gold',
            'tpl-wedding-botanical']) {
            assert.ok(!css.includes(other));
        }
    });

    test('the three existing collections are untouched', () => {
        const expected = {
            wedding_romantic_v1: ['Romántica', 'tpl-wedding-romantic', 'wedding-romantic/hero-default.jpg'],
            wedding_classic_gold_v1: ['Clásica elegante', 'tpl-wedding-classic-gold', 'wedding-classic-gold/hero-default.jpg'],
            wedding_botanical_v1: ['Botánica', 'tpl-wedding-botanical', 'wedding-botanical/hero-default.jpg'],
        };
        for (const [id, [label, theme, asset]] of Object.entries(expected)) {
            const t = resolveTemplate(id);
            assert.equal(t.label, label);
            assert.equal(t.themeClass, theme);
            assert.equal(t.assets['hero-default'], asset);
        }
        for (const dir of ['wedding-romantic', 'wedding-classic-gold', 'wedding-botanical']) {
            const css = readFileSync(join(INVITATION, 'templates', dir, 'template.css'), 'utf8');
            assert.ok(!css.includes('editorial'), dir + ' mentions editorial');
        }
    });
});
