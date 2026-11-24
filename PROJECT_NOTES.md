# Personal Treasury Manager — handoff notes

## What it is
A single-user "small bank" ledger for money held for family and friends. UI is Arabic/English (RTL-aware), built for an iPhone home-screen web app.

- **Live:** https://adhamdoma2019-sketch.github.io/aSaaS-For-Personal-Treasury/ (GitHub Pages, repo `adhamdoma2019-sketch/aSaaS-For-Personal-Treasury`; files in the repo root: `index.html` = the built `treasury-manager.html`, and `icon.png`)
- **Data:** Firebase Firestore, project `asaas-for-personal-treasury`. One document `users/{uid}` holds everything: `accounts, counterparties, transactions, auditLog, gameyas, lang, lastBackupAt, lastDriveSyncAt`.
- **Auth:** Firebase email/password, one user. Rule: `match /users/{userId}/{document=**} { allow read, write: if request.auth != null && request.auth.uid == userId; }`
- **Google Drive export:** Google Identity Services token client, scope `drive.file`, Drive API enabled, OAuth origin `https://adhamdoma2019-sketch.github.io`, user added as a test user. Client ID and Firebase client config are in `build.py` / the source.

## Files
- `index.html` — **the master source now.** The old `treasury-manager.jsx` / `build.py` / `icon-shim.jsx` no longer exist; the app's compiled (readable, un-minified) script lives directly in `index.html` and is edited in place. This is the file you upload to GitHub.
- `prep.js` — extracts the app script from `index.html` into `app-compiled.js` for the tests.
- `test-helpers.js` — gam'eya plan/forecast unit tests. `test-app.js` — renders the whole App with mocked Firestore (incl. the `shares` collection) and drives real flows, including the personal-link flows.
- **Run after every change:** `npm i react@18.3.1 react-test-renderer@18.3.1` then `node prep.js && node test-helpers.js && node test-app.js` (the sandbox is wiped between turns; only the outputs folder persists).
- `firestore.rules` — the full rules (users + shares). Paste into Firebase console → Firestore → Rules → Publish.
- **Deploy:** (1) publish `firestore.rules` first, (2) upload `index.html` to the repo → Commit → hard refresh. `icon.png` only if it changes.
- Adding a new icon: add a `const Name = makeIcon("glyph")` line next to the others in `index.html`.

## Business rules agreed
- One **net balance per person** (+ = treasury owes them, − = they owe the treasury). No borrowing limit, no warnings.
- Transaction types: Money In, Money Out, Internal Transfer (account→account), Balance Transfer (person→person), Allocate Loss. Context goes in a free-text note (no loan/repayment types).
- Fees: Money Out (account has `feeEnabled`) → bearer self / another person / unassigned; Internal Transfer → always the Fee Pool; Balance Transfer → sender / receiver / Fee Pool. The **Fee Pool** is a signed running total of unassigned fees, re-assignable later via Allocate Loss.
- Dashboard invariant: **Accounts total + Fee Pool = sum of all people balances**.
- Free edit/delete of transactions with a silent audit log (not shown to people). Backdating allowed, no future dates; `createdAt` is kept separately.
- People are archived, never deleted (warn if balance ≠ 0). Single currency, no categories, no opening balances (enter as backdated Money In). Account types are user-defined; account names are unique.
- Backups: JSON export/restore, CSV export (balances + transactions + gam'eya plan), save-to-Drive, a reminder after 7 days, and a best-effort daily Drive sync that only runs when the app is opened (iOS may block the silent token refresh; a red warning shows if it fails).

## Safety rules learned the hard way (do not regress)
- **Never save before a successful load.** A failed load must show the retry screen, and `loadData` must not swallow errors. An earlier version treated a failed read as "no data" and overwrote real data.
- Identity is email/password, not anonymous auth (anonymous identities were orphaned when Safari storage was cleared).
- Numbers are forced LTR (`.mono` class, `AmountField` with `dir="ltr"`, `type="tel"`); the cursor logic counts the decimal point.

## Gam'eya (rotating savings) — done
- A gam'eya has: name, installment, **total members N**, first pay date (the 25th), payout day (the 1st of the following month), and the tracked people with their **turn number**. Items are derived, not stored.
- Each cycle every member pays the installment on the pay day, **except the member whose turn it is**, who pays nothing that cycle and collects the **net pot (N−1)×installment** on the payout day. Net over the whole run is zero.
- **Plan + one-tap confirm:** confirming an installment creates a real Money Out from the chosen account against the person's balance (it can go negative = the treasury lends); confirming a payout creates a Money In (amount editable, since some people hand over only part). A confirmation is linked to its transaction id and only counts while that transaction exists, so deleting the transaction sets the item back to planned. "Skip" = handled with no transaction.
- **Forecast:** per person, starting from the current balance and applying only still-planned items (it shows lowest balance, the date it first goes below zero, and the peak the treasury would lend), plus the highest total negative balance across everyone. A live preview appears in the create/edit form before saving.
- **In-progress gam'eya:** create it with the real first date → "Mark everything past as done" (up to a date, default yesterday) → for anything paid from the treasury but never recorded: undo the skip, then Confirm with its real date. Overdue planned items would otherwise inflate the forecast and flood the Dashboard "due soon" card.

## Personal read-only link — done
- Per person: **People → 🔗 Personal link** → Create link → copy / share. Link format: `<app url>#s=<token>` (token in the hash, so it never reaches a server; `noindex` + `no-referrer` meta tags).
- Token = 256-bit random, stored as `shareToken` on the person in the main doc. The app publishes a **snapshot** (not the main doc) to `shares/{token}`: person name, balance, statement rows (kind, date, amount, running balance, note), and that person's gam'eya schedule. **Never** other people's names, account names, or internal ids (a test asserts this). Notes you type on transactions ARE visible to the person.
- Snapshots are re-published automatically (1.2 s debounce, only when changed, only after a successful load). A red notice in the modal shows if publishing failed.
- **Revoke / New link:** overwrites the old `shares/{token}` with `{ownerUid, revoked:true}` (a tombstone, not a delete, so it works even if the doc never existed). If the revoke write fails, nothing changes and an alert shows (never a silent leak).
- Viewer: public, read-only, no sign-in, AR/EN toggle (defaults to the app language); balance, newest-first statement, gam'eya upcoming items with "show completed".
- **What each link shows (per person):** five switches in the link window — Balance, Statement, Notes on transactions, Gam'eya schedule, Withdrawal requests (stored as `shareOpts` on the person; missing = on, so old links are unchanged). Anything switched off is left OUT of the published snapshot (not just hidden on the page). Balance off also removes the running totals.
- Rules: public `get` on `shares/{token}`, no `list`, owner-only writes (see `firestore.rules`).

## Withdrawal requests via the link — done
- On their personal page a person fills **amount + how to receive (cash / transfer, with transfer details) + optional note** and sends. It is stored as a **pending request** at `shares/{token}/requests/{id}` (public CREATE only, validated by rules: allowed keys, amount 0–100M, method, status must be `pending`, text ≤ 200 chars, link must not be revoked). Nothing changes any balance until you approve.
- You see them live (Firestore listener per shared person): a gold **Withdrawal requests** card on the Dashboard → **Review** → pick account, adjust amount/date (and fee if the account has fees) → **Approve & record** (creates a normal Money Out whose note carries the method, details and her note) or **Reject**.
- Safety: approve first marks the request approved in Firestore and only then records the transaction, so a failed update records nothing; a request already handled can't be approved twice.
- Statuses (pending/approved/rejected, amount, method; no free text) are published inside her snapshot so she sees them on her page; her own new requests also show instantly from her device (localStorage), pending ones older than 48 h that never reached the snapshot are hidden. Max 3 pending per person (client-side only).
- Known limits: the 3-pending cap and amount limits can be bypassed by someone calling Firestore directly with the link (rules can't count documents) — worst case is junk pending requests you reject. Regenerating/turning off a link hides its pending requests (the app warns first).

## Telegram notification — built, waiting for the Worker URL
- When a person sends a withdrawal request, her page pings a Cloudflare Worker (`telegram-worker.js`, tested by `test-worker.mjs`) which sends the Telegram message. The bot token lives ONLY in the Worker's secrets, never in `index.html`.
- `index.html` has `const NOTIFY_URL = "";` (near `const SV`). Empty = off. After deploying the Worker (steps in `TELEGRAM_SETUP.md`), paste its URL there and re-run the tests (`test-app.js` swaps in a fake URL itself).
- The Worker re-reads `shares/{token}` (public get), refuses unknown/revoked links, takes the person's NAME from Firestore (not from the page); amount/method come from the page (notification only). Max 10 messages/hour per link (best effort).
- The ping is fire-and-forget (`no-cors`): a failed notification never fails the request.

## Backlog (decided direction, not built)
1. Platform limits: iOS home-screen web apps cannot have light/dark icon variants; a true background daily sync needs a server.

## Working style
The user writes Egyptian Arabic and uses an iPhone: keep replies short and mobile-friendly. For design questions ask one question at a time. Test before delivering and state the deploy steps.
