# HALO Master How-To — One-Page SOP

Internal quick manual for the office desktop app. Every job follows the same five-stage rail you see on each job card: **CREW → WORK → INVOICE → CREW PAID → CLOSE**. Work left to right and nothing gets missed.

---

## 1. Add a Property

![Properties list](/devportal/manual/properties.png)

1. Go to **Clients → Properties** in the left sidebar.
2. Click the green **+ New Property** button (top right).
3. Fill in name, city, PMC and billing email — the billing email is what invoices and reminders send to, so don't skip it.
4. Open the property and use the **gear icon** on its row to upload the client's **SOP / billing guidelines** (PO rules, invoice format, terms). Every invoice for that property will be checked against it automatically.
5. On the property page, add **Agreed Rates** (Import price list / From Price Book) so invoices and job pricing pull real numbers.

## 2. Create a Job

![Property page with job cards](/devportal/manual/property-detail.png)

1. From the property page, click **⚡ Quick job** (create + staff in one sheet) or **+ Add** for the full form.
2. Pick the unit, category (turnover, maintenance, etc.) and describe the scope. Line items become the crew's work checklist.
3. The job appears as a card with the five-stage rail. The next required action is always the highlighted button on the card.

## 3. Assign a Crew

![Crews page](/devportal/manual/crews.png)

1. **Crews** page: add crew leaders with phone + preferred payment method. Their portal link is generated here — that link *is* their login.
2. Assign directly on the job card (**Assign crew**), or post it to the **Job Board** and let crews claim it — first accepted offer wins.
3. Crews see the job, checklist, schedule and directions in their portal; check-in/out and photos flow back live.

## 4. Track Work on the Job Board

![Job Board rails](/devportal/manual/jobboard.png)

1. **Work → Board** shows every open job moving through rails: Requested → offers out → in progress → done → billing → **Alerts** (red = needs you now).
2. Click any card for the detail sheet: scope, crew, live link, photos, and the one action that's next (Create Invoice, Log Expenses, Follow up, etc.).
3. When the crew finishes the last checklist item, the job auto-moves to **completed**.

## 5. Create & Send the Invoice

![Create invoice](/devportal/manual/invoice-new.png)

1. From the job card, click **Create invoice** — it's pre-linked to the job and property (every invoice must be tied to a job).
2. Tap the price-book pills to add line items fast. SOP rules (PO number, terms, due date) are enforced automatically; if a required PO is missing you'll be told before it saves.
3. **One active invoice per job** — if one already exists you'll get a notice pointing you to it instead of a duplicate.
4. Click **Send** — it emails the client and mirrors a pay card onto their client board.

## 6. Get Paid (checks & follow-ups)

![Money hub](/devportal/manual/money.png)

1. **Money** hub tracks owed / collected / past due. Reminders go out automatically for past-due invoices.
2. When a check arrives, use **Scan received check** on the invoice or job card — the photo is OCR'd and the payment is anchored to the invoice. An invoice can't be flipped to *paid* by hand until check coverage matches.
3. If the client says "check is sent" and 7+ days pass, the job card shows a **Follow up with property** button — one click posts the nudge to their board.

## 7. Pay the Crew

1. Once the invoice is **paid**, the payment dialog's right column lists each crew member with their preferred payment method and amount.
2. Pay them, hit **Paid** — the ledger updates and the crew automatically gets a message in their portal confirming amount, job and method.
3. Double-pays are blocked server-side.

## 8. Close Out

1. **Close out** appears on the job card only when the checklist is done: crew assigned, work complete, invoice paid, crew paid. If anything is missing you'll get the exact list.
2. Close-out opens the pre-filled **job recap** — review and send it to the PM (public summary link is redacted for client eyes).
3. Job archives to History; margins are locked into the property's numbers.

---

**Golden rules:** every invoice hangs off a job · SOP rules always win · green highlighted button = your next step · red Alerts rail = do it today · if something is blocked, the error tells you exactly which step is missing.
