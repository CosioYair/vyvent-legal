/**
 * CONFIRMAR ASISTENCIA (web reply page) — contract tests.
 *
 *   node --test scripts/__tests__/
 *
 * The page answers an EXISTING Smart Invitation by its existing code — there
 * is no new invitation type — so most of what is pinned here is a boundary:
 * the code never reaches a query string after capture, localStorage, a log,
 * the title or a third-party host; the backend allowlist is exactly two RPCs;
 * every guest-typed string renders as TEXT (the DOM stub's innerHTML throws);
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

const { WEB_BUILD, SHARED_DIRS, DEV_SUPABASE_REF, DEV_SITE_ORIGIN } = await import(
    pathToFileURL(join(ROOT, 'scripts', 'web-env.mjs')).href
);

const load = (file) => import(pathToFileURL(join(RSVP, 'js', file)).href);
const session = await load('session.js');
const backend = await load('backend.js');
const ui = await load('ui.js');

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
        parties: over.parties || [],
    };
}

const ATTENDING = {
    id: 'p1', party_name: 'Luis Pérez', rsvp_status: 'attending', seats: 2,
    decline_note: null, updated_at: '2026-10-11T00:00:00Z',
    companions: [{ position: 2, name: 'Marta' }],
};
const DECLINED = {
    id: 'p2', party_name: 'Rosa Díaz', rsvp_status: 'declined', seats: 0,
    decline_note: 'Estaré de viaje', updated_at: '2026-10-11T00:00:00Z', companions: [],
};
const HANDOFF = { open: true, href: 'vyvent://e/' + EVENT_ID + '?code=' + CODE, source: 'app-scheme', reason: null };
const CLOSED = { open: false, href: null, source: 'none', reason: 'expo-go-required' };

function ready(p, over = {}) {
    return { phase: 'ready', code: CODE, payload: p, view: 'idle', editing: null, result: null, ...over };
}

function render(model, handlers = {}, opts = {}) {
    const document = createDocument();
    const node = ui.renderApp(model, handlers, { document, storageUrl, ...opts });
    return { node, document, html: serialize(node), text: node.textContent };
}

const buttons = (node, label) => node.querySelectorAll('button').filter((b) => b.textContent === label);
const links = (node, label) => node.querySelectorAll('a').filter((a) => a.textContent === label);
const byId = (node, id) => node.querySelector('[id="' + id + '"]');

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
            // Neither the query nor a fragment survives in the address bar.
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

    test('the RPC allowlist is closed to exactly the two guest functions', async () => {
        const calls = [];
        const fetchStub = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }; };
        assert.notEqual(await backend.callRpc('guest_resolve_invitation', {}, { fetch: fetchStub, env }), null);
        assert.notEqual(await backend.callRpc('guest_respond', {}, { fetch: fetchStub, env }), null);
        for (const forbidden of [
            'get_event_web_rsvps', 'claim_smart_invitation', 'get_published_invitation',
            'scanner_check_in', 'get_public_event_preview', 'publish_invitation',
        ]) {
            assert.equal(await backend.callRpc(forbidden, {}, { fetch: fetchStub, env }), null, forbidden);
        }
        assert.equal(calls.length, 2);
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
        // A 400 without a readable message is just a failure.
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

    test('storage URLs resolve only our two buckets, safely encoded, same origin', () => {
        assert.equal(storageUrl('event-photos', 'u1/a b.jpg'), SUPA + '/storage/v1/object/public/event-photos/u1/a%20b.jpg');
        assert.equal(storageUrl('avatars', 'u1/av.jpg'), SUPA + '/storage/v1/object/public/avatars/u1/av.jpg');
        assert.equal(storageUrl('invitation-media', 'x.jpg'), null);
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
        // Without a store module there is simply no link.
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

    test('cancelled, finished and expired banners — cancelled wins, controls hidden', () => {
        const cancelled = render(ready(payload({ event: { is_cancelled: true, is_finished: true }, invitation: { accepting_responses: false } })));
        assert.match(cancelled.text, /Este evento fue cancelado\./);
        assert.equal(/ya terminó/.test(cancelled.text), false);
        const finished = render(ready(payload({ event: { is_finished: true }, invitation: { accepting_responses: false } })));
        assert.match(finished.text, /Este evento ya terminó\./);
        const expired = render(ready(payload({ invitation: { is_expired: true, accepting_responses: false } })));
        assert.match(expired.text, /Esta invitación ya no está activa\./);
        for (const out of [cancelled, finished, expired]) {
            assert.equal(buttons(out.node, 'Confirmar asistencia').length, 0, 'controls rendered on a closed invitation');
            assert.equal(out.node.querySelectorAll('input').length, 0);
        }
        // Existing answers are still visible, read-only.
        const withParty = render(ready(payload({ invitation: { is_expired: true, accepting_responses: false }, parties: [ATTENDING] })));
        assert.match(withParty.text, /Luis Pérez/);
        assert.equal(buttons(withParty.node, 'Cambiar mi respuesta').length, 0);
        assert.equal(buttons(withParty.node, 'Responder como otra persona').length, 0);
        assert.equal(render(ready(payload())).node.querySelectorAll('.rsvp-banner').length, 0);
    });

    test('ok-empty: the event card, es-MX date, map, calendar, and the single primary CTA', () => {
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
        const cal = links(out.node, 'Agregar al calendario')[0];
        assert.match(cal.getAttribute('href'), /^data:text\/calendar;charset=utf-8,/);
        assert.match(decodeURIComponent(cal.getAttribute('href')), /SUMMARY:Cumple de Ana/);
        assert.match(cal.getAttribute('download'), /\.ics$/);

        const imgs = out.node.querySelectorAll('img');
        assert.ok(imgs.every((i) => i.getAttribute('src').startsWith(SUPA + '/storage/v1/object/public/')));
        assert.equal(out.node.querySelectorAll('.rsvp-event__cover').length, 1);
        assert.equal(out.node.querySelectorAll('.rsvp-event__avatar').length, 1);
        assert.equal(out.node.querySelector('.rsvp-gallery').querySelectorAll('img').length, 2, 'the cover repeats in the strip');

        assert.equal(buttons(out.node, 'Confirmar asistencia').length, 1);
        assert.equal(out.node.querySelectorAll('.rsvp-btn--primary').length, 1, 'more than one primary control');
        buttons(out.node, 'Confirmar asistencia')[0].dispatch('click');
        assert.deepEqual(chosen, [['choose', null]]);
    });

    test('the gallery is capped at six and skips unresolvable paths', () => {
        const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => 'u1/' + n + '.jpg');
        const out = render(ready(payload({ event: { cover_path: null, gallery_paths: many.concat(['../x.jpg']) } })));
        assert.equal(out.node.querySelector('.rsvp-gallery').querySelectorAll('img').length, 6);
    });

    test('choose: two big answers; attending is disabled when no pass is left', () => {
        const chosen = [];
        const out = render(ready(payload(), { view: 'choose' }), { onChoose: (...a) => chosen.push(a), onCancel: () => chosen.push(['cancel']) });
        assert.match(out.text, /¿Nos acompañas\?/);
        buttons(out.node, 'Sí, asistiré')[0].dispatch('click');
        buttons(out.node, 'No podré asistir')[0].dispatch('click');
        buttons(out.node, 'Cancelar')[0].dispatch('click');
        assert.deepEqual(chosen, [['attend', null], ['decline', null], ['cancel']]);

        const full = render(ready(payload({ invitation: { seats_remaining: 0 } }), { view: 'choose' }), { onChoose: (...a) => chosen.push(a) });
        assert.equal(buttons(full.node, 'Sí, asistiré')[0].disabled, true);
        assert.match(full.text, /ya no tiene pases disponibles/);
        buttons(full.node, 'Sí, asistiré')[0].dispatch('click');
        assert.equal(chosen.length, 3, 'a disabled answer still fired');
        // Changing an attending party re-takes its own seats, so it stays enabled.
        const editing = render(ready(payload({ invitation: { seats_remaining: 0 }, parties: [ATTENDING] }), { view: 'choose', editing: ATTENDING }));
        assert.equal(buttons(editing.node, 'Sí, asistiré')[0].disabled, false);
        assert.match(editing.text, /Cambiar mi respuesta/);
    });
});

/* ── Forms ─────────────────────────────────────────────────────────────────── */

describe('attending form', () => {
    test('the stepper runs 1..max and the companion inputs follow it', () => {
        const out = render(ready(payload(), { view: 'attend' }));
        assert.match(out.text, /Tienes hasta 3 pases/);
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
    test('the note counts to 500 and is capped there', () => {
        const out = render(ready(payload(), { view: 'decline' }));
        assert.match(out.text, /¿Quieres dejarle un mensaje al organizador\?/);
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
    test('every party under the code is listed, with change + another-person controls', () => {
        const chosen = [];
        const out = render(ready(payload({ parties: [ATTENDING, DECLINED] })), { onChoose: (...a) => chosen.push(a) });
        assert.equal(out.node.querySelectorAll('.rsvp-party').length, 2);
        assert.match(out.text, /Tu respuesta actual/);
        assert.match(out.text, /Luis Pérez/);
        assert.match(out.text, /Asistirás con 2 pases\./);
        assert.match(out.text, /Marta/);
        assert.match(out.text, /Rosa Díaz/);
        assert.match(out.text, /Indicaste que no asistirás\./);
        assert.match(out.text, /Estaré de viaje/);
        assert.equal(buttons(out.node, 'Confirmar asistencia').length, 0, 'the first-time prompt rendered on a return visit');
        buttons(out.node, 'Cambiar mi respuesta')[1].dispatch('click');
        buttons(out.node, 'Responder como otra persona')[0].dispatch('click');
        assert.deepEqual(chosen, [['choose', DECLINED], ['choose', null]]);
    });

    test('attending result: greeting, pass count, and the ONE primary app CTA', () => {
        const armed = [];
        const plan = { strategy: 'ios-scheme-fallback', href: HANDOFF.href, storeUrl: 'https://apps.apple.com/app/id6788249586', platform: 'ios', arm: (a) => { armed.push(a); return () => {}; } };
        const out = render(ready(payload({ parties: [ATTENDING] }), { result: { status: 'attending', name: 'Luis Pérez', seats: 2 } }), {}, { handoff: HANDOFF, smartOpen: plan });
        assert.match(out.text, /¡Listo, Luis Pérez! ?Confirmaste 2 pases\./);
        assert.match(out.text, /Vive el evento completo en Orbiventt/);
        const items = out.node.querySelector('.rsvp-promo').querySelectorAll('li').map((li) => li.textContent);
        assert.deepEqual(items, ['Chat del evento', 'Compartir fotos', 'Comentarios y reacciones', 'Notificaciones', 'Itinerario']);
        const open = links(out.node, 'Abrir Orbiventt');
        assert.equal(open.length, 1);
        assert.equal(open[0].getAttribute('href'), HANDOFF.href);
        assert.ok(open[0].getAttribute('class').includes('rsvp-btn--primary'));
        assert.deepEqual(armed, [open[0]]);
        assert.equal(out.node.querySelectorAll('.rsvp-btn--primary').length, 1);
        assert.equal(/Descargar|App Store|Google Play/i.test(out.text), false);
        // The singular reads right too.
        assert.match(render(ready(payload(), { result: { status: 'attending', name: 'Ana', seats: 1 } })).text, /Confirmaste 1 pase\./);
    });

    test('the smart plan supplies the href; a closed handoff falls back to copying the code', async () => {
        const intent = 'intent://e/' + EVENT_ID + '?code=' + CODE + '#Intent;scheme=vyvent;package=com.vyvent.mobile;S.browser_fallback_url=x;end';
        const android = render(ready(payload(), { result: { status: 'attending', name: 'Ana', seats: 1 } }), {}, {
            handoff: HANDOFF, smartOpen: { strategy: 'android-intent', href: intent, storeUrl: 'x', platform: 'android', arm: () => () => {} },
        });
        assert.equal(links(android.node, 'Abrir Orbiventt')[0].getAttribute('href'), intent);

        const written = [];
        for (const handoff of [null, CLOSED]) {
            const out = render(ready(payload(), { result: { status: 'attending', name: 'Ana', seats: 1 } }), {}, {
                handoff, smartOpen: { strategy: 'store-direct', href: 'https://play.google.com/x', storeUrl: 'https://play.google.com/x', platform: 'desktop', arm: () => () => {} },
                navigator: { clipboard: { writeText: (v) => { written.push(v); return Promise.resolve(); } } },
            });
            assert.equal(links(out.node, 'Abrir Orbiventt').length, 0, 'a closed handoff still rendered an open control');
            assert.match(out.text, /ABCD-EFGH-IJKL/);
            buttons(out.node, 'Copiar código')[0].dispatch('click');
            await tick();
            assert.equal(out.node.querySelector('.rsvp-status').textContent, 'Código copiado');
        }
        assert.deepEqual(written, ['ABCD-EFGH-IJKL', 'ABCD-EFGH-IJKL']);
    });

    test('declined result: thanks naming the organizer, app promotion muted only', () => {
        const out = render(ready(payload({ parties: [DECLINED] }), { result: { status: 'declined', name: 'Rosa', seats: 0 } }), {}, { handoff: HANDOFF, storeUrl: 'https://apps.apple.com/app/id6788249586' });
        assert.match(out.text, /Gracias por responder\. ?Tu respuesta fue enviada a Ana Ruiz\./);
        assert.equal(links(out.node, 'Abrir Orbiventt').length, 0);
        assert.equal(out.node.querySelectorAll('.rsvp-promo').length, 0);
        assert.equal(out.node.querySelectorAll('.rsvp-btn--primary').length, 0, 'a primary control on the declined result');
        const link = links(out.node, 'Conoce Orbiventt')[0];
        assert.ok(link && link.parentNode.getAttribute('class').includes('rsvp-muted'));
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
                { ...ATTENDING, party_name: hostile, companions: [{ position: 2, name: hostile }] },
                { ...DECLINED, decline_note: hostile },
            ],
        });
        const out = render(ready(p, { result: { status: 'attending', name: hostile, seats: 1 } }), {}, { handoff: HANDOFF });
        assert.equal(out.html.includes('<img src=x'), false);
        assert.ok(out.html.split('&lt;img src=x onerror=alert(1)&gt;').length >= 7, 'hostile text did not survive as text everywhere');
        for (const img of out.node.querySelectorAll('img')) assert.equal(img.hasAttribute('onerror'), false);
        // The prefilled form draws it into a value, never an attribute.
        const form = render(ready(p, { view: 'attend', editing: p.parties[0] }));
        assert.equal(byId(form.node, 'rsvp-name').value, hostile);
        assert.equal(serialize(form.node).includes('<img src=x'), false);
    });

    test('no innerHTML, outerHTML, insertAdjacentHTML, eval or inline handler anywhere in rsvp/js', () => {
        for (const file of jsFiles()) {
            const src = stripComments(read('js', file));
            for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'onclick', 'onerror']) {
                assert.equal(src.includes(bad), false, `${file} contains ${bad}`);
            }
        }
    });

    test('the copy never names a second invitation type', () => {
        const sources = jsFiles().map((f) => stripComments(read('js', f))).concat([HTML.replace(/<!--[\s\S]*?-->/g, '')]);
        for (const src of sources) {
            assert.equal(/invitaci[oó]n web/i.test(src), false, 'copy says "invitación web"');
            assert.equal(/\bRSVP\b/.test(src), false, 'copy says "RSVP"');
        }
        const uiSrc = stripComments(read('js', 'ui.js'));
        assert.ok(uiSrc.includes("'Confirmar asistencia'"));
        assert.ok(uiSrc.includes('tu invitación'));
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

    test('EVERY executable edge carries the current WEB_BUILD, and the stamper agrees', () => {
        const refs = [...HTML.matchAll(/(?:src|href)="((?:rsvp\/|env\.js|app-return\.js|app-store-links\.js)[^"?]*)(\?v=([^"]*))?"/g)];
        assert.ok(refs.length >= 5, `only ${refs.length} entry refs found`);
        refs.forEach(([, path, , token]) => assert.equal(token, WEB_BUILD, `${path} is not on WEB_BUILD`));
        let edges = 0;
        for (const file of jsFiles()) {
            for (const m of read('js', file).matchAll(/(?:from\s*|import\()\s*'(\.\.?\/[^']+?\.js)(\?v=([^']*))?'/g)) {
                edges += 1;
                assert.equal(m[3], WEB_BUILD, `${file}: ${m[1]} is not on WEB_BUILD`);
            }
        }
        assert.ok(edges >= 5, `only ${edges} import edges found`);
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
        // It shares the premium primary treatment the app button already has.
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
