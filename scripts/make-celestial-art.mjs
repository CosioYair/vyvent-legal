/* AUTHORING SCRIPT — Noche estelar artwork.
 *
 * Writes every SVG this template ships: its own `hero-default`, and the
 * deterministic demonstration media its demo route draws. Run once; the output
 * is committed. Nothing at runtime executes this.
 *
 *   node scripts/make-celestial-art.mjs
 *
 * EVERY FILE IS SELF-CONTAINED: flat shapes and strokes, no <script>, no
 * <image>, no external href, no embedded raster, no <foreignObject>, no font
 * reference, no animation. Star points are static circles — there is no
 * particle system, no canvas and no motion anywhere in this collection.
 *
 * EVERY FILE IS FULLY OPAQUE EDGE TO EDGE. The first shape in each drawing is
 * a midnight rectangle covering the whole viewBox, so a transparent corner can
 * never reveal the white page underneath on iOS Safari.
 *
 * NOTHING HERE IS ORBIVENTT BRANDING. The stars are drawn from scratch in this
 * file; no logo, orbit mark, brand gradient or app-icon geometry is referenced,
 * imported or approximated. The vocabulary is generic wedding stationery:
 * arches, crescents, constellation lines and candle silhouettes.
 *
 * Deliberately NOT the other four vocabularies: no engraved rings (Classic
 * Gold), no leaves (Botánica), no registration marks or paper blocks
 * (Editorial), no soft flourishes (Romántica).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'invitation', 'assets', 'demo', 'wedding-celestial');
const TPL = join(ROOT, 'invitation', 'templates', 'wedding-celestial');

const MIDNIGHT = '#0D1323';
const NAVY = '#151D31';
const SURFACE = '#1C263C';
const IVORY = '#F5F0E6';
const GOLD = '#C09A54';
const GOLD_INK = '#D5B875';

const svg = (w, h, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">\n${body}\n</svg>\n`;

/** A DETERMINISTIC scatter of star points — a seeded LCG, never Math.random,
 *  so re-running this script reproduces the committed files byte for byte. */
function stars(w, h, count, seed, maxR = 3.2) {
    let s = seed;
    const next = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const x = +(next() * w).toFixed(1);
        const y = +(next() * h).toFixed(1);
        const r = +(0.9 + next() * maxR).toFixed(2);
        const o = +(0.25 + next() * 0.5).toFixed(2);
        out.push(`  <circle cx="${x}" cy="${y}" r="${r}" fill="${IVORY}" opacity="${o}"/>`);
    }
    return out.join('\n');
}

/** A four-point star: the collection's signature mark. */
const spark = (cx, cy, r, colour = GOLD_INK, sw = 0) =>
    `  <path d="M ${cx} ${cy - r} Q ${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} `
    + `Q ${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} `
    + `Q ${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} `
    + `Q ${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z" fill="${colour}"${sw ? ` stroke="${colour}" stroke-width="${sw}"` : ''}/>`;

/** A crescent, drawn as two overlapping circles (the second in the ground). */
const crescent = (cx, cy, r, ground = MIDNIGHT) =>
    `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${GOLD}" opacity="0.9"/>\n`
    + `  <circle cx="${cx + r * 0.34}" cy="${cy - r * 0.2}" r="${r * 0.92}" fill="${ground}"/>`;

/** A constellation: points joined by hairlines. */
function constellation(pts, colour = GOLD_INK) {
    const lines = pts.slice(1).map((p, i) =>
        `  <path d="M ${pts[i][0]} ${pts[i][1]} L ${p[0]} ${p[1]}" stroke="${colour}" stroke-width="1.4" opacity="0.55"/>`);
    const dots = pts.map(([x, y], i) =>
        `  <circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 5 : 3.2}" fill="${colour}" opacity="0.95"/>`);
    return lines.concat(dots).join('\n');
}

/** A tall arch, open at the bottom — the evening gate. */
const arch = (cx, top, w, bottom, sw = 3.5, colour = GOLD) =>
    `  <path d="M ${cx - w / 2} ${bottom} V ${top + w / 2} a ${w / 2} ${w / 2} 0 0 1 ${w} 0 V ${bottom}" fill="none" stroke="${colour}" stroke-width="${sw}" opacity="0.85"/>`;

/* ── the template's own hero artwork ────────────────────────────────────── */
mkdirSync(TPL, { recursive: true });
writeFileSync(join(TPL, 'hero-default.svg'), svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${MIDNIGHT}"/>`,
    `  <rect y="980" width="1080" height="940" fill="${NAVY}"/>`,
    stars(1080, 1920, 90, 7717),
    arch(540, 300, 520, 1500, 4),
    crescent(540, 640, 118),
    spark(300, 1120, 22),
    spark(790, 1050, 16),
    spark(540, 1290, 12),
    `  <path d="M 340 1420 H 740" stroke="${GOLD}" stroke-width="1.6" opacity="0.7"/>`,
].join('\n')));

/* ── demo hero ──────────────────────────────────────────────────────────── */
mkdirSync(DEMO, { recursive: true });
writeFileSync(join(DEMO, 'hero.svg'), svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${MIDNIGHT}"/>`,
    stars(1080, 1920, 120, 4231),
    // A moonlit skyline, silhouetted — architecture, not a galaxy.
    `  <path d="M0 1500 L0 1240 L120 1240 L120 1140 L250 1140 L250 1320 L390 1320 L390 1090 L470 1090 L470 1320 L620 1320 L620 1200 L760 1200 L760 1300 L900 1300 L900 1160 L1080 1160 L1080 1500 Z" fill="${SURFACE}"/>`,
    `  <rect y="1500" width="1080" height="420" fill="${NAVY}"/>`,
    crescent(830, 430, 96),
    constellation([[180, 620], [300, 540], [420, 620], [360, 760], [220, 780]]),
    spark(560, 380, 20),
    arch(540, 1560, 300, 1900, 3),
].join('\n')));

/* ── six gallery tiles, 4:5 ─────────────────────────────────────────────── */
/* Each drawing receives the GROUND it is painted on. A crescent is two
 * overlapping circles, the second filled with the ground — pass the wrong one
 * and the cut-out shows as a visible disc instead of disappearing. */
const tiles = [
    (w, h, ground) => crescent(w / 2, h * 0.42, 120, ground) + '\n' + spark(w * 0.7, h * 0.66, 18),
    (w, h) => constellation([[w * 0.2, h * 0.3], [w * 0.42, h * 0.42], [w * 0.66, h * 0.3],
        [w * 0.74, h * 0.58], [w * 0.5, h * 0.7], [w * 0.26, h * 0.62]].map(([x, y]) => [+x.toFixed(0), +y.toFixed(0)])),
    (w, h) => arch(w / 2, h * 0.2, w * 0.56, h * 0.82, 5),
    (w, h) => [0.28, 0.5, 0.72].map((p, i) =>
        `  <rect x="${(w * p - 9).toFixed(0)}" y="${(h * 0.42 + i % 2 * 30).toFixed(0)}" width="18" height="${(h * 0.3).toFixed(0)}" fill="${SURFACE}"/>\n`
        + spark(w * p, h * 0.42 + (i % 2) * 30 - 26, 13)).join('\n'),
    (w, h) => `  <circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.3}" fill="none" stroke="${GOLD}" stroke-width="2.5" opacity="0.75"/>\n`
        + spark(w / 2, h / 2 - w * 0.3, 15) + '\n' + spark(w / 2, h / 2 + w * 0.3, 11),
    (w, h, ground) => `  <path d="M0 ${(h * 0.72).toFixed(0)} L${(w * 0.22).toFixed(0)} ${(h * 0.5).toFixed(0)} L${(w * 0.46).toFixed(0)} ${(h * 0.66).toFixed(0)} L${(w * 0.72).toFixed(0)} ${(h * 0.44).toFixed(0)} L${w} ${(h * 0.64).toFixed(0)} L${w} ${h} L0 ${h} Z" fill="${SURFACE}"/>\n`
        + crescent(w * 0.72, h * 0.26, 62, ground),
];
tiles.forEach((draw, i) => {
    const ground = i % 2 ? NAVY : MIDNIGHT;
    writeFileSync(join(DEMO, `story-0${i + 1}.svg`), svg(800, 1000, [
        `  <rect width="800" height="1000" fill="${ground}"/>`,
        stars(800, 1000, 42, 900 + i * 37),
        draw(800, 1000, ground),
    ].join('\n')));
});

/* ── six interlude bands, 16:9 ──────────────────────────────────────────── */
const bands = [
    (w, h) => constellation([[w * 0.14, h * 0.6], [w * 0.3, h * 0.36], [w * 0.48, h * 0.54],
        [w * 0.66, h * 0.32], [w * 0.86, h * 0.5]].map(([x, y]) => [+x.toFixed(0), +y.toFixed(0)])),
    (w, h, ground) => crescent(w / 2, h * 0.46, 130, ground),
    (w, h) => arch(w / 2, h * 0.16, w * 0.26, h * 0.86, 4) + '\n' + spark(w * 0.22, h * 0.4, 20) + '\n' + spark(w * 0.78, h * 0.35, 16),
    (w, h) => `  <path d="M0 ${(h * 0.78).toFixed(0)} L${(w * 0.18).toFixed(0)} ${(h * 0.5).toFixed(0)} L${(w * 0.38).toFixed(0)} ${(h * 0.68).toFixed(0)} L${(w * 0.6).toFixed(0)} ${(h * 0.42).toFixed(0)} L${(w * 0.82).toFixed(0)} ${(h * 0.62).toFixed(0)} L${w} ${(h * 0.5).toFixed(0)} L${w} ${h} L0 ${h} Z" fill="${SURFACE}"/>`,
    (w, h) => [0.2, 0.35, 0.5, 0.65, 0.8].map((p, i) =>
        `  <rect x="${(w * p - 7).toFixed(0)}" y="${(h * 0.46 + (i % 2) * 40).toFixed(0)}" width="14" height="${(h * 0.34).toFixed(0)}" fill="${SURFACE}"/>\n`
        + spark(w * p, h * 0.46 + (i % 2) * 40 - 24, 12)).join('\n'),
    (w, h) => `  <path d="M ${(w * 0.16).toFixed(0)} ${(h / 2).toFixed(0)} H ${(w * 0.84).toFixed(0)}" stroke="${GOLD}" stroke-width="1.6" opacity="0.6"/>\n`
        + spark(w / 2, h / 2, 26),
];
bands.forEach((draw, i) => {
    const ground = i % 2 ? NAVY : MIDNIGHT;
    writeFileSync(join(DEMO, `band-0${i + 1}.svg`), svg(1600, 900, [
        `  <rect width="1600" height="900" fill="${ground}"/>`,
        stars(1600, 900, 55, 5100 + i * 61),
        draw(1600, 900, ground),
    ].join('\n')));
});

// eslint-disable-next-line no-console
console.log('celestial artwork written:', DEMO, '+', join(TPL, 'hero-default.svg'));
