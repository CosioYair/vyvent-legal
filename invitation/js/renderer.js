/* THE SHARED RENDER ENGINE.
 *
 * This is the function that will draw REAL saved invitations. Milestone A hands
 * it a bundled demonstration configuration; Milestone B will hand it one loaded
 * from the database. Nothing below knows or cares which — it receives a
 * NORMALIZED configuration and a template descriptor, and that is the entire
 * contract. That is the point of the milestone: the demo is not a mockup with a
 * production plan attached, it is the production renderer with demo input.
 *
 * The engine has no globals: the document, the clock, the timer functions, the
 * navigator and the page URL all arrive through the context. So the exact file
 * the site serves runs under `node --test` against a minimal DOM, and the
 * assertions are about the real renderer rather than a re-implementation.
 *
 * FAILURE POLICY
 *   • A REQUIRED section that did not survive normalization never reaches here
 *     — `normalizeConfig` already refused, and the caller shows a controlled
 *     state.
 *   • An OPTIONAL section that returns null is skipped silently.
 *   • An OPTIONAL section that THROWS is caught and skipped. One malformed
 *     value in a gallery item can never take down the ceremony details.
 */
import { el } from './dom.js';
import { resolveSection } from './sections/index.js';
import { matchesConfig } from './registry.js';

/**
 * @param {object} opts
 *   template  {object}   registry descriptor
 *   config    {object}   output of normalizeConfig().config
 *   route     {object}   output of parseRoute()
 *   document  {Document}
 *   assetBase {string}   absolute href of invitation/assets/
 *   now       {number}   epoch ms used for the first countdown paint
 *   clock     {Function} returns epoch ms for subsequent ticks
 *   setInterval / clearInterval {Function} omitted in tests → no ticker
 *   navigator {object}   share/clipboard provider
 *   pageUrl   {string}   the URL the share action offers
 *
 * @returns {{ok: boolean, node: ?Element, rendered: string[], skipped: string[],
 *            reason: ?string}}
 */
export function renderInvitation(opts) {
    const o = opts || {};
    const { template, config, document: d } = o;

    if (!template || !config) {
        return { ok: false, node: null, rendered: [], skipped: [], reason: 'missing-input' };
    }
    if (!matchesConfig(template, config)) {
        return { ok: false, node: null, rendered: [], skipped: [], reason: 'template-mismatch' };
    }

    const ctx = {
        config,
        template,
        route: o.route || { mode: 'none', code: null },
        document: d,
        assetBase: o.assetBase,
        locale: config.locale,
        timeZone: config.timeZone,
        now: Number.isFinite(o.now) ? o.now : 0,
        clock: typeof o.clock === 'function' ? o.clock : () => (Number.isFinite(o.now) ? o.now : 0),
        setInterval: o.setInterval,
        clearInterval: o.clearInterval,
        navigator: o.navigator || null,
        pageUrl: typeof o.pageUrl === 'string' ? o.pageUrl : '',
    };

    const rendered = [];
    const skipped = [];
    const nodes = [];

    for (const id of template.sections) {
        const entry = resolveSection(id);
        if (!entry) { skipped.push(id); continue; }

        const data = entry.shell ? null : config.sections[id];

        let node = null;
        try {
            node = entry.render(data, ctx);
        } catch (_) {
            node = null;
        }

        if (node) { nodes.push(node); rendered.push(id); } else { skipped.push(id); }
    }

    const article = el('article', {
        class: 'inv-invitation ' + template.themeClass,
        attrs: { 'data-section': 'invitation' },
        children: nodes,
        document: d,
    });

    return { ok: true, node: article, rendered, skipped, reason: null };
}
