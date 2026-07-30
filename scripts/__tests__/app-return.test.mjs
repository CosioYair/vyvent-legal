/**
 * Tests for the app handoff resolver.
 *
 *   node --test scripts/__tests__/
 *
 * These load `app-return.js` itself — the exact byte-for-byte file GitHub Pages
 * serves — through its CommonJS export, so nothing here can pass against a copy
 * that has drifted from what the site runs.
 *
 * Two properties are under test, and they pull in opposite directions:
 *
 *   • The DEV mirror MUST be able to return to whichever Expo Go project
 *     produced the link, whose address it cannot know in advance.
 *   • That same freedom must not become an open redirect, and must never
 *     degrade into opening the PRODUCTION app from the DEV site.
 *
 * Plus the production boundary: `orbiventt.com` behavior is unchanged, and the
 * DEV parameter is unreadable there.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { resolveAppHandoff, expoGoReturnUrl } = require(join(ROOT, 'app-return.js'));

const EVENT_ID = '441dbd01-0b92-44f9-b29c-203179af64d2';
const OTHER_EVENT_ID = '00000000-1111-2222-3333-444444444444';
const METRO = 'exp://192.168.1.42:8081';
const RETURN_URL = `${METRO}/--/e/${EVENT_ID}`;

/** The DEV mirror rendering /e/{EVENT_ID}. */
const dev = (over = {}) => ({
  env: 'dev', kind: 'e', id: EVENT_ID, isChat: false, appReturn: RETURN_URL, ...over,
});
/** Production rendering the same route. */
const prod = (over = {}) => ({
  env: 'prod', kind: 'e', id: EVENT_ID, isChat: false, ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The DEV web button uses the valid Expo Go return URL
// 3 · The return route preserves the event ID
// ─────────────────────────────────────────────────────────────────────────────
describe('DEV · a valid Expo Go return URL', () => {
  test('2 · becomes the button target', () => {
    const h = resolveAppHandoff(dev());
    assert.equal(h.open, true);
    assert.equal(h.source, 'expo-go');
    assert.equal(h.href, RETURN_URL);
  });

  test('3 · the route keeps the event id this page rendered', () => {
    const { href } = resolveAppHandoff(dev());
    assert.ok(href.endsWith(`/--/e/${EVENT_ID}`));
    assert.ok(href.startsWith('exp://'));
  });

  test('accepts the exps: variant and a tunnel host', () => {
    const tunnel = `exps://abc-xyz.anonymous.8081.exp.direct/--/e/${EVENT_ID}`;
    assert.equal(resolveAppHandoff(dev({ appReturn: tunnel })).href, tunnel);
  });

  test('accepts localhost and non-default ports (simulator / tethering)', () => {
    for (const host of ['localhost:8081', '127.0.0.1:19000', '10.0.2.2:8081']) {
      const url = `exp://${host}/--/e/${EVENT_ID}`;
      assert.equal(resolveAppHandoff(dev({ appReturn: url })).href, url);
    }
  });

  test('the returned href is REBUILT, never the raw input echoed back', () => {
    // Same route, differently encoded. The output uses the page's own encoding.
    const equivalent = `${METRO}/--/e/${encodeURIComponent(EVENT_ID)}`;
    assert.equal(resolveAppHandoff(dev({ appReturn: equivalent })).href, RETURN_URL);
  });

  test('the event-chat sub-route resolves to its own path', () => {
    const chat = `${METRO}/--/e/${EVENT_ID}/chat`;
    const h = resolveAppHandoff(dev({ isChat: true, appReturn: chat }));
    assert.equal(h.href, chat);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · A smart invitation code is also preserved when present
// ─────────────────────────────────────────────────────────────────────────────
describe('4 · invitation codes survive both handoffs', () => {
  test('DEV · the code rides on the Expo Go return URL', () => {
    const h = resolveAppHandoff(dev({ code: 'ABCDEFGHIJKL' }));
    assert.equal(h.href, `${RETURN_URL}?code=ABCDEFGHIJKL`);
  });

  test('PROD · the code rides on the app scheme, exactly as before', () => {
    const h = resolveAppHandoff(prod({ code: 'ABCDEFGHIJKL' }));
    assert.equal(h.href, `vyvent://e/${EVENT_ID}?code=ABCDEFGHIJKL`);
  });

  test('a return URL carrying its own query is rejected outright', () => {
    // We append the code ourselves; a query already present is unexpected
    // input, not something to merge.
    const h = resolveAppHandoff(dev({ appReturn: `${RETURN_URL}?code=EVIL` }));
    assert.equal(h.open, false);
  });

  test('a malformed code is dropped, and never blocks the handoff', () => {
    for (const code of ['../../x', 'a b', '<script>', 'x'.repeat(40)]) {
      const h = resolveAppHandoff(dev({ code }));
      assert.equal(h.open, true);
      assert.equal(h.href, RETURN_URL, `code ${JSON.stringify(code)} leaked`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Missing return URL on DEV never opens the production app
// 9 · No production host or app fallback is introduced into the DEV flow
// ─────────────────────────────────────────────────────────────────────────────
describe('5 + 9 · the DEV mirror fails closed', () => {
  test('5 · an absent parameter yields no target at all', () => {
    for (const appReturn of [undefined, null, '']) {
      const h = resolveAppHandoff(dev({ appReturn }));
      assert.equal(h.open, false, `appReturn=${JSON.stringify(appReturn)}`);
      assert.equal(h.href, null);
      assert.equal(h.reason, 'expo-go-required');
    }
  });

  test('9 · no DEV outcome can ever produce an app-scheme or https target', () => {
    const inputs = [
      undefined, null, '', 'not a url',
      `vyvent://e/${EVENT_ID}`,
      `https://orbiventt.com/e/${EVENT_ID}`,
      `${METRO}/--/e/${OTHER_EVENT_ID}`,
      'javascript:alert(1)',
      RETURN_URL,                       // the one valid case, included on purpose
    ];
    for (const appReturn of inputs) {
      const { href } = resolveAppHandoff(dev({ appReturn }));
      if (href === null) continue;
      assert.ok(href.startsWith('exp://') || href.startsWith('exps://'),
        `DEV produced a non-Expo target: ${href}`);
      assert.ok(!href.includes('orbiventt.com'), `DEV produced a production host: ${href}`);
      assert.ok(!href.includes('vyvent://'), `DEV produced the app scheme: ${href}`);
    }
  });

  test('9 · the source file contains no production-host fallback', () => {
    const src = readFileSync(join(ROOT, 'app-return.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')      // strip block comments
      .replace(/^\s*\/\/.*$/gm, '');         // strip line comments
    assert.ok(!src.includes('orbiventt.com'));
    assert.ok(!src.includes('github.io'));
  });

  test('every non-event route fails closed on DEV too', () => {
    for (const kind of ['u', 'p']) {
      const h = resolveAppHandoff({ env: 'dev', kind, id: 'someone', isChat: false });
      assert.equal(h.open, false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 · Malformed or arbitrary return URLs are rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('6 · rejected return URLs', () => {
  const rejected = {
    'plain http': `http://192.168.1.42:8081/--/e/${EVENT_ID}`,
    'https (the web origin itself)': `https://cosioyair.github.io/vyvent-legal/e/${EVENT_ID}`,
    'the production app scheme': `vyvent://e/${EVENT_ID}`,
    'an arbitrary custom scheme': `evilapp://x/--/e/${EVENT_ID}`,
    'javascript:': 'javascript:alert(document.cookie)',
    'javascript: dressed as a path': `javascript:/--/e/${EVENT_ID}`,
    'data:': 'data:text/html,<script>alert(1)</script>',
    'blob:': `blob:https://evil.example/--/e/${EVENT_ID}`,
    'file:': `file:///--/e/${EVENT_ID}`,
    'scheme-relative': `//evil.example/--/e/${EVENT_ID}`,
    'relative path': `/--/e/${EVENT_ID}`,
    'not a URL at all': 'just some text',
    'empty string': '',
    'a different event id': `${METRO}/--/e/${OTHER_EVENT_ID}`,
    'an unrelated app route': `${METRO}/--/settings`,
    'a route missing the /--/ separator': `${METRO}/e/${EVENT_ID}`,
    'a deeper path under the right event': `${METRO}/--/e/${EVENT_ID}/admin`,
    'a path prefix trick': `${METRO}/--/e/${EVENT_ID}x`,
    'traversal back out of the event': `${METRO}/--/e/${EVENT_ID}/../u/attacker`,
    'no host (opaque path)': `exp:/--/e/${EVENT_ID}`,
    'embedded credentials': `exp://user:pass@192.168.1.42:8081/--/e/${EVENT_ID}`,
    'a fragment of its own': `${RETURN_URL}#/u/attacker`,
    'a malformed percent escape': `${METRO}/--/e/%zz`,
    'a CR/LF injection attempt': `${RETURN_URL}\r\nLocation: https://evil.example`,
    'an embedded quote': `${METRO}/--/e/${EVENT_ID}" onclick="alert(1)`,
    'an embedded backslash': `${METRO}\\--\\e\\${EVENT_ID}`,
    'leading whitespace': `  ${RETURN_URL}`,
    'a non-string': 42,
    'an object pretending to be a URL': { toString: () => RETURN_URL },
  };

  for (const [label, appReturn] of Object.entries(rejected)) {
    test(`rejects ${label}`, () => {
      const h = resolveAppHandoff(dev({ appReturn }));
      assert.equal(h.open, false, `accepted ${label}: ${h.href}`);
      assert.equal(h.href, null);
    });
  }

  test('the low-level validator agrees with the resolver', () => {
    for (const appReturn of Object.values(rejected)) {
      assert.equal(expoGoReturnUrl(appReturn, 'e', EVENT_ID, false), null);
    }
    assert.equal(expoGoReturnUrl(RETURN_URL, 'e', EVENT_ID, false), RETURN_URL);
  });

  test('an invalid route is refused in either environment', () => {
    for (const env of ['dev', 'prod']) {
      assert.equal(resolveAppHandoff({ env, kind: 'x', id: EVENT_ID }).open, false);
      assert.equal(resolveAppHandoff({ env, kind: 'e', id: '' }).open, false);
      assert.equal(resolveAppHandoff({ env, kind: 'p', id: 'dj', isChat: true }).open, false);
    }
  });

  test('no arguments at all is a closed handoff, not a crash', () => {
    assert.equal(resolveAppHandoff().open, false);
    assert.equal(resolveAppHandoff({}).open, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 · PROD app handoff remains unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe('8 · the production handoff is untouched', () => {
  test('events, chats, users and providers keep their exact scheme links', () => {
    const cases = [
      [{ kind: 'e', id: EVENT_ID }, `vyvent://e/${EVENT_ID}`],
      [{ kind: 'e', id: EVENT_ID, isChat: true }, `vyvent://e/${EVENT_ID}/chat`],
      [{ kind: 'u', id: 'user-1' }, 'vyvent://u/user-1'],
      [{ kind: 'p', id: 'dj-luna' }, 'vyvent://p/dj-luna'],
    ];
    for (const [route, expected] of cases) {
      assert.equal(resolveAppHandoff({ env: 'prod', ...route }).href, expected);
    }
  });

  test('ids are percent-encoded exactly as the previous inline builder did', () => {
    const h = resolveAppHandoff({ env: 'prod', kind: 'p', id: 'a b/c?d' });
    assert.equal(h.href, `vyvent://p/${encodeURIComponent('a b/c?d')}`);
  });

  test('production ignores app_return entirely — hostile values included', () => {
    const hostile = [
      'exp://evil.example/--/e/' + EVENT_ID,
      'javascript:alert(1)',
      'https://evil.example',
      RETURN_URL,
    ];
    for (const appReturn of hostile) {
      const h = resolveAppHandoff(prod({ appReturn }));
      assert.equal(h.href, `vyvent://e/${EVENT_ID}`, `production honored app_return=${appReturn}`);
      assert.equal(h.source, 'app-scheme');
    }
  });

  test('any environment that is not exactly "dev" takes the production branch', () => {
    for (const env of [undefined, null, '', 'prod', 'production', 'staging', 'DEV']) {
      const h = resolveAppHandoff({ env, kind: 'e', id: EVENT_ID, appReturn: RETURN_URL });
      assert.equal(h.source, 'app-scheme', `env=${JSON.stringify(env)} leaked into the DEV branch`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wiring — the page must actually route every handoff through this module.
// The historical failure mode here is a second, hand-rolled link builder left
// behind at one call site; a source assertion is the only thing that catches it.
// ─────────────────────────────────────────────────────────────────────────────
describe('404.html routes every app handoff through the resolver', () => {
  const page = readFileSync(join(ROOT, '404.html'), 'utf8');
  const code = page
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  test('loads app-return.js', () => {
    assert.ok(page.includes('<script src="app-return.js"></script>'));
  });

  test('builds no app-scheme link of its own', () => {
    assert.ok(!code.includes("'vyvent://"), 'a hand-rolled vyvent:// link remains in 404.html');
    assert.ok(!code.includes('"vyvent://'));
  });

  test('reads the app_return parameter', () => {
    assert.ok(code.includes("get('app_return')"));
  });

  test('carries the DEV notice element the closed branch reveals', () => {
    assert.ok(page.includes('id="devHandoff"'));
  });
});
