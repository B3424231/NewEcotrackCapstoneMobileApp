-- Both linked-controller columns reference nodes.id, never the editable name.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $migration$
DECLARE definition text; old_fragment text; new_fragment text; changes text[];
BEGIN
 SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc
 WHERE oid=to_regprocedure('public.ecotrack_device_mutation(text,text,jsonb)');
 IF definition IS NULL THEN RAISE EXCEPTION 'Install device transaction migration first'; END IF;
 changes:=ARRAY[
  'controller_node_id = v_node.id, node_id = v_node.name,',
  'controller_node_id = v_node.id, node_id = v_node.id,',
  'v_room, v_node.name, v_node.id, v_node.protocol_name',
  'v_room, v_node.id, v_node.id, v_node.protocol_name',
  'room_id = v_room, node_id = v_node.name, controller_node_id = v_node.id,',
  'room_id = v_room, node_id = v_node.id, controller_node_id = v_node.id,',
  'v_room, v_node.name, v_node.id,',
  'v_room, v_node.id, v_node.id,'
 ];
 FOR i IN 1..array_length(changes,1) BY 2 LOOP
  old_fragment:=changes[i]; new_fragment:=changes[i+1];
  IF position(old_fragment IN definition)>0 THEN
   definition:=replace(definition,old_fragment,new_fragment);
  ELSIF position(new_fragment IN definition)=0 THEN
   RAISE EXCEPTION 'Device mutation changed; review controller-reference patch before applying';
  END IF;
 END LOOP;
 -- Replacing the body preserves the existing function owner, grants and guards.
 EXECUTE definition;
END
$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
