import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
const headers = { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Cache-Control':'no-store' };
const reply = (status:number,body:unknown) => new Response(JSON.stringify(body),{status,headers});
Deno.serve(async request => {
 if(request.method==='OPTIONS')return new Response(null,{headers});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed'});
 try {
  const url=Deno.env.get('SUPABASE_URL')!;
  const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
  const authorization=request.headers.get('Authorization')||'';
  const caller=createClient(url,publicKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const identity=await caller.auth.getUser();
  if(identity.error||!identity.data.user)return reply(401,{error:'Sign in required'});
  const allowed=await caller.rpc('ecotrack_is_admin');
  if(allowed.error||allowed.data!==true)return reply(403,{error:'Administrator required'});
  const body=await request.text();if(body.length>10000)return reply(400,{error:'Invalid profile'});
  const {profile:p,operationId}=JSON.parse(body);
  if(!p||typeof operationId!=='string'||!/^desktop-[a-zA-Z0-9-]{8,90}$/.test(operationId)||typeof p.name!=='string'||!p.name.trim()||p.name.length>120
    ||typeof p.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)||typeof p.phone!=='string'||p.phone.replace(/\D/g,'').length<7
    ||typeof p.password!=='string'||p.password.length<8||p.password.length>1024)return reply(400,{error:'Name, email, phone, a secure password and operation ID are required'});
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const id='stf_'+operationId.slice(8),email=p.email.trim().toLowerCase();
  const prior=await admin.from('staff').select('id,name,email,phone,auth_user_id').eq('id',id).maybeSingle();
  if(prior.error)return reply(503,{error:'Profile lookup failed'});
  if(prior.data){
    if(prior.data.email!==email||prior.data.name!==p.name.trim()||prior.data.phone!==p.phone.trim())return reply(409,{error:'Operation ID already used'});
    if(prior.data.auth_user_id)return reply(200,{profile:prior.data});
  } else {
    const permitted=['role','building_name','floor_name','room_name','room_id','assignment','assignment_scope','assigned_floor_id','assigned_building_id'];
    const fields=Object.fromEntries(Object.entries(p).filter(([key])=>permitted.includes(key)));
    const created=await admin.from('staff').insert({id,...fields,name:p.name.trim(),email,phone:p.phone.trim(),status:'Active',is_archived:false,created:new Date().toISOString(),updated:new Date().toISOString()});
    if(created.error)return reply(409,{error:'Profile could not be created. Check duplicate email/phone and assignment.'});
  }
  const account=await admin.auth.admin.createUser({email,password:p.password,email_confirm:true,app_metadata:{ecotrack_profile_id:id,ecotrack_account_type:'staff'}});
  if(account.error||!account.data.user){
    // Delete only this attempt's still-unlinked reservation. No existing user is reassigned.
    await admin.from('staff').delete().eq('id',id).is('auth_user_id',null);
    return reply(409,{error:'Account provisioning failed; no account password was copied or issued. Retry or contact the administrator.'});
  }
  const saved=await admin.from('staff').select('id,name,email,phone,role,status,room_id,assignment').eq('id',id).single();
  if(saved.error)return reply(503,{error:'Account was created; refresh staff before retrying.'});
  return reply(200,{profile:saved.data});
 }catch{return reply(400,{error:'Unable to provision staff account'});}
});
