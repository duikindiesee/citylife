import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Matrix4,Quaternion,Vector3,Box3} from 'three';
// Accessor bounds transformed through the actual scene hierarchy and the catalogue's
// current -PI/2 yaw. Conservative static mesh bounds; not animated suspension bounds.
for (const name of ['fiat_x19','karoo_vonk','karoo_kaap_gt']) {
 const buffer=readFileSync(`public/assets/citylife/cars/${name}.glb`);
 const length=buffer.readUInt32LE(12);
 const json=JSON.parse(buffer.subarray(20,20+length).toString('utf8'));
 const bounds=new Box3();
 function visit(i,parent) {
  const node=json.nodes[i];
  const local=node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation??[0,0,0])),new Quaternion(...(node.rotation??[0,0,0,1])),new Vector3(...(node.scale??[1,1,1])));
  const world=parent.clone().multiply(local);
  if(node.mesh!==undefined) for(const primitive of json.meshes[node.mesh].primitives) {
   const accessor=json.accessors[primitive.attributes.POSITION];
   if(!accessor.min || !accessor.max) throw new Error('Missing mesh bounds');
   bounds.union(new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max)).applyMatrix4(world));
  }
  for(const child of node.children??[]) visit(child,world);
 }
 for(const root of json.scenes[json.scene??0].nodes) visit(root,new Matrix4().makeRotationY(-Math.PI/2));
 console.log(JSON.stringify({name,sha256:createHash('sha256').update(buffer).digest('hex'),size:bounds.getSize(new Vector3()),min:bounds.min,max:bounds.max}));
}
