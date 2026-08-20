# Base44 Log Work Modal
WORK_RECONCILIATION_URL = https://archangel-halo.replit.app/api/internal/work-logged
(Workspace until redeploy: https://bff8695c-1bc6-462a-82ec-dbe35b22681d-00-wh8czlva3w1n.spock.replit.dev/api/internal/work-logged)

After Log Work: POST webhook with jobId; always open modal when showModal/verification.
Field submit: POST /api/work-reviews/:id/field-submit
Complete: POST /api/work-reviews/:id/complete
