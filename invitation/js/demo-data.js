/* BUNDLED DEMONSTRATION DATA.
 *
 * This is the ONLY data source Milestone A has, and it is a plain JavaScript
 * literal shipped with the site. Opening `?demo=wedding_romantic_v1` performs
 * no database query, needs no invitation record, no authentication, no preview
 * token and no mobile editor. There is no `fetch` in this module tree at all,
 * so "demo mode makes zero Supabase requests" is a property of the code rather
 * than a promise about it.
 *
 * WHY IT MATTERS THAT THIS IS SHAPED LIKE REAL DATA
 * The object below is a RAW configuration — exactly what Milestone B's editor
 * will write into the invitation's JSONB column. It goes through the same
 * `normalizeConfig()` as a stored one, so anything wrong with the contract
 * shows up here first, while it is still free to change.
 *
 * The content is fictional. It is deliberately ONE couple's invitation with one
 * date, one city and one voice, because a component catalogue cannot answer the
 * question this milestone exists to ask: does this look like something you would
 * send to your guests?
 */

/** Demo configurations, keyed by registry identifier. Null-prototype: a lookup
 *  can never reach an inherited member. */
const DEMOS = Object.create(null);

DEMOS.wedding_romantic_v1 = {
    contractVersion: 1,
    categoryKey: 'wedding',
    templateKey: 'wedding_romantic',
    templateVersion: 1,
    locale: 'es-MX',
    timeZone: 'America/Mexico_City',

    sections: {
        hero: {
            eyebrow: 'Nos casamos',
            partnerA: 'Valentina',
            partnerB: 'Mateo',
            date: '2027-04-17T17:00:00-06:00',
            location: 'San Miguel de Allende, Guanajuato',
            image: { source: 'demo', path: 'wedding-romantic/hero.svg' },
            imageAlt: 'Ilustración de un arco de flores y follaje en tonos marfil y rosa empolvado',
        },

        message: {
            heading: 'Nuestra invitación',
            body: 'Hay días que se recuerdan toda la vida, y este queremos vivirlo contigo.\n\n'
                + 'Después de once años de caminar juntos, decidimos unir nuestras vidas para siempre. '
                + 'Nos haría muy felices que nos acompañes en la celebración de nuestro matrimonio.',
            hosts: 'Con la bendición de nuestros padres: Elena Serrano y Roberto Ruiz · '
                + 'Carmen Lozano y Andrés Herrera',
        },

        countdown: {
            enabled: true,
            // The couple's own wording; absent, the template supplies its own.
            completedLabel: '¡Hoy nos casamos!',
        },

        ceremony: {
            startsAt: '2027-04-17T17:00:00-06:00',
            venueName: 'Parroquia de la Santa Cruz',
            address: 'Calle del Rosal 128, Centro, San Miguel de Allende, Gto.',
            note: 'Te pedimos llegar 20 minutos antes.',
        },

        reception: {
            enabled: true,
            startsAt: '2027-04-17T19:30:00-06:00',
            venueName: 'Hacienda Los Arcos',
            address: 'Camino a La Cañada km 4, San Miguel de Allende, Gto.',
            note: 'Cena, brindis y baile. La fiesta termina a las 3:00 h.',
        },

        dressCode: {
            enabled: true,
            title: 'Formal · Etiqueta jardín',
            description: 'Vestido largo y traje oscuro. La celebración es al aire libre, '
                + 'sobre pasto y empedrado.',
            guidelines: [
                'Evita el tacón de aguja: el camino es de piedra.',
                'La noche refresca; te sugerimos un chal o un saco ligero.',
                'Reservamos el blanco para la novia.',
            ],
        },

        gallery: {
            enabled: true,
            items: [
                {
                    image: { source: 'demo', path: 'wedding-romantic/story-01.svg' },
                    alt: 'Ilustración de dos copas brindando bajo una guirnalda de luces',
                },
                {
                    image: { source: 'demo', path: 'wedding-romantic/story-02.svg' },
                    alt: 'Ilustración de un ramo de peonías y eucalipto',
                },
                {
                    image: { source: 'demo', path: 'wedding-romantic/story-03.svg' },
                    alt: 'Ilustración de una cúpula y campanario al atardecer',
                },
                {
                    image: { source: 'demo', path: 'wedding-romantic/story-04.svg' },
                    alt: 'Ilustración de dos argollas entrelazadas sobre un fondo de lino',
                },
                {
                    image: { source: 'demo', path: 'wedding-romantic/story-05.svg' },
                    alt: 'Ilustración de una mesa larga con velas y follaje',
                },
                {
                    image: { source: 'demo', path: 'wedding-romantic/story-06.svg' },
                    alt: 'Ilustración de un cielo nocturno con papel picado',
                },
            ],
        },

        gifts: {
            enabled: true,
            intro: 'Tu presencia es nuestro regalo más importante. Si además quieres consentirnos, '
                + 'aquí te dejamos algunas ideas. También habrá lluvia de sobres el día de la boda.',
            links: [
                { label: 'Mesa de regalos · Liverpool', url: 'https://mesaderegalos.liverpool.com.mx/' },
                { label: 'Mesa de regalos · Amazon', url: 'https://www.amazon.com.mx/wedding/' },
            ],
        },

        closing: {
            enabled: true,
            heading: 'Nos vemos pronto',
            body: 'Gracias por ser parte de nuestra historia. Nos hace mucha ilusión celebrar contigo '
                + 'el día en que empieza nuestra vida juntos.',
            signature: 'Valentina & Mateo',
        },
    },

    actions: { calendar: true, share: true, map: true },
};

/**
 * Look up a demonstration configuration.
 * @returns {?object} a DEEP COPY, so a renderer can never mutate the bundled
 *   literal and leak state between renders.
 */
export function demoConfig(id) {
    if (typeof id !== 'string' || id === '') return null;
    if (!Object.prototype.hasOwnProperty.call(DEMOS, id)) return null;
    return JSON.parse(JSON.stringify(DEMOS[id]));
}

/** Every demonstration identifier this build ships. */
export function listDemoIds() {
    return Object.keys(DEMOS);
}
