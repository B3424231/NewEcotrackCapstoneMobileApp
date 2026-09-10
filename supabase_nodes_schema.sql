-- ============================================================================
-- ECOTRACK SUPABASE NODES SCHEMA & REALTIME SETUP
-- ============================================================================

-- 1. Ensure rooms table exists (if not created yet)
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY DEFAULT ('room_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    name TEXT NOT NULL,
    node_limit INTEGER DEFAULT 10,
    floor_id TEXT,
    admin_id TEXT,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create nodes table matching the ESP32-S3 and Mobile / Desktop specification
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY DEFAULT ('node_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    name TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    temp NUMERIC DEFAULT 0,
    pressure NUMERIC DEFAULT 0,
    rssi NUMERIC DEFAULT 0,
    battery NUMERIC DEFAULT 0,
    wake_time TEXT DEFAULT '00:00',
    sleep_time TEXT DEFAULT '00:00',
    interval_val INTEGER DEFAULT 15,
    interval_unit TEXT DEFAULT 'Minutes',
    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
    aircon_type TEXT DEFAULT 'Split Type (Inverter)',
    install_date TEXT DEFAULT '2026-01-15',
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Automatic Updated Timestamp Trigger Function
CREATE OR REPLACE FUNCTION update_nodes_updated_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nodes_updated ON nodes;
CREATE TRIGGER trg_nodes_updated
    BEFORE UPDATE ON nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_nodes_updated_column();

-- 4. Indexes for fast query performance
CREATE INDEX IF NOT EXISTS idx_nodes_room_id ON nodes(room_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated DESC);

-- 5. Enable Row Level Security (RLS) & Allow Access
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;

-- Allow anonymous & authenticated reads
DROP POLICY IF EXISTS "Allow public read access on nodes" ON nodes;
CREATE POLICY "Allow public read access on nodes"
    ON nodes FOR SELECT
    USING (true);

-- Allow anonymous & authenticated inserts (ESP32-S3 + Mobile App registration)
DROP POLICY IF EXISTS "Allow public insert on nodes" ON nodes;
CREATE POLICY "Allow public insert on nodes"
    ON nodes FOR INSERT
    WITH CHECK (true);

-- Allow anonymous & authenticated updates (ESP32-S3 telemetry heartbeat & App renames)
DROP POLICY IF EXISTS "Allow public update on nodes" ON nodes;
CREATE POLICY "Allow public update on nodes"
    ON nodes FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- Allow anonymous & authenticated deletes (Device unlinking)
DROP POLICY IF EXISTS "Allow public delete on nodes" ON nodes;
CREATE POLICY "Allow public delete on nodes"
    ON nodes FOR DELETE
    USING (true);

-- 6. Enable Realtime Replication for the nodes table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'nodes'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE nodes;
    END IF;
END $$;
