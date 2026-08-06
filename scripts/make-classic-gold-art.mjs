/* AUTHORING SCRIPT — Clásica elegante artwork.
 *
 * Writes every SVG this template ships: its own `hero-default`, and the
 * deterministic demonstration media its demo route draws. Run once; the output
 * is committed. Nothing at runtime executes this.
 *
 *   node scripts/make-classic-gold-art.mjs
 *
 * EVERY FILE IS SELF-CONTAINED: flat shapes, no <script>, no <image>, no
 * external href, no embedded raster, no font reference. They are ornament —
 * ivory grounds, thin gold rules, rings and laurels — and they carry no names,
 * no dates and no user data, so a demo asset can never be mistaken for
 * somebody's invitation content.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'invitation', 'assets', 'demo', 'wedding-classic-gold');
const TPL = join(ROOT, 'invitation', 'templates', 'wedding-classic-gold');

const IVORY = '#FDFBF6';
const CREAM = '#F6F1E6';
const GOLD = '#B08A3E';
const GOLD_SOFT = '#D8C08A';
const INK = '#2A2723';

/** An <svg> wrapper. `decorative` files are aria-hidden by the renderer. */
const svg = (w, h, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">\n${body}\n</svg>\n`;

/** A double rule: the template's signature ornament. */
const rules = (x, y, w, gap = 7, colour = GOLD) =>
    `  <rect x="${x}" y="${y}" width="${w}" height="2" fill="${colour}"/>\n` +
    `  <rect x="${x}" y="${y + gap}" width="${w}" height="1" fill="${colour}" opacity="0.65"/>`;

/** Two interlocking rings, drawn as strokes. */
const rings = (cx, cy, r, sw = 5) =>
    `  <circle cx="${cx - r * 0.55}" cy="${cy}" r="${r}" fill="none" stroke="${GOLD}" stroke-width="${sw}"/>\n` +
    `  <circle cx="${cx + r * 0.55}" cy="${cy}" r="${r}" fill="none" stroke="${GOLD_SOFT}" stroke-width="${sw}"/>`;

/** A symmetrical laurel sprig, mirrored around x. */
const laurel = (cx, cy, len, dir = 1) => {
    let out = `  <path d="M ${cx} ${cy} q ${dir * len * 0.5} ${-len * 0.12} ${dir * len} ${-len * 0.05}" fill="none" stroke="${GOLD}" stroke-width="2.5" opacity="0.9"/>\n`;
    for (let i = 1; i <= 5; i += 1) {
        const t = i / 6;
        const x = cx + dir * len * t;
        const y = cy - len * 0.06 * t;
        out += `  <ellipse cx="${x}" cy="${y - 7}" rx="${9 - i}" ry="4.5" fill="${GOLD_SOFT}" opacity="0.85" transform="rotate(${dir * -22} ${x} ${y - 7})"/>\n`;
        out += `  <ellipse cx="${x}" cy="${y + 7}" rx="${9 - i}" ry="4.5" fill="${GOLD_SOFT}" opacity="0.7" transform="rotate(${dir * 22} ${x} ${y + 7})"/>\n`;
    }
    return out;
};

/** A thin engraved frame inset into the sheet. */
const frame = (w, h, inset, sw = 2) =>
    `  <rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" fill="none" stroke="${GOLD}" stroke-width="${sw}" opacity="0.85"/>\n` +
    `  <rect x="${inset + 10}" y="${inset + 10}" width="${w - (inset + 10) * 2}" height="${h - (inset + 10) * 2}" fill="none" stroke="${GOLD_SOFT}" stroke-width="1" opacity="0.8"/>`;

/* ── the template's own hero artwork ────────────────────────────────────── */
const heroDefault = svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${IVORY}"/>`,
    `  <rect x="0" y="0" width="1080" height="1920" fill="${CREAM}" opacity="0.55"/>`,
    frame(1080, 1920, 64, 2.5),
    rings(540, 690, 92, 7),
    laurel(540, 900, 210, -1),
    laurel(540, 900, 210, 1),
    rules(390, 1030, 300, 9),
    `  <circle cx="540" cy="1160" r="5" fill="${GOLD}"/>`,
    rules(390, 1240, 300, 9),
].join('\n'));
mkdirSync(TPL, { recursive: true });
writeFileSync(join(TPL, 'hero-default.svg'), heroDefault);

/* ── demo hero ──────────────────────────────────────────────────────────── */
mkdirSync(DEMO, { recursive: true });
writeFileSync(join(DEMO, 'hero.svg'), svg(1080, 1920, [
    `  <rect width="1080" height="1920" fill="${IVORY}"/>`,
    `  <path d="M0 1180 Q 540 1080 1080 1180 L1080 1920 L0 1920 Z" fill="${CREAM}"/>`,
    frame(1080, 1920, 58, 2.5),
    rings(540, 620, 104, 8),
    laurel(540, 860, 230, -1),
    laurel(540, 860, 230, 1),
    rules(340, 1000, 400, 10),
    `  <circle cx="540" cy="1420" r="4" fill="${GOLD}" opacity="0.9"/>`,
    `  <circle cx="480" cy="1420" r="3" fill="${GOLD_SOFT}"/>`,
    `  <circle cx="600" cy="1420" r="3" fill="${GOLD_SOFT}"/>`,
].join('\n')));

/* ── six gallery tiles, 4:5 ─────────────────────────────────────────────── */
const tiles = [
    ['Dos argollas grabadas sobre papel marfil', (w, h) => rings(w / 2, h / 2, 96, 7)],
    ['Un ramo de laurel dorado', (w, h) => laurel(w / 2, h / 2, 190, -1) + laurel(w / 2, h / 2, 190, 1)],
    ['Una copa de brindis con filo dorado', (w, h) =>
        `  <path d="M ${w / 2 - 70} ${h / 2 - 120} h 140 l -34 150 h -72 z" fill="none" stroke="${GOLD}" stroke-width="5"/>\n` +
        `  <rect x="${w / 2 - 4}" y="${h / 2 + 30}" width="8" height="110" fill="${GOLD}"/>\n` +
        `  <rect x="${w / 2 - 62}" y="${h / 2 + 140}" width="124" height="7" rx="3" fill="${GOLD}"/>`],
    ['Un candelabro clásico de tres velas', (w, h) =>
        [0, -110, 110].map((dx) =>
            `  <rect x="${w / 2 + dx - 9}" y="${h / 2 - 130 + Math.abs(dx) * 0.25}" width="18" height="190" fill="${GOLD_SOFT}"/>\n` +
            `  <path d="M ${w / 2 + dx} ${h / 2 - 150 + Math.abs(dx) * 0.25} q 18 22 0 44 q -18 -22 0 -44" fill="${GOLD}"/>`).join('\n') +
        `\n  <rect x="${w / 2 - 150}" y="${h / 2 + 60}" width="300" height="9" rx="4" fill="${GOLD}"/>`],
    ['Un monograma enmarcado', (w, h) =>
        `  <rect x="${w / 2 - 120}" y="${h / 2 - 120}" width="240" height="240" fill="none" stroke="${GOLD}" stroke-width="4" transform="rotate(45 ${w / 2} ${h / 2})"/>\n` +
        rules(w / 2 - 70, h / 2 - 8, 140, 16)],
    ['Una guirnalda de hojas doradas', (w, h) =>
        `  <path d="M ${w * 0.15} ${h / 2} q ${w * 0.35} ${-h * 0.22} ${w * 0.7} 0" fill="none" stroke="${GOLD}" stroke-width="3"/>\n` +
        Array.from({ length: 9 }, (_, i) => {
            const t = (i + 1) / 10;
            const x = w * 0.15 + w * 0.7 * t;
            const y = h / 2 - Math.sin(Math.PI * t) * h * 0.16;
            return `  <ellipse cx="${x.toFixed(0)}" cy="${(y - 12).toFixed(0)}" rx="16" ry="7" fill="${GOLD_SOFT}" opacity="0.9" transform="rotate(${(-40 + i * 10)} ${x.toFixed(0)} ${(y - 12).toFixed(0)})"/>`;
        }).join('\n')],
];
tiles.forEach(([, draw], i) => {
    writeFileSync(join(DEMO, `story-0${i + 1}.svg`), svg(800, 1000, [
        `  <rect width="800" height="1000" fill="${IVORY}"/>`,
        `  <rect x="0" y="0" width="800" height="1000" fill="${CREAM}" opacity="${i % 2 ? 0.6 : 0.3}"/>`,
        frame(800, 1000, 34, 2),
        draw(800, 1000),
    ].join('\n')));
});

/* ── six interlude bands, 16:9 ──────────────────────────────────────────── */
const bands = [
    (w, h) => rings(w / 2, h / 2, 78, 6),
    (w, h) => laurel(w / 2, h / 2, 260, -1) + laurel(w / 2, h / 2, 260, 1),
    (w, h) => rules(w / 2 - 260, h / 2 - 6, 520, 14) + `\n  <circle cx="${w / 2}" cy="${h / 2 + 1}" r="9" fill="${IVORY}" stroke="${GOLD}" stroke-width="3"/>`,
    (w, h) => Array.from({ length: 7 }, (_, i) => {
        const x = w * 0.2 + (w * 0.6 * i) / 6;
        return `  <rect x="${x.toFixed(0)}" y="${h / 2 - 60}" width="10" height="140" fill="${GOLD_SOFT}"/>\n` +
            `  <path d="M ${(x + 5).toFixed(0)} ${h / 2 - 76} q 14 18 0 34 q -14 -18 0 -34" fill="${GOLD}"/>`;
    }).join('\n'),
    (w, h) => `  <path d="M ${w * 0.1} ${h * 0.62} q ${w * 0.4} ${-h * 0.34} ${w * 0.8} 0" fill="none" stroke="${GOLD}" stroke-width="3"/>\n` +
        Array.from({ length: 11 }, (_, i) => {
            const t = (i + 1) / 12;
            const x = w * 0.1 + w * 0.8 * t;
            const y = h * 0.62 - Math.sin(Math.PI * t) * h * 0.26;
            return `  <ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="17" ry="7" fill="${GOLD_SOFT}" opacity="0.85" transform="rotate(${(-42 + i * 8)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
        }).join('\n'),
    (w, h) => `  <rect x="${w / 2 - 150}" y="${h / 2 - 150}" width="300" height="300" fill="none" stroke="${GOLD}" stroke-width="3" transform="rotate(45 ${w / 2} ${h / 2})"/>\n` + rings(w / 2, h / 2, 54, 5),
];
bands.forEach((draw, i) => {
    writeFileSync(join(DEMO, `band-0${i + 1}.svg`), svg(1600, 900, [
        `  <rect width="1600" height="900" fill="${i % 2 ? CREAM : IVORY}"/>`,
        `  <rect x="0" y="0" width="1600" height="6" fill="${GOLD}" opacity="0.5"/>`,
        `  <rect x="0" y="894" width="1600" height="6" fill="${GOLD}" opacity="0.5"/>`,
        draw(1600, 900),
    ].join('\n')));
});

// eslint-disable-next-line no-console
console.log('classic-gold artwork written:', DEMO, '+', join(TPL, 'hero-default.svg'));
void INK;
