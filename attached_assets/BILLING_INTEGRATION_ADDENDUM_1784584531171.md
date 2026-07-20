# HALO Billing and Collection Integration Addendum

## Commercial source of truth

HALO controls pricing versions, monthly active users, module entitlements, usage events, enterprise thresholds, true-ups, and access states. Stripe controls stored payment methods, invoices, subscriptions, payment attempts, refunds, disputes, and collection status.

## Supported collection models

### Partner wholesale

HALO invoices UR Founders or another platform partner. The partner bills its own end customers and retains the retail markup. This is the recommended first production model for UR Founders.

### HALO direct

HALO bills the end business directly. HALO may calculate and transfer a fixed or percentage commission to the referring partner.

### Stripe Connect

HALO creates a destination subscription or payment flow, transfers the partner share to a connected account, and retains its application fee. Use this when HALO becomes the embedded payment infrastructure rather than only the software vendor.

## Charge timing

| Charge | Timing |
|---|---|
| Committed HALO Core tier | In advance |
| Module minimums | In advance |
| Core-tier true-up | In arrears |
| Module active-user true-up | In arrears |
| API overage | In arrears |
| Storage, OCR, signature, automation, and AI usage | In arrears |
| Third-party provider cost plus service fee | In arrears |
| Implementation | 50% at signing and 50% at production launch |

## Standard pricing boundary

Standard automated pricing covers 1–1,000 monthly active users in 50-user bands. The pricing engine stops automatic quoting and requires an enterprise agreement when any of these conditions applies:

- More than 1,000 monthly active users
- More than 50 million API calls per month
- More than 250 sustained requests per second
- Dedicated environment or data residency
- Contractual SLA of 99.95% or higher
- Custom security, compliance, or audit obligations
- 24/7 support or named technical account management

## Integration sequence

1. Create the partner billing account.
2. Select collection model and payment terms.
3. Add module entitlements.
4. Create a Stripe Checkout session or direct subscription.
5. Record unique user/module activity.
6. Record API and provider usage.
7. Run monthly close and create arrears invoice.
8. Process Stripe webhooks and update access status.
9. Expose billing forecast and usage to the partner portal.
10. Route enterprise accounts to contracted pricing.

## Files that implement this design

- `halo-billing-service/src/billing/billing-service.ts`
- `halo-billing-service/src/billing/pricing-engine.ts`
- `halo-billing-service/src/billing/usage-service.ts`
- `halo-billing-service/src/billing/stripe-webhook-service.ts`
- `halo-billing-service/src/billing/connect-service.ts`
- `halo-billing-service/src/billing/dunning-service.ts`
- `halo-billing-service/src/db/schema.ts`
- `halo-billing-service/src/routes/`
- `halo-billing-service/scripts/bootstrap-stripe.ts`
- `halo-billing-service/examples/ur-founders/`
