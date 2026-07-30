/* THE SECTION RENDERER TABLE.
 *
 * A closed, statically-imported map from section id to renderer. A template
 * descriptor lists ids; this table decides what an id means. Two consequences
 * that matter:
 *
 *   • A template can never introduce a renderer, only reorder or omit existing
 *     ones — so every template produces the same semantics and inherits the
 *     same escaping, URL validation and image resolution.
 *   • An unknown id in a descriptor resolves to nothing and is skipped, rather
 *     than becoming a lookup on an inherited property or a dynamic import.
 *
 * `passes` and `actions` are SHELL sections: they take no configuration section
 * of their own and read the route and the action flags from the context.
 */
import renderHero from './hero.js';
import renderMessage from './message.js';
import renderCountdown from './countdown.js';
import { renderCeremony, renderReception } from './place.js';
import renderDressCode from './dressCode.js';
import renderGallery from './gallery.js';
import renderGifts from './gifts.js';
import renderPasses from './passes.js';
import renderActions from './actions.js';
import renderClosing from './closing.js';

const RENDERERS = Object.create(null);
RENDERERS.hero = { render: renderHero, shell: false };
RENDERERS.message = { render: renderMessage, shell: false };
RENDERERS.countdown = { render: renderCountdown, shell: false };
RENDERERS.ceremony = { render: renderCeremony, shell: false };
RENDERERS.reception = { render: renderReception, shell: false };
RENDERERS.dressCode = { render: renderDressCode, shell: false };
RENDERERS.gallery = { render: renderGallery, shell: false };
RENDERERS.gifts = { render: renderGifts, shell: false };
RENDERERS.passes = { render: renderPasses, shell: true };
RENDERERS.actions = { render: renderActions, shell: true };
RENDERERS.closing = { render: renderClosing, shell: false };

/** @returns {?{render: Function, shell: boolean}} */
export function resolveSection(id) {
    if (typeof id !== 'string' || id === '') return null;
    return Object.prototype.hasOwnProperty.call(RENDERERS, id) ? RENDERERS[id] : null;
}

/** Every id this table knows, for tests and for the editor. */
export function sectionIds() {
    return Object.keys(RENDERERS);
}
