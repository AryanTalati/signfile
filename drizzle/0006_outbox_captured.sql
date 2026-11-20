-- 'captured': the email was recorded but not sent (sending off in this environment, or a
-- reserved test address). Legacy 'skipped' rows are shown as captured in the UI.
ALTER TYPE "outbox_status" ADD VALUE IF NOT EXISTS 'captured';
