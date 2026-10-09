# HerShield hardening and responsiveness

Implementation record: 8–9 October 2026. This describes the current local changes, not a deployed production certification. The broader project inventory is in PROJECT_DEEP_AUDIT.md.

## Architecture and trust boundaries

The frontend is a multi-page HTML/CSS/JavaScript application, using Bootstrap, Firebase Authentication, Google Maps and Socket.IO. Firebase Hosting serves a dedicated `dist` directory. The Node/Express backend uses Firebase Admin and Firestore, with configured email, Cloudinary and optional messaging/AI providers. Archived Python prototypes are outside the public deployment.

`middleware/publicAssets.js` is the single allowlist for Express assets and `scripts/build-public.js`. The hosting build contains only the 21 named frontend files; repository files, service-account credentials, uploads, local databases and audit documents are excluded. Unknown existing build entries cause the build to stop for inspection. Referrers are disabled to reduce share-token leakage.

`middleware/apiAccess.js` authenticates APIs by default, apart from an explicit list of public reads and the minimal share-link viewer. Firebase bearer tokens are verified including revocation checks. Account IDs and email addresses come from the verified identity. Profile, contacts, private history, tracking reads and mutations require ownership. Multipart community writes restore authoritative identity after upload parsing. Admin routes use a separate JWT guard, an explicitly configured secret of at least 32 characters and HS256 verification.

Threats addressed: repository/credential disclosure over HTTP; anonymous private data access; cross-account object access and forged actor IDs; reusable plaintext PINs; predictable or permanent sharing links; unauthorized socket publishing; public reporter identity leakage; false safety confirmation after network failure.

## PINs, tracking and notification semantics

New PINs use bcrypt with cost 12. Raw PINs and hashes are removed from JSON responses. Legacy plaintext and unsalted hashes are not accepted. PIN attempts are limited by authenticated account. The client never stores a live-tracking PIN in localStorage and clears the start input after success.

Tracking links use 32 random bytes, expire within 24 hours (or the shorter SOS timer), and stop working once the session ends. Raw session IDs are not viewer credentials. Public viewers receive only the current location, accuracy, timestamp, expiry and opaque session ID. They show stale/unknown location feedback. Failed GPS never becomes a fabricated coordinate.

Socket tracking rooms require the same live capability. Clients cannot publish location/emergency/end events. Authenticated REST writes drive notifications; the viewer rechecks REST before rendering. Viewers are evicted when sharing ends and checked every 15 seconds for expiration. Polling remains available if sockets are unavailable. A link is a bearer capability: anyone given the link can view it until it expires or is stopped.

PIN verification must receive both an HTTP success and `success: true` before showing Safety Confirmed. A failed request leaves the verification timeout active. An ended session cannot be verified or trigger a new alert.

WhatsApp remains unavailable/mocked. Unconfigured SMS returns unavailable, not delivered. Provider acceptance is distinguished from guaranteed recipient delivery. No new paid integration was enabled. SOS creation may succeed while notifications fail: the session and delivery results are separate, and the UI explains that contacts must be called if necessary.

## Slow connections and frontend behavior

Navigation no longer waits for Firebase module imports. Email login does not wait for optional profile synchronization or avatar downloads. Artificial login/button delays were removed. Dashboard Maps loads on approach to the map, independently of page navigation, with an explicit failure state.

The shared API transport routes requests to the intended backend, preserves supplied authorization, attaches Firebase tokens only to trusted private APIs, and bounds HTTP headers and body download. GETs have a 15-second deadline, ordinary writes 30 seconds and multipart uploads 45 seconds. Slow requests show a connection notice after 5 seconds. Authentication initialization is also bounded. Writes are never automatically retried, since a timed-out request may have reached the server.

Identical unauthenticated public reads are deduplicated and cached in memory for 15 seconds; mutations clear the cache. Private responses and live locations are not cached. Caller cancellation is preserved. Statistics failures show unavailable rather than invented zero totals. Client deadlines do not cancel a Firestore mutation already accepted by the server.

Shared responsive styles and behavior keep dialogs above navigation, move them outside transformed ancestors, preserve scrollable bodies and reachable close controls, and provide focus handling and named menu buttons. Mobile admin navigation has a toggle and overlay. Dashboard statistics use a compact two-column layout on phones. Reduced-motion preferences and visible keyboard focus are supported.

Closing an SOS dialog keeps the session active; only server-confirmed PIN verification stops sharing. Safety confirmation uses one Bootstrap dialog at a time. Contact names and relationship details render as plain text, and failed deletions keep the contact visible. Pending location uploads prevent concurrent uploads on slow connections.

## Verification and practical limits

Run `npm test`, `npm run verify` and `npm run build`. Tests use synthetic users and mocked persistence/providers; they do not send messages or modify Firebase. `tests/preview-server.js` provides an isolated mobile UI fixture with provider maps disabled. It does not prove real Firebase sign-in, Google Maps configuration, notification delivery or multi-device GPS behavior.

The security scanner flags local ignored service-account JSON files as secrets at rest. They are intentionally not printed, deleted or included in the public build. Generic innerHTML warnings must be reviewed in context: constant templates, escaped values and static icon snippets are distinct from untrusted HTML. The tracked prototype Gemini credentials were replaced with `GEMINI_API_KEY` environment reads; historical copies still require rotation.

Local verification on 9 October: 18 regression tests passed; syntax validation covered 64 JavaScript files and inline scripts; the public build contained 21 assets. Browser phone checks covered dashboard, contact dialogs, community, live-tracker, sign-in and admin layouts at narrow widths including 320 pixels. The contact close button was confirmed unobstructed, its body scrollable, contact HTML rendered literally, and the admin menu closed after section selection. These are synthetic-preview checks; real authentication, maps and delivery still need deployment acceptance.

Remaining operational limits: in-memory rate limits and SOS timers assume one backend process; no durable notification queue or delivery receipts; the browser must remain open for reliable tracking and safety prompts; mobile operating systems can suspend background location/timers; public safety reports are informational, not an assurance of safety; external SDK/CDN availability and free-host cold starts remain outside application control. Test the actual deployed build with two accounts and physical phones before relying on it.

## Deployment and credential remediation

### Email OTP verification

Manual signup now visits `verify-email.html?next=identity` before the existing identity step. The signup screen automatically requests a code if no current challenge/cooldown exists. Existing authenticated users see an unverified-email banner and a profile link; they request a code explicitly. Verified emails show a distinct **Verified email address** status. This does not claim identity or phone verification. Safety tools remain accessible to unverified accounts; this feature is email ownership verification, not an API authorization gate or a passwordless login system.

The authenticated `/api/email-verification/status`, `/send`, and `/verify` endpoints derive the recipient from a fresh Firebase Admin user lookup. They reject stale email identities, disabled accounts, and accounts without email. Request-body UID, email, and verified flags cannot select a different account or set verification. Firebase/provider-verified email addresses retain their status. Custom OTP completion is stored in the server-only Firestore `emailVerification/{uid}` record, bound to that exact email; it does not change the Firebase Auth `emailVerified` claim. Any future authorization policy must use the same server-side status check rather than an arbitrary profile field or stale client token. An email change makes the old app verification inapplicable.

Codes use cryptographic six-digit generation, bcrypt cost 12 storage, a five-minute server-enforced expiry, and transactional consumption. The code appears only in the outgoing email; no code or hash appears in API responses or application logs. Gmail API delivery failures invalidate the reserved challenge and report an error. Gmail acceptance does not guarantee inbox delivery. A 60-second resend cooldown and five sends per hour apply per UID, with an additional email-address budget in `emailVerificationLimits/{sha256(email)}`. Verification allows five guesses per challenge and ten per account per hour, including across resends. These counters are transactional and shared across backend processes/restarts. A replacement challenge invalidates its predecessor. No new OTP signing secret or paid messaging provider is required.

Firestore client rules deny access to both collections. `emailVerificationLimits.deleteAfter` may optionally be configured for Firestore TTL cleanup; it is not required for enforcement. The account record is retained for verified status and overwritten for subsequent challenges; OTP hashes are cleared after successful use or delivery failure. Expired codes are always rejected, even if their record has not been cleaned up. Normal project retention/account-deletion procedures should include both collections. An authenticated attacker can still create many accounts; the existing IP/API limit provides a coarse additional limit, and high-volume deployment would need stronger anti-abuse controls. Limits intentionally count failed delivery attempts to avoid provider retry storms.

The UI keeps codes out of URLs/storage, shows pending/error/success states, disables duplicate submissions, and uses the existing bounded network layer without automatic write retries. The standalone page uses no font or UI-library CDN dependencies. The next-page parameter is a fixed allowlist, preventing open redirects. Existing-provider status is never downgraded by rollout.

Verification tests use mocked Firebase, transactional persistence, and email delivery, including ownership, expiry, attempt budgets, delivery failure, concurrent requests, restart-style service recreation, and email changes. The local browser fixture uses a synthetic code solely for layout/interaction checks, is excluded from the public build, and does not implement a production bypass. Inbox delivery, live Firestore persistence/rules, deployment, and two-account acceptance still need live verification with an approved recipient. Reuse the existing `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`, and `EMAIL_USER` environment values; do not paste secrets into chat.

Email-feature checks on 9 October: 29 tests passed; syntax validation covered 67 JavaScript files/inline scripts; the public build contains 24 allowlisted assets. Chrome synthetic checks at 320px and 390px covered automatic signup-code request, resend countdown, incorrect-code feedback, successful verification, and the dashboard's unverified-to-verified status change. The new route, service, and client script produced no scanner findings; existing constant/escaped HTML pattern warnings elsewhere in the frontend remain as described above. Google's OAuth endpoint accepted the existing local Gmail refresh credentials (HTTP 200), with the `gmail.send` scope. No credential values were printed and no email was sent. This confirms OAuth validity at the time of the check, not inbox delivery or deployed environment configuration.

### Release checks

1. Rotate/revoke any service-account and prototype API credentials that were exposed by the old root-serving deployment. Blocking the URL does not invalidate a copied credential. Restrict the public Maps browser key to the intended domains/APIs. These cloud changes have not been performed here.
2. Configure replacement Firebase Admin credentials through the hosting secret/environment mechanism, and configure a strong `ADMIN_JWT_SECRET`. Never copy secret files into `dist`.
3. Coordinate a maintenance window for legacy tracking cleanup. `node scripts/expire-legacy-tracking.js` is read-only and prints counts only. Review those counts, back up the affected collections, and then use `--apply --project-id <exact-project-id>` to remove old PIN material and expire insecure sessions. The apply step has not been run. Users must start new journeys and share new links.
4. Run the test, syntax and public-build checks, then deploy the backend and frontend together. Update the existing backend/frontend origins if the deployment domains change. Revoke active legacy sessions during rollout; do not mix old clients with the hardened API.
5. Verify anonymous private requests fail; account A cannot access account B; secret/source URLs return no secret contents; owner PIN verification fails safely; a shared link works only while active; SMS/WhatsApp remain explicitly unavailable; admin authentication works with the configured secret. Confirm real email delivery only with approved test recipients.

These changes are ready for local review. Cloud credential rotation, deployment, legacy-data migration and real-provider/device acceptance are separate outstanding release checks.
