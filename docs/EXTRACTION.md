# Extraction boundary and adaptations

Source: the user's existing ChairChime checkout, selected files only. Original paths and SHA-256 hashes are in SOURCE-MANIFEST.json. The main checkout is untouched.

Preserved files: public/schedule.js, public/schedule-data.js, public/schedule.css.

Adapted modules:
- scheduling.ts: existing availability, business-hour rules, buffers, booking/move transactions, request recovery, and business-wide overlap handling retained. External notification and customer-contact/consent persistence removed. Local booking/move events replace provider-specific delivery jobs. No live calendar implementation is included; FakeCalendar is used in the app and injected in tests.
- owner.ts: range listing, blocks, cancellation and business scoping retained; provider-specific cancellation jobs replaced by a local event.
- settings.ts: service and hour management retained; account/profile/onboarding/voice/calendar readiness flows excluded.
- schema.sql: new minimal schema reproduces the existing business/service/reservation/receipt shape and business-wide overlap constraint, plus a local event log. It is not a migration of a production database.

New support: a small loopback-only HTTP adapter and UI wrapper for the existing calendar; explicit synthetic seed; dedicated demo/test PostgreSQL clusters; scheduling-only build; adapted integration tests. The database launcher is adapted from the user's existing EstimateIn10 local extraction. No multi-staff feature has been implemented.

Not included: live Google/Twilio/ElevenLabs/Resend integrations, AI prompts and model work, calls, audio, voice cloning, SMS/email sending, commercial onboarding, billing, deployment files, mobile app, customer/partner records, recordings, tokens, private keys, existing databases, Git history, marketing assets or unrelated docs.

Preparation is AI-assisted. This document records provenance; it is not an independently authored application answer or an assertion of assignment eligibility.
