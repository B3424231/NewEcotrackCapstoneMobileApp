const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve('../EcoTrackDesktopDashboardNew-main-control');
const html=fs.readFileSync(process.env.ECOTRACK_DASHBOARD_SOURCE || path.join(root,'public/dashboard.html'),'utf8');
function fixture(aircons){
 const elements=new Map();const context=vm.createContext({window:{},Date,AirconProfileManager:{getAll:()=>aircons},NodeService:{getNodes:()=>[],isNodeOnline:id=>id==='verified-node'},CentralLogService:{getLogs:()=>[]},
  document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id);}}});
 vm.runInContext(fs.readFileSync(path.join(root,'public/js/aircon-state.js'),'utf8'),context);
 const helper=html.slice(html.indexOf('      function getDashboardPowerState('),html.indexOf('      function renderDashboard()'));
 const render=html.slice(html.indexOf('      function renderDashboard()'),html.indexOf('        // Render Aircon Cards'))+'\n}';
 vm.runInContext(helper+render,context);context.renderDashboard();return {context,text:id=>elements.get(id)?.textContent};
}
test('connected controllers and default selected power never count as physically ON',()=>{
 const profiles=Array.from({length:11},()=>({node_id:'verified-node',status:'online',state:{power:true},control_snapshot:{desired_state:{power:'on',mode:'cool'},command_status:'queued'}}));
 const before=JSON.stringify(profiles),f=fixture(profiles);assert.equal(f.text('kpiTotalUnits'),11);assert.equal(f.text('kpiOnlineUnits'),11);
 assert.equal(f.text('kpiActivePower'),'—');assert.equal(f.text('kpiStandby'),'—');assert.equal(f.text('kpiActivePowerCaption'),'11 awaiting feedback');
 assert.equal(f.context.getDashboardPowerState(profiles[0]).label,'Power unconfirmed');assert.equal(JSON.stringify(profiles),before,'Summary rendering must not alter control settings or commands');
});
test('dashboard counts explicit reported on/off and rejects stale or disconnected feedback',()=>{
 const profiles=[{node_id:'verified-node',status:'online',control_snapshot:{reported_state:{power:'on',mode:'cool'}}},{node_id:'verified-node',status:'online',control_snapshot:{reported_state:{power:'off'}}},
  {status:'offline',control_snapshot:{reported_state:{power:true}}},{node_id:'verified-node',status:'online',control_snapshot:{reported_state:{power:true},reported_at:'2026-10-03T00:00:00Z',desired_state:{power:'off'},commanded_at:'2026-10-04T00:00:00Z'}}];
 const f=fixture(profiles);assert.equal(f.text('kpiActivePower'),1);assert.equal(f.text('kpiStandby'),1);assert.equal(f.text('kpiActivePowerCaption'),'2 awaiting feedback');
 assert.equal(f.context.getDashboardPowerState(profiles[0]).label,'Active');assert.equal(f.context.getDashboardPowerState(profiles[1]).label,'Standby');
});
test('empty and confirmed-all-off fleets have genuine zero counts',()=>{
 for(const profiles of [[],[{node_id:'verified-node',status:'online',control_snapshot:{reported_state:{power:false}}}]]){const f=fixture(profiles);assert.equal(f.text('kpiActivePower'),0);assert.equal(f.text('kpiStandby'),profiles.length);}
});
test('changed dashboard and analytics markup contain valid JavaScript and unique new label IDs',()=>{
 for(const page of [html,fs.readFileSync(process.env.ECOTRACK_LOGS_HTML || path.join(root,'public/logs.html'),'utf8')]){
  for(const match of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1]);
  for(const id of ['kpiRuntimeLabel','kpiActiveLabel','kpiIdleLabel','kpiActivePowerCaption','kpiStandbyCaption'])assert.ok((page.match(new RegExp('id="'+id+'"','g'))||[]).length<=1);
 }
});

test('a received remote ON command is not physical power feedback',()=>{
 const f=fixture([{node_id:'verified-node',status:'online',control_snapshot:{observed_remote_state:{power:true},observed_remote_at:new Date().toISOString()}}]);
 assert.equal(f.text('kpiActivePower'),'—');assert.equal(f.text('kpiActivePowerCaption'),'1 awaiting feedback');
});
