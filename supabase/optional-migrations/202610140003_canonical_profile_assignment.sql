-- Resolve the profile's display assignment using its room ID.
-- No saved account assignments, authorization guards or function grants change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $patch$
DECLARE definition text; old_expression text;
 replacement text := $expression$/* canonical_assignment_20261014 */
 CASE WHEN s.room_id IS NOT NULL AND s.room_id NOT IN ('ALL','all_rooms','all') THEN
  coalesce((SELECT concat_ws(' • ',nullif(b.name,''),nullif(f.name,''),nullif(r.name,''))
   FROM public.rooms r JOIN public.floors f ON f.id=r.floor_id
   JOIN public.buildings b ON b.id=f.building_id WHERE r.id=s.room_id),'Unassigned')
 ELSE coalesce(s.assignment,'Unassigned') END$expression$;
BEGIN
 IF to_regprocedure('public.ecotrack_my_profile()') IS NULL THEN
  RAISE EXCEPTION 'Install account authentication and active-profile RPC first';
 END IF;
 definition := pg_get_functiondef('public.ecotrack_my_profile()'::regprocedure);
 IF position('canonical_assignment_20261014' IN definition)>0 THEN RETURN; END IF;
 IF position('public.ecotrack_staff_id() is null' IN lower(definition))=0
  OR position('auth.uid()' IN lower(definition))=0 THEN
  RAISE EXCEPTION 'Unrecognized active-profile authorization guards; no changes applied';
 END IF;
 old_expression := 'coalesce(s.assignment,''Unassigned'')';
 IF position(old_expression IN definition)=0 THEN
  old_expression := 'coalesce(s.assignment, ''Unassigned'')';
 END IF;
 IF position(old_expression IN definition)=0 THEN
  RAISE EXCEPTION 'Unrecognized profile assignment expression; no changes applied';
 END IF;
 EXECUTE replace(definition,old_expression,replacement);
END $patch$;
COMMIT;
