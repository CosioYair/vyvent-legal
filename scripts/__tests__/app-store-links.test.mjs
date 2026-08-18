/**
 * Tests for the app-distribution module — the smart "Abrir Orbiventt" CTA.
 *
 *   node --test scripts/__tests__/
 *
 * These load `app-store-links.js` itself through its CommonJS export, so
 * nothing here can pass against a copy that has drifted from the file GitHub
 * Pages serves.
 *
 * The property under test is a pair that pulls in opposite directions:
 *
 *   • A guest WITHOUT Orbiventt must always reach the right store. No dead end.
 *   • A guest WITH Orbiventt must NEVER be sent to the store — not while the
 *     app is opening, not when they come back from it, and not because they
 *     tapped twice.
 *
 * The second is the one a naive `setTimeout(store, 1000)` fails, so most of what
 * is asserted below is cancellation rather than redirection.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINKS = require(join(ROOT, 'app-store-links.js'));
const {
  STORE, ANDROID_PACKAGE, APP_SCHEME, FALLBACK_MS, SUSPEND_SLACK_MS,
  detectPlatform, storeUrlFor, isMobilePlatform, androidIntentUrl, smartOpen,
} = LINKS;

const PLAY = 'https://play.google.com/store/apps/details?id=com.vyvent.mobile';
const APPSTORE = 'https://apps.apple.com/app/id6788249586';

const EVENT_ID = '441dbd01-0b92-44f9-b29c-203179af64d2';
const CODE = 'PTQVTK6KSF6W';
/** Exactly what app-return.js produces in production for a pass link. */
const APP_HREF = `vyvent://e/${EVENT_ID}?code=${CODE}`;

const installed = (over = {}) => ({
  open: true, href: APP_HREF, source: 'app-scheme', reason: null, ...over,
});

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  ipad13: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  androidWhatsApp: 'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
};

/* ── A browser just real enough ─────────────────────────────────────────────
 * A hand-built window/document so the lifecycle can be driven deterministically:
 * timers fire when the test says so, the clock advances when the test says so,
 * and every navigation is recorded instead of performed. `listenerCount()` is
 * what proves cleanup actually happened rather than merely being intended. */
function makeBrowser({ userAgent = UA.iphone, hasTouch = false, start = 1_000_000 } = {}) {
  let clock = start;
  let nextTimer = 1;
  const timers = new Map();
  const navigations = [];
  const listeners = { window: new Map(), document: new Map() };

  const registrar = (bag) => ({
    addEventListener(type, fn) {
      if (!bag.has(type)) bag.set(type, []);
      bag.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = bag.get(type);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
  });

  const doc = {
    hidden: false,
    // The touch probe app-store-links.js uses to tell an iPad from a Mac.
    ...(hasTouch ? { ontouchend: null } : {}),
    ...registrar(listeners.document),
  };

  const win = {
    navigator: { userAgent },
    document: doc,
    location: {
      _href: 'https://orbiventt.com/invitation/',
      get href() { return this._href; },
      set href(v) { this._href = v; navigations.push(v); },
    },
    setTimeout(fn, ms) {
      const id = nextTimer++;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    ...registrar(listeners.window),
  };

  return {
    win,
    doc,
    navigations,
    now: () => clock,
    advance(ms) { clock += ms; },
    /** Run every timer whose deadline has passed. */
    runDueTimers() {
      for (const [id, t] of [...timers.entries()]) {
        if (t.at <= clock) { timers.delete(id); t.fn(); }
      }
    },
    pendingTimers() { return timers.size; },
    fire(target, type) {
      const bag = target === 'window' ? listeners.window : listeners.document;
      for (const fn of [...(bag.get(type) || [])]) fn();
    },
    listenerCount() {
      let n = 0;
      for (const bag of [listeners.window, listeners.document]) {
        for (const list of bag.values()) n += list.length;
      }
      return n;
    },
  };
}

/** A minimal anchor that records its single click listener. */
function makeAnchor() {
  const handlers = [];
  let prevented = 0;
  return {
    addEventListener(type, fn) { if (type === 'click') handlers.push(fn); },
    handlerCount() { return handlers.length; },
    preventedCount() { return prevented; },
    click() {
      const event = { preventDefault() { prevented += 1; } };
      for (const fn of [...handlers]) fn(event);
    },
  };
}

function planFor(browser, over = {}) {
  return smartOpen(installed(over.handoff), {
    window: browser.win,
    document: browser.doc,
    navigator: browser.win.navigator,
    now: browser.now,
    ...over.env,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The canonical listings
// ─────────────────────────────────────────────────────────────────────────────
describe('canonical store URLs', () => {
  test('are exactly the two verified Orbiventt listings', () => {
    assert.equal(STORE.PLAY_STORE_URL, PLAY);
    assert.equal(STORE.APP_STORE_URL, APPSTORE);
  });

  test('the Android package matches the signed application id', () => {
    assert.equal(ANDROID_PACKAGE, 'com.vyvent.mobile');
    assert.equal(APP_SCHEME, 'vyvent');
  });

  test('every platform resolves to a listing, and iOS is never sent to Google Play', () => {
    assert.equal(storeUrlFor('ios'), APPSTORE);
    assert.equal(storeUrlFor('mac'), APPSTORE);
    assert.equal(storeUrlFor('android'), PLAY);
    assert.equal(storeUrlFor('desktop'), PLAY);
    for (const p of ['ios', 'mac', 'android', 'desktop']) {
      assert.ok(/^https:\/\//.test(storeUrlFor(p)), `${p} store URL is not https`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────
describe('platform detection', () => {
  test('classifies the real user agents', () => {
    assert.equal(detectPlatform(UA.iphone, false), 'ios');
    assert.equal(detectPlatform(UA.ipadOld, true), 'ios');
    assert.equal(detectPlatform(UA.android, false), 'android');
    assert.equal(detectPlatform(UA.androidWhatsApp, false), 'android');
    assert.equal(detectPlatform(UA.mac, false), 'mac');
    assert.equal(detectPlatform(UA.windows, false), 'desktop');
  });

  test('an iPadOS 13+ desktop user agent is iOS only when it can touch', () => {
    assert.equal(detectPlatform(UA.ipad13, true), 'ios');
    assert.equal(detectPlatform(UA.ipad13, false), 'mac');
  });

  test('a missing or nonsense user agent degrades to desktop, never to a scheme loop', () => {
    for (const ua of [undefined, null, '', 42, {}]) {
      assert.equal(detectPlatform(ua, false), 'desktop');
    }
  });

  test('only phones and tablets count as mobile', () => {
    assert.equal(isMobilePlatform('ios'), true);
    assert.equal(isMobilePlatform('android'), true);
    assert.equal(isMobilePlatform('mac'), false);
    assert.equal(isMobilePlatform('desktop'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Android — the intent URL IS the fallback mechanism
// ─────────────────────────────────────────────────────────────────────────────
describe('Android · intent URL construction', () => {
  test('carries the route, the code, the package and the Play fallback', () => {
    const url = androidIntentUrl(APP_HREF, PLAY);
    assert.ok(url.startsWith(`intent://e/${EVENT_ID}?code=${CODE}#Intent;`));
    assert.ok(url.includes(';scheme=vyvent;'));
    assert.ok(url.includes(';package=com.vyvent.mobile;'));
    assert.ok(url.endsWith(';end'));
  });

  test('the fallback is percent-encoded so its own syntax cannot leak into the extras', () => {
    const url = androidIntentUrl(APP_HREF, PLAY);
    assert.ok(url.includes(`S.browser_fallback_url=${encodeURIComponent(PLAY)}`));
    // The encoded form must not reintroduce a delimiter.
    const extras = url.slice(url.indexOf('#Intent;'));
    assert.equal(extras.split(';').filter((s) => s.startsWith('S.browser_fallback_url=')).length, 1);
    assert.ok(!encodeURIComponent(PLAY).includes(';'));
  });

  test('the invitation code survives verbatim and reaches nothing but the intent', () => {
    const url = androidIntentUrl(APP_HREF, PLAY);
    assert.ok(url.includes(`code=${CODE}`));
    // The store fallback is the bare listing — the code is never appended to it.
    const fallback = decodeURIComponent(/S\.browser_fallback_url=([^;]*)/.exec(url)[1]);
    assert.equal(fallback, PLAY);
    assert.ok(!fallback.includes(CODE));
  });

  test('a chat sub-route and a code-less link are wrapped just as faithfully', () => {
    assert.ok(androidIntentUrl(`vyvent://e/${EVENT_ID}/chat`, PLAY)
      .startsWith(`intent://e/${EVENT_ID}/chat#Intent;`));
    assert.ok(androidIntentUrl(`vyvent://e/${EVENT_ID}`, PLAY)
      .startsWith(`intent://e/${EVENT_ID}#Intent;`));
  });

  test('FAILS CLOSED rather than emitting a malformed intent', () => {
    const bad = [
      // Not the app's scheme — we do not know any other app's package.
      [`exp://192.168.1.42:8081/--/e/${EVENT_ID}`, PLAY],
      ['https://orbiventt.com/e/x', PLAY],
      ['javascript://x', PLAY],
      // A fragment would terminate the payload and start the extras early.
      [`vyvent://e/${EVENT_ID}#Intent;package=com.evil.app;end`, PLAY],
      // A `;` in the payload would be read as a new extra.
      [`vyvent://e/${EVENT_ID};package=com.evil.app`, PLAY],
      // Empty payload.
      ['vyvent://', PLAY],
      // A fallback that is not an https URL.
      [APP_HREF, 'http://orbiventt.com'],
      [APP_HREF, 'javascript:alert(1)'],
      // Wrong types.
      [null, PLAY], [APP_HREF, null], [undefined, undefined],
    ];
    for (const [href, fallback] of bad) {
      assert.equal(androidIntentUrl(href, fallback), null,
        `expected null for ${String(href)} / ${String(fallback)}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The plan each device gets
// ─────────────────────────────────────────────────────────────────────────────
describe('smartOpen · the per-device plan', () => {
  test('Android gets the intent URL, and the browser owns the fallback', () => {
    const b = makeBrowser({ userAgent: UA.android });
    const plan = planFor(b);
    assert.equal(plan.strategy, 'android-intent');
    assert.equal(plan.platform, 'android');
    assert.equal(plan.storeUrl, PLAY);
    assert.equal(plan.href, androidIntentUrl(APP_HREF, PLAY));
  });

  test('iOS keeps the custom scheme verbatim and points at the App Store', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const plan = planFor(b);
    assert.equal(plan.strategy, 'ios-scheme-fallback');
    assert.equal(plan.href, APP_HREF, 'iOS must open the app with the untouched deep link');
    assert.equal(plan.storeUrl, APPSTORE);
  });

  test('desktop goes straight to a store — no scheme, no timer, no dead end', () => {
    for (const [ua, store] of [[UA.windows, PLAY], [UA.mac, APPSTORE]]) {
      const plan = planFor(makeBrowser({ userAgent: ua }));
      assert.equal(plan.strategy, 'store-direct');
      assert.equal(plan.href, store);
      assert.ok(!plan.href.startsWith('vyvent://'));
    }
  });

  test('the invitation context and code survive into every mobile plan', () => {
    for (const ua of [UA.android, UA.iphone]) {
      const plan = planFor(makeBrowser({ userAgent: ua }));
      assert.ok(plan.href.includes(EVENT_ID), `${ua}: lost the event id`);
      assert.ok(plan.href.includes(`code=${CODE}`), `${ua}: lost the invitation code`);
    }
  });

  test('the DEV Expo Go handoff is never touched — null, so the card keeps today’s link', () => {
    const b = makeBrowser({ userAgent: UA.android });
    const expoGo = {
      open: true,
      href: `exp://192.168.1.42:8081/--/e/${EVENT_ID}?code=${CODE}`,
      source: 'expo-go',
      reason: null,
    };
    assert.equal(smartOpen(expoGo, { window: b.win, document: b.doc, navigator: b.win.navigator }), null);
  });

  test('a closed or absent handoff produces no plan at all', () => {
    const b = makeBrowser();
    const env = { window: b.win, document: b.doc, navigator: b.win.navigator };
    for (const h of [
      null,
      undefined,
      { open: false, href: null, source: 'none', reason: 'expo-go-required' },
      { open: true, href: '', source: 'app-scheme' },
      { open: true, href: APP_HREF, source: 'none' },
    ]) {
      assert.equal(smartOpen(h, env), null);
    }
  });

  test('without a window or document there is no plan — never a half-wired one', () => {
    assert.equal(smartOpen(installed(), {}), null);
    assert.equal(smartOpen(installed(), { window: null, document: null }), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The lifecycle — where "installed" must never mean "store"
// ─────────────────────────────────────────────────────────────────────────────
describe('arm() · the guarded fallback', () => {
  test('desktop arms nothing: no listeners, no timers, the href IS the answer', () => {
    const b = makeBrowser({ userAgent: UA.windows });
    const a = makeAnchor();
    planFor(b).arm(a);
    assert.equal(a.handlerCount(), 0);
    assert.equal(b.listenerCount(), 0);
    assert.equal(b.pendingTimers(), 0);
  });

  test('iOS · app NOT installed → the App Store, once the deadline passes', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);

    a.click();
    assert.deepEqual(b.navigations, [APP_HREF], 'the scheme must be attempted first');

    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF, APPSTORE]);
    assert.equal(b.listenerCount(), 0, 'listeners outlived the fallback');
    assert.equal(b.pendingTimers(), 0);
  });

  test('iOS · app INSTALLED → the page goes hidden and the store is never reached', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);

    a.click();
    // Orbiventt takes over.
    b.doc.hidden = true;
    b.fire('document', 'visibilitychange');

    assert.equal(b.pendingTimers(), 0, 'the timer survived the app opening');
    assert.equal(b.listenerCount(), 0);

    // The guest spends a while in the app and comes back.
    b.advance(30_000);
    b.doc.hidden = false;
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF], 'returning from the app opened the store');
  });

  test('`pagehide` cancels on its own — it means the page really went away', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();
    b.fire('window', 'pagehide');
    assert.equal(b.pendingTimers(), 0, 'pagehide did not cancel the fallback');
    b.advance(FALLBACK_MS * 4);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF], 'pagehide still let the store through');
  });

  /* ── THE 2026-08-18 PRODUCTION INCIDENT ─────────────────────────────────────
   * Reported from a real iPhone, in a Safari session that had never visited the
   * site — so not a cache artefact. Tap → Safari answers "la dirección no es
   * válida" → dismiss → nothing. The guest was stranded.
   *
   * Losing keyboard focus is NOT leaving. Safari blurs the page to present its
   * own native UI, and the invalid-address alert is exactly that. The old code
   * read that blur as "Orbiventt opened" and cancelled the fallback at the one
   * moment it was needed. */
  test('plain `blur` is NOT proof the app opened — the fallback survives it', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);

    a.click();
    b.fire('window', 'blur');                     // Safari's native alert takes focus

    assert.equal(b.pendingTimers(), 1, 'blur cancelled the fallback — the incident');
    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF, APPSTORE],
      'a blurred page never reached the App Store');
  });

  test('`visibilitychange` with hidden cancels — that IS departure', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();
    b.doc.hidden = true;
    b.fire('document', 'visibilitychange');
    assert.equal(b.pendingTimers(), 0);
    b.advance(FALLBACK_MS * 4);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF]);
  });

  /* A visible page whose visibility never changed did not lose the foreground,
   * so `visibilitychange` alone must not cancel anything. */
  test('a visibilitychange that reports VISIBLE leaves the fallback armed', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();
    b.doc.hidden = false;
    b.fire('document', 'visibilitychange');
    assert.equal(b.pendingTimers(), 1);
    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF, APPSTORE]);
  });

  test('a timer that fires while hidden cancels — the visit is happening in the app', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();
    // The page went away WITHOUT any event this browser chose to deliver.
    b.doc.hidden = true;
    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF]);
  });

  /* THE SECOND HALF OF THE SAME INCIDENT, and it would have survived a
   * blur-only fix. A native alert blocks the run loop, so the timer cannot fire
   * until the guest dismisses it — which can take as long as they like. The old
   * code cancelled on wall-clock lateness, reading a slow dismissal as a
   * returning visitor. Lateness is not evidence; DEPARTURE is. */
  test('a fallback delayed by a blocked run loop still runs when execution resumes', () => {
    for (const delay of [FALLBACK_MS + 1, 5_000, 60_000]) {
      const b = makeBrowser({ userAgent: UA.iphone });
      const a = makeAnchor();
      planFor(b).arm(a);
      a.click();

      b.advance(delay);          // JS could not run; the page never went away
      b.runDueTimers();

      assert.deepEqual(b.navigations, [APP_HREF, APPSTORE],
        `a ${delay}ms-late timer stranded the guest`);
    }
  });

  /* The mirror image, and the property the wall-clock guard used to protect:
   * once the page has actually departed, no amount of later execution may open
   * a store behind the app. `everHidden` carries that across the gap. */
  test('once the page has departed, a later timer can never open the store', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();

    b.doc.hidden = true;
    b.fire('document', 'visibilitychange');   // Orbiventt opened
    b.advance(120_000);
    b.doc.hidden = false;                     // the guest comes back much later
    b.fire('document', 'visibilitychange');
    b.runDueTimers();

    assert.deepEqual(b.navigations, [APP_HREF], 'the store opened behind a working app');
    assert.equal(b.pendingTimers(), 0);
    assert.equal(b.listenerCount(), 0);
  });

  test('a timer that fires while hidden cancels — the visit is happening in the app', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();
    // The page went away WITHOUT any event this browser chose to deliver.
    b.doc.hidden = true;
    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF]);
  });

  /* The retired wall-clock slack. Kept as an explicit assertion so nobody
   * reintroduces a timing proxy for departure. */
  test('there is no wall-clock slack left — lateness alone decides nothing', () => {
    assert.equal(SUSPEND_SLACK_MS, 0);
  });

  test('a browser that refuses the scheme outright reaches the store immediately', () => {
    const b = makeBrowser({ userAgent: UA.android });
    Object.defineProperty(b.win.location, 'href', {
      set(v) {
        if (String(v).startsWith('intent://')) throw new Error('unsupported scheme');
        b.navigations.push(v);
      },
      get() { return 'https://orbiventt.com/invitation/'; },
      configurable: true,
    });

    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();

    assert.deepEqual(b.navigations, [PLAY]);
    assert.equal(b.pendingTimers(), 0);
    assert.equal(b.listenerCount(), 0);
  });

  test('repeated taps arm exactly one fallback — no duplicate timers, listeners or store hits', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);

    a.click();
    a.click();
    a.click();

    assert.equal(a.handlerCount(), 1, 'more than one click handler was attached');
    assert.equal(b.pendingTimers(), 1, 'a repeated tap created a second timer');
    // Exactly the two DEPARTURE listeners — visibilitychange and pagehide.
    assert.equal(b.listenerCount(), 2, 'a repeated tap duplicated the lifecycle listeners');
    assert.deepEqual(b.navigations, [APP_HREF], 'a repeated tap navigated twice');
    assert.equal(a.preventedCount(), 3, 'every tap must be handled here, not by the browser');

    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF, APPSTORE], 'the store opened more than once');
  });

  test('after the app opened, a fresh tap may arm again', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    planFor(b).arm(a);

    a.click();
    b.doc.hidden = true;
    b.fire('document', 'visibilitychange');
    b.doc.hidden = false;

    a.click();
    assert.equal(b.pendingTimers(), 1);
    assert.deepEqual(b.navigations, [APP_HREF, APP_HREF]);
  });

  test('the returned disarm() cleans everything up and is idempotent', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    const disarm = planFor(b).arm(a);

    a.click();
    assert.equal(b.pendingTimers(), 1);

    disarm();
    disarm();
    assert.equal(b.pendingTimers(), 0);
    assert.equal(b.listenerCount(), 0);

    b.advance(FALLBACK_MS * 4);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [APP_HREF]);
  });

  /* The DEV harness drives `arm()` directly against a deliberately unreachable
   * target so a physical device can take the not-installed branch without
   * uninstalling the app. That entry point has to work standalone. */
  test('the exported arm() runs the same guarded fallback on a hand-built plan', () => {
    const b = makeBrowser({ userAgent: UA.iphone });
    const a = makeAnchor();
    const plan = { strategy: 'ios-scheme-fallback', href: 'vyventabsent://e/x', storeUrl: APPSTORE };

    LINKS.arm(a, plan, { window: b.win, document: b.doc, now: b.now });
    a.click();
    assert.deepEqual(b.navigations, ['vyventabsent://e/x']);

    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, ['vyventabsent://e/x', APPSTORE]);
    assert.equal(b.listenerCount(), 0);
  });

  test('arming is inert without a control or a usable plan', () => {
    const b = makeBrowser();
    const plan = planFor(b);
    assert.equal(typeof plan.arm(null), 'function');
    assert.equal(typeof plan.arm({}), 'function');
    assert.equal(b.listenerCount(), 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Android and desktop must come through the iOS fix untouched
// ─────────────────────────────────────────────────────────────────────────────
describe('the 2026-08-18 iOS fix changes nothing for Android or desktop', () => {
  test('Android still gets the intent URL, package and Play fallback', () => {
    const b = makeBrowser({ userAgent: UA.android });
    const plan = planFor(b);
    assert.equal(plan.strategy, 'android-intent');
    assert.equal(plan.href, androidIntentUrl(APP_HREF, PLAY));
    assert.ok(plan.href.includes(';package=com.vyvent.mobile;'));
    assert.ok(plan.href.includes(';scheme=vyvent;'));
    assert.ok(plan.href.includes('S.browser_fallback_url='));
    assert.equal(plan.storeUrl, PLAY);
  });

  /* Android's real fallback is the browser's, not ours. Our timer is only a
   * safety net for a WebView that ignores intent:// — and it must behave the
   * same way iOS now does: departure cancels, lateness does not. */
  test('Android · the safety-net timer follows the same departure rule', () => {
    const b = makeBrowser({ userAgent: UA.android });
    const a = makeAnchor();
    planFor(b).arm(a);
    a.click();
    b.fire('window', 'blur');                    // must NOT cancel
    b.advance(FALLBACK_MS);
    b.runDueTimers();
    assert.deepEqual(b.navigations, [androidIntentUrl(APP_HREF, PLAY), PLAY]);

    const c = makeBrowser({ userAgent: UA.android });
    const d = makeAnchor();
    planFor(c).arm(d);
    d.click();
    c.doc.hidden = true;
    c.fire('document', 'visibilitychange');      // must cancel
    c.advance(FALLBACK_MS * 4);
    c.runDueTimers();
    assert.deepEqual(c.navigations, [androidIntentUrl(APP_HREF, PLAY)]);
  });

  test('desktop still arms nothing and still points straight at a store', () => {
    for (const [ua, store] of [[UA.windows, PLAY], [UA.mac, APPSTORE]]) {
      const b = makeBrowser({ userAgent: ua });
      const a = makeAnchor();
      const plan = planFor(b);
      plan.arm(a);
      assert.equal(plan.strategy, 'store-direct');
      assert.equal(plan.href, store);
      assert.equal(a.handlerCount(), 0);
      assert.equal(b.listenerCount(), 0);
      assert.equal(b.pendingTimers(), 0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Privacy — the code goes to the app, and nowhere else
// ─────────────────────────────────────────────────────────────────────────────
describe('the invitation code never leaks', () => {
  test('the app deep link keeps the code on every mobile platform', () => {
    for (const ua of [UA.iphone, UA.android]) {
      const plan = planFor(makeBrowser({ userAgent: ua }));
      assert.ok(plan.href.includes(`code=${CODE}`), `${ua}: the deep link lost the code`);
      assert.ok(plan.href.includes(EVENT_ID), `${ua}: the deep link lost the destination`);
    }
  });

  test('no store navigation on any platform ever carries the code', () => {
    for (const ua of [UA.iphone, UA.android, UA.windows, UA.mac]) {
      const b = makeBrowser({ userAgent: ua });
      const a = makeAnchor();
      const plan = planFor(b);
      plan.arm(a);
      if (plan.strategy !== 'store-direct') {
        a.click();
        // Drive the failing-scheme path all the way to the store.
        b.fire('window', 'blur');
        b.advance(FALLBACK_MS);
        b.runDueTimers();
      }
      for (const nav of b.navigations) {
        if (nav.startsWith('vyvent://') || nav.startsWith('intent://')) continue;
        assert.ok(!nav.includes(CODE), `${ua}: the code reached ${nav}`);
      }
      assert.ok(!plan.storeUrl.includes(CODE));
    }
  });

  test('the module logs nothing — there is no console call in the file', () => {
    const source = require('node:fs')
      .readFileSync(join(ROOT, 'app-store-links.js'), 'utf8');
    assert.ok(!/\bconsole\s*\./.test(source), 'app-store-links.js reaches for console');
  });
});
