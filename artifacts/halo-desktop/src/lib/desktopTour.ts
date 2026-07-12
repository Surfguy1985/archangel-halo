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
        placement: "left",
      },
      {
        title: "Operations at a glance",
        body: "These Operations tiles show live counts — money at risk, jobs in flight, and more. Click any tile to filter your Needs Attention list down to just that group.",
        route: "/",
        target: "operations",
        placement: "left",
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
        title: "Finish and invoice",
        body: "When the work is done, mark the job complete. HALO then nudges you on Today to turn it into an invoice, so you never forget to bill for finished work.",
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
