// Operator-only tool. Never import from the Expo app or embed the server key.
const {createClient}=require('@supabase/supabase-js');
const {randomBytes}=require('node:crypto');

async function run(){
 const url=process.env.ECOTRACK_OPERATOR_URL;
 const key=process.env.ECOTRACK_OPERATOR_SECRET;
 if(!url||!key)throw Error('Set ECOTRACK_OPERATOR_URL and ECOTRACK_OPERATOR_SECRET in the operator environment.');
 const ref=new URL(url).hostname.split('.')[0];
 const args=process.argv.slice(2),apply=args.includes('--apply');
 if(apply&&args[args.indexOf('--project-ref')+1]!==ref)throw Error('Writing requires --apply --project-ref matching the configured project.');
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const profiles=[];
 for(const [table,type] of [['staff','staff'],['administrators','admin']]){
   let after=null;
   for(;;){
     let q=client.from(table).select('id,email,auth_user_id,is_archived').order('id').limit(250);
     if(after)q=q.gt('id',after);
     const {data,error}=await q;
     if(error)throw Error('Unable to read profile mapping. Apply the reviewed authentication migration first.');
     if(!data.length)break;
     profiles.push(...data.map(p=>({...p,type})));after=data.at(-1).id;
   }
 }
 const users=[];
 for(let page=1;;page++){
   const {data,error}=await client.auth.admin.listUsers({page,perPage:250});
   if(error)throw Error('Unable to inspect existing Auth mappings.');
   users.push(...data.users);if(!data.users.length)break;
 }
 const emails=new Map();let conflicts=0,linked=0,archived=0;const pending=[];
 for(const p of profiles){
   const email=(p.email||'').trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||emails.has(email)){conflicts++;continue;}
   emails.set(email,p.id);
   if(p.auth_user_id){const u=users.find(u=>u.id===p.auth_user_id);if(!u||u.email?.toLowerCase()!==email)conflicts++;else linked++;continue;}
   if(p.is_archived){archived++;continue;}
   // Existing Auth accounts require an explicit administrator-reviewed mapping.
   // Matching an email is insufficient evidence to reassign an existing subject.
   if(users.some(u=>u.email?.toLowerCase()===email)){conflicts++;continue;}
   pending.push({...p,email});
 }
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',profiles:profiles.length,linked,archived,pending:pending.length,conflicts}));
 if(conflicts)throw Error('Resolve ambiguous, invalid or existing-account mappings before provisioning. No accounts were created.');
 if(!apply)return;
 let created=0;
 for(const p of pending){
   const {data,error}=await client.auth.admin.createUser({email:p.email,password:randomBytes(48).toString('base64url'),email_confirm:false,
     app_metadata:{ecotrack_profile_id:p.id,ecotrack_account_type:p.type}});
   if(error||!data.user)throw Error(`Provisioning stopped after ${created} accounts. Inspect server logs; rerun dry-run before retrying.`);
   created++;
 }
 console.log(JSON.stringify({created,message:'No passwords were printed or copied. Users must verify ownership using the configured email recovery flow. No emails were sent by this tool.'}));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
