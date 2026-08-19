/* THE SCANNER — wiring only. Every decision lives in a module beside this one
 * so it can be tested without a camera:
 *
 *   session.js  where the capability comes from and when it dies
 *   backend.js  the two RPCs, closed allowlist
 *   camera.js   getUserMedia lifecycle
 *   decode.js   BarcodeDetector / jsQR, plus the client-side scan gate
 *   ui.js       server status -> what the operator reads
 *
 * THE BROWSER DECIDES NOTHING. It cannot read a pass, cannot validate a
 * capability, and cannot know whether a code has been used. Every guard here —
 * shape checks, cooldown, single-flight — exists for battery and for the
 * operator's eyes. The one-time guarantee is a unique index in Postgres.
 */
import { captureCapability, clearCapability, newNonce } from './session.js?v=20260819a';
import { checkIn, resolveAccess } from './backend.js?v=20260819a';
import { describeCameraError, startCamera, stopCamera } from './camera.js?v=20260819a';
import { createDecoder, createScanGate, isPassShape } from './decode.js?v=20260819a';
import { describeCounter, describeResult, shouldStopCamera, isTerminalStatus } from './ui.js?v=20260819a';

var DECODE_INTERVAL_MS = 125; // ~8 decode attempts/second.

var el = function (id) { return document.getElementById(id); };
var show = function (id) { el(id).hidden = false; };
var hide = function (id) { el(id).hidden = true; };
var setText = function (id, value) { el(id).textContent = value == null ? '' : String(value); };

var state = {
    capability: null,
    stream: null,
    decoder: null,
    gate: createScanGate(3000),
    loopTimer: null,
    /* The nonce for the CURRENT physical scan attempt. Reused across retries
     * of that attempt and only cleared once its outcome is resolved. */
    attemptNonce: null,
    attemptPayload: null,
    scanning: false,
};

/* ── Bootstrap ─────────────────────────────────────────────────────────────── */

async function boot() {
    state.capability = captureCapability(window);

    if (!state.capability) {
        return fatal('Enlace no válido', 'Abre el enlace de scanner que te compartieron.');
    }

    show('loading');
    var result = await resolveAccess(state.capability);
    hide('loading');

    if (!result) {
        return fatal('Sin conexión', 'No pudimos verificar este acceso. Revisa tu conexión y recarga.');
    }

    var status = String(result.status || '');
    if (status !== 'OK') {
        if (isTerminalStatus(status)) clearCapability(window);
        var described = describeResult(result);
        return fatal(described.title, described.detail);
    }

    setText('eventName', result.event_name || 'Evento');
    setText('scannerLabel', result.scanner_label || '');
    setText('validUntil', result.valid_until ? 'Activo hasta ' + timeOf(result.valid_until) : '');
    updateCounter(result);

    if (result.qr_enabled === false) {
        setText('bootNote', 'El organizador todavía no activó el acceso con QR.');
    }

    show('bootstrap');
}

function fatal(title, detail) {
    setText('fatalTitle', title);
    setText('fatalDetail', detail || '');
    hide('bootstrap'); hide('scanner'); hide('loading');
    show('fatal');
    stopScanning();
}

function timeOf(iso) {
    try {
        return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
}

function updateCounter(result) {
    var text = describeCounter(result);
    if (text) {
        setText('counter', text);
        el('counter').hidden = false;
    }
}

/* ── Camera ────────────────────────────────────────────────────────────────── */

async function beginScanning() {
    var video = el('video');
    try {
        var started = await startCamera(video, {});
        state.stream = started.stream;
    } catch (error) {
        var described = describeCameraError(error);
        setText('cameraErrorTitle', described.title);
        setText('cameraErrorBody', described.body);
        show('cameraError');
        return;
    }

    hide('bootstrap');
    hide('cameraError');
    show('scanner');

    state.decoder = await createDecoder({});
    state.scanning = true;
    tick();
}

function stopScanning() {
    state.scanning = false;
    if (state.loopTimer) { clearTimeout(state.loopTimer); state.loopTimer = null; }
    stopCamera(state.stream, el('video'));
    state.stream = null;
}

function tick() {
    if (!state.scanning) return;
    state.loopTimer = setTimeout(function () { void frame(); }, DECODE_INTERVAL_MS);
}

async function frame() {
    if (!state.scanning) return;
    var video = el('video');
    var w = video.videoWidth;
    var h = video.videoHeight;
    if (!w || !h) return tick();

    var payload = await state.decoder.decode(video, w, h);
    if (!payload || !isPassShape(payload)) return tick();
    if (!state.gate.accept(payload, Date.now())) return tick();

    // A NEW physical scan gets a NEW nonce. A retry of the SAME attempt keeps
    // the old one — that is what makes a lost response idempotent.
    state.attemptPayload = payload;
    state.attemptNonce = newNonce();
    await submit();
}

/* ── Submission ────────────────────────────────────────────────────────────── */

async function submit() {
    state.gate.begin();
    // Pause decoding while the result is on screen: the operator is reading,
    // and the code is still sitting in front of the lens.
    state.scanning = false;

    var result = await checkIn(state.capability, state.attemptPayload, state.attemptNonce);
    state.gate.end();
    render(result);
}

function render(result) {
    var view = describeResult(result);
    var card = el('result');

    card.className = 'result result--' + view.tone;
    setText('resultTitle', view.title);
    setText('resultDetail', view.detail || '');

    var list = el('resultLines');
    list.innerHTML = '';
    view.lines.forEach(function (line) {
        var p = document.createElement('p');
        p.className = 'result__line';
        p.textContent = line;             // textContent, never innerHTML
        list.appendChild(p);
    });

    if (result) updateCounter(result);

    var status = result ? String(result.status || '') : '';
    var offline = !result;

    // OFFLINE keeps the attempt ALIVE: the write may have committed and only
    // the answer was lost, so Reintentar must resend the SAME nonce.
    el('retryBtn').hidden = !offline;
    el('continueBtn').hidden = offline;

    show('result');

    if (shouldStopCamera(status)) {
        stopScanning();
        if (isTerminalStatus(status)) clearCapability(window);
        el('continueBtn').hidden = true;
        return;
    }

    if (!view.requiresContinue && view.autoDismissMs) {
        setTimeout(dismissResult, view.autoDismissMs);
    }
}

function dismissResult() {
    hide('result');
    // This attempt is resolved. The next code scanned starts a new one.
    state.attemptNonce = null;
    state.attemptPayload = null;
    state.gate.reset();
    if (state.stream) {
        state.scanning = true;
        tick();
    }
}

/* ── Wiring ────────────────────────────────────────────────────────────────── */

function wire() {
    el('startBtn').addEventListener('click', function () { void beginScanning(); });
    el('retryCameraBtn').addEventListener('click', function () { void beginScanning(); });
    el('continueBtn').addEventListener('click', dismissResult);

    // Same nonce, deliberately: this is a retry of one attempt, not a new scan.
    el('retryBtn').addEventListener('click', function () { void submit(); });

    el('closeBtn').addEventListener('click', function () {
        clearCapability(window);
        stopScanning();
        fatal('Scanner cerrado', 'Vuelve a abrir el enlace para escanear de nuevo.');
    });

    // DEPARTURE only — never `blur`, which fires for native UI the page is
    // still behind. A camera left running in a pocket is a battery and trust
    // problem.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopScanning();
    });
    window.addEventListener('pagehide', function () { stopScanning(); });
}

wire();
void boot();
