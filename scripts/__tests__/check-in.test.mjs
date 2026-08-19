/**
 * PUBLIC WEB SCANNER — contract tests.
 *
 *   node --test scripts/__tests__/
 *
 * The scanner is the one surface on this site that can let a stranger through a
 * door, so most of what is asserted here is a NEGATIVE: the capability never
 * reaches a query string, a log, or localStorage; a failure never carries a
 * name; the browser never decides validity. The positive behaviours (cooldown,
 * single-flight, nonce reuse) are pinned because each one is easy to "simplify"
 * into a real defect.
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

const { WEB_BUILD, SHARED_DIRS, DEV_SUPABASE_REF } = await import(
    pathToFileURL(join(ROOT, 'scripts', 'web-env.mjs')).href
);

const load = (file) => import(pathToFileURL(join(CHECKIN, 'js', file)).href);
const session = await load('session.js');
const decode = await load('decode.js');
const ui = await load('ui.js');
const camera = await load('camera.js');
const backend = await load('backend.js');

const CAP = 'OVS1.10HG5E4ABCDEFGHJ.ABCDEFGHJKMNPQRSTVWXYZ0123';
const PASS = 'OVP1:0DHJB3JZDSF2XCA5:DDV80FXP6YNNVS34';

/* ── Capability transport ──────────────────────────────────────────────────── */

describe('capability', () => {
    test('parses the capability from the fragment', () => {
        assert.equal(session.parseFragment(`#s=${CAP}`), CAP);
        assert.equal(session.parseFragment(`s=${CAP}`), CAP);
    });

    test('rejects a malformed or absent capability', () => {
        assert.equal(session.parseFragment('#s=nope'), null);
        assert.equal(session.parseFragment('#t=' + CAP), null);
        assert.equal(session.parseFragment(''), null);
        assert.equal(session.parseFragment(null), null);
    });

    test('NEVER accepts a capability from the query string', () => {
        // The whole point of the fragment is that it is not sent to a server.
        // A query string would put a live door credential in every access log.
        const win = fakeWindow({ search: `?s=${CAP}`, hash: '' });
        assert.equal(session.captureCapability(win), null);
    });

    test('persists to sessionStorage and strips the fragment from the URL', () => {
        const win = fakeWindow({ hash: `#s=${CAP}` });
        assert.equal(session.captureCapability(win), CAP);
        assert.equal(win.sessionStorage.store[session.STORAGE_KEY], CAP);
        assert.deepEqual(win.history.calls, [[null, '', '/vyvent-legal/check-in/']]);
    });

    test('recovers after a reload, once the fragment is gone', () => {
        const win = fakeWindow({ hash: '' });
        win.sessionStorage.store[session.STORAGE_KEY] = CAP;
        assert.equal(session.captureCapability(win), CAP);
    });

    test('refuses a corrupted stored value', () => {
        const win = fakeWindow({ hash: '' });
        win.sessionStorage.store[session.STORAGE_KEY] = 'garbage';
        assert.equal(session.captureCapability(win), null);
    });

    test('clearCapability forgets it', () => {
        const win = fakeWindow({ hash: `#s=${CAP}` });
        session.captureCapability(win);
        session.clearCapability(win);
        assert.equal(win.sessionStorage.store[session.STORAGE_KEY], undefined);
    });

    test('localStorage is never touched anywhere in the scanner', () => {
        for (const file of jsFiles()) {
            assert.equal(
                /localStorage/.test(stripComments(read('js', file))),
                false,
                `${file} references localStorage`,
            );
        }
    });

    test('the capability is never logged, anywhere', () => {
        for (const file of jsFiles()) {
            assert.equal(
                /console\.(log|warn|info|debug|error)/.test(stripComments(read('js', file))),
                false,
                `${file} contains a console call`,
            );
        }
    });

    test('a fresh nonce is a distinct uuid each time', () => {
        const a = session.newNonce();
        const b = session.newNonce();
        assert.match(a, /^[0-9a-f-]{36}$/);
        assert.notEqual(a, b);
    });
});

/* ── Decoding + scan gate ──────────────────────────────────────────────────── */

describe('decoder', () => {
    test('uses BarcodeDetector when it genuinely supports qr_code', async () => {
        class Detector {
            static async getSupportedFormats() { return ['qr_code']; }
            async detect() { return [{ rawValue: PASS }]; }
        }
        const d = await decode.createDecoder({ BarcodeDetector: Detector });
        assert.equal(d.kind, 'barcode-detector');
        assert.equal(await d.decode({}), PASS);
    });

    test('falls back to jsQR when BarcodeDetector cannot do qr_code', async () => {
        class Useless {
            static async getSupportedFormats() { return ['ean_13']; }
        }
        const d = await decode.createDecoder({
            BarcodeDetector: Useless,
            jsQR: () => ({ data: PASS }),
            createCanvas: fakeCanvas,
        });
        assert.equal(d.kind, 'jsqr');
        assert.equal(await d.decode({}, 100, 100), PASS);
    });

    test('falls back to jsQR when BarcodeDetector is absent — the iOS path', async () => {
        const d = await decode.createDecoder({
            jsQR: () => ({ data: PASS }),
            createCanvas: fakeCanvas,
        });
        assert.equal(d.kind, 'jsqr');
    });

    test('degrades to a no-op decoder rather than throwing', async () => {
        const d = await decode.createDecoder({});
        assert.equal(d.kind, 'none');
        assert.equal(await d.decode({}, 10, 10), null);
    });

    test('only Orbiventt pass shapes are ever submitted', () => {
        assert.equal(decode.isPassShape(PASS), true);
        assert.equal(decode.isPassShape('https://example.com'), false);
        assert.equal(decode.isPassShape(CAP), false);   // a capability is not a pass
        assert.equal(decode.isPassShape('OVP1:short:short'), false);
    });
});

describe('scan gate', () => {
    test('blocks the same payload inside the cooldown', () => {
        const gate = decode.createScanGate(3000);
        assert.equal(gate.accept(PASS, 1000), true);
        gate.end();
        assert.equal(gate.accept(PASS, 1500), false);
        assert.equal(gate.accept(PASS, 4500), true);
    });

    test('allows exactly one request in flight', () => {
        const gate = decode.createScanGate(3000);
        assert.equal(gate.accept(PASS, 0), true);
        gate.begin();
        assert.equal(gate.accept('OVP1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBB', 10), false);
        gate.end();
        assert.equal(gate.accept('OVP1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBB', 20), true);
    });

    test('reset lets the operator re-scan the same code deliberately', () => {
        const gate = decode.createScanGate(3000);
        gate.accept(PASS, 0);
        gate.end();
        gate.reset();
        assert.equal(gate.accept(PASS, 1), true);
    });

    test('the decode loop is bounded to roughly 8 attempts per second', () => {
        const ms = /DECODE_INTERVAL_MS\s*=\s*(\d+)/.exec(read('js', 'main.js'));
        assert.ok(ms, 'no decode interval declared');
        const rate = 1000 / Number(ms[1]);
        assert.ok(rate <= 12 && rate >= 4, `decode rate ${rate}/s is outside the intended band`);
    });
});

/* ── Result presentation ───────────────────────────────────────────────────── */

describe('results', () => {
    const IDENTITY = {
        occupant_label: 'Ana Ruiz',
        holder_label: 'María González',
        seat_label: 'Pase 2 de 3',
        checked_in_at: '2026-09-04T23:14:00Z',
    };

    test('CHECKED_IN succeeds, names the occupant, and auto-returns', () => {
        const v = ui.describeResult({ status: 'CHECKED_IN', ...IDENTITY });
        assert.equal(v.tone, 'ok');
        assert.equal(v.title, 'ACCESO REGISTRADO');
        assert.ok(v.lines.includes('Ana Ruiz'));
        assert.ok(v.autoDismissMs > 0 && v.autoDismissMs <= 1500);
        assert.equal(v.requiresContinue, false);
    });

    test('ALREADY_CHECKED_IN waits for a human — never auto-dismissed', () => {
        const v = ui.describeResult({ status: 'ALREADY_CHECKED_IN', ...IDENTITY });
        assert.equal(v.tone, 'warn');
        assert.equal(v.title, 'PASE YA UTILIZADO');
        assert.equal(v.autoDismissMs, null);
        assert.equal(v.requiresContinue, true);
        assert.match(v.detail, /Registrado a las/);
    });

    test('an anonymous companion gets holder context, not an invented name', () => {
        const v = ui.describeResult({
            status: 'CHECKED_IN', occupant_label: null,
            holder_label: 'María González', seat_label: 'Pase 2 de 3',
        });
        assert.ok(v.lines.includes('Acompañante'));
        assert.ok(v.lines.some((l) => l.includes('Titular: María González')));
    });

    test('NO failure status carries identity', () => {
        for (const status of [
            'INVALID_PASS', 'WRONG_EVENT', 'PASS_NOT_ELIGIBLE', 'QR_DISABLED',
            'SCANNER_NOT_STARTED', 'SCANNER_EXPIRED', 'SCANNER_REVOKED',
            'SCANNER_INVALID', 'RATE_LIMITED', 'INVALID_REQUEST',
        ]) {
            const v = ui.describeResult({ status, ...IDENTITY });
            assert.deepEqual(v.lines, [], `${status} leaked identity lines`);
            assert.equal(v.identity, false, `${status} claimed identity`);
            assert.equal(
                JSON.stringify(v).includes('Ana Ruiz') || JSON.stringify(v).includes('María'),
                false,
                `${status} leaked a name`,
            );
        }
    });

    test('WRONG_EVENT is actionable inside the authorized boundary', () => {
        const v = ui.describeResult({ status: 'WRONG_EVENT' });
        assert.match(v.detail, /otro evento/i);
        assert.equal(v.requiresContinue, true);
    });

    test('a lost response is OFFLINE and never a success', () => {
        const v = ui.describeResult(null);
        assert.equal(v.tone, 'offline');
        assert.match(v.detail, /Sin conexión\. No se puede validar el acceso\./);
        assert.equal(v.identity, false);
    });

    test('QR_DISABLED and terminal states stop the camera', () => {
        ['QR_DISABLED', 'SCANNER_REVOKED', 'SCANNER_EXPIRED', 'SCANNER_INVALID']
            .forEach((s) => assert.equal(ui.shouldStopCamera(s), true, s));
        ['CHECKED_IN', 'ALREADY_CHECKED_IN', 'INVALID_PASS', 'WRONG_EVENT']
            .forEach((s) => assert.equal(ui.shouldStopCamera(s), false, s));
    });

    test('only revoked/expired are terminal — they clear the session', () => {
        assert.equal(ui.isTerminalStatus('SCANNER_REVOKED'), true);
        assert.equal(ui.isTerminalStatus('SCANNER_EXPIRED'), true);
        assert.equal(ui.isTerminalStatus('QR_DISABLED'), false);
        assert.equal(ui.isTerminalStatus('CHECKED_IN'), false);
    });

    test('the counter uses SERVER values, or nothing at all', () => {
        assert.equal(ui.describeCounter({ event_checked_in: 87, event_pass_total: 150 }), '87 / 150 ingresos');
        assert.equal(ui.describeCounter({ event_checked_in: 87 }), null);
        assert.equal(ui.describeCounter(null), null);
    });
});

/* ── Nonce lifecycle in the wiring ─────────────────────────────────────────── */

describe('nonce lifecycle', () => {
    const MAIN = stripComments(read('js', 'main.js'));

    test('Reintentar resubmits WITHOUT minting a new nonce', () => {
        // The retry button must call submit() directly. Routing it through
        // frame()/newNonce() would turn a lost response into a false duplicate.
        assert.match(MAIN, /retryBtn'\)\.addEventListener\('click',\s*function\s*\(\)\s*\{\s*void submit\(\);/);
        const submitBody = /async function submit\(\)[\s\S]*?\n\}/.exec(MAIN)[0];
        assert.equal(/newNonce\(/.test(submitBody), false, 'submit() mints a nonce');
    });

    test('a new physical scan mints a fresh nonce', () => {
        const frameBody = /async function frame\(\)[\s\S]*?\n\}/.exec(MAIN)[0];
        assert.match(frameBody, /attemptNonce = newNonce\(\)/);
    });

    test('the attempt is only cleared once its outcome is resolved', () => {
        const dismiss = /function dismissResult\(\)[\s\S]*?\n\}/.exec(MAIN)[0];
        assert.match(dismiss, /attemptNonce = null/);
    });
});

/* ── Camera ────────────────────────────────────────────────────────────────── */

describe('camera', () => {
    test('never requests audio and prefers the rear camera', () => {
        const c = camera.cameraConstraints();
        assert.equal(c.audio, false);
        assert.deepEqual(c.video.facingMode, { ideal: 'environment' });
    });

    test('starts ONLY from an explicit user gesture', () => {
        const MAIN = stripComments(read('js', 'main.js'));
        assert.match(MAIN, /startBtn'\)\.addEventListener\('click'/);
        // No autostart: boot() must not begin scanning by itself.
        const bootBody = /async function boot\(\)[\s\S]*?\n\}/.exec(MAIN)[0];
        assert.equal(/beginScanning\(/.test(bootBody), false, 'boot() autostarts the camera');
    });

    test('every camera failure is recoverable, never a dead end', () => {
        for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'Whatever']) {
            const d = camera.describeCameraError({ name });
            assert.ok(d.title && d.body, name);
        }
        assert.equal(camera.describeCameraError({ name: 'NotAllowedError' }).code, 'denied');
    });

    test('stopCamera releases every track and detaches the element', () => {
        let stopped = 0;
        const video = {};
        camera.stopCamera({ getTracks: () => [{ stop: () => { stopped += 1; } }, { stop: () => { stopped += 1; } }] }, video);
        assert.equal(stopped, 2);
        assert.equal(video.srcObject, null);
    });

    test('the camera stops on DEPARTURE, never on blur', () => {
        const MAIN = stripComments(read('js', 'main.js'));
        assert.match(MAIN, /visibilitychange/);
        assert.match(MAIN, /pagehide/);
        assert.equal(/'blur'/.test(MAIN), false, 'blur is treated as departure');
    });
});

/* ── Backend surface ───────────────────────────────────────────────────────── */

describe('backend', () => {
    test('the RPC allowlist is closed to exactly the two scanner functions', async () => {
        const calls = [];
        const fetchStub = async (url) => { calls.push(url); return { ok: true, json: async () => ({ ok: 1 }) }; };
        const env = { supaUrl: 'https://x.supabase.co', supaAnon: 'anon' };

        assert.notEqual(await backend.callRpc('scanner_resolve_access', {}, { fetch: fetchStub, env }), null);
        assert.notEqual(await backend.callRpc('scanner_check_in', {}, { fetch: fetchStub, env }), null);
        // Anything else is refused WITHOUT a request being made.
        for (const forbidden of [
            'get_event_checkin_summary', 'revert_event_pass_checkin', 'get_my_event_passes',
            'get_event_scanner_accesses', 'get_published_invitation',
        ]) {
            assert.equal(await backend.callRpc(forbidden, {}, { fetch: fetchStub, env }), null, forbidden);
        }
        assert.equal(calls.length, 2);
    });

    test('there is no guest-list endpoint of any kind', () => {
        const src = read('js', 'backend.js');
        ['attendee', 'guest', 'invited', 'roster'].forEach((w) =>
            assert.equal(new RegExp(w, 'i').test(stripComments(src)), false, w));
    });

    test('fails closed with no env, a network error, or a non-2xx', async () => {
        assert.equal(await backend.callRpc('scanner_check_in', {}, { env: {}, fetch: async () => ({}) }), null);
        const env = { supaUrl: 'https://x.supabase.co', supaAnon: 'anon' };
        assert.equal(await backend.callRpc('scanner_check_in', {}, {
            env, fetch: async () => { throw new Error('offline'); },
        }), null);
        assert.equal(await backend.callRpc('scanner_check_in', {}, {
            env, fetch: async () => ({ ok: false }),
        }), null);
    });

    test('sends the nonce the caller supplied, verbatim', async () => {
        let body = null;
        await backend.checkIn(CAP, PASS, 'NONCE-1', {
            env: { supaUrl: 'https://x.supabase.co', supaAnon: 'anon' },
            fetch: async (_u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({}) }; },
        });
        assert.deepEqual(body, { p_scanner_token: CAP, p_pass_token: PASS, p_nonce: 'NONCE-1' });
    });
});

/* ── Page security + build participation ───────────────────────────────────── */

describe('page', () => {
    test('declares a CSP with no CDN and only the deployment Supabase host', () => {
        const csp = /content="([^"]*default-src[^"]*)"/.exec(HTML)[1];
        assert.match(csp, /script-src 'self'/);
        assert.equal(/unsafe-inline/.test(csp.split('style-src')[0]), false);
        assert.match(csp, new RegExp(`connect-src https://${DEV_SUPABASE_REF}\\.supabase\\.co`));
        assert.match(csp, /frame-src 'none'/);
        assert.match(csp, /object-src 'none'/);
        // The camera stream and decode canvas need blob:.
        assert.match(csp, /img-src[^;]*blob:/);
        assert.match(csp, /media-src[^;]*blob:/);
    });

    test('is noindex, nofollow and no-referrer', () => {
        assert.match(HTML, /<meta name="robots" content="noindex, nofollow">/);
        assert.match(HTML, /<meta name="referrer" content="no-referrer">/);
    });

    test('contains no inline script and no third-party host', () => {
        assert.equal(/<script(?![^>]*src=)/.test(HTML), false, 'inline script present');
        assert.equal(/https?:\/\/(?!mfaymuisnpfdolqogktx)/.test(HTML.replace(/<!--[\s\S]*?-->/g, '')), false);
    });

    test('loads no analytics of any kind', () => {
        for (const file of jsFiles()) {
            const src = stripComments(read('js', file));
            ['gtag', 'analytics', 'segment', 'mixpanel', 'posthog'].forEach((w) =>
                assert.equal(new RegExp(w, 'i').test(src), false, `${file}: ${w}`));
        }
    });

    test('check-in is part of the SHARED promotion set', () => {
        assert.ok(SHARED_DIRS.includes('check-in'), 'check-in is not shared/promotable');
    });

    test('EVERY executable edge carries the current WEB_BUILD', () => {
        // HTML entry references.
        const refs = [...HTML.matchAll(/(?:src|href)="(check-in\/[^"?]+)(\?v=([^"]*))?"/g)];
        assert.ok(refs.length >= 3, `only ${refs.length} entry refs found`);
        refs.forEach(([, path, , token]) =>
            assert.equal(token, WEB_BUILD, `${path} is not on WEB_BUILD`));

        // Static/dynamic import specifiers in our own modules.
        let edges = 0;
        for (const file of jsFiles()) {
            for (const m of read('js', file).matchAll(/(?:from\s*|import\()\s*'(\.\.?\/[^']+?\.js)(\?v=([^']*))?'/g)) {
                edges += 1;
                assert.equal(m[3], WEB_BUILD, `${file}: ${m[1]} is not on WEB_BUILD`);
            }
        }
        assert.ok(edges >= 5, `only ${edges} import edges found in the scanner`);
    });

    test('the vendored decoder keeps its Apache-2.0 attribution', () => {
        const vendor = read('js', 'vendor', 'jsqr.js');
        assert.match(vendor, /jsQR v1\.4\.0/);
        assert.match(vendor, /Apache License, Version 2\.0/);
        // The full licence text travels with it.
        assert.match(read('js', 'vendor', 'jsqr-LICENSE.txt'), /Apache License/);
    });

    test('does not touch the invitation Worker route', () => {
        for (const file of jsFiles()) {
            assert.equal(/\/invitation\//.test(stripComments(read('js', file))), false, file);
        }
        assert.equal(/\/invitation\//.test(HTML.replace(/<!--[\s\S]*?-->/g, '')), false);
    });
});

/* ── helpers ───────────────────────────────────────────────────────────────── */

function jsFiles() {
    return readdirSync(join(CHECKIN, 'js'), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.js'))
        .map((e) => e.name);
}

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fakeWindow({ hash = '', search = '' } = {}) {
    const store = {};
    return {
        location: { hash, search, pathname: '/vyvent-legal/check-in/' },
        sessionStorage: {
            store,
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; },
            removeItem: (k) => { delete store[k]; },
        },
        history: { calls: [], replaceState(...a) { this.calls.push(a); } },
    };
}

function fakeCanvas() {
    return {
        width: 0,
        height: 0,
        getContext: () => ({
            drawImage() {},
            getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        }),
    };
}
