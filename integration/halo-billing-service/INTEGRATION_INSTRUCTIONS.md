You are the senior principal engineer responsible for integrating the supplied HALO API Platform v2 billing, pricing, metering, entitlement, and collection system into this existing HALO application.

This is an existing product. Do not rebuild HALO from scratch, replace working functionality, redesign the entire interface, or overwrite the existing database without first understanding it.

The integration package is located at:

/integration/halo-billing-service

Also locate and read these supplied files if present:

* halo-openapi.yaml
* halo-billing-openapi.yaml
* halo-user-tier-pricing.json
* halo-module-catalog.json
* halo-partner-plans.json
* BILLING_INTEGRATION_ADDENDUM.md
* halo-billing-service/README.md
* halo-billing-service/replit.md
* halo-billing-service/DEPLOYMENT_CHECKLIST.md
* halo-billing-service/STRIPE_SETUP.md
* halo-billing-service/.env.example

## Primary objective

Turn the existing HALO application into a production-ready, API-first, multi-tenant business operating system with:

1. Fifty-user pricing tiers.
2. A-la-carte HALO Lego modules.
3. Partner wholesale billing.
4. HALO-direct billing.
5. Stripe Connect partner billing.
6. Fixed charges billed in advance.
7. Usage true-ups billed in arrears.
8. Stripe Checkout and Customer Portal.
9. API, AI, storage, OCR, signature, automation, and provider-cost metering.
10. Module entitlements that control both UI and API access.
11. Enterprise pricing safeguards.
12. Dunning and account restriction workflows.
13. UR Founders as the first integrated partner without coupling HALO to UR Founders.
14. Secure API keys, webhooks, audit logs, tenant isolation, and production operations.

## Mandatory first step: audit before changing code

Before editing anything:

1. Inspect the entire existing project.
2. Identify its framework, runtime, database, authentication, routing, deployment commands, API conventions, tenant model, user model, organization model, and existing billing features.
3. Determine whether HALO is currently a monolith, monorepo, or multiple services.
4. Identify all database-table and route-name conflicts.
5. Compare the existing implementation against:

   * halo-openapi.yaml
   * halo-billing-openapi.yaml
   * halo-module-catalog.json
6. Create a written coverage matrix showing:

   * Already implemented
   * Partially implemented
   * Missing
   * Conflicting
   * Deprecated
   * Requires an external credential
7. Preserve all working existing functionality.
8. Create a checkpoint before any destructive migration.
9. Do not modify production data during development.

After completing the audit, implement the integration. Do not stop merely because external credentials are unavailable. Use test configuration or safe placeholders and provide an exact missing-secret checklist.

## Architecture rules

Follow these rules:

* HALO is the source of truth for pricing, entitlements, monthly active users, module users, API usage, partner contracts, and enterprise status.
* Stripe is the source of truth for payment methods, subscriptions, invoices, payment attempts, refunds, disputes, and collection status.
* Use integer cents for money.
* Use UTC for stored timestamps.
* Use explicit workspace, partner, organization, and billing-account identifiers.
* Every tenant-scoped database query must enforce tenant ownership on the server.
* Never trust tenant, workspace, partner, or organization IDs supplied in a request body without validating them against the authenticated identity.
* All financial mutations must be idempotent.
* Every webhook event must be deduplicated by provider event ID.
* Never log secret keys, API tokens, payment-method data, full tax documents, or sensitive personal data.
* Never expose Stripe secret keys or HALO partner keys to browser code.
* Never use Stripe legacy usage records.
* Do not grant entitlements based only on a successful browser redirect.
* Grant or continue paid access from verified payment and subscription webhook state.
* Preserve historical prices by versioning prices rather than editing past pricing records.
* Do not automatically quote standard pricing when enterprise thresholds are met.

## Integration structure

Adapt the following structure to the existing application rather than forcing it if the current architecture already has equivalent locations:

/apps
/halo-dashboard
/partner-admin
/advisor-portal

/services
/billing
/entitlements
/usage
/webhooks
/worker
/integrations

/packages
/halo-sdk
/pricing-engine
/module-catalog
/auth
/audit
/shared-types

If the existing app is a single application, integrate these as internal modules with clean boundaries.

If the billing service remains separate:

* Expose it through a private service interface.
* Authenticate calls using restricted partner or internal-service credentials.
* Do not expose internal worker routes publicly.
* Use the same production PostgreSQL cluster only if table ownership and migrations remain safely isolated.
* Prefer a dedicated PostgreSQL schema such as billing, or use clearly namespaced tables, if the existing database already contains similar table names.

## Database requirements

Use PostgreSQL and Drizzle unless the existing app already uses another production ORM that can safely own the same schema.

Implement or reconcile the following entities:

* partners
* workspaces
* organizations
* users
* workspace_memberships
* billing_accounts
* partner_contracts
* pricing_versions
* subscriptions
* module_entitlements
* module_user_activity
* monthly_active_users
* api_keys
* api_key_scopes
* usage_events
* usage_summaries
* provider_costs
* invoice_forecasts
* invoices
* payments
* refunds
* disputes
* partner_commissions
* revenue_shares
* enterprise_reviews
* dunning_events
* webhook_events
* audit_events
* integration_connections

Requirements:

* Use foreign keys.
* Use appropriate unique constraints.
* Use transaction boundaries for financial changes.
* Add indexes for tenant ID, billing account ID, event timestamp, provider event ID, external customer ID, subscription ID, and usage-period queries.
* Store only hashed HALO API keys.
* Apply a server-side pepper before hashing API keys.
* Encrypt sensitive connector credentials.
* Create reversible migrations.
* Ensure migrations run successfully on both a clean database and a copy of the existing development schema.
* Do not delete or rename existing production tables without a documented migration and rollback plan.

## Authentication and authorization

Preserve the existing authentication provider.

Do not introduce a second customer authentication system if HALO already has production authentication.

Create a server-side authorization adapter that maps the existing authenticated user to:

* partner
* workspace
* organization
* role
* permissions
* billing account
* module entitlements

Implement these roles at minimum:

* HALO platform administrator
* Partner administrator
* Partner billing administrator
* Business owner
* Business administrator
* Accountant or bookkeeper
* Advisor
* Employee
* Read-only auditor
* Internal service account

Implement permission checks for every mutation.

Implement API-key types and prefixes:

* pt_test_
* pt_live_
* sk_test_
* sk_live_
* rk_test_
* rk_live_
* epk_
* whsec_

API keys must support:

* Environment
* Scopes
* Expiration
* Rotation
* Revocation
* Last-used timestamp
* Optional IP restrictions
* Partner and workspace ownership
* Audit history

## HALO Lego entitlement model

Treat every HALO capability as a Lego with five surfaces:

1. Headless API
2. Embeddable UI component
3. Events and webhooks
4. Callable automation actions
5. Metered usage

Implement the supplied Lego catalog as a versioned database-backed catalog.

Modules include:

* HALO Core
* HALO Money
* HALO Books
* HALO Tax
* HALO Sell
* HALO Work
* HALO Team
* HALO Documents
* HALO Analytics
* HALO Automations
* HALO AI
* HALO Connector Hub

Each module must define:

* Module ID
* Display name
* Description
* Dependencies
* API scopes
* UI components
* Events
* Actions
* Usage meters
* Base price
* Monthly minimum
* Volume multiplier
* Bundle eligibility
* Status
* Pricing version

Build an entitlement middleware layer that:

* Hides unlicensed modules from navigation.
* Blocks unlicensed API routes.
* Prevents automation actions for inactive modules.
* Supports module activation and deactivation dates.
* Supports module access for only a subset of users.
* Preserves read-only historical access when appropriate.
* Records every entitlement change in the audit log.

## Pricing engine

Implement the supplied 50-user pricing tiers from 1 through 1,000 monthly active users.

Use the supplied halo-user-tier-pricing.json file as the initial pricing configuration.

Billing rules:

* Core committed tier is billed in advance.
* Module minimums are billed in advance.
* Core active-user true-ups are billed in arrears.
* Module active-user true-ups are billed in arrears.
* API overages are billed in arrears.
* Storage usage is billed in arrears.
* AI and third-party provider costs are billed in arrears.
* Third-party costs receive the contracted service-fee markup.
* Professional bookkeeping, tax preparation, legal, consulting, and implementation services remain separate SKUs.
* Annual base subscriptions may receive the configured discount.
* Usage costs are still billed monthly when the base subscription is annual.
* Do not provide unlimited API usage.

Implement boundary tests for:

* 0 users
* 1 user
* 50 users
* 51 users
* 100 users
* 999 users
* 1,000 users
* 1,001 users
* Exactly 50 million API calls
* More than 50 million API calls
* Exactly 250 sustained requests per second
* More than 250 sustained requests per second

## Enterprise routing

Automatically require enterprise review when any of these conditions apply:

* More than 1,000 monthly active users
* More than 50 million API calls per month
* Sustained throughput over 250 requests per second
* Dedicated environment
* Data residency requirement
* Contractual SLA of 99.95% or higher
* Custom security or compliance requirement
* Twenty-four-hour support requirement
* Named technical account manager requirement

When an enterprise trigger occurs:

* Do not create an automatically priced standard subscription.
* Do not generate an underpriced automatic invoice.
* Create an enterprise-review record.
* Notify the HALO platform sales and billing administrators.
* Preserve service during the review according to contract status.
* Display “Custom enterprise agreement required.”
* Record which trigger caused the review.

## Stripe Billing implementation

Use Stripe test mode first.

Implement:

* Stripe Customer creation
* Checkout Sessions
* Fixed recurring subscriptions
* Monthly and annual prices
* Module subscription items
* One-time implementation invoices
* Customer Portal sessions
* Usage meters and meter events
* In-arrears true-up invoices
* Automatic collection
* Send-invoice collection for approved enterprise accounts
* Refund records
* Dispute records
* Stripe Connect destination billing where enabled
* Partner application fees
* Partner commissions
* Stripe Tax feature flag
* Payment-failure and dunning workflows

Run the supplied stripe:bootstrap script and make it idempotent.

Create stable lookup keys for all Stripe prices.

Maintain separate test and live Stripe catalogs.

Never copy test product, price, meter, webhook, or customer IDs into live configuration.

Use idempotency keys when creating:

* Customers
* Checkout Sessions
* Subscriptions
* Invoices
* Invoice items
* Transfers
* Refunds
* Meter events where supported

## Stripe webhook requirements

Implement:

POST /webhooks/stripe

The endpoint must:

* Read the unmodified raw request body.
* Verify the Stripe-Signature header.
* Reject invalid signatures.
* Deduplicate webhook events.
* Return success quickly after durable event storage.
* Process longer work asynchronously.
* Be safe when the same event arrives more than once.
* Be safe when events arrive out of order.
* Record processing status and errors.
* Never grant access based only on Checkout success_url redirects.

Handle at minimum:

* checkout.session.completed
* customer.created
* customer.updated
* customer.subscription.created
* customer.subscription.updated
* customer.subscription.deleted
* invoice.created
* invoice.finalized
* invoice.paid
* invoice.payment_failed
* invoice.voided
* charge.refunded
* charge.dispute.created
* charge.dispute.closed

Use invoice.paid and verified subscription status to activate or continue paid access.

## Metering

Implement durable usage events for:

* Unique monthly active user
* Module-active user
* API request
* Webhook delivery
* Automation execution
* OCR page
* Signature envelope
* Storage GB-day
* AI tokens or model units
* Voice seconds
* Image generation
* Connected account
* Synced bank transaction
* Tax filing
* SMS
* Email delivery
* Third-party provider cost

Requirements:

* Generate a unique idempotency key for every usage event.
* Deduplicate the same active user, module, and date.
* Keep raw usage events and aggregated usage summaries.
* Allow usage corrections through adjustment records rather than deletion.
* Support invoice forecasting.
* Support billing-period close.
* Prevent a billing period from closing twice.
* Use PostgreSQL advisory locks or an equivalent lock.
* Forward applicable usage to Stripe Billing Meters.
* Keep HALO’s internal usage ledger as the authoritative usage record.
* Reconcile HALO usage totals to Stripe before invoice finalization.

## Collection models

Support all three models:

### partner_wholesale

* HALO bills the partner.
* The partner bills its own end customers.
* Partner controls retail price and markup.
* UR Founders uses this model initially.

### halo_direct

* HALO bills the end business.
* HALO records and pays the applicable partner commission.
* HALO owns billing support, refunds, and collection.

### stripe_connect

* HALO collects payment through Stripe Connect.
* Partner receives its configured share.
* HALO retains the application or platform fee.
* All transfers and reversals are audited.

## Dunning and entitlement restrictions

Implement configurable progression:

* Day 0: payment failed; notify billing administrator.
* Day 3: retry and reminder.
* Day 7: final retry; disable purchasing additional modules.
* Day 10: restricted mode; read-only access where appropriate.
* Day 15: suspend write-capable APIs and operational modules.
* Day 30: collections status.

Requirements:

* Never delete customer data for nonpayment.
* Preserve document and historical financial access according to contract and law.
* Allow payment-method repair through the Stripe Customer Portal.
* Restore entitlements automatically after verified payment.
* Audit every restriction and restoration.

## User interfaces

Integrate these interfaces into the existing HALO design system.

### Partner billing dashboard

Show:

* Current user tier
* Contracted user tier
* Monthly active users
* Enabled modules
* Active module users
* Included API allowance
* API usage
* Storage usage
* AI and third-party usage
* Estimated current invoice
* Previous invoices
* Payment status
* Payment method status
* Enterprise-review status
* Partner retail estimate
* Estimated gross margin

### A-la-carte Lego menu

Allow authorized partner administrators to:

* Review available modules.
* Review module descriptions and dependencies.
* Select modules.
* Select bundles.
* See pricing estimates.
* Assign modules to all users or subsets.
* Confirm activation.
* Deactivate future access according to contract rules.

Do not activate modules before server-side entitlement creation succeeds.

### Billing management

Provide:

* Start Checkout
* Open Customer Portal
* Download invoices
* View usage
* View invoice forecast
* Review failed-payment status
* Review contract dates
* Contact enterprise sales

### HALO platform admin

Provide:

* Search all partners
* View billing accounts
* View usage
* View enterprise triggers
* View failed payments
* View webhook failures
* View provider-cost reconciliation
* Generate and revoke partner API keys
* Adjust entitlements
* Apply approved credits
* Review audit history

## UR Founders integration

UR Founders must be an external partner configuration, not a hard-coded dependency.

Implement:

* Partner account for UR Founders
* Restricted server-side partner API key
* Wholesale billing model
* UR Founders external customer and company IDs
* Secure account provisioning
* Module selection API
* Embedded-module session support
* Single sign-on handoff using the existing HALO identity model
* Usage-event ingestion
* Billing forecast API
* Customer Portal API
* Webhook notifications back to UR Founders
* Idempotent company activation
* Reconciliation of UR Founders customer IDs to HALO workspace IDs

UR Founders should be able to call HALO to:

1. Create a workspace.
2. Send existing company data.
3. Activate selected HALO Legos.
4. Obtain a menu containing only licensed Legos.
5. Open embedded HALO components.
6. Record active users and usage.
7. View projected wholesale cost.
8. Upgrade modules.
9. Open the billing portal.
10. Receive status events.

Do not recreate UR Founders’ LLC formation or registered-agent functionality inside HALO.

## API requirements

Treat halo-openapi.yaml as the target public contract.

Implement or reconcile:

* Catalog endpoints
* Partner endpoints
* Workspace endpoints
* Billing-account endpoints
* Module-entitlement endpoints
* Pricing-estimate endpoints
* Checkout endpoints
* Customer Portal endpoints
* Usage-event endpoints
* Billing-forecast endpoints
* Invoice endpoints
* API-key endpoints
* Embed-session endpoints
* Webhook endpoints
* Enterprise-review endpoints
* Health and readiness endpoints

Requirements:

* Validate inputs with Zod or the existing validation library.
* Use consistent error objects.
* Include request IDs.
* Document authentication and scopes.
* Use pagination.
* Use idempotency headers for mutations.
* Add rate limiting.
* Add CORS allowlists.
* Keep internal routes separate from public partner routes.
* Generate updated OpenAPI documentation from actual route behavior.
* Add an interactive API documentation page for authorized developers.

## Background worker

Run long-running work outside web requests.

Worker responsibilities:

* Process Stripe webhook jobs.
* Aggregate usage.
* Forward Stripe meter events.
* Calculate invoice forecasts.
* Close billing periods.
* Generate arrears invoices.
* Run dunning transitions.
* Retry failed provider calls.
* Reconcile provider costs.
* Detect enterprise triggers.
* Emit partner webhooks.
* Clean expired embedded tokens.

Deploy the worker separately from the public API.

If this Replit project cannot publish the API and worker independently, create a second private Replit worker app connected to the same production database and secrets.

Use advisory locks or equivalent distributed locking.

## Replit deployment

Prepare:

### Public API

Command:

npm start

Preferred deployment:

Autoscale

Requirements:

* Bind to 0.0.0.0.
* Use the PORT environment variable.
* Provide /health and /ready endpoints.
* Do not run migrations automatically on every server startup.
* Use a custom API domain.
* Enable Replit monitoring and production alerts.

### Worker

Command:

npm run worker

Preferred deployment:

Reserved VM or separate always-on worker app

Requirements:

* No public routes unless strictly necessary.
* One primary worker.
* Advisory-lock protection.
* Structured logs.
* Error alerts.

### Database

Use Replit managed PostgreSQL or the existing production PostgreSQL.

Requirements:

* Separate development and production databases.
* Automatic backups.
* Point-in-time recovery where available.
* Least-privilege application role.
* Migration role separate from runtime role if practical.
* Database connection pooling.
* Tested restore procedure.

## Secrets

Create a complete Secrets checklist and use Replit Secrets. Never hard-code values.

Required or expected variables include:

NODE_ENV
PORT
DATABASE_URL
HALO_API_BASE_URL
HALO_DASHBOARD_URL
HALO_INTERNAL_JOB_SECRET
HALO_API_KEY_PEPPER
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_DEFAULT_CURRENCY
STRIPE_PRICE_CATALOG_PATH
STRIPE_TAX_ENABLED
STRIPE_AUTOMATIC_TAX
STRIPE_METER_FORWARDING
DUNNING_RESTRICT_DAY
DUNNING_SUSPEND_DAY
DUNNING_COLLECTION_DAY
USAGE_EVENT_BATCH_SIZE
WORKER_POLL_MS
ALLOWED_ORIGINS
PUBLIC_APP_URL

Also identify any existing authentication, email, logging, storage, SSO, encryption, or monitoring secrets already used by HALO.

Generate secure values only through cryptographically secure methods.

Do not print secret values in logs or final reports.

## Security hardening

Implement:

* Strict server-side authorization
* Tenant isolation tests
* API-key hashing and rotation
* Secret redaction
* Secure headers
* CORS allowlists
* Request size limits
* Rate limiting
* SQL injection protection
* Input validation
* Output encoding
* Audit logs
* Webhook signature verification
* Idempotency
* Replay protection
* Encryption for connector credentials
* Dependency vulnerability scanning
* No production stack traces returned to clients
* Separate test and live credentials
* Restricted internal endpoints
* Least-privilege Stripe key where feasible
* Secure session cookies
* CSRF protection where cookie-authenticated mutations exist

Do not claim PCI compliance merely because Stripe is used.

HALO must never store raw card numbers or bank-account credentials.

## Testing requirements

Add or complete:

### Unit tests

* Pricing boundaries
* Module minimums
* Bundle discounts
* API overages
* Provider-cost markup
* Enterprise triggers
* Dunning dates
* Entitlement checks
* API-key scopes

### Integration tests

* Database migrations
* Account creation
* Module activation
* Checkout Session creation
* Customer Portal Session creation
* Usage ingestion
* Usage aggregation
* Invoice forecast
* Billing-period close
* Webhook deduplication
* Out-of-order webhook handling
* Failed-payment restrictions
* Entitlement restoration
* Partner isolation

### End-to-end test flows

1. Create UR Founders wholesale billing account.
2. Select Business Essentials.
3. Create Stripe test Checkout.
4. Process checkout.session.completed.
5. Process invoice.paid.
6. Confirm entitlements.
7. Record monthly active users.
8. Record API usage.
9. Generate invoice forecast.
10. Run a manual month close.
11. Verify arrears invoice.
12. Trigger invoice.payment_failed.
13. Verify dunning restrictions.
14. Pay invoice.
15. Verify entitlement restoration.
16. Exceed enterprise threshold.
17. Confirm no standard automatic invoice is created.

### Security tests

* Partner A cannot access Partner B.
* Business A cannot access Business B.
* Read-only users cannot mutate.
* Revoked API keys fail.
* Expired embedded tokens fail.
* Invalid webhook signatures fail.
* Duplicate events do not double bill.
* Replayed idempotency keys do not duplicate mutations.

### Load tests

Create a repeatable load test for:

* Pricing-estimate endpoint
* Usage ingestion
* Module menu
* Billing forecast
* Webhook intake

Document the tested throughput and bottlenecks.

## Production commands

Ensure these commands exist and pass:

npm ci
npm run typecheck
npm test
npm run build
npm run db:migrate
npm run stripe:bootstrap
npm run keys:generate
npm start
npm run worker

Add:

npm run check:production

The check:production command must verify:

* Required environment variables
* Database connection
* Migration status
* Stripe API connectivity
* Stripe catalog presence
* Webhook configuration presence
* Pricing configuration validity
* Module catalog validity
* OpenAPI validity
* Health and readiness
* No test Stripe key in a live environment
* No live Stripe key in a test environment

## Completion standard

Do not report “production ready” merely because the application compiles.

Before completing this task:

1. Run type checking.
2. Run all tests.
3. Run the production build.
4. Run database migrations against a safe database.
5. Validate the OpenAPI files.
6. Run the Stripe bootstrap in test mode.
7. Verify the health endpoint.
8. Verify the worker starts.
9. Complete the test-mode billing flow.
10. Run tenant-isolation tests.
11. Run enterprise-threshold tests.
12. Run dependency and secret scans.
13. Produce a deployment runbook.
14. Produce a rollback runbook.
15. Produce a database backup-and-restore runbook.
16. Produce a list of external tasks that require a human account owner.

## Required final report

When finished, produce a report with:

* Existing architecture discovered
* Files added
* Files changed
* Database migrations
* Routes implemented
* UI screens implemented
* Tests added
* Test results
* Security controls
* Deployment configuration
* Required Replit Secrets
* Required Stripe Dashboard configuration
* Required DNS configuration
* Required manual actions
* Known limitations
* Rollback instructions
* Exact production launch checklist

Clearly separate:

* Completed and tested
* Implemented but awaiting credentials
* Requires human configuration
* Deferred
* Blocked

Do not hide failures, use mocked success as proof, or claim completion for anything that has not been tested.
