import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const outputPath = process.argv[2];
if (!outputPath) throw new Error('Usage: node scripts/createStarterParcelManifest.mjs <output.json>');
const server = await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {ColonyRuntime} = await server.ssrLoadModule('/src/colony/runtime.ts');
  const {createStarterParcelManifest} = await server.ssrLoadModule('/src/colony/starterParcelManifest.ts');
  const {cellOk} = await server.ssrLoadModule('/src/colony/pathfind.ts');
  const {COLONY} = await server.ssrLoadModule('/src/colony/config.ts');
  const runtime = new ColonyRuntime(COLONY.render.seed,{surveyOnly:true});
  const manifest = createStarterParcelManifest({layout:runtime.captureWorldLayout(),parcels:runtime.lots(),
    groundClear:cell=>cellOk(runtime.sim.state.terrain,cell.x,cell.y)});
  writeFileSync(outputPath,JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({status:manifest.status,worldId:manifest.worldId,
    sourceLayoutRevision:manifest.sourceLayoutRevision,layoutRevision:manifest.layoutRevision,
    plots:manifest.plots.map(p=>({plotId:p.plotId,frameId:p.frameId})),rejected:manifest.rejected}));
} finally {await server.close();}
