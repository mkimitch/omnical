-- Add transparency column to raw_events for free/busy support
-- Values: 'opaque' (blocks time, default) or 'transparent' (free)
ALTER TABLE raw_events ADD COLUMN transparency TEXT DEFAULT 'opaque';

-- Index for potential filtering by transparency
CREATE INDEX IF NOT EXISTS raw_events_transparency ON raw_events (transparency);
