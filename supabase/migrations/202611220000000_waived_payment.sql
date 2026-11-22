-- Waived: plays without paying; counts as paid and as a full entry in the pot.
ALTER TABLE putting_league.event_players DROP CONSTRAINT event_players_payment_type_check;
ALTER TABLE putting_league.event_players ADD CONSTRAINT event_players_payment_type_check
  CHECK (payment_type IN ('cash', 'electronic', 'waived'));
