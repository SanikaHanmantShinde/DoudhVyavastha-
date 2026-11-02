CREATE TABLE dairy_producer_counters (
  dairy_id uuid PRIMARY KEY REFERENCES dairies(id) ON DELETE CASCADE,
  next_value bigint NOT NULL CHECK (next_value > 0)
);

INSERT INTO dairy_producer_counters (dairy_id, next_value)
SELECT dairy_id,
       COALESCE(MAX(substring(producer_code FROM '^[A-Za-z-]*([0-9]+)$')::bigint), 0) + 1
FROM producers
GROUP BY dairy_id;

ALTER TABLE producers
  ADD COLUMN photo_storage_key text,
  ADD COLUMN photo_mime_type text;

CREATE TABLE feed_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL,
  feed_item_id uuid NOT NULL,
  producer_code_snapshot text NOT NULL,
  producer_name_snapshot text NOT NULL,
  feed_name_snapshot text NOT NULL,
  issue_date date NOT NULL,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  rate_per_unit numeric(12,2) NOT NULL CHECK (rate_per_unit >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  remarks text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dairy_id, producer_id) REFERENCES producers(dairy_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (dairy_id, feed_item_id) REFERENCES feed_items(dairy_id, id) ON DELETE RESTRICT
);
CREATE INDEX feed_issues_dairy_date_idx ON feed_issues (dairy_id, issue_date DESC);
CREATE INDEX feed_issues_dairy_producer_idx ON feed_issues (dairy_id, producer_id, issue_date DESC);

CREATE TABLE producer_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL,
  producer_code_snapshot text NOT NULL,
  producer_name_snapshot text NOT NULL,
  advance_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  remarks text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (dairy_id, producer_id) REFERENCES producers(dairy_id, id) ON DELETE RESTRICT
);
CREATE INDEX producer_advances_dairy_date_idx ON producer_advances (dairy_id, advance_date DESC);
CREATE INDEX producer_advances_dairy_producer_idx ON producer_advances (dairy_id, producer_id, advance_date DESC);

CREATE TABLE producer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL,
  producer_code_snapshot text NOT NULL,
  producer_name_snapshot text NOT NULL,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  remarks text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dairy_id, producer_id) REFERENCES producers(dairy_id, id) ON DELETE RESTRICT
);
CREATE INDEX producer_payments_dairy_producer_idx
  ON producer_payments (dairy_id, producer_id, payment_date DESC);
