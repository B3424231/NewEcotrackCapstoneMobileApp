"use strict";
// Actual Expo web build, authenticated fixture session and intercepted reads only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const root=path.resolve('artifacts/session-loading/web'),out=path.resolve('artifacts/session-loading');
const authId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',project='ynopdmfhngooknybyahq';
const profile={id:'session-staff',authUserId:authId,name:'Session Fixture Technician',email:'session@example.invalid',phone:'',role:'HVAC Technician',userType:'staff',assignment:'Fixture Room'};
const user={id:authId,aud:'authenticated',role:'authenticated',email:profile.email,app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-10-01T00:00:00Z'};
const encode=data=>Buffer.from(JSON.stringify(data)).toString('base64url');
const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:authId,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.fixture';
const session={access_token:token,refresh_token:'isolated-fixture',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
const tables={staff:[{id:profile.id,auth_user_id:authId,name:profile.name,email:profile.email,room_id:'room',room_name:'Fixture Room',assignment:'Fixture Room',status:'offline'}],rooms:[{id:'room',name:'Fixture Room',floor_id:'floor'}],floors:[{id:'floor',name:'Fixture Floor',building_id:'building'}],buildings:[{id:'building',name:'Fixture Building'}]};
const labels=['Loading AC devices...','Loading registered AC devices...','Loading assigned maintenance reports...','Loading task reminders...'];
let server,browser;
(async()=>{
 server=http.createServer((req,res)=>{let file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const theme of ['dark','light']){
  const ctx=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,reducedMotion:'reduce'});
  await ctx.addInitScript(({session,project})=>{localStorage.setItem('sb-'+project+'-auth-token',JSON.stringify(session));},{session,project});
  await ctx.routeWebSocket(/.*/,s=>s.close());let delay=650,failed=false,reads=0;
  await ctx.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(req.url().startsWith(site+'/'))return route.continue();
   if(!/^https?:/.test(req.url()))return route.continue();
   const json=(data,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*',...headers},body:JSON.stringify(data)});
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
   if(url.pathname==='/auth/v1/user')return json(user);if(url.pathname==='/auth/v1/token')return json(session);
   if(url.pathname.endsWith('/rpc/ecotrack_my_profile'))return json(profile);
   if(url.pathname.endsWith('/rpc/ecotrack_list_notifications')){reads++;await new Promise(r=>setTimeout(r,delay));return failed?json({message:'Fixture offline'},503):json({items:[],next_cursor:null});}
   if(url.pathname.startsWith('/rest/v1/')&&!url.pathname.includes('/rpc/')){
    assert.equal(req.method(),'GET','No live mutations are permitted');reads++;await new Promise(r=>setTimeout(r,delay));if(failed)return json({message:'Fixture offline'},503);
    let rows=tables[url.pathname.split('/').pop()]||[];for(const [key,value]of url.searchParams){if(value.startsWith('eq.'))rows=rows.filter(row=>String(row[key])===value.slice(3));if(value.startsWith('gt.'))rows=rows.filter(row=>String(row[key])>value.slice(3));}
    return req.headers().accept?.includes('application/vnd.pgrst.object')?json(rows[0]||null):json(rows,200,{'content-range':rows.length?'0-'+(rows.length-1)+'/'+rows.length:'*/0'});
   }
   return json({message:'Blocked by isolated session fixture'},403);
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(site+'/');await page.getByText(labels[0],{exact:true}).waitFor();await page.getByText(labels[0],{exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Device Management',exact:true}).waitFor();
  for(const [tab,label]of [['Device Management',labels[1]],['Maintenance',labels[2]],['Notification',labels[3]]]){
   await (tab==='Device Management'?page.getByRole('button',{name:tab,exact:true}):page.getByText(tab,{exact:true})).click();if(tab!=='Notification') await page.getByText(label,{exact:true}).waitFor();
   await page.getByText(label,{exact:true}).waitFor({state:'hidden'});
  }
  await page.evaluate(labels=>{window.seenSkeletons=[];new MutationObserver(()=>{for(const text of labels)if(document.body.textContent.includes(text))window.seenSkeletons.push(text);}).observe(document.body,{childList:true,subtree:true});},labels);
  delay=1100;
  for(const tab of ['Home','Device Management','Maintenance','Notification']){
   await page.evaluate(()=>{window.seenSkeletons=[];});const before=reads;
   await (tab==='Device Management'?page.getByRole('button',{name:tab,exact:true}):page.getByText(tab,{exact:true})).click();
   await page.waitForTimeout(180);assert.deepEqual(await page.evaluate(()=>window.seenSkeletons),[],tab+' return visit uses data immediately');
   await page.waitForTimeout(1600);assert.deepEqual(await page.evaluate(()=>window.seenSkeletons),[],tab+' background refresh preserves content');
   assert(reads>before,tab+' still refreshes in background');
  }
  failed=true;await page.getByText('Home',{exact:true}).click();await page.getByText(/Unable to refresh AC devices/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.seenSkeletons),[]);await page.screenshot({path:path.join(out,'mobile-return-'+theme+'.png')});
  assert.deepEqual(errors,[]);console.log('PASS '+theme+': four first visits, four return visits, background reads and failed refresh');await ctx.close();
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
