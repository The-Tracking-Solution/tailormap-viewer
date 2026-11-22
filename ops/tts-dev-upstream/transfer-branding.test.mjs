import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transfer} from './transfer-branding.mjs';
test('retains upstream CSS and emits only the user color override',()=>{const r=transfer(':root{--color:purple;--new:1}',':root{--color:orange;--new:1}',':root{--color:purple;--new:2;--upstream:3}');assert.match(r.css,/--color:orange/);assert.doesNotMatch(r.css,/--new|--upstream/);});
test('unchanged branding emits nothing',()=>assert.equal(transfer('a{color:red}','a{color:red}','a{color:blue}').css,''));
test('keeps media context and newly added custom selectors',()=>{const r=transfer('@media screen{a{color:red}}','@media screen{a{color:orange}}.brand{display:block}','@media screen{a{color:blue}}');assert.match(r.css,/@media screen/);assert.equal(r.report.length,2);});
test('refuses removed declarations and upstream selector mismatches',()=>{assert.throws(()=>transfer('a{color:red}','a{}','a{color:red}'),/Removed CSS declaration/);assert.throws(()=>transfer('a{color:red}','a{color:orange}','b{color:red}'),/removed a customized selector/);});
test('refuses ambiguous customized duplicates',()=>assert.throws(()=>transfer('a{color:red}a{color:blue}','a{color:orange}a{color:blue}','a{color:red}a{color:blue}'),/Ambiguous/));
