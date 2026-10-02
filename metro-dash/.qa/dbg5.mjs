import * as THREE from "three";
import { RunController } from "../client/js/src/game/run.js";
import { VfxSystem } from "../client/js/src/game/vfx.js";
import { materialLibrary } from "../client/js/src/core/assets.js";
import { CONFIG, QUALITY_PRESETS } from "../client/js/src/core/config.js";
const FIXED = CONFIG.FIXED_DT;
class GradientShim { addColorStop() {} }
class Context2DShim {
  constructor(c){this.canvas=c;this.fillStyle="#000";}
  fillRect(){} strokeRect(){} clearRect(){} fillText(){} save(){} restore(){}
  translate(){} rotate(){} scale(){} beginPath(){} closePath(){} arc(){}
  fill(){} stroke(){} moveTo(){} lineTo(){} drawImage(){}
  createLinearGradient(){return new GradientShim();} createRadialGradient(){return new GradientShim();}
  putImageData(){} getImageData(x,y,w,h){return{data:new Uint8ClampedArray(w*h*4),width:w,height:h};}
}
class CanvasShim { constructor(){this.width=300;this.height=150;} set width(v){this._w=v;} get width(){return this._w;} set height(v){this._h=v;} get height(){return this._h;} getContext(){return new Context2DShim(this);} }
globalThis.document = { createElement(t){ return t==="canvas"?new CanvasShim():{}; } };
globalThis.ImageData = class { constructor(d,w,h){this.data=d;this.width=w;this.height=h;} };
globalThis.window = { innerWidth:800, innerHeight:500, devicePixelRatio:1, addEventListener(){}, removeEventListener(){} };
globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=String(v);} };
const preset = QUALITY_PRESETS.high;
const scene = new THREE.Scene();
const run = new RunController({ scene, lib: materialLibrary, seed: 7, preset, onGameOver(){}, onDeath(){} });
run.godMode = true;
const vfx = new VfxSystem(scene, 7, run.events);
const info = { x:0,y:0,z:0,speed:16,phase:"running",coinNear:null };
run.start();
for (let i=0;i<600;i++){ run.fixedUpdate(FIXED); run.updateRender(1,FIXED); info.x=run.curr.x;info.y=run.curr.y;info.z=run.curr.z;info.speed=run.speed;info.phase=run.phase;info.coinNear=run.coinNear; vfx.advanceFixed(FIXED, info); }
const snap = (p) => ({ pos: Array.from(p.pos).join(","), col: Array.from(p.col).join(","), size: Array.from(p.size).join(","), life: Array.from(p.life).join(",") });
const s0 = snap(vfx.sparks), d0 = snap(vfx.dust);
const sl0 = Array.from(vfx._speedLines.geometry.attributes.position.array).join(",");
const op0 = vfx._speedLineMat.opacity;
const rings0 = vfx._rings.map(r=>r.life+"/"+r.mesh.material.opacity).join(" ");
vfx.advanceFixed(0, info);
const s1 = snap(vfx.sparks), d1 = snap(vfx.dust);
const b0 = s0.size.split(","), b1 = s1.size.split(",");
for (let i=0;i<b0.length;i++) if (b0[i]!==b1[i]) { console.log("spark size diff idx",i,b0[i],"->",b1[i],"life",s0.life.split(",")[i],"grav?", i); }
const sl1 = Array.from(vfx._speedLines.geometry.attributes.position.array).join(",");
const op1 = vfx._speedLineMat.opacity;
const rings1 = vfx._rings.map(r=>r.life+"/"+r.mesh.material.opacity).join(" ");
console.log("sparks same:", s0.pos===s1.pos, s0.col===s1.col, s0.size===s1.size, s0.life===s1.life);
const z0 = s0.size.split(","), z1 = s1.size.split(",");
for (let i=0;i<b0.length;i++) if (b0[i]!==b1[i]) { console.log("spark size diff idx",i,b0[i],"->",b1[i],"life",s0.life.split(",")[i]); }

console.log("dust same:", d0.pos===d1.pos, d0.col===d1.col, d0.size===d1.size, d0.life===d1.life);
console.log("speedlines same:", sl0===sl1, "opacity:", op0===op1, op0, op1);
console.log("rings same:", rings0===rings1, rings0, "|", rings1);
// find first diff in dust size
const a0 = d0.size.split(","), a1 = d1.size.split(",");
for (let i=0;i<a0.length;i++) if (a0[i]!==a1[i]) { console.log("dust size diff at", i, a0[i], "->", a1[i], "life", d0.life.split(",")[i]); break; }
const c0 = d0.col.split(","), c1 = d1.col.split(",");
for (let i=0;i<c0.length;i++) if (c0[i]!==c1[i]) { console.log("dust col diff at", i, c0[i], "->", c1[i]); break; }
const p0 = Array.from(vfx.sparks.size), p1 = Array.from(vfx.sparks.size);
// re-simulate to get before-state
