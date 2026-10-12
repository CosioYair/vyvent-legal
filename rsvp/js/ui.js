/* WHAT THE GUEST SEES — every node this page draws, built from a plain model.
 *
 * PRODUCT INVARIANT (locked). This page answers an EXISTING Smart Invitation
 * ("Enlace de invitación") by its existing code. Nothing here creates, names
 * or implies a second kind of invitation: the copy says "tu invitación" and
 * "Confirmar asistencia", the seat numbers are the invitation's own pool, and
 * the organizer sees the answer in the same place as an app claim.
 *
 * PURE. `renderApp(model, handlers, opts)` takes the document as a seam and
 * returns one subtree; it never reads `window`, never fetches, never persists.
 * Every string a guest or another guest typed (party names, companions, a
 * decline note, the organizer's greeting) reaches the page as a TEXT NODE
 * through `dom.js` — there is no innerHTML anywhere in this tree, and the test
 * suite's DOM stub throws if one ever appears.
 *
 * ONE PRIMARY CONTROL PER SCREEN: "Confirmar asistencia" → "Sí, asistiré" /
 * "No podré asistir" → "Confirmar" / "Enviar respuesta" → "Abrir Orbiventt".
 */
import { el, setText, clear, paragraphs } from './dom.js?v=20261011a';
import { displayCode } from './session.js?v=20261011a';
import { buildIcs, icsDataUrl, icsFileName } from '../../invitation/js/calendar.js?v=20261011a';

export var LIMITS = {
    NAME: 80,
    NOTE: 500,
    TITLE: 200,
    LABEL: 120,
    GREETING: 2000,
    DESCRIPTION: 4000,
    ADDRESS: 300,
};

var LOCALE = 'es-MX';
var TIME_ZONE = 'America/Mexico_City';

/** An event without an end: assume three hours for the calendar entry. */
var DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

/** The real app capabilities the post-confirmation card may list. Closed. */
export var APP_CAPABILITIES = [
    'Chat del evento',
    'Compartir fotos',
    'Comentarios y reacciones',
    'Notificaciones',
    'Itinerario',
];

export var COPY = {
    offline: 'No pudimos enviar tu respuesta. Revisa tu conexión e inténtalo de nuevo.',
    rateLimited: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
    nameRequired: 'Escribe tu nombre.',
    nameTooLong: 'Tu nombre debe tener máximo ' + LIMITS.NAME + ' caracteres.',
    companionTooLong: 'Cada nombre debe tener máximo ' + LIMITS.NAME + ' caracteres.',
    noteTooLong: 'El mensaje debe tener máximo ' + LIMITS.NOTE + ' caracteres.',
    noSeats: 'Esta invitación ya no tiene pases disponibles.',
    codeShape: 'Revisa el código: debe tener 12 letras o números.',
    codeNotFound: 'No encontramos una invitación con ese código.',
    codeOffline: 'No pudimos verificar el código. Revisa tu conexión e inténtalo de nuevo.',
};

/* ── pure helpers ─────────────────────────────────────────────────────────── */

/** Trim, strip control characters (keep newlines), clamp. '' when unusable. */
export function text(value, max) {
    if (typeof value !== 'string') return '';
    var cleaned = value
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, '')
        .trim();
    return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
}

export function passesLabel(n) {
    return n === 1 ? '1 pase' : String(n) + ' pases';
}

/**
 * The most seats a party may confirm: what the invitation still has, plus
 * what this party already holds (changing an answer re-takes its own seats).
 */
export function maxSeatsFor(invitation, party) {
    var remaining = invitation && Number.isInteger(invitation.seats_remaining)
        ? Math.max(invitation.seats_remaining, 0)
        : 0;
    var own = party && party.rsvp_status === 'attending' && Number.isInteger(party.seats)
        ? Math.max(party.seats, 0)
        : 0;
    return remaining + own;
}

function fmt(ms, options) {
    try {
        var o = {};
        var keys = Object.keys(options);
        for (var i = 0; i < keys.length; i += 1) o[keys[i]] = options[keys[i]];
        o.timeZone = TIME_ZONE;
        return new Intl.DateTimeFormat(LOCALE, o).format(new Date(ms));
    } catch (_) {
        return '';
    }
}

var DATE_FMT = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
var TIME_FMT = { hour: '2-digit', minute: '2-digit', hour12: false };

/** "sábado, 17 de abril de 2027 · 17:00 h – 22:00 h", or '' when unusable. */
export function formatWhen(startsAt, endsAt) {
    var start = Date.parse(startsAt || '');
    if (!Number.isFinite(start)) return '';
    var out = fmt(start, DATE_FMT) + ' · ' + fmt(start, TIME_FMT) + ' h';
    var end = Date.parse(endsAt || '');
    if (Number.isFinite(end) && end > start) {
        out += fmt(end, DATE_FMT) === fmt(start, DATE_FMT)
            ? ' – ' + fmt(end, TIME_FMT) + ' h'
            : ' – ' + fmt(end, DATE_FMT) + ' · ' + fmt(end, TIME_FMT) + ' h';
    }
    return out;
}

/** Always Google Maps, built from constants plus ONE encoded query. */
export function mapUrl(event) {
    if (!event) return null;
    var lat = Number(event.latitude);
    var lng = Number(event.longitude);
    var query;
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        query = lat.toFixed(6) + ',' + lng.toFixed(6);
    } else {
        query = text(event.address, LIMITS.ADDRESS);
    }
    if (!query) return null;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}

/** A `data:` .ics download, built on the client; null when there is no date. */
export function calendarHref(event) {
    if (!event) return null;
    var startMs = Date.parse(event.starts_at || '');
    if (!Number.isFinite(startMs)) return null;
    var endMs = Date.parse(event.ends_at || '');
    if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + DEFAULT_DURATION_MS;
    return icsDataUrl(buildIcs({
        uid: 'orbiventt-event-' + String(event.id || ''),
        title: text(event.title, LIMITS.TITLE) || 'Evento',
        description: text(event.description, LIMITS.DESCRIPTION),
        location: text(event.address, LIMITS.ADDRESS),
        startMs: startMs,
        endMs: endMs,
        stampMs: startMs,
    }));
}

/** The one status banner, by priority; null when the invitation is live. */
export function bannerFor(payload) {
    var event = (payload && payload.event) || {};
    var invitation = (payload && payload.invitation) || {};
    if (event.is_cancelled === true) return { kind: 'cancelled', text: 'Este evento fue cancelado.' };
    if (event.is_finished === true) return { kind: 'finished', text: 'Este evento ya terminó.' };
    if (invitation.is_expired === true) return { kind: 'expired', text: 'Esta invitación ya no está activa.' };
    return null;
}

export function acceptsResponses(payload) {
    return !!(payload && payload.invitation && payload.invitation.accepting_responses === true);
}

/* ── small builders ───────────────────────────────────────────────────────── */

function button(label, variant, onClick, d, attrs) {
    var a = attrs || {};
    a.type = 'button';
    var node = el('button', {
        class: 'rsvp-btn rsvp-btn--' + variant,
        attrs: a,
        text: label,
        document: d,
    });
    if (typeof onClick === 'function' && typeof node.addEventListener === 'function') {
        node.addEventListener('click', onClick);
    }
    return node;
}

function externalLink(href, label, d, className) {
    return el('a', {
        class: className || null,
        attrs: { href: href, target: '_blank', rel: 'noopener noreferrer' },
        text: label,
        document: d,
    });
}

function brand(d) {
    return el('p', { class: 'rsvp-brand', text: 'Orbiventt', document: d });
}

function errorLine(d) {
    return el('p', { class: 'rsvp-error', attrs: { role: 'alert' }, document: d });
}

function valueOf(input) {
    return input && typeof input.value === 'string' ? input.value : '';
}

/* ── controlled states ────────────────────────────────────────────────────── */

function loadingNode(d) {
    return el('div', {
        class: 'rsvp-loading',
        attrs: { role: 'status' },
        children: [
            el('span', { class: 'rsvp-loading__mark', attrs: { 'aria-hidden': 'true' }, document: d }),
            el('p', { class: 'rsvp-loading__text', text: 'Buscando tu invitación…', document: d }),
        ],
        document: d,
    });
}

/** THE ONE ANSWER for not_found, rate_limited and every transport failure. */
function unavailableNode(model, handlers, o) {
    var d = o.document;
    return el('section', {
        class: 'rsvp-state',
        attrs: { role: 'status' },
        children: [
            brand(d),
            el('h1', { text: 'Esta invitación no está disponible.', document: d }),
            el('p', {
                text: 'Revisa que el enlace esté completo o pídeselo de nuevo a quien te invitó.',
                document: d,
            }),
            model.retryable && handlers && handlers.onRetry
                ? button('Reintentar', 'ghost', handlers.onRetry, d)
                : null,
            o.storeUrl
                ? el('p', { class: 'rsvp-muted', children: [externalLink(o.storeUrl, 'Conoce Orbiventt', d)], document: d })
                : null,
        ],
        document: d,
    });
}

/** Manual entry, for a visit that carried no code. */
function codeEntryNode(model, handlers, o) {
    var d = o.document;
    var input = el('input', {
        attrs: {
            id: 'rsvp-code', type: 'text', inputmode: 'text', autocomplete: 'off',
            autocapitalize: 'characters', placeholder: 'XXXX-XXXX-XXXX', maxlength: '20',
            enterkeyhint: 'go', 'aria-describedby': 'rsvp-code-hint',
        },
        document: d,
    });
    var error = errorLine(d);
    setText(error, model.entryError || '');
    var submit = function () { handlers.onCode(valueOf(input)); };
    if (typeof input.addEventListener === 'function') {
        input.addEventListener('keydown', function (event) {
            if (event && event.key === 'Enter') {
                if (typeof event.preventDefault === 'function') event.preventDefault();
                submit();
            }
        });
    }
    return el('section', {
        class: 'rsvp-card rsvp-entry',
        children: [
            brand(d),
            el('h1', { text: '¿Tienes un código de invitación?', document: d }),
            el('p', {
                class: 'rsvp-muted',
                text: 'Escríbelo tal como aparece en tu invitación para confirmar tu asistencia.',
                document: d,
            }),
            el('div', {
                class: 'rsvp-field rsvp-code-input',
                children: [
                    el('label', { attrs: { for: 'rsvp-code' }, text: 'Código de invitación', document: d }),
                    input,
                    el('p', {
                        class: 'rsvp-hint', attrs: { id: 'rsvp-code-hint' },
                        text: '12 letras o números, por ejemplo ABCD-EFGH-IJKL.', document: d,
                    }),
                ],
                document: d,
            }),
            error,
            button('Continuar', 'primary', submit, d),
        ],
        document: d,
    });
}

/* ── the event ────────────────────────────────────────────────────────────── */

function eventCard(payload, o) {
    var d = o.document;
    var event = payload.event || {};
    var invitation = payload.invitation || {};
    var organizer = event.organizer || {};
    var resolve = typeof o.storageUrl === 'function' ? o.storageUrl : function () { return null; };

    var coverUrl = resolve('event-photos', event.cover_path);
    var avatarUrl = resolve('avatars', organizer.avatar_path);
    var organizerName = text(organizer.display_name, LIMITS.NAME);
    var when = formatWhen(event.starts_at, event.ends_at);
    var address = text(event.address, LIMITS.ADDRESS);
    var map = mapUrl(event);
    var calendar = calendarHref(event);
    var title = text(event.title, LIMITS.TITLE) || 'Evento';
    var label = text(invitation.label, LIMITS.LABEL);
    var greeting = text(invitation.greeting, LIMITS.GREETING);
    var description = text(event.description, LIMITS.DESCRIPTION);

    var gallery = [];
    var paths = Array.isArray(event.gallery_paths) ? event.gallery_paths.slice(0, 6) : [];
    for (var i = 0; i < paths.length; i += 1) {
        var url = resolve('event-photos', paths[i]);
        if (!url || url === coverUrl) continue;
        gallery.push(el('img', { attrs: { src: url, alt: '', loading: 'lazy', decoding: 'async' }, document: d }));
    }

    var links = [];
    if (map) links.push(externalLink(map, 'Cómo llegar', d, 'rsvp-btn rsvp-btn--ghost'));
    if (calendar) {
        links.push(el('a', {
            class: 'rsvp-btn rsvp-btn--ghost',
            attrs: { href: calendar, download: icsFileName(title) },
            text: 'Agregar al calendario',
            document: d,
        }));
    }

    return el('article', {
        class: 'rsvp-card rsvp-event',
        children: [
            coverUrl
                ? el('img', { class: 'rsvp-event__cover', attrs: { src: coverUrl, alt: '', decoding: 'async' }, document: d })
                : null,
            el('div', {
                class: 'rsvp-event__body',
                children: [
                    organizerName
                        ? el('p', {
                            class: 'rsvp-event__host',
                            children: [
                                avatarUrl
                                    ? el('img', { class: 'rsvp-event__avatar', attrs: { src: avatarUrl, alt: '' }, document: d })
                                    : null,
                                el('span', { text: 'Te invita ' + organizerName, document: d }),
                            ],
                            document: d,
                        })
                        : null,
                    el('h1', { class: 'rsvp-event__title', text: title, document: d }),
                    label ? el('p', { class: 'rsvp-event__label', text: label, document: d }) : null,
                    greeting ? el('p', { class: 'rsvp-event__greeting', text: greeting, document: d }) : null,
                    when
                        ? el('p', {
                            class: 'rsvp-event__when',
                            children: [el('time', { attrs: { datetime: String(event.starts_at || '') }, text: when, document: d })],
                            document: d,
                        })
                        : null,
                    address ? el('p', { class: 'rsvp-event__address', text: address, document: d }) : null,
                    links.length ? el('div', { class: 'rsvp-event__links', children: links, document: d }) : null,
                ].concat(
                    paragraphs(description, 'rsvp-event__desc', d),
                    gallery.length ? [el('div', { class: 'rsvp-gallery', children: gallery, document: d })] : [],
                ),
                document: d,
            }),
        ],
        document: d,
    });
}

function bannerNode(payload, d) {
    var banner = bannerFor(payload);
    if (!banner) return null;
    return el('p', {
        class: 'rsvp-banner rsvp-banner--' + banner.kind,
        attrs: { role: 'status' },
        text: banner.text,
        document: d,
    });
}

/* ── the answer ───────────────────────────────────────────────────────────── */

function promptCard(handlers, d) {
    return el('section', {
        class: 'rsvp-card rsvp-prompt',
        children: [
            el('h2', { text: 'Confirmar asistencia', document: d }),
            el('p', { class: 'rsvp-muted', text: 'Responde en un minuto. No necesitas una cuenta.', document: d }),
            button('Confirmar asistencia', 'primary', function () { handlers.onChoose('choose', null); }, d),
        ],
        document: d,
    });
}

function choiceCard(model, handlers, d) {
    var party = model.editing;
    var max = maxSeatsFor(model.payload.invitation, party);
    var canAttend = max >= 1;
    var attend = button('Sí, asistiré', 'primary', function () {
        if (canAttend) handlers.onChoose('attend', party);
    }, d);
    attend.disabled = !canAttend;
    return el('section', {
        class: 'rsvp-card rsvp-choice-card',
        children: [
            el('h2', { text: party ? 'Cambiar mi respuesta' : '¿Nos acompañas?', document: d }),
            canAttend ? null : el('p', { class: 'rsvp-hint', text: COPY.noSeats, document: d }),
            el('div', {
                class: 'rsvp-choice',
                children: [
                    attend,
                    button('No podré asistir', 'ghost', function () { handlers.onChoose('decline', party); }, d),
                ],
                document: d,
            }),
            button('Cancelar', 'quiet', handlers.onCancel, d),
        ],
        document: d,
    });
}

function nameField(party, d) {
    var input = el('input', {
        attrs: {
            id: 'rsvp-name', type: 'text', maxlength: String(LIMITS.NAME),
            autocomplete: 'name', autocapitalize: 'words', placeholder: 'Nombre y apellido',
        },
        document: d,
    });
    input.value = party ? text(party.party_name, LIMITS.NAME) : '';
    return {
        input: input,
        node: el('div', {
            class: 'rsvp-field',
            children: [el('label', { attrs: { for: 'rsvp-name' }, text: 'Tu nombre', document: d }), input],
            document: d,
        }),
    };
}

function validName(raw) {
    var name = text(raw, LIMITS.NAME + 1).replace(/\s+/g, ' ');
    if (!name) return { error: COPY.nameRequired };
    if (name.length > LIMITS.NAME) return { error: COPY.nameTooLong };
    return { name: name };
}

/** Wire Confirm/Cancel: disable while pending, show a returned message. */
function wireSubmit(confirm, cancel, error, handlers, answer) {
    confirm.disabled = true;
    cancel.disabled = true;
    setText(error, '');
    var release = function (message) {
        confirm.disabled = false;
        cancel.disabled = false;
        setText(error, message);
    };
    Promise.resolve()
        .then(function () { return handlers.onSubmit(answer); })
        .then(function (r) { if (r && r.ok === false) release(r.message || COPY.offline); })
        .catch(function () { release(COPY.offline); });
}

function attendForm(model, handlers, d) {
    var party = model.editing;
    var max = maxSeatsFor(model.payload.invitation, party);
    var seats = party && party.rsvp_status === 'attending' && Number.isInteger(party.seats) ? party.seats : 1;
    seats = Math.max(1, Math.min(seats, Math.max(max, 1)));

    var names = [];
    var given = party && Array.isArray(party.companions) ? party.companions : [];
    for (var g = 0; g < given.length; g += 1) {
        var pos = given[g] && Number.isInteger(given[g].position) ? given[g].position : null;
        if (pos !== null && pos >= 2) names[pos - 2] = text(given[g].name, LIMITS.NAME);
    }

    var name = nameField(party, d);
    var count = el('output', { attrs: { id: 'rsvp-seats', 'aria-live': 'polite' }, text: String(seats), document: d });
    var minus = el('button', { attrs: { type: 'button', 'aria-label': 'Menos pases' }, text: '−', document: d });
    var plus = el('button', { attrs: { type: 'button', 'aria-label': 'Más pases' }, text: '+', document: d });
    var companions = el('div', { class: 'rsvp-companions', document: d });
    var error = errorLine(d);

    function readNames() {
        var inputs = companions.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i += 1) names[i] = valueOf(inputs[i]);
    }
    function drawCompanions() {
        clear(companions);
        for (var i = 2; i <= seats; i += 1) {
            var id = 'rsvp-companion-' + i;
            var input = el('input', {
                attrs: { id: id, type: 'text', maxlength: String(LIMITS.NAME), autocomplete: 'off', autocapitalize: 'words', placeholder: 'Nombre (opcional)' },
                document: d,
            });
            input.value = names[i - 2] || '';
            companions.appendChild(el('div', {
                class: 'rsvp-field',
                children: [el('label', { attrs: { for: id }, text: 'Acompañante ' + i, document: d }), input],
                document: d,
            }));
        }
    }
    function sync() {
        setText(count, String(seats));
        minus.disabled = seats <= 1;
        plus.disabled = seats >= max;
    }
    minus.addEventListener('click', function () { readNames(); if (seats > 1) seats -= 1; drawCompanions(); sync(); });
    plus.addEventListener('click', function () { readNames(); if (seats < max) seats += 1; drawCompanions(); sync(); });
    drawCompanions();
    sync();

    var confirm = button('Confirmar', 'primary', null, d);
    var cancel = button('Cancelar', 'quiet', handlers.onCancel, d);
    confirm.addEventListener('click', function () {
        readNames();
        var checked = validName(valueOf(name.input));
        if (checked.error) { setText(error, checked.error); return; }
        var list = [];
        for (var i = 0; i < seats - 1; i += 1) {
            var companion = text(names[i] || '', LIMITS.NAME + 1).replace(/\s+/g, ' ');
            if (companion.length > LIMITS.NAME) { setText(error, COPY.companionTooLong); return; }
            list.push(companion);
        }
        wireSubmit(confirm, cancel, error, handlers, {
            partyId: party ? party.id : null,
            name: checked.name,
            status: 'attending',
            seats: seats,
            companions: list,
            note: null,
        });
    });

    return el('section', {
        class: 'rsvp-card rsvp-form',
        attrs: { 'data-view': 'attend' },
        children: [
            el('h2', { text: 'Sí, asistiré', document: d }),
            name.node,
            el('div', {
                class: 'rsvp-field',
                children: [
                    el('label', { attrs: { for: 'rsvp-seats' }, text: '¿Cuántas personas asistirán?', document: d }),
                    el('div', { class: 'rsvp-stepper', children: [minus, count, plus], document: d }),
                    el('p', { class: 'rsvp-hint', text: 'Tienes hasta ' + passesLabel(max) + '. Cuenta contigo.', document: d }),
                ],
                document: d,
            }),
            companions,
            error,
            el('div', { class: 'rsvp-actions', children: [confirm, cancel], document: d }),
        ],
        document: d,
    });
}

function declineForm(model, handlers, d) {
    var party = model.editing;
    var name = nameField(party, d);
    var note = el('textarea', {
        attrs: { id: 'rsvp-note', maxlength: String(LIMITS.NOTE), rows: '4', placeholder: 'Opcional' },
        document: d,
    });
    note.value = party ? text(party.decline_note, LIMITS.NOTE) : '';
    var counter = el('p', { class: 'rsvp-hint rsvp-counter', attrs: { 'aria-live': 'polite' }, document: d });
    var error = errorLine(d);
    function syncCounter() {
        var current = valueOf(note);
        if (current.length > LIMITS.NOTE) { note.value = current.slice(0, LIMITS.NOTE); current = note.value; }
        setText(counter, current.length + '/' + LIMITS.NOTE);
    }
    note.addEventListener('input', syncCounter);
    syncCounter();

    var send = button('Enviar respuesta', 'primary', null, d);
    var cancel = button('Cancelar', 'quiet', handlers.onCancel, d);
    send.addEventListener('click', function () {
        var checked = validName(valueOf(name.input));
        if (checked.error) { setText(error, checked.error); return; }
        var message = text(valueOf(note), LIMITS.NOTE + 1);
        if (message.length > LIMITS.NOTE) { setText(error, COPY.noteTooLong); return; }
        wireSubmit(send, cancel, error, handlers, {
            partyId: party ? party.id : null,
            name: checked.name,
            status: 'declined',
            seats: 0,
            companions: [],
            note: message || null,
        });
    });

    return el('section', {
        class: 'rsvp-card rsvp-form',
        attrs: { 'data-view': 'decline' },
        children: [
            el('h2', { text: 'No podré asistir', document: d }),
            name.node,
            el('div', {
                class: 'rsvp-field',
                children: [
                    el('label', { attrs: { for: 'rsvp-note' }, text: '¿Quieres dejarle un mensaje al organizador?', document: d }),
                    note,
                    counter,
                ],
                document: d,
            }),
            error,
            el('div', { class: 'rsvp-actions', children: [send, cancel], document: d }),
        ],
        document: d,
    });
}

/** "Tu respuesta actual" — one card per party under this code. */
function partyCard(party, accepting, handlers, d) {
    var attending = party.rsvp_status === 'attending';
    var seats = Number.isInteger(party.seats) ? party.seats : 0;
    var companions = Array.isArray(party.companions) ? party.companions : [];
    var items = [];
    for (var i = 0; i < companions.length; i += 1) {
        var companionName = text(companions[i] && companions[i].name, LIMITS.NAME);
        if (companionName) items.push(el('li', { text: companionName, document: d }));
    }
    var note = text(party.decline_note, LIMITS.NOTE);
    return el('article', {
        class: 'rsvp-card rsvp-party' + (attending ? '' : ' rsvp-party--declined'),
        children: [
            el('p', { class: 'rsvp-muted', text: 'Tu respuesta actual', document: d }),
            el('p', { class: 'rsvp-party__name', text: text(party.party_name, LIMITS.NAME), document: d }),
            el('p', {
                class: 'rsvp-party__status',
                text: attending ? 'Asistirás con ' + passesLabel(seats) + '.' : 'Indicaste que no asistirás.',
                document: d,
            }),
            attending && items.length ? el('ul', { children: items, document: d }) : null,
            !attending && note ? el('p', { class: 'rsvp-party__note', text: '“' + note + '”', document: d }) : null,
            accepting
                ? button('Cambiar mi respuesta', 'ghost', function () { handlers.onChoose('choose', party); }, d)
                : null,
        ],
        document: d,
    });
}

/* ── results ──────────────────────────────────────────────────────────────── */

/**
 * "Abrir Orbiventt" — the same two-module contract as the invitation's pass
 * card: the destination arrives PRE-RESOLVED (`app-return.js`), the device
 * plan alongside (`app-store-links.js`). Null when the handoff is closed —
 * the DEV mirror — and the copy path carries the guest instead.
 */
function openControl(handoff, smartOpen, d) {
    if (!handoff || handoff.open !== true || !handoff.href) return null;
    var href = smartOpen && typeof smartOpen.href === 'string' && smartOpen.href ? smartOpen.href : handoff.href;
    var anchor = el('a', { class: 'rsvp-btn rsvp-btn--primary', attrs: { href: href }, text: 'Abrir Orbiventt', document: d });
    if (smartOpen && typeof smartOpen.arm === 'function') smartOpen.arm(anchor);
    return anchor;
}

function copyFallback(code, o) {
    var d = o.document;
    var status = el('p', { class: 'rsvp-status', attrs: { role: 'status', 'aria-live': 'polite' }, document: d });
    var copy = button('Copiar código', 'ghost', function () {
        var nav = o.navigator;
        if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
            Promise.resolve()
                .then(function () { return nav.clipboard.writeText(displayCode(code)); })
                .then(function () { setText(status, 'Código copiado'); })
                .catch(function () { setText(status, 'Mantén presionado el código para copiarlo.'); });
            return;
        }
        setText(status, 'Mantén presionado el código para copiarlo.');
    }, d, { 'aria-label': 'Copiar código de invitación' });
    return [
        el('p', { class: 'rsvp-muted', text: 'Copia tu código e ingrésalo en la aplicación Orbiventt para abrir el evento.', document: d }),
        el('p', { class: 'rsvp-code', text: displayCode(code), document: d }),
        copy,
        status,
    ];
}

function promoCard(model, o) {
    var d = o.document;
    var items = [];
    for (var i = 0; i < APP_CAPABILITIES.length; i += 1) items.push(el('li', { text: APP_CAPABILITIES[i], document: d }));
    var open = openControl(o.handoff, o.smartOpen, d);
    return el('section', {
        class: 'rsvp-card rsvp-promo',
        children: [
            el('h3', { text: 'Vive el evento completo en Orbiventt', document: d }),
            el('ul', { children: items, document: d }),
        ].concat(open ? [open] : copyFallback(model.code, o)),
        document: d,
    });
}

function resultNodes(model, o) {
    var d = o.document;
    var r = model.result;
    var organizer = text(model.payload.event && model.payload.event.organizer && model.payload.event.organizer.display_name, LIMITS.NAME)
        || 'el organizador';
    if (r.status === 'attending') {
        return [
            el('section', {
                class: 'rsvp-card rsvp-result rsvp-result--ok',
                attrs: { role: 'status' },
                children: [
                    el('h2', { text: '¡Listo, ' + r.name + '!', document: d }),
                    el('p', { text: 'Confirmaste ' + passesLabel(r.seats) + '.', document: d }),
                ],
                document: d,
            }),
            promoCard(model, o),
        ];
    }
    return [
        el('section', {
            class: 'rsvp-card rsvp-result rsvp-result--declined',
            attrs: { role: 'status' },
            children: [
                el('h2', { text: 'Gracias por responder.', document: d }),
                el('p', { text: 'Tu respuesta fue enviada a ' + organizer + '.', document: d }),
                o.storeUrl
                    ? el('p', { class: 'rsvp-muted', children: [externalLink(o.storeUrl, 'Conoce Orbiventt', d)], document: d })
                    : null,
            ],
            document: d,
        }),
    ];
}

function answerSection(model, handlers, o) {
    var d = o.document;
    var payload = model.payload;
    var parties = Array.isArray(payload.parties) ? payload.parties : [];
    var accepting = acceptsResponses(payload);
    var view = accepting ? model.view : 'idle';
    var children = model.result ? resultNodes(model, o) : [];

    if (view === 'attend') {
        children.push(attendForm(model, handlers, d));
    } else if (view === 'decline') {
        children.push(declineForm(model, handlers, d));
    } else if (view === 'choose') {
        children.push(choiceCard(model, handlers, d));
    } else if (parties.length === 0) {
        if (accepting) children.push(promptCard(handlers, d));
    } else {
        for (var i = 0; i < parties.length; i += 1) {
            if (parties[i] && typeof parties[i] === 'object') children.push(partyCard(parties[i], accepting, handlers, d));
        }
        if (accepting) {
            children.push(el('div', {
                class: 'rsvp-actions',
                children: [button('Responder como otra persona', 'ghost', function () { handlers.onChoose('choose', null); }, d)],
                document: d,
            }));
        }
    }

    return el('section', { class: 'rsvp-answer', attrs: { 'data-view': view }, children: children, document: d });
}

/* ── entry point ──────────────────────────────────────────────────────────── */

/**
 * Draw the whole page for a model.
 *
 * @param {object} model   {phase, code, payload, view, editing, result, entryError, retryable}
 *   phase: 'loading' | 'unavailable' | 'enter-code' | 'ready'
 *   view:  'idle' | 'choose' | 'attend' | 'decline'
 * @param {object} handlers {onCode, onChoose, onCancel, onSubmit, onRetry}
 * @param {object} opts    {document, storageUrl, storeUrl, handoff, smartOpen, navigator}
 */
export function renderApp(model, handlers, opts) {
    var o = opts || {};
    var m = model || {};
    var h = handlers || {};
    var d = o.document;
    var children;

    if (m.phase === 'ready' && m.payload && m.payload.status === 'ok') {
        children = [eventCard(m.payload, o), bannerNode(m.payload, d), answerSection(m, h, o)];
    } else if (m.phase === 'enter-code') {
        children = [codeEntryNode(m, h, o)];
    } else if (m.phase === 'loading') {
        children = [loadingNode(d)];
    } else {
        children = [unavailableNode(m, h, o)];
    }

    return el('div', { class: 'rsvp-app', attrs: { 'data-state': m.phase || 'unavailable' }, children: children, document: d });
}
