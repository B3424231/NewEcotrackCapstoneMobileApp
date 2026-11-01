-- Correct historical parent checklists whose explicitly linked repair was already
-- submitted. No repair is approved here and ambiguous relationships are untouched.
begin;
with repaired_tasks as (
 select p.id,
   jsonb_agg(case when c.id is not null then t.value || jsonb_build_object(
     'status','For Verification','repaired',false,'isRepaired',false,'verified',false,'verifiedAt',null)
     else t.value end order by t.ordinality) as tasks,
   bool_or(c.id is not null) as changed
 from public.maintenance_reports p
 cross join lateral jsonb_array_elements(case when jsonb_typeof(p.tasks::jsonb)='array' then p.tasks::jsonb else '[]'::jsonb end) with ordinality t
 left join public.maintenance_reports c on c.id=coalesce(nullif(t.value->>'linkedRepairId',''),nullif(t.value->>'linked_repair_id',''),nullif(t.value->>'repairId',''),nullif(t.value->>'repair_id',''))
   and coalesce(c.parent_report_id,c.issue->>'parent_report_id',c.issue->>'parentReportId')=p.id
   and c.status='For Verification' and (c.id like 'REP-%' or coalesce(c.type,'') ~* '(repair|corrective)')
   and t.value->>'status' in ('Under Repair','under_repair')
 where p.status not in ('Completed','Verified')
 group by p.id
)
update public.maintenance_reports p set tasks=r.tasks,
 status=case when not exists(select 1 from jsonb_array_elements(r.tasks) t where coalesce(t->>'status','') not in ('Completed','For Verification'))
   then 'For Verification' else p.status end,
 updated=greatest(clock_timestamp(),coalesce(p.updated,'-infinity')+interval '1 microsecond'),
 timeline=jsonb_build_array(jsonb_build_object('title','Linked submitted repair synchronized for administrator verification','time',clock_timestamp(),'done',true,'migration','202609300005')) || coalesce(p.timeline::jsonb,'[]'::jsonb)
from repaired_tasks r where r.id=p.id and r.changed;
commit;
