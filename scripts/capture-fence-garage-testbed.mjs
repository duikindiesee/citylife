import { chromium } from "playwright-core";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const base="http://127.0.0.1:5199/fence-garage-testbed.html";
const out="/workspace/forge-preview/ingame"; await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const page=await browser.newPage({viewport:{width:1280,height:720}}); page.on("console",m=>{if(m.type()==="error")console.error("console:",m.text())});page.on("pageerror",e=>console.error("pageerror:",e.message));
async function open(mode,t=0){await page.goto(`${base}?cam=${mode}&t=${t}`);await page.waitForFunction(()=>window.__testbed?.ready===true,{timeout:60000});await page.waitForTimeout(500);}
for(const [file,mode,t] of [["01-aerial.png","aerial",0],["02-street-gate.png","street-gate",0],["03-driveway-approach.png","driveway-approach",0],["04-garage-door-closed.png","garage-closed",0],["05-garage-door-open.png","garage-open",0]]){await open(mode,t);await page.screenshot({path:join(out,file)});console.log(file,(await stat(join(out,file))).size);}
await open("walk",6);await page.screenshot({path:join(out,"06-walk-up-driveway.png")});console.log("06-walk-up-driveway.png",(await stat(join(out,"06-walk-up-driveway.png"))).size);
await open("drive");const frames=await mkdtemp(join(tmpdir(),"citylife-garage-"));for(let i=0;i<=210;i++){await page.evaluate(t=>window.__testbed.setTime(t),i/15);await page.screenshot({path:join(frames,`frame-${String(i).padStart(4,"0")}.png`)});}const ff=spawnSync("ffmpeg",["-y","-framerate","15","-i",join(frames,"frame-%04d.png"),"-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",join(out,"citylife-ingame-driveup.mp4")],{stdio:"inherit"});await rm(frames,{recursive:true,force:true});if(ff.status!==0)process.exitCode=1;else console.log("citylife-ingame-driveup.mp4",(await stat(join(out,"citylife-ingame-driveup.mp4"))).size);await browser.close();
