-- ==============================================================================
-- EcoTrack Supabase SQL Migration: Image Storage & Missing Profile Columns
-- Execute this entire script in your Supabase Project -> SQL Editor -> Run
-- ==============================================================================

-- 1. CREATE PUBLIC STORAGE BUCKETS FOR AVATARS AND PHOTOS
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  (
    'avatars',
    'avatars',
    true,
    10485760, -- 10MB limit per image
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
  ),
  (
    'photos',
    'photos',
    true,
    20971520, -- 20MB limit per photo
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
  ),
  (
    'maintenance-photos',
    'maintenance-photos',
    true,
    20971520, -- 20MB limit per photo
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
  )
ON CONFLICT (id) DO UPDATE 
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ==============================================================================
-- 2. CONFIGURE STORAGE ROW-LEVEL SECURITY (RLS) POLICIES
-- Allows reading, uploading, updating, and deleting images permanently
-- ==============================================================================

-- Clean up any conflicting old policies
DROP POLICY IF EXISTS "Public can view avatar images" ON storage.objects;
DROP POLICY IF EXISTS "Public can upload avatar images" ON storage.objects;
DROP POLICY IF EXISTS "Public can update avatar images" ON storage.objects;
DROP POLICY IF EXISTS "Public can delete avatar images" ON storage.objects;

DROP POLICY IF EXISTS "Allow public read access to avatars and photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert to avatars and photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public update to avatars and photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete to avatars and photos" ON storage.objects;

-- Policy A: Allow anyone (anon + authenticated) to view images in public buckets
CREATE POLICY "Allow public read access to avatars and photos"
ON storage.objects FOR SELECT
USING (bucket_id IN ('avatars', 'photos', 'maintenance-photos'));

-- Policy B: Allow anyone (anon + authenticated) to upload images
CREATE POLICY "Allow public insert to avatars and photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id IN ('avatars', 'photos', 'maintenance-photos'));

-- Policy C: Allow updating / overwriting existing images
CREATE POLICY "Allow public update to avatars and photos"
ON storage.objects FOR UPDATE
USING (bucket_id IN ('avatars', 'photos', 'maintenance-photos'))
WITH CHECK (bucket_id IN ('avatars', 'photos', 'maintenance-photos'));

-- Policy D: Allow deleting images
CREATE POLICY "Allow public delete to avatars and photos"
ON storage.objects FOR DELETE
USING (bucket_id IN ('avatars', 'photos', 'maintenance-photos'));

-- ==============================================================================
-- 3. ADD MISSING IMAGE & PROFILE COLUMNS TO EXISTING TABLES
-- Based on your database schema:
-- ==============================================================================

-- Staff table (Profile avatars, photos, assignments, password, and roles)
ALTER TABLE IF EXISTS public.staff 
  ADD COLUMN IF NOT EXISTS password TEXT,
  ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'HVAC / Aircon Technician',
  ADD COLUMN IF NOT EXISTS building_name TEXT DEFAULT 'Main Campus Building',
  ADD COLUMN IF NOT EXISTS floor_name TEXT DEFAULT '2nd Floor - IT Wing',
  ADD COLUMN IF NOT EXISTS room_name TEXT DEFAULT 'Server Room A',
  ADD COLUMN IF NOT EXISTS assignment TEXT DEFAULT 'Main Campus Building • 2nd Floor - IT Wing • Server Room A',
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT DEFAULT 'Administrative / Compliance Deactivation',
  ADD COLUMN IF NOT EXISTS archive_notes TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;


-- Administrators table
ALTER TABLE IF EXISTS public.administrators 
  ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Monitored Nodes / AC Units table
ALTER TABLE IF EXISTS public.nodes 
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Maintenance reports table (photo attachments)
ALTER TABLE IF EXISTS public.maintenance_reports 
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;

-- ==============================================================================
-- 4. ENABLE REALTIME REPLICATION (Instant sync across mobile & web)
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'staff'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'maintenance_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_reports;
  END IF;
END $$;
