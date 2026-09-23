import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const outputPath = process.argv[2];
if (!outputPath) throw new Error('Usage: node scripts/surveyStarterParcels.mjs <output.json>');
const server = await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {ColonyRuntime} = await server.ssrLoadModule('/src/colony/runtime.ts');
 const {surveyStarterParcels} = await server.ssrLoadModule('/src/colony/starterParcelSurvey.ts');
 const {cellOk} = await server.ssrLoadModule('/src/colony/pathfind.ts');
 const {COLONY} = await server.ssrLoadModule('/src/colony/config.ts');
 const rt = new ColonyRuntime(COLONY.render.seed,{surveyOnly:true});
 const layout = rt.captureWorldLayout();
 const survey = surveyStarterParcels({worldId:layout.worldId,layoutRevision:layout.revision.contentHash,parcels:rt.lots(),roads:rt.sim.state.roads,groundClear:c=>cellOk(rt.sim.state.terrain,c.x,c.y)});
 writeFileSync(outputPath,JSON.stringify({status:'SURVEY_ONLY_NOT_PUBLISHED',...survey},null,2));
 console.log(JSON.stringify({candidates:survey.candidates.map(c=>c.plotId),rejected:survey.rejected}));
} finally {await server.close();}
