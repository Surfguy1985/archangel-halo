# Money Lock
Auto-approve clean jobs → invoice queue. Exceptions → morning triage.
Correct mistakes: POST /api/work-reviews/:id/reopen-for-correction then apply-correction.
POST /api/work-reviews/money-lock/run  |  GET .../exceptions  |  GET .../summary
Nightly after 6pm on scheduler tick.
