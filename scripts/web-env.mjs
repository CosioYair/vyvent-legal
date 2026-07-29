/**
 * Shared definitions for the DEV ↔ PROD web promotion workflow.
 *
 * Two separate Git repositories serve the same Orbiventt website against two
 * different Supabase projects:
 *
 *   CosioYair/vyvent-legal     DEV   GitHub Pages project site   Supabase DEV
 *   CosioYair/orbiventt-legal  PROD  https://orbiventt.com       Supabase PROD
 *
 * SOURCE-OF-TRUTH RULE
 *   `orbiventt-legal` is the canonical PRODUCTION codebase.
 *   `vyvent-legal` is the DEV mirror and the implementation surface: features
 *   are written and validated here first, then PROMOTED — copied, never
 *   rewritten — into the production repository at the approved release gate.
 *
 * Everything below exists so that "the same implementation" is a mechanically
 * checkable claim rather than a habit.
 */

/** Files that MUST be equivalent in both repositories (modulo ENV_TOKENS). */
export const SHARED_FILES = [
  '404.html',
  'index.html',
  'support.html',
  'privacy-policy.html',
  'terms-of-service.html',
  'delete-account.html',
  '.nojekyll',
  '.well-known/assetlinks.json',
  '.well-known/README.md',
  'assets/favicon.png',
  'assets/orbiventt-logo.png',
  'favicon.ico',
  'favicon-96x96.png',
  'apple-touch-icon.png',
  'scripts/web-env.mjs',
  'scripts/parity-check.mjs',
  'scripts/promote.mjs',
];

/**
 * Directories whose entire contents are shared. Added as the invitation module
 * lands, so template/section/asset files never need listing one by one.
 */
export const SHARED_DIRS = [
  'invitation',
];

/**
 * ENVIRONMENT-SPECIFIC files. Never compared, never promoted, never copied in
 * either direction. Confusing these between deployments is exactly the failure
 * this workflow exists to prevent.
 */
export const ENV_ONLY_FILES = [
  'env.js',      // Supabase target + DEV marker
  'robots.txt',  // DEV disallows everything; PROD advertises the sitemap
  'sitemap.xml', // production URLs only
  'CNAME',       // production custom domain only
  // Deploy policy differs by design: the DEV mirror also publishes
  // `feature/**` so work can be validated on a device before it is merged,
  // which production must never do. Promoting this file would hand production
  // that trigger, so it stays environment-specific.
  '.github/workflows/deploy-pages.yml',
];

/**
 * Paths that exist only in the production repository (marketing + internal
 * docs). They are deliberately absent from the DEV mirror and are not part of
 * the parity contract.
 */
export const PROD_ONLY_PATHS = [
  'docs',
  'prensa',
  'post.txt',
  'scripts/build-press-release.mjs',
];

export const DEV_SUPABASE_REF = 'mfaymuisnpfdolqogktx';
export const PROD_SUPABASE_REF = 'lehwxjbjlehsdkqxlzrb';

export const DEV_BASE_HREF = '<base href="/vyvent-legal/">';
export const PROD_BASE_HREF = '<base href="/">';

/** The DEV-only noindex block, marker comment included so removal is exact. */
const DEV_NOINDEX_BLOCK =
  /[^\S\r\n]*<!-- ENV-SPECIFIC: DEV mirror only\. Removed on promotion to production\. -->\r?\n[^\S\r\n]*<meta name="robots" content="noindex">\r?\n/g;

/**
 * Rewrite DEV file content into its PRODUCTION equivalent.
 *
 * These are the ONLY differences allowed to exist between the two repositories
 * inside a shared file. Anything else the parity check reports is real drift.
 */
export function devToProd(content) {
  return content
    .split(DEV_BASE_HREF).join(PROD_BASE_HREF)
    .split(DEV_SUPABASE_REF).join(PROD_SUPABASE_REF)
    .replace(DEV_NOINDEX_BLOCK, '');
}

/** Binary files are compared byte-for-byte; token rewriting does not apply. */
export function isBinary(relPath) {
  return /\.(png|ico|jpg|jpeg|gif|webp|woff2?)$/i.test(relPath);
}
