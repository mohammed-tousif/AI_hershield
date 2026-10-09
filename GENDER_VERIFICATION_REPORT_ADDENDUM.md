# Gender Verification & Admin Workflow — Report Addendum

> Supplementary document for updating the project report. Covers everything added
> after the original report was generated: the new signup/login flow, the
> verification review process, and the expanded admin capabilities. Written to be
> copy-pasted or adapted directly into the existing report sections
> (see `PROJECT_DOCUMENTATION.md` for the base architecture doc this extends).

---

## 1. Why this was added

HerShield is positioned as a **women-only** safety platform, but the original
signup flow had no mechanism to discourage non-women from registering — anyone
could create an account with just an email, phone number, and password. Since
the app handles sensitive safety data (live location, emergency contacts,
incident reports), an unverified user base is a real trust and safety risk.

Government-ID-based verification (Aadhaar/eKYC) was considered and explicitly
**ruled out** for this stage — it requires a licensed KYC vendor integration,
DPDP Act 2023 compliance overhead, and is disproportionate for the project's
current scope. Automated ML-based gender classification from a photo was also
ruled out — these classifiers are unreliable and carry ethical/legal risk when
used as an access gate.

**The approach taken instead:** a lightweight, human-reviewed verification
layer — binding self-declaration + a live camera selfie + manual admin
approval — that raises the cost of impersonation without the overhead or
invasiveness of full identity verification.

---

## 2. Updated User Signup & Login Flow

### Before
```
Signup form (name, email, phone, password, generic ToS checkbox)
        │
        ▼
Firebase Auth account created → Firestore profile created → done
```

### After
```
Signup form (name, email, phone, password)
        │
        ▼
Declaration checkbox now reads:
"I agree to the Terms of Service and Privacy Policy, and I confirm I am
registering as a woman. HerShield is a women-only safety platform — false
declaration may result in account termination and legal liability under
IT Act 2000 §66D (impersonation)."
        │
        ▼
Firebase Auth account created → Firestore profile created
  with verificationStatus = "unverified"  (new field)
        │
        ▼
User logs in → lands on Dashboard
        │
        ▼
Dashboard shows a "Verify your account" banner (dismissible only by
completing verification, not by closing it) with an
"Open Camera to Verify" button
        │
        ▼
User clicks it → browser requests live camera access (getUserMedia)
→ live video preview appears → user clicks "Capture Photo"
→ preview shown with Retake / Submit options
        │
        ▼
On Submit: photo uploaded → verificationStatus = "pending"
→ banner changes to "Verification pending — you can keep using
  HerShield in the meantime"
        │
        ▼
Admin reviews the submission (see Section 3) → Approves or Rejects
        │
        ├── Approved → verificationStatus = "verified" → banner disappears
        │
        └── Rejected → verificationStatus = "rejected", with a reason shown
            to the user → banner reappears with "Please try again" +
            the reason + a fresh "Open Camera to Verify" button
```

### Key design decision: verification is informational, not a gate

**Nothing in the app is blocked by verification status.** An unverified,
pending, or even rejected user can still use Emergency Alert / SOS, Live
Tracker, Safety Map, Community, and LexaShield exactly as before. This was a
deliberate choice: a safety app must never risk delaying real emergency help
behind a pending admin review queue. Verification exists purely to feed the
admin's judgment about which accounts might need a closer look or removal —
see Section 4 for how that plays out.

### Why live camera capture instead of a file upload

The first version of this feature used a plain `<input type="file">` for the
selfie. This was changed to a live `getUserMedia` camera capture (no gallery
access) after recognizing that a file picker lets someone submit *any* image
file — including a photo of someone else entirely, defeating the purpose of
the check. Live capture at least proves a real camera and a real person were
in front of the device at the moment of submission.

Flow: **Open Camera → live `<video>` preview → Capture Photo (drawn to a
`<canvas>`) → still preview with Retake/Submit → Submit uploads the captured
frame as a JPEG.** The camera stream is stopped immediately after capture and
never sent anywhere raw — only the single captured frame is uploaded.

---

## 3. Admin Workflow — Verification Review Queue

A new **"Verifications"** tab was added to the existing admin dashboard
(alongside Overview, Users, Community Posts, Safety Alerts, etc.).

### What the admin sees
| Column | Content |
|---|---|
| Selfie | A small thumbnail of the submitted photo |
| Name / Email | The account's declared name and email |
| Submitted | Relative time since submission (e.g. "2h ago") |
| Status | Pending / Verified / Rejected / Unverified, filterable via a dropdown |
| Actions | Approve / Reject (only shown for pending items) |

### Viewing the photo properly
Clicking a thumbnail opens a **lightbox** (full-size view in a modal) — the
44px table thumbnail alone isn't large enough to actually judge a submission,
so this was added specifically to make the review meaningful rather than
cosmetic.

**Security note for the report:** selfies are never served as public files.
There is no public URL for any submitted photo — every image is fetched
through an admin-authenticated API endpoint (`GET
/api/admin/verifications/:userId/selfie`), which streams the file only after
verifying the admin's session token. Even the thumbnail in the table is
loaded this way (as an authenticated blob, not a plain `<img src="...">` URL).

### Approve
Sets the account to `verified`. Banner disappears from that user's dashboard
on next load. Logged to the audit trail (`hershield_admin_logs`).

### Reject
Admin provides a **reason** (shown to the user) and an optional checkbox:
**"Also disable this account"** — for cases that look like clear
impersonation rather than just a bad photo. If checked:
- The account is marked inactive in the database, **and**
- The actual Firebase Authentication account is disabled server-side, so
  the person is immediately signed out and cannot log back in at all
  (Firebase returns `auth/user-disabled` on their next login attempt).

Both approve and reject actions are logged with the admin's identity, the
reason (if any), and a timestamp.

---

## 4. Admin Workflow — General User Management (independent of verification)

A **Deactivate / Reactivate / Delete** capability was added directly to the
existing Users tab, for any account, at any time — not only in response to a
failed verification. This gives the admin ongoing moderation power, e.g. for
handling user reports or abuse unrelated to the signup check.

| Action | Effect | Reversible? |
|---|---|---|
| **Deactivate** | Marks the account inactive + disables the real Firebase Auth login (`auth/user-disabled`) | Yes — Reactivate restores login |
| **Reactivate** | Re-enables both the account flag and Firebase Auth login | — |
| **Delete** | Permanently removes the Firestore profile **and** the Firebase Auth account **and** any verification selfie on disk | **No — irreversible** |

Design note: deleting a user does **not** cascade-delete their community
posts, incident reports, or SOS history — those remain for community/audit
integrity, just detached from a live account. This is a common pattern (same
principle as most platforms not scrubbing a deleted user's public
contributions).

Every one of these actions requires a confirmation dialog in the UI and is
recorded in the audit log.

---

## 5. Data Retention Policy — 90-Day Selfie Auto-Purge

Since a verification selfie is only needed for the (short) admin review
window, the system automatically **deletes the photo file 90 days after
submission**, regardless of whether the account ended up verified, rejected,
or still pending. This runs as a background sweep (once at server startup,
then once every 24 hours) — no manual admin action required.

Important: **only the photo file is deleted.** The account's
`verificationStatus` (e.g. `"verified"`) is left untouched — a verified user
stays verified after their photo is purged; the system doesn't need to keep
the biometric image around once the human decision has been made and enough
time has passed. This limits how long a sensitive photo sits on the server
without changing anyone's access.

---

## 6. Technical Reference (for a methodology/architecture appendix)

### New files
| File | Purpose |
|---|---|
| `middleware/requireAuth.js` | Verifies a Firebase ID token server-side and attaches a trustworthy `{uid, email}` to the request — used so a verification submission can't be spoofed as coming from a different user |
| `routes/verification.js` | `POST /api/verification/submit` (selfie upload), `GET /api/verification/status` (own status) |
| `services/verificationRetention.js` | The 90-day auto-purge sweep |

### Modified files
| File | What changed |
|---|---|
| `routes/users.js` | New user documents now include `gender`, `verificationStatus`, and related fields |
| `routes/admin.js` | New endpoints: verification review queue (list/approve/reject/view-selfie) and general user management (deactivate/reactivate/delete) |
| `auth.html` | Signup declaration text updated |
| `dashboard.html` | Verification banner + live camera capture UI |
| `admin-dashboard.html` | New "Verifications" tab; Deactivate/Reactivate/Delete buttons on the Users tab; selfie lightbox |
| `server.js` | Mounts the new verification route; starts the retention sweep |

### New Firestore fields on each user document
`gender`, `verificationStatus` (`unverified` \| `pending` \| `verified` \|
`rejected`), `verificationSelfiePath`, `verificationSubmittedAt`,
`verificationReviewedAt`, `verificationReviewedBy`,
`verificationRejectionReason`.

### Notable engineering decisions worth citing in the report
- **Identity trust for the review process:** most of the app's existing
  routes trust a client-supplied email/user ID with no server-side check.
  The verification submit/status endpoints deliberately don't follow that
  pattern — they require a real, cryptographically verified Firebase ID
  token, so the review process can't be tricked into reviewing (or
  approving) the wrong account.
- **Selfies are never publicly hosted.** Unlike community post images
  (which are meant to be public and are served as static files), verification
  selfies are stored outside the public web root and only ever served through
  an authenticated admin route.
- **Defense-in-depth in file handling:** both the upload path and the
  admin-facing selfie route use `path.basename()` before touching the
  filesystem, preventing path-traversal even though the filenames are
  already server-generated and not directly attacker-controlled.

---

## 7. Honest Limitations (recommended to state explicitly in the report)

For academic/hackathon integrity, it's worth the report stating plainly what
this feature does **not** do, rather than overselling it:
- It does not cryptographically verify gender — no system can, without
  invasive government ID checks, which were deliberately out of scope here.
- It relies on human judgment (the admin) for the actual review — it is a
  moderation aid, not an automated guarantee.
- It does not restrict any app functionality by verification status
  (a conscious safety trade-off, not an oversight — see Section 2).
