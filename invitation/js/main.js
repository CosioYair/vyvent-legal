/* BROWSER BOOTSTRAP for /invitation/.
 *
 * Route → mode → data source → template → render, with a controlled state for
 * every path that does not end in a drawn invitation. There is no branch that
 * leaves the visitor looking at a blank page, and no branch that renders half
 * an invitation.
 *
 * MILESTONE A DATA BOUNDARY
 * The only data source wired here is `demoConfig()`, a bundled literal. The
 * draft and published routes are RECOGNIZED and answered with an explicit
 * unavailable state — they are not simulated. There is no `fetch`, no
 * `XMLHttpRequest`, no Supabase client and no mock network layer anywhere in
 * this module tree, so demo mode cannot contact a backend even by accident.
 *
 * `env.js` is loaded by the page for one reason only: the DEV badge. Its
 * Supabase fields are never read here.
 */
import { parseRoute, MODE } from './route.js';
import { resolveTemplate } from './registry.js';
import { normalizeConfig } from './config.js';
import { renderInvitation } from './renderer.js';
import { moduleBases, templateResourceUrl } from './paths.js';
import { setText, clear } from './dom.js';

/* Both roots are derived from this module's own URL, so the same bytes work
 * under /vyvent-legal/invitation/ and under /invitation/. */
const BASES = moduleBases(import.meta.url);

/** Copy for every controlled state. Guest-facing: no internal vocabulary. */
const STATES = {
    unknownTemplate: {
        title: 'Invitación no disponible',
        body: 'Este enlace no corresponde a ninguna invitación. Revisa que esté completo o '
            + 'pídeselo de nuevo a los anfitriones.',
    },
    notAvailableYet: {
        title: 'Invitación no disponible',
        body: 'Este enlace todavía no puede abrirse. Si lo recibiste de los anfitriones, '
            + 'inténtalo de nuevo más tarde.',
    },
    failed: {
        title: 'No se pudo mostrar la invitación',
        body: 'Ocurrió un problema al preparar esta invitación. Vuelve a cargar la página.',
    },
};

function byId(id) {
    return document.getElementById(id);
}

function showState(state) {
    const host = byId('invitation-state');
    if (!host) return;
    setText(byId('invitation-state-title'), state.title);
    setText(byId('invitation-state-body'), state.body);
    host.removeAttribute('hidden');
    const loading = byId('invitation-loading');
    if (loading) loading.setAttribute('hidden', '');
}

function hideLoading() {
    const loading = byId('invitation-loading');
    if (loading) loading.setAttribute('hidden', '');
}

/**
 * Attach the template stylesheet and resolve once it has settled.
 *
 * Rendering waits for this so the first paint of the invitation is already
 * styled — no flash of unstyled content and no layout shift as the CSS lands.
 * A stylesheet that fails resolves anyway: an unstyled invitation is a far
 * better outcome than a blank page, and the base stylesheet still applies.
 */
function loadTemplateStylesheet(href) {
    return new Promise((resolve) => {
        if (!href) { resolve(false); return; }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        let settled = false;
        const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
        link.addEventListener('load', () => done(true), { once: true });
        link.addEventListener('error', () => done(false), { once: true });
        // A stylesheet from the same origin that has not answered in two
        // seconds is not going to; do not hold the page hostage to it.
        setTimeout(() => done(false), 2000);
        document.head.appendChild(link);
    });
}

function revealDevBadge() {
    const env = (typeof window !== 'undefined' && window.__ORB_ENV__) || {};
    if (!env.devBadge) return;
    const badge = byId('envBadge');
    if (badge) badge.removeAttribute('hidden');
}

/* DEMO DATA IS NOT IMPORTED AT THE TOP OF THIS FILE, AND THAT IS THE POINT.
 *
 * A real invitation must never be able to inherit a demonstration value — not
 * a couple's name, not a date, not a venue, not an image. A static import would
 * put the whole fictional wedding into the module graph of EVERY route, one
 * mistaken line away from a real draft.
 *
 * Loading it through a dynamic import with a LITERAL specifier, inside the demo
 * branch, makes the guarantee physical rather than disciplinary: on the draft
 * and published routes the browser never fetches `demo-data.js` at all. You can
 * watch that in the network panel, and a test asserts it.
 *
 * The specifier is a constant. There is still no import path anywhere in this
 * module tree that is derived from input. */
async function loadDemoConfig(demoId) {
    const module = await import('./demo-data.js');
    return module.demoConfig(demoId);
}

async function renderDemo(route) {
    const template = resolveTemplate(route.demoId);
    if (!template) { showState(STATES.unknownTemplate); return; }

    const raw = await loadDemoConfig(route.demoId);
    if (!raw) { showState(STATES.unknownTemplate); return; }

    const { ok, config } = normalizeConfig(raw);
    if (!ok) { showState(STATES.failed); return; }

    await loadTemplateStylesheet(templateResourceUrl(BASES.templates, template.stylesheet));

    // The theme class lives on <html> as well as on the invitation element:
    // the article scopes the template's own rules, and the root lets the
    // template dress the page frame (background, selection colour) that sits
    // outside it. Applied before the first paint of the invitation, so the
    // page never flashes the neutral shell palette.
    document.documentElement.classList.add(template.themeClass);

    const result = renderInvitation({
        template,
        config,
        route,
        document,
        assetBase: BASES.assets,
        now: Date.now(),
        clock: () => Date.now(),
        setInterval: window.setInterval.bind(window),
        clearInterval: window.clearInterval.bind(window),
        navigator: typeof navigator !== 'undefined' ? navigator : null,
        pageUrl: window.location.href,
    });

    if (!result.ok || !result.node) { showState(STATES.failed); return; }

    const root = byId('invitation-root');
    clear(root);
    root.appendChild(result.node);
    root.removeAttribute('hidden');
    hideLoading();
    document.body.setAttribute('data-mode', 'demo');
}

async function start() {
    revealDevBadge();

    const route = parseRoute(window.location.search);

    if (route.mode === MODE.DEMO) {
        await renderDemo(route);
        return;
    }

    // RESERVED ROUTES. Recognized so the contract is fixed, answered with a
    // controlled state so nothing pretends to load. Milestone B replaces these
    // two branches with real lookups — and only then does this page gain a
    // network dependency.
    if (route.mode === MODE.DRAFT || route.mode === MODE.PUBLISHED) {
        showState(STATES.notAvailableYet);
        return;
    }

    showState(STATES.unknownTemplate);
}

start().catch(() => showState(STATES.failed));
