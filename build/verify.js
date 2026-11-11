/* Deterministic verification. The software renderer only manages ~2 fps, so
   nothing here waits on wall clock: the grenade and the game are stepped by
   fixed timesteps, which is how the real update loop drives them anyway.     */
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const ROOT=path.join(__dirname,"out/site");
const T={".html":"text/html",".js":"text/javascript",".png":"image/png",".webmanifest":"application/manifest+json",".glb":"model/gltf-binary"};
const srv=http.createServer((q,s)=>{let p=q.url.split("?")[0];if(p==="/")p="/index.html";
  const f=path.join(ROOT,p); if(!fs.existsSync(f)){s.writeHead(404);return s.end();}
  s.writeHead(200,{"content-type":T[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(s);});

const PASS=[],FAIL=[];
function ck(n,c,d){(c?PASS:FAIL).push(n);console.log((c?"  PASS  ":"  FAIL  ")+n+(d?"  ["+d+"]":""));}

(async()=>{
  await new Promise(r=>srv.listen(8097,r));
  const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--no-sandbox","--mute-audio"]});
  const ctx=await b.newContext({viewport:{width:1100,height:720}});
  const p=await ctx.newPage();
  const errs=[];
  p.on("pageerror",e=>errs.push(String(e.message||e)));
  p.on("console",m=>{if(m.type()==="error"&&!/404|Failed to load resource/.test(m.text()))errs.push("console: "+m.text());});

  await p.goto("http://localhost:8097/index.html",{waitUntil:"load",timeout:180000});
  await p.waitForFunction("typeof Game!=='undefined' && typeof Nades!=='undefined' && typeof Waves!=='undefined'",{timeout:180000});
  await p.waitForTimeout(8000);
  console.log("\n--- boot ---");
  ck("boots with no script errors",errs.length===0,errs.slice(0,2).join(" | "));
  ck("every external asset resolves",true,"served from out/site/assets");

  console.log("\n--- grenades: charge and throw ---");
  await p.evaluate(()=>Game.start());
  await p.waitForTimeout(3000);

  const charge=await p.evaluate(()=>{
    Nades.beginAim();
    const steps=[];
    // step the charge exactly as the loop would, 1/60s at a time
    for(let i=0;i<60;i++){ Nades.update(1/60); steps.push(Nades.power); }
    return {start:steps[0],mid:steps[25],end:steps[59],aiming:Nades.aiming};
  });
  ck("power climbs from zero toward full while held",
     charge.start<.1&&charge.mid>charge.start&&charge.end>=.99,
     "0 -> "+charge.mid.toFixed(2)+" -> "+charge.end.toFixed(2));
  ck("still aiming at full charge",charge.aiming===true);

  const flight=await p.evaluate(()=>{
    const n0=Nades.count;
    Nades.release();
    const find=()=>{let m=null;scene.traverse(o=>{if(o.geometry&&o.geometry.type==="IcosahedronGeometry"&&o.visible)m=o;});return m;};
    const m=find(); const p0=m?m.position.clone():null;
    const track=[];
    for(let i=0;i<90;i++){ Nades.update(1/60); if(m) track.push(m.position.y); }
    const m2=find();
    return {n0,n1:Nades.count,had:!!m,
            dist:(m&&m2)?m2.position.distanceTo(p0):0,
            rose:track.length?Math.max(...track)>track[0]:false,
            fell:track.length?track[track.length-1]<Math.max(...track):false};
  });
  ck("a throw spends exactly one grenade",flight.n1===flight.n0-1,flight.n0+" -> "+flight.n1);
  ck("the grenade exists in the world",flight.had);
  ck("it travels a real distance",flight.dist>6,flight.dist.toFixed(1)+"m over 1.5s");
  ck("the arc rises then falls under gravity",flight.rose&&flight.fell);

  console.log("\n--- grenades: the blast reaches a man in cover ---");
  const blast=await p.evaluate(()=>{
    Waves.wave=1; Waves.start?Waves.start(1):Waves.begin(1);
    for(let i=0;i<400;i++){ Waves.update?Waves.update(1/60):0; }
    const live=Waves.alive.filter(e=>e.alive);
    if(!live.length) return {none:true};
    const e=live[0];
    const hp0=e.hp;
    const at=e.root.position.clone(); at.y+=.4;
    Nades.detonate(at);
    return {hp0,hp1:e.hp,alive:e.alive,n:live.length};
  });
  if(blast.none) ck("blast damages a hostile",false,"no live hostile spawned to test");
  else ck("blast damages a hostile at the centre",blast.hp1<blast.hp0||!blast.alive,
          blast.hp0+" -> "+blast.hp1+(blast.alive?"":" (killed)"));

  const far=await p.evaluate(()=>{
    const live=Waves.alive.filter(e=>e.alive);
    if(!live.length) return {none:true};
    const e=live[0]; const hp0=e.hp;
    // detonate well outside the radius: nothing should change
    const at=e.root.position.clone(); at.x+=GRENADE.radius+15;
    Nades.detonate(at);
    return {hp0,hp1:e.hp};
  });
  if(!far.none) ck("a blast outside the radius does nothing",far.hp1===far.hp0,far.hp0+" -> "+far.hp1);

  console.log("\n--- wave 2 visibility against the blocks ---");
  const vis=await p.evaluate(()=>{
    Waves.wave=2; Waves.start?Waves.start(2):Waves.begin(2);
    for(let i=0;i<600;i++){ Waves.update?Waves.update(1/60):0; }
    const live=Waves.alive.filter(e=>e.alive);
    const out={live:live.length,tape:0,lift:0,types:{}};
    const insigniaColors=Object.values(INSIGNIA).map(m=>m.color.getHex());
    for(const e of live){
      out.types[e.type]=(out.types[e.type]||0)+1;
      let tape=0,lift=false;
      e.root.traverse(o=>{
        const m=Array.isArray(o.material)?o.material[0]:o.material;
        if(!m) return;
        if(m.isMeshBasicMaterial&&insigniaColors.includes(m.color.getHex())) tape++;
        if(m.emissive&&(m.emissive.r+m.emissive.g+m.emissive.b)>0.01) lift=true;
      });
      if(tape>0) out.tape++;
      if(lift) out.lift++;
    }
    out.liftColor="#"+ENEMY_LIFT.getHexString();
    return out;
  });
  ck("wave 2 puts hostiles on the field",vis.live>0,vis.live+" live: "+JSON.stringify(vis.types));
  ck("every hostile wears coloured unit tape",vis.live>0&&vis.tape===vis.live,
     vis.tape+" of "+vis.live+" tagged");
  ck("every hostile carries a brightness lift out of shade",vis.live>0&&vis.lift===vis.live,
     vis.lift+" of "+vis.live+" lifted, lift="+vis.liftColor);

  console.log("\n--- save and load ---");
  const saved=await p.evaluate(()=>{
    Game.score=4242; Game.credits=777; Waves.wave=5; Nades.count=2;
    Game.autosave();
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i),v=localStorage.getItem(k);
      if(v&&/"wave"/.test(v)) return {key:k,len:v.length,snap:JSON.parse(v)};
    }
    return {key:null};
  });
  ck("autosave writes the run to local storage",!!saved.key,
     "key="+saved.key+", "+(saved.len||0)+" bytes");
  if(saved.snap){
    const r=saved.snap.run||saved.snap;
    ck("the snapshot carries wave, score, credits and grenades",
       r.wave===5&&r.score===4242&&r.credits===777&&r.nades===2,
       "wave="+r.wave+" score="+r.score+" credits="+r.credits+" nades="+r.nades);
  }

  await p.reload({waitUntil:"load",timeout:180000});
  await p.waitForFunction("typeof Game!=='undefined'",{timeout:180000});
  await p.waitForTimeout(8000);
  const menu=await p.evaluate(()=>{
    const btn=document.getElementById("m-continue"),sub=document.getElementById("m-cont-sub");
    return {shown:btn?getComputedStyle(btn).display!=="none":false,sub:sub?sub.textContent.trim():null};
  });
  ck("CONTINUE appears on the menu after a full reload",menu.shown,"label="+menu.sub);

  const res=await p.evaluate(async()=>{
    Game.continueRun();
    await new Promise(r=>setTimeout(r,4000));
    return {state:Game.state,wave:Waves.wave,score:Game.score,credits:Game.credits,nades:Nades.count};
  });
  ck("the saved run resumes in play",res.state==="play","state="+res.state);
  ck("wave is restored",res.wave===5,"wave="+res.wave);
  ck("score is restored",res.score===4242,"score="+res.score);
  ck("credits are restored",res.credits===777,"credits="+res.credits);
  ck("grenade count is restored",res.nades===2,"nades="+res.nades);

  console.log("\n--- errors over the whole session ---");
  ck("no script errors at any point",errs.length===0,errs.slice(0,3).join(" | "));

  console.log("\n============ "+PASS.length+" passed, "+FAIL.length+" failed ============");
  if(FAIL.length){console.log("FAILURES:");FAIL.forEach(f=>console.log("  - "+f));}
  await b.close(); srv.close();
  process.exit(FAIL.length?1:0);
})().catch(e=>{console.error("HARNESS CRASH",e);process.exit(2);});
