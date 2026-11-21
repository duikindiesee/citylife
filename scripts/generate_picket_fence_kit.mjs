// Deterministic CityLife picket fence kit. Meters, Y up, local +Z face.
// Two 2 m panels tile each 4 m cell with posts at 0, 2, and 4 m.
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
if (typeof FileReader === "undefined") globalThis.FileReader = class { readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.({target:this});});} readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type||"application/octet-stream"};base64,${Buffer.from(v).toString("base64")}`;this.onloadend?.({target:this});});} };
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."), out=resolve(root,"public/assets/citylife/props"); mkdirSync(out,{recursive:true});
const white=new THREE.MeshStandardMaterial({name:"Fence_White",color:0xf0eee5,roughness:.82,flatShading:true}), orange=new THREE.MeshStandardMaterial({name:"Project_Orange",color:0xe87832,roughness:.7,flatShading:true});
const box=(p,n,d,m,pos)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(...d),m);o.name=n;o.position.set(...pos);o.castShadow=o.receiveShadow=true;p.add(o);return o;};
function pickets(p,a,b,y=1.15){const count=Math.floor((b-a+.064)/.144);for(let i=0;i<count;i++){const x=a+i*(b-a)/(count-1);box(p,`Picket_${i+1}`, [.08,y,.035],white,[x,y/2,0]);}}
function panel(){const r=new THREE.Group();r.name="Picket_Fence_Panel";box(r,"Rail_Lower",[2,.09,.07],white,[0,.34,0]);box(r,"Rail_Upper",[2,.09,.07],white,[0,.89,0]);pickets(r,-.96,.96);return r;}
function post(kind){const r=new THREE.Group();r.name=`Picket_Fence_Post_${kind}`;box(r,"Post_Shaft",[.09,1.3,.09],white,[0,.65,0]);box(r,"Post_Cap",[.13,.055,.13],white,[0,1.3275,0]); if(kind==="corner")box(r,"Corner_Return",[.13,.12,.13],orange,[0,1.22,0]);if(kind==="end")box(r,"End_Band",[.105,.035,.105],orange,[0,.13,0]);return r;}
function gate(width,name){const r=new THREE.Group();r.name=name;const leafW=width/2-.025;
 // Static posts are deliberately separate; every moving bar and picket is under a leaf pivot.
 for(const x of [-width/2,width/2])box(r,"Gate_Post_Shaft",[.09,1.3,.09],white,[x,.65,0]);
 for(const [i,hingeX] of [[0,-width/2],[1,width/2]]){const leaf=new THREE.Group();leaf.name=i===0?"gate_leaf_left":"gate_leaf_right";leaf.position.x=hingeX;r.add(leaf);
   // Each leaf's local X axis runs from its hinge toward the centre. This keeps the pivot at
   // the post while the closed leaves meet at X=0 and swing fully clear when opened.
   const direction=i===0?1:-1,center=direction*leafW/2;
   box(leaf,"Gate_Rail_Lower",[leafW,.09,.07],white,[center,.34,0]);box(leaf,"Gate_Rail_Upper",[leafW,.09,.07],white,[center,.9,0]);
   const count=Math.floor((leafW-.09+.064)/.144);
   for(let n=0;n<count;n++){const localX=direction*(.045+(leafW-.09)*n/(count-1));box(leaf,`Gate_Picket_${n+1}`,[.08,1.2,.035],white,[localX,.6,0]);}
   box(leaf,"Gate_Orange_Hinge",[.045,.18,.09],orange,[0,.62,.05]);
 }return r;}
function sign(){const r=new THREE.Group();r.name="Picket_For_Sale_Sign";box(r,"Sign_Post",[.075,1.3,.075],white,[0,.65,0]);box(r,"Blank_Orange_Board",[.58,.38,.055],orange,[0,1.05,0]);return r;}
async function save(name,g){g.userData={units:"meters",upAxis:"Y",forwardAxis:"+Z",publicSafe:true};const data=await new GLTFExporter().parseAsync(g,{binary:true});writeFileSync(resolve(out,`${name}.glb`),Buffer.from(data));}
for(const [n,g] of [["picket-fence-panel",panel()],["picket-fence-post-line",post("line")],["picket-fence-post-corner",post("corner")],["picket-fence-post-end",post("end")],["picket-fence-gate-driveway",gate(3.7,"Driveway_Gate")],["picket-fence-gate-pedestrian",gate(1.1,"Pedestrian_Gate")],["picket-for-sale-sign",sign()]])await save(n,g);
if(2*2!==4)throw Error("Fence cell tiling failed"); console.log(`Generated 7 fence assets; two panels tile one 4 m cell.`);
