/* THE CUSTOM DESIGN — the uploaded invitation image, rendered WHOLE.
 *
 * The organizer designed the entire invitation outside Orbiventt and uploaded
 * it as one finished image; that image is authoritative for every visual
 * detail, including information sitting right at its edges. So the one rule
 * this renderer exists to uphold:
 *
 *   THE FULL IMAGE IS ALWAYS VISIBLE. No crop, no `object-fit: cover`, no
 *   fixed-height container, no stretch. The <img> flows at the column's width
 *   and its height follows the image's own aspect ratio — portrait, square,
 *   story-tall or poster-wide all render complete.
 *
 * The stored `width`/`height` (the real pixel size of the stored object,
 * written by the mobile editor at upload time) become the img element's
 * intrinsic-size attributes, so the browser reserves the correct box before a
 * single byte arrives and the pass card above never shifts. When a document
 * predates them the image still renders complete — the box is simply sized on
 * load.
 *
 * Only a STORAGE reference ever reaches this section (the custom branch of
 * normalizeConfig refuses everything else), and it resolves through the same
 * `resolveImage` gate as every other image on the page — bucket allowlist,
 * path validation, project-origin pinning. Alt text is accessibility, never
 * visibility, exactly as everywhere else.
 */
import { el } from '../dom.js';
import { resolveImage } from '../security.js';
import { section } from './shell.js';

export default function renderDesign(data, ctx) {
    if (!data || !data.image) return null;

    const src = resolveImage(data.image, { storageUrl: ctx.storageUrl });
    if (!src) return null;

    const attrs = {
        src,
        alt: data.alt || '',
        decoding: 'async',
        // The design is the page's content — never lazy, and only hidden from
        // assistive tech when it carries no description.
        'aria-hidden': data.alt ? null : 'true',
    };
    if (Number.isInteger(data.width) && Number.isInteger(data.height)
        && data.width > 0 && data.height > 0) {
        attrs.width = data.width;
        attrs.height = data.height;
    }

    const img = el('img', { class: 'inv-design__img', attrs, document: ctx.document });

    // No heading: the uploaded design carries its own. The shell still gives
    // the section its landmark and `data-section` identity.
    return section('design', '', ctx, [img], { class: 'inv-design' });
}
