'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const raw=fs.readFileSync('src/app/Maintenance.tsx','utf8');
const source=ts.createSourceFile('Maintenance.tsx',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(predicate){let result;function visit(n){if(!result&&predicate(n))result=n;if(!result)ts.forEachChild(n,visit);}visit(source);assert.ok(result);return result;}
function evaluate(code,context){const module={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{module,exports:module.exports,Date,Error,console,...context});return module.exports;}
function handler(name,context){const node=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(source)===name);return evaluate('const '+node.getText(source)+';exports.run='+name,context).run;}
const complete=item=>item.status==='Completed'&&(!item.linkedRepairId||item.repaired===true);
function fixture(id='MR-review'){
  const report={id,status:'In Progress',updatedAt:'2026-10-18T01:00:00Z',type:id.startsWith('REP-')?'Corrective Repair':'Control Inspection',items:[{id:'1',title:'First',status:'Completed'},{id:'2',title:'Last',status:'Not Started'}]};
  const state={reports:[report],screen:'CHECKLIST',calls:[],submissions:0,alerts:[],busy:[]};
  const context={selectedReportId:id,editingReportId:id,reports:state.reports,isSubmitting:false,userName:'Fixture Worker',isCurrentRepair:id.startsWith('REP-'),
    expandedItem:report.items[1],itemStatus:'Completed',itemRemarks:'Checked',itemProblemDesc:'',itemPhotoUris:[],itemEditorSnapshot:{current:report},
    isChecklistItemComplete:complete,formatMaintenanceTimestamp:()=> 'Fixture time',mutationContext:r=>({expectedUpdated:r.updatedAt,operationId:'fixture-operation'}),
    setReports:fn=>{state.reports=fn(state.reports);},setIsSubmitting:value=>state.busy.push(value),
    rememberSavedVersion:(id,result)=>{state.reports=state.reports.map(r=>r.id===id?{...r,updatedAt:result.updated,status:result.status}:r);},
    updateLiveMaintenanceReport:async(id,params)=>{state.calls.push({id,params});return {success:true,updated:'2026-10-18T01:01:00Z',status:params.saveMode==='item'?'In Progress':params.status};},
    submitRepairAndSyncParent:async()=>{state.submissions++;throw Error('Item edits must not submit repairs');},
    alert:message=>state.alerts.push(message),loadReports:async()=>{},setDropdownVisible(){},handleOpenItemEditor(){},
    setItemModalVisible(){},setExpandedItem(){},setEditingReportId(){},setItemPhotoUris(){},setItemRemarks(){},setItemProblemDesc(){},
    setSubmittedRepairInfo(){},setRepairSuccessModalVisible(){},setSelectedReportId(){},setCurrentScreen:value=>{state.screen=value;},
    setConfirmModalVisible(){},validateLiveMaintenanceItems:()=>null,
  };
  return {state,context,report};
}
for(const name of ['handleQuickStatusChange','handleToggleTaskCheck','handleSaveItemUpdate'])for(const id of ['MR-review','REP-review']){
  test(`${name}: last item stays editable and quiet for ${id.startsWith('REP-')?'repair':'maintenance'}`,async()=>{
    const h=fixture(id),run=handler(name,h.context);
    if(name==='handleQuickStatusChange')run('2','Completed');else if(name==='handleToggleTaskCheck')run('2',id);else await run();
    await new Promise(setImmediate);
    assert.equal(h.state.calls.length,1);assert.equal(h.state.calls[0].params.saveMode,'item');
    assert.equal(h.state.calls[0].params.status,'In Progress');assert.equal(h.state.reports[0].status,'In Progress');
    assert.ok(h.state.reports[0].items.every(complete));assert.equal(h.state.submissions,0);assert.equal(h.state.screen,'CHECKLIST');
    assert.deepEqual(h.state.busy,[true,false]);
  });
}
test('only the confirmed final button action submits a completed checklist',async()=>{
  const h=fixture();const completed={...h.report,items:h.report.items.map(item=>({...item,status:'Completed'}))};h.state.reports=[completed];
  h.context.confirmationSnapshot={current:completed};
  assert.equal(h.state.calls.length,0);await handler('handleConfirmSubmit',h.context)();
  assert.equal(h.state.calls.length,1);assert.notEqual(h.state.calls[0].params.saveMode,'item');
  assert.equal(h.state.calls[0].params.status,'For Verification');assert.equal(h.state.screen,'SUCCESS');
  assert.equal(h.state.reports[0].status,'For Verification');
});
test('failed final submission keeps the checklist open and does not show submission success',async()=>{
  const h=fixture();h.context.confirmationSnapshot={current:{...h.report,items:h.report.items.map(item=>({...item,status:'Completed'}))}};
  h.context.updateLiveMaintenanceReport=async()=>({success:false,error:'Connection unavailable'});
  await handler('handleConfirmSubmit',h.context)();
  assert.equal(h.state.screen,'CHECKLIST');assert.equal(h.state.reports[0].status,'In Progress');assert.deepEqual(h.state.busy,[true,false]);
  assert.deepEqual(h.state.alerts,['Connection unavailable']);
});
test('100% progress retains the final Submit button until the report is actually submitted',()=>{
  const node=find(n=>ts.isJsxElement(n)&&n.openingElement.attributes.getText(source).includes('styles.submitSection'));
  const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
  const tree=evaluate('exports.tree=('+node.getText(source)+');',{React,View:'View',ThemedText:'Text',Pressable:'Button',LinearGradient:'Gradient',AppIcon:'Icon',
    styles:new Proxy({},{get:()=>({})}),UiColors:{dark:{onPrimary:'#fff'}},effectiveTheme:'dark',isDark:true,colors:{primaryFill:'#059669'},
    activeReport:{status:'In Progress'},progressPercentage:100,isSubmitting:false,confirmationSnapshot:{current:null},setConfirmModalVisible(){},
  }).tree;
  const text=n=>Array.isArray(n)?n.map(text).join(' '):n&&typeof n==='object'?text(n.props.children):n==null?'':String(n);
  assert.match(text(tree),/Submit for Verification/);assert.doesNotMatch(text(tree),/Submitted for Verification/);
});
