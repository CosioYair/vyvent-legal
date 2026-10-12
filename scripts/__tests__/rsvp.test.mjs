/**
 * CONFIRMAR ASISTENCIA (web reply page) — contract tests.
 *
 *   node --test scripts/__tests__/
 *
 * The page answers an EXISTING Smart Invitation by its existing code — there
 * is no new invitation type — so most of what is pinned here is a boundary:
 * the code never reaches a query string after capture, localStorage, a log,
 * the title or a third-party host; the backend allowlist is exactly three
 * RPCs; every guest-typed string renders as TEXT (the DOM stub's innerHTML
 * throws); the pass QR is drawn ONLY from a server payload of the exact shape;
 * the gallery shows ONLY the photos the invitation resolved and fetches
 * nothing to show them; the app path is the app's own one-tap handoff; and
 * the two entry points (the invitation's pass card and /e/{id}?code=) point
 * at this page with the code in the FRAGMENT.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { createDocument, serialize } from './dom-stub.mjs';
import { resolveTemplate } from '../../invitation/js/registry.js';
import { demoConfig } from '../../invitation/js/demo-data.js';
import { normalizeConfig } from '../../invitation/js/config.js';
import { renderInvitation } from '../../invitation/js/renderer.js';
import { parseRoute } from '../../invitation/js/route.js';
import { rsvpHref } from '../../invitation/js/sections/passes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RSVP = join(ROOT, 'rsvp');
const read = (...p) => readFileSync(join(RSVP, ...p), 'utf8');
const HTML = read('index.html');
const CSS = read('css', 'rsvp.css');
const LANDING = readFileSync(join(ROOT, '404.html'), 'utf8');
const VENDOR = read('vendor', 'qrcode-generator.js');

const { WEB_BUILD, SHARED_DIRS, DEV_SUPABASE_REF, DEV_SITE_ORIGIN } = await import(
    pathToFileURL(join(ROOT, 'scripts', 'web-env.mjs')).href
);

const load = (file) => import(pathToFileURL(join(RSVP, 'js', file)).href);
const session = await load('session.js');
const backend = await load('backend.js');
const qr = await load('qr.js');
const gallery = await load('gallery.js');
const ui = await load('ui.js');

/** The vendored UMD encoder, evaluated the way a classic script would be. */
// eslint-disable-next-line no-new-func
const qrcode = new Function('exports', 'module', 'define', VENDOR + '\nreturn qrcode;')();

const CODE = 'ABCDEFGHIJKL';
const EVENT_ID = '91000001-0000-4000-8000-000000000001';
const SUPA = 'https://mfaymuisnpfdolqogktx.supabase.co';
const OBJ = SUPA + '/storage/v1/object/public/';
const RETURN_URL = 'exp://192.168.1.5:8081/--/e/' + EVENT_ID;
const storageUrl = backend.storageUrlResolver(SUPA);
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ── fixtures ──────────────────────────────────────────────────────────────── */

const PHOTOS = [
    { path: 'u1/cover.jpg', created_at: '2026-10-01T20:00:00Z' },
    { path: 'u1/a.jpg', created_at: '2026-10-02T20:00:00Z' },
    { path: 'u1/b.jpg', created_at: '2026-10-03T20:00:00Z' },
];

function payload(over = {}) {
    return {
        status: 'ok',
        event: {
            id: EVENT_ID,
            title: 'Cumple de Ana',
            description: 'Trae ganas.\n\nHabrá pastel.',
            starts_at: '2027-04-17T23:00:00Z',
            ends_at: '2027-04-18T03:00:00Z',
            address: 'Calle Hidalgo 12, Colima',
            latitude: 19.2433,
            longitude: -103.7247,
            is_cancelled: false,
            is_finished: false,
            qr_enabled: false,
            cover_path: 'u1/cover.jpg',
            gallery_paths: ['u1/cover.jpg', 'u1/a.jpg', 'u1/b.jpg'],
            photos: PHOTOS,
            photo_count: 3,
            organizer: { display_name: 'Ana Ruiz', avatar_path: 'u1/avatar.jpg' },
            ...(over.event || {}),
        },
        invitation: {
            label: 'Familia Pérez',
            greeting: 'Los esperamos con mucho cariño.',
            seat_capacity: 4,
            seats_remaining: 3,
            expires_at: null,
            is_expired: false,
            accepting_responses: true,
            ...(over.invitation || {}),
        },
        invitation_image: 'invitation_image' in over ? over.invitation_image : null,
        parties: over.parties || [],
    };
}

const ATTENDING = {
    id: 'p1', party_name: 'Luis Pérez', rsvp_status: 'attending', seats: 2,
    decline_note: null, updated_at: '2026-10-11T00:00:00Z',
    companions: [{ position: 2, name: 'Marta' }], assigned_items: [],
};
const DECLINED = {
    id: 'p2', party_name: 'Rosa Díaz', rsvp_status: 'declined', seats: 0,
    decline_note: 'Estaré de viaje', updated_at: '2026-10-11T00:00:00Z', companions: [], assigned_items: [],
};
const HANDOFF = { open: true, href: 'vyvent://e/' + EVENT_ID + '?code=' + CODE, source: 'app-scheme', reason: null };
const EXPO = { open: true, href: RETURN_URL + '?code=' + CODE, source: 'expo-go', reason: null };
const CLOSED = { open: false, href: null, source: 'none', reason: 'expo-go-required' };
const INTENT = 'intent://e/' + EVENT_ID + '?code=' + CODE + '#Intent;scheme=vyvent;package=com.vyvent.mobile;S.browser_fallback_url=x;end';
const plan = (over = {}) => ({ strategy: 'ios-scheme-fallback', href: HANDOFF.href, storeUrl: 'https://apps.apple.com/app/id6788249586', platform: 'ios', arm: () => () => {}, ...over });

const P1 = 'OVP1:ABCDEFGH23456789:JKMNPQRSTVWXYZ01';
const P2 = 'OVP1:0123456789ABCDEF:ZYXWVTSRQPNMKJHG';
function passesOk(over = {}) {
    return {
        status: 'ok', event_id: EVENT_ID, party_id: 'p1', qr_enabled: true, holder_label: 'Luis Pérez', seats: 2,
        passes: [
            { handle: 'ABCDEFGH23456789', pos: 1, occupant_kind: 'holder', state: 'active', payload: P1, occupant_label: 'Luis Pérez', checked_in_at: null },
            { handle: '0123456789ABCDEF', pos: 2, occupant_kind: 'name', state: 'active', payload: P2, occupant_label: 'Marta', checked_in_at: null },
        ],
        ...over,
    };
}

function ready(p, over = {}) {
    return { phase: 'ready', code: CODE, payload: p, view: 'idle', editing: null, managing: null, passes: null, result: null, ...over };
}

function render(model, handlers = {}, opts = {}) {
    const document = createDocument();
    const node = ui.renderApp(model, handlers, { document, storageUrl, qrcode, now: Date.parse('2026-10-11T18:00:00Z'), ...opts });
    return { node, document, html: serialize(node), text: node.textContent };
}

const buttons = (node, label) => node.querySelectorAll('button').filter((b) => b.textContent === label);
const links = (node, label) => node.querySelectorAll('a').filter((a) => a.textContent === label);
const byId = (node, id) => node.querySelector('[id="' + id + '"]');
const pathButtons = (node, title) => node.querySelectorAll('.rsvp-btn--path').filter((b) => b.querySelector('strong').textContent === title);
const appPaths = (node) => node.querySelectorAll('.rsvp-btn--path-app');
const primaries = (node) => node.querySelectorAll('.rsvp-btn--primary');
const warnings = (node) => node.querySelectorAll('.rsvp-warning');
const qrs = (node) => node.querySelectorAll('.rsvp-qr');
const manages = (node) => buttons(node, 'Administrar mis pases');
const answerClasses = (node) => node.querySelector('.rsvp-answer').children.map((c) => c.getAttribute('class') || '');
const tiles = (node) => node.querySelectorAll('.rsvp-gallery__tile');
const storageImgs = (node) => node.querySelectorAll('img').filter((i) => !(i.getAttribute('class') || '').includes('rsvp-path__icon'));

/* ── The code: transport, storage, stripping ──────────────────────────────── */

describe('code capture', () => {
    test('reads #c= from the fragment, in any shape the guest may have', () => {
        assert.equal(session.parseFragment('#c=ABCD-EFGH-IJKL'), CODE);
        assert.equal(session.parseFragment('#c=abcdefghijkl'), CODE);
        assert.equal(session.parseFragment('c=' + CODE), CODE);
    });

    test('rejects anything that cannot be a 12-character code', () => {
        assert.equal(session.parseFragment('#c=short'), null);
        assert.equal(session.parseFragment('#s=' + CODE), null);
        assert.equal(session.parseFragment(''), null);
        assert.equal(session.parseFragment(null), null);
        assert.equal(session.normalizeCode('ABCD-EFGH-IJKL-MNOP'), null);
    });

    test('persists to sessionStorage and strips the fragment to the bare pathname', () => {
        const win = fakeWindow({ hash: '#c=ABCD-EFGH-IJKL' });
        assert.equal(session.captureCode(win), CODE);
        assert.equal(win.sessionStorage.store[session.STORAGE_KEY], CODE);
        assert.deepEqual(win.history.calls, [[null, '', '/vyvent-legal/rsvp/']]);
    });

    test('accepts the legacy ?code= forms ONCE and normalizes them away', () => {
        for (const search of ['?code=ABCD-EFGH-IJKL', '?i=mi-boda&code=abcdefghijkl']) {
            const win = fakeWindow({ search, hash: '' });
            assert.equal(session.captureCode(win), CODE);
            assert.equal(win.sessionStorage.store[session.STORAGE_KEY], CODE);
            assert.deepEqual(win.history.calls, [[null, '', '/vyvent-legal/rsvp/']]);
        }
    });

    test('the fragment wins over a legacy query', () => {
        const win = fakeWindow({ search: '?code=ZZZZZZZZZZZZ', hash: '#c=' + CODE });
        assert.equal(session.captureCode(win), CODE);
    });

    test('recovers after a reload, once the URL is bare', () => {
        const win = fakeWindow({ hash: '' });
        win.sessionStorage.store[session.STORAGE_KEY] = CODE;
        assert.equal(session.captureCode(win), CODE);
        assert.deepEqual(win.history.calls, []);
    });

    test('refuses a corrupted stored value and clearCode forgets it', () => {
        const win = fakeWindow({ hash: '' });
        win.sessionStorage.store[session.STORAGE_KEY] = 'garbage';
        assert.equal(session.captureCode(win), null);
        win.sessionStorage.store[session.STORAGE_KEY] = CODE;
        session.clearCode(win);
        assert.equal(win.sessionStorage.store[session.STORAGE_KEY], undefined);
    });

    test('displayCode groups the canonical form the way the app does', () => {
        assert.equal(session.displayCode(CODE), 'ABCD-EFGH-IJKL');
        assert.equal(session.displayCode('abcd efgh ijkl'), 'ABCD-EFGH-IJKL');
    });

    test('localStorage is never touched anywhere in rsvp/js', () => {
        for (const file of jsFiles()) {
            assert.equal(/localStorage/.test(stripComments(read('js', file))), false, `${file} references localStorage`);
        }
    });

    test('nothing is ever logged — no console call in any file', () => {
        for (const file of jsFiles()) {
            assert.equal(/console\.(log|warn|info|debug|error)/.test(stripComments(read('js', file))), false, `${file} contains a console call`);
        }
    });

    test('the code never reaches document.title, and the title is generic', () => {
        for (const file of jsFiles()) {
            assert.equal(/document\.title/.test(stripComments(read('js', file))), false, `${file} writes document.title`);
        }
        assert.match(HTML, /<title>Confirmar asistencia · Orbiventt<\/title>/);
        assert.equal(/#c=|\?code=/.test(HTML), false, 'the document carries a code shape');
    });
});

/* ── The app's return address (DEV one-tap handoff) ───────────────────────── */

describe('return address capture', () => {
    test('reads r= from the fragment beside the code, remembers it for the tab, then the code capture strips both', () => {
        const win = fakeWindow({ hash: '#c=' + CODE + '&r=' + encodeURIComponent(RETURN_URL) });
        assert.equal(session.captureReturn(win), RETURN_URL);
        assert.equal(win.sessionStorage.store[session.RETURN_KEY], RETURN_URL);
        assert.equal(session.captureCode(win), CODE);
        assert.deepEqual(win.history.calls, [[null, '', '/vyvent-legal/rsvp/']]);
        // After the strip, both survive a reload from the tab.
        const again = fakeWindow({ hash: '' });
        again.sessionStorage.store[session.STORAGE_KEY] = CODE;
        again.sessionStorage.store[session.RETURN_KEY] = RETURN_URL;
        assert.equal(session.captureReturn(again), RETURN_URL);
        assert.equal(session.captureCode(again), CODE);
    });

    test('accepts the legacy ?app_return= query the other pages read', () => {
        const win = fakeWindow({ search: '?code=' + CODE + '&app_return=' + encodeURIComponent(RETURN_URL), hash: '' });
        assert.equal(session.captureReturn(win), RETURN_URL);
    });

    test('only an Expo Go address of a safe shape is ever kept — this module is not the validator, app-return.js is', () => {
        for (const bad of ['https://evil.example/--/e/x', 'javascript:alert(1)', 'vyvent://e/x', 'exp://a b', 'exp://x/`', 'exp://' + 'a'.repeat(200), '', null]) {
            assert.equal(session.safeReturn(bad), null, String(bad));
        }
        assert.equal(session.safeReturn('exps://tunnel.exp.direct/--/e/' + EVENT_ID), 'exps://tunnel.exp.direct/--/e/' + EVENT_ID);
        const win = fakeWindow({ hash: '#c=' + CODE + '&r=' + encodeURIComponent('https://evil.example/') });
        assert.equal(session.captureReturn(win), null);
        assert.equal(win.sessionStorage.store[session.RETURN_KEY], undefined);
    });

    test('a dead link forgets the return address with the code', () => {
        const win = fakeWindow({ hash: '' });
        win.sessionStorage.store[session.STORAGE_KEY] = CODE;
        win.sessionStorage.store[session.RETURN_KEY] = RETURN_URL;
        session.clearCode(win);
        assert.equal(win.sessionStorage.store[session.RETURN_KEY], undefined);
    });

    test('main.js captures the return address BEFORE the code strips the bar and hands it ONLY to app-return.js', () => {
        const main = stripComments(read('js', 'main.js'));
        assert.match(main, /import \{[^}]*\bcaptureReturn\b[^}]*\} from '\.\/session\.js/);
        const ret = main.indexOf('model.appReturn = captureReturn(window);');
        const code = main.indexOf('var code = captureCode(window);');
        assert.ok(ret !== -1 && code !== -1 && ret < code, 'the return address must be read before the address bar is stripped');
        assert.match(main, /RETURN\.resolveAppHandoff\(\{[\s\S]*?appReturn: model\.appReturn,[\s\S]*?kind: 'e',[\s\S]*?id: String\(model\.payload\.event\.id\),[\s\S]*?code: model\.code,/);
        // Nowhere else is the raw value used: never placed in an href by this page.
        assert.equal((main.match(/appReturn/g) || []).length, 4, 'appReturn is read in more places than the model field, its capture and the resolver');
    });
});

/* ── Backend surface ───────────────────────────────────────────────────────── */

describe('backend', () => {
    const env = { supaUrl: 'https://x.supabase.co', supaAnon: 'anon' };

    test('the RPC allowlist is closed to exactly the three guest functions', async () => {
        const calls = [];
        const fetchStub = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }; };
        assert.notEqual(await backend.callRpc('guest_resolve_invitation', {}, { fetch: fetchStub, env }), null);
        assert.notEqual(await backend.callRpc('guest_respond', {}, { fetch: fetchStub, env }), null);
        assert.notEqual(await backend.callRpc('guest_get_passes', {}, { fetch: fetchStub, env }), null);
        for (const forbidden of [
            'get_event_web_rsvps', 'claim_smart_invitation', 'get_published_invitation', 'get_my_event_passes',
            'scanner_check_in', 'get_public_event_preview', 'publish_invitation', 'assign_bring_item_to_party',
            'get_event_photos', 'event_photos',
        ]) {
            assert.equal(await backend.callRpc(forbidden, {}, { fetch: fetchStub, env }), null, forbidden);
        }
        assert.equal(calls.length, 3);
        assert.ok(calls.every((u) => u.startsWith('https://x.supabase.co/rest/v1/rpc/guest_')));
    });

    test('fails closed with no env, a network error, or a non-400 failure', async () => {
        assert.equal(await backend.callRpc('guest_respond', {}, { env: {}, fetch: async () => ({ ok: true }) }), null);
        assert.equal(await backend.callRpc('guest_respond', {}, { env, fetch: async () => { throw new Error('offline'); } }), null);
        assert.equal(await backend.callRpc('guest_respond', {}, { env, fetch: async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) }), null);
        assert.equal(await backend.callRpc('guest_respond', {}, { env, fetch: async () => ({ ok: true, status: 200, json: async () => [1] }) }), null);
    });

    test('a PostgREST 400 with a Spanish message becomes {status:"error", message} verbatim', async () => {
        const message = 'Solo queda(n) 2 pase(s) disponible(s) en esta invitación.';
        const res = await backend.callRpc('guest_respond', {}, {
            env, fetch: async () => ({ ok: false, status: 400, json: async () => ({ message, code: 'P0001' }) }),
        });
        assert.deepEqual(res, { status: 'error', message });
        assert.equal(await backend.callRpc('guest_respond', {}, {
            env, fetch: async () => ({ ok: false, status: 400, json: async () => ({}) }),
        }), null);
    });

    test('respond sends exactly the contract body — never an event or invitation id', async () => {
        const bodies = [];
        const fetchStub = async (_u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }; };
        await backend.respond(CODE, { partyId: null, name: 'Luis', status: 'attending', seats: 3, companions: ['Ana', ''], note: 'ignored' }, { env, fetch: fetchStub });
        await backend.respond(CODE, { partyId: 'p1', name: 'Rosa', status: 'declined', seats: 9, companions: ['x'], note: 'Viajo' }, { env, fetch: fetchStub });
        assert.deepEqual(bodies[0], { p_code: CODE, p_party_id: null, p_party_name: 'Luis', p_status: 'attending', p_seats: 3, p_companions: ['Ana', ''], p_note: null });
        assert.deepEqual(bodies[1], { p_code: CODE, p_party_id: 'p1', p_party_name: 'Rosa', p_status: 'declined', p_seats: 0, p_companions: null, p_note: 'Viajo' });
        for (const b of bodies) assert.ok(!('p_event_id' in b) && !('p_invitation_id' in b));
    });

    test('getPasses sends the code and the party id, nothing else', async () => {
        const bodies = [];
        const urls = [];
        const fetchStub = async (u, init) => { urls.push(u); bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => passesOk() }; };
        const res = await backend.getPasses(CODE, 'p1', { env, fetch: fetchStub });
        assert.equal(res.status, 'ok');
        assert.deepEqual(bodies, [{ p_code: CODE, p_party_id: 'p1' }]);
        assert.equal(urls[0], 'https://x.supabase.co/rest/v1/rpc/guest_get_passes');
    });

    test('storage URLs resolve only our three buckets, safely encoded, same origin', () => {
        assert.equal(storageUrl('event-photos', 'u1/a b.jpg'), OBJ + 'event-photos/u1/a%20b.jpg');
        assert.equal(storageUrl('avatars', 'u1/av.jpg'), OBJ + 'avatars/u1/av.jpg');
        assert.equal(storageUrl('invitation-media', 'di/x.jpg'), OBJ + 'invitation-media/di/x.jpg');
        assert.equal(storageUrl('stories', 'x.jpg'), null);
        assert.equal(storageUrl('event-chat-media', 'x.jpg'), null);
        assert.equal(storageUrl('event-photos', '../x.jpg'), null);
        assert.equal(storageUrl('event-photos', '/x.jpg'), null);
        assert.equal(storageUrl('event-photos', 'https://evil/x.jpg'), null);
        assert.equal(storageUrl('event-photos', null), null);
    });
});

/* ── Every state renders ───────────────────────────────────────────────────── */

describe('states', () => {
    test('loading', () => {
        assert.match(render({ phase: 'loading' }).text, /Buscando tu invitación/);
    });

    test('not_found / rate_limited / error share ONE neutral state with a muted store link', () => {
        const out = render({ phase: 'unavailable', retryable: false }, {}, { storeUrl: 'https://play.google.com/x' });
        assert.match(out.text, /Esta invitación no está disponible\./);
        const link = links(out.node, 'Conoce Orbiventt')[0];
        assert.ok(link, 'no store link');
        assert.equal(link.getAttribute('href'), 'https://play.google.com/x');
        assert.ok(link.parentNode.getAttribute('class').includes('rsvp-muted'));
        assert.equal(buttons(out.node, 'Reintentar').length, 0, 'a terminal state offered a retry');
        assert.equal(render({ phase: 'unavailable' }).node.querySelectorAll('a').length, 0);
    });

    test('a transport failure keeps the code and offers Reintentar', () => {
        let retried = 0;
        const out = render({ phase: 'unavailable', retryable: true }, { onRetry: () => { retried += 1; } });
        buttons(out.node, 'Reintentar')[0].dispatch('click');
        assert.equal(retried, 1);
    });

    test('code entry: one field, normalized on submit, Enter works, errors stay inline', () => {
        const got = [];
        const out = render({ phase: 'enter-code', entryError: 'No encontramos una invitación con ese código.' }, { onCode: (v) => got.push(v) });
        assert.match(out.text, /¿Tienes un código de invitación\?/);
        assert.match(out.text, /No encontramos una invitación con ese código\./);
        const input = byId(out.node, 'rsvp-code');
        input.value = 'abcd-efgh-ijkl';
        buttons(out.node, 'Continuar')[0].dispatch('click');
        input.dispatch('keydown', { key: 'Enter' });
        assert.deepEqual(got, ['abcd-efgh-ijkl', 'abcd-efgh-ijkl']);
        assert.equal(session.normalizeCode(got[0]), CODE);
    });

    test('cancelled, finished and expired banners — cancelled wins, response controls hidden', () => {
        const cancelled = render(ready(payload({ event: { is_cancelled: true, is_finished: true }, invitation: { accepting_responses: false } })));
        assert.match(cancelled.text, /Este evento fue cancelado\./);
        assert.equal(/ya terminó/.test(cancelled.text), false);
        const finished = render(ready(payload({ event: { is_finished: true }, invitation: { accepting_responses: false } })));
        assert.match(finished.text, /Este evento ya terminó\./);
        const expired = render(ready(payload({ invitation: { is_expired: true, accepting_responses: false } })));
        assert.match(expired.text, /Esta invitación ya no está activa\./);
        for (const out of [cancelled, finished, expired]) {
            assert.equal(out.node.querySelectorAll('.rsvp-btn--path').length, 0, 'the path choice rendered on a closed invitation');
            assert.equal(out.node.querySelectorAll('input').length, 0);
            assert.equal(primaries(out.node).length, 0);
            assert.equal(warnings(out.node).length, 0, 'a link warning with nothing to protect');
            assert.equal(manages(out.node).length, 0, 'a manage action with no party');
        }
        // Existing answers are still visible, read-only — but an EXPIRED link
        // still shows the passes it already granted: the door is still ahead.
        const expiredParty = render(ready(payload({ invitation: { is_expired: true, accepting_responses: false }, parties: [ATTENDING] })));
        assert.match(expiredParty.text, /Luis Pérez/);
        assert.equal(buttons(expiredParty.node, 'Cambiar mi respuesta').length, 0);
        assert.equal(expiredParty.node.querySelectorAll('.rsvp-btn--path').length, 0);
        assert.equal(manages(expiredParty.node).length, 1);
        for (const closed of [{ is_finished: true }, { is_cancelled: true }]) {
            const out = render(ready(payload({ event: closed, invitation: { accepting_responses: false }, parties: [ATTENDING] })));
            assert.equal(manages(out.node).length, 0, 'passes offered for an event with no door');
            assert.equal(buttons(out.node, 'Cambiar mi respuesta').length, 0);
        }
        assert.equal(render(ready(payload())).node.querySelectorAll('.rsvp-banner').length, 0);
    });

    test('first visit: the event card, the photos, es-MX date, map, NO calendar, the warning, then ONE two-path choice with no primary', () => {
        const chosen = [];
        const out = render(ready(payload()), { onChoose: (...a) => chosen.push(a) });
        assert.match(out.text, /Te invita Ana Ruiz/);
        assert.match(out.text, /Cumple de Ana/);
        assert.match(out.text, /Familia Pérez/);
        assert.match(out.text, /Los esperamos con mucho cariño\./);
        assert.match(out.text, /sábado, 17 de abril de 2027 · 17:00 h – 21:00 h/);
        assert.match(out.text, /Calle Hidalgo 12, Colima/);
        assert.match(out.text, /Habrá pastel\./);

        const map = links(out.node, 'Cómo llegar')[0];
        assert.equal(map.getAttribute('href'), 'https://www.google.com/maps/search/?api=1&query=19.243300%2C-103.724700');
        assert.equal(map.getAttribute('rel'), 'noopener noreferrer');
        assert.equal(links(out.node, 'Agregar al calendario').length, 0, 'the calendar control is back');
        assert.equal(/calendario/i.test(out.text), false);
        assert.equal(out.node.querySelectorAll('a').filter((a) => (a.getAttribute('href') || '').startsWith('data:')).length, 0);

        assert.ok(storageImgs(out.node).every((i) => i.getAttribute('src').startsWith(OBJ)));
        assert.equal(out.node.querySelectorAll('.rsvp-event__cover').length, 1);
        assert.equal(out.node.querySelectorAll('.rsvp-event__avatar').length, 1);
        // The gallery: the cover is the hero, so two tiles remain; the count names all three.
        assert.match(out.text, /Galería · 3 fotos/);
        assert.equal(tiles(out.node).length, 2, 'the hero cover repeats as a tile');

        // The event card, the warning, then ONE deliberate choice: two real
        // paths, no primary, no standalone CTA.
        assert.match(out.text, /Confirmar asistencia/);
        assert.equal(buttons(out.node, 'Confirmar asistencia').length, 0, 'the old standalone primary CTA is back');
        assert.equal(out.node.querySelectorAll('.rsvp-btn--path').length, 2);
        assert.equal(primaries(out.node).length, 0, 'a primary control on the path choice');
        assert.equal(warnings(out.node).length, 1, 'the warning must lead the first visit');
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-warning') && classes[1].includes('rsvp-prompt'), classes.join(' | '));
        assert.equal(buttons(out.node, 'Responder como otra persona').length, 0);
        assert.equal(manages(out.node).length, 0, 'a manage action with no party');
        pathButtons(out.node, 'Confirmar desde la web')[0].dispatch('click');
        pathButtons(out.node, 'Prefiero usar Orbiventt')[0].dispatch('click');
        assert.deepEqual(chosen, [['choose', null], ['app', null]]);
    });

    test('the first image is the invitation thumbnail, then the event cover, then nothing', () => {
        const media = render(ready(payload({ invitation_image: { bucket: 'invitation-media', path: 'di/thumb.jpg', width: 1200, height: 630 } })));
        const first = media.node.querySelector('.rsvp-event__cover');
        assert.equal(first.getAttribute('src'), OBJ + 'invitation-media/di/thumb.jpg');
        assert.ok(first.getAttribute('class').includes('rsvp-event__cover--invitation'));
        assert.equal(media.node.querySelectorAll('img')[0], first, 'the thumbnail is not the first image on the page');
        // The event cover is no longer the hero, so it joins the grid.
        assert.equal(tiles(media.node).length, 3);

        const photos = render(ready(payload({ invitation_image: { bucket: 'event-photos', path: 'u1/share.jpg' } })));
        assert.equal(photos.node.querySelector('.rsvp-event__cover').getAttribute('src'), OBJ + 'event-photos/u1/share.jpg');

        // A thumbnail from a bucket this page may not read falls back to the cover.
        const bad = render(ready(payload({ invitation_image: { bucket: 'stories', path: 'x.jpg' } })));
        assert.equal(bad.node.querySelector('.rsvp-event__cover').getAttribute('src'), OBJ + 'event-photos/u1/cover.jpg');
        assert.ok(bad.node.querySelector('.rsvp-event__cover').getAttribute('class').includes('rsvp-event__cover--cover'));

        const none = render(ready(payload({ invitation_image: null, event: { cover_path: null, gallery_paths: [], photos: [], photo_count: 0 } })));
        assert.equal(none.node.querySelectorAll('.rsvp-event__cover').length, 0);
        assert.deepEqual(ui.firstImage({ invitation_image: { bucket: 'invitation-media', path: '../x' }, event: { cover_path: null } }, storageUrl), null);
    });

    test('relative day copy: Hoy / Mañana / Este <día> within six days, full date otherwise (America/Mexico_City)', () => {
        // Tuesday 2026-10-13, 14:00 in Mexico City (UTC-6, no DST).
        const now = Date.parse('2026-10-13T20:00:00Z');
        assert.equal(ui.relativeDay('2026-10-14T01:00:00Z', now), 'Hoy');          // 13 Oct 19:00 local
        assert.equal(ui.relativeDay('2026-10-14T04:30:00Z', now), 'Hoy');          // 13 Oct 22:30 local — still today here
        assert.equal(ui.relativeDay('2026-10-13T14:00:00Z', now), 'Hoy');          // started this morning, still today
        assert.equal(ui.relativeDay('2026-10-15T00:00:00Z', now), 'Mañana');       // 14 Oct 18:00 local
        assert.equal(ui.relativeDay('2026-10-16T00:00:00Z', now), 'Este jueves');  // +2
        assert.equal(ui.relativeDay('2026-10-18T00:00:00Z', now), 'Este sábado');  // +4
        assert.equal(ui.relativeDay('2026-10-20T00:00:00Z', now), 'Este lunes');   // +6, the last relative day
        assert.equal(ui.relativeDay('2026-10-21T00:00:00Z', now), null);           // +7 → full date only
        assert.equal(ui.relativeDay('2027-04-17T23:00:00Z', now), null);
        assert.equal(ui.relativeDay('2026-10-12T20:00:00Z', now), null);           // yesterday → never "Hoy"
        assert.equal(ui.relativeDay('garbage', now), null);
        // Year boundary: Wednesday 30 Dec 2026 → Friday 1 Jan 2027 is +2.
        const dec = Date.parse('2026-12-30T18:00:00Z');
        assert.equal(ui.relativeDay('2027-01-02T02:00:00Z', dec), 'Este viernes');
        assert.equal(ui.relativeDay('2026-12-31T18:00:00Z', dec), 'Mañana');
        assert.equal(ui.relativeDay('2027-01-06T18:00:00Z', dec), null);           // +7

        // The lines: lead + full, or full alone.
        const near = ui.whenLines({ starts_at: '2026-10-16T00:00:00Z', ends_at: '2026-10-16T04:00:00Z', is_finished: false }, now);
        assert.equal(near.lead, 'Este jueves · 18:00 h');
        assert.equal(near.full, 'jueves, 15 de octubre de 2026 · 18:00 h – 22:00 h');
        assert.equal(ui.whenLines({ starts_at: '2026-10-14T01:00:00Z', is_finished: false }, now).lead, 'Hoy · 19:00 h');
        assert.equal(ui.whenLines({ starts_at: '2026-10-14T01:00:00Z', is_finished: true }, now).lead, null, 'a finished event reads as "Hoy"');
        assert.equal(ui.whenLines({ starts_at: '2027-04-17T23:00:00Z' }, now).lead, null);
        assert.deepEqual(ui.whenLines({ starts_at: null }, now), { lead: null, full: '' });

        // Rendered: the lead is a bold first line, the full date stays as <time>.
        const out = render(ready(payload({ event: { starts_at: '2026-10-16T00:00:00Z', ends_at: '2026-10-16T04:00:00Z' } })), {}, { now });
        assert.equal(out.node.querySelector('.rsvp-event__when-lead').textContent, 'Este jueves · 18:00 h');
        assert.equal(out.node.querySelector('.rsvp-event__when-full').textContent, 'jueves, 15 de octubre de 2026 · 18:00 h – 22:00 h');
        assert.equal(out.node.querySelector('time').getAttribute('datetime'), '2026-10-16T00:00:00Z');
        const far = render(ready(payload()), {}, { now });
        assert.equal(far.node.querySelectorAll('.rsvp-event__when-lead').length, 0);
        assert.equal(far.node.querySelector('time').textContent, 'sábado, 17 de abril de 2027 · 17:00 h – 21:00 h');
    });

    test('web path: the warning above, Sí/No, the app benefits inside, one primary', () => {
        const chosen = [];
        const out = render(ready(payload(), { view: 'choose' }), { onChoose: (...a) => chosen.push(a), onCancel: () => chosen.push(['cancel']) });
        assert.match(out.text, /¿Nos acompañas\?/);
        assert.equal(warnings(out.node).length, 1);
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-warning') && classes[1].includes('rsvp-choice-card'), classes.join(' | '));
        assert.match(out.text, /Este enlace es tu llave/);
        assert.match(out.text, /Con Orbiventt también puedes:/);
        assert.deepEqual(out.node.querySelector('.rsvp-benefits').querySelectorAll('li').map((li) => li.textContent),
            ['Chat del evento', 'Compartir fotos', 'Comentarios y reacciones', 'Notificaciones', 'Itinerario']);
        assert.equal(primaries(out.node).length, 1);
        assert.equal(primaries(out.node)[0].textContent, 'Sí, asistiré');
        buttons(out.node, 'Sí, asistiré')[0].dispatch('click');
        buttons(out.node, 'No podré asistir')[0].dispatch('click');
        buttons(out.node, 'Prefiero usar Orbiventt')[0].dispatch('click');
        buttons(out.node, 'Cancelar')[0].dispatch('click');
        assert.deepEqual(chosen, [['attend', null], ['decline', null], ['app', null], ['cancel']]);

        const full = render(ready(payload({ invitation: { seats_remaining: 0 } }), { view: 'choose' }), { onChoose: (...a) => chosen.push(a) });
        assert.equal(buttons(full.node, 'Sí, asistiré')[0].disabled, true);
        assert.match(full.text, /ya no tiene pases disponibles/);
        buttons(full.node, 'Sí, asistiré')[0].dispatch('click');
        assert.equal(chosen.length, 4, 'a disabled answer still fired');
        // Changing an attending party re-takes its own seats, so it stays enabled — and gets no benefits pitch.
        const editing = render(ready(payload({ invitation: { seats_remaining: 0 }, parties: [ATTENDING] }), { view: 'choose', editing: ATTENDING }));
        assert.equal(buttons(editing.node, 'Sí, asistiré')[0].disabled, false);
        assert.match(editing.text, /Cambiar mi respuesta/);
        assert.equal(editing.node.querySelectorAll('.rsvp-benefits').length, 0);
        assert.equal(warnings(editing.node).length, 1);
    });
});

/* ── The app path: one tap, the code as the fallback ──────────────────────── */

describe('app path', () => {
    test('with the handoff open, "Prefiero usar Orbiventt" IS the one-tap handoff: an armed anchor carrying this event and code', () => {
        const armed = [];
        const chosen = [];
        const out = render(ready(payload()), { onChoose: (...a) => chosen.push(a) }, { handoff: HANDOFF, smartOpen: plan({ arm: (a) => { armed.push(a); return () => {}; } }) });
        const app = appPaths(out.node);
        assert.equal(app.length, 1);
        assert.equal(app[0].tagName, 'a');
        assert.equal(app[0].getAttribute('href'), 'vyvent://e/' + EVENT_ID + '?code=' + CODE);
        assert.equal(app[0].getAttribute('data-state'), 'open');
        assert.deepEqual(armed, [app[0]], 'the smart-open fallback is not armed');
        assert.equal(app[0].querySelector('strong').textContent, 'Prefiero usar Orbiventt');
        assert.match(app[0].textContent, /Se abre con tu invitación lista/);
        assert.equal(app[0].querySelector('.rsvp-path__icon').getAttribute('src'), 'favicon-96x96.png', 'the app path wears the app icon');
        assert.ok(!app[0].getAttribute('class').includes('rsvp-btn--primary'), 'the app path must not be THE primary');
        assert.equal(primaries(out.node).length, 0);
        // The code is never shown on this screen; the manual route is a quiet link behind it.
        assert.equal(/ABCD-EFGH-IJKL/.test(out.text), false);
        buttons(out.node, 'Abrir con el código manualmente')[0].dispatch('click');
        assert.deepEqual(chosen, [['app', null]]);

        // Android: the intent URL from the plan; iOS/scheme: the plan's href; DEV Expo Go: the validated return address.
        const android = render(ready(payload()), {}, { handoff: HANDOFF, smartOpen: { strategy: 'android-intent', href: INTENT, storeUrl: 'x', platform: 'android', arm: () => () => {} } });
        assert.equal(appPaths(android.node)[0].getAttribute('href'), INTENT);
        const dev = render(ready(payload()), {}, { handoff: EXPO, smartOpen: null });
        assert.equal(appPaths(dev.node)[0].getAttribute('href'), RETURN_URL + '?code=' + CODE);
        assert.equal(appPaths(dev.node)[0].tagName, 'a');
    });

    test('with the handoff closed, the app path leads to the app screen; no quiet fallback link is offered', () => {
        const chosen = [];
        for (const handoff of [null, CLOSED]) {
            const out = render(ready(payload()), { onChoose: (...a) => chosen.push(a) }, { handoff });
            const app = appPaths(out.node);
            assert.equal(app.length, 1);
            assert.equal(app[0].tagName, 'button');
            assert.equal(app[0].getAttribute('data-state'), 'closed');
            assert.equal(app[0].hasAttribute('href'), false);
            assert.match(app[0].textContent, /Chat, fotos, notificaciones y más\./);
            assert.equal(buttons(out.node, 'Abrir con el código manualmente').length, 0);
            app[0].dispatch('click');
        }
        assert.deepEqual(chosen, [['app', null], ['app', null]]);
    });

    test('app screen (handoff open): Abrir Orbiventt is the ONE primary, the benefits, then the code as the fallback with Copiar código', async () => {
        const armed = [];
        const written = [];
        const calls = [];
        const out = render(ready(payload(), { view: 'app' }), { onCancel: () => calls.push('cancel') }, {
            handoff: HANDOFF, smartOpen: plan({ arm: (a) => { armed.push(a); return () => {}; } }),
            navigator: { clipboard: { writeText: (v) => { written.push(v); return Promise.resolve(); } } },
        });
        assert.equal(out.node.querySelector('.rsvp-app-path').getAttribute('data-view'), 'app');
        assert.match(out.text, /Prefiero usar Orbiventt/);
        assert.match(out.text, /Orbiventt se abre con tu invitación lista para reclamar y asignar tus pases\./);
        const open = links(out.node, 'Abrir Orbiventt');
        assert.equal(open.length, 1);
        assert.equal(open[0].getAttribute('href'), HANDOFF.href);
        assert.deepEqual(armed, [open[0]]);
        assert.equal(primaries(out.node).length, 1);
        assert.equal(primaries(out.node)[0], open[0]);
        assert.equal(links(out.node, 'Descargar Orbiventt').length, 0);
        // The code is the FALLBACK: after the benefits and the open control, never the headline.
        const classes = out.node.querySelector('.rsvp-app-path').children.map((c) => c.getAttribute('class') || '');
        assert.ok(classes.indexOf('rsvp-actions') < classes.indexOf('rsvp-fallback'), classes.join(' | '));
        assert.match(out.node.querySelector('.rsvp-fallback').textContent, /¿No se abre\? Ingresa este código en Orbiventt:/);
        assert.match(out.node.querySelector('.rsvp-code').textContent, /^ABCD-EFGH-IJKL$/);
        assert.equal(/copia el código e ingrésalo manualmente/i.test(out.text), false, 'the manual-entry instruction is the message again');
        assert.equal(warnings(out.node).length, 0, 'the app screen on a first visit has no link to protect yet');
        assert.equal(out.node.querySelectorAll('.rsvp-btn--path').length, 0, 'the path choice rendered beside the app screen');
        buttons(out.node, 'Copiar código')[0].dispatch('click');
        await tick();
        assert.equal(out.node.querySelector('.rsvp-status').textContent, 'Código copiado');
        assert.deepEqual(written, ['ABCD-EFGH-IJKL']);
        buttons(out.node, 'Volver')[0].dispatch('click');
        assert.deepEqual(calls, ['cancel']);
    });

    test('app screen (handoff closed): the store for this device is the primary, the code stays the fallback; no store → the code alone', () => {
        for (const handoff of [null, CLOSED]) {
            const closed = render(ready(payload(), { view: 'app' }), {}, { handoff, storeUrl: 'https://play.google.com/x' });
            assert.equal(links(closed.node, 'Abrir Orbiventt').length, 0, 'a closed handoff still rendered an open control');
            const store = links(closed.node, 'Descargar Orbiventt');
            assert.equal(store.length, 1);
            assert.equal(store[0].getAttribute('href'), 'https://play.google.com/x');
            assert.ok(store[0].getAttribute('class').includes('rsvp-btn--primary'));
            assert.match(closed.text, /Instala Orbiventt y abre tu invitación desde la app/);
            assert.match(closed.text, /ABCD-EFGH-IJKL/);
            assert.equal(buttons(closed.node, 'Copiar código').length, 1);
        }
        const bare = render(ready(payload(), { view: 'app' }), {}, { handoff: CLOSED });
        assert.equal(primaries(bare.node).length, 0);
        assert.equal(bare.node.querySelector('.rsvp-app-path').querySelectorAll('a').length, 0, 'an open or store control with nothing to open');
        assert.match(bare.text, /ABCD-EFGH-IJKL/);
    });

    test('appHandoff prefers the smart-open plan href and exposes its arm; closed → null', () => {
        assert.deepEqual(ui.appHandoff({ handoff: HANDOFF, smartOpen: null }), { href: HANDOFF.href, arm: null });
        const p = plan({ href: INTENT });
        assert.equal(ui.appHandoff({ handoff: HANDOFF, smartOpen: p }).href, INTENT);
        assert.equal(ui.appHandoff({ handoff: HANDOFF, smartOpen: p }).arm, p.arm);
        assert.equal(ui.appHandoff({ handoff: CLOSED, smartOpen: p }), null);
        assert.equal(ui.appHandoff({ handoff: null }), null);
        assert.equal(ui.appHandoff({}), null);
    });
});

/* ── Forms ─────────────────────────────────────────────────────────────────── */

describe('attending form', () => {
    test('the stepper runs 1..max and the companion inputs follow it; the warning stays above', () => {
        const out = render(ready(payload(), { view: 'attend' }));
        assert.match(out.text, /Tienes hasta 3 pases/);
        assert.equal(warnings(out.node).length, 1);
        assert.ok(answerClasses(out.node)[0].includes('rsvp-warning'));
        const seats = byId(out.node, 'rsvp-seats');
        const minus = out.node.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Menos pases');
        const plus = out.node.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Más pases');
        const companions = () => out.node.querySelector('.rsvp-companions').querySelectorAll('input');
        const labels = () => out.node.querySelector('.rsvp-companions').querySelectorAll('label').map((l) => l.textContent);

        assert.equal(seats.textContent, '1');
        assert.equal(companions().length, 0);
        assert.equal(minus.disabled, true);
        plus.dispatch('click'); plus.dispatch('click'); plus.dispatch('click'); plus.dispatch('click');
        assert.equal(seats.textContent, '3', 'the stepper exceeded the maximum');
        assert.equal(plus.disabled, true);
        assert.deepEqual(labels(), ['Acompañante 2', 'Acompañante 3']);
        companions()[0].value = 'Marta';
        minus.dispatch('click');
        assert.equal(seats.textContent, '2');
        assert.deepEqual(labels(), ['Acompañante 2']);
        assert.equal(companions()[0].value, 'Marta', 'a typed companion name was lost on re-render');
        assert.equal(primaries(out.node).length, 1);
    });

    test('changing an answer prefills name, seats and companions; max includes own seats', () => {
        const out = render(ready(payload({ parties: [ATTENDING] }), { view: 'attend', editing: ATTENDING }));
        assert.equal(byId(out.node, 'rsvp-name').value, 'Luis Pérez');
        assert.equal(byId(out.node, 'rsvp-seats').textContent, '2');
        assert.equal(byId(out.node, 'rsvp-companion-2').value, 'Marta');
        assert.match(out.text, /Tienes hasta 5 pases/);
        assert.equal(ui.maxSeatsFor(payload().invitation, ATTENDING), 5);
        assert.equal(ui.maxSeatsFor(payload().invitation, DECLINED), 3);
    });

    test('a missing name never reaches the server; a valid answer does, with party_id', async () => {
        const sent = [];
        const handlers = { onSubmit: async (a) => { sent.push(a); return { ok: true }; } };
        const out = render(ready(payload({ parties: [ATTENDING] }), { view: 'attend', editing: ATTENDING }), handlers);
        byId(out.node, 'rsvp-name').value = '   ';
        buttons(out.node, 'Confirmar')[0].dispatch('click');
        await tick();
        assert.equal(sent.length, 0);
        assert.match(out.node.querySelector('[role="alert"]').textContent, /Escribe tu nombre\./);

        byId(out.node, 'rsvp-name').value = '  Luis  Pérez ';
        buttons(out.node, 'Confirmar')[0].dispatch('click');
        await tick();
        assert.deepEqual(sent, [{ partyId: 'p1', name: 'Luis Pérez', status: 'attending', seats: 2, companions: ['Marta'], note: null }]);
    });

    test('a server message is shown verbatim and the form is re-enabled', async () => {
        const message = 'Solo queda(n) 2 pase(s) disponible(s) en esta invitación.';
        const out = render(ready(payload(), { view: 'attend' }), { onSubmit: async () => ({ ok: false, message }) });
        byId(out.node, 'rsvp-name').value = 'Luis';
        const confirm = buttons(out.node, 'Confirmar')[0];
        confirm.dispatch('click');
        assert.equal(confirm.disabled, true, 'not disabled while pending');
        await tick(); await tick();
        assert.equal(out.node.querySelector('[role="alert"]').textContent, message);
        assert.equal(confirm.disabled, false);
    });
});

describe('decline form', () => {
    test('the note counts to 500 and is capped there; the warning stays above', () => {
        const out = render(ready(payload(), { view: 'decline' }));
        assert.match(out.text, /¿Quieres dejarle un mensaje al organizador\?/);
        assert.equal(warnings(out.node).length, 1);
        const note = byId(out.node, 'rsvp-note');
        assert.equal(note.getAttribute('maxlength'), '500');
        const counter = out.node.querySelector('.rsvp-counter');
        assert.equal(counter.textContent, '0/500');
        note.value = 'Hola'.repeat(3);
        note.dispatch('input');
        assert.equal(counter.textContent, '12/500');
        note.value = 'x'.repeat(501);
        note.dispatch('input');
        assert.equal(note.value.length, 500);
        assert.equal(counter.textContent, '500/500');
    });

    test('submits a declined answer with the note, zero seats, no companions', async () => {
        const sent = [];
        const out = render(ready(payload()), { onSubmit: async (a) => { sent.push(a); return { ok: true }; } }, {});
        const form = render(ready(payload(), { view: 'decline' }), { onSubmit: async (a) => { sent.push(a); return { ok: true }; } });
        byId(form.node, 'rsvp-name').value = 'Rosa';
        byId(form.node, 'rsvp-note').value = '  Estaré de viaje  ';
        buttons(form.node, 'Enviar respuesta')[0].dispatch('click');
        await tick();
        assert.deepEqual(sent, [{ partyId: null, name: 'Rosa', status: 'declined', seats: 0, companions: [], note: 'Estaré de viaje' }]);
        assert.equal(out.node.querySelectorAll('textarea').length, 0);
    });
});

/* ── Return visits and results ─────────────────────────────────────────────── */

describe('return visit', () => {
    test('every party is listed under the warning; per party the two paths, then "Administrar mis pases" centred under them — from the first paint', () => {
        const chosen = [];
        const managed = [];
        const out = render(ready(payload({ parties: [ATTENDING, DECLINED] })), { onChoose: (...a) => chosen.push(a), onManage: (p) => managed.push(p) });
        assert.equal(out.node.querySelectorAll('.rsvp-party').length, 2);
        assert.match(out.text, /Tu respuesta actual/);
        assert.match(out.text, /Luis Pérez/);
        assert.match(out.text, /Asistirás con 2 pases\./);
        assert.match(out.text, /Marta/);
        assert.match(out.text, /Rosa Díaz/);
        assert.match(out.text, /Indicaste que no asistirás\./);
        assert.match(out.text, /Estaré de viaje/);

        // The warning, once, above the first card.
        assert.equal(warnings(out.node).length, 1);
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-warning'), classes.join(' | '));
        assert.ok(classes[1].includes('rsvp-party'));

        assert.equal(buttons(out.node, 'Confirmar asistencia').length, 0);
        assert.equal(buttons(out.node, 'Responder como otra persona').length, 0, 'the removed control is back');
        assert.equal(buttons(out.node, 'Prefiero usar la app').length, 0, 'the old quiet link is back');
        // Each card: [Cambiar mi respuesta] [Prefiero usar Orbiventt], then the manage action for the ATTENDING party only.
        const cards = out.node.querySelectorAll('.rsvp-party');
        assert.equal(pathButtons(cards[0], 'Cambiar mi respuesta').length, 1);
        assert.equal(appPaths(cards[0]).length, 1);
        assert.equal(pathButtons(cards[1], 'Cambiar mi respuesta').length, 1);
        assert.equal(appPaths(cards[1]).length, 1);
        assert.equal(manages(cards[0]).length, 1, 'the attending party must manage its passes from the first paint');
        assert.equal(manages(cards[1]).length, 0, 'a declined party has no passes to manage');
        const manage = manages(out.node)[0];
        assert.ok(manage.parentNode.getAttribute('class').includes('rsvp-manage'), 'the manage action is not the centred block');
        const cardClasses = cards[0].children.map((c) => c.getAttribute('class') || '');
        assert.ok(cardClasses.indexOf('rsvp-paths') < cardClasses.indexOf('rsvp-manage'), 'the manage action must sit UNDER the two paths: ' + cardClasses.join(' | '));
        assert.ok(manage.getAttribute('class').includes('rsvp-btn--ghost'));
        assert.equal(manage.getAttribute('data-state'), 'qr-off');
        assert.equal(primaries(out.node).length, 0, 'a primary with QR off');
        assert.equal(/QR están listos/.test(out.text), false);

        pathButtons(cards[1], 'Cambiar mi respuesta')[0].dispatch('click');
        manage.dispatch('click');
        appPaths(cards[0])[0].dispatch('click');
        assert.deepEqual(chosen, [['choose', DECLINED], ['app', null]]);
        assert.deepEqual(managed, [ATTENDING]);
    });

    test('QR on: the card says the passes are ready and "Administrar mis pases" is THE primary', () => {
        const out = render(ready(payload({ event: { qr_enabled: true }, parties: [ATTENDING, DECLINED] })));
        assert.match(out.text, /Tus pases con código QR están listos/);
        const manage = manages(out.node);
        assert.equal(manage.length, 1);
        assert.ok(manage[0].getAttribute('class').includes('rsvp-btn--primary'));
        assert.equal(manage[0].getAttribute('data-state'), 'qr-on');
        assert.equal(primaries(out.node).length, 1);
        assert.equal(out.node.querySelectorAll('.rsvp-ready').length, 1, 'the ready line leaked onto the declined card');
    });

    test('a return visit with the handoff open: the app path on the card is the one-tap anchor', () => {
        const out = render(ready(payload({ parties: [ATTENDING] })), {}, { handoff: HANDOFF, smartOpen: plan() });
        const app = appPaths(out.node);
        assert.equal(app.length, 1);
        assert.equal(app[0].tagName, 'a');
        assert.equal(app[0].getAttribute('href'), HANDOFF.href);
        assert.equal(manages(out.node).length, 1);
    });

    test('"Lo que te toca llevar": a distinct card with one row per item, hidden when nothing is assigned', () => {
        const party = { ...ATTENDING, assigned_items: [{ id: 'b1', label: 'Hielo' }, { id: 'b2', label: 'Vasos' }, { id: 'b3', label: '' }, { id: 'b4', label: 'Una hielera grande con hielo suficiente para toda la noche y refrescos' }] };
        const out = render(ready(payload({ parties: [party] })));
        const card = out.node.querySelector('.rsvp-bring');
        assert.ok(card, 'no checklist card');
        assert.equal(card.querySelector('.rsvp-bring__title').textContent, 'Lo que te toca llevar');
        assert.match(card.textContent, /Te lo asignó el organizador\./);
        assert.deepEqual(card.querySelectorAll('.rsvp-bring__item').map((li) => li.textContent), ['Hielo', 'Vasos', 'Una hielera grande con hielo suficiente para toda la noche y refrescos']);
        assert.ok(card.querySelector('.rsvp-bring__plate'), 'no icon plate');
        assert.equal(card.querySelectorAll('button').length, 0, 'the web must not claim or edit checklist items');
        assert.equal(/Te pidieron llevar/.test(out.text), false, 'the old muted line is back');
        // Inside the party card, before the paths.
        const partyClasses = out.node.querySelector('.rsvp-party').children.map((c) => c.getAttribute('class') || '');
        assert.ok(partyClasses.indexOf('rsvp-bring') < partyClasses.indexOf('rsvp-paths'), partyClasses.join(' | '));
        assert.equal(render(ready(payload({ parties: [ATTENDING] }))).node.querySelectorAll('.rsvp-bring').length, 0);
        assert.equal(render(ready(payload({ parties: [{ ...DECLINED, assigned_items: [{ id: 'x', label: 'Hielo' }] }] }))).node.querySelectorAll('.rsvp-bring').length, 0, 'a declined party carries nothing');
        // The passes section shows the same card.
        const passes = render(ready(payload({ parties: [party] }), { view: 'passes', managing: party, passes: null }));
        assert.equal(passes.node.querySelectorAll('.rsvp-bring').length, 1);
    });

    test('the app screen from a return visit renders under the warning and the cards, with Volver', () => {
        const calls = [];
        const out = render(ready(payload({ parties: [ATTENDING] }), { view: 'app' }), { onCancel: () => calls.push('cancel') }, { handoff: HANDOFF });
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-warning') && classes[1].includes('rsvp-party') && classes[2].includes('rsvp-app-path'), classes.join(' | '));
        assert.equal(links(out.node, 'Abrir Orbiventt').length, 1);
        buttons(out.node, 'Volver')[0].dispatch('click');
        assert.deepEqual(calls, ['cancel']);
    });

    test('attending result: confirmation WITH "Administrar mis pases" → app benefits (Abrir Orbiventt SECONDARY) → warning; no copy-the-code message', () => {
        const armed = [];
        const managed = [];
        const out = render(ready(payload({ parties: [ATTENDING] }), { result: { status: 'attending', name: 'Luis Pérez', seats: 2, partyId: 'p1' } }), { onManage: (p) => managed.push(p) }, { handoff: HANDOFF, smartOpen: plan({ arm: (a) => { armed.push(a); return () => {}; } }) });
        assert.match(out.text, /¡Listo, Luis Pérez! ?Confirmaste 2 pases\./);
        assert.match(out.text, /Vive el evento completo en Orbiventt/);
        assert.deepEqual(out.node.querySelector('.rsvp-promo').querySelectorAll('li').map((li) => li.textContent),
            ['Chat del evento', 'Compartir fotos', 'Comentarios y reacciones', 'Notificaciones', 'Itinerario']);
        const open = links(out.node, 'Abrir Orbiventt');
        assert.equal(open.length, 1);
        assert.equal(open[0].getAttribute('href'), HANDOFF.href);
        assert.ok(open[0].getAttribute('class').includes('rsvp-btn--ghost'), 'the app suggestion is primary');
        assert.deepEqual(armed, [open[0]]);
        assert.equal(primaries(out.node).length, 0);
        assert.equal(/Descargar|App Store|Google Play/i.test(out.text), false);
        assert.equal(/copia (tu|el) código/i.test(out.text), false, 'the copy-the-code message is back');
        assert.equal(/ABCD-EFGH-IJKL/.test(out.text), false, 'the code is shown on the result screen');

        // The manage action lives IN the result card — the guest never scrolls past the promo to find it.
        assert.equal(manages(out.node).length, 1);
        assert.ok(manages(out.node)[0].parentNode.parentNode.getAttribute('class').includes('rsvp-result--ok'));
        manages(out.node)[0].dispatch('click');
        assert.deepEqual(managed, [ATTENDING]);

        // The warning, once, in the spec'd order; the party card waits for the next paint.
        assert.equal(warnings(out.node).length, 1);
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-result--ok'), classes.join(' | '));
        assert.ok(classes[1].includes('rsvp-promo'));
        assert.ok(classes[2].includes('rsvp-warning'));
        assert.equal(classes.length, 3, 'an extra card after the warning');
        assert.equal(buttons(out.node, 'Prefiero usar Orbiventt').length, 0, 'two ways into the app on one screen');

        // Found by name when the respond answer carried no id; absent when the party is not in the payload.
        assert.equal(manages(render(ready(payload({ parties: [ATTENDING] }), { result: { status: 'attending', name: 'Luis Pérez', seats: 2 } })).node).length, 1);
        assert.equal(manages(render(ready(payload(), { result: { status: 'attending', name: 'Ana', seats: 1 } })).node).length, 0);
        assert.match(render(ready(payload(), { result: { status: 'attending', name: 'Ana', seats: 1 } })).text, /Confirmaste 1 pase\./);
        // QR on → the manage action is the one primary on the result.
        const qrOn = render(ready(payload({ event: { qr_enabled: true }, parties: [ATTENDING] }), { result: { status: 'attending', name: 'Luis Pérez', seats: 2, partyId: 'p1' } }), {}, { handoff: HANDOFF });
        assert.equal(primaries(qrOn.node).length, 1);
        assert.equal(primaries(qrOn.node)[0].textContent, 'Administrar mis pases');
    });

    test('attending result with a closed handoff (DEV): the app stays a quiet link, never the code', () => {
        const chosen = [];
        for (const handoff of [null, CLOSED]) {
            const out = render(ready(payload({ parties: [ATTENDING] }), { result: { status: 'attending', name: 'Ana', seats: 1 } }), { onChoose: (...a) => chosen.push(a) }, {
                handoff, smartOpen: { strategy: 'store-direct', href: 'https://play.google.com/x', storeUrl: 'https://play.google.com/x', platform: 'desktop', arm: () => () => {} },
            });
            assert.equal(links(out.node, 'Abrir Orbiventt').length, 0, 'a closed handoff still rendered an open control');
            assert.equal(/ABCD-EFGH-IJKL/.test(out.text), false);
            assert.equal(buttons(out.node, 'Copiar código').length, 0);
            assert.equal(out.node.querySelector('.rsvp-promo').querySelectorAll('.rsvp-btn--link').length, 1);
            buttons(out.node, 'Prefiero usar Orbiventt')[0].dispatch('click');
        }
        assert.deepEqual(chosen, [['app', null], ['app', null]]);
    });

    test('declined result: thanks naming the organizer, app promotion muted only, warning above the card; the card keeps both paths', () => {
        const out = render(ready(payload({ parties: [DECLINED] }), { result: { status: 'declined', name: 'Rosa', seats: 0 } }), {}, { handoff: HANDOFF, storeUrl: 'https://apps.apple.com/app/id6788249586' });
        assert.match(out.text, /Gracias por responder\. ?Tu respuesta fue enviada a Ana Ruiz\./);
        assert.equal(links(out.node, 'Abrir Orbiventt').length, 0);
        assert.equal(out.node.querySelectorAll('.rsvp-promo').length, 0);
        assert.equal(out.node.querySelectorAll('.rsvp-benefits').length, 0);
        assert.equal(primaries(out.node).length, 0, 'a primary control on the declined result');
        const link = links(out.node, 'Conoce Orbiventt')[0];
        assert.ok(link && link.parentNode.getAttribute('class').includes('rsvp-muted'));
        assert.equal(warnings(out.node).length, 1);
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-result--declined') && classes[1].includes('rsvp-warning') && classes[2].includes('rsvp-party'), classes.join(' | '));
        assert.equal(manages(out.node).length, 0, 'no QR passes for a declined party');
        assert.equal(pathButtons(out.node, 'Cambiar mi respuesta').length, 1, 'the way back to attending is missing');
        assert.equal(appPaths(out.node).length, 1, 'the app option is missing on the declined card');
    });
});

/* ── The gallery and the viewer ────────────────────────────────────────────── */

describe('gallery', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => ({ path: 'u1/p' + i + '.jpg', created_at: '2026-10-0' + ((i % 9) + 1) + 'T20:00:00Z' }));

    test('photoList reads event.photos through the resolver only: our bucket, safe paths, no duplicates, capped at 60', () => {
        const list = gallery.photoList(payload(), storageUrl);
        assert.deepEqual(list.map((p) => p.url), [OBJ + 'event-photos/u1/cover.jpg', OBJ + 'event-photos/u1/a.jpg', OBJ + 'event-photos/u1/b.jpg']);
        assert.equal(list[0].at, Date.parse('2026-10-01T20:00:00Z'));
        const hostile = gallery.photoList(payload({ event: { photos: [{ path: '../x.jpg' }, { path: 'https://evil/x.jpg' }, { path: 'u1/ok.jpg' }, { path: 'u1/ok.jpg' }, null, 'u1/str.jpg'] } }), storageUrl);
        assert.deepEqual(hostile.map((p) => p.url), [OBJ + 'event-photos/u1/ok.jpg']);
        assert.equal(gallery.photoList(payload({ event: { photos: many(80) } }), storageUrl).length, 60);
        assert.deepEqual(gallery.photoList(payload({ event: { photos: [] } }), storageUrl), []);
        assert.deepEqual(gallery.photoList(null, storageUrl), []);
        // An older server (no `photos`): the legacy strip still shows.
        const legacy = gallery.photoList(payload({ event: { photos: undefined } }), storageUrl);
        assert.equal(legacy.length, 3);
        assert.equal(legacy[0].at, null);
    });

    test('0 photos → no section; 1 photo that is the hero → no tiles; 1 photo behind a thumbnail → one tile', () => {
        assert.equal(render(ready(payload({ event: { photos: [], cover_path: null, gallery_paths: [] } }))).node.querySelectorAll('.rsvp-gallery').length, 0);
        const heroOnly = render(ready(payload({ event: { photos: [PHOTOS[0]], gallery_paths: ['u1/cover.jpg'] } })));
        assert.equal(heroOnly.node.querySelectorAll('.rsvp-gallery').length, 0, 'the hero repeated as the only tile');
        const behind = render(ready(payload({ event: { photos: [PHOTOS[0]], gallery_paths: ['u1/cover.jpg'] }, invitation_image: { bucket: 'invitation-media', path: 'di/t.jpg' } })));
        assert.equal(tiles(behind.node).length, 1);
        assert.match(behind.text, /Galería · 1 foto(?!s)/);
    });

    test('many photos: six tiles, the last one says +N, every tile opens the viewer at its FULL index', () => {
        const opened = [];
        const out = render(ready(payload({ event: { photos: many(10), cover_path: 'u1/p0.jpg' } })), { onPhoto: (i) => opened.push(i) });
        const t = tiles(out.node);
        assert.equal(t.length, 6);
        assert.match(out.text, /Galería · 10 fotos/);
        assert.equal(t[5].querySelector('.rsvp-gallery__more').textContent, '+3', 'ten photos, the hero not repeated: nine tiles, six shown, three behind');
        assert.ok(t[5].getAttribute('class').includes('rsvp-gallery__tile--more'));
        assert.equal(t[0].querySelectorAll('.rsvp-gallery__more').length, 0);
        assert.equal(t[0].getAttribute('data-index'), '1', 'the first tile is the second photo (the hero is the first)');
        assert.equal(t[0].getAttribute('aria-label'), 'Ver foto 2 de 10');
        assert.ok(t.every((b) => b.tagName === 'button' && b.getAttribute('type') === 'button'));
        assert.ok(t.every((b) => b.querySelector('img').getAttribute('src').startsWith(OBJ + 'event-photos/')));
        assert.ok(t.every((b) => b.querySelector('img').getAttribute('loading') === 'lazy'));
        t[0].dispatch('click');
        t[5].dispatch('click');
        assert.deepEqual(opened, [1, 6]);
    });

    test('the viewer: black fullscreen dialog, close top-left, "n / N" centred, dots, caption; starts at the asked index', () => {
        const d = createDocument();
        const photos = gallery.photoList(payload(), storageUrl);
        const closed = [];
        const v = gallery.viewerNode(photos, 1, () => closed.push('closed'), { document: d });
        const node = v.node;
        assert.equal(node.getAttribute('role'), 'dialog');
        assert.equal(node.getAttribute('aria-modal'), 'true');
        assert.equal(node.getAttribute('aria-label'), 'Fotos del evento');
        assert.equal(node.getAttribute('tabindex'), '-1');
        assert.equal(node.getAttribute('data-index'), '1');
        assert.equal(v.getIndex(), 1);
        assert.equal(node.querySelector('.rsvp-viewer__counter').textContent, '2 / 3');
        const header = node.querySelector('.rsvp-viewer__header');
        assert.ok(header.children[0].getAttribute('class').includes('rsvp-viewer__close'), 'the close control is not first in the header');
        assert.equal(header.children[0].getAttribute('aria-label'), 'Cerrar');
        assert.equal(node.querySelectorAll('.rsvp-viewer__slide').length, 3);
        const imgs = node.querySelectorAll('.rsvp-viewer__img');
        assert.deepEqual(imgs.map((i) => i.getAttribute('src')), photos.map((p) => p.url));
        assert.deepEqual(imgs.map((i) => i.getAttribute('alt')), ['Foto 1 de 3', 'Foto 2 de 3', 'Foto 3 de 3']);
        assert.equal(imgs[2].getAttribute('loading'), 'lazy');
        assert.equal(imgs[0].hasAttribute('loading'), false, 'the first photos must not wait for lazy loading');
        const dots = node.querySelectorAll('.rsvp-viewer__dot');
        assert.equal(dots.length, 3);
        assert.ok(dots[1].getAttribute('class').includes('rsvp-viewer__dot--active'));
        assert.match(node.querySelector('.rsvp-viewer__caption').textContent, /^Publicada el /);
        assert.equal(node.querySelectorAll('.rsvp-viewer__nav').length, 2);
        assert.ok(serialize(node).includes('aria-modal="true"'));
        assert.equal(serialize(node).includes('style='), false, 'inline style under a style-src self CSP');
    });

    test('the viewer: next / previous (buttons and arrow keys) move and clamp; Escape and the close control close', () => {
        const d = createDocument();
        const photos = gallery.photoList(payload(), storageUrl);
        const closed = [];
        const v = gallery.viewerNode(photos, 0, () => closed.push('closed'), { document: d });
        const node = v.node;
        const prev = node.querySelector('.rsvp-viewer__nav--prev');
        const next = node.querySelector('.rsvp-viewer__nav--next');
        assert.equal(prev.disabled, true);
        assert.equal(next.disabled, false);
        next.dispatch('click');
        assert.equal(v.getIndex(), 1);
        assert.equal(node.querySelector('.rsvp-viewer__counter').textContent, '2 / 3');
        next.dispatch('click');
        assert.equal(v.getIndex(), 2);
        assert.equal(next.disabled, true);
        next.dispatch('click');
        assert.equal(v.getIndex(), 2, 'walked past the last photo');
        node.dispatch('keydown', { key: 'ArrowLeft' });
        assert.equal(v.getIndex(), 1);
        node.dispatch('keydown', { key: 'ArrowRight' });
        assert.equal(v.getIndex(), 2);
        prev.dispatch('click'); prev.dispatch('click'); prev.dispatch('click');
        assert.equal(v.getIndex(), 0, 'walked before the first photo');
        assert.ok(node.querySelectorAll('.rsvp-viewer__dot')[0].getAttribute('class').includes('--active'));
        v.setIndex(99);
        assert.equal(v.getIndex(), 2, 'setIndex must clamp');
        assert.equal(node.getAttribute('data-index'), '2');
        node.dispatch('keydown', { key: 'Escape' });
        node.querySelector('.rsvp-viewer__close').dispatch('click');
        assert.deepEqual(closed, ['closed', 'closed']);
    });

    test('the viewer: a swipe (the strip scrolling) updates the counter; a failed image says so on its slide only', () => {
        const d = createDocument();
        const photos = gallery.photoList(payload(), storageUrl);
        const v = gallery.viewerNode(photos, 0, () => {}, { document: d });
        const track = v.node.querySelector('.rsvp-viewer__track');
        track.clientWidth = 390;
        track.scrollLeft = 780;
        track.dispatch('scroll');
        assert.equal(v.getIndex(), 2);
        assert.equal(v.node.querySelector('.rsvp-viewer__counter').textContent, '3 / 3');
        track.scrollLeft = 400;
        track.dispatch('scroll');
        assert.equal(v.getIndex(), 1);
        const slides = v.node.querySelectorAll('.rsvp-viewer__slide');
        slides[1].querySelector('img').dispatch('error');
        assert.ok(slides[1].getAttribute('class').includes('rsvp-viewer__slide--failed'));
        assert.equal(slides[1].querySelector('.rsvp-viewer__failed').hasAttribute('hidden'), false);
        assert.match(slides[1].querySelector('.rsvp-viewer__failed').textContent, /No pudimos cargar esta foto\./);
        assert.equal(slides[1].querySelector('img').hasAttribute('hidden'), true);
        assert.equal(slides[0].querySelector('.rsvp-viewer__failed').hasAttribute('hidden'), true, 'the failure leaked to another slide');
        // Single photo: no arrows, no dots; nothing: null.
        const one = gallery.viewerNode(photos.slice(0, 1), 0, () => {}, { document: d });
        assert.equal(one.node.querySelectorAll('.rsvp-viewer__nav').length, 0);
        assert.equal(one.node.querySelectorAll('.rsvp-viewer__dot').length, 0);
        assert.equal(one.node.querySelector('.rsvp-viewer__counter').textContent, '1 / 1');
        assert.equal(gallery.viewerNode([], 0, () => {}, { document: d }), null);
        // Past twelve photos the dots give way to the counter alone.
        const lots = gallery.viewerNode(gallery.photoList(payload({ event: { photos: many(13) } }), storageUrl), 0, () => {}, { document: d });
        assert.equal(lots.node.querySelectorAll('.rsvp-viewer__dot').length, 0);
        assert.equal(lots.node.querySelector('.rsvp-viewer__counter').textContent, '1 / 13');
    });

    test('no capability leakage: the gallery draws ONLY what the invitation resolved and never talks to a server', () => {
        const src = stripComments(read('js', 'gallery.js'));
        assert.equal(/fetch\(|backend\.js|callRpc|XMLHttpRequest|supabase/.test(src), false, 'gallery.js reaches for the network');
        assert.match(src, /import \{ el, svgEl, setText \} from '\.\/dom\.js/);
        // Another invitation's photos never enter the page: the list is built from THIS payload alone.
        const other = payload({ event: { id: '91000002-0000-4000-8000-000000000002', photos: [{ path: 'u9/secret.jpg' }] } });
        const mine = gallery.photoList(payload(), storageUrl);
        assert.ok(!mine.some((p) => p.url.includes('secret')));
        assert.equal(gallery.photoList(other, storageUrl)[0].url, OBJ + 'event-photos/u9/secret.jpg');
        // main.js opens the viewer from the CURRENT payload, in its own root, and re-resolves nothing to do so.
        const main = stripComments(read('js', 'main.js'));
        assert.match(main, /function openViewer\(index\) \{[\s\S]*?var photos = photoList\(model\.payload, storageUrl\);[\s\S]*?viewerNode\(photos, index, closeViewer, \{ document: document \}\)/);
        assert.match(main, /byId\('rsvp-viewer-root'\)/);
        assert.match(main, /document\.body\.classList\.add\('rsvp-viewer-open'\)/);
        assert.match(main, /onPhoto: function \(index\) \{\s*openViewer\(index\);/);
        assert.match(main, /if \(viewer\) return;/, 'a visibility refresh must not re-render under an open viewer');
        assert.match(HTML, /<div id="rsvp-viewer-root" hidden><\/div>/);
    });

    test('the stylesheet keeps the app viewer idiom: black, centred, never cropped, swipe-snapped; a 3-up grid; the page locked underneath', () => {
        assert.match(CSS, /\.rsvp-viewer \{[^}]*position: fixed; inset: 0;[^}]*background: #000;/);
        assert.match(CSS, /\.rsvp-viewer__img \{[^}]*object-fit: contain;/);
        assert.match(CSS, /\.rsvp-viewer__track \{[^}]*scroll-snap-type: x mandatory;/);
        assert.match(CSS, /\.rsvp-viewer__slide \{[^}]*scroll-snap-align: center;/);
        assert.match(CSS, /\.rsvp-gallery__grid \{ display: grid; grid-template-columns: repeat\(3, 1fr\);/);
        assert.match(CSS, /\.rsvp-gallery__tile \{[^}]*aspect-ratio: 1 \/ 1;/);
        assert.match(CSS, /body\.rsvp-viewer-open \{ overflow: hidden; \}/);
        assert.match(CSS, /@media \(hover: none\) and \(pointer: coarse\) \{ \.rsvp-viewer__nav \{ display: none; \} \}/);
        assert.match(CSS, /\.rsvp-bring \{/);
        assert.match(CSS, /\.rsvp-bring__item \{[^}]*overflow-wrap: anywhere;/);
        assert.match(CSS, /\.rsvp-pass\[data-state="active"\]::before \{ background: var\(--gradient\); \}/);
        assert.match(CSS, /\.rsvp-btn--path-app \{/);
        assert.match(CSS, /\.rsvp-manage \{ display: grid; justify-items: center;/);
        assert.equal(/\.rsvp-gallery img \{/.test(CSS), false, 'the old strip rule survives');
    });
});

/* ── Passes ────────────────────────────────────────────────────────────────── */

describe('passes', () => {
    const managing = (over = {}, passes = null, parties = [ATTENDING]) =>
        ready(payload({ parties, ...over }), { view: 'passes', managing: parties[0], passes });

    test('qr.js encodes ONLY a well-formed server payload, in alphanumeric mode, with a quiet zone', () => {
        const matrix = qr.encodeQr(P1, qrcode);
        assert.equal(matrix.size, 25, 'a 38-character alphanumeric payload at ECC M is a type-2 symbol');
        assert.equal(matrix.modules.length, 25);
        assert.ok(matrix.modules.every((row) => row.length === 25 && row.every((m) => typeof m === 'boolean')));
        // Finder pattern corner: dark.
        assert.equal(matrix.modules[0][0], true);
        assert.equal(qr.encodeQr(P1, null), null, 'no encoder → nothing');
        for (const bad of ['', 'hola', 'OVP1:ABCDEFGH23456789', P1 + 'X', P1.toLowerCase(), 'OVP2:ABCDEFGH23456789:JKMNPQRSTVWXYZ01', '<svg onload=alert(1)>']) {
            assert.equal(qr.encodeQr(bad, qrcode), null, bad);
            assert.equal(qr.qrNode(bad, qrcode, createDocument()), null, bad);
        }
        const d = createDocument();
        const node = qr.qrNode(P1, qrcode, d);
        assert.equal(node.tagName, 'svg');
        assert.equal(node.getAttribute('viewBox'), '0 0 33 33', 'quiet zone of 4 modules on every side');
        assert.equal(node.getAttribute('role'), 'img');
        assert.equal(node.getAttribute('aria-label'), 'Código QR de tu pase');
        const rect = node.querySelector('rect');
        assert.equal(rect.getAttribute('fill'), '#FFFFFF');
        assert.equal(rect.getAttribute('width'), '33');
        const path = node.querySelector('path');
        assert.equal(path.getAttribute('fill'), '#000000');
        assert.match(path.getAttribute('d'), /^(M\d+ \d+h\d+v1h-\d+z)+$/, 'the path is anything but integers and M/h/v/z');
        assert.match(path.getAttribute('d'), /^M4 4h7v1h-7z/, 'the first finder row is not offset by the quiet zone');
        assert.equal(qr.isAlphanumeric(P1), true);
        assert.equal(qr.isAlphanumeric('ovp1'), false);
    });

    test('loading: the party summary, Cambiar mi respuesta, and the list placeholder; Cerrar closes', () => {
        const calls = [];
        const out = render(managing(), { onCancel: () => calls.push('cancel'), onChoose: (...a) => calls.push(a) });
        assert.equal(out.node.querySelector('.rsvp-passes').getAttribute('data-view'), 'passes');
        assert.match(out.text, /Administrar mis pases/);
        assert.match(out.text, /Luis Pérez/);
        assert.match(out.text, /Asistirás con 2 pases\./);
        assert.match(out.text, /Marta/);
        assert.match(out.text, /Cargando tus pases…/);
        assert.equal(out.node.querySelectorAll('.rsvp-pass').length, 0);
        assert.equal(out.node.querySelectorAll('.rsvp-party').length, 0, 'the party cards rendered beside the passes section');
        assert.equal(warnings(out.node).length, 1);
        assert.ok(answerClasses(out.node)[0].includes('rsvp-warning'));
        buttons(out.node, 'Cambiar mi respuesta')[0].dispatch('click');
        buttons(out.node, 'Cerrar')[0].dispatch('click');
        assert.deepEqual(calls, [['choose', ATTENDING], 'cancel']);
        // Loading again, as every open starts: a null passes state is loading too.
        assert.match(render(managing({}, null)).text, /Cargando tus pases…/);
    });

    test('active: one ticket per pass — number, state badge, who — with a QR only where a payload exists', () => {
        const out = render(managing({ event: { qr_enabled: true } }, { status: 'ok', data: passesOk() }));
        const cards = out.node.querySelectorAll('.rsvp-pass');
        assert.equal(cards.length, 2);
        assert.equal(cards[0].querySelector('.rsvp-pass__num').textContent, 'Pase 1 de 2');
        assert.equal(cards[0].querySelector('.rsvp-pass__kind').textContent, 'Titular');
        assert.equal(cards[0].querySelector('.rsvp-pass__who').textContent, 'Luis Pérez');
        assert.equal(cards[0].querySelector('.rsvp-pass__badge').textContent, 'Activo');
        assert.ok(cards[0].querySelector('.rsvp-pass__badge').getAttribute('class').includes('rsvp-pass__badge--active'));
        assert.equal(cards[1].querySelector('.rsvp-pass__num').textContent, 'Pase 2 de 2');
        assert.equal(cards[1].querySelector('.rsvp-pass__kind').textContent, 'Acompañante');
        assert.equal(cards[1].querySelector('.rsvp-pass__who').textContent, 'Marta');
        assert.equal(cards[0].getAttribute('data-state'), 'active');
        assert.equal(qrs(out.node).length, 2);
        assert.equal(out.node.querySelectorAll('.rsvp-pass__state').length, 0);
        assert.equal(/QR desactivado|Ingreso registrado/.test(out.text), false);
        assert.equal(out.node.querySelectorAll('.rsvp-passes__notice').length, 0);
        assert.equal(primaries(out.node).length, 0);

        // Out-of-order rows are sorted by position; an active pass WITHOUT a payload draws no QR.
        const scrambled = passesOk({
            passes: [
                { ...passesOk().passes[1] },
                { ...passesOk().passes[0], payload: null },
            ],
        });
        const partial = render(managing({ event: { qr_enabled: true } }, { status: 'ok', data: scrambled }));
        const nums = partial.node.querySelectorAll('.rsvp-pass__num').map((t) => t.textContent);
        assert.deepEqual(nums, ['Pase 1 de 2', 'Pase 2 de 2']);
        assert.deepEqual(partial.node.querySelectorAll('.rsvp-pass__who').map((t) => t.textContent), ['Luis Pérez', 'Marta']);
        assert.equal(qrs(partial.node).length, 1);
        assert.equal(qrs(partial.node.querySelectorAll('.rsvp-pass')[0]).length, 0);
        assert.match(partial.node.querySelectorAll('.rsvp-pass')[0].textContent, /Este pase no está disponible por ahora\./);
        // No encoder on the page: nothing is drawn, nothing throws.
        assert.equal(qrs(render(managing({ event: { qr_enabled: true } }, { status: 'ok', data: passesOk() }), {}, { qrcode: null }).node).length, 0);
    });

    test('qr_disabled: no QR, the organizer copy on every card, the come-back note once; anonymous companions', () => {
        const data = passesOk({
            qr_enabled: false, seats: 3,
            passes: [
                { handle: 'A', pos: 1, occupant_kind: 'holder', state: 'qr_disabled', payload: null, occupant_label: 'Luis Pérez', checked_in_at: null },
                { handle: 'B', pos: 2, occupant_kind: 'name', state: 'qr_disabled', payload: null, occupant_label: 'Marta', checked_in_at: null },
                { handle: 'C', pos: 3, occupant_kind: 'anonymous', state: 'qr_disabled', payload: null, occupant_label: null, checked_in_at: null },
            ],
        });
        const out = render(managing({}, { status: 'ok', data }));
        assert.equal(qrs(out.node).length, 0);
        assert.equal(out.node.querySelectorAll('.rsvp-pass').length, 3);
        assert.equal(out.node.querySelectorAll('.rsvp-pass__state').filter((p) => p.textContent === 'QR desactivado por el organizador').length, 3);
        assert.equal(out.node.querySelectorAll('.rsvp-pass__badge').filter((p) => p.textContent === 'QR desactivado').length, 3);
        assert.equal(out.node.querySelectorAll('.rsvp-passes__notice').length, 1);
        assert.match(out.text, /Si el organizador activa el acceso con código QR, tus pases podrán escanearse automáticamente\. Vuelve a abrir este mismo enlace para verlos\./);
        const third = out.node.querySelectorAll('.rsvp-pass')[2];
        assert.equal(third.querySelector('.rsvp-pass__num').textContent, 'Pase 3 de 3');
        assert.equal(third.querySelector('.rsvp-pass__kind').textContent, 'Acompañante');
        assert.equal(third.querySelector('.rsvp-pass__who').textContent, '');
        assert.equal(/no está disponible/.test(out.text), false);
    });

    test('checked in: the time of entry on that pass only; suspended passes say so', () => {
        const data = passesOk({
            passes: [
                { ...passesOk().passes[0], checked_in_at: '2027-04-18T00:05:00Z' },
                { ...passesOk().passes[1], state: 'suspended', payload: null },
            ],
        });
        const out = render(managing({ event: { qr_enabled: true } }, { status: 'ok', data }));
        const cards = out.node.querySelectorAll('.rsvp-pass');
        assert.equal(cards[0].querySelector('.rsvp-pass__checkin').textContent, 'Ingreso registrado · 18:05 h');
        assert.equal(cards[0].querySelector('.rsvp-pass__badge').textContent, 'Ingresó · 18:05 h');
        assert.ok(cards[0].querySelector('.rsvp-pass__badge').getAttribute('class').includes('--checked'));
        assert.equal(qrs(cards[0]).length, 1, 'a checked-in pass lost its QR');
        assert.equal(cards[1].querySelectorAll('.rsvp-pass__checkin').length, 0);
        assert.equal(cards[1].getAttribute('data-state'), 'suspended');
        assert.equal(cards[1].querySelector('.rsvp-pass__badge').textContent, 'No disponible');
        assert.equal(qrs(cards[1]).length, 0);
        assert.match(cards[1].textContent, /Este pase no está disponible por ahora\./);
    });

    test('error: the message and Reintentar (only when retryable); an empty list says so', () => {
        const calls = [];
        const out = render(managing({}, { status: 'error', message: 'No pudimos cargar tus pases. Revisa tu conexión e inténtalo de nuevo.', retryable: true }), { onPassesRetry: () => calls.push('retry') });
        assert.equal(out.node.querySelector('[role="alert"]').textContent, 'No pudimos cargar tus pases. Revisa tu conexión e inténtalo de nuevo.');
        buttons(out.node, 'Reintentar')[0].dispatch('click');
        assert.deepEqual(calls, ['retry']);
        const gone = render(managing({}, { status: 'error', message: ui.COPY.passesGone, retryable: false }));
        assert.equal(buttons(gone.node, 'Reintentar').length, 0);
        assert.match(gone.text, /No encontramos tus pases/);
        const empty = render(managing({}, { status: 'ok', data: passesOk({ passes: [] }) }));
        assert.equal(empty.node.querySelectorAll('.rsvp-pass').length, 0);
        assert.match(empty.text, /No encontramos tus pases/);
    });

    test('the section only opens for a party that may hold passes; otherwise the cards come back', () => {
        const declined = render(ready(payload({ parties: [DECLINED] }), { view: 'passes', managing: DECLINED, passes: { status: 'ok', data: passesOk() } }));
        assert.equal(declined.node.querySelectorAll('.rsvp-passes').length, 0);
        assert.equal(declined.node.querySelectorAll('.rsvp-party').length, 1);
        const finished = render(managing({ event: { is_finished: true }, invitation: { accepting_responses: false } }, { status: 'ok', data: passesOk() }));
        assert.equal(finished.node.querySelectorAll('.rsvp-passes').length, 0);
        const vanished = render(ready(payload({ parties: [DECLINED] }), { view: 'passes', managing: ATTENDING, passes: { status: 'ok', data: passesOk() } }));
        assert.equal(vanished.node.querySelectorAll('.rsvp-passes').length, 0);
        // An expired link still manages its passes — but offers no change.
        const expired = render(managing({ invitation: { is_expired: true, accepting_responses: false } }, { status: 'ok', data: passesOk() }));
        assert.equal(expired.node.querySelectorAll('.rsvp-passes').length, 1);
        assert.equal(qrs(expired.node).length, 2);
        assert.equal(buttons(expired.node, 'Cambiar mi respuesta').length, 0);
    });

    test('a hostile holder or companion label on a pass renders as text', () => {
        const hostile = '<img src=x onerror=alert(1)>';
        const data = passesOk({ holder_label: hostile, passes: [{ ...passesOk().passes[0], occupant_label: hostile }, { ...passesOk().passes[1], occupant_label: hostile }] });
        const out = render(managing({ event: { qr_enabled: true } }, { status: 'ok', data }));
        assert.equal(out.html.includes('<img src=x'), false);
        assert.ok(out.html.split('&lt;img src=x onerror=alert(1)&gt;').length >= 3);
        assert.equal(qrs(out.node).length, 2, 'the QR depends on the payload, never on the label');
    });

    test('main.js fetches passes afresh on every open and re-resolves when the tab becomes visible', () => {
        const main = stripComments(read('js', 'main.js'));
        assert.match(main, /import \{[^}]*\bgetPasses\b[^}]*\} from '\.\/backend\.js/);
        assert.match(main, /onManage: function \(party\) \{[\s\S]*?model\.view = 'passes';[\s\S]*?void fetchPasses\(party\);/);
        assert.match(main, /await getPasses\(model\.code, party\.id\)/);
        assert.equal(/passesCache|cachedPasses/.test(main), false);
        assert.match(main, /document\.addEventListener\('visibilitychange'/);
        assert.match(main, /visibilityState === 'visible'\) void refresh\(\)/);
        assert.match(main, /async function refresh\(\) \{[\s\S]*?await resolveInvitation\(model\.code\)[\s\S]*?model\.payload = res;[\s\S]*?fetchPasses\(model\.managing\)/);
        // A form being typed is never re-rendered from under the guest.
        assert.match(main, /if \(model\.view === 'attend' \|\| model\.view === 'decline'\) return;/);
        // The encoder reaches the renderer only as the vendored global, through the opts seam.
        assert.match(main, /window\.qrcode/);
        assert.match(main, /qrcode: QRCODE/);
        // A fresh answer remembers which party it created, so the result can offer its passes.
        assert.match(main, /partyId: typeof res\.party_id === 'string' \? res\.party_id : \(answer\.partyId \|\| null\),/);
    });

    test('the vendored encoder keeps its MIT attribution and is wired as a classic script before the module', () => {
        assert.match(VENDOR, /qrcode-generator v2\.0\.4/);
        assert.match(VENDOR, /Copyright \(c\) 2009 Kazuhiko Arase/);
        assert.match(VENDOR, /MIT License/);
        assert.match(VENDOR, /VENDORED VERBATIM AND UNMODIFIED/);
        const licence = read('vendor', 'qrcode-generator-LICENSE.txt');
        assert.match(licence, /^MIT License/);
        assert.match(licence, /Kazuhiko Arase/);
        assert.match(HTML, /<script src="rsvp\/vendor\/qrcode-generator\.js\?v=[^"]+"><\/script>/);
        assert.ok(HTML.indexOf('rsvp/vendor/qrcode-generator.js') < HTML.indexOf('rsvp/js/main.js'));
        assert.equal(/import[^\n]*vendor/.test(stripComments(read('js', 'qr.js'))), false, 'the UMD build must not be imported as a module');
        assert.equal(typeof qrcode, 'function');
    });
});

/* ── Text stays text ───────────────────────────────────────────────────────── */

describe('escaping', () => {
    test('a hostile party name, companion, note, checklist item, greeting and title render as text', () => {
        const hostile = '<img src=x onerror=alert(1)>';
        const p = payload({
            event: { title: hostile + ' título' },
            invitation: { greeting: hostile, label: hostile },
            parties: [
                { ...ATTENDING, party_name: hostile, companions: [{ position: 2, name: hostile }], assigned_items: [{ id: 'b', label: hostile }] },
                { ...DECLINED, decline_note: hostile },
            ],
        });
        const out = render(ready(p), {}, { handoff: HANDOFF });
        assert.equal(out.html.includes('<img src=x'), false);
        assert.ok(out.html.split('&lt;img src=x onerror=alert(1)&gt;').length >= 8, 'hostile text did not survive as text everywhere');
        for (const img of out.node.querySelectorAll('img')) assert.equal(img.hasAttribute('onerror'), false);
        const result = render(ready(p, { result: { status: 'attending', name: hostile, seats: 1 } }), {}, { handoff: HANDOFF });
        assert.equal(result.html.includes('<img src=x'), false);
        assert.match(result.text, /¡Listo, <img src=x onerror=alert\(1\)>!/);
        const form = render(ready(p, { view: 'attend', editing: p.parties[0] }));
        assert.equal(byId(form.node, 'rsvp-name').value, hostile);
        assert.equal(serialize(form.node).includes('<img src=x'), false);
    });

    test('no innerHTML, outerHTML, insertAdjacentHTML, eval, createSvgTag or inline handler anywhere in rsvp/js', () => {
        for (const file of jsFiles()) {
            const src = stripComments(read('js', file));
            for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'onclick', 'onerror', 'createSvgTag', 'createImgTag', 'createDataURL', 'createTableTag']) {
                assert.equal(src.includes(bad), false, `${file} contains ${bad}`);
            }
        }
    });

    test('the copy never names a second invitation type, and the removed controls stay removed', () => {
        const sources = jsFiles().map((f) => stripComments(read('js', f))).concat([HTML.replace(/<!--[\s\S]*?-->/g, '')]);
        for (const src of sources) {
            assert.equal(/invitaci[oó]n web/i.test(src), false, 'copy says "invitación web"');
            assert.equal(/\bRSVP\b/.test(src), false, 'copy says "RSVP"');
            assert.equal(/Responder como otra persona/.test(src), false, 'the removed control is still in the source');
            assert.equal(/Agregar al calendario|calendar\.js|icsDataUrl|buildIcs/.test(src), false, 'the calendar is still wired');
            assert.equal(/Confirmar desde la app|Prefiero usar la app/.test(src), false, 'the old app-path labels are back');
        }
        const uiSrc = stripComments(read('js', 'ui.js'));
        assert.ok(uiSrc.includes("'Confirmar asistencia'"));
        assert.ok(uiSrc.includes('tu invitación'));
        assert.ok(uiSrc.includes("'Este enlace es tu llave'"));
        assert.ok(uiSrc.includes('No lo compartas con nadie fuera de tu grupo.'));
        assert.equal(typeof ui.calendarHref, 'undefined');
        // Implementation terms never reach a guest.
        for (const term of ['web party', 'external party', 'party web', 'parte web']) {
            assert.equal(new RegExp(term, 'i').test(render(ready(payload({ parties: [ATTENDING, DECLINED] }))).text), false, term);
        }
    });
});

/* ── Page security + build participation ───────────────────────────────────── */

describe('page', () => {
    test('declares a CSP with no CDN, no inline code, and only the deployment Supabase host', () => {
        const csp = /content="([^"]*default-src[^"]*)"/.exec(HTML)[1];
        assert.match(csp, /script-src 'self';/);
        assert.match(csp, /style-src 'self';/);
        assert.equal(/unsafe-inline/.test(csp), false);
        assert.match(csp, new RegExp(`connect-src https://${DEV_SUPABASE_REF}\\.supabase\\.co;`));
        assert.match(csp, new RegExp(`img-src 'self' https://${DEV_SUPABASE_REF}\\.supabase\\.co;`));
        assert.equal(/data:|blob:/.test(csp), false, 'the QR is an inline SVG; no data/blob source is needed');
        assert.match(csp, /frame-src 'none'/);
        assert.match(csp, /object-src 'none'/);
        assert.match(csp, /form-action 'none'/);
    });

    test('is noindex, nofollow and no-referrer, and carries no inline script or style', () => {
        assert.match(HTML, /<meta name="robots" content="noindex, nofollow">/);
        assert.match(HTML, /<meta name="referrer" content="no-referrer">/);
        assert.equal(/<script(?![^>]*src=)/.test(HTML), false, 'inline script present');
        assert.equal(/<style|style="/.test(HTML), false, 'inline style present');
        assert.match(HTML, /<base href="\/vyvent-legal\/">/);
        assert.match(HTML, /<noscript>/);
    });

    test('names no host beyond the Supabase project and the site origin', () => {
        const visible = HTML.replace(/<!--[\s\S]*?-->/g, '');
        for (const m of visible.matchAll(/https?:\/\/[^"'\s<>]+/g)) {
            assert.ok(m[0].startsWith(`https://${DEV_SUPABASE_REF}.supabase.co`) || m[0].startsWith(DEV_SITE_ORIGIN), m[0]);
        }
    });

    test('has no <form> (form-action is none) and reaches the server only through fetch', () => {
        assert.equal(/<form/i.test(HTML.replace(/<!--[\s\S]*?-->/g, '')), false);
        for (const file of jsFiles()) {
            const src = stripComments(read('js', file));
            assert.equal(/el\(\s*'form'/.test(src), false, `${file} builds a form`);
            assert.equal(/XMLHttpRequest|sendBeacon|WebSocket/.test(src), false, `${file} uses a second transport`);
        }
    });

    test('loads no analytics of any kind', () => {
        for (const file of jsFiles()) {
            const src = stripComments(read('js', file));
            ['gtag', 'analytics', 'segment', 'mixpanel', 'posthog'].forEach((w) =>
                assert.equal(new RegExp(w, 'i').test(src), false, `${file}: ${w}`));
        }
    });

    test('rsvp is part of the SHARED promotion set, and promote.mjs walks SHARED_DIRS', () => {
        assert.ok(SHARED_DIRS.includes('rsvp'));
        const promote = readFileSync(join(ROOT, 'scripts', 'promote.mjs'), 'utf8');
        assert.match(promote, /for \(const dir of SHARED_DIRS\)/);
        const parity = readFileSync(join(ROOT, 'scripts', 'parity-check.mjs'), 'utf8');
        assert.match(parity, /for \(const dir of SHARED_DIRS\)/);
    });

    test('EVERY executable edge carries the current WEB_BUILD — the vendor script included — and the stamper agrees', () => {
        const refs = [...HTML.matchAll(/(?:src|href)="((?:rsvp\/|env\.js|app-return\.js|app-store-links\.js)[^"?]*)(\?v=([^"]*))?"/g)];
        assert.ok(refs.length >= 6, `only ${refs.length} entry refs found`);
        assert.ok(refs.some(([, path]) => path === 'rsvp/vendor/qrcode-generator.js'), 'the vendor script is not a stamped entry ref');
        refs.forEach(([, path, , token]) => assert.equal(token, WEB_BUILD, `${path} is not on WEB_BUILD`));
        let edges = 0;
        for (const file of jsFiles()) {
            for (const m of read('js', file).matchAll(/(?:from\s*|import\()\s*'(\.\.?\/[^']+?\.js)(\?v=([^']*))?'/g)) {
                edges += 1;
                assert.equal(m[3], WEB_BUILD, `${file}: ${m[1]} is not on WEB_BUILD`);
                assert.equal(m[1].startsWith('../'), false, `${file}: rsvp/ imports outside its tree (${m[1]})`);
            }
        }
        assert.ok(edges >= 8, `only ${edges} import edges found`);
        const stamper = readFileSync(join(ROOT, 'scripts', 'set-web-build.mjs'), 'utf8');
        assert.match(stamper, /rsvp\\\/vendor\\\/qrcode-generator\\\.js/);
        const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'set-web-build.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
        assert.match(out, /COHERENT/);
        assert.ok(out.includes(`WEB_BUILD=${WEB_BUILD}`));
    });
});

/* ── Entry points ──────────────────────────────────────────────────────────── */

describe('entry points', () => {
    test('rsvpHref resolves beside the invitation page under both roots, code in the fragment, the DEV return address beside it', () => {
        assert.equal(rsvpHref('https://cosioyair.github.io/vyvent-legal/invitation/?i=slug&code=' + CODE, CODE),
            'https://cosioyair.github.io/vyvent-legal/rsvp/#c=' + CODE);
        assert.equal(rsvpHref('https://orbiventt.com/invitation/?i=slug&code=' + CODE, CODE), 'https://orbiventt.com/rsvp/#c=' + CODE);
        assert.equal(rsvpHref('', CODE), 'rsvp/#c=' + CODE);
        assert.equal(rsvpHref('https://orbiventt.com/invitation/', '../evil'), null);
        // The return address only ever rides as `&r=` in the fragment, and only when it looks like Expo Go.
        assert.equal(rsvpHref('https://cosioyair.github.io/vyvent-legal/invitation/', CODE, RETURN_URL),
            'https://cosioyair.github.io/vyvent-legal/rsvp/#c=' + CODE + '&r=' + encodeURIComponent(RETURN_URL));
        for (const bad of ['https://evil/', 'vyvent://e/x', 'exp://a b', null, 42]) {
            assert.equal(rsvpHref('https://orbiventt.com/invitation/', CODE, bad), 'https://orbiventt.com/rsvp/#c=' + CODE, String(bad));
        }
        assert.equal(/\?/.test(rsvpHref('', CODE, RETURN_URL)), false, 'the return address reached a query string');
    });

    test('the published pass card leads with "Confirmar asistencia", app + copy secondary, and forwards the DEV return address', () => {
        const template = resolveTemplate('wedding_romantic_v1');
        const { config } = normalizeConfig(demoConfig('wedding_romantic_v1'));
        for (const [handoff, appReturn] of [[HANDOFF, null], [CLOSED, null], [null, null], [EXPO, RETURN_URL]]) {
            const document = createDocument();
            const query = '?i=q7m2k9x4pt3wz8ab&code=' + CODE + (appReturn ? '&app_return=' + encodeURIComponent(appReturn) : '');
            const result = renderInvitation({
                template, config, document,
                route: parseRoute(query),
                assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
                templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
                now: Date.parse('2026-08-01T12:00:00Z'),
                pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/' + query,
                handoff, smartOpen: null,
            });
            const card = result.node.querySelector('[data-section="passes"]');
            const actions = card.querySelector('.inv-passes__actions');
            const first = actions.children[0];
            assert.equal(first.tagName, 'a');
            assert.match(first.textContent, /Confirmar asistencia/);
            assert.ok(first.getAttribute('class').includes('inv-btn--solid'), 'the web reply is not the primary control');
            assert.equal(first.getAttribute('href'), 'https://cosioyair.github.io/vyvent-legal/rsvp/#c=' + CODE + (appReturn ? '&r=' + encodeURIComponent(appReturn) : ''));
            assert.equal(/\?code=/.test(first.getAttribute('href')), false);
            const open = actions.querySelectorAll('a').find((a) => /Abrir Orbiventt/.test(a.textContent));
            if (handoff && handoff.open) assert.ok(open.getAttribute('class').includes('inv-btn--ghost'), 'the app CTA stayed primary');
            else assert.equal(open, undefined);
            assert.equal(card.querySelectorAll('.inv-btn--solid').length, 1);
        }
    });

    test('404.html: /e/{id}?code= shows the same primary CTA above the app button, fragment transport, return address forwarded', () => {
        const code = LANDING.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.match(LANDING, /<a id="rsvpCta" class="btn hidden" href="#">Confirmar asistencia<\/a>/);
        assert.ok(LANDING.indexOf('id="rsvpCta"') < LANDING.indexOf('id="openApp"'), 'the reply CTA is not above the app button');
        assert.ok(code.includes("el('rsvpCta').setAttribute('href', 'rsvp/#c=' + encodeURIComponent(code) + ret)"));
        assert.ok(code.includes("var ret = appReturn && /^exps?:\\/\\//i.test(appReturn)"));
        assert.ok(code.includes("'&r=' + encodeURIComponent(appReturn)"));
        assert.ok(code.includes("show('rsvpCta')"));
        assert.equal(/rsvp\/\?code=/.test(code), false, 'the code travels as a query parameter');
        assert.equal(/rsvp\/#c=[^\n]*app_return/.test(code), false, 'the raw query name leaked into the fragment');
        assert.match(LANDING, /#openApp\.btn, #rsvpCta\.btn \{/);
    });
});

/* ── helpers ───────────────────────────────────────────────────────────────── */

function jsFiles() {
    return readdirSync(join(RSVP, 'js'), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.js'))
        .map((e) => e.name);
}

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fakeWindow({ hash = '', search = '' } = {}) {
    const store = {};
    return {
        location: { hash, search, pathname: '/vyvent-legal/rsvp/' },
        sessionStorage: {
            store,
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; },
            removeItem: (k) => { delete store[k]; },
        },
        history: { calls: [], replaceState(...a) { this.calls.push(a); } },
    };
}
