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
 * and the two entry points (the invitation's pass card and /e/{id}?code=)
 * point at this page with the code in the FRAGMENT.
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
const LANDING = readFileSync(join(ROOT, '404.html'), 'utf8');
const VENDOR = read('vendor', 'qrcode-generator.js');

const { WEB_BUILD, SHARED_DIRS, DEV_SUPABASE_REF, DEV_SITE_ORIGIN } = await import(
    pathToFileURL(join(ROOT, 'scripts', 'web-env.mjs')).href
);

const load = (file) => import(pathToFileURL(join(RSVP, 'js', file)).href);
const session = await load('session.js');
const backend = await load('backend.js');
const qr = await load('qr.js');
const ui = await load('ui.js');

/** The vendored UMD encoder, evaluated the way a classic script would be. */
// eslint-disable-next-line no-new-func
const qrcode = new Function('exports', 'module', 'define', VENDOR + '\nreturn qrcode;')();

const CODE = 'ABCDEFGHIJKL';
const EVENT_ID = '91000001-0000-4000-8000-000000000001';
const SUPA = 'https://mfaymuisnpfdolqogktx.supabase.co';
const storageUrl = backend.storageUrlResolver(SUPA);
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ── fixtures ──────────────────────────────────────────────────────────────── */

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
const CLOSED = { open: false, href: null, source: 'none', reason: 'expo-go-required' };

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
const primaries = (node) => node.querySelectorAll('.rsvp-btn--primary');
const warnings = (node) => node.querySelectorAll('.rsvp-warning');
const answerClasses = (node) => node.querySelector('.rsvp-answer').children.map((c) => c.getAttribute('class') || '');

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
        assert.equal(storageUrl('event-photos', 'u1/a b.jpg'), SUPA + '/storage/v1/object/public/event-photos/u1/a%20b.jpg');
        assert.equal(storageUrl('avatars', 'u1/av.jpg'), SUPA + '/storage/v1/object/public/avatars/u1/av.jpg');
        assert.equal(storageUrl('invitation-media', 'di/x.jpg'), SUPA + '/storage/v1/object/public/invitation-media/di/x.jpg');
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
        }
        // Existing answers are still visible, read-only — but an EXPIRED link
        // still shows the passes it already granted: the door is still ahead.
        const expiredParty = render(ready(payload({ invitation: { is_expired: true, accepting_responses: false }, parties: [ATTENDING] })));
        assert.match(expiredParty.text, /Luis Pérez/);
        assert.equal(buttons(expiredParty.node, 'Cambiar mi respuesta').length, 0);
        assert.equal(buttons(expiredParty.node, 'Prefiero usar la app').length, 0);
        assert.equal(buttons(expiredParty.node, 'Administrar mis pases').length, 1);
        for (const closed of [{ is_finished: true }, { is_cancelled: true }]) {
            const out = render(ready(payload({ event: closed, invitation: { accepting_responses: false }, parties: [ATTENDING] })));
            assert.equal(buttons(out.node, 'Administrar mis pases').length, 0, 'passes offered for an event with no door');
            assert.equal(buttons(out.node, 'Cambiar mi respuesta').length, 0);
        }
        assert.equal(render(ready(payload())).node.querySelectorAll('.rsvp-banner').length, 0);
    });

    test('ok-empty: the event card, es-MX date, map, NO calendar, and ONE two-path choice with no primary', () => {
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

        const imgs = out.node.querySelectorAll('img');
        assert.ok(imgs.every((i) => i.getAttribute('src').startsWith(SUPA + '/storage/v1/object/public/')));
        assert.equal(out.node.querySelectorAll('.rsvp-event__cover').length, 1);
        assert.equal(out.node.querySelectorAll('.rsvp-event__avatar').length, 1);
        assert.equal(out.node.querySelector('.rsvp-gallery').querySelectorAll('img').length, 2, 'the cover repeats in the strip');

        // ONE deliberate choice: two equal paths, no primary, no standalone CTA.
        assert.match(out.text, /Confirmar asistencia/);
        assert.equal(buttons(out.node, 'Confirmar asistencia').length, 0, 'the old standalone primary CTA is back');
        assert.equal(out.node.querySelectorAll('.rsvp-btn--path').length, 2);
        assert.equal(primaries(out.node).length, 0, 'a primary control on the path choice');
        assert.equal(warnings(out.node).length, 0, 'the warning precedes any choice');
        assert.equal(buttons(out.node, 'Responder como otra persona').length, 0);
        pathButtons(out.node, 'Confirmar desde la web')[0].dispatch('click');
        pathButtons(out.node, 'Confirmar desde la app')[0].dispatch('click');
        assert.deepEqual(chosen, [['choose', null], ['app', null]]);
    });

    test('the gallery is capped at six and skips unresolvable paths', () => {
        const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => 'u1/' + n + '.jpg');
        const out = render(ready(payload({ event: { cover_path: null, gallery_paths: many.concat(['../x.jpg']) } })));
        assert.equal(out.node.querySelector('.rsvp-gallery').querySelectorAll('img').length, 6);
    });

    test('the first image is the invitation thumbnail, then the event cover, then nothing', () => {
        const media = render(ready(payload({ invitation_image: { bucket: 'invitation-media', path: 'di/thumb.jpg', width: 1200, height: 630 } })));
        const first = media.node.querySelector('.rsvp-event__cover');
        assert.equal(first.getAttribute('src'), SUPA + '/storage/v1/object/public/invitation-media/di/thumb.jpg');
        assert.ok(first.getAttribute('class').includes('rsvp-event__cover--invitation'));
        assert.equal(media.node.querySelectorAll('img')[0], first, 'the thumbnail is not the first image on the page');
        // The event cover is no longer the first image, so it joins the strip.
        assert.equal(media.node.querySelector('.rsvp-gallery').querySelectorAll('img').length, 3);

        const photos = render(ready(payload({ invitation_image: { bucket: 'event-photos', path: 'u1/share.jpg' } })));
        assert.equal(photos.node.querySelector('.rsvp-event__cover').getAttribute('src'), SUPA + '/storage/v1/object/public/event-photos/u1/share.jpg');

        // A thumbnail from a bucket this page may not read falls back to the cover.
        const bad = render(ready(payload({ invitation_image: { bucket: 'stories', path: 'x.jpg' } })));
        assert.equal(bad.node.querySelector('.rsvp-event__cover').getAttribute('src'), SUPA + '/storage/v1/object/public/event-photos/u1/cover.jpg');
        assert.ok(bad.node.querySelector('.rsvp-event__cover').getAttribute('class').includes('rsvp-event__cover--cover'));

        const none = render(ready(payload({ invitation_image: null, event: { cover_path: null, gallery_paths: [] } })));
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
        buttons(out.node, 'Prefiero usar la app')[0].dispatch('click');
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

    test('app path: the code, Copiar código, the ONE smart-open button — and copy-only when the handoff is closed', async () => {
        const armed = [];
        const written = [];
        const plan = { strategy: 'ios-scheme-fallback', href: HANDOFF.href, storeUrl: 'https://apps.apple.com/app/id6788249586', platform: 'ios', arm: (a) => { armed.push(a); return () => {}; } };
        const calls = [];
        const out = render(ready(payload(), { view: 'app' }), { onCancel: () => calls.push('cancel') }, {
            handoff: HANDOFF, smartOpen: plan,
            navigator: { clipboard: { writeText: (v) => { written.push(v); return Promise.resolve(); } } },
        });
        assert.equal(out.node.querySelector('.rsvp-app-path').getAttribute('data-view'), 'app');
        assert.match(out.text, /Confirmar desde la app/);
        assert.match(out.text, /ABCD-EFGH-IJKL/);
        assert.match(out.text, /Si Orbiventt no se abre automáticamente, copia el código/);
        const open = links(out.node, 'Abrir Orbiventt');
        assert.equal(open.length, 1);
        assert.equal(open[0].getAttribute('href'), HANDOFF.href);
        assert.deepEqual(armed, [open[0]]);
        assert.equal(primaries(out.node).length, 1);
        assert.equal(primaries(out.node)[0], open[0]);
        assert.equal(warnings(out.node).length, 0, 'the app path has no link to protect yet');
        assert.equal(out.node.querySelectorAll('.rsvp-btn--path').length, 0, 'the path choice rendered beside the app card');
        buttons(out.node, 'Copiar código')[0].dispatch('click');
        await tick();
        assert.equal(out.node.querySelector('.rsvp-status').textContent, 'Código copiado');
        assert.deepEqual(written, ['ABCD-EFGH-IJKL']);
        buttons(out.node, 'Volver')[0].dispatch('click');
        assert.deepEqual(calls, ['cancel']);

        const intent = 'intent://e/' + EVENT_ID + '?code=' + CODE + '#Intent;scheme=vyvent;package=com.vyvent.mobile;S.browser_fallback_url=x;end';
        const android = render(ready(payload(), { view: 'app' }), {}, {
            handoff: HANDOFF, smartOpen: { strategy: 'android-intent', href: intent, storeUrl: 'x', platform: 'android', arm: () => () => {} },
        });
        assert.equal(links(android.node, 'Abrir Orbiventt')[0].getAttribute('href'), intent);

        for (const handoff of [null, CLOSED]) {
            const closed = render(ready(payload(), { view: 'app' }), {}, {
                handoff, smartOpen: { strategy: 'store-direct', href: 'https://play.google.com/x', storeUrl: 'https://play.google.com/x', platform: 'desktop', arm: () => () => {} },
            });
            assert.equal(links(closed.node, 'Abrir Orbiventt').length, 0, 'a closed handoff still rendered an open control');
            assert.match(closed.text, /ABCD-EFGH-IJKL/);
            assert.equal(buttons(closed.node, 'Copiar código').length, 1);
            assert.match(closed.text, /Copia el código e ingrésalo manualmente en la aplicación Orbiventt/);
            assert.equal(primaries(closed.node).length, 0);
        }
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
    test('every party is listed under the warning; change + manage per party; no "another person"; app only as a quiet link', () => {
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

        // (c) the warning, once, above the first card.
        assert.equal(warnings(out.node).length, 1);
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-warning'), classes.join(' | '));
        assert.ok(classes[1].includes('rsvp-party'));

        assert.equal(out.node.querySelectorAll('.rsvp-btn--path').length, 0, 'the path choice rendered on a return visit');
        assert.equal(buttons(out.node, 'Confirmar asistencia').length, 0);
        assert.equal(buttons(out.node, 'Responder como otra persona').length, 0, 'the removed control is back');
        assert.equal(buttons(out.node, 'Cambiar mi respuesta').length, 2);
        assert.equal(buttons(out.node, 'Administrar mis pases').length, 1, 'one manage action per ATTENDING party');
        assert.ok(buttons(out.node, 'Administrar mis pases')[0].getAttribute('class').includes('rsvp-btn--ghost'));
        assert.equal(primaries(out.node).length, 0, 'a primary with QR off');
        assert.equal(/QR están listos/.test(out.text), false);
        assert.equal(buttons(out.node, 'Prefiero usar la app').length, 1);
        assert.ok(out.node.querySelector('.rsvp-party').querySelectorAll('.rsvp-btn--link').length === 0, 'the app link sits under, not inside, a card');

        buttons(out.node, 'Cambiar mi respuesta')[1].dispatch('click');
        buttons(out.node, 'Administrar mis pases')[0].dispatch('click');
        buttons(out.node, 'Prefiero usar la app')[0].dispatch('click');
        assert.deepEqual(chosen, [['choose', DECLINED], ['app', null]]);
        assert.deepEqual(managed, [ATTENDING]);
    });

    test('QR on: the card says the passes are ready and "Administrar mis pases" is THE primary', () => {
        const out = render(ready(payload({ event: { qr_enabled: true }, parties: [ATTENDING, DECLINED] })));
        assert.match(out.text, /Tus pases con código QR están listos/);
        const manage = buttons(out.node, 'Administrar mis pases');
        assert.equal(manage.length, 1);
        assert.ok(manage[0].getAttribute('class').includes('rsvp-btn--primary'));
        assert.equal(primaries(out.node).length, 1);
        assert.equal(out.node.querySelectorAll('.rsvp-ready').length, 1, 'the ready line leaked onto the declined card');
    });

    test('what the organizer asked the party to bring is listed on its card', () => {
        const party = { ...ATTENDING, assigned_items: [{ id: 'b1', label: 'Hielo' }, { id: 'b2', label: 'Vasos' }, { id: 'b3', label: '' }] };
        const out = render(ready(payload({ parties: [party] })));
        assert.match(out.text, /Te pidieron llevar:/);
        assert.deepEqual(out.node.querySelector('.rsvp-party__items').querySelectorAll('li').map((li) => li.textContent), ['Hielo', 'Vasos']);
        assert.equal(/Te pidieron llevar/.test(render(ready(payload({ parties: [ATTENDING] }))).text), false);
    });

    test('the app path from a return visit renders under the cards, with Volver', () => {
        const calls = [];
        const out = render(ready(payload({ parties: [ATTENDING] }), { view: 'app' }), { onCancel: () => calls.push('cancel') }, { handoff: HANDOFF });
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-warning') && classes[1].includes('rsvp-party') && classes[2].includes('rsvp-app-path'), classes.join(' | '));
        assert.equal(buttons(out.node, 'Prefiero usar la app').length, 0);
        assert.equal(links(out.node, 'Abrir Orbiventt').length, 1);
        buttons(out.node, 'Volver')[0].dispatch('click');
        assert.deepEqual(calls, ['cancel']);
    });

    test('attending result: confirmation → app benefits (Abrir Orbiventt SECONDARY) → warning → the party card; no copy-the-code message', () => {
        const armed = [];
        const plan = { strategy: 'ios-scheme-fallback', href: HANDOFF.href, storeUrl: 'https://apps.apple.com/app/id6788249586', platform: 'ios', arm: (a) => { armed.push(a); return () => {}; } };
        const out = render(ready(payload({ parties: [ATTENDING] }), { result: { status: 'attending', name: 'Luis Pérez', seats: 2 } }), {}, { handoff: HANDOFF, smartOpen: plan });
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

        // (b) the warning, once, in the spec'd order, above the party card.
        assert.equal(warnings(out.node).length, 1);
        const classes = answerClasses(out.node);
        assert.ok(classes[0].includes('rsvp-result--ok'), classes.join(' | '));
        assert.ok(classes[1].includes('rsvp-promo'));
        assert.ok(classes[2].includes('rsvp-warning'));
        assert.ok(classes[3].includes('rsvp-party'));
        assert.equal(classes.length, 4, 'an extra control after the party card');
        assert.equal(buttons(out.node, 'Administrar mis pases').length, 1);
        assert.equal(buttons(out.node, 'Prefiero usar la app').length, 0, 'two ways into the app on one screen');
        // The singular reads right too.
        assert.match(render(ready(payload(), { result: { status: 'attending', name: 'Ana', seats: 1 } })).text, /Confirmaste 1 pase\./);
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
            buttons(out.node, 'Prefiero usar la app')[0].dispatch('click');
        }
        assert.deepEqual(chosen, [['app', null], ['app', null]]);
    });

    test('declined result: thanks naming the organizer, app promotion muted only, warning above the card', () => {
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

    test('active: one card per pass with its title, a QR only where a payload exists', () => {
        const out = render(managing({ event: { qr_enabled: true } }, { status: 'ok', data: passesOk() }));
        const cards = out.node.querySelectorAll('.rsvp-pass');
        assert.equal(cards.length, 2);
        assert.equal(cards[0].querySelector('.rsvp-pass__title').textContent, 'Pase 1 de 2 · Titular: Luis Pérez');
        assert.equal(cards[1].querySelector('.rsvp-pass__title').textContent, 'Pase 2 de 2 · Acompañante: Marta');
        assert.equal(cards[0].getAttribute('data-state'), 'active');
        assert.equal(out.node.querySelectorAll('svg').length, 2);
        assert.equal(out.node.querySelectorAll('.rsvp-qr').length, 2);
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
        const titles = partial.node.querySelectorAll('.rsvp-pass__title').map((t) => t.textContent);
        assert.deepEqual(titles, ['Pase 1 de 2 · Titular: Luis Pérez', 'Pase 2 de 2 · Acompañante: Marta']);
        assert.equal(partial.node.querySelectorAll('svg').length, 1);
        assert.equal(partial.node.querySelectorAll('.rsvp-pass')[0].querySelectorAll('svg').length, 0);
        assert.match(partial.node.querySelectorAll('.rsvp-pass')[0].textContent, /Este pase no está disponible por ahora\./);
        // No encoder on the page: nothing is drawn, nothing throws.
        assert.equal(render(managing({ event: { qr_enabled: true } }, { status: 'ok', data: passesOk() }), {}, { qrcode: null }).node.querySelectorAll('svg').length, 0);
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
        assert.equal(out.node.querySelectorAll('svg').length, 0);
        assert.equal(out.node.querySelectorAll('.rsvp-pass').length, 3);
        assert.equal(out.node.querySelectorAll('.rsvp-pass__state').filter((p) => p.textContent === 'QR desactivado por el organizador').length, 3);
        assert.equal(out.node.querySelectorAll('.rsvp-passes__notice').length, 1);
        assert.match(out.text, /Si el organizador activa el acceso con código QR, tus pases podrán escanearse automáticamente\. Vuelve a abrir este mismo enlace para verlos\./);
        assert.equal(out.node.querySelectorAll('.rsvp-pass__title')[2].textContent, 'Pase 3 de 3 · Acompañante');
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
        assert.equal(cards[0].querySelectorAll('svg').length, 1, 'a checked-in pass lost its QR');
        assert.equal(cards[1].querySelectorAll('.rsvp-pass__checkin').length, 0);
        assert.equal(cards[1].getAttribute('data-state'), 'suspended');
        assert.equal(cards[1].querySelectorAll('svg').length, 0);
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
        assert.equal(expired.node.querySelectorAll('svg').length, 2);
        assert.equal(buttons(expired.node, 'Cambiar mi respuesta').length, 0);
    });

    test('a hostile holder or companion label on a pass renders as text', () => {
        const hostile = '<img src=x onerror=alert(1)>';
        const data = passesOk({ holder_label: hostile, passes: [{ ...passesOk().passes[0], occupant_label: hostile }, { ...passesOk().passes[1], occupant_label: hostile }] });
        const out = render(managing({ event: { qr_enabled: true } }, { status: 'ok', data }));
        assert.equal(out.html.includes('<img src=x'), false);
        assert.ok(out.html.split('&lt;img src=x onerror=alert(1)&gt;').length >= 3);
        assert.equal(out.node.querySelectorAll('svg').length, 2, 'the QR depends on the payload, never on the label');
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
    test('a hostile party name, companion, note, greeting and title render as text', () => {
        const hostile = '<img src=x onerror=alert(1)>';
        const p = payload({
            event: { title: hostile + ' título' },
            invitation: { greeting: hostile, label: hostile },
            parties: [
                { ...ATTENDING, party_name: hostile, companions: [{ position: 2, name: hostile }], assigned_items: [{ id: 'b', label: hostile }] },
                { ...DECLINED, decline_note: hostile },
            ],
        });
        const out = render(ready(p, { result: { status: 'attending', name: hostile, seats: 1 } }), {}, { handoff: HANDOFF });
        assert.equal(out.html.includes('<img src=x'), false);
        assert.ok(out.html.split('&lt;img src=x onerror=alert(1)&gt;').length >= 8, 'hostile text did not survive as text everywhere');
        for (const img of out.node.querySelectorAll('img')) assert.equal(img.hasAttribute('onerror'), false);
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
        }
        const uiSrc = stripComments(read('js', 'ui.js'));
        assert.ok(uiSrc.includes("'Confirmar asistencia'"));
        assert.ok(uiSrc.includes('tu invitación'));
        assert.ok(uiSrc.includes("'Este enlace es tu llave'"));
        assert.ok(uiSrc.includes('No lo compartas con nadie fuera de tu grupo.'));
        assert.equal(typeof ui.calendarHref, 'undefined');
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
        assert.ok(edges >= 6, `only ${edges} import edges found`);
        const stamper = readFileSync(join(ROOT, 'scripts', 'set-web-build.mjs'), 'utf8');
        assert.match(stamper, /rsvp\\\/vendor\\\/qrcode-generator\\\.js/);
        const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'set-web-build.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
        assert.match(out, /COHERENT/);
        assert.ok(out.includes(`WEB_BUILD=${WEB_BUILD}`));
    });
});

/* ── Entry points ──────────────────────────────────────────────────────────── */

describe('entry points', () => {
    test('rsvpHref resolves beside the invitation page under both roots, code in the fragment', () => {
        assert.equal(rsvpHref('https://cosioyair.github.io/vyvent-legal/invitation/?i=slug&code=' + CODE, CODE),
            'https://cosioyair.github.io/vyvent-legal/rsvp/#c=' + CODE);
        assert.equal(rsvpHref('https://orbiventt.com/invitation/?i=slug&code=' + CODE, CODE), 'https://orbiventt.com/rsvp/#c=' + CODE);
        assert.equal(rsvpHref('', CODE), 'rsvp/#c=' + CODE);
        assert.equal(rsvpHref('https://orbiventt.com/invitation/', '../evil'), null);
    });

    test('the published pass card leads with "Confirmar asistencia", app + copy secondary', () => {
        const template = resolveTemplate('wedding_romantic_v1');
        const { config } = normalizeConfig(demoConfig('wedding_romantic_v1'));
        for (const handoff of [HANDOFF, CLOSED, null]) {
            const document = createDocument();
            const result = renderInvitation({
                template, config, document,
                route: parseRoute('?i=q7m2k9x4pt3wz8ab&code=' + CODE),
                assetBase: 'https://cosioyair.github.io/vyvent-legal/invitation/assets/',
                templateBase: 'https://cosioyair.github.io/vyvent-legal/invitation/templates/',
                now: Date.parse('2026-08-01T12:00:00Z'),
                pageUrl: 'https://cosioyair.github.io/vyvent-legal/invitation/?i=q7m2k9x4pt3wz8ab&code=' + CODE,
                handoff, smartOpen: null,
            });
            const card = result.node.querySelector('[data-section="passes"]');
            const actions = card.querySelector('.inv-passes__actions');
            const first = actions.children[0];
            assert.equal(first.tagName, 'a');
            assert.match(first.textContent, /Confirmar asistencia/);
            assert.ok(first.getAttribute('class').includes('inv-btn--solid'), 'the web reply is not the primary control');
            assert.equal(first.getAttribute('href'), 'https://cosioyair.github.io/vyvent-legal/rsvp/#c=' + CODE);
            assert.equal(/\?code=/.test(first.getAttribute('href')), false);
            const open = actions.querySelectorAll('a').find((a) => /Abrir Orbiventt/.test(a.textContent));
            if (handoff && handoff.open) assert.ok(open.getAttribute('class').includes('inv-btn--ghost'), 'the app CTA stayed primary');
            else assert.equal(open, undefined);
            assert.equal(card.querySelectorAll('.inv-btn--solid').length, 1);
        }
    });

    test('404.html: /e/{id}?code= shows the same primary CTA above the app button, fragment transport', () => {
        const code = LANDING.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.match(LANDING, /<a id="rsvpCta" class="btn hidden" href="#">Confirmar asistencia<\/a>/);
        assert.ok(LANDING.indexOf('id="rsvpCta"') < LANDING.indexOf('id="openApp"'), 'the reply CTA is not above the app button');
        assert.ok(code.includes("el('rsvpCta').setAttribute('href', 'rsvp/#c=' + encodeURIComponent(code))"));
        assert.ok(code.includes("show('rsvpCta')"));
        assert.equal(/rsvp\/\?code=/.test(code), false, 'the code travels as a query parameter');
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
