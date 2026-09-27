import {createServer} from 'vite';
import {writeFileSync} from 'node:fs';
const output=process.argv[2];
if(!output) throw new Error('Usage: node scripts/probeStarterDrivewayTurns.mjs <output.json>');
const s=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
const load=p=>s.ssrLoadModule('/src/colony/'+p+'.ts');
const {ColonyRuntime}=await load('runtime'),{cellOk}=await load('pathfind'),{surveyStarterParcels,surveyStarterDrivewayClearance}=await load('starterParcelSurvey'),{stepOwnedDrive}=await load('car/ownedDriving'),{SHOWROOM_VEHICLES}=await load('showroom/showroomCatalog');
const r=new ColonyRuntime(4242,{surveyOnly:true}),layout=r.captureWorldLayout();
const input={worldId:layout.worldId,layoutRevision:layout.revision.contentHash,parcels:r.lots(),roads:r.sim.state.roads,groundClear:c=>cellOk(r.sim.state.terrain,c.x,c.y)};
const stats=SHOWROOM_VEHICLES.find(v=>v.spec.id==='showroom:karoo-x19-targa').spec.stats,results=[];
for(const c of surveyStarterParcels(input).candidates){
const lot=input.parcels.find(l=>l.id===c.plotId),h=surveyStarterDrivewayClearance(c,lot,input.roads,input.groundClear).heading,road=c.driveway[0];
const allowed=new Set([...input.roads,...c.driveway].map(p=>`${p.x},${p.y}`)),fence=new Set(lot.fence.map(p=>`${p.x},${p.y}`));
const can=(x,y)=>allowed.has(`${Math.round(x)},${Math.round(y)}`)&&!fence.has(`${Math.round(x)},${Math.round(y)}`)&&input.groundClear({x:Math.round(x),y:Math.round(y)});
for(const d of [-1,1]){let success=null,lastPose=null;
for(let threshold=-.4;threshold<=.81;threshold+=.1){let p={...c.spawn,heading:h,speed:0},turn=false;const target=h+d*Math.PI/2;
for(let frame=0;frame<2400;frame++){
if((road.x-p.x)*Math.cos(h)+(road.y-p.y)*Math.sin(h)<=threshold)turn=true;
const steer=turn&&d*(target-p.heading)>.01;
p=stepOwnedDrive(p,{...(p.speed<1?{throttle:true}:{brake:true}),left:steer&&d<0,right:steer&&d>0},stats,1/60,can);
if((p.x-road.x)*Math.cos(target)+(p.y-road.y)*Math.sin(target)>=2&&Math.abs(p.heading-target)<.03){success={threshold,frame,pose:p};break;}}
lastPose=p;if(success)break;}
results.push({plotId:c.plotId,direction:d,road,success,lastPose,nearbyRoads:success?undefined:input.roads.filter(p=>Math.abs(p.x-road.x)<=4&&Math.abs(p.y-road.y)<=4)});}}
writeFileSync(output,JSON.stringify({layoutRevision:layout.revision.contentHash,scope:'Production movement pilot; failure does not prove no possible route. Not rendered or deployed proof.',results},null,2));console.log(JSON.stringify(results));
}finally{await s.close();}


