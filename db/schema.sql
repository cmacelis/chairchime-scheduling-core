CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE businesses (
 id text PRIMARY KEY, display_name text NOT NULL, timezone text NOT NULL,
 opens integer NOT NULL CHECK(opens BETWEEN 0 AND 1439),
 closes integer NOT NULL CHECK(closes BETWEEN 1 AND 1440 AND closes>opens),
 weekdays integer[] NOT NULL, notice_minutes integer NOT NULL DEFAULT 0 CHECK(notice_minutes>=0),
 horizon_days integer NOT NULL DEFAULT 60 CHECK(horizon_days>0),
 business_info jsonb NOT NULL DEFAULT '{}', day_schedule jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE services (
 id text NOT NULL, business_id text NOT NULL REFERENCES businesses(id), name text NOT NULL,
 duration integer NOT NULL CHECK(duration>0), buffer integer NOT NULL CHECK(buffer>=0),
 price integer NOT NULL CHECK(price>=0), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(business_id,id)
);
-- Existing single-resource behavior deliberately retained. Multi-staff is future work.
CREATE TABLE reservations (
 id uuid PRIMARY KEY, business_id text NOT NULL REFERENCES businesses(id),
 kind text NOT NULL CHECK(kind IN ('appointment','block')),
 starts timestamptz NOT NULL, ends timestamptz NOT NULL CHECK(ends>starts),
 occupied_until timestamptz NOT NULL CHECK(occupied_until>=ends), active boolean NOT NULL DEFAULT true,
 customer_name text, service_id text, price integer, request_key text NOT NULL,
 request_fingerprint text NOT NULL, customer_email text,
 UNIQUE(business_id,request_key),
 EXCLUDE USING gist (business_id WITH =, tstzrange(starts,occupied_until,'[)') WITH &&) WHERE(active)
);
CREATE TABLE mutation_receipts (
 business_id text NOT NULL REFERENCES businesses(id),request_key text NOT NULL,
 fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(business_id,request_key)
);
-- Local event log only; there is no worker or external delivery provider.
CREATE TABLE outbox (
 id bigserial PRIMARY KEY,reservation_id uuid REFERENCES reservations(id),
 kind text NOT NULL,status text NOT NULL DEFAULT 'local_only',UNIQUE(reservation_id,kind)
);
