/* DRESS CODE — OPTIONAL.
 *
 * A short label plus optional guidance. Deliberately text-only: no swatch
 * images, no icon set, no external asset of any kind, so the section costs
 * nothing to load and cannot half-render.
 */
import { el, paragraphs } from '../dom.js';
import { section } from './shell.js';

export default function renderDressCode(data, ctx) {
    if (!data) return null;
    const d = ctx.document;

    return section('dressCode', data.heading, ctx, [
        el('p', { class: 'inv-dress__label', text: data.label, document: d }),
        ...paragraphs(data.description, { class: 'inv-dress__description', document: d }),
        data.notes.length
            ? el('ul', {
                class: 'inv-dress__notes',
                children: data.notes.map((note) => el('li', { text: note, document: d })),
                document: d,
            })
            : null,
    ], { class: 'inv-dress' });
}
