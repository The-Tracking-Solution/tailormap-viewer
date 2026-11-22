import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve(process.env.TTS_VIEWER_PACKAGE || '/work/package.json'));
const postcss=require('postcss');
const contexts=node=>{const result=[];for(let p=node.parent;p&&p.type!=='root';p=p.parent){if(p.type!=='atrule')throw Error('Unsupported nested branding rule');result.unshift([p.name,p.params]);}return result;};
const key=node=>JSON.stringify([contexts(node),node.selector]);
const declarations=node=>{const map=new Map();for(const c of node.nodes||[]){if(c.type==='comment')continue;if(c.type!=='decl')throw Error('Unsupported nested branding declaration');const list=map.get(c.prop)||[];list.push(c);map.set(c.prop,list);}return map;};
const values=decls=>JSON.stringify(decls.map(d=>[d.value,!!d.important]));
function groups(root){const map=new Map();root.walkRules(r=>{const k=key(r),list=map.get(k)||[];list.push(r);map.set(k,list);});return map;}
export function transfer(baselineCss,brandedCss,currentCss){
 const baseline=postcss.parse(baselineCss),branded=postcss.parse(brandedCss),current=postcss.parse(currentCss);
 const old=groups(baseline),custom=groups(branded),fresh=groups(current),output=postcss.root(),report=[];
 // Direct at-rule declarations (fonts etc.) cannot safely be replaced by a partial override.
 const atDecls=root=>{const result=[];root.walkAtRules(a=>{if(a.nodes?.some(n=>n.type==='decl'))result.push([a.name,a.params,a.nodes.filter(n=>n.type==='decl').map(d=>[d.prop,d.value,!!d.important])]);});return JSON.stringify(result);};
 if(atDecls(baseline)!==atDecls(branded))throw Error('Changed font/at-rule branding requires review');
 for(const [k,oldRules] of old){if(!custom.has(k))throw Error('Removed baseline CSS rule requires review');if(custom.get(k).length!==oldRules.length)throw Error('Reordered/duplicated CSS rules require review');}
 for(const [k,rules] of custom){
  const originals=old.get(k);
  for(let index=0;index<rules.length;index++){
   const rule=rules[index],decls=declarations(rule),original=originals?.[index],changed=[];
   if(original){
    const before=declarations(original);
    for(const prop of before.keys())if(!decls.has(prop))throw Error('Removed CSS declaration requires review: '+prop);
    for(const [prop,list] of decls)if(!before.has(prop)||values(list)!==values(before.get(prop)))changed.push(...list.map(d=>d.clone()));
    if(changed.length&&!fresh.has(k))throw Error('Upstream removed a customized selector: '+rule.selector);
   }else{changed.push(...[...decls.values()].flat().map(d=>d.clone()));}
   if(!changed.length)continue;
   if(originals?.length>1)throw Error('Ambiguous duplicated customized selector: '+rule.selector);
   if(contexts(rule).some(([name])=>/keyframes$/i.test(name)))throw Error('Customized animation requires review');
   let target=output;for(const [name,params] of contexts(rule)){const at=postcss.atRule({name,params});target.append(at);target=at;}
   const override=postcss.rule({selector:rule.selector});override.append(changed);target.append(override);
   report.push({selector:rule.selector,context:contexts(rule),properties:changed.map(d=>d.prop),added:!original});
  }
 }
 return {css:output.toString(),report};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [baseline,branded,current,out,report]=process.argv.slice(2);
 if(process.argv.slice(2).length!==5||!report)throw Error('Expected baseline, branded, current, output and report paths');
 const result=transfer(readFileSync(baseline,'utf8'),readFileSync(branded,'utf8'),readFileSync(current,'utf8'));
 writeFileSync(out,result.css);writeFileSync(report,JSON.stringify(result.report,null,2)+'\n');
 console.log('Branding overrides:',result.report.length,'rules');
}
