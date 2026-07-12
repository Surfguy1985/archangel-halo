export type TrainingStep = {
  title: string;
  body: string;
};

export type TrainingChapter = {
  id: string;
  title: string;
  sub: string;
  icon: string;
  steps: TrainingStep[];
};

export const trainingChapters: TrainingChapter[] = [
  {
    id: "welcome",
    title: "Welcome to HALO",
    sub: "What HALO is and how to get around",
    icon: "Sparkles",
    steps: [
      {
        title: "Welcome aboard",
        body: "HALO is the back office for your contracting business. Properties, jobs, money, and crews all live in one place, so nothing slips through the cracks. This guided tour will walk you through every part of the app, one feature at a time.",
      },
      {
        title: "How this training works",
        body: "I'll read each step out loud and move to the next one on my own. Use the play and pause button any time you need a break, and the arrows to jump forward or back. If you'd rather read in silence, tap the speaker icon to mute my voice.",
      },
      {
        title: "The bottom tabs",
        body: "Along the bottom you'll find your main tabs. Today is your home base. Properties holds every location you manage. The big center button is Talk, where you speak to HALO. Money is your invoices and expenses, and Crews is your team.",
      },
      {
        title: "The More menu",
        body: "At the top of the screen, the grid icon opens More. That's where the rest lives: the Job Board, Calendar, Pipeline, Supply, Vendors, Import, and Settings. We'll cover each of these as we go.",
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
        body: "The glowing ring in the center of the bottom bar is how you talk to HALO. Tap it, then simply say what you need in plain English. HALO listens and turns your words into real actions.",
      },
      {
        title: "Things you can say",
        body: "Try things like: add a property called Maple Grove Apartments. Or, log a two hundred dollar expense for paint at Cedar Point. Or, create a job to fix a leak in unit twelve. You don't need special words, just talk naturally.",
      },
      {
        title: "Review before it saves",
        body: "After you speak, HALO shows you exactly what it understood before saving anything. Look it over, and if it's right, confirm it. Nothing is saved until you say yes, so you're always in control.",
      },
      {
        title: "Fixing a mistake",
        body: "If HALO hears something wrong, you can edit the details right there on the review screen, or just cancel and try again. The more you use it, the faster your day gets.",
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
        body: "At the top of Today is your Morning Brief, written by HALO. It's a plain-English summary of what needs your attention: money at risk, invoices ready to send, bids to chase, and how many jobs are in flight.",
      },
      {
        title: "Now, Today, and This Week",
        body: "Below the brief, your work is sorted into three tiers. Now is urgent, like an overdue invoice. Today is what to handle before the day ends. This Week is coming up. The most important things always rise to the top.",
      },
      {
        title: "Act right from a card",
        body: "Each card has a button that does the work for you. See a finished job? Tap Create invoice. See a late payment? Tap Send reminder. You can handle most of your day without ever leaving this screen.",
      },
      {
        title: "The notifications bell",
        body: "The bell at the top shows anything new that needs you, like a crew checking in or a bid being approved. A red dot means there's something fresh to look at.",
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
        title: "Your property list",
        body: "The Properties tab holds every site you work on, along with its management company, unit count, and money owed. Tap any property to see its full history.",
      },
      {
        title: "Adding a property",
        body: "Tap the plus button to add one, or just say it out loud with the Talk button. Give it a name and the management company, and you're set.",
      },
      {
        title: "Access notes",
        body: "Inside each property you can save access notes, like gate codes, lockbox numbers, or where the keys are. Now your whole team knows how to get in without a phone call.",
      },
      {
        title: "Money and open jobs at a glance",
        body: "Each property shows what it owes you and how many jobs are open there. It's an instant health check on any account.",
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
        title: "Creating a job",
        body: "A job is any piece of work. Create one with a short description, a category, the property, and the unit number. You can type it or speak it.",
      },
      {
        title: "Moving a job along",
        body: "Each job moves through stages as work happens, so you always know what's scheduled, in progress, or waiting. Open a job to see its details and update its status.",
      },
      {
        title: "The Job Board",
        body: "Open More, then Job Board, to dispatch open work to your crews. You can broadcast a job to your team and let the right crew grab it.",
      },
      {
        title: "Finish and invoice",
        body: "When the work is done, mark the job complete. HALO then nudges you to turn it into an invoice, so you never forget to bill for finished work.",
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
        title: "Day, week, and month",
        body: "Open More, then Calendar. Switch between day, week, and month views to see your schedule at whatever zoom level you need.",
      },
      {
        title: "Schedule a job",
        body: "Place a job on a day and give it a time window. Everyone can see when and where the work is happening.",
      },
      {
        title: "Assign a crew",
        body: "When you schedule a job, assign the crew who's handling it. That crew then sees it on their own portal, which we'll cover later.",
      },
      {
        title: "Quick notes",
        body: "You can also drop a plain note or reminder on any day, like an inspection or a supplier delivery, even if it isn't a full job.",
      },
    ],
  },
  {
    id: "invoices",
    title: "Money — invoices",
    sub: "Get paid, on time",
    icon: "Receipt",
    steps: [
      {
        title: "The Money hub",
        body: "The Money tab is your financial home. At the top you'll see cash coming in, money owed to you, and what you owe others.",
      },
      {
        title: "Create and send an invoice",
        body: "Draft an invoice for a completed job, then send it straight to your client by email, right from HALO. No separate accounting app needed.",
      },
      {
        title: "Record a payment",
        body: "When a client pays, mark the invoice as paid. Your receivables update instantly, so you always know your true cash position.",
      },
      {
        title: "Chase what's late",
        body: "HALO tracks past-due invoices and surfaces them on your Today feed. One tap sends a friendly reminder, so you get paid without the awkward phone call.",
      },
    ],
  },
  {
    id: "expenses",
    title: "Money — expenses & crew pay",
    sub: "Track what goes out",
    icon: "Wallet",
    steps: [
      {
        title: "Log an expense",
        body: "Record materials, fuel, or any cost against a property or job. You can type it, speak it, or even snap a receipt and let HALO read it.",
      },
      {
        title: "What you owe your crews",
        body: "In the Money area, HALO tracks what each crew or subcontractor is owed for the work they've completed, so nobody gets underpaid or double-paid.",
      },
      {
        title: "Mark a crew paid",
        body: "When you pay a crew, mark it paid here. Your books stay clean, and your crews stay happy.",
      },
      {
        title: "See your real margin",
        body: "Because HALO knows both the money in and the money out on each job, it can warn you when a job's profit is running thin, before it costs you.",
      },
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline — leads & bids",
    sub: "Turn opportunities into work",
    icon: "GitBranch",
    steps: [
      {
        title: "Add a lead",
        body: "Open More, then Pipeline. A lead is a potential customer or job. Add one whenever a new opportunity comes in so it never gets forgotten.",
      },
      {
        title: "Stay in touch automatically",
        body: "HALO helps you follow up with leads over time, so warm opportunities don't go cold while you're busy on the tools.",
      },
      {
        title: "Turn a lead into a bid",
        body: "When a lead is ready, create a bid, or proposal, with your pricing and scope of work.",
      },
      {
        title: "Send it for approval",
        body: "Send the bid to your client to review. When they approve it, you can turn it straight into a job. No re-typing.",
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
        title: "Add your crews",
        body: "The Crews tab is where you set up your teams and subcontractors and note what trades they handle, like plumbing or electrical.",
      },
      {
        title: "The live portal link",
        body: "For each crew, HALO creates a private live link. Send it to them by text. They can open it on any phone with no app to download and no account to create.",
      },
      {
        title: "What crews can do",
        body: "On their portal, crews see the jobs assigned to them, check in and out of work, view access notes, and send photos back to you.",
      },
      {
        title: "Stay in the loop",
        body: "When a crew does something, like checking in or uploading a photo, you'll see a red badge so you know there's new activity to review.",
      },
    ],
  },
  {
    id: "vendors",
    title: "Vendors & compliance",
    sub: "Keep insurance current",
    icon: "ShieldCheck",
    steps: [
      {
        title: "Track your vendors",
        body: "Open More, then Vendors. This is where you keep your subcontractors' insurance certificates, also called COIs, in one place.",
      },
      {
        title: "Never work with lapsed coverage",
        body: "HALO tracks each certificate's expiration date and warns you before it lapses, so you're never exposed on a job site.",
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
        title: "Your inventory",
        body: "Open More, then Supply. Track the materials you keep on hand and set a reorder point for each item.",
      },
      {
        title: "Low-stock alerts",
        body: "When an item drops below its reorder point, HALO flags it so you can restock before a job gets held up.",
      },
      {
        title: "Create a purchase order",
        body: "Turn low stock into a purchase order to send to your supplier, right from the app.",
      },
      {
        title: "Receive the order",
        body: "When the materials arrive, mark the order received. Your inventory counts update automatically.",
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
        title: "Upload almost anything",
        body: "Open More, then Import. Upload a PDF or spreadsheet, like a vendor invoice, an expense report, or a property list.",
      },
      {
        title: "HALO reads it for you",
        body: "HALO reads the document and pulls out the important details on its own, turning a messy file into clean records.",
      },
      {
        title: "Review the matches",
        body: "Before anything is saved, HALO shows you what it found and matches names to properties and jobs you already have. You get the final say.",
      },
      {
        title: "Commit and you're done",
        body: "Once it looks right, commit the import. What used to be an hour of typing is now a few taps.",
      },
    ],
  },
  {
    id: "report",
    title: "Business report & insights",
    sub: "See how the business is really doing",
    icon: "BarChart3",
    steps: [
      {
        title: "The big picture",
        body: "Your business report shows revenue, margin, and totals by property, so you can see which accounts make you money and which don't.",
      },
      {
        title: "Aging accounts",
        body: "It also breaks down who owes you and for how long, grouped into thirty, sixty, and ninety days late, so you know where to focus your collections.",
      },
      {
        title: "Export for your accountant",
        body: "Need the numbers elsewhere? Export your financials to a spreadsheet file with one tap and hand them straight to your bookkeeper.",
      },
      {
        title: "Insights on Today",
        body: "HALO also spots trends for you, like unusually high material use at one site, and quietly surfaces them on your Today feed.",
      },
    ],
  },
  {
    id: "bank",
    title: "Connect your bank",
    sub: "Match money to real transactions",
    icon: "Landmark",
    steps: [
      {
        title: "Why connect a bank",
        body: "Connecting your bank lets HALO see real money moving, so your cash numbers reflect what actually hit your account, not just what you typed in.",
      },
      {
        title: "A secure connection",
        body: "HALO uses a trusted, bank-grade connection to link your account. Your login stays private, and HALO only reads transactions.",
      },
      {
        title: "Match transactions",
        body: "Once connected, you can match bank transactions to your invoices and expenses, so your books reconcile themselves with far less effort.",
      },
    ],
  },
  {
    id: "settings",
    title: "Settings & installing HALO",
    sub: "Fresh starts and home-screen access",
    icon: "Settings",
    steps: [
      {
        title: "Start fresh",
        body: "In Settings you'll find Start Fresh. When you're done exploring the sample data, this wipes it clean so you can begin with your real business. Your company info and bank connection are kept.",
      },
      {
        title: "Install HALO on your phone",
        body: "You can add HALO to your home screen so it opens like a real app. On an iPhone, open HALO in Safari, tap the share button, then Add to Home Screen. On Android, open the menu and tap Install app.",
      },
      {
        title: "Share it with your team",
        body: "Send your teammates the same web link. When they open it on their phone, they can add it to their home screen too. No app store, no downloads.",
      },
      {
        title: "You're ready",
        body: "That's the whole tour. You now know every part of HALO. Remember, when in doubt, just tap the Talk button and tell HALO what you need. Welcome to a calmer back office.",
      },
    ],
  },
];
