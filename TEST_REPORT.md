# AutoWala Existing Application Test Report

Date: 2026-09-24

Scope: Non-destructive testing of the existing application only. No new feature, UI redesign, database mutation, real payment, or secret inspection was performed.

## Summary

| Total test suites | Passed | Failed | Not verified |
| ---: | ---: | ---: | ---: |
| 14 | 1 | 2 | 11 |

**Bugs fixed:** 0. No reproducible application bug was found during the checks that could be safely fixed without changing existing behavior. This report file is the only file created in this test run.

## Test results

### 1. Project and Metro — FAIL

- **Checks:** `npm install`, `npx tsc --noEmit`, existing tests, route export, lint, Expo start.
- **PASS:** Dependencies are installed and `npm install` completed successfully. TypeScript passed. The Razorpay signature test passed. `npm test --if-present` exited successfully, but no root application test script exists. Expo web export completed and enumerated the existing routes.
- **FAIL:** Full `npx expo lint` has one existing error in `src/hooks/use-color-scheme.web.ts:11` (`react-hooks/set-state-in-effect`). Targeted lint for the application directories passed.
- **FAIL:** `npx expo start` did not reach a usable Metro server in this environment. The CLI reported that it could not reach its versions endpoint and remained unavailable; port 8081 was also occupied by an unrelated existing Node process.
- **Fix applied:** None. The lint failure is outside the requested feature scope, and the Expo start issue was not a reproducible application bundling failure.
- **Retest:** `npx expo export --platform web` passed, confirming Metro bundling and route compilation. `npx tsc --noEmit` passed.

### 2. User authentication — NOT VERIFIED

- **Checks:** registration, validation, duplicate email, login, wrong password, logout, and session persistence.
- **Error/blocker:** Requires a reachable Supabase project and test user accounts. No authentication mutation or real account operation was performed.
- **Fix applied:** None.
- **Retest:** Not performed; no real credentials or user data were used.

### 3. Rider authentication — NOT VERIFIED

- **Checks:** rider registration, validation, document upload, pending status, login, and logout.
- **Error/blocker:** Requires Supabase Storage/database access and a device or compatible upload runtime for document selection.
- **Fix applied:** None.
- **Retest:** Not performed.

### 4. Admin — NOT VERIFIED

- **Checks:** admin login, user/rider lists, pending rider review, approve/reject/block, and normal-user access denial.
- **Error/blocker:** Requires configured Supabase data with an administrator account and separate normal-user account. No admin data mutation was performed.
- **Fix applied:** None.
- **Retest:** Not performed.

### 5. Booking — NOT VERIFIED

- **Checks:** pickup, destination, passenger count, vehicle selection, ride creation, fare calculation, and ride status.
- **Error/blocker:** Requires a reachable Supabase backend and test account/session. No fake ride or fake successful booking was created.
- **Fix applied:** None.
- **Retest:** Not performed.

### 6. Rider ride lifecycle — NOT VERIFIED

- **Checks:** online/offline, receiving requests, accept, reject, start, complete, and cancel.
- **Error/blocker:** Requires coordinated passenger/rider accounts, approved rider data, and live Supabase state.
- **Fix applied:** None.
- **Retest:** Not performed.

### 7. GPS and maps — NOT VERIFIED — DEVICE/API REQUIRED

- **Checks:** permission, current location, map loading, pickup/destination, route/distance, and rider location.
- **Error/blocker:** Requires a physical device or development build with location permission and configured external map services. Web bundling does not verify device GPS behavior.
- **Fix applied:** None.
- **Retest:** Not performed; no location permission was requested.

### 8. Live tracking and Realtime — NOT VERIFIED — DEVICE/API REQUIRED

- **Checks:** rider location updates, passenger updates, Realtime subscription, cleanup, and update frequency.
- **Static review:** `services/locationService.ts` uses a 25-meter distance interval and 10-second time interval. `services/trackingService.ts` returns a cleanup function that removes the Supabase channel.
- **Error/blocker:** Runtime Realtime delivery and device location updates require two authenticated clients and a reachable Supabase project.
- **Fix applied:** None.
- **Retest:** Not performed.

### 9. Razorpay payment — NOT VERIFIED — EXTERNAL API REQUIRED

- **Checks:** order creation, checkout response, backend signature verification, payment update, failure handling, and duplicate prevention.
- **PASSING subchecks:** `node server/src/paymentVerification.test.mjs` passed. Server syntax checks passed. The local server health endpoint returned `{"ok":true}` using dummy server-only test values.
- **Error/blocker:** No Razorpay order or checkout was initiated. The configured key may be live, so no real transaction was attempted. External order creation, payment response handling, Supabase payment mutation, and end-to-end duplicate verification remain unverified. A native Razorpay checkout also requires a compatible development build.
- **Fix applied:** None.
- **Retest:** Signature logic and server health passed; live/external payment flow was intentionally not run.

### 10. Security scan — PASS (static review)

- **Checks:** hardcoded passwords, service-role keys, Razorpay secrets, private API keys, exposed credentials, public sensitive documents, and RLS definitions.
- **Result:** Source scan excluding `.env`, dependencies, and lockfiles found no credential values. Server-only secrets appear only as expected environment-variable names. The schema statically contains RLS enablement and bounded policies for the application tables; payment client code does not directly mark payments as paid.
- **Fix applied:** None.
- **Retest:** Static scan completed with no exposed secret values. Runtime authorization and Storage policy behavior remain covered by Test 11 and were not verified against a live project.

### 11. Database — NOT VERIFIED — SUPABASE REQUIRED

- **Checks:** profiles, riders, rides, ride_locations, payments, ratings, complaints, notifications, foreign keys, and RLS.
- **Static review:** `supabase/schema.sql` contains the requested tables, foreign keys, indexes, updated-at triggers, payment Razorpay fields, RLS enablement, and scoped policies.
- **Error/blocker:** The SQL was not executed in Supabase, so live constraints, migrations, RLS behavior, and existing-data compatibility were not verified.
- **Fix applied:** None.
- **Retest:** Not performed; no database writes were made.

### 12. Error handling — NOT VERIFIED

- **Checks:** no internet, API failure, Supabase failure, denied location, invalid input, loading states, and empty states.
- **Error/blocker:** These cases require controlled runtime failures against the app and backend. No network disruption, account mutation, or permission prompt was forced.
- **Fix applied:** None.
- **Retest:** Not performed.

### 13. Performance — NOT VERIFIED — DEVICE/API REQUIRED

- **Checks:** memory leaks, repeated API calls, location update frequency, and Realtime cleanup.
- **Static review:** Location updates are bounded to 25 meters or 10 seconds, and the tracking service exposes channel cleanup.
- **Error/blocker:** No device profiler, long-running session, or live Realtime session was available for runtime measurement.
- **Fix applied:** None.
- **Retest:** Not performed.

### 14. Build and release checks — FAIL

- **PASS:** TypeScript typecheck passed. Expo web export passed and Metro produced the existing route bundles.
- **FAIL:** Full lint has the pre-existing `use-color-scheme.web.ts` hook-rule error. `expo-doctor` reported six Expo patch-version mismatches in the installed dependency set (`@expo/ui`, `expo`, `expo-glass-effect`, `expo-linking`, `expo-location`, and `expo-router`). No automatic dependency fix was run because this task is test-only.
- **Error/blocker:** A native iOS/Android build was not run; the environment has no verified device/simulator session for the requested runtime checks.
- **Fix applied:** None.
- **Retest:** Web export and typecheck passed; full lint and doctor remain as reported.

## Commands run

- `npm install`
- `npx tsc --noEmit`
- `node server/src/paymentVerification.test.mjs`
- `node --check server/src/index.mjs`
- `node --check server/src/paymentVerification.mjs`
- `npm test --if-present`
- targeted `npx expo lint` for `src/app`, `components`, and `services`
- full `npx expo lint`
- `npx expo-doctor`
- `npx expo export --platform web --output-dir /private/tmp/autowala-payment-export`
- local payment server `/health` check with dummy values only
- `git diff --check`

## Remaining blockers

1. Expo CLI start was not usable in this environment because of the network/port condition described above, although web export bundling passed.
2. Full lint has one pre-existing hook-rule error in `src/hooks/use-color-scheme.web.ts`.
3. Expo Doctor reports patch-version mismatches; they were not changed during this test-only run.
4. Supabase-backed auth, database, RLS, Storage, admin, booking, and Realtime flows require a reachable configured Supabase project and test accounts.
5. GPS, maps, document upload, and live tracking require a physical device or compatible development build.
6. Razorpay end-to-end behavior requires a safe test environment and must not be exercised with the configured live key without explicit authorization.
