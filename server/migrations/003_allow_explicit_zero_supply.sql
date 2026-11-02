ALTER TABLE milk_entries
  DROP CONSTRAINT milk_entries_quantity_litres_check;

ALTER TABLE milk_entries
  ADD CONSTRAINT milk_entries_quantity_litres_check CHECK (quantity_litres >= 0);
