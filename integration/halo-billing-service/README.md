# HALO Billing Service

Production-oriented TypeScript integration for HALO’s user-tier pricing, a-la-carte Legos, Stripe collection, API metering, provider pass-through costs, dunning, Stripe Connect and custom enterprise routing.

## What this code implements

- 50-user pricing bands from 1 to 1,000 monthly active users.
- Fixed HALO Core fee billed in advance.
- Selected module minimums billed in advance.
- Core tier upgrades, module active-user charges, API overages, storage and provider costs billed in arrears.
- Business Essentials, Operations Suite and Full Business OS bundle discounts.
- Automatic enterprise routing above 1,000 MAU, 50 million monthly API calls or 250 sustained RPS.
- Three collection models:
  - `partner_wholesale`: HALO charges UR Founders or another partner.
  - `halo_direct`: HALO charges the end business and can pay a partner commission.
  - `stripe_connect`: HALO creates a destination subscription and transfers the partner share.
- Stripe Checkout, direct subscriptions, customer portal, invoices and webhooks.
- Optional Stripe Billing Meter event forwarding without using legacy usage records.
- Monthly active-user and module-user deduplication.
- Third-party cost pass-through plus configurable basis-point markup.
- Day 0/10/15/30 dunning status progression.
- PostgreSQL schema and Drizzle migrations.
- Partner API keys and scope enforcement.
- Replit web and worker deployment entry points.
- UR Founders server client and React module-menu example.

## Billing design

| Charge | Timing | Collection method |
|---|---|---|
| Core committed 50-user tier | In advance | Stripe subscription item |
| Module minimums | In advance | Stripe subscription items |
| Core tier true-up | In arrears | Separate monthly Stripe invoice |
| Module active-user true-up | In arrears | Separate monthly Stripe invoice |
| API overage | In arrears | Separate monthly Stripe invoice |
| Storage and usage | In arrears | Separate monthly Stripe invoice |
| Third-party provider costs | In arrears | Cost plus configured service fee |
| Implementation | 50% signing / 50% launch | One-time Stripe invoice |

HALO remains the source of truth for pricing, users, module entitlements and usage. Stripe remains the source of truth for payment methods, subscriptions, invoices, payment attempts and collection status.

## Directory map

```text
src/
  auth/                 API-key authentication and scopes
  billing/              Pricing, subscriptions, Stripe, metering and dunning
  config/               Environment and pricing catalog
  db/                   Drizzle schema and PostgreSQL client
  jobs/                 Worker and advisory locks
  routes/               Hono API routes and Stripe webhook
  sdk/                  HALO Billing API client
scripts/
  bootstrap-stripe.ts   Creates products, recurring prices and optional meters
  generate-api-key.ts   Creates partner platform keys
  migrate.ts            Runs Drizzle migrations
  seed-demo.ts          Creates a UR Founders demo billing account
examples/ur-founders/   Server integration and module-menu component
openapi/                Standalone validated billing OpenAPI 3.1 contract
migrations/generated/   Generated PostgreSQL migration
```

## 1. Install

```bash
npm install
cp .env.example .env
```

Create a PostgreSQL database. For local development:

```bash
docker compose up -d postgres
```

## 2. Configure environment variables

Required secrets:

```bash
DATABASE_URL=postgresql://...
HALO_INTERNAL_JOB_SECRET=<32+ random characters>
HALO_API_KEY_PEPPER=<32+ random characters>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Keep all Stripe and HALO partner keys server-side. Never put `pt_live_`, `sk_live_` or Stripe secret keys in a browser bundle.

## 3. Migrate PostgreSQL

```bash
npm run db:migrate
```

## 4. Create the Stripe catalog

```bash
npm run stripe:bootstrap
```

This creates:

- One HALO Core product.
- Monthly and annual prices for every 50-user tier.
- One product per HALO module.
- Module-minimum prices at 0%, 15% and 25% bundle discounts.
- Optional reporting meters for API calls, webhooks, automations, OCR, signatures, storage and AI units.
- `.stripe-catalog.json`, which maps stable HALO lookup keys to Stripe IDs.

Stripe prices are immutable. When pricing changes, increment the HALO pricing version and create new lookup keys rather than editing historical prices.

## 5. Generate UR Founders’ partner API key

```bash
npm run keys:generate -- ur_founders "UR Founders production" live
```

Store the plaintext key once in UR Founders’ Replit Secrets as:

```bash
HALO_PARTNER_API_KEY=pt_live_...
```

The database stores only a peppered SHA-256 hash.

## 6. Configure the Stripe webhook

Endpoint:

```text
POST https://YOUR-HALO-DOMAIN/webhooks/stripe
```

Subscribe to at least:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.created
invoice.finalized
invoice.paid
invoice.payment_failed
invoice.voided
```

The route reads the unmodified raw body and verifies the `Stripe-Signature` header before processing the event.

For local testing:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Use the webhook secret printed by the Stripe CLI for local forwarded events. It is different from a Dashboard endpoint secret.

## 7. Run the API and worker

Development:

```bash
npm run dev
npm run worker:dev
```

Production:

```bash
npm run build
npm start
npm run worker
```

Deploy the API as an autoscaling web service. Deploy the worker separately as a single reserved process. PostgreSQL advisory locks prevent duplicate billing jobs when more than one worker starts accidentally.

## UR Founders activation flow

### Create the wholesale billing account

```bash
curl -X POST "$HALO_URL/v1/billing/accounts" \
  -H "Authorization: Bearer $HALO_PARTNER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "external_customer_id": "ur_12939",
    "legal_name": "UR Founders",
    "billing_email": "billing@urfounders.example",
    "billing_model": "partner_wholesale",
    "collection_method": "charge_automatically",
    "committed_tier_max_users": 50,
    "term_start": "2026-08-01",
    "term_end": "2027-07-31",
    "third_party_markup_bps": 2000,
    "implementation_fee_cents": 2500000,
    "metadata": {"source": "ur_founders"}
  }'
```

Save the returned HALO `billing_account_id` in UR Founders.

### Select HALO Legos

```bash
curl -X PUT "$HALO_URL/v1/billing/accounts/$ACCOUNT_ID/modules" \
  -H "Authorization: Bearer $HALO_PARTNER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "bundle_id": "business_essentials",
    "modules": [
      {"module_id": "money", "active_user_count": 50},
      {"module_id": "books", "active_user_count": 50},
      {"module_id": "tax", "active_user_count": 50},
      {"module_id": "docs", "active_user_count": 50},
      {"module_id": "analytics", "active_user_count": 50}
    ]
  }'
```

### Create Checkout

```bash
curl -X POST "$HALO_URL/v1/billing/accounts/$ACCOUNT_ID/checkout-session" \
  -H "Authorization: Bearer $HALO_PARTNER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "success_url": "https://urfounders.example/settings/billing?success=1",
    "cancel_url": "https://urfounders.example/settings/billing?canceled=1",
    "interval": "month"
  }'
```

Redirect the partner billing administrator to the returned Stripe Checkout URL.

## Recording active users

Send one activity event whenever a unique end user authenticates or performs a billable module action. HALO deduplicates the same user, module and day.

```ts
await haloBilling.recordActivity({
  billing_account_id: accountId,
  workspace_id: urBusinessId,
  user_id: userId,
  module_id: "books",
});
```

The monthly close counts:

- Distinct users across all module activity for partner MAU.
- Distinct users per module for module-user billing.

## Recording API and provider usage

```ts
await haloBilling.recordUsage({
  billing_account_id: accountId,
  metric: "api_calls",
  quantity: 1,
  unit: "request",
  idempotency_key: crypto.randomUUID(),
});
```

Provider cost example:

```json
{
  "billing_account_id": "...",
  "provider": "OpenAI",
  "category": "ai",
  "description": "July model usage",
  "provider_cost_cents": 48200,
  "markup_bps": 2000,
  "idempotency_key": "openai-july-2026-account-123"
}
```

That produces a $482.00 pass-through line and a $96.40 HALO orchestration fee.

## Monthly close

The worker closes the prior UTC month on the first day of the new month. It:

1. Counts monthly active users.
2. Counts users for each module.
3. Aggregates API and storage usage.
4. Aggregates provider costs.
5. Calculates committed-tier and module true-ups.
6. Creates an immutable billing snapshot.
7. Stops and flags the account when enterprise thresholds are reached.
8. Creates and finalizes a separate Stripe invoice for arrears charges.
9. Marks usage events as settled.

Manual close:

```bash
curl -X POST "$HALO_URL/v1/billing/accounts/$ACCOUNT_ID/close-period" \
  -H "Authorization: Bearer $HALO_PARTNER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "period_start": "2026-07-01T00:00:00Z",
    "period_end": "2026-08-01T00:00:00Z"
  }'
```

## Enterprise guardrails

Automatic standard invoicing stops when any of these occurs:

- More than 1,000 monthly active users.
- More than 50 million monthly API calls.
- More than 250 sustained requests per second.

The billing snapshot is retained with `requiresEnterprise: true` and the reasons. A salesperson or finance administrator must create a custom contract before billing continues. This prevents HALO from applying an underpriced standard rate to a heavy corporate workload.

Recommended enterprise contract fields already exist in the schema:

- Annual minimum commitment.
- Custom MAU and API rates.
- Dedicated environment fees.
- Implementation fees.
- Premium support and SLA.
- Security and compliance fees.
- 12–36 month term.

## Dunning behavior

| Age from initial failure | Account state | Entitlement effect |
|---:|---|---|
| Day 0–9 | `past_due` | Warning and retries |
| Day 10–14 | `restricted` | Read access remains; block new purchases and API writes in the host app |
| Day 15–29 | `suspended` | Suspend operational modules and active API keys |
| Day 30+ | `collections` | Retain data; begin formal collection process |

The worker changes the account state. HALO’s main entitlement middleware should use `billing_account.status` to enforce read-only or suspended behavior.

## Stripe Connect models

### HALO direct with partner commission

Set:

```json
{
  "billing_model": "halo_direct",
  "partner_revenue_share_bps": 3000
}
```

After `invoice.paid`, HALO attempts a 30% transfer to the partner’s connected account and records the transfer status.

### Destination billing

Set:

```json
{
  "billing_model": "stripe_connect",
  "partner_revenue_share_bps": 7000
}
```

The Stripe subscription uses the connected account as the transfer destination. HALO retains the remaining 30% as the application fee.

Connect onboarding endpoints are included for creating an Express account and account link.

## Security controls included

- Hashed API keys with a server-side pepper.
- Resource scopes: `billing:read`, `billing:write`, `billing:admin`, `usage:write`.
- Partner ownership checks on every account route.
- Stripe webhook signature verification using the raw request body.
- Stripe and usage idempotency keys.
- Database uniqueness constraints for duplicate activity and usage.
- Redacted structured logging.
- Integer-cent monetary calculations.
- Immutable monthly billing snapshots.
- No payment-card or bank-account data stored by HALO.

Production dependencies currently return zero known vulnerabilities under `npm audit --omit=dev`. Drizzle Kit’s development dependency chain reports moderate development-server advisories; do not expose its development server publicly.

## Validation performed

```text
TypeScript strict typecheck: passed
Production build: passed
Pricing tests: 6 passed
OpenAPI 3.1 validation: passed
Production dependency audit: 0 known vulnerabilities
```

## Official Stripe references

- Billing Meters: https://docs.stripe.com/billing/subscriptions/usage-based/meters/configure
- Meter Events: https://docs.stripe.com/api/billing/meter-event/create
- Subscriptions: https://docs.stripe.com/api/subscriptions/create
- Webhook signatures: https://docs.stripe.com/webhooks/signature
- Customer portal: https://docs.stripe.com/customer-management
- Connect webhooks: https://docs.stripe.com/connect/webhooks

Stripe currently recommends its Metronome usage platform for new, highly complex enterprise usage contracts. HALO therefore keeps pricing and contract logic provider-neutral and routes heavy usage to custom enterprise review instead of relying on a single Stripe metered price.
