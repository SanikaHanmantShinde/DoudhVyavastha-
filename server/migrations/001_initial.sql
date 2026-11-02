CREATE TABLE dairies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_name text NOT NULL,
  display_name text NOT NULL,
  owner_name text NOT NULL,
  mobile text NOT NULL,
  village text NOT NULL,
  address text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  mobile text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_mobile_idx ON users (mobile);

CREATE TABLE dairy_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'STAFF')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dairy_id, user_id)
);
CREATE INDEX dairy_memberships_user_idx ON dairy_memberships (user_id, dairy_id);

CREATE TABLE producers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  producer_code text NOT NULL,
  name text NOT NULL,
  mobile text,
  village text NOT NULL,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dairy_id, producer_code),
  UNIQUE (dairy_id, id)
);
CREATE INDEX producers_dairy_name_idx ON producers (dairy_id, name);

CREATE TABLE milk_rate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  milk_type text NOT NULL CHECK (milk_type IN ('COW', 'BUFFALO')),
  effective_from date NOT NULL,
  fat_min numeric(5,2) NOT NULL CHECK (fat_min >= 0),
  fat_max numeric(5,2) NOT NULL CHECK (fat_max > fat_min),
  snf_min numeric(5,2) NOT NULL CHECK (snf_min >= 0),
  snf_max numeric(5,2) NOT NULL CHECK (snf_max > snf_min),
  rate_per_litre numeric(12,4) NOT NULL CHECK (rate_per_litre >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX milk_rate_rules_lookup_idx ON milk_rate_rules
  (dairy_id, milk_type, effective_from DESC);

CREATE TABLE milk_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL,
  producer_code_snapshot text NOT NULL,
  producer_name_snapshot text NOT NULL,
  collected_at timestamptz NOT NULL,
  milk_type text NOT NULL CHECK (milk_type IN ('COW', 'BUFFALO')),
  start_reading numeric(12,3) NOT NULL,
  end_reading numeric(12,3) NOT NULL,
  quantity_litres numeric(12,3) NOT NULL CHECK (quantity_litres > 0),
  fat numeric(5,2) NOT NULL CHECK (fat >= 0),
  snf numeric(5,2) NOT NULL CHECK (snf >= 0),
  rate_per_litre numeric(12,4) NOT NULL CHECK (rate_per_litre >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  rate_rule_id uuid REFERENCES milk_rate_rules(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dairy_id, producer_id) REFERENCES producers(dairy_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX milk_entries_dairy_date_idx ON milk_entries (dairy_id, collected_at DESC);
CREATE INDEX milk_entries_dairy_producer_idx ON milk_entries (dairy_id, producer_id, collected_at DESC);

CREATE TABLE feed_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  name text NOT NULL,
  rate numeric(12,2) NOT NULL CHECK (rate >= 0),
  unit text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dairy_id, item_code),
  UNIQUE (dairy_id, id)
);
CREATE INDEX feed_items_dairy_name_idx ON feed_items (dairy_id, name);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_dairy_date_idx ON audit_logs (dairy_id, created_at DESC);

CREATE TABLE session (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);
