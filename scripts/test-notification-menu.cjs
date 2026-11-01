'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=process.env.ECOTRACK_MOBILE_ROOT||process.cwd(),req=createRequire(path.join(root,'package.json'));
const ts=req('typescript'),React=req('react'),Web=req('react-native-web'),SSR=req('react-dom/server');
const sourceText=fs.readFileSync(path.join(root,'src/app/notification.tsx'),'utf8');
const source=ts.createSourceFile('notification.tsx',sourceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let button,styleObject;
function visit(node){
 if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(source)==='Pressable'&&node.openingElement.attributes.getText(source).includes('styles.headerThreeDotsBtn,'))button=node;
 if(ts.isCallExpression(node)&&node.expression.getText(source)==='StyleSheet.create'&&ts.isObjectLiteralExpression(node.arguments[0]))styleObject=node.arguments[0];
 ts.forEachChild(node,visit);
}visit(source);assert(button&&styleObject);
const keys=['headerThreeDotsBtn','headerThreeDotsBtnLight','headerThreeDotsBtnDark','threeDotsColumn','dotVertical'];
const stylesText='{'+styleObject.properties.filter(p=>keys.includes(p.name?.getText(source))).map(p=>p.getText(source)).join(',')+'}';
const themeText=fs.readFileSync(path.join(root,'src/constants/theme.ts'),'utf8'),moduleTheme={exports:{}};
vm.runInNewContext(ts.transpileModule(themeText.slice(themeText.indexOf('export const Colors'),themeText.indexOf('export type AppColors')),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:moduleTheme.exports});
const Colors=moduleTheme.exports.Colors;
function render(theme){
 let opened=false;
 const context={exports:{},React,View:Web.View,Pressable:Web.Pressable,isDark:theme==='dark',effectiveTheme:theme,UiColors:Colors,colors:Colors[theme],setMenuVisible:value=>opened=value};
 vm.runInNewContext(ts.transpileModule('const styles='+stylesText+';exports.render=()=>('+button.getText(source)+');',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,context);
 return {element:context.exports.render(),opened:()=>opened};
}
const nodes=element=>React.isValidElement(element)?[element,...React.Children.toArray(element.props.children).flatMap(nodes)]:[];
const luminance=hex=>{const c=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
for(const theme of ['light','dark'])test('Tasks and Reminders menu shows three contrasting dots in '+theme+' mode',()=>{
 const {element}=render(theme),background=Web.StyleSheet.flatten(element.props.style({pressed:false})).backgroundColor;
 const dots=nodes(element).filter(node=>{const s=Web.StyleSheet.flatten(node.props.style);return s?.width===4&&s?.height===4;});
 assert.equal(dots.length,3);
 for(const dot of dots)assert(ratio(Web.StyleSheet.flatten(dot.props.style).backgroundColor,background)>=4.5,'dots must contrast against the actual button background');
});
test('the three-dot control still opens the existing menu',()=>{
 const result=render('dark');assert.equal(result.opened(),false);result.element.props.onPress();assert.equal(result.opened(),true);
});
if(process.env.ECOTRACK_MENU_PREVIEW_DIR){
 const out=process.env.ECOTRACK_MENU_PREVIEW_DIR;fs.mkdirSync(out,{recursive:true});
 for(const theme of ['light','dark']){
  const Component=()=>React.createElement(Web.View,{style:{width:320,height:160,padding:24,backgroundColor:Colors[theme].background,alignItems:'flex-end'}},render(theme).element);
  const name='notification-menu-'+theme;Web.AppRegistry.registerComponent(name,()=>Component);const app=Web.AppRegistry.getApplication(name);
  fs.writeFileSync(path.join(out,name+'.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+SSR.renderToStaticMarkup(app.getStyleElement())+'<style>body{margin:0}</style>'+SSR.renderToStaticMarkup(app.element));
 }
}
