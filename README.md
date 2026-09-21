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
