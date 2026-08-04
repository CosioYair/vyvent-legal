/* AUTHORING SCRIPT — Botánica artwork.
 *
 * Writes every SVG this template ships: its own `hero-default`, and the
 * deterministic demonstration media its demo route draws. Run once; the output
 * is committed. Nothing at runtime executes this.
 *
 *   node scripts/make-botanical-art.mjs
 *
 * EVERY FILE IS SELF-CONTAINED: flat shapes and strokes, no <script>, no
 * <image>, no external href, no embedded raster, no <foreignObject>, no
 * font reference. The vocabulary is line-art botany — eucalyptus sprigs, olive
 * branches, a fine wreath, a garden arch — drawn as paths and ellipses so the
 * files stay small and scale cleanly. They carry no names, no dates and no user
 * data, so a demo asset can never be mistaken for somebody's invitation.
 *
 * Deliberately NOT the Classic Gold vocabulary: no rings, no lozenges, no
 * engraved double rules. Where that collection is symmetrical and ruled, this
 * one is asymmetric and grown.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'invitation', 'assets', 'demo', 'wedding-botanical');
const TPL = join(ROOT, 'invitation', 'templates', 'wedding-botanical');

const CREAM = '#F7F3EA';
const IVORY = '#FCFAF5';
const SAGE = '#8A9A7B';
const OLIVE = '#697A5D';
const INK = '#3F5142';

const svg = (w, h, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">\n${body}\n</svg>\n`;

/**
 * A eucalyptus sprig: a curved stem with paired round leaves along it.
 * `dir` mirrors it, `t` tilts the whole sprig.
 */
function sprig(x, y, len, dir = 1, tilt = 0, leaf = SAGE, stem = OLIVE) {
    const parts = [`  <g transform="rotate(${tilt} ${x} ${y})">`];
    parts.push(`    <path d="M ${x} ${y} q ${dir * len * 0.45} ${-len * 0.28} ${dir * len} ${-len * 0.34}" fill="none" stroke="${stem}" stroke-width="${Math.max(2, len * 0.014)}" stroke-linecap="round"/>`);
    const n = 7;
    for (let i = 1; i <= n; i += 1) {
        const p = i / (n + 1);
        const px = x + dir * len * p;
        const py = y - len * 0.34 * Math.pow(p, 0.78);
        const r = len * 0.075 * (1 - p * 0.45);
        parts.push(`    <ellipse cx="${px.toFixed(1)}" cy="${(py - r * 1.15).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.72).toFixed(1)}" fill="${leaf}" opacity="0.88" transform="rotate(${dir * -34} ${px.toFixed(1)} ${(py - r * 1.15).toFixed(1)})"/>`);
        parts.push(`    <ellipse cx="${px.toFixed(1)}" cy="${(py + r * 1.15).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.72).toFixed(1)}" fill="${leaf}" opacity="0.68" transform="rotate(${dir * 34} ${px.toFixed(1)} ${(py + r * 1.15).toFixed(1)})"/>`);
    }
    parts.push('  </g>');
    return parts.join('\n');
}

/** An olive branch: a straight-ish stem with pointed leaves. */
function branch(x, y, len, dir = 1, tilt = 0) {
    const parts = [`  <g transform="rotate(${tilt} ${x} ${y})">`];
    parts.push(`    <path d="M ${x} ${y} l ${dir * len} ${-len * 0.12}" fill="none" stroke="${OLIVE}" stroke-width="2.4" stroke-linecap="round"/>`);
    for (let i = 1; i <= 6; i += 1) {
        const p = i / 7;
        const px = x + dir * len * p;
        const py = y - len * 0.12 * p;
        const l = len * 0.15 * (1 - p * 0.3);
        parts.push(`    <path d="M ${px.toFixed(1)} ${py.toFixed(1)} q ${dir * l * 0.5} ${-l * 0.75} ${dir * l} ${-l * 0.15} q ${-dir * l * 0.5} ${l * 0.3} ${-dir * l} ${l * 0.15} z" fill="${SAGE}" opacity="0.85"/>`);
        parts.push(`    <path d="M ${px.toFixed(1)} ${py.toFixed(1)} q ${dir * l * 0.5} ${l * 0.75} ${dir * l} ${l * 0.15} q ${-dir * l * 0.5} ${-l * 0.3} ${-dir * l} ${-l * 0.15} z" fill="${SAGE}" opacity="0.62"/>`);
    }
    parts.push('  </g>');
    return parts.join('\n');
}

/** A fine wreath: two mirrored arcs of small leaves, open at the top. */
function wreath(cx, cy, r) {
    const parts = [];
    for (const dir of [-1, 1]) {
        for (let i = 0; i < 11; i += 1) {
            const a = (-58 + i * 11.6) * (Math.PI / 180);
            const px = cx + dir * Math.sin(a) * r;
            const py = cy - Math.cos(a) * r * -1;
            const rot = dir * (a * 180 / Math.PI + 90);
            const lr = r * 0.13 * (1 - Math.abs(i - 5) * 0.045);
            parts.push(`  <ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${lr.toFixed(1)}" ry="${(lr * 0.55).toFixed(1)}" fill="${SAGE}" opacity="0.85" transform="rotate(${rot.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})"/>`);
        }
    }
    return parts.join('\n');
}

/* ── the template's own hero artwork ────────────────────────────────────── */
mkdirSync(TPL, { recursive: true });
writeFileSync(join(TPL, 'hero-default.svg'), svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${CREAM}"/>`,
    `  <path d="M0 0 Q 540 210 1080 0 L1080 1920 L0 1920 Z" fill="${IVORY}"/>`,
    // Asymmetric corner sprigs — the collection's signature framing.
    sprig(90, 430, 330, 1, -18),
    sprig(990, 350, 300, -1, 16),
    sprig(120, 1650, 300, 1, -156),
    branch(960, 1560, 250, -1, 12),
    wreath(540, 1060, 210),
    `  <path d="M 400 1300 h 280" stroke="${OLIVE}" stroke-width="1.6" opacity="0.7"/>`,
    branch(540, 1360, 120, 1, 0),
    branch(540, 1360, 120, -1, 0),
].join('\n')));

/* ── demo hero ──────────────────────────────────────────────────────────── */
mkdirSync(DEMO, { recursive: true });
writeFileSync(join(DEMO, 'hero.svg'), svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${IVORY}"/>`,
    `  <path d="M0 1240 Q 540 1100 1080 1260 L1080 1920 L0 1920 Z" fill="${CREAM}"/>`,
    // A garden arch, drawn open so the names sit inside it.
    `  <path d="M 250 1180 V 720 a 290 290 0 0 1 580 0 V 1180" fill="none" stroke="${OLIVE}" stroke-width="3" opacity="0.55"/>`,
    sprig(250, 1180, 300, 1, -84),
    sprig(830, 1180, 300, -1, 84),
    sprig(330, 560, 250, 1, -26),
    sprig(750, 560, 250, -1, 26),
    branch(540, 1420, 170, 1, -4),
    branch(540, 1420, 170, -1, 4),
].join('\n')));

/* ── six gallery tiles, 4:5 ─────────────────────────────────────────────── */
const tiles = [
    (w, h) => wreath(w / 2, h / 2 + 20, 150),
    (w, h) => sprig(w * 0.18, h * 0.7, 400, 1, -22),
    (w, h) => branch(w / 2, h / 2, 230, 1, -8) + '\n' + branch(w / 2, h / 2, 230, -1, 8),
    (w, h) => `  <path d="M ${w * 0.22} ${h * 0.74} V ${h * 0.42} a ${w * 0.28} ${w * 0.28} 0 0 1 ${w * 0.56} 0 V ${h * 0.74}" fill="none" stroke="${OLIVE}" stroke-width="3.5" opacity="0.6"/>\n`
        + sprig(w * 0.22, h * 0.74, 190, 1, -80),
    (w, h) => [0, 1, 2].map((i) => sprig(w * 0.2 + i * w * 0.3, h * 0.78, 200, 1, -70 - i * 6)).join('\n'),
    (w, h) => `  <circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.26}" fill="none" stroke="${SAGE}" stroke-width="2" opacity="0.7"/>\n`
        + branch(w / 2 - w * 0.2, h / 2 + 40, 170, 1, -14),
];
tiles.forEach((draw, i) => {
    writeFileSync(join(DEMO, `story-0${i + 1}.svg`), svg(800, 1000, [
        `  <rect width="800" height="1000" fill="${i % 2 ? CREAM : IVORY}"/>`,
        draw(800, 1000),
    ].join('\n')));
});

/* ── six interlude bands, 16:9 ──────────────────────────────────────────── */
const bands = [
    (w, h) => sprig(w * 0.1, h * 0.62, 380, 1, -12) + '\n' + sprig(w * 0.9, h * 0.62, 380, -1, 12),
    (w, h) => wreath(w / 2, h / 2 + 10, 190),
    (w, h) => `  <path d="M ${w * 0.12} ${h / 2} H ${w * 0.88}" stroke="${OLIVE}" stroke-width="1.8" opacity="0.6"/>\n`
        + branch(w / 2, h / 2, 200, 1, -6) + '\n' + branch(w / 2, h / 2, 200, -1, 6),
    (w, h) => [0.16, 0.38, 0.62, 0.84].map((p, i) => sprig(w * p, h * 0.8, 260, 1, -74 - i * 5)).join('\n'),
    (w, h) => `  <path d="M ${w * 0.2} ${h * 0.82} V ${h * 0.42} a ${w * 0.15} ${w * 0.15} 0 0 1 ${w * 0.3} 0 V ${h * 0.82}" fill="none" stroke="${OLIVE}" stroke-width="3" opacity="0.5"/>\n`
        + sprig(w * 0.72, h * 0.78, 300, 1, -30),
    (w, h) => sprig(w * 0.5, h * 0.86, 330, 1, -104) + '\n' + sprig(w * 0.5, h * 0.86, 330, -1, 104),
];
bands.forEach((draw, i) => {
    writeFileSync(join(DEMO, `band-0${i + 1}.svg`), svg(1600, 900, [
        `  <rect width="1600" height="900" fill="${i % 2 ? IVORY : CREAM}"/>`,
        draw(1600, 900),
    ].join('\n')));
});

// eslint-disable-next-line no-console
console.log('botanical artwork written:', DEMO, '+', join(TPL, 'hero-default.svg'));
void INK;
