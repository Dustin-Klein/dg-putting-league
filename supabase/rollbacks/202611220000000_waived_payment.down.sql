-- Emergency rollback for 202611220000000_waived_payment.sql. Waived entries become unpaid.

BEGIN;
UPDATE putting_league.event_players SET payment_type = NULL WHERE payment_type = 'waived';
ALTER TABLE putting_league.event_players DROP CONSTRAINT event_players_payment_type_check;
ALTER TABLE putting_league.event_players ADD CONSTRAINT event_players_payment_type_check
  CHECK (payment_type IN ('cash', 'electronic'));
COMMIT;
