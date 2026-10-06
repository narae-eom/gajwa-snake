import assert from 'node:assert/strict';
import {makeState,advance,DIRECTIONS,allowed,routeForFrame,pointAt,newFood,rankEntries} from './engine.mjs';
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('one apple increases score and body',()=>{const s={...makeState(),food:{x:4,y:7}};const n=advance(s,DIRECTIONS.right,()=>0);assert.equal(n.score,1);assert.equal(n.snake.length,5);assert.ok(!n.snake.some(p=>p.x===n.food.x&&p.y===n.food.y));});
test('ordinary move preserves length',()=>assert.equal(advance(makeState()).snake.length,4));
test('reverse input ignored',()=>{assert.equal(allowed(DIRECTIONS.right,DIRECTIONS.left),false);assert.equal(advance(makeState(),DIRECTIONS.left).snake[0].x,4);});
test('wall collision',()=>assert.equal(advance({...makeState(),snake:[{x:16,y:7},{x:15,y:7}]}).mode,'collision'));
test('tail vacates safely, internal body collides',()=>{const s={...makeState(),snake:[{x:1,y:1},{x:1,y:2},{x:2,y:2},{x:2,y:1}],direction:DIRECTIONS.up};assert.equal(advance(s,DIRECTIONS.right).mode,'running');assert.equal(advance({...s,snake:[...s.snake,{x:3,y:1}]},DIRECTIONS.right).mode,'collision');});
test('food returns null when full',()=>{const a=[];for(let y=0;y<15;y++)for(let x=0;x<17;x++)a.push({x,y});assert.equal(newFood(a),null);});
test('head interpolates through fractional positions',()=>{const s=makeState(),n=advance(s);assert.equal(routeForFrame(s,n,.5).head.x,3.5);assert.equal(routeForFrame(s,n,1).head.x,4);});
test('body follows orthogonal corner, not a diagonal',()=>{const s={...makeState(),direction:DIRECTIONS.right},n=advance(s,DIRECTIONS.up);const r=routeForFrame(s,n,.5);const p=pointAt(r.points,.75);assert.equal(p.y,7);assert.equal(p.x,2.75);});
test('growth is gradual along the route',()=>{const s={...makeState(),food:{x:4,y:7}},n=advance(s,undefined,()=>0);assert.ok(Math.abs(routeForFrame(s,n,1).length-routeForFrame(s,n,0).length-1)<1e-9);});
const records=[{studentId:'10101',name:'가상A',grade:1,classNo:1,score:10,savedAt:'2026-10-06T01:00:00Z'},{studentId:'10101',name:'가상A',grade:1,classNo:1,score:5,savedAt:'2026-10-06T02:00:00Z'},{studentId:'10102',name:'가상B',grade:1,classNo:1,score:10,savedAt:'2026-10-06T03:00:00Z'},{studentId:'20201',name:'가상C',grade:2,classNo:2,score:9,savedAt:'2026-10-06T04:00:00Z'}];
test('one highest entry per student',()=>assert.equal(rankEntries(records).length,3));
test('competition ranks tied scores',()=>assert.deepEqual(rankEntries(records).map(r=>r.rank),[1,1,3]));
test('class filter applied before ranking',()=>assert.deepEqual(rankEntries(records,{grade:2,classNo:2}).map(r=>r.rank),[1]));
test('ties at rank ten are not arbitrarily cut off',()=>{const a=Array.from({length:13},(_,i)=>({studentId:String(i),grade:1,classNo:1,score:i<9?100-i:1,savedAt:'2026-10-06'}));const r=rankEntries(a);assert.equal(r.length,13);assert.ok(r.slice(9).every(x=>x.rank===10));});
test('same short ID in different classes stays separate',()=>{assert.equal(rankEntries([...records,{studentId:'10101',name:'다른가상',grade:2,classNo:3,score:8,savedAt:'2026-10-06'}]).length,4);});
console.log(passed+' tests passed.');
