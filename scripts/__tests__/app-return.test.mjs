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
// 7 · The installed-build return — the environment-marked app scheme
//
// A pass link generated by the INSTALLED DEV build cannot carry an Expo Go
// address. It attaches its own canonical `vyvent://<route>` instead, and the
// DEV branch accepts it ONLY byte-equal to this page's route AND only when the
// caller supplied its own site base — the marker the emitted href carries so
// the RECEIVING app can refuse a link from another environment before touching
// any data. The 2026-07-18 rule survives in sharpened form: the DEV mirror
// never emits an UNMARKED `vyvent://` link.
// ─────────────────────────────────────────────────────────────────────────────
describe('7 · DEV · the installed-build return', () => {
  const SITE = 'https://cosioyair.github.io/vyvent-legal';
  const INSTALLED = `vyvent://e/${EVENT_ID}`;

  test('is accepted with the page\'s own site base, and the marker rides the href', () => {
    const h = resolveAppHandoff(dev({ appReturn: INSTALLED, siteBase: SITE, code: 'ABCDEFGHIJKL' }));
    assert.equal(h.open, true);
    assert.equal(h.source, 'app-scheme-dev');
    assert.equal(h.href,
      `vyvent://e/${EVENT_ID}?code=ABCDEFGHIJKL&web=${encodeURIComponent(SITE)}`);
  });

  test('without a code, the marker still rides', () => {
    const h = resolveAppHandoff(dev({ appReturn: INSTALLED, siteBase: SITE, code: null }));
    assert.equal(h.href, `vyvent://e/${EVENT_ID}?web=${encodeURIComponent(SITE)}`);
  });

  test('the marker decodes to exactly the site base — nothing more', () => {
    const h = resolveAppHandoff(dev({ appReturn: INSTALLED, siteBase: SITE + '/', code: null }));
    const marker = /[?&]web=([^&#]*)/.exec(h.href)[1];
    assert.equal(decodeURIComponent(marker), SITE); // trailing slash normalized away
  });

  test('WITHOUT the site base it stays closed — no unmarked vyvent:// exists', () => {
    for (const siteBase of [undefined, null, '']) {
      const h = resolveAppHandoff(dev({ appReturn: INSTALLED, siteBase }));
      assert.equal(h.open, false, `siteBase=${JSON.stringify(siteBase)}`);
      assert.equal(h.href, null);
    }
  });

  test('binds to THIS page\'s route — any other shape fails closed', () => {
    const rejected = [
      `vyvent://e/${OTHER_EVENT_ID}`,            // another event
      'vyvent://u/attacker',                      // another route kind
      `vyvent://e/${EVENT_ID}/chat`,              // deeper sub-route
      `vyvent://e/${EVENT_ID}?code=EVIL`,         // its own query
      `vyvent://e/${EVENT_ID}#frag`,              // its own fragment
      `vyvent://e/${EVENT_ID}x`,                  // prefix trick
      `vyvent:///e/${EVENT_ID}`,                  // extra slash
      `VYVENT://e/${EVENT_ID}`,                   // case variant — not canonical
      ` vyvent://e/${EVENT_ID}`,                  // whitespace
    ];
    for (const appReturn of rejected) {
      const h = resolveAppHandoff(dev({ appReturn, siteBase: SITE }));
      assert.equal(h.open, false, `accepted ${JSON.stringify(appReturn)}: ${h.href}`);
    }
  });

  test('a hostile or non-https site base is refused whole', () => {
    for (const siteBase of [
      'http://cosioyair.github.io/vyvent-legal',            // not https
      'https://evil.example/x"><script>',                   // markup breakout
      'https://evil.example/?redirect=1',                   // query of its own
      'https://evil.example/#frag',                         // fragment
      'https://evil.example/a b',                           // whitespace
      'vyvent://e/whatever',                                // not a web origin
      'x'.repeat(300),                                      // oversized
      42, { toString: () => SITE },                         // non-strings
    ]) {
      const h = resolveAppHandoff(dev({ appReturn: INSTALLED, siteBase }));
      assert.equal(h.open, false, `accepted siteBase=${String(siteBase).slice(0, 40)}`);
    }
  });

  test('an Expo Go return still wins the DEV branch untouched — no marker', () => {
    const h = resolveAppHandoff(dev({ siteBase: SITE, code: 'ABCDEFGHIJKL' }));
    assert.equal(h.source, 'expo-go');
    assert.equal(h.href, `${RETURN_URL}?code=ABCDEFGHIJKL`);
    assert.ok(!h.href.includes('web='));
  });

  test('production ignores the installed return AND the site base — href unmarked', () => {
    const h = resolveAppHandoff(prod({ appReturn: INSTALLED, siteBase: SITE, code: 'ABCDEFGHIJKL' }));
    assert.equal(h.source, 'app-scheme');
    assert.equal(h.href, `vyvent://e/${EVENT_ID}?code=ABCDEFGHIJKL`);
    assert.ok(!h.href.includes('web='));
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

/** Comments explain intent; only code can be wrong. */
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Two presentations, one redemption
// ─────────────────────────────────────────────────────────────────────────────
describe('both link families resolve to one app destination', () => {
    /* A guest can be handed a pass two ways:
     *
     *   traditional        /e/{eventId}?code={code}          (404.html)
     *   digital invitation /invitation/?i={slug}&code={code} (invitation/)
     *
     * They look nothing alike, and are meant to. But the moment either says
     * "Abrir Orbiventt" they must become the SAME thing: the same deep link,
     * the same screen, the same prefilled code step, the same claim.
     *
     * That equivalence decays quietly — each family has its own page, its own
     * tests and its own reasons to change, so a parameter added for one would
     * leave the other behind and nothing else would notice. These assertions
     * are the tripwire. The per-boundary behaviour is covered in
     * app-return.test.mjs; this is only about the two agreeing. */
    const EVENT = '8a900000-0000-4000-8000-000000000002';
    const CODE = 'ABCDEFGHIJKL';

    /** The arguments each page passes. Read off the two sources, not invented. */
    const INVITATION_CALL = { kind: 'e', id: EVENT, isChat: false, code: CODE };
    const PREVIEW_CALL = { kind: 'e', id: EVENT, isChat: false, code: CODE };

    test('the two pages call the resolver with the same shape', () => {
        // invitation/js/main.js — passHandoff()
        const main = stripComments(readFileSync(join(ROOT, 'invitation', 'js', 'main.js'), 'utf8'));
        assert.match(main, /kind:\s*'e'/);
        assert.match(main, /isChat:\s*false/);
        assert.match(main, /code:\s*route\.code/);
        // 404.html — handoffFor('e', eventId, false, code)
        const preview = readFileSync(join(ROOT, '404.html'), 'utf8');
        assert.match(preview, /handoffFor\('e',\s*eventId,\s*false,\s*code\)/);
        // Neither page builds a scheme itself; both fail closed on a missing
        // resolver, which is what keeps DEV from emitting `vyvent://`.
        assert.ok(!main.includes("'vyvent://'"));
        assert.ok(!/var\s+href\s*=\s*'vyvent:/.test(preview));
    });

    test('produce byte-identical handoffs in production', () => {
        assert.deepEqual(
            resolveAppHandoff({ env: 'prod', appReturn: null, ...INVITATION_CALL }),
            resolveAppHandoff({ env: 'prod', appReturn: null, ...PREVIEW_CALL }),
        );
        const out = resolveAppHandoff({ env: 'prod', appReturn: null, ...INVITATION_CALL });
        assert.equal(out.href, 'vyvent://e/' + EVENT + '?code=' + CODE);
        assert.equal(out.open, true);
    });

    test('produce byte-identical handoffs on the DEV mirror', () => {
        const appReturn = 'exp://192.168.1.10:8081/--/e/' + EVENT;
        assert.deepEqual(
            resolveAppHandoff({ env: 'dev', appReturn, ...INVITATION_CALL }),
            resolveAppHandoff({ env: 'dev', appReturn, ...PREVIEW_CALL }),
        );
        const out = resolveAppHandoff({ env: 'dev', appReturn, ...INVITATION_CALL });
        assert.equal(out.href, appReturn + '?code=' + CODE);
        assert.equal(out.source, 'expo-go');
    });

    test('refuse identically on DEV without a validated return address', () => {
        // The 2026-07-18 guard: a DEV page must never emit `vyvent://`, which
        // would open the PRODUCTION app against the production database. It
        // applies to both families or to neither.
        for (const bad of [null, 'exp://192.168.1.10:8081',
            'exp://192.168.1.10:8081/--/e/' + EVENT + '?x=1']) {
            const a = resolveAppHandoff({ env: 'dev', appReturn: bad, ...INVITATION_CALL });
            const b = resolveAppHandoff({ env: 'dev', appReturn: bad, ...PREVIEW_CALL });
            assert.deepEqual(a, b);
            assert.equal(a.open, false);
            assert.equal(a.href, null);
            assert.equal(a.reason, 'expo-go-required');
        }
    });

    test('the code rides as a query parameter, never inside the route', () => {
        // The route names the EVENT; the code rides on top. A code baked into
        // the path would make the two families' routes diverge and would break
        // the same-event validation that reads them apart.
        const out = resolveAppHandoff({ env: 'prod', appReturn: null, ...INVITATION_CALL });
        const [route, query] = out.href.split('?');
        assert.equal(route, 'vyvent://e/' + EVENT);
        assert.equal(query, 'code=' + CODE);
        assert.ok(!route.includes(CODE));
    });

    test('a link with no code stays a plain event link in both families', () => {
        for (const call of [INVITATION_CALL, PREVIEW_CALL]) {
            const out = resolveAppHandoff({
                env: 'prod', appReturn: null, ...call, code: null,
            });
            assert.equal(out.href, 'vyvent://e/' + EVENT);
            assert.ok(!out.href.includes('code'));
        }
    });

    test('both name the event from the SERVER payload, not from the URL', () => {
        // invitation/: the id comes from the published payload, so a
        // hand-edited slug/code pair cannot ride the handoff into another
        // event. 404.html: likewise from the resolved event.
        const main = stripComments(readFileSync(join(ROOT, 'invitation', 'js', 'main.js'), 'utf8'));
        assert.match(main, /function passHandoff\(route, eventId\)/);
        assert.match(main, /id:\s*eventId/);
        const other = '8a900000-0000-4000-8000-000000000009';
        assert.notEqual(
            resolveAppHandoff({ env: 'prod', appReturn: null, ...INVITATION_CALL }).href,
            resolveAppHandoff({ env: 'prod', appReturn: null, ...INVITATION_CALL, id: other }).href,
        );
    });

    test('neither page redeems, copies or previews the code by itself', () => {
        // The web stays read-only: it forwards a credential and never spends
        // it. Redemption is the app's, behind a deliberate press.
        const preview = readFileSync(join(ROOT, '404.html'), 'utf8');
        const main = stripComments(readFileSync(join(ROOT, 'invitation', 'js', 'main.js'), 'utf8'));
        for (const src of [preview, main]) {
            for (const rpc of ['peek_smart_invitation', 'claim_smart_invitation']) {
                assert.ok(!src.includes(rpc), 'a web page references ' + rpc);
            }
        }
    });
});
