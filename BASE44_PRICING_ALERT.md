# Base44 — Always verify after Log Work

Every Log Work opens a card that checks pricing, missing services, and crew assignment for correct payout.

Webhook returns showModal:true + verification.missingServices + verification.crewAssignmentIssues + suggestions.

haloWrite action pricing_alert always has show_modal:true.
