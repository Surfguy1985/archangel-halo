Perform an adversarial production-readiness audit of the HALO application you just integrated.

Do not add new features unless required to correct a production defect. Assume this application will handle real customer billing, tax-related documents, business financial information, API keys, partner accounts, and Stripe payments.

## Audit scope

Review:

* Application architecture
* Database migrations
* Tenant isolation
* Authentication and authorization
* API-key security
* Stripe integration
* Webhook verification
* Billing idempotency
* Usage metering
* Entitlement enforcement
* Enterprise routing
* Dunning
* Background jobs
* Logging
* Secrets
* Error handling
* Rate limiting
* CORS
* CSRF
* Dependency security
* OpenAPI accuracy
* Replit deployment configuration
* Backup and restore
* Monitoring and alerting
* Test coverage
* Data retention
* Rollback capability

## Required actions

1. Search the repository for:

   * sk_test_
   * sk_live_
   * rk_live_
   * pt_live_
   * whsec_
   * DATABASE_URL
   * TODO
   * FIXME
   * mock
   * temporary
   * hard-coded tenant IDs
   * hard-coded Stripe IDs
   * console.log
   * unprotected internal routes

2. Verify that:

   * No secret is committed.
   * Webhook signatures use the raw body.
   * Duplicate webhooks cannot double bill.
   * Out-of-order webhooks cannot incorrectly grant access.
   * All financial mutations use idempotency.
   * API keys are hashed and scoped.
   * Every tenant-scoped query enforces ownership.
   * Entitlements are checked server-side.
   * Enterprise accounts cannot receive standard automatic pricing.
   * Usage cannot be counted twice.
   * Billing periods cannot close twice.
   * Failed payments restrict access according to policy.
   * Successful payment restores access.
   * Test and live Stripe resources cannot be mixed.
   * Database migrations are reversible or have a documented rollback.
   * The worker cannot be triggered publicly.
   * Health and readiness endpoints behave correctly.
   * Production errors do not expose stack traces or secrets.

3. Create two test tenants and attempt cross-tenant access through every sensitive route.

4. Replay identical:

   * API mutations
   * Usage events
   * Stripe webhook events
   * Billing-close jobs

5. Test pricing boundaries:

   * 50 and 51 users
   * 1,000 and 1,001 users
   * 50 million and 50 million plus one API calls
   * 250 and 251 sustained requests per second

6. Run:

   * npm ci
   * npm run typecheck
   * npm test
   * npm run build
   * npm run check:production
   * Dependency vulnerability scan
   * Secret scan
   * OpenAPI validation

7. Correct every critical or high-severity issue.

## Final output

Produce:

* Critical findings
* High findings
* Medium findings
* Low findings
* Corrections made
* Tests run
* Exact test results
* Remaining manual configuration
* Remaining risks
* A clear GO or NO-GO decision

Return GO only when there are no unresolved critical or high-severity findings and all production acceptance tests pass.

Do not soften the assessment. Do not mark a failed or untested control as complete.
