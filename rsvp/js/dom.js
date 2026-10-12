/* SAFE DOM CONSTRUCTION — the invitation renderer's rule, applied to a page
 * that also renders what OTHER GUESTS typed (party names, companion names, a
 * decline note). Every value becomes a TEXT NODE, never markup: `innerHTML`,
 * `outerHTML`, `insertAdjacentHTML` and inline event-handler attributes appear
 * nowhere in this module tree, and the test suite's DOM stub throws on them.
 *
 * `el()` accepts no `html` option, and attributes outside the allowlist below
 * are dropped — so a guest's text can never reach `onclick`, `src` or `style`.
 * This is a separate, smaller copy of `invitation/js/dom.js` because a reply
 * page needs form attributes the invitation renderer has no business allowing.
 */

var ALLOWED_ATTRS = {
    id: true,
    class: true,
    href: true,
    src: true,
    alt: true,
    type: true,
    role: true,
    tabindex: true,
    target: true,
    rel: true,
    download: true,
    loading: true,
    decoding: true,
    datetime: true,
    hidden: true,
    for: true,
    name: true,
    placeholder: true,
    maxlength: true,
    inputmode: true,
    autocomplete: true,
    autocapitalize: true,
    enterkeyhint: true,
    rows: true,
    'aria-label': true,
    'aria-hidden': true,
    'aria-live': true,
    'aria-describedby': true,
    'data-view': true,
    'data-state': true,
};

function doc(d) {
    return d || (typeof document !== 'undefined' ? document : null);
}

/**
 * Create an element.
 *   class    {string}            class attribute
 *   text     {string}            textContent (never parsed as HTML)
 *   attrs    {object}            allowlisted attributes only
 *   children {Array<Node|null>}  appended in order; null/undefined skipped
 *   document {Document}          test seam
 */
export function el(tag, opts) {
    var options = opts || {};
    var d = doc(options.document);
    if (!d) throw new Error('el(): no document available');

    var node = d.createElement(tag);
    if (options.class) node.setAttribute('class', String(options.class));

    if (options.attrs) {
        var names = Object.keys(options.attrs);
        for (var i = 0; i < names.length; i += 1) {
            var name = names[i];
            var value = options.attrs[name];
            if (value === null || value === undefined || value === false) continue;
            if (!Object.prototype.hasOwnProperty.call(ALLOWED_ATTRS, name)) continue;
            node.setAttribute(name, value === true ? '' : String(value));
        }
    }

    if (options.text !== undefined && options.text !== null) {
        node.textContent = String(options.text);
    }

    if (options.children) {
        for (var j = 0; j < options.children.length; j += 1) {
            if (options.children[j]) node.appendChild(options.children[j]);
        }
    }
    return node;
}

/** Set text content. The single entry point for any copy. */
export function setText(node, value) {
    if (!node) return node;
    node.textContent = value === null || value === undefined ? '' : String(value);
    return node;
}

/** Remove every child of a node. */
export function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

/** One <p> per blank-line-separated block; no markup is ever generated. */
export function paragraphs(text, className, d) {
    var blocks = String(text || '').split(/\n{2,}/);
    var out = [];
    for (var i = 0; i < blocks.length; i += 1) {
        var block = blocks[i].trim();
        if (block) out.push(el('p', { class: className, text: block, document: d }));
    }
    return out;
}
