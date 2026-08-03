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

    /* WHAT SHAPE A PHOTOGRAPH IS ON THIS PAGE.
     *
     * The template decides its own geometry, so the mobile cropper and this
     * renderer can agree on what the organizer is choosing. Before these
     * existed, the editor uploaded whatever the picker returned and the page
     * `object-fit: cover`-cropped it — so the couple saw a full photograph in
     * the editor and a differently-cropped one on the invitation, with no way
     * to say which part mattered.
     *
     * `width`/`height` are the CANONICAL export size and are exactly the
     * intrinsic dimensions the section renderers declare on their `<img>`, so
     * the reserved geometry, the exported file and the crop viewport are one
     * number rather than three that drift.
     *
     * `trim` marks bands the frame may lose on some viewports. The cropper
     * draws them as guides; nothing is cut here.
     *
     * The mobile editor mirrors this block in
     * `features/digitalInvitations/imagePlacements.ts`, and a test on each side
     * pins them to the same numbers. */
    imagePlacements: {
        hero: {
            /* 1080×1920 (9:16) — THE PHONE'S SHAPE.
             *
             * The hero is full-bleed at 88svh inside a page that is a CENTRED
             * COLUMN (`.inv-page { max-width: 46rem }`), so its width is capped
             * at 736–768px however wide the screen is. Measured:
             *
             *   iPhone   390×844  → 390×~743 ≈ 0.52
             *   iPad     768×1024 → 736×~901 ≈ 0.82
             *   Desktop 1440×900  → 768×~828 ≈ 0.93  (width capped)
             *
             * Portrait on every viewport, landscape on none. The previous 5:7
             * master sat in the middle of that band and so matched nothing: on
             * a phone `cover` discarded ~27% of the width the organizer framed.
             * 9:16 is the phone's shape to within 8%, so what the organizer
             * confirms is what a guest sees; wider screens trim the top and
             * bottom instead, which is what `trim` marks. */
            width: 1080,
            height: 1920,
            aspectRatio: 1080 / 1920,
            trim: [
                { x: 0, y: 0, w: 1, h: 0.2, label: 'trim-top' },
                { x: 0, y: 0.8, w: 1, h: 0.2, label: 'trim-bottom' },
            ],
        },
        gallery: {
            /* 4:5 exactly — `.inv-gallery__item` declares `aspect-ratio: 4/5`,
             * so there is nothing to trim and no guides to draw. */
            width: 800,
            height: 1000,
            aspectRatio: 4 / 5,
            trim: [],
        },
        interlude: {
            /* 16:9 for BOTH parities. The alternating composition varies the
             * inset and the corner radius, never the ratio — an alternation
             * that changed the shape would mean the same photograph was cropped
             * two different ways depending on which slot it landed in. */
            width: 1600,
            height: 900,
            aspectRatio: 16 / 9,
            trim: [],
        },
    },

    /* THE TEMPLATE'S OWN ARTWORK — a closed registry, keyed.
     *
     * An invitation stores `{source:'template', assetKey:'hero-default'}` and
     * the renderer resolves that key HERE, in the descriptor of the template
     * the invitation was authored with. Paths live in this file and nowhere
     * else, so no value an organizer can write becomes a file reference.
     *
     * Offered in the editor as "Imagen del diseño" and chosen explicitly. It is
     * never applied as a fallback: an invitation with no hero image renders the
     * template's designed no-image treatment, which is a different composition
     * and a deliberate one.
     *
     * The artwork carries no couple, no date, no place and no text, and is
     * authored for this repository — it is NOT the demonstration illustration
     * under assets/demo/, which may never become real invitation content.
     *
     * Paths are relative to invitation/templates/, like `stylesheet`. */
    assets: {
        'hero-default': 'wedding-romantic/hero-default.jpg',
    },

    /* The class applied to the invitation root. Every rule in template.css is
     * scoped under it, so two templates can never leak styles into each other. */
    themeClass: 'tpl-wedding-romantic',

    /* TEMPLATE UI COPY — the interface, not the event.
     *
     * Section headings, button labels and unit names belong HERE, not in the
     * invitation config, and the distinction is the whole point:
     *
     *   • Template UI copy is the same on every invitation this template ever
     *     draws. Changing it is a code change. It is allowed to have a value
     *     built in, because a built-in value is what it IS.
     *
     *   • Organizer content — the couple, the date, the venues, the copy they
     *     wrote — is theirs alone and may NEVER have a built-in default. A
     *     fallback there would put somebody else's wedding on their page.
     *
     * A guest cannot tell the two apart by looking, which is exactly why the
     * boundary has to be explicit in the code rather than remembered.
     *
     * Nothing here names a couple, a date, a venue or a link. See
     * invitation/FIELDS.md for the full matrix.
     */
    labels: {
        heroConjunction: '&',

        countdownHeading: 'Faltan',
        countdownCompleted: '¡Hoy es el día!',

        ceremonyHeading: 'Ceremonia',
        receptionHeading: 'Recepción',
        dressCodeHeading: 'Código de vestimenta',
        galleryHeading: 'Nuestra historia',
        giftsHeading: 'Mesa de regalos',
        passesHeading: 'Reclama tus pases',

        mapAction: 'Cómo llegar',
        calendarAction: 'Agregar al calendario',
        shareAction: 'Compartir invitación',
        locationAction: 'Abrir ubicación',
        externalHint: ' (se abre en una pestaña nueva)',
    },

    /* Render order. `passes` and `actions` are shell sections: they are driven
     * by the route and the action flags rather than by a configuration section,
     * and each decides for itself whether it has anything to draw.
     *
     * THE SIX `interlude*` ENTRIES ARE THE PHOTOGRAPH ANCHORS, and their
     * positions in THIS LIST are what "fixed slot" means. Each renders exactly
     * where it appears here regardless of what its neighbours do:
     *
     *   interludeAfterMessage    after the message
     *   interludeAfterCountdown  immediately BEFORE the ceremony — so it holds
     *                            that position even with no countdown
     *   interludeAfterCeremony   between ceremony and reception
     *   interludeAfterReception  between the reception and the dress code
     *   interludeAfterDressCode  before the gallery/gifts part of the page
     *   interludeBeforeClosing   immediately before the closing message
     *
     * A disabled section renders nothing and the anchor after it simply moves
     * up the page — it never changes which anchor a photograph belongs to. */
    sections: [
        'hero',
        'message',
        'interludeAfterMessage',
        'countdown',
        'interludeAfterCountdown',
        'ceremony',
        'interludeAfterCeremony',
        'reception',
        'interludeAfterReception',
        'dressCode',
        'interludeAfterDressCode',
        'gallery',
        'gifts',
        'passes',
        'actions',
        'interludeBeforeClosing',
        'closing',
    ],
};
