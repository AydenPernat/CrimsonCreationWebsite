# Crimson Creations

Run locally with `npm install` and `npm start`. Copy `.env.example` to `.env` and fill in the existing email/owner settings. Run `npm test` for storage, touch gesture, and API smoke checks.

## Keep projects when Render redeploys

Render's free web services discard local files when restarting or redeploying. This app uses external PostgreSQL whenever `DATABASE_URL` is set. Projects, accounts, sessions, feedback, newsletter subscriptions, and contact requests all use that database.

1. Create a PostgreSQL database, for example a free project at https://neon.com. In its **Connect** panel, copy the PostgreSQL connection string with SSL enabled. Keep the connection string private.
2. In the existing Render web service, open **Environment**, add `DATABASE_URL`, and paste the connection string as its value. Keep your existing email and owner variables.
3. Deploy the updated files, including `data-store.cjs`, `package.json`, and `package-lock.json`. The build command should install dependencies (`npm ci`); the start command is `npm start`.
4. Create a project, redeploy the service, and confirm the project remains. Keep using the same database across deployments.

The app creates its own `crimson_site_data` table. On the first connection only, it imports `data.json` if that file is present. Later deploys never replace the database with the repository's file. If the database cannot be reached, requests fail instead of silently saving to Render's temporary filesystem. On Render, startup requires `DATABASE_URL`; configure it before deploying this change.

### Existing data

Back up any still-existing live data **before** triggering another Render deploy. A database added later cannot recover data already deleted by an earlier redeploy. A first-time import can only use the `data.json` available to the new process, which may be an older local copy rather than the previous live server's data. Do not commit account data or secrets to GitHub. If you have an authoritative backup, import it into an empty database from a trusted local environment before connecting Render to that database.

Without `DATABASE_URL`, local development continues to use `data.json`. Database writes are transactional and locked to avoid lost updates from concurrent requests. This small-site implementation stores one JSON document and serializes database requests; a larger site should migrate to separate relational tables.

References: [Render filesystem limits](https://render.com/docs/free), [Neon connections](https://neon.com/docs/connect/connect-from-any-app).

## Password recovery and verification emails

In Portal, expand **Forgot your password or verification email?** and enter the account email. Password reset emails are available for verified accounts; unverified accounts can request a replacement verification email. Reset links expire after 30 minutes, work once, and clear that account's existing sessions. Verification links expire after 24 hours; resending replaces the previous link.

These features use the existing `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Set `CRIMSON_PUBLIC_URL` to the real HTTPS website address in Render so email links open the live site. Requests are rate limited, with a one-minute email cooldown, and the response does not reveal whether an email is registered. Local tests mock email delivery; verify delivery with your own account after deployment.

## Encrypted backup and restore

Sign in as the configured owner and open **Administrator tools → Backup and restore**. Enter the current owner account password and a separate backup passphrase of at least 12 characters, then download the encrypted JSON file. Backups are **manual**: download after important changes and keep copies outside Render/Neon. Keep the passphrase separately; it cannot be recovered.

Backups include accounts (including password hashes), projects, feedback, subscriptions, and requests. Sessions and active verification/reset links are excluded. AES-256-GCM encryption protects the file with a key derived from its passphrase using scrypt. Files are limited to 12 MB for browser restore.

To restore, select a backup, enter its original passphrase and your current account password, and click **Preview backup**. Check the date and counts, then type `RESTORE`. The browser starts downloading an encrypted copy of the current data before replacement; allow the download and keep it if you need to undo the restore. Restoration replaces the site data and signs everyone out. Existing users keep their current passwords, and configured owners retain access. Accounts restored from deletion regain the password hash saved in the backup; unverified accounts need fresh verification links.

Only an authenticated, password-confirmed owner can use backup endpoints. A backup must contain the matching owner account. If the entire database or owner account is lost, this portal flow cannot run; use a database-level recovery or a trusted server-side import instead. These downloads supplement, rather than replace, the database provider's recovery options.

For this release, deploy `account-tools.cjs` and `portal-tools.js` along with the updated `server.js`, `script.js`, `style.css`, and `portal.html`.

## Guest briefs, pricing, and SEO

The contact page and `/api/contact` accept guest briefs. A hidden text honeypot and a five-request-per-hour IP limit protect email quota. Requests are stored before the Resend owner notification is attempted; an email failure returns an honest saved-request message. The button shows a spinner, then a green checkmark and an optional portal signup prompt. Verified clients can see guest requests submitted with their email after creating an account. The Express proxy setting assumes one trusted reverse proxy, matching the Render deployment; adjust it if you change the hosting topology.

Existing website rates remain $800 / $1,100 / $1,600. The estimator uses page count: 1–3 pages start at $800, 4–6 at $1,100, and 7 at $1,600; each additional page adds an indicative $150. Plain-language feature toggles add estimated costs, and page count/features carry into the contact brief. An optional description carries into project details through temporary browser session storage, without placing the description in the URL.

The homepage stack cards have section/card spacing. The availability link and performance-report card were removed. Scroll reveals replay when elements re-enter from either direction and respect reduced-motion preferences.

The homepage ProfessionalService JSON-LD includes the real logo asset, development expertise, and service types. Unverified example GitHub/X profiles are not included. At the owner's request, the root `sitemap.xml` lists only the homepage with its update date, change frequency, and priority. The server serves it at `/sitemap.xml` and substitutes `CRIMSON_PUBLIC_URL` for the hostname. Project URLs are excluded. Update `lastmod` only when a page actually changes. The canonical/schema URLs use `https://www.crimsoncreations.dev`; keep these and your production public URL consistent. The sitemap helps discovery and schema describes the studio; neither guarantees indexing, business registration, or Knowledge Graph inclusion.

Project editing now includes Problem, Solution, Measured impact, and Tools used. Add actual results and measurement periods in the owner portal. Empty impact fields explicitly state that results have not been published. Project detail pages offer desktop (1280px), tablet (768px), and mobile (390px) live iframe previews. Some sites prevent embedding; the direct site link stays available. The preview is sandboxed, and HTTPS pages do not embed HTTP projects.

## Enable Google and GitHub sign-in

Deploy `social-auth.cjs` and `enhancements.js`, plus the updated HTML, `server.js`, `script.js`, `style.css`, and `account-tools.cjs`. Keep the existing database and Resend settings. Social provider secrets belong in Render's environment, never browser files or GitHub.

1. In [Google Cloud's OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server), configure the consent screen and create an OAuth client of type **Web application**. Add the authorized redirect URI `https://www.crimsoncreations.dev/api/auth/oauth/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Render. Add test users while the consent screen is in testing, or complete Google's publishing requirements for public access.
2. Register a [GitHub OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) with homepage `https://www.crimsoncreations.dev` and callback `https://www.crimsoncreations.dev/api/auth/oauth/github/callback`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Render.
3. Use the exact origin in `CRIMSON_PUBLIC_URL`; callbacks must match it, including `www`. For local Google testing, register `http://localhost:3000/api/auth/oauth/google/callback` too. GitHub generally needs a separate development OAuth app for its local callback.
4. Redeploy and try both providers with your own accounts. Buttons are disabled with a setup message when credentials are absent. The automated tests mock providers; a real callback test requires your registered apps.

Google and GitHub can create new verified client accounts or sign into accounts already connected to them. An existing email account must first sign in with its password or magic link, then use **Connect Google or GitHub** in the dashboard. Provider emails can differ from the primary contact email. Provider IDs are stored as the identity; accounts are not silently merged by email. Authorization uses short-lived, browser-bound, single-use state and PKCE. Provider access tokens are used to read the verified identity and are not stored.

The sign-in screen now uses Google, GitHub, or password fields. The email magic-link request UI was removed; the backend still accepts previously issued magic links. Existing verified accounts can request Resend magic links through the existing API. Links expire after 15 minutes, are stored only as hashes, and are consumed once with a dashboard confirmation button. There is a one-minute email cooldown and an IP attempt limit. Active magic links and OAuth flows are excluded from encrypted backups; password resets invalidate outstanding magic links. Social accounts can set a password through the existing password recovery flow if desired.

Validation: `npm test` includes database persistence, guest/honeypot contact behavior, account recovery, backup/restore, OAuth state/PKCE/account linking, magic-link expiry/replay, and local asset/route checks. Real OAuth callbacks, production email delivery, and actual Lighthouse metrics require a deployed test.

See [SETUP.md](SETUP.md) for the exact OAuth, free spam protection, sitemap deployment, and Search Console steps.

## Project logo uploads

Deploy `logo-upload.js` with the updated portal and server, and run `npm ci` to install the new decoders. Supported upload extensions: PNG, JPG/JPEG/JFIF, WebP, GIF, SVG, AVIF, BMP, ICO, TIF/TIFF, HEIC and HEIF. Files are limited to 10 MB; decoded images are limited to 40 million pixels. Logos become still PNG/WebP thumbnails with a maximum side of 256 pixels before saving. Animation is not retained. Browser-native format support can vary; PSD, AI, EPS, PDF and camera RAW files should be exported as PNG or SVG first. Leaving the logo empty keeps the droplet.

TIFF uses [UTIF.js](https://github.com/photopea/UTIF.js) and pako (MIT licenses). HEIC/HEIF uses the unmodified [heic-to CSP build](https://github.com/hoppergee/heic-to), licensed under LGPL-3.0; its license is available at `/vendor/heic-to.LICENSE`, and matching source is included in the installed npm package and upstream repository. These converters load only when needed. The CSP allows their local blob worker without allowing unsafe script evaluation. Original images and provider tokens are not sent to an image conversion service.

Review fixes: project submissions cannot run while image conversion or a save is pending; removing a logo or changing the selected project cancels stale conversion results. Backup restore preserves current password status and linked Google/GitHub identities for existing accounts. An unconfigured OAuth provider returns a clear API error. The compatible proxy-addr dependency update resolves the audit finding; `npm audit` reports zero known vulnerabilities at this check.

Portal accounts can unlink Google or GitHub independently using the dashboard buttons. Unlinking requires the authenticated browser/tab session and removes the stored provider ID/email and pending linking flows for that provider. The final usable sign-in method cannot be removed until a portal password is set or another configured provider is connected. The external provider authorization is not revoked by this local unlink operation. The responsive iframe preview section and viewport controls have been removed from project details; the direct site link remains.

## Google showing the portal instead of the homepage

All non-homepage routes (services, projects, project details, about, contact, portal, success, unsubscribe, and their `.html` aliases) carry `noindex` in HTML and response headers. Do not disallow these pages in robots.txt: Google must crawl them to discover noindex. API routes remain disallowed, authenticated account data remains protected, and the sitemap contains only the homepage.

Deploy the updated server/HTML before requesting Google changes. In Search Console, inspect `https://www.crimsoncreations.dev/`, run the live test, and request indexing. For a faster portal removal, use Removals > New request > Temporarily remove URL with prefix `https://www.crimsoncreations.dev/portal`; never enter only the domain root, which would hide the whole site. Prefix removal also covers the legacy portal.html address and query variants. Temporary removal lasts about six months; the crawlable noindex rule provides the lasting exclusion. Recheck that the submitted sitemap is successfully read. Rankings and Google's chosen landing page update on Google's schedule; neither a sitemap nor structured data guarantees first place.

Only the homepage is eligible for search results. Other pages keep working normally for visitors using site navigation or direct links. Existing search results do not change their click destination; they are removed after search engines process noindex. Do not redirect all non-homepage requests to the homepage, since that would prevent clients from using services, forms, and the portal.
