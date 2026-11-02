# DoudhVyavastha

DoudhVyavastha is a local-first dairy management app. It uses React and Vite for the browser UI, Express for the API, and PostgreSQL for persistent records. Each new account creates a separate dairy tenant; private API routes derive the dairy from the authenticated server-side session.

> **Deployment status:** This repository is a local development foundation, not a production-ready hosted service. Before deployment, complete a security review, configure HTTPS and a strong secret, test database backups/restores, configure monitoring and email/SMS delivery, and choose a private logo-storage service if logo uploads are needed.

## What is implemented

- Public dairy-owner registration, email/mobile login, logout, PostgreSQL-backed sessions, cookie-based authentication, CSRF token checks, login/registration rate limiting, Helmet, and server-side validation.
- Incremental PostgreSQL migrations for dairies, users, memberships, producer status/photos and code counters, dated morning/evening collection sessions, milk rate rules, milk entries, feed issues, advances, payments, audit logs, and login sessions.
- Tenant-scoped producer, feed, rate, milk-collection, ledger, dashboard, report, and CSV endpoints. Writes are restricted to dairy owners; record updates/deletes include the authenticated dairy in their SQL predicate.
- A responsive, mobile-friendly dashboard with dairy-branded workspace shortcuts, cow/buffalo totals, collection trends, producer participation, pending-producer lists, and session controls.
- Live, server-calculated milk quantity/rate/amount previews; separate cow and buffalo rate filters; producer status management; and daily, weekly, monthly, yearly, and custom-date report filters with CSV/print actions.
- Optional JPEG/PNG/WebP profile photo during registration, private user profile photo upload/removal (2 MB maximum), and profile photos in the workspace. Producers also support private photos, generated codes, active/inactive status, photo previews/detail cards, safe history retention, and duplicate protection for collection entries.
- Rate-chart preview/import for CSV, XLSX, and text-based PDF with editable extracted rows and overlap validation before bulk save. Scanned-image OCR and legacy XLS parsing are unsupported; those charts can be entered manually.
- Feed issue history with saved issue-time rates; advances with audited voiding; current producer outstanding balances; and payments validated against the available balance.
- Producer-specific bills with morning/evening quantities and amounts, feed/advance/payment deductions, period balance, CSV export, and print/Save-as-PDF output.
- Explicit zero-supply records, kept separate from missing entries; starting a session is required before collection, and closed sessions can only be corrected after an audited owner reopen.
- PostgreSQL integration tests for cross-dairy isolation, session lifecycle, duplicate-entry prevention, zero-supply records, photo access, rate import, and ledger calculations.

Staff invitation/management, password reset delivery, database RLS, custom dairy-specific quantity-unit settings, dairy logo uploads, and automatic OCR for scanned/image rate charts are not implemented. Password reset and image OCR are intentionally not simulated. Milk quantity is stored in litres to three decimal places; amount is `quantity × configured per-litre rate`, rounded half-up to two decimal places. Explicit zero-supply records save a zero rate and amount without requiring a rate slab; positive quantities require a matching slab. Rate rules use inclusive minimum and exclusive maximum Fat/SNF boundaries. Each saved collection keeps producer identity and applied rate/amount snapshots.

## Windows local setup

### 1. Install Node.js and PostgreSQL

Install a current Node.js LTS release and PostgreSQL for Windows. During PostgreSQL installation, remember the local `postgres` password and keep the PostgreSQL service running. The `psql`, `createdb`, `pg_dump`, and `pg_restore` commands are installed with PostgreSQL; add its `bin` folder to PATH if Windows cannot find them.

### 2. Create the local database

Open PowerShell or Command Prompt and run:

```powershell
createdb -U postgres doudhvyavastha
```

If prompted, enter the password created during PostgreSQL setup. Alternatively, in `psql -U postgres`, run `CREATE DATABASE doudhvyavastha;`.

### 3. Configure environment variables

From the repository folder:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your PostgreSQL username, password, host, port, and database. `FRONTEND_ORIGINS` is the comma-separated allowlist for the local Vite origin (both standard ports are included). Replace `SESSION_SECRET` with a random value of at least 32 characters. For example, generate one in PowerShell with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Paste the generated value into `.env`. Never commit `.env`; only the placeholder `.env.example` belongs in Git.

### 4. Install dependencies and migrate

```powershell
npm.cmd install
npm.cmd run migrate
```

Migrations are ordered SQL files in `server/migrations` and are recorded in `schema_migrations`. Back up the database before applying future migrations to a database with valuable records.

### 5. Start the API and React website

Run both development services together from the project directory:

```powershell
npm.cmd run dev
```

The development launcher checks that the API and database are ready before starting Vite, watches only `server/` for API changes, and stops both services together with Ctrl+C. Open `http://localhost:5173`. `/api` requests are forwarded to the configured API port (`PORT`, default `3000`). If you prefer separate terminals, use `npm.cmd run dev:server` and `npm.cmd run dev:web`. `npm.cmd run build` creates the frontend production bundle; the Express server still needs to be deployed and configured separately.

### 7. Register your dairy

Choose **Register your dairy** and enter the owner and dairy information. The default display name is the registered business name followed by `Dudh Dairy` (unless it already ends with that phrase). Sign in after registration. No administrator approval or sample customer records are required. Edit the display name later under **Dairy settings**.

### 8. Verify independent dairy accounts

Register two accounts with different email addresses. Create a producer in each account; producer codes can match across dairies. Sign out and sign in to the other account to confirm it has its own empty producer list and dashboard. API tenant isolation is also covered by the integration test below.

### 9. Run tests and build

With PostgreSQL running, `.env` configured, and migrations applied:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

The PostgreSQL tenant-isolation test registers temporary accounts and removes their dairy/user records afterwards. If `DATABASE_URL` or `SESSION_SECRET` is absent, that integration test is skipped; a skipped test does not verify database isolation.

### 10. Back up and restore PostgreSQL

Create a compressed custom-format backup:

```powershell
pg_dump -U postgres -d doudhvyavastha -F c -f .\doudhvyavastha-backup.dump
```

Restore into a separately created, empty database (do not restore over a live database):

```powershell
createdb -U postgres doudhvyavastha_restore_test
pg_restore -U postgres -d doudhvyavastha_restore_test .\doudhvyavastha-backup.dump
```

Periodically restore a backup to a test database and verify the app and migrations there. Keep backups encrypted and access-controlled, retain them according to your business/legal needs, and store a copy outside the computer hosting the database. Test migration upgrades on a restored copy before applying them to important data.

## API overview

All private routes require a valid session cookie and a server-derived dairy membership. Mutating requests also require `X-CSRF-Token`, obtained from `GET /api/auth/csrf`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` | Registration and session lifecycle |
| `GET /api/private/me`, `PUT /api/private/dairy` | Current profile and owner-managed dairy identity |
| `/api/private/producers` | Paginated producer list and owner CRUD |
| `/api/private/producers/:id/photo` | Authenticated producer-photo read; owner upload and removal |
| `/api/private/feed-items` | Paginated feed-item list and owner CRUD |
| `/api/private/feed-issues` | Feed issue ledger and owner issue creation |
| `/api/private/advances` | Advance ledger, owner creation and audited void action |
| `/api/private/payments` | Producer payment ledger and balance-checked owner payment creation |
| `GET /api/private/producer-balances` | Current active-producer outstanding balances |
| `GET /api/private/producer-statement?producerId=…&from=YYYY-MM-DD&to=YYYY-MM-DD` | Milk, deductions, cash ledger and period balance for one producer |
| `/api/private/rate-rules` | Dairy-specific effective Fat/SNF slabs |
| `/api/private/rate-rules/import-preview`, `/api/private/rate-rules/import` | Preview a supported rate chart and bulk-save validated rows |
| `/api/private/milk-entries` | Dairy-specific collection history and owner CRUD |
| `GET /api/private/dashboard?date=YYYY-MM-DD` | Dairy-specific dashboard totals |
| `GET /api/private/reports/milk?from=YYYY-MM-DD&to=YYYY-MM-DD` | Dairy-specific report |
| Add `&format=csv` to the milk report | CSV download |

List APIs accept `page`, `limit` (maximum 100), and `search`. A dairy with no matching rate rule cannot save a collection; the API returns a setup error instead of inventing a rate.

## Local-network and production considerations

Local-only use is limited to this computer. Access from another device on a trusted LAN requires binding Vite/API to a reachable interface and firewall configuration. Access from other locations requires a properly secured deployment with HTTPS, secure cookie settings, trusted frontend origin, managed secrets, database access controls, backups, monitoring, and operational incident procedures. Do not expose the development server or PostgreSQL directly to the public internet.

Password reset requires a configured mail/SMS provider and verified delivery; no reset flow is claimed as available. Logo upload requires private object storage and validation/size controls; currently dairy branding is text plus the built-in milk-drop mark. Registration consent is collected in the UI; publish and link legally reviewed terms/privacy text before real public use.
