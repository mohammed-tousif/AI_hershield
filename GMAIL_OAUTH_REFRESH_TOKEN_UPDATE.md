# Gmail OAuth Refresh Token — How to Update It

This is the runbook for when SOS/notification emails stop sending because the
Gmail OAuth refresh token has expired or been revoked. Email delivery goes
through the Gmail REST API (not SMTP — see [`services/emailService.js`](services/emailService.js)
for why), authenticated via `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET`
/ `GMAIL_OAUTH_REFRESH_TOKEN`.

## Symptoms

- Guardians/contacts stop receiving SOS emails, live-tracker alerts, or other
  notification emails, with no obvious cause elsewhere in the app.
- Server logs show `sendMail` failing.
- Directly querying Google returns:
  ```json
  { "error": "invalid_grant", "error_description": "Token has been expired or revoked." }
  ```

## Step 0 — Confirm this is actually the problem

Run this locally (uses the values already in your `.env`):

```bash
node -e "
require('dotenv').config();
const { google } = require('googleapis');
const client = new google.auth.OAuth2(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN });
client.getAccessToken().then(t => {
  console.log('SUCCESS: access token obtained, refresh token is valid.');
}).catch(e => {
  console.log('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message);
});
"
```

- `SUCCESS` → the token is fine, look elsewhere (e.g. `EMAIL_USER` mismatch,
  Render env vars not set, network/DNS issue).
- `FAILED: invalid_grant ...` → proceed with the steps below.

## Step 1 — Generate a new refresh token (OAuth Playground)

You'll need the existing `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET`
(from your `.env` or the Google Cloud Console → APIs & Services → Credentials
page) and to be signed into the Gmail account that sends the emails
(`EMAIL_USER`, e.g. `hershieldsupport@gmail.com`).

1. Open **[developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)**.
2. Click the **gear icon** (top-right) → **"OAuth 2.0 Configuration"** panel.
3. Check **"Use your own OAuth credentials"**.
4. Paste in:
   | Field | Value |
   |---|---|
   | `OAuth Client ID` | your `GMAIL_OAUTH_CLIENT_ID` |
   | `OAuth Client secret` | your `GMAIL_OAUTH_CLIENT_SECRET` |
5. Close the panel.
6. In **Step 1 ("Select & authorize APIs")**, find the **"Input your own scopes"**
   box and paste:
   ```
   https://www.googleapis.com/auth/gmail.send
   ```
7. Click **Authorize APIs**.
8. Sign in as the `EMAIL_USER` Gmail account. If you see an "unverified app"
   warning, click **Advanced → Go to (app name) (unsafe)** — this is expected
   for our own app and safe to click through. Then **Allow**.
9. You land back on the Playground in **Step 2 ("Exchange authorization code
   for tokens")**, with an authorization code already filled in. Click
   **Exchange authorization code for tokens**.
10. A **Refresh token** field appears with a value starting `1//...`. **Copy
    the entire string** — this is the new token.

## Step 2 — Update the token everywhere it's configured

The token is used in two independent places; update both.

### A. Local `.env`

Open `.env` in the project root and replace the value:

```
GMAIL_OAUTH_REFRESH_TOKEN=<paste new token here>
```

### B. Render (production)

1. Log into [dashboard.render.com](https://dashboard.render.com).
2. Open the `hershield-api` service.
3. Go to the **Environment** tab.
4. Find `GMAIL_OAUTH_REFRESH_TOKEN` and paste the new value.
5. Save — Render automatically redeploys the service to pick up the new
   env var (no `git push` needed for this step).

## Step 3 — Verify

**Locally** — re-run the Step 0 script; it should now print `SUCCESS`.

**Production redeploy** — check the health endpoint reports email as
configured:
```bash
curl -s https://ai-hershield.onrender.com/api/health
```
Look for `"email": { "configured": true, "user": "..." }` in the response.

**Real send test** — send one real test email to yourself (not a real
guardian contact) through the actual send path:
```bash
node -e "
require('dotenv').config();
const emailService = require('./services/emailService');
emailService.sendMail({
  to: process.env.EMAIL_USER,
  subject: '✅ HerShield OAuth token test',
  html: '<p>Test email confirming the refresh token works end-to-end.</p>'
}).then(r => console.log('SEND SUCCESS:', JSON.stringify(r))).catch(e => console.log('SEND FAILED:', e.message));
"
```
A `SEND SUCCESS` with a Gmail message id confirms the full path (local code →
Gmail API → inbox) works. Since Render uses the same credentials, this is
strong evidence the production path works too — you can additionally confirm
by triggering a real SOS test through the app itself if you want full
end-to-end proof from the deployed server.

## What actually causes the token to expire

It's tempting to blame the OAuth consent screen's "Testing" publishing status
(Google auto-expires refresh tokens after 7 days for apps in Testing mode).
**Check this first** (Google Cloud Console → APIs & Services → OAuth consent
screen → Audience → Publishing status) — but if it already says **"In
production"**, that is *not* the cause, and there's nothing to change there.

More likely causes when the app is already in production:

- **Google's ~50-refresh-token cap per OAuth client + account.** Every time
  someone re-runs the OAuth Playground consent flow for the same client and
  account, a new refresh token is issued. Once the cap is hit, Google
  silently invalidates the oldest outstanding token — which may be the one
  currently in use. Avoid re-authorizing unless you actually need a new
  token.
- **Manual or automatic revocation** — a password change on the sending
  Gmail account, or someone visiting
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  and revoking access to this app, invalidates the token immediately.
- **6 months of inactivity** — unused refresh tokens expire. Not applicable
  here as long as the app is actively sending email.

## Related files

- [`services/emailService.js`](services/emailService.js) — Gmail API client, `isConfigured()`, `sendMail()`
- [`routes/liveTracker.js`](routes/liveTracker.js) — live-tracker SOS/alert emails
- [`routes/emergencyLite.js`](routes/emergencyLite.js) — SOS emergency emails
- [`.env.example`](.env.example) — one-time OAuth *client* setup notes (creating the Client ID/Secret in the first place, separate from refreshing the *token*)
- [`render.yaml`](render.yaml) — deployment config (note: `GMAIL_OAUTH_*` vars are set manually in the Render dashboard, not listed in this file)
