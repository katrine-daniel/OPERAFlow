# Operations manual

_Covers features delivered so far (Phases 1–2). Extended as each module ships._

## Accounts
- **Create a user:** Users & roles → Add user. Give the temporary password through a secure channel and ask the user to change it.
- **Change a role / deactivate:** use the row controls. Any role or access change signs the user out immediately.
- **Locked account:** after 5 wrong passwords, an account locks for 15 minutes. An administrator can reset the password with `POST /users/:id/reset-password` (no UI yet), which also unlocks it.
- At least one active administrator must always exist. Administrators cannot demote or deactivate themselves.

## Roles at a glance
- **Administrator:** everything, including webhook secrets, approving unattended email sending and approving report recipients.
- **Operations Manager:** bookings, imports, reconciliation, suppliers, follow-ups, reports and the audit log.
- **Operations Staff:** day-to-day bookings and follow-ups; can read suppliers and reports.
- **QA:** booking-site test automation only. QA users never see guest data.

## Booking registry
- **Offline booking** (Booking registry → New offline booking): for TBO, direct hotel calls, supplier email or another authorised channel.
  - Leave unknown amounts blank. They are flagged as missing, never treated as zero.
  - A hotel that isn't listed can be added inline with **Add hotel**.
  - If the same guest, hotel and dates already exist, you get a duplicate warning with links to the existing booking(s). Save anyway only if it really is a separate booking.
- **Online bookings** arrive from the booking website through the signed webhook. Guest, stay, price and status belong to the website and update automatically. Staff can still set supplier, supplier cost, owner, confirmation number and notes.
- **Confirm:** "Mark confirmed" asks for the hotel/supplier confirmation number.
- **Cancel (offline only):** give a reason and say whether a fee applies. Online cancellations come from the website.
- **Editing:** if someone else saved the booking after you opened it, you'll be asked to reload, so nobody's changes are silently overwritten.
- **Documents:** attach vouchers, confirmations or emails (PDF, PNG, JPEG, WEBP, XLSX, DOCX, CSV, TXT or EML, up to 10 MB). Files are checked by content, not by name, and downloads are logged.
- **History** on each booking shows who changed what and when. Guest contact details are recorded as "changed", never with their values.
- **Missing data:** tick **Missing data** in the registry filters. A booking counts as incomplete when it lacks a selling price, supplier cost, supplier, hotel or owner, or is confirmed without a confirmation number.

## Imports (CSV / Excel)
1. Imports → choose the source (for example TBO) → choose a `.csv` or `.xlsx` file → **Preview**. Nothing is written yet.
2. Review the preview: new vs. updated rows, row-level errors, and any ignored columns.
3. Import. If some rows have errors you can import only the valid ones; the rest are listed in the import history.

How rows are handled:
- Rows match existing bookings on `external_ref` within the chosen source.
- Blank cells never erase existing data.
- Re-uploading an identical file is refused.
- The column template is on the Imports page.

## Reconciliation
Run it from the Reconciliation page, ideally after each import. It flags:
- **Possible duplicate:** the same guest, hotel and dates recorded twice.
- **Amount mismatch:** the same stay recorded online and offline with different prices or currencies.
- **Status mismatch:** for example, cancelled on the website but still active offline.
- **Missing required data.**

Resolve or dismiss each issue with a note. Dismissed issues are not raised again. Missing-data and duplicate issues close themselves once the cause is fixed.

## Booking sources
The Booking sources page shows how each channel is actually connected.
- **TBO:** manual entry and CSV only, because no TBO API credentials have been provided.
- **Booking website (webhook):** an administrator issues a signing secret and gives it to the website operator together with `docs/WEBHOOK.md`. The badge reads "Receiving data" only after the first verified event.
- **Booking website (API sync):** not implemented. It needs the vendor's API specification and credentials.

## Daily reports
1. **Approve recipients first.** An administrator approves addresses under Reports → Approved recipients. Reports contain guest data, so nothing can be emailed anywhere else.
2. **Create a schedule:** pick a time, days and timezone; whether it covers the previous day or the same day; bookings made or arrivals; formats; recipients; and optionally a Teams or Slack channel (which gets a summary only).
3. **Preview:** generates the report without sending it. Open it, check the numbers and download the files.
4. **Enable.** The next three run times are shown. Changing filters, formats or timezone later turns the schedule off until you preview again.
5. **Run & send now** re-sends a specific day manually.

**Delivery problems:** open the run. Each recipient shows Sent or Failed with the reason; "Retry failed deliveries" retries only the failed ones and never re-sends to people who already received it. "Outcome unknown" means sending was interrupted, so check with the recipient before retrying.

**Reading the report:** totals are per currency and never converted. "Excluded from margin" counts bookings missing a price or cost. MISSING cells mean the data was never entered; nothing is assumed.

**Scheduler status:** the Reports and Integrations pages show whether the background worker is running. If it says "inactive", schedules won't fire, though previews and manual runs still work.

## Supplier follow-ups
**Setup (once):**
1. An administrator connects the reservations mailbox under Integrations → Connect Gmail / Microsoft 365, then clicks **Test**.
2. Make sure each supplier's reservation addresses are listed as contacts under Suppliers. Follow-ups only ever go to those addresses.

**Tracking a request:**
1. Follow-ups → Track a sent email → Load sent emails.
2. Pick the quotation or rate request. The supplier is suggested from the recipients.
3. Choose a rule (24h, 48h or 72h) and click **Start tracking**.

**What happens next:**
- The thread is checked every 10 minutes.
- **Supplier replies:** tracking stops and you're notified. Out-of-office and automatic replies don't count.
- **No reply by the deadline:** inside business hours, a follow-up draft is created and appears under **Needs action**. Open it, read exactly what will be sent, then **Approve & send** or **Skip**. If the supplier replies before you approve, nothing is sent.
- **Bounce, or a reply from someone unexpected:** the thread goes to **Needs review** for a human to decide.
- **Limit reached:** after the maximum number of follow-ups, the thread is marked **No reply** so you can call the supplier.

**Unattended sending:** only an administrator can switch a rule to auto-send, and the approval is recorded. Changing the rule or its template switches it back to draft review automatically.

**Manual controls on a thread:** Check now, Pause, Resume, Mark replied, Stop tracking, Reschedule.

## Booking-site tests (QA)
1. **Add an environment** (Booking-site tests → Add environment):
   - Use the booking website's sandbox or staging URL.
   - Choose **Sandbox** and tick "Allow … create, modify and cancel bookings" only if that sandbox can't reach real hotels or charge real cards.
   - Put test-account credentials under Credentials as `key=value` lines.
   - If the payment provider's test widget loads from another domain, add it under Extra allowed hosts (for example `*.stripe.com`).
2. **Configure scenario steps:**
   - Open a scenario, write or paste its steps (JSON), and save. "Insert example" gives a starting point; replace the selectors with the ones on your website.
   - Use `{{date:+30}}` for future stay dates, `{{secret.username}}` for credentials, and `extract` to capture the booking reference for later steps (`{{extracted.ref}}`).
3. **Run:** choose an environment and click **Run**. Booking-changing scenarios only list eligible sandboxes.
4. **Read the result:**
   - Each step shows pass/fail with its time.
   - Failures come with a plain-language category, a screenshot and a downloadable trace. Open the trace at trace.playwright.dev to replay every step.
   - "Blocked (safety)" means OPERAFlow refused to do something unsafe, such as creating a booking outside the sandbox or typing a real card number.
5. **Schedule:** set a cron and a scheduled environment on the scenario. This needs the worker (Redis) running.

Only published test card numbers are accepted. Critical scenario failures notify all administrators and QA users.

## Everyday tools
- **Search:** press `/` or use the box at the top to find bookings (by reference, supplier ref, confirmation number, guest or hotel), suppliers, follow-ups and test scenarios.
- **Notifications:** the bell shows drafts waiting for you, supplier replies, threads needing review, report delivery failures and critical test failures. Click an item to open it.
- **My account:** change your password. Your other sessions are signed out.
- **Admin password reset:** Users & roles → Reset password. This also unlocks the account and signs the user out everywhere.

## Settings (administrators)
**Data retention** sets how long operational data is kept. The worker purges nightly, or you can click **Run purge now**. Bookings are never purged.

## Audit log
The audit log records sign-ins, failed sign-ins, lockouts, administrative changes, booking changes, imports, reconciliation runs, document downloads and rejected webhooks. Filter by action prefix (for example `booking.` or `webhook.`). Entries cannot be edited.

## Dashboard
Every figure is a live count for "today" in the organisation timezone (`DEFAULT_TIMEZONE`).
