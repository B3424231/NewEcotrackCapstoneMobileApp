-- Apply only after the existing application schema has been installed.
-- This patch does not change grants or RLS policies and does not delete data.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.aircons') IS NULL OR to_regclass('public.mobile_notifications') IS NULL THEN
    RAISE EXCEPTION 'Install the existing aircons and mobile_notifications schema first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.aircons WHERE asset_tag IS NOT NULL GROUP BY asset_tag HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate aircon asset tags exist; reconcile these records before applying this patch';
  END IF;
END $$;

-- An ordinary index cannot support ON CONFLICT (asset_tag).
CREATE UNIQUE INDEX IF NOT EXISTS uq_aircons_asset_tag ON public.aircons(asset_tag);

ALTER TABLE public.mobile_notifications
  ADD COLUMN IF NOT EXISTS aircon_type text,
  ADD COLUMN IF NOT EXISTS verification_remarks text;

-- The profile service supports administrator phone numbers too.
ALTER TABLE IF EXISTS public.administrators ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_mobile_notif_recipient_created
  ON public.mobile_notifications(staff_name, created_at DESC);

COMMIT;
