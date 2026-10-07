import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.join(root,'data');
const playersFile=path.join(dataDir,'players.json');
const roundsFile=path.join(dataDir,'rounds.json');
const aliasesFile=path.join(dataDir,'custom-aliases.json');
const PORT=Number(process.env.PORT||3000);
const HOST=process.env.HOST||'0.0.0.0';

const ARCHIVES={
  Test:'https://cricsheet.org/downloads/tests_json.zip',
  ODI:'https://cricsheet.org/downloads/odis_json.zip',
  T20I:'https://cricsheet.org/downloads/t20s_json.zip',
  IPL:'https://cricsheet.org/downloads/ipl_json.zip'
};
const PEOPLE='https://cricsheet.org/register/people.csv';
const NAMES='https://cricsheet.org/register/names.csv';

const norm=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const compact=s=>norm(s).replace(/\s+/g,'');
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
const readJson=async(file,fallback=[])=>{try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}};
const round2=n=>Math.round(n*100)/100;

function csv(text){
  const rows=[]; let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')q=false;else cell+=c;}
    else if(c==='"')q=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;
  } if(cell||row.length){row.push(cell);rows.push(row)} return rows;
}
function register(peopleText,namesText){
  const people=new Map(),variants=new Map();
  const p=csv(peopleText),ph=p.shift().map(x=>x.toLowerCase());
  for(const r of p){const id=r[ph.indexOf('identifier')],name=r[ph.indexOf('name')],unique=r[ph.indexOf('unique_name')];if(id)people.set(id,{name,unique});}
  const n=csv(namesText),nh=n.shift().map(x=>x.toLowerCase());
  for(const r of n){const id=r[nh.indexOf('identifier')],name=r[nh.indexOf('name')];if(!id||!name)continue;if(!variants.has(id))variants.set(id,new Set());variants.get(id).add(name);}
  return {people,variants};
}
async function fetchBuf(url,label){
  const r=await fetch(url,{headers:{'user-agent':'CricDraft/5.1'}});
  if(!r.ok)throw new Error(label+' download failed: HTTP '+r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function fetchText(url,label){return (await fetchBuf(url,label)).toString('utf8');}

function unzip(buf){
  let eocd=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw new Error('Invalid ZIP archive');
  const total=buf.readUInt16LE(eocd+10),off=buf.readUInt32LE(eocd+16),out=new Map();let p=off;
  for(let i=0;i<total;i++){
    if(buf.readUInt32LE(p)!==0x02014b50)break;
    const method=buf.readUInt16LE(p+10),size=buf.readUInt32LE(p+20),nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),lo=buf.readUInt32LE(p+42);
    const name=buf.subarray(p+46,p+46+nl).toString('utf8');
    const lnl=buf.readUInt16LE(lo+26),lel=buf.readUInt16LE(lo+28),start=lo+30+lnl+lel,raw=buf.subarray(start,start+size);
    if(!name.endsWith('/'))out.set(name,method===0?raw:method===8?zlib.inflateRawSync(raw):Buffer.alloc(0));
    p+=46+nl+el+cl;
  }
  return out;
}
function role(p){
  if(p.wickets>=20&&p.runs>=500)return 'All-rounder';
  if(p.wickets>=20)return 'Bowler';
  if(p.runs>=500)return 'Batter';
  return 'Player';
}
function aliasesFor(display,id,variants,custom){
  const set=new Set([display,...(variants.get(id)||[])]);
  for(const word of display.split(/\s+/))if(word.length>=3)set.add(word);
  const initials=display.split(/\s+/).map(x=>x[0]).join(''); if(initials.length>=2)set.add(initials);
  for(const [canonical,list] of Object.entries(custom||{}))if(compact(canonical)===compact(display)||[...set].some(x=>compact(x)===compact(canonical)))for(const a of list)set.add(a);
  set.delete(display); return [...set].filter(Boolean);
}
async function aggregate(format,url,people,variants,custom){
  const zip=unzip(await fetchBuf(url,format));
  const matches=[...zip.entries()].filter(([n])=>n.endsWith('.json'));
  const stats=new Map(),get=(id,name)=>{
    const key=id||'name:'+compact(name);
    if(!stats.has(key))stats.set(key,{id,name,names:new Set(),matches:new Set(),runs:0,balls:0,dismissals:0,sixes:0,wickets:0,conceded:0,bowled:0,catches:0});
    const p=stats.get(key);if(name)p.names.add(name);return p;
  };
  let latest='',earliest='9999-99-99';
  for(const [filename,b] of matches){
    let m;try{m=JSON.parse(b.toString('utf8'))}catch{continue}
    const info=m.info||{},date=String(info.dates?.[0]||''); if(date){if(date>latest)latest=date;if(date<earliest)earliest=date;}
    const idFor=n=>String(info.registry?.people?.[n]||'');
    for(const team of Object.values(info.players||{}))for(const n of team||[])get(idFor(n),n).matches.add(filename);
    for(const inn of m.innings||[])for(const over of inn.overs||[])for(const d of over.deliveries||[]){
      const bat=get(idFor(d.batter),d.batter),bowl=get(idFor(d.bowler),d.bowler),br=Number(d.runs?.batter||0),ex=d.extras||{};
      bat.runs+=br;if(!('wides' in ex))bat.balls++;if(br===6&&!d.runs?.non_boundary)bat.sixes++;
      bowl.conceded+=Number(d.runs?.total||0)-Number(ex.byes||0)-Number(ex.legbyes||0)-Number(ex.penalty||0);
      if(!('wides'in ex)&&!('noballs'in ex))bowl.bowled++;
      for(const w of d.wickets||[]){
        const kind=String(w.kind||'').toLowerCase(),out=get(idFor(w.player_out),w.player_out);
        if(kind!=='retired hurt')out.dismissals++;
        if(!['run out','retired hurt','retired out','obstructing the field','timed out','handled the ball','hit the ball twice'].includes(kind))bowl.wickets++;
        if(kind==='caught'){const f=w.fielders?.[0]?.name;if(f)get(idFor(f),f).catches++;}
        else if(kind==='caught and bowled')bowl.catches++;
      }
    }
  }
  const rows=[];
  for(const p of stats.values()){
    if(!p.matches.size)continue;
    const display=people.get(p.id)?.name||people.get(p.id)?.unique||[...p.names][0]||p.name;
    rows.push({
      player_name:display,aliases:aliasesFor(display,p.id,variants,custom).join('|'),role:role(p),format,
      batting_average:p.dismissals?round2(p.runs/p.dismissals):null,
      bowling_average:p.wickets?round2(p.conceded/p.wickets):null,
      strike_rate:p.balls?round2(p.runs*100/p.balls):null,
      sixes:p.sixes,catches:p.catches,updated_on:latest,
      source_url:'https://cricsheet.org/downloads/',
      data_status:(format==='IPL'||format==='T20I')?'CRICSHEET_DERIVED':'CRICSHEET_COVERAGE_LIMITED',
      matches:p.matches.size,cricsheet_id:p.id
    });
  }
  return {rows,meta:{format,matches:matches.length,players:rows.length,earliest_match:earliest,latest_match:latest}};
}
async function refreshAll(){
  const [pt,nt,custom]=await Promise.all([fetchText(PEOPLE,'people register'),fetchText(NAMES,'names register'),readJson(aliasesFile,{})]);
  const {people,variants}=register(pt,nt),all=[],formats=[];
  for(const [f,u] of Object.entries(ARCHIVES)){const a=await aggregate(f,u,people,variants,custom);all.push(...a.rows);formats.push(a.meta);}
  await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(playersFile,JSON.stringify(all,null,2));
  return {rows:all.length,unique_players:new Set(all.map(x=>x.cricsheet_id||compact(x.player_name))).size,formats};
}
function searchTerms(p){
  const all=new Set([p.player_name,...String(p.aliases||'').split('|')].filter(Boolean));
  for(const n of [...all]){const words=n.split(/\s+/).filter(Boolean);for(const w of words)if(w.length>=2)all.add(w);all.add(words.map(x=>x[0]).join(''));}
  return [...all].map(norm).filter(Boolean);
}
function lev(a,b){a=compact(a);b=compact(b);const m=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=m[0];m[0]=i;for(let j=1;j<=b.length;j++){const old=m[j];m[j]=Math.min(m[j]+1,m[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;}}return m[b.length];}
function bestMatch(q,players,format){
  q=norm(q);const eligible=players.filter(p=>format==='T20I + IPL'?['T20I','IPL'].includes(p.format):p.format===format);
  const byId=new Map();
  for(const p of eligible){const id=p.cricsheet_id||compact(p.player_name);if(!byId.has(id))byId.set(id,{name:p.player_name,id,formats:new Set(),terms:new Set()});const x=byId.get(id);x.formats.add(p.format);for(const t of searchTerms(p))x.terms.add(t);}
  return [...byId.values()].map(x=>{let score=99;for(const t of x.terms){if(t===q)score=Math.min(score,0);else if(t.startsWith(q))score=Math.min(score,1);else if(t.includes(q))score=Math.min(score,2);else{const d=lev(q,t);if(d<=Math.max(1,Math.floor(q.length*.3)))score=Math.min(score,3+d/10);}}return {...x,score};}).filter(x=>x.score<99).sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name)).slice(0,12);
}
function metric(category){return {'Batting Average':'batting_average','Bowling Average':'bowling_average','Strike Rate':'strike_rate','Sixes':'sixes','Catches':'catches'}[category]}
function resolveStat(rows,name,format,category){
  const key=metric(category),find=f=>rows.find(r=>compact(r.player_name)===compact(name)&&r.format===f);
  if(format==='T20I + IPL'){const a=find('T20I'),b=find('IPL'),av=Number(a?.[key]),bv=Number(b?.[key]);if(!Number.isFinite(av)||!Number.isFinite(bv))return null;return (av+bv)/2;}
  const r=find(format),v=Number(r?.[key]);return Number.isFinite(v)?v:null;
}
async function analyze(body){
  const rows=await readJson(playersFile,[]);if(!rows.length)throw new Error('No local data. Click DOWNLOAD / REFRESH ALL FORMATS first.');
  const out=[];for(const t of body.teams||[])for(const p of t.players||[]){const m=bestMatch(p.suggested_name||p.entered_name,rows,body.format)[0];const name=m?.name||p.entered_name;out.push({team:t.name,entered_name:p.entered_name,corrected_name:name,stat_value:resolveStat(rows,name,body.format,body.category)});}
  const higher=body.category!=='Bowling Average',teams=(body.teams||[]).map(t=>{const ps=out.filter(x=>x.team===t.name),vals=ps.map(x=>x.stat_value).filter(Number.isFinite);const counting=['Sixes','Catches'].includes(body.category);return {team:t.name,score:vals.length==ps.length?(counting?vals.reduce((a,b)=>a+b,0):vals.reduce((a,b)=>a+b,0)/vals.length):null,players:ps};});
  teams.sort((a,b)=>a.score===null?1:b.score===null?-1:higher?b.score-a.score:a.score-b.score);
  const winner=teams.find(x=>x.score!==null)?.team||null,ranking=[...out].filter(x=>Number.isFinite(x.stat_value)).sort((a,b)=>higher?b.stat_value-a.stat_value:a.stat_value-b.stat_value);
  const round={id:'round_'+Date.now(),created_at:new Date().toISOString(),input:body,calculation:{winner,team_ranking:teams,player_ranking:ranking},one_liner:winner?winner+' wins 🏆 — '+(ranking[0]?.corrected_name||'the top pick')+' made the difference.':'No valid winner.'};
  const hist=await readJson(roundsFile,[]);hist.unshift(round);await fs.writeFile(roundsFile,JSON.stringify(hist.slice(0,250),null,2));return round;
}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>2_000_000)throw new Error('Request too large')}return JSON.parse(s||'{}')}
function localIps(){const a=[];for(const xs of Object.values(os.networkInterfaces()))for(const x of xs||[])if(x.family==='IPv4'&&!x.internal)a.push(x.address);return [...new Set(a)]}

async function handler(req,res){
  try{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&u.pathname==='/api/health'){const p=await readJson(playersFile,[]);return json(res,200,{ok:true,rows:p.length,api_cost:'₹0'});}
    if(req.method==='GET'&&u.pathname==='/api/players'){const p=await readJson(playersFile,[]),q=u.searchParams.get('q')||'',format=u.searchParams.get('format')||'IPL';return json(res,200,{players:q.length>=2?bestMatch(q,p,format):[]});}
    if(req.method==='POST'&&u.pathname==='/api/data/refresh-all')return json(res,200,{ok:true,...await refreshAll()});
    if(req.method==='POST'&&u.pathname==='/api/analyze')return json(res,200,await analyze(await body(req)));
    let f=u.pathname==='/'?'index.html':u.pathname.slice(1);if(f.includes('..'))return json(res,400,{error:'Bad path'});
    const full=path.join(root,f),buf=await fs.readFile(full),ext=path.extname(full);res.writeHead(200,{'content-type':{'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8'}[ext]||'application/octet-stream'});res.end(buf);
  }catch(e){json(res,e?.code==='ENOENT'?404:500,{error:e.message||'Server error'});}
}
await fs.mkdir(dataDir,{recursive:true});
http.createServer(handler).listen(PORT,HOST,()=>{console.log('\nCricDraft: http://localhost:'+PORT);for(const ip of localIps())console.log('Phone: http://'+ip+':'+PORT);console.log('API cost: ₹0\n');});
