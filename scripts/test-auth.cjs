const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const m={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/auth-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports});
const profile={id:'staff1',authUserId:'auth1',email:'worker@example.test',name:'Worker',phone:'09123456789',userType:'staff'};
function setup(overrides={}){
 const calls=[],cache=new Map([['ecotrack_session_user',JSON.stringify({...profile,userType:'admin'})],['ecotrack_staff_pwd_staff1','old-plaintext']]);
 const auth={
   getUser:async()=>({data:{user:{id:'auth1',email:profile.email}},error:null}),
   setSession:async args=>{calls.push(['session',args]);return {error:null};},
   signOut:async()=>{calls.push(['signout']);return {error:null};},
   signUp:async args=>{calls.push(['signup',args]);return {data:{session:null},error:null};},
   resetPasswordForEmail:async email=>{calls.push(['recovery',email]);return {error:null};},
   verifyOtp:async args=>{calls.push(['otp',args]);return {data:{session:{access_token:'token'},user:{id:'auth1'}},error:null};},
   updateUser:async args=>{calls.push(['update',args]);return {error:null};},
   signInWithPassword:async args=>{calls.push(['reauth',args]);return {error:null};},
   ...overrides.auth,
 };
 const client={auth,rpc:async name=>{calls.push(['rpc',name]);return {data:profile,error:null};},functions:{invoke:async(name,args)=>{calls.push(['login',args]);return {data:{access_token:'access',refresh_token:'refresh'},error:null};}},...overrides.client};
 const store={setItem:async(k,v)=>cache.set(k,v),removeItem:async k=>cache.delete(k),getAllKeys:async()=>[...cache.keys()],multiRemove:async ks=>ks.forEach(k=>cache.delete(k))};
 return {service:m.exports.createAuthService(client,store),calls,cache};
}
test('cached admin claims are replaced with the verified server profile',async()=>{
 const h=setup();assert.equal((await h.service.getSavedSession()).userType,'staff');
 assert.equal(h.cache.has('ecotrack_staff_pwd_staff1'),false);
});
test('a forged cache cannot restore a missing Auth session',async()=>{
 const h=setup({auth:{getUser:async()=>({data:{user:null},error:null})}});
 assert.equal(await h.service.getSavedSession(),null);assert.equal(h.cache.has('ecotrack_session_user'),false);
 assert.equal(h.calls.length,0);
});
test('server profile must match the verified Auth subject',async()=>{
 const h=setup({client:{rpc:async()=>({data:{...profile,authUserId:'other'},error:null})}});
 assert.equal((await h.service.authenticateUser('Worker','password')).success,false);
 assert.ok(h.calls.some(c=>c[0]==='signout'));
});
test('login preserves password whitespace and removes legacy password caches',async()=>{
 const h=setup();assert.equal((await h.service.authenticateUser(' Worker ',' password ')).success,true);
 assert.equal(h.calls.find(c=>c[0]==='login')[1].body.password,' password ');
 assert.equal(h.cache.has('ecotrack_staff_pwd_staff1'),false);
});
test('registration uses Auth without role or profile-link authority and requires confirmation',async()=>{
 const h=setup();const r=await h.service.registerStaffMember('Worker','09123456789','WORKER@example.test','password');
 assert.equal(r.success,false);assert.match(r.error,/confirm/);
 const data=h.calls.find(c=>c[0]==='signup')[1];assert.equal(data.email,profile.email);
 assert.deepEqual(Object.keys(data.options.data).sort(),['full_name','phone']);
});
test('public attributes, arbitrary IDs and unverified sessions cannot reset a password',async()=>{
 const h=setup();assert.equal((await h.service.verifyUserForPasswordReset('Worker','09123456789')).success,false);
 assert.equal((await h.service.resetUserPassword('staff1','staff','newpassword')).success,false);
 assert.ok(!h.calls.some(c=>c[0]==='update'));
});
test('recovery code grants one password change for exactly the verified subject',async()=>{
 const h=setup();await h.service.requestPasswordRecovery(profile.email);
 assert.equal((await h.service.verifyUserForPasswordReset(profile.email,'12345678')).success,true);
 assert.equal(h.calls.find(c=>c[0]==='otp')[1].type,'recovery');
 assert.equal((await h.service.resetUserPassword('other','staff','newpassword')).success,false);
 assert.equal((await h.service.resetUserPassword('staff1','staff','short')).success,false);
 assert.equal((await h.service.resetUserPassword('staff1','staff','newpassword')).success,true);
 assert.equal((await h.service.resetUserPassword('staff1','staff','anotherpassword')).success,false);
 assert.equal(h.calls.filter(c=>c[0]==='update').length,1);
});
test('invalid OTP and incorrect current password never update credentials',async()=>{
 const h=setup({auth:{verifyOtp:async()=>({data:{session:null,user:null},error:{message:'invalid'}}),signInWithPassword:async()=>({error:{message:'bad password'}})}});
 assert.equal((await h.service.verifyUserForPasswordReset(profile.email,'123456')).success,false);
 assert.equal((await h.service.changeUserPassword('staff1','staff','wrong','newpassword')).success,false);
 assert.ok(!h.calls.some(c=>c[0]==='update'));
});
test('password change ignores forged email and uses the verified identity to reauthenticate',async()=>{
 const h=setup();assert.equal((await h.service.changeUserPassword('staff1','staff',' old password ','newpassword','victim@example.test')).success,true);
 const args=h.calls.find(c=>c[0]==='reauth')[1];assert.equal(args.email,profile.email);assert.equal(args.password,' old password ');
});

test('new staff names and phones authenticate through the server without a client directory', async () => {
 for (const identifier of ['New Staff Member', '+63 900 000 0000']) {
  const h=setup();
  assert.equal((await h.service.authenticateUser(identifier,'password')).success,true);
  assert.equal(h.calls.find(c=>c[0]==='login')[1].body.identifier,identifier);
  assert.ok(!h.calls.some(c=>c[0]==='reauth'));
 }
});

test('unavailable name/phone login never guesses an email or uses a cached profile to sign in', async () => {
 for (const identifier of ['Worker',profile.phone]) {
  const h=setup({client:{functions:{invoke:async()=>({data:null,error:{message:'unavailable'}})}}});
  const result=await h.service.authenticateUser(identifier,'password');
  assert.equal(result.success,false);
  assert.match(result.error,/account email/);
  assert.ok(!h.calls.some(c=>c[0]==='reauth'||c[0]==='session'||c[0]==='rpc'));
 }
});

test('direct email fallback still works when account-login is unavailable', async () => {
 const h=setup({client:{functions:{invoke:async()=>{throw Error('offline');}}},auth:{
  signInWithPassword:async args=>{
   assert.equal(args.email,profile.email);assert.equal(args.password,' password ');
   return {data:{session:{access_token:'access'}},error:null};
  },
 }});
 assert.equal((await h.service.authenticateUser(' WORKER@example.test ',' password ')).success,true);
});


test('an archived verified account restores only its own reason when the active profile RPC rejects it',async()=>{
 const row={id:'staff1',auth_user_id:'auth1',name:'Worker',email:profile.email,is_archived:true,status:'Archived',archive_reason:'Contract ended',archive_notes:'Contact the department',archived_at:'2026-10-14T00:00:00Z'};
 const filters=[];
 const query={select(){return this;},eq(key,value){filters.push([key,value]);return this;},async maybeSingle(){return {data:row,error:null};}};
 const h=setup({client:{rpc:async()=>({data:null,error:{code:'42501'}}),from:table=>{assert.equal(table,'staff');return query;}}});
 const result=await h.service.getSavedSession();
 assert.equal(result.isArchived,true);assert.equal(result.archiveReason,row.archive_reason);assert.equal(result.archiveNotes,row.archive_notes);
 assert.deepEqual(filters,[['auth_user_id','auth1']]);
 const login=await h.service.authenticateUser(profile.email,'valid-password');
 assert.equal(login.success,false);assert.equal(login.isArchived,true);assert.equal(login.archiveReason,row.archive_reason);
});

test('archive notice fallback cannot accept another account or an active profile after access revocation',async()=>{
 for(const row of [{id:'staff1',auth_user_id:'other',is_archived:true},{id:'staff1',auth_user_id:'auth1',is_archived:false,status:'disabled'}]){
  const query={select(){return this;},eq(){return this;},async maybeSingle(){return {data:row,error:null};}};
  const h=setup({client:{rpc:async()=>({data:null,error:{code:'42501'}}),from:()=>query}});
  assert.equal(await h.service.getSavedSession(),null);
 }
});

test('foreground access rechecks distinguish temporary outages from verified session revocation',async()=>{
 for(const failure of ['identity','profile','archive-notice']){
  const unavailable={message:'Network request failed',status:503,code:'NETWORK_UNAVAILABLE'};
  const overrides=failure==='identity'?{auth:{getUser:async()=>({data:{user:null},error:unavailable})}}:
   {client:{rpc:async()=>({data:null,error:failure==='profile'?unavailable:{code:'42501'}}),
    from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:null,error:unavailable};}})}};
  const h=setup(overrides),cached=h.cache.get('ecotrack_session_user');
  await assert.rejects(()=>h.service.getSavedSession({throwOnUnavailable:true}),error=>error.message==='Network request failed');
  assert.equal(h.cache.get('ecotrack_session_user'),cached);
 }
 const revoked=setup({auth:{getUser:async()=>({data:{user:null},error:{status:401,code:'session_not_found'}})}});
 assert.equal(await revoked.service.getSavedSession({throwOnUnavailable:true}),null);
 assert.equal(revoked.cache.has('ecotrack_session_user'),false);
});
