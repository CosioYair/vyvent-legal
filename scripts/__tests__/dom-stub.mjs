/**
 * A MINIMAL DOM, built for one job: run the invitation renderer — the exact
 * files GitHub Pages serves — under `node --test`, with no jsdom, no bundler
 * and no dependency of any kind (this repository has none, and adding one to
 * test a static site would be its own kind of regression).
 *
 * Two design decisions do real work here:
 *
 *   1. `innerHTML` IS NOT IMPLEMENTED. Assigning it throws. So if any renderer
 *      ever reaches for raw HTML, the test suite fails loudly instead of
 *      quietly accepting a new injection surface. The same applies to
 *      `outerHTML` and `insertAdjacentHTML`.
 *
 *   2. `serialize()` escapes text nodes on the way out. The escaping assertions
 *      therefore prove something real: that organizer text left the renderer as
 *      TEXT and could only ever be re-encoded as markup, never parsed as it.
 */

const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'source', 'track', 'wbr',
]);

class TextNode {
    constructor(data) {
        this.nodeType = 3;
        this.data = String(data);
        this.parentNode = null;
    }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
}

class Element {
    constructor(tagName, ownerDocument) {
        this.nodeType = 1;
        this.tagName = String(tagName).toLowerCase();
        this.ownerDocument = ownerDocument;
        this.attributes = new Map();
        this.childNodes = [];
        this.parentNode = null;
        this.listeners = new Map();
    }

    /* ── attributes ─────────────────────────────────────────────────────── */
    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }
    hasAttribute(name) { return this.attributes.has(String(name)); }
    removeAttribute(name) { this.attributes.delete(String(name)); }

    get classList() {
        const self = this;
        return {
            add(...names) {
                const set = new Set((self.getAttribute('class') || '').split(/\s+/).filter(Boolean));
                for (const n of names) set.add(n);
                self.setAttribute('class', [...set].join(' '));
            },
            contains(name) {
                return (self.getAttribute('class') || '').split(/\s+/).includes(name);
            },
        };
    }

    /* ── tree ───────────────────────────────────────────────────────────── */
    appendChild(child) {
        if (!child) return child;
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }
    removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if (i !== -1) { this.childNodes.splice(i, 1); child.parentNode = null; }
        return child;
    }
    get firstChild() { return this.childNodes[0] || null; }
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

    /* ── text ───────────────────────────────────────────────────────────── */
    get textContent() {
        return this.childNodes.map((n) => n.textContent).join('');
    }
    set textContent(value) {
        this.childNodes = [];
        if (value !== '') this.appendChild(new TextNode(value));
    }

    /* ── the deliberate holes ───────────────────────────────────────────── */
    set innerHTML(_v) {
        throw new Error('innerHTML is not available: the invitation renderer must never build markup from a string');
    }
    set outerHTML(_v) {
        throw new Error('outerHTML is not available');
    }
    insertAdjacentHTML() {
        throw new Error('insertAdjacentHTML is not available');
    }

    /* ── events ─────────────────────────────────────────────────────────── */
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
    }
    dispatch(type, event) {
        for (const handler of this.listeners.get(type) || []) handler(event || { type });
    }

    /* ── queries used by the tests ──────────────────────────────────────── */
    querySelectorAll(selector) {
        const out = [];
        const match = compileSelector(selector);
        const walk = (node) => {
            for (const child of node.childNodes) {
                if (child.nodeType !== 1) continue;
                if (match(child)) out.push(child);
                walk(child);
            }
        };
        walk(this);
        return out;
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

/** Supports `*`, `tag`, `.class`, `[attr]` and `[attr="value"]`. */
function compileSelector(selector) {
    const s = String(selector).trim();

    if (s === '*') return () => true;

    const attrValue = /^\[([a-zA-Z-]+)="([^"]*)"\]$/.exec(s);
    if (attrValue) return (el) => el.getAttribute(attrValue[1]) === attrValue[2];

    const attrOnly = /^\[([a-zA-Z-]+)\]$/.exec(s);
    if (attrOnly) return (el) => el.hasAttribute(attrOnly[1]);

    if (s.startsWith('.')) {
        const cls = s.slice(1);
        return (el) => (el.getAttribute('class') || '').split(/\s+/).includes(cls);
    }

    return (el) => el.tagName === s.toLowerCase();
}

class Document {
    constructor() {
        this.nodeType = 9;
    }
    createElement(tag) { return new Element(tag, this); }
    createTextNode(data) { return new TextNode(data); }
}

/** A fresh document per test — no shared state between cases. */
export function createDocument() {
    return new Document();
}

function escapeText(value) {
    return String(value)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;');
}

function escapeAttr(value) {
    return escapeText(value).split('"').join('&quot;');
}

/**
 * Serialize a subtree to HTML. Text nodes are ESCAPED here — that is what makes
 * "organizer text is escaped" a real assertion rather than a restatement of the
 * implementation.
 */
export function serialize(node) {
    if (!node) return '';
    if (node.nodeType === 3) return escapeText(node.data);

    const attrs = [...node.attributes.entries()]
        .map(([name, value]) => ' ' + name + '="' + escapeAttr(value) + '"')
        .join('');

    if (VOID_ELEMENTS.has(node.tagName)) return '<' + node.tagName + attrs + '>';

    const inner = node.childNodes.map(serialize).join('');
    return '<' + node.tagName + attrs + '>' + inner + '</' + node.tagName + '>';
}

/** Every element carrying `data-section`, in document order. */
export function sectionsOf(root) {
    return root.querySelectorAll('[data-section]')
        .map((el) => el.getAttribute('data-section'));
}
