Prepare HALO for controlled live production activation.

Do not expose, print, or commit any secret values. Do not automatically enable live payment collection until the environment and Stripe resources are verified.

## Live activation tasks

1. Verify that this is the production Replit environment.
2. Verify that production uses a separate database from development.
3. Verify that all database migrations have been applied.
4. Verify that a current database backup exists.
5. Verify the documented rollback procedure.
6. Verify that all required Replit Secrets exist.
7. Reject startup if a Stripe test key is present while NODE_ENV is production.
8. Verify that the Stripe live webhook endpoint exists.
9. Verify that the configured webhook secret belongs to the live endpoint.
10. Run the Stripe catalog bootstrap using the live Stripe key.
11. Confirm that live Products, Prices, Meters, and lookup keys are separate from test resources.
12. Confirm Stripe Customer Portal live-mode configuration.
13. Confirm invoice branding, business name, support email, statement descriptor, payment methods, and recovery settings.
14. Keep Stripe Tax disabled unless registrations and product tax codes have been reviewed and approved.
15. Verify the custom API domain and HTTPS.
16. Verify production CORS allowlists.
17. Verify the HALO dashboard production domain.
18. Verify Replit monitoring and production alerts.
19. Verify the API Autoscale deployment.
20. Verify the worker Reserved VM or separate worker deployment.
21. Verify /health and /ready.
22. Verify the worker can connect to the production database.
23. Generate the UR Founders production partner API key.
24. Display the plaintext API key only once through the secure generation process.
25. Store the UR Founders key only as a server-side Replit Secret in the UR Founders application.
26. Create the UR Founders wholesale billing account.
27. Configure the initial committed user tier.
28. Activate only the approved initial HALO modules.
29. Create the live Checkout Session.
30. Complete one controlled live payment with an authorized internal account.
31. Verify the Stripe webhook.
32. Verify invoice.paid.
33. Verify HALO entitlements.
34. Verify the Customer Portal.
35. Record one active-user event.
36. Record one test API-usage event.
37. Verify the invoice forecast.
38. Verify the billing and audit logs.
39. Confirm no duplicate charges or duplicate usage.
40. Confirm enterprise safeguards remain enabled.

## Controlled rollout

Configure rollout stages:

* Internal HALO administrators
* UR Founders internal administrators
* Five pilot businesses
* Twenty-five pilot businesses
* First fifty active users
* General availability

Add a feature flag that allows new partner activations to be paused without shutting down existing customers.

Add an emergency billing kill switch that:

* Stops new subscriptions and new usage invoices.
* Does not delete data.
* Does not cancel existing subscriptions automatically.
* Requires HALO platform-administrator access.
* Creates an audit event.

## Required launch report

Provide:

* Production deployment URLs
* Deployment types
* Database migration status
* Stripe live catalog status
* Webhook status
* Monitoring status
* UR Founders account status
* Enabled modules
* Pilot rollout status
* Known limitations
* Emergency procedures
* Final GO or NO-GO decision

Do not return GO until the controlled live payment, verified webhook, entitlement activation, usage event, invoice forecast, and database backup have all been confirmed.
