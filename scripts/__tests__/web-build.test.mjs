/**
 * Tests for the WEB_BUILD cache architecture — the full-graph version stamp.
 *
 *   node --test scripts/__tests__/
 *
 * THE PROPERTY UNDER TEST. GitHub Pages caches JS for four hours and the HTML
 * document for ten minutes, and ES import specifiers resolve without query
 * strings. So the only way a new deployment can be guaranteed to execute as a
 * unit is if the HTML and EVERY executable import edge carry the same build
 * token: the new document then names URLs the old cache has never seen, and a
 * stale document keeps naming the old, equally-coherent set. One unversioned
 * edge anywhere reopens the 2026-08-18 second-wave incident, where a stale
 * parent graph simply never imported the freshly-versioned module — so most of
 * this file is an exhaustive walk of the real files, not examples.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { WEB_BUILD } = await import(pathToFileURL(join(ROOT, 'scripts', 'web-env.mjs')).href);

const INDEX_HTML = readFileSync(join(ROOT, 'invitation', 'index.html'), 'utf8');
const LANDING_HTML = readFileSync(join(ROOT, '404.html'), 'utf8');

/* The same edge shapes the stamper stamps. Kept in sync BY the failing test
 * below if they ever drift: the stamper's own --check runs here too. */
const IMPORT_EDGE = /((?:from\s*|import\()\s*')(\.\.?\/[^']+?\.js)(\?v=[^']*)?(')/g;

function moduleFiles(dir = 'invitation') {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...moduleFiles(rel));
    else if (/\.js$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('the canonical WEB_BUILD value', () => {
  test('exists, and is query- and attribute-safe', () => {
    assert.match(WEB_BUILD, /^[a-z0-9][a-z0-9.-]{0,31}$/);
  });

  test('the stamper itself verifies the tree as coherent', () => {
    // The authoritative check IS the tool operators use — if this passes the
    // suite but fails in the repo, the suite is testing the wrong tree.
    const out = execFileSync(process.execPath,
      [join(ROOT, 'scripts', 'set-web-build.mjs'), '--check'],
      { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /COHERENT/);
    assert.ok(out.includes(`WEB_BUILD=${WEB_BUILD}`));
  });
});

describe('the HTML entry documents', () => {
  test('the invitation page wires every executable asset at the current build', () => {
    for (const ref of [
      `<script src="env.js?v=${WEB_BUILD}"></script>`,
      `<script src="app-return.js?v=${WEB_BUILD}"></script>`,
      `<script src="app-store-links.js?v=${WEB_BUILD}"></script>`,
      `<script type="module" src="invitation/js/main.js?v=${WEB_BUILD}"></script>`,
      `<link rel="stylesheet" href="invitation/css/base.css?v=${WEB_BUILD}">`,
    ]) {
      assert.ok(INDEX_HTML.includes(ref), `invitation/index.html lacks ${ref}`);
    }
  });

  test('the landing page wires its classic scripts at the current build', () => {
    for (const name of ['env.js', 'app-return.js', 'app-store-links.js']) {
      assert.ok(LANDING_HTML.includes(`<script src="${name}?v=${WEB_BUILD}"></script>`),
        `404.html lacks a versioned ${name}`);
    }
  });

  test('no entry document references an UNVERSIONED executable script', () => {
    for (const [name, html] of [['invitation/index.html', INDEX_HTML], ['404.html', LANDING_HTML]]) {
      for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) {
        assert.ok(/\?v=/.test(m[1]), `${name}: unversioned script ${m[1]}`);
      }
    }
  });
});

describe('the executable module graph', () => {
  const files = moduleFiles();

  test('the walk still sees the whole tree', () => {
    // Templates + sections + core: shrinkage here means the scan broke, and a
    // broken scan "passes" everything.
    assert.ok(files.length >= 25, `only ${files.length} modules found`);
    assert.ok(files.some((f) => f.endsWith('js/main.js')));
    assert.ok(files.some((f) => f.includes('sections/passes.js')));
    assert.ok(files.some((f) => f.includes('templates/wedding-romantic/template.js')));
  });

  test('EVERY static and dynamic relative import carries exactly the current build', () => {
    let edges = 0;
    for (const rel of files) {
      const source = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of source.matchAll(IMPORT_EDGE)) {
        edges += 1;
        assert.equal(m[3], `?v=${WEB_BUILD}`,
          `${rel}: import ${m[2]}${m[3] || ''} is not on WEB_BUILD=${WEB_BUILD}`);
      }
    }
    // The graph had 78 module-to-module edges when this shipped; allow growth,
    // refuse collapse.
    assert.ok(edges >= 40, `only ${edges} import edges scanned — the regex went blind`);
  });

  test('no import shape escapes the stamp — no double quotes, no bare specifiers', () => {
    for (const rel of files) {
      const source = readFileSync(join(ROOT, rel), 'utf8');
      assert.ok(!/from\s*"/.test(source), `${rel} uses double-quoted import specifiers`);
      assert.ok(!/import\(\s*"/.test(source), `${rel} uses a double-quoted dynamic import`);
      assert.ok(!/import\(\s*[^'")]/.test(source), `${rel} computes a dynamic import specifier`);
      // Absolute/site-rooted imports would dodge the relative-edge stamp.
      for (const m of source.matchAll(/from\s*'([^'.][^']*)'/g)) {
        assert.fail(`${rel} imports non-relative specifier '${m[1]}'`);
      }
    }
  });

  test('a version change invalidates the full graph — every edge names the token', () => {
    // The invalidation argument is textual and total: the token appears in the
    // URL of every executable request the page makes, so a different token
    // yields a disjoint URL set. Prove "every": count edges that contain the
    // token vs edges at all.
    let all = 0;
    let carrying = 0;
    for (const rel of files) {
      for (const m of readFileSync(join(ROOT, rel), 'utf8').matchAll(IMPORT_EDGE)) {
        all += 1;
        if ((m[3] || '').includes(WEB_BUILD)) carrying += 1;
      }
    }
    assert.equal(carrying, all);
  });

  test('the versioned graph actually LOADS — Node resolves the query-stringed chain', async () => {
    // Not just text: import the real entry-adjacent modules through their
    // stamped edges. A typo'd stamp would make the browser 404; here it would
    // throw ERR_MODULE_NOT_FOUND.
    const renderer = await import(pathToFileURL(join(ROOT, 'invitation', 'js', 'renderer.js')).href + `?v=${WEB_BUILD}`);
    assert.equal(typeof renderer.renderInvitation, 'function');
    const registry = await import(pathToFileURL(join(ROOT, 'invitation', 'js', 'registry.js')).href + `?v=${WEB_BUILD}`);
    assert.equal(typeof registry.resolveTemplate, 'function');
    // The registry statically imports every template through stamped edges, so
    // resolving one proves the deepest chain loaded.
    assert.ok(registry.resolveTemplate('wedding_romantic_v1'));
  });
});

describe('what the build version must NOT touch', () => {
  test('the share thumbnail `&v=` is a different mechanism and is unreferenced here', () => {
    // The OG head is the Worker's rewrite surface: byte-stable, no WEB_BUILD.
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'));
    for (const m of head.matchAll(/<meta[^>]+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>/g)) {
      assert.ok(!m[0].includes(WEB_BUILD), `OG metadata carries the build token: ${m[0]}`);
    }
    // And the stamper's scope declaration keeps thumbnails out by construction.
    const stamper = readFileSync(join(ROOT, 'scripts', 'set-web-build.mjs'), 'utf8');
    assert.ok(!/shareThumbnail|invitation-media|storage\/v1/.test(stamper));
  });

  test('images and non-executable assets are not stamped', () => {
    // The og:image and favicon lines must remain untouched by the stamper's
    // HTML pattern, which names exactly five executable/style assets.
    assert.match(INDEX_HTML, /og-invitation\.jpg"/);
    assert.ok(!INDEX_HTML.includes(`og-invitation.jpg?v=`));
    assert.ok(!INDEX_HTML.includes(`favicon-96x96.png?v=`));
  });
});
