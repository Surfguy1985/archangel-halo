export type TourPlacement = "right" | "left" | "top" | "bottom" | "center";

export type TourStep = {
  title: string;
  body: string;
  /** Route to navigate to before showing this step. */
  route: string;
  /** data-tour value of the element to spotlight. Omit for a centered step. */
  target?: string;
  placement?: TourPlacement;
};

export type TourChapter = {
  id: string;
  title: string;
  sub: string;
  icon: string;
  steps: TourStep[];
};

export const tourChapters: TourChapter[] = [
  {
    id: "welcome",
    title: "Welcome to HALO",
    sub: "What HALO is and how to get around",
    icon: "Sparkles",
    steps: [
      {
        title: "Welcome aboard",
        body: "This is HALO, the back office for your contracting business. Properties, jobs, money, and crews all live in one place. I'll walk you through the whole app, showing you each screen and button as we go. Just watch along.",
        route: "/",
        target: "brand",
        placement: "right",
     },
      {
        title: "The sidebar is your map",
        body: "Everything you need is in this sidebar on the left. Each item opens a different part of HALO. As I talk about each one, I'll highlight it here and open the real screen so you can see exactly what it looks like.",
        route: "/",
        target: "sidebar",
        placement: "right",
     },
      {
        title: "This is Today",
        body: "Today is your home base — the first screen you'll see every morning. It pulls together everything that needs you right now, so you always know where to start.",
        route: "/",
        target: "nav-today",
        placement: "right",
     },
    ],
 },
  {
    id: "today",
    title: "Your Today feed",
    sub: "The one screen that runs your day",
    icon: "Sun",
    steps: [
      {
        title: "The Morning Brief",
        body: "At the top is your Morning Brief, written by HALO. It's a plain-English summary of what needs attention: money at risk, invoices ready to send, bids to chase, and how many jobs are running.",
        route: "/",
        target: "morning-brief",
        placement: "bottom",
     },
      {
        title: "Needs Attention",
        body: "Below the brief is your Needs Attention list. Each card is a task HALO has surfaced for you. The most important things always rise to the top, so you can work straight down the list.",
        route: "/",
        target: "needs-attention",
        placement: "right",
     },
      {
        title: "Ask HALO anything",
        body: "See this Ask HALO box? Type a plain question like, how much am I owed, or, which jobs are open, and HALO answers instantly from your real data. No reports to dig through.",
        route: "/",
        target: "ask-halo",
        placement: "bottom",
     },
      {
        title: "Operations at a glance",
        body: "These Operations tiles show live counts — money at risk, jobs in flight, and more. Click any tile to filter your Needs Attention list down to just that group.",
        route: "/",
        target: "operations",
        placement: "left",
     },
      {
        title: "Autopilot has your back",
        body: "HALO's Autopilot watches for problems on its own — an overdue invoice, or a job offer a crew never answered. It proposes the fix, like sending a reminder or re-offering the job, and you approve it with one click right here on Today. In Settings, you can even let Autopilot act on its own.",
        route: "/",
        target: "needs-attention",
        placement: "right",
     },
    ],
 },
  {
    id: "voice",
    title: "Talk to HALO",
    sub: "Get things done just by speaking",
    icon: "Mic",
    steps: [
      {
        title: "The Talk button",
        body: "This microphone button, at the bottom of the sidebar, is how you talk to HALO. Click it, then simply say what you need in plain English. HALO turns your words into real actions.",
        route: "/",
        target: "talk",
        placement: "right",
     },
      {
        title: "Things you can say",
        body: "Try things like: add a property called Maple Grove Apartments. Or, log a two hundred dollar expense for paint at Cedar Point. You don't need special words — just talk naturally.",
        route: "/",
        target: "talk",
        placement: "right",
     },
      {
        title: "Review before it saves",
        body: "After you speak, HALO shows you exactly what it understood before saving anything. Look it over, and confirm if it's right. Nothing is saved until you say yes, so you're always in control.",
        route: "/",
        target: "talk",
        placement: "right",
     },
    ],
 },
  {
    id: "properties",
    title: "Properties",
    sub: "Every location you manage",
    icon: "Building2",
    steps: [
      {
        title: "The Properties tab",
        body: "Click Properties in the sidebar to see every site you work on. This is your master list of locations.",
        route: "/properties",
        target: "nav-properties",
        placement: "right",
     },
      {
        title: "Adding a property",
        body: "See the New Property button in the top right? Click it to add a location — just give it a name and the management company. You can also add one by voice with the Talk button.",
        route: "/properties",
        target: "new-property",
        placement: "bottom",
     },
      {
        title: "Open any property",
        body: "Click any row to open a property. Inside you'll find its money owed, open jobs, and access notes like gate codes and lockbox numbers — so your whole team knows how to get in.",
        route: "/properties",
        target: "properties-list",
        placement: "top",
     },
      {
        title: "Price List and margins",
        body: "Each property has its own Price List — the rates you've agreed with that client. HALO uses these rates automatically when you build jobs and invoices. You can also set margin thresholds, and HALO will flag any job whose profit runs below your minimum, right on Today.",
        route: "/properties",
        target: "page",
        placement: "center",
     },
      {
        title: "Crew photos, right on the property",
        body: "When your crews send photos from a job site, they show up on that property's page automatically — matched to the crew and the day they worked. Proof of work, organized for you.",
        route: "/properties",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "pricebook",
    title: "The Price Book",
    sub: "Your master list of services & prices",
    icon: "BookOpen",
    steps: [
      {
        title: "The Price Book tab",
        body: "Click Price Book in the sidebar. This is your master list of every service you offer and its standard price. You set it up once, for the whole business.",
        route: "/catalog",
        target: "nav-catalog",
        placement: "right",
     },
      {
        title: "Build it once",
        body: "Add each service with its rate, unit, and an optional category — full turn clean, HVAC check, paint per room, whatever you sell. Search and edit anytime as your prices change.",
        route: "/catalog",
        target: "page",
        placement: "center",
     },
      {
        title: "Pull it into any property",
        body: "On any property's Price List, click From Price Book. Tick the services you want, and they're added with your standard rates — no re-typing prices for every new client. Services the property already has are skipped automatically.",
        route: "/catalog",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "jobs",
    title: "Jobs & the Job Board",
    sub: "From request to done",
    icon: "ClipboardList",
    steps: [
      {
        title: "The Job Board",
        body: "Click Job Board in the sidebar. A job is any piece of work. This board shows your open work and lets you dispatch it to the right crew.",
        route: "/jobboard",
        target: "nav-jobboard",
        placement: "right",
     },
      {
        title: "Moving a job along",
        body: "Each job moves through stages as work happens — scheduled, in progress, and done. Open a job to see its details, update its status, and see everything tied to it.",
        route: "/jobboard",
        target: "page",
        placement: "center",
     },
      {
        title: "Line items and pricing",
        body: "Open a job and add line items for the work being done. HALO pulls the agreed rates from that property's Price List, so your pricing is consistent and your margin is calculated for you as you go.",
        route: "/jobboard",
        target: "page",
        placement: "center",
     },
      {
        title: "Finish and invoice",
        body: "When the work is done, mark the job complete. HALO then nudges you on Today to turn it into an invoice, so you never forget to bill for finished work.",
        route: "/jobboard",
        target: "page",
        placement: "center",
     },
      {
        title: "When a job wraps up",
        body: "A completed job shows a green Completed badge, plus the crew's site photos from that day. HALO can also send a polished recap email — a branded summary of the work — so your client sees the finished job professionally presented.",
        route: "/jobboard",
        target: "page",
        placement: "center",
     },
      {
        title: "Clear to history, or restart",
        body: "Once a completed job is fully wrapped, click Clear to history to tuck it away — it moves into a collapsible Job History section on the property, keeping your active list clean. Changed your mind, or the client called back? Restart job brings it right back to active.",
        route: "/jobboard",
        target: "page",
        placement: "center",
     },
      {
        title: "Broadcast and let a crew claim it",
        body: "You can also broadcast a job to your crews. Every matching crew sees the offer on their portal with the details and photos, and the first one to accept gets the work — assigned automatically. Changed the details? Edit the offer or rebroadcast it any time.",
        route: "/jobboard",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "money",
    title: "Money",
    sub: "Invoices, expenses, and getting paid",
    icon: "Receipt",
    steps: [
      {
        title: "The Money hub",
        body: "Click Money in the sidebar. This is your financial home — invoices, expenses, crew pay, your bank, and your business report all live here.",
        route: "/money",
        target: "nav-money",
        placement: "right",
     },
      {
        title: "Your money summary",
        body: "These cards at the top show your real cash picture: money coming in, what's owed to you, and what you owe others. It updates the instant you record anything.",
        route: "/money",
        target: "money-summary",
        placement: "bottom",
     },
      {
        title: "Invoices and reminders",
        body: "Draft an invoice for a finished job and email it to your client right from HALO. When a payment is late, HALO surfaces it on Today so one click sends a friendly reminder.",
        route: "/money",
        target: "money-tabs",
        placement: "top",
     },
      {
        title: "Expenses and real margin",
        body: "Log materials, fuel, or any cost against a job — you can even snap a receipt. Because HALO knows money in and money out, it warns you when a job's profit is running thin.",
        route: "/money",
        target: "money-tabs",
        placement: "top",
     },
      {
        title: "Bank and business report",
        body: "The Money tabs also hold your bank connection and business report. Link your bank to match real transactions to invoices and expenses, and open the report to see revenue, margin by property, and who owes you — with a one-click export for your accountant.",
        route: "/money",
        target: "money-tabs",
        placement: "top",
     },
      {
        title: "Faster invoicing, check scans, and approvals",
        body: "Invoicing is fast: your property's agreed services appear as click-to-add buttons, so an invoice builds itself with the right prices. Paid by check? Snap a photo and HALO reads it and records the payment against the right invoice. And expenses can wait for your approval before they ever touch your books.",
        route: "/money",
        target: "money-tabs",
        placement: "top",
     },
    ],
 },
  {
    id: "books",
    title: "Books & Taxes",
    sub: "Real bookkeeping, built in",
    icon: "BookOpen",
    steps: [
      {
        title: "Your books, kept for you",
        body: "In Money, the Books tab holds real double-entry books. Every invoice, payment, and expense you record is posted automatically, so your profit and loss statement and balance sheet are always up to date — with zero bookkeeping work.",
        route: "/money?tab=books",
        target: "page",
        placement: "center",
     },
      {
        title: "Bills and bank imports",
        body: "Record vendor bills you owe, and import transactions straight from your connected bank. HALO keeps everything reconciled, so tax season stops being a shoebox of receipts.",
        route: "/money?tab=books",
        target: "page",
        placement: "center",
     },
      {
        title: "The Tax Planner",
        body: "The Tax Planner estimates what you'll owe for the year based on your real numbers, and shows how much to set aside. You can even compare how different business structures would change your tax bill.",
        route: "/money?tab=books",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "calendar",
    title: "Calendar & scheduling",
    sub: "Plan the week, assign the crew",
    icon: "CalendarDays",
    steps: [
      {
        title: "The Calendar",
        body: "Click Calendar in the sidebar. Switch between day, week, and month views to see your schedule at whatever zoom level you need.",
        route: "/calendar",
        target: "nav-calendar",
        placement: "right",
     },
      {
        title: "Schedule and assign",
        body: "Place a job on a day, give it a time window, and assign the crew handling it. That crew then sees it on their own portal. You can also drop a plain note or reminder on any day.",
        route: "/calendar",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "crews",
    title: "Crews & the crew portal",
    sub: "Your team, connected",
    icon: "Users",
    steps: [
      {
        title: "The Crews tab",
        body: "Click Crews in the sidebar. This is where you set up your teams and subcontractors and note what trades they handle, like plumbing or electrical.",
        route: "/crews",
        target: "nav-crews",
        placement: "right",
     },
      {
        title: "The live portal link",
        body: "For each crew, HALO creates a private live link you can text them. They open it on any phone — no app to download, no account to create — and see the jobs assigned to them.",
        route: "/crews",
        target: "page",
        placement: "center",
     },
      {
        title: "Photos and check-ins",
        body: "On their portal, crews check in and out of work, view access notes, and send photos back to you. When they do, you'll see a red badge so you know there's new activity.",
        route: "/crews",
        target: "page",
        placement: "center",
     },
      {
        title: "The daily field report",
        body: "Open a crew and find Daily Activity — their photos, grouped by day. Share link gives your client a live web page that updates as new photos arrive. Full report lets you add notes from the office and download a branded PDF of the whole day: photos, check-ins, and your notes.",
        route: "/crews",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "crewlink",
    title: "The crew link, explained",
    sub: "Teach your crews their portal",
    icon: "Link2",
    steps: [
      {
        title: "What the crew sees",
        body: "When a crew opens their link, they get a simple mobile page with your branding and their name at the top, and a row of tabs: Offers, Schedule, Invoice, Welcome Kit, Messages, Job Tracker, Photos, Docs, Pay, and W-9. No app store, no password — the link is their key.",
        route: "/crews",
        target: "page",
        placement: "center",
     },
      {
        title: "How a crew uses it day to day",
        body: "Their routine is simple. Check the Schedule each morning to see where to be. Tap Check In on the Job Tracker when they arrive, and Check Out when they finish. Take before and after photos and upload them in Photos. And watch Offers for new work — the first crew to accept gets the job.",
        route: "/crews",
        target: "page",
        placement: "center",
     },
      {
        title: "First-time setup for a new crew",
        body: "The first time they open the link, they accept your work agreement, then fill out their W-9 and how they want to be paid. Tell new crews to do this right away so their payments are never held up.",
        route: "/crews",
        target: "page",
        placement: "center",
     },
      {
        title: "A built-in guide, in English or Spanish",
        body: "You don't have to explain all this yourself. The portal has a Guide tab that walks the crew through every tab in plain language. On any crew's page, next to the live link, you'll find guide link buttons — one in English, one in Spanish. Pick the language your crew prefers and send it. They can also switch languages themselves inside the guide.",
        route: "/crews",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "pipeline",
    title: "Pipeline — leads & bids",
    sub: "Turn opportunities into work",
    icon: "Target",
    steps: [
      {
        title: "The Pipeline",
        body: "Click Pipeline in the sidebar. A lead is a potential customer or job. Add one whenever a new opportunity comes in so it never gets forgotten.",
        route: "/pipeline",
        target: "nav-pipeline",
        placement: "right",
     },
      {
        title: "From lead to bid to job",
        body: "When a lead is ready, create a bid with your pricing and scope, and send it for approval. When the client approves, turn it straight into a job — no re-typing.",
        route: "/pipeline",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "supply",
    title: "Supply & purchase orders",
    sub: "Never run out of materials",
    icon: "Package",
    steps: [
      {
        title: "The Supply tab",
        body: "Click Supply in the sidebar. Track the materials you keep on hand and set a reorder point for each item.",
        route: "/supply",
        target: "nav-supply",
        placement: "right",
     },
      {
        title: "Low stock to purchase order",
        body: "When an item drops below its reorder point, HALO flags it. Turn low stock into a purchase order for your supplier, and mark it received when it arrives — your counts update automatically.",
        route: "/supply",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "vendors",
    title: "Vendors & compliance",
    sub: "Keep insurance current",
    icon: "Truck",
    steps: [
      {
        title: "The Vendors tab",
        body: "Click Vendors in the sidebar. This is where you keep your subcontractors' insurance certificates, also called COIs, in one place.",
        route: "/vendors",
        target: "nav-vendors",
        placement: "right",
     },
      {
        title: "Never work with lapsed coverage",
        body: "HALO tracks each certificate's expiration date and warns you before it lapses, so you're never exposed on a job site.",
        route: "/vendors",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "import",
    title: "Import a file",
    sub: "Let HALO do the data entry",
    icon: "FileUp",
    steps: [
      {
        title: "The Import tab",
        body: "Click Import in the sidebar. Upload a PDF or spreadsheet — a vendor invoice, an expense report, or a property list.",
        route: "/import",
        target: "nav-import",
        placement: "right",
     },
      {
        title: "HALO reads it for you",
        body: "HALO reads the document, pulls out the important details, and matches names to properties and jobs you already have. You review what it found, then commit. What used to be an hour of typing is now a few clicks.",
        route: "/import",
        target: "page",
        placement: "center",
     },
    ],
 },
  {
    id: "notifications",
    title: "Notifications",
    sub: "Stay on top of what's new",
    icon: "Bell",
    steps: [
      {
        title: "The notifications bell",
        body: "This bell at the bottom of the sidebar shows anything new that needs you — a crew checking in, a bid approved, a photo uploaded. A red badge means there's something fresh to look at.",
        route: "/",
        target: "notifications",
        placement: "right",
     },
      {
        title: "HALO emails you too",
        body: "You don't even have to open the app. HALO sends you a daily email with your task list for the day, and an urgent alert the moment something can't wait — like an overdue invoice or a job with thin margin. Your back office checks in with you.",
        route: "/",
        target: "notifications",
        placement: "right",
     },
    ],
 },
  {
    id: "settings",
    title: "The More menu & Settings",
    sub: "Business info and fresh starts",
    icon: "Settings",
    steps: [
      {
        title: "The More button",
        body: "This grid button at the bottom of the sidebar opens the More menu. It holds Settings and business info — the things you set up once and rarely touch.",
        route: "/",
        target: "more",
        placement: "right",
     },
      {
        title: "Settings & business info",
        body: "Inside Settings you enter your company name, address, and payment details — these appear on every invoice and email. You'll also find Start Fresh here, which wipes the sample data so you can begin with your real business.",
        route: "/",
        target: "more",
        placement: "right",
     },
      {
        title: "You're ready",
        body: "That's the whole tour. You now know every part of HALO. Remember, when in doubt, just click the Talk button and tell HALO what you need. Welcome to a calmer back office.",
        route: "/",
        target: "brand",
        placement: "right",
     },
    ],
 },
];
