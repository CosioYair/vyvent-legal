/* ENVIRONMENT BOUNDARY — DEVELOPMENT ONLY.
 *
 * This is the one file that differs between the two Orbiventt web
 * deployments, and it is NEVER promoted between repositories:
 *
 *   CosioYair/orbiventt-legal  → PRODUCTION, https://orbiventt.com,  Supabase PROD
 *   CosioYair/vyvent-legal     → DEVELOPMENT, GitHub Pages project site, Supabase DEV
 *
 * Everything else (HTML, CSS, JS, templates, assets, security helpers) is
 * kept byte-equivalent across both repositories; see scripts/parity-check.mjs.
 *
 * RULES
 *  - `supaAnon` is a PUBLISHABLE anon JWT. It is meant to ship in client code.
 *    A SERVICE-ROLE KEY MUST NEVER APPEAR IN THIS FILE OR IN THIS REPOSITORY.
 *  - The environment is fixed at deploy time by which repository serves the
 *    page. Nothing here may ever be made switchable from a query parameter,
 *    localStorage, or any other client-controlled input.
 *  - `basePath` is the path this deployment is served under. GitHub Pages
 *    project sites serve at /<repo>/; the production custom domain serves at
 *    the root, where this value is the empty string.
 */
window.__ORB_ENV__ = {
    env: 'dev',
    supaUrl: 'https://mfaymuisnpfdolqogktx.supabase.co',
    supaAnon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mYXltdWlzbnBmZG9scW9na3R4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMzM3NjUsImV4cCI6MjA5NzgwOTc2NX0.fFlWdHyGEoQjJtQHet8mhz6CYz8NbhU3RkdZ2b8rhsU',
    basePath: '/vyvent-legal',
    devBadge: true
};
