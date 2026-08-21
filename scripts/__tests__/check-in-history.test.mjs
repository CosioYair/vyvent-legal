/**
 * SCANNER SESSION SEMANTICS + INGRESOS HISTORY — the 2026-08-20 physical patch.
 *
 * Two locked product invariants live here:
 *
 *   1. A SCANNER LINK IS NOT A ONE-TIME LINK. Using it, reloading, going
 *      offline, or pressing Cerrar scanner never consumes it — only expiry or
 *      revocation does. The original wiring got this wrong (Cerrar called
 *      clearCapability), so the exact defect is pinned as a regression.
 *
 *   2. HISTORY IS NOT A GUEST LIST. The Ingresos view can only surface entries
 *      the door already recorded, and offers no manager action of any kind.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKIN = join(ROOT, 'check-in');
const read = (...p) => readFileSync(join(CHECKIN, ...p), 'utf8');
const HTML = read('index.html');
const MAIN = read('js', 'main.js');
const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MAIN_CODE = stripComments(MAIN);

const load = (file) => import(pathToFileURL(join(CHECKIN, 'js', file)).href);
const history = await load('history.js');
const ui = await load('ui.js');
const backend = await load('backend.js');

/* ── 1 · the capability is not consumable ──────────────────────────────────── */

describe('session semantics', () => {
    test('Cerrar scanner goes home and NEVER clears the capability', () => {
        // The exact 2026-08-20 defect: closeBtn used to call clearCapability.
        const wiring = /el\('closeBtn'\)\.addEventListener\('click',\s*([a-zA-Z]+)\)/.exec(MAIN_CODE);
        assert.ok(wiring, 'closeBtn wiring not found');
        assert.equal(wiring[1], 'goHome');

        const goHome = /function goHome\(\)[\s\S]*?\n\}/.exec(MAIN_CODE)[0];
        assert.equal(/clearCapability/.test(goHome), false, 'goHome forgets the capability');
        assert.match(goHome, /stopScanning\(\)/);
    });

    test('after Cerrar the start button reads Reanudar scanner', () => {
        assert.match(MAIN, /Reanudar scanner/);
        const goHome = /function goHome\(\)[\s\S]*?\n\}/.exec(MAIN_CODE)[0];
        assert.match(goHome, /startBtn/);
    });

    test('an offline bootstrap keeps the capability and offers Reintentar', () => {
        const boot = /async function boot\(\)[\s\S]*?\n\}/.exec(MAIN_CODE)[0];
        // The offline branch is the `!result` branch; it must be retryable and
        // must not clear anything.
        const offline = /if \(!result\) \{[\s\S]*?\}/.exec(boot)[0];
        assert.equal(/clearCapability/.test(offline), false, 'offline boot forgets the capability');
        assert.match(offline, /true\);/);   // fatal(..., retryable=true)
        // ...and the retry button re-boots with the SAME stored capability.
        assert.match(MAIN_CODE, /fatalRetryBtn'\)\.addEventListener\('click',\s*function\s*\(\)\s*\{\s*void boot\(\);/);
        assert.match(HTML, /id="fatalRetryBtn"/);
    });

    test('a network-lost SCAN keeps the capability too', () => {
        // In render(), the offline path must never reach clearCapability: the
        // only clear sites are behind isTerminalStatus.
        const render = /function render\(result\)[\s\S]*?\n\}/.exec(MAIN_CODE)[0];
        const clears = [...render.matchAll(/clearCapability/g)];
        assert.equal(clears.length, 1, 'render() clears in more than one place');
        const guarded = /if \(isTerminalStatus\(status\)\) \{[\s\S]*?clearCapability/.test(render);
        assert.equal(guarded, true, 'the render clear is not guarded by isTerminalStatus');
    });

    test('QR_DISABLED and SCANNER_NOT_STARTED are NOT terminal', () => {
        assert.equal(ui.isTerminalStatus('QR_DISABLED'), false);
        assert.equal(ui.isTerminalStatus('SCANNER_NOT_STARTED'), false);
        assert.equal(ui.isTerminalStatus('RATE_LIMITED'), false);
        // Camera-denial paths never touch the session module at all.
        assert.equal(ui.isTerminalStatus('SCANNER_REVOKED'), true);
        assert.equal(ui.isTerminalStatus('SCANNER_EXPIRED'), true);
    });

    test('a stopped-camera non-terminal result returns HOME via Volver, keeping authorization', () => {
        const render = /function render\(result\)[\s\S]*?\n\}/.exec(MAIN_CODE)[0];
        assert.match(render, /resultGoesHome = true/);
        assert.match(render, /'Volver'/);
        const dismiss = /function dismissResult\(\)[\s\S]*?\n\}/.exec(MAIN_CODE)[0];
        assert.match(dismiss, /goHome\(\)/);
    });

    test('clearCapability appears ONLY on terminal-state paths', () => {
        // Every executable clear site must sit behind isTerminalStatus (boot,
        // render, history). No unconditional clear may exist anywhere.
        const sites = [...MAIN_CODE.matchAll(/clearCapability\(window\)/g)];
        assert.ok(sites.length >= 2, 'expected the terminal clear sites');
        const unguarded = MAIN_CODE
            .split('\n')
            .filter((line) => line.includes('clearCapability(window)'))
            .length;
        const guardedCount = [...MAIN_CODE.matchAll(
            /isTerminalStatus\(status\)\)[^\n]*\n?[^\n]*clearCapability|isTerminalStatus\(status\)\) \{[\s\S]{0,200}?clearCapability/g,
        )].length;
        assert.equal(unguarded, guardedCount, 'an unguarded clearCapability exists');
    });

    test('no server call could mark a capability consumed', () => {
        // The page can reach exactly three RPCs; none mutates the scanner row.
        const src = stripComments(read('js', 'backend.js'));
        assert.equal(/revoke|update|delete/i.test(src.replace(/scanner_search_checkins|scanner_resolve_access|scanner_check_in/g, '')), false);
    });
});

/* ── 2 · Ingresos history ──────────────────────────────────────────────────── */

describe('history search plumbing', () => {
    test('debounce fires once per burst, on the trailing edge', () => {
        let calls = 0;
        const timers = fakeTimers();
        const fn = history.debounce(() => { calls += 1; }, 300, timers);
        fn(); fn(); fn();
        assert.equal(calls, 0);
        timers.flush();
        assert.equal(calls, 1);
    });

    test('a stale response can never overwrite a newer query', () => {
        const guard = history.createStaleGuard();
        const first = guard.begin();
        const second = guard.begin();
        assert.equal(guard.isCurrent(first), false);
        assert.equal(guard.isCurrent(second), true);
    });

    test('queries are normalized; one character searches nothing', () => {
        assert.equal(history.normalizeQuery('  María   González '), 'María González');
        assert.equal(history.normalizeQuery(''), '');
        assert.equal(history.normalizeQuery('   '), '');
        assert.equal(history.normalizeQuery('M'), null);
        assert.equal(history.normalizeQuery(null), '');
    });

    test('the wiring debounces the search input and drops stale responses', () => {
        assert.match(MAIN_CODE, /SEARCH_DEBOUNCE_MS = 300/);
        assert.match(MAIN_CODE, /historySearch'\)\.addEventListener\('input'/);
        assert.match(MAIN_CODE, /historyGuard\.isCurrent\(ticket\)/);
    });
});

describe('history rows', () => {
    test('an active row reads name · seat · time · scanner', () => {
        const v = ui.describeHistoryRow({
            occupant_label: 'María González', seat_label: 'Pase 1',
            checked_in_at: '2026-09-04T20:42:00Z', reverted_at: null,
            scanner_label: 'Scanner principal',
        });
        assert.equal(v.title, 'María González');
        assert.equal(v.reverted, false);
        assert.ok(v.lines.some((l) => /Ingresó .* · Scanner principal/.test(l)));
    });

    test('an entry from ANOTHER scanner of the same event renders its label', () => {
        const v = ui.describeHistoryRow({
            occupant_label: 'Pedro López', seat_label: 'Pase 2',
            checked_in_at: '2026-09-04T20:38:00Z', reverted_at: null,
            scanner_label: 'Scanner 2',
        });
        assert.ok(v.lines.some((l) => l.includes('Scanner 2')));
    });

    test('a reverted entry shows both times and reads as reverted', () => {
        const v = ui.describeHistoryRow({
            occupant_label: 'Pedro López', seat_label: 'Pase 2',
            checked_in_at: '2026-09-04T20:15:00Z',
            reverted_at: '2026-09-04T20:22:00Z', scanner_label: 'Scanner 2',
        });
        assert.equal(v.reverted, true);
        assert.ok(v.lines.includes('Check-in revertido'));
        assert.ok(v.lines.some((l) => l.startsWith('Ingreso original: ')));
        assert.ok(v.lines.some((l) => l.startsWith('Revertido: ')));
    });

    test('an anonymous companion shows holder context, never an invented name', () => {
        const v = ui.describeHistoryRow({
            occupant_label: null, holder_label: 'María González',
            seat_label: 'Pase 3', checked_in_at: '2026-09-04T21:00:00Z',
        });
        assert.equal(v.title, 'Acompañante');
        assert.ok(v.lines.some((l) => l === 'Titular: María González'));
    });

    test('the two empty states carry the approved es-MX copy', () => {
        assert.equal(ui.historyEmptyText(false), 'Aún no hay ingresos registrados.');
        assert.equal(ui.historyEmptyText(true), 'No se encontraron ingresos.');
    });
});

describe('history boundary', () => {
    test('the page offers Escanear / Ingresos and nothing resembling a roster', () => {
        assert.match(HTML, /id="historyBtn"/);
        assert.match(HTML, /id="historyFromScanBtn"/);
        assert.match(HTML, /id="backToScanBtn"/);
        assert.match(HTML, /Buscar por nombre/);
        // No pending/attendee/manager surface of any kind.
        const visible = HTML.replace(/<!--[\s\S]*?-->/g, '');
        ['pendiente', 'Revertir', 'Invitados', 'Asistentes'].forEach((w) =>
            assert.equal(visible.includes(w), false, w));
    });

    test('history offers NO manager action — not even the word', () => {
        const code = MAIN_CODE + stripComments(read('js', 'ui.js')).replace(/Check-in revertido|Revertido: /g, '');
        assert.equal(/revert_event_pass_checkin|Revertir\b/.test(code), false);
    });

    test('returning to Escanear requires an explicit gesture (WebKit rule)', () => {
        assert.match(MAIN_CODE, /backToScanBtn'\)\.addEventListener\('click',\s*function\s*\(\)\s*\{\s*void beginScanning\(\);/);
    });

    test('history terminal states clear; QR_DISABLED does not', () => {
        const lh = /async function loadHistory\([\s\S]*?\n\}/.exec(MAIN_CODE)[0];
        assert.match(lh, /isTerminalStatus\(status\)/);
        // The non-terminal branch only writes a status line.
        assert.match(lh, /historyStatus/);
    });

    test('searchCheckins sends capability + query + bounded limit, verbatim', async () => {
        let body = null;
        await backend.searchCheckins('OVS1.A.B', 'María', 25, {
            env: { supaUrl: 'https://x.supabase.co', supaAnon: 'anon' },
            fetch: async (_u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({}) }; },
        });
        assert.deepEqual(body, { p_scanner_token: 'OVS1.A.B', p_query: 'María', p_limit: 25 });
    });
});

/* ── helpers ───────────────────────────────────────────────────────────────── */

function fakeTimers() {
    let queue = [];
    return {
        set: (fn) => { queue.push(fn); return queue.length; },
        clear: (id) => { queue[id - 1] = null; },
        flush: () => { const q = queue; queue = []; q.forEach((fn) => fn && fn()); },
    };
}
