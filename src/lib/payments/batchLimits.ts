/* One source of truth for the batch-payout recipient cap.
 *
 * The client used to have no cap at all — "Add Recipient" appended without limit — while the
 * send route rejected anything over its own hardcoded number. So the only feedback for going too
 * far was a 400 after filling in every row. Both sides import this instead.
 *
 * Deliberately dependency-free so the client bundle can import it without pulling in server code.
 */
export const MAX_BATCH_RECIPIENTS = 22;
