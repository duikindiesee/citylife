// Deterministic single-car starter garage, meters, Y-up, street-facing +Z.
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
if (typeof FileReader === "undefined") globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.({target:this});});}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type||"application/octet-stream"};base64,${Buffer.from(v).toString("base64")}`;this.onloadend?.({target:this});});}};
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),out=resolve(root,"public/assets/citylife/props");mkdirSync(out,{recursive:true});
const wall=new THREE.MeshStandardMaterial({name:"Warm_Stucco",color:0xc8bba3,roughness:.9,flatShading:true}), roofMat=new THREE.MeshStandardMaterial({name:"Roof_Charcoal",color:0x464b49,roughness:.8,flatShading:true}), orange=new THREE.MeshStandardMaterial({name:"Project_Orange",color:0xe87832,roughness:.7,flatShading:true}), concrete=new THREE.MeshStandardMaterial({name:"Concrete",color:0xaaa89f,roughness:.95,flatShading:true}), trim=new THREE.MeshStandardMaterial({name:"Trim_White",color:0xf2eee2,roughness:.8,flatShading:true});
const rootNode=new THREE.Group();rootNode.name="Starter_Garage";rootNode.userData={units:"meters",upAxis:"Y",forwardAxis:"+Z",footprintMeters:[4,8],publicSafe:true};
const box=(parent,name,size,pos,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);m.name=name;m.position.set(...pos);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
const floor=new THREE.Group();floor.name="floor";rootNode.add(floor);box(floor,"Garage_Slab",[4,.12,8],[0,.06,0],concrete);
const left=new THREE.Group();left.name="wall_left";rootNode.add(left);box(left,"Left_Wall",[.14,2.6,7.72],[-1.93,1.36,-.14],wall);
const right=new THREE.Group();right.name="wall_right";rootNode.add(right);box(right,"Right_Wall",[.14,2.6,7.72],[1.93,1.36,-.14],wall);
const back=new THREE.Group();back.name="wall_back";rootNode.add(back);box(back,"Back_Wall",[3.72,2.6,.14],[0,1.36,-3.81],wall);
const front=new THREE.Group();front.name="facade_front";rootNode.add(front);
// Header and narrow piers leave a 2.74 x 2.13 m clear door opening.
box(front,"Facade_Left_Pier",[.49,2.6,.14],[-1.755,1.36,3.81],wall);box(front,"Facade_Right_Pier",[.49,2.6,.14],[1.755,1.36,3.81],wall);box(front,"Facade_Header",[2.74,.47,.14],[0,2.365,3.81],wall);
box(front,"Door_Orange_Trim",[2.78,.09,.12],[0,2.22,3.82],orange);
// Side pedestrian-scale window/detail.
box(right,"Side_Window_Trim",[.08,.52,1.0],[1.93,1.55,-1.4],trim);box(right,"Side_Window_Glass",[.06,.36,.78],[1.93,1.55,-1.4],new THREE.MeshStandardMaterial({name:"Glass",color:0x82979a,roughness:.3,metalness:.1}));
const roof=new THREE.Group();roof.name="roof";rootNode.add(roof);box(roof,"Flat_Roof",[4,.16,8],[0,2.74,0],roofMat);
// Pivot on the opening's top edge. The rolled panel turns inward under the roof.
const door=new THREE.Group();door.name="door";door.position.set(0,2.235,3.78);rootNode.add(door);for(let i=0;i<4;i++)box(door,`Sectional_Panel_${i+1}`,[2.74,.5325,.075],[0,-2.13+.26625+i*.5325,0],orange);
for(const [name,pos] of [["attach_socket_left",[-2,0,0]],["attach_socket_right",[2,0,0]],["attach_socket_back",[0,0,-4]]]){const s=new THREE.Group();s.name=name;s.position.set(...pos);rootNode.add(s);}
const times=[0,1.5],track=new THREE.QuaternionKeyframeTrack("door.quaternion",times,[0,0,0,1,-Math.SQRT1_2,0,0,Math.SQRT1_2]);const shift=new THREE.VectorKeyframeTrack("door.position",times,[0,2.235,3.78,0,2.16,3.62]);const clip=new THREE.AnimationClip("door_open",1.5,[track,shift]);const closeTrack=new THREE.QuaternionKeyframeTrack("door.quaternion",times,[-Math.SQRT1_2,0,0,Math.SQRT1_2,0,0,0,1]);const closeShift=new THREE.VectorKeyframeTrack("door.position",times,[0,2.16,3.62,0,2.235,3.78]);const closeClip=new THREE.AnimationClip("door_close",1.5,[closeTrack,closeShift]);
async function main(){const bin=await new GLTFExporter().parseAsync(rootNode,{binary:true,animations:[clip,closeClip]});writeFileSync(resolve(out,"starter-garage.glb"),Buffer.from(bin));console.log("Generated starter-garage.glb");}main();
