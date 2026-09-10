-- ==============================================================================
-- EcoTrack Supabase Migration: Maintenance Relationships & State Isolation
-- Run this in your Supabase Project -> SQL Editor -> Run
-- ==============================================================================

-- 1. Add explicit parent_report_id and linked_repair_id columns to maintenance_reports
ALTER TABLE public.maintenance_reports 
ADD COLUMN IF NOT EXISTS parent_report_id TEXT,
ADD COLUMN IF NOT EXISTS linked_repair_id TEXT;

-- 2. Create indexes for fast lookup of parent/child relationships
CREATE INDEX IF NOT EXISTS idx_maint_parent_report_id ON public.maintenance_reports(parent_report_id);
CREATE INDEX IF NOT EXISTS idx_maint_linked_repair_id ON public.maintenance_reports(linked_repair_id);

-- 3. Ensure Row-Level Security (RLS) allows reads and updates
ALTER TABLE public.maintenance_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'maintenance_reports' AND policyname = 'Allow public read access on maintenance_reports'
    ) THEN
        CREATE POLICY "Allow public read access on maintenance_reports"
            ON public.maintenance_reports FOR SELECT
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'maintenance_reports' AND policyname = 'Allow public update on maintenance_reports'
    ) THEN
        CREATE POLICY "Allow public update on maintenance_reports"
            ON public.maintenance_reports FOR UPDATE
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
