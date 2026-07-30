/* RECLAMAR PASES — shell section, shown ONLY when the link carries a code.
 *
 * A pass-claim prompt on an invitation that carries no code would be a lie, so
 * the default is to render nothing at all. The section appears only when
 * `?code=` survived validation (`security.safeCode`).
 *
 * MILESTONE A renders an EXPLAINER, never a claim. It is badged as part of the
 * demonstration, it names no pass count, and it offers no control that looks
 * like it would redeem anything. Claiming is an app flow reached from a
 * published invitation — duplicating or simulating it here would teach the
 * couple a behavior the product does not have yet.
 */
import { el } from '../dom.js';
import { MODE } from '../route.js';
import { section } from './shell.js';

export default function renderPasses(_data, ctx) {
    const code = ctx.route && ctx.route.code;
    if (!code) return null;

    // Only the demonstration mode has anything to say here. The draft and
    // published modes will carry the real handoff in Milestone B.
    if (!ctx.route || ctx.route.mode !== MODE.DEMO) return null;

    const d = ctx.document;

    return section('passes', 'Reclamar pases', ctx, [
        el('p', {
            class: 'inv-passes__body',
            text: 'Este enlace incluye un código de invitación. En una invitación publicada, '
                + 'aquí aparecería el botón para reclamar tus pases dentro de Orbiventt.',
            document: d,
        }),
        el('p', {
            class: 'inv-passes__code',
            children: [
                el('span', { class: 'inv-sr-only', text: 'Código de invitación: ', document: d }),
                el('span', { class: 'inv-passes__code-value', text: code, document: d }),
            ],
            document: d,
        }),
        el('p', {
            class: 'inv-passes__note',
            text: 'Demostración: aquí no se reclama ningún pase.',
            document: d,
        }),
    ], { class: 'inv-passes is-demo' });
}
