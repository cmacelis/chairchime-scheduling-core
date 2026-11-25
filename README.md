# ChairChime Scheduling Core

Standalone, MIT-licensed local extraction of ChairChime's existing single-barber scheduling behavior. This is a preparation baseline, not the proposed multi-staff implementation. It has not been submitted or approved.

The scheduling engine, owner operations, settings, and calendar view come from selected existing ChairChime files. Multi-staff assignments, staff-specific hours, staff/service eligibility, and reassignment remain unfinished. The database still prohibits concurrent appointments across an entire business.

## Requirements

- Node.js 22.12+ and npm.
- PostgreSQL server tools `initdb`, `pg_ctl`, and `psql` on PATH, with `btree_gist` installed.
- macOS or Linux and an ordinary non-root user. PostgreSQL cannot initialize as root.
- Initial package installation requires an allowed registry/mirror or populated cache. Runtime needs no internet, accounts, secrets, Docker, microphone, or paid services.

## Run

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4327** (use this exact host). The app uses a fictional Juniper Demo Barbers shop; a second fictional shop exists only for tenant-isolation tests. There are no real customers or appointments. Add a fictional appointment on an upcoming date to try the workflow. Each shop currently represents one schedulable person. Owner mode is a deliberate local demo, not production authentication.

The day/week/month calendar supports booking, moving, cancelling and blocking time. Appointments persist between server restarts. No calendar copy, message, or notification is delivered; `outbox` is only a local event record.

Startup creates a dedicated PostgreSQL cluster beneath `.local/demo`. PostgreSQL listens only on a private, project-specific Unix socket beneath /tmp, not TCP. This short socket path also supports long extraction paths. The web server listens only on loopback. Original ChairChime databases, generic `DATABASE_URL`, provider environment variables, and account credentials are not used. `CHAIR_EXTRACT_PORT` changes the web port.

Stop the web server with Ctrl-C, then stop its dedicated database:

```sh
npm run db:stop
```

## Verify

```sh
npm run build
npm test
npm run check:archive
```

Tests create and reset **only** the separate `.local/test` cluster and stop it afterward. They do not connect to an existing database. Integration checks cover concurrency, retries, conflicts, buffers, blocks, rescheduling rollback, business isolation, service retirement, HTTP booking, and persistence across database connections. See `docs/VERIFICATION.md` for actual results and limits.

Do not run the original ChairChime test suite against an existing database; it has a different setup. The tests here are an adapted baseline, not the original complete app suite.

## Source and publication boundary

See `docs/SOURCE-MANIFEST.json` for original source hashes and `docs/EXTRACTION.md` for changes. This preparation used AI assistance; it must not be represented as independently authored worker material. Confirm the program's rules permit this prepared code before using it for an assignment.

The MIT license applies to **this standalone distribution only**, copyright 2026 Chuler Macelis. It grants no rights to the rest of ChairChime, its private repository, data, assets, or integrations. Dependencies retain their own licenses. `private: true` prevents accidental npm publication; it is not a GitHub visibility setting.

Only the explicitly allowlisted source archive should be shared. Exclude `.local`, `node_modules`, `dist`, environment files, screenshots, original history, and the main app. Do not upload the working directory wholesale. No GitHub repository or visibility was changed during preparation.
