import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),loader=new GLTFLoader();
for(const name of ["picket-fence-panel","picket-fence-post-line","picket-fence-post-corner","picket-fence-post-end","picket-fence-gate-driveway","picket-for-sale-sign","starter-garage"]){
 const bytes=readFileSync(resolve(root,"public/assets/citylife/props",`${name}.glb`));
 const gltf=await new Promise((ok,no)=>loader.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),"",ok,no));
 gltf.scene.updateMatrixWorld(true);if(new THREE.Box3().setFromObject(gltf.scene).isEmpty())throw new Error(`${name} has no geometry`);console.log(`${name}: nonempty`);
}
