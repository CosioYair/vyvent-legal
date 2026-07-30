/* TEMPLATE DESCRIPTOR — wedding_romantic, version 1.
 *
 * A descriptor is DATA, not code: it names the template, declares which
 * stylesheet dresses it and fixes the order its sections appear in. The
 * rendering itself is shared — every template draws through the same section
 * renderers in invitation/js/sections/, so a second template is a stylesheet
 * plus a different order, not a second renderer to keep in sync.
 *
 * VERSIONING: `templateVersion` is part of the registry identity and is stored
 * on every invitation authored with it. A visual change that would alter an
 * already-published invitation ships as version 2 with its own descriptor and
 * stylesheet; version 1 stays exactly as it is so a guest's link never changes
 * under them.
 *
 * `stylesheet` is a path RELATIVE to invitation/templates/ — resolved at
 * runtime against the module's own URL, so it is identical under the DEV
 * project path and the production root.
 */
export default {
    id: 'wedding_romantic_v1',
    categoryKey: 'wedding',
    templateKey: 'wedding_romantic',
    templateVersion: 1,

    label: 'Romántica',
    description: 'Marfil, rosa empolvado y tipografía serif. Para bodas clásicas y cálidas.',

    stylesheet: 'wedding-romantic/template.css',

    /* The class applied to the invitation root. Every rule in template.css is
     * scoped under it, so two templates can never leak styles into each other. */
    themeClass: 'tpl-wedding-romantic',

    /* Render order. `passes` and `actions` are shell sections: they are driven
     * by the route and the action flags rather than by a configuration section,
     * and each decides for itself whether it has anything to draw. */
    sections: [
        'hero',
        'message',
        'countdown',
        'ceremony',
        'reception',
        'dressCode',
        'gallery',
        'gifts',
        'passes',
        'actions',
        'closing',
    ],
};
