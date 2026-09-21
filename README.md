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
