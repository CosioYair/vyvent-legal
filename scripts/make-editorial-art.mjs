/* AUTHORING SCRIPT — Editorial moderna artwork.
 *
 * Writes every SVG this template ships: its own `hero-default`, and the
 * deterministic demonstration media its demo route draws. Run once; the output
 * is committed. Nothing at runtime executes this.
 *
 *   node scripts/make-editorial-art.mjs
 *
 * EVERY FILE IS SELF-CONTAINED: flat shapes and strokes, no <script>, no
 * <image>, no external href, no embedded raster, no <foreignObject>, no font
 * reference. Deliberately TYPE-FREE — this collection's character comes from
 * the typography in the stylesheet, so the artwork stays abstract: paper
 * blocks, registration marks, brackets, thin rules and restrained geometry.
 *
 * Deliberately NOT the other three vocabularies: no rings or lozenges (Classic
 * Gold), no leaves or sprigs (Botánica), no soft flourishes (Romántica). Where
 * those are ornamental, this one is STRUCTURAL — blocks, crops and marks that
 * look like a printer's layout sheet.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'invitation', 'assets', 'demo', 'wedding-editorial');
const TPL = join(ROOT, 'invitation', 'templates', 'wedding-editorial');

const PAPER = '#F5F2EC';
const WHITE = '#FCFBF8';
const NEAR_BLACK = '#171717';
const CHARCOAL = '#4A4844';
const ACCENT = '#9A604B';
const RULE = '#D7D0C5';

const svg = (w, h, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">\n${body}\n</svg>\n`;

/** A printer's registration mark: a cross inside an open circle. */
const regMark = (cx, cy, r, colour = NEAR_BLACK, sw = 2) =>
    `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colour}" stroke-width="${sw}"/>\n`
    + `  <path d="M ${cx - r * 1.6} ${cy} H ${cx + r * 1.6} M ${cx} ${cy - r * 1.6} V ${cy + r * 1.6}" stroke="${colour}" stroke-width="${sw}"/>`;

/** Corner crop brackets, the way a layout sheet marks its trim. */
const brackets = (w, h, inset, len, colour = NEAR_BLACK, sw = 2.5) => [
    `  <path d="M ${inset} ${inset + len} V ${inset} H ${inset + len}" fill="none" stroke="${colour}" stroke-width="${sw}"/>`,
    `  <path d="M ${w - inset - len} ${inset} H ${w - inset} V ${inset + len}" fill="none" stroke="${colour}" stroke-width="${sw}"/>`,
    `  <path d="M ${inset} ${h - inset - len} V ${h - inset} H ${inset + len}" fill="none" stroke="${colour}" stroke-width="${sw}"/>`,
    `  <path d="M ${w - inset - len} ${h - inset} H ${w - inset} V ${h - inset - len}" fill="none" stroke="${colour}" stroke-width="${sw}"/>`,
].join('\n');

/** A stack of thin rules — the collection's recurring texture. */
const ruleStack = (x, y, w, count, gap, colour = RULE, sw = 2) =>
    Array.from({ length: count }, (_, i) =>
        `  <rect x="${x}" y="${y + i * gap}" width="${w}" height="${sw}" fill="${colour}"/>`).join('\n');

/** An offset pair of paper blocks — asymmetric by construction. */
const blocks = (x, y, w, h, offset) =>
    `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${NEAR_BLACK}" opacity="0.92"/>\n`
    + `  <rect x="${x + offset}" y="${y + offset}" width="${w}" height="${h}" fill="none" stroke="${ACCENT}" stroke-width="3"/>`;

/* ── the template's own hero artwork ────────────────────────────────────── */
mkdirSync(TPL, { recursive: true });
writeFileSync(join(TPL, 'hero-default.svg'), svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${PAPER}"/>`,
    // A wide paper band across the upper third, offset left — the cover crop.
    `  <rect x="0" y="300" width="760" height="620" fill="${WHITE}"/>`,
    `  <rect x="0" y="300" width="760" height="620" fill="none" stroke="${RULE}" stroke-width="2"/>`,
    blocks(620, 700, 300, 300, 26),
    brackets(1080, 1920, 60, 70),
    ruleStack(120, 1140, 460, 4, 22),
    `  <rect x="120" y="1260" width="180" height="6" fill="${ACCENT}"/>`,
    regMark(940, 1500, 26),
    regMark(140, 1660, 18, CHARCOAL, 1.6),
].join('\n')));

/* ── demo hero ──────────────────────────────────────────────────────────── */
mkdirSync(DEMO, { recursive: true });
writeFileSync(join(DEMO, 'hero.svg'), svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${WHITE}"/>`,
    `  <rect x="0" y="0" width="1080" height="980" fill="${PAPER}"/>`,
    // An asymmetric architectural silhouette: two columns and a lintel.
    `  <rect x="180" y="380" width="70" height="600" fill="${NEAR_BLACK}" opacity="0.9"/>`,
    `  <rect x="760" y="300" width="70" height="680" fill="${NEAR_BLACK}" opacity="0.9"/>`,
    `  <rect x="180" y="300" width="650" height="60" fill="${NEAR_BLACK}" opacity="0.9"/>`,
    `  <rect x="330" y="560" width="360" height="420" fill="none" stroke="${ACCENT}" stroke-width="4"/>`,
    brackets(1080, 1920, 54, 76),
    ruleStack(140, 1180, 520, 5, 20),
    `  <rect x="140" y="1330" width="220" height="6" fill="${ACCENT}"/>`,
    regMark(900, 1560, 28),
].join('\n')));

/* ── six gallery tiles, 4:5 ─────────────────────────────────────────────── */
const tiles = [
    (w, h) => blocks(w * 0.18, h * 0.22, w * 0.5, h * 0.5, 30),
    (w, h) => `  <rect x="${w * 0.15}" y="${h * 0.18}" width="${w * 0.7}" height="${h * 0.64}" fill="none" stroke="${NEAR_BLACK}" stroke-width="4"/>\n` + regMark(w / 2, h / 2, 46),
    (w, h) => ruleStack(w * 0.14, h * 0.3, w * 0.72, 9, 34, NEAR_BLACK, 3),
    (w, h) => `  <rect x="${w * 0.2}" y="${h * 0.26}" width="${w * 0.6}" height="${h * 0.48}" fill="${NEAR_BLACK}" opacity="0.9"/>\n`
        + `  <rect x="${w * 0.34}" y="${h * 0.4}" width="${w * 0.32}" height="${h * 0.2}" fill="${PAPER}"/>`,
    (w, h) => brackets(w, h, w * 0.12, w * 0.18, NEAR_BLACK, 4) + '\n' + `  <rect x="${w * 0.3}" y="${h * 0.46}" width="${w * 0.4}" height="7" fill="${ACCENT}"/>`,
    (w, h) => `  <path d="M ${w * 0.2} ${h * 0.76} V ${h * 0.4} a ${w * 0.3} ${w * 0.3} 0 0 1 ${w * 0.6} 0 V ${h * 0.76}" fill="none" stroke="${NEAR_BLACK}" stroke-width="4"/>\n`
        + `  <rect x="${w * 0.42}" y="${h * 0.56}" width="${w * 0.16}" height="${h * 0.2}" fill="${ACCENT}" opacity="0.85"/>`,
];
tiles.forEach((draw, i) => {
    writeFileSync(join(DEMO, `story-0${i + 1}.svg`), svg(800, 1000, [
        `  <rect width="800" height="1000" fill="${i % 2 ? PAPER : WHITE}"/>`,
        draw(800, 1000),
    ].join('\n')));
});

/* ── six interlude bands, 16:9 ──────────────────────────────────────────── */
const bands = [
    (w, h) => blocks(w * 0.08, h * 0.2, w * 0.36, h * 0.56, 26) + '\n' + ruleStack(w * 0.56, h * 0.34, w * 0.34, 6, 26, NEAR_BLACK, 3),
    (w, h) => brackets(w, h, 70, 90, NEAR_BLACK, 4) + '\n' + regMark(w / 2, h / 2, 44),
    (w, h) => ruleStack(w * 0.1, h * 0.28, w * 0.8, 7, 40, NEAR_BLACK, 4),
    (w, h) => `  <rect x="${w * 0.1}" y="${h * 0.24}" width="${w * 0.34}" height="${h * 0.52}" fill="${NEAR_BLACK}" opacity="0.9"/>\n`
        + `  <rect x="${w * 0.52}" y="${h * 0.24}" width="${w * 0.38}" height="${h * 0.52}" fill="none" stroke="${ACCENT}" stroke-width="4"/>`,
    (w, h) => `  <path d="M ${w * 0.14} ${h * 0.78} V ${h * 0.36} a ${w * 0.12} ${w * 0.12} 0 0 1 ${w * 0.24} 0 V ${h * 0.78}" fill="none" stroke="${NEAR_BLACK}" stroke-width="4"/>\n`
        + ruleStack(w * 0.5, h * 0.42, w * 0.38, 4, 30, CHARCOAL, 3),
    (w, h) => `  <rect x="${w * 0.3}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.4}" fill="none" stroke="${NEAR_BLACK}" stroke-width="5"/>\n`
        + `  <rect x="${w * 0.44}" y="${h * 0.44}" width="${w * 0.12}" height="${h * 0.12}" fill="${ACCENT}"/>`,
];
bands.forEach((draw, i) => {
    writeFileSync(join(DEMO, `band-0${i + 1}.svg`), svg(1600, 900, [
        `  <rect width="1600" height="900" fill="${i % 2 ? WHITE : PAPER}"/>`,
        draw(1600, 900),
    ].join('\n')));
});

// eslint-disable-next-line no-console
console.log('editorial artwork written:', DEMO, '+', join(TPL, 'hero-default.svg'));
