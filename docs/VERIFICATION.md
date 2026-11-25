# Verification — November 25, 2026

Local environment: macOS, Node v22.22.3, npm 10.9.8, PostgreSQL 14.21 (Homebrew). Linux execution and the hosted sandbox remain unverified.

- `npm run build`: passed TypeScript checking and scheduling-only server bundling.
- `npm test`: 13 passed, 0 failed, 0 cancelled, 0 skipped. Real isolated PostgreSQL transactions and local HTTP requests; no provider services, account credentials, or paid calls. Full output: TEST-RESULTS.txt.
- Chrome: loaded the loopback page; selected November 26; saved Demo Customer at 9:00; opened the existing move panel; moved it to 11:00; verified both calendar and agenda showed 11:00–11:15.
- Persistence: stopped the web server, read the synthetic reservation, stopped/restarted its dedicated demo PostgreSQL cluster, reconnected, and compared the complete selected record. Exact ID, moved start/end, and fictional customer were preserved.

The first test run caught a preparation-only cancellation-event mistake; this was fixed and all 13 tests passed afterward. The main app was not patched.

These are tests of the extracted baseline. Multi-staff behavior is intentionally absent. Not verified: original ChairChime's complete suite, Linux, live providers, production authentication, native/mobile app, or a network-isolated operating-system sandbox. Runtime code includes no outside API calls; dependency installation used npm. No real business records were imported.

Sensitive-data review uses explicit source selection and a pattern scan, not a guarantee of exhaustive secret detection. The package contains fictional fixtures only. Do not share generated databases or the main working directory.

Clean archive check: extracted into a new directory; `npm ci --offline --ignore-scripts --no-audit --no-fund`, `npm run build`, `npm test`, and `npm run check:archive` all passed. The extracted suite also reported 13 passed, 0 failed/cancelled/skipped. Offline install used this Mac's populated npm cache; this does not prove dependencies are present in the hosted sandbox.
