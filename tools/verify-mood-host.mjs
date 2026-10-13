#!/usr/bin/env node
/** 真 AppHost/slash/WS。临时 HANA_HOME 与测试账本不代表生产审批；无模型、无生产数据。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MOOD_PROMPT } from '../lib/mood-command.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync('/tmp/hap-mood-host-');
const appId = 'mood-dispatch-regression';
const capabilities = ['app/session.start-turn', 'app/sessions.manage', 'app/sessions.read'];
// 与安装记录一致，权限仍由真宿主检查；仅预置这份独立测试 HOME。
const declarationHash = '571edaad78ef7f752162358c393a51400d592eb59be28faf58eb12c3643a2d17';
const source = fs.readFileSync(path.join(repo, 'lib/mood-command.js'));
const results = [], evidence = { fixture, modelReplyVerified: false, moodModuleSha256: createHash('sha256').update(source).digest('hex'), scenarios: [] };
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
const intro = '用户敲了 /mood，想生成今日心情歌单。请先问他现在想听什么样的状态（一句话就够），\n然后读他的音乐库、选歌，保存成一个心情歌单。';
const args = '今天很累，来点安静的';
const argsText = `用户敲了 /mood，并说明：${args}。请据此读他的音乐库、选歌，保存成一个心情歌单；\n需要补充时先问一句。`;
const artifacts = path.join(os.homedir(), '.hanako/artifacts/server');
const root = process.env.HANA_APP_TOOLS_ROOT || fs.readdirSync(artifacts).map(x => path.join(artifacts, x))
  .filter(x => fs.existsSync(path.join(x, 'bootstrap.js')) && fs.existsSync(path.join(x, 'node')))
  .sort((a,b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

async function scenario(label, denied) {
  const hanaTestHome = path.join(fixture, label, 'home'), appDir = path.join(hanaTestHome, 'apps', appId);
  const tracePath = path.join(hanaTestHome, 'app-data', appId, 'trace.json'), logPath = path.join(fixture, label, 'boot.log');
  let host, ws, logFd, exit, spawnError;
  const run = { label, denied: denied || null, dispatches: [] }; evidence.scenarios.push(run);
  const trace = () => JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  async function waitFor(probe, ms, what) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exit !== undefined) throw new Error(`host exited ${exit}`);
      const value = await probe(); if (value) return value;
      await delay(150);
    }
    throw new Error(`${what} timed out; inspect ${logPath}`);
  }
  try {
    if (!root) throw new Error('Hana artifact missing; set HANA_APP_TOOLS_ROOT');
    evidence.hostArtifact = path.basename(root);
    const WebSocket = createRequire(import.meta.url)(path.join(root, 'node_modules/ws'));
    fs.mkdirSync(appDir, {recursive:true});
    fs.writeFileSync(path.join(appDir, 'mood-command.js'), source);
    fs.copyFileSync(path.join(repo, 'assets/icon.png'), path.join(appDir, 'icon.png'));
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({type:'module'}));
    fs.writeFileSync(path.join(appDir, 'manifest.json'), JSON.stringify({manifestVersion:2,id:appId,name:'Mood dispatch regression',version:'0.2.0',minAppVersion:'0.1017.0',entry:'index.js',icon:'icon.png',capabilities}));
    // 观测层记录真 RPC 的请求/结果，绝不替 session:list/send 编造结果。
    fs.writeFileSync(path.join(appDir, 'index.js'), `
import fs from 'node:fs'; import path from 'node:path';
import { createMoodCommand } from './mood-command.js';
export async function apply(ctx) {
  const trace = {calls:[],warnings:[],invocations:[]};
  const save = () => fs.writeFileSync(path.join(ctx.dataDir,'trace.json'),JSON.stringify(trace));
  let originalHandler;
  const observed = {...ctx};
  observed.logger = {...ctx.logger,async warn(text){trace.warnings.push(text);save();await ctx.logger.warn(text);}};
  observed.bus = {...ctx.bus,async request(verb,payload){
    const call={verb,payload};trace.calls.push(call);save();
    try{const result=await ctx.bus.request(verb,payload);call.result=verb==='session:list'?{sessions:result.sessions.map(x=>({path:x.path,sessionId:x.sessionId}))}:result;save();return result;}
    catch(error){call.error=error.message;save();throw error;}
  }};
  observed.commands = {...ctx.commands,register(registration){
    originalHandler=registration.handler;
    return ctx.commands.register({...registration,async handler(inv){trace.invocations.push({sessionPath:inv.sessionPath,args:inv.args});save();return registration.handler(inv);}});
  }};
  const mood=createMoodCommand(observed);
  if(!(await mood.ensure()))throw new Error('mood absent from listOwn');
  const noPath=ctx.commands.register({name:'mood_no_path',handler:inv=>originalHandler({...inv,sessionPath:null})});
  const unmatched=ctx.commands.register({name:'mood_unmatched',handler:inv=>originalHandler({...inv,sessionPath:'/missing/session.jsonl'})});
  await noPath.ready;await unmatched.ready;save();
  return ()=>{mood.dispose();noPath();unmatched();};
}
`);
    const date = new Date().toISOString();
    fs.mkdirSync(path.join(hanaTestHome,'extensions'),{recursive:true});
    fs.writeFileSync(path.join(hanaTestHome,'extensions/installs.json'),JSON.stringify({schemaVersion:1,records:[{
      ref:`app:${appId}`,kind:'app',id:appId,version:'0.2.0',origin:'user',source:{type:'local'},installedAt:date,updatedAt:date,installedBy:{kind:'user'},integrity:{checkedAt:date,checks:['runtime-smoke']},
      approval:{decidedAt:date,decidedBy:{kind:'user'},declarationHash,appDeclaration:{version:1,capabilities,network:{allowedHosts:[],methods:['GET'],allowLocalhost:false}}},location:`apps/${appId}`,history:[],
    }]}));
    fs.mkdirSync(path.join(hanaTestHome,'security'),{recursive:true});
    fs.writeFileSync(path.join(hanaTestHome,'security/permission-ledger.json'),JSON.stringify({schemaVersion:1,records:capabilities.map(capability=>({
      recordId:`perm_${randomUUID()}`,subject:{domain:'app',id:appId},capability,decision:capability===denied?'denied':'allowed',tier:'always',traits:[],purpose:null,decidedAt:date,declarationHash,decidedBy:{kind:'user'},
    }))}));
    // 启动前放入合法 legacy 会话，交由宿主迁移生成 stable manifest，不能自己伪造 sessionId。
    const sessionDir=path.join(hanaTestHome,'agents/hanako/sessions');fs.mkdirSync(sessionDir,{recursive:true});
    const sessionPath=path.join(sessionDir,'mood-dispatch.jsonl');
    fs.writeFileSync(sessionPath,[
      {type:'session',version:3,id:randomUUID(),timestamp:date,cwd:repo},
      {type:'message',id:'fixture-user',parentId:null,timestamp:date,message:{role:'user',content:[{type:'text',text:'隔离宿主派发回归会话'}],timestamp:Date.now()}},
    ].map(x=>JSON.stringify(x)).join('\n')+'\n');
    logFd=fs.openSync(logPath,'w');
    host=spawn(path.join(root,'node'),[path.join(root,'bootstrap.js')],{cwd:root,detached:true,stdio:['ignore',logFd,logFd],env:{...process.env,HANA_HOME:hanaTestHome,HANA_ROOT:root,HANA_SERVER_ENTRY:path.join(root,'bundle/index.js')}});
    host.once('error',err=>{spawnError=err;});host.once('exit',(code,signal)=>{exit=signal||code;});
    const info=await waitFor(async()=>{try{return JSON.parse(fs.readFileSync(path.join(hanaTestHome,'server-info.json'),'utf8'));}catch{return null;}},35000,'startup');
    const base=`http://127.0.0.1:${info.port}`,headers={Authorization:`Bearer ${info.token}`};
    const command=await waitFor(async()=>{try{const r=await fetch(`${base}/api/commands`,{headers,signal:AbortSignal.timeout(2000)});const b=await r.json();return(Array.isArray(b)?b:b.commands)?.find(x=>x.name==='mood'&&x.source==='app');}catch{return null;}},10000,'registration');
    run.command={name:command.name,aliases:command.aliases,source:command.source};
    async function dispatch(text,locator=sessionPath,type='slash'){
      const start=trace().calls.length;
      const ticketResponse=await fetch(`${base}/api/ws-ticket`,{method:'POST',headers,signal:AbortSignal.timeout(3000)});const{ticket}=await ticketResponse.json();
      if(!ticket)throw new Error('WS ticket missing');
      ws=new WebSocket(`ws://127.0.0.1:${info.port}/ws?wsTicket=${encodeURIComponent(ticket)}`);
      const message=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('slash_result not received')),8000);
        ws.once('error',error=>{clearTimeout(timeout);reject(error);});
        ws.on('message',bytes=>{let v;try{v=JSON.parse(bytes.toString());}catch{return;}if(v.type!=='slash_result'&&v.type!=='error')return;clearTimeout(timeout);resolve(v);});
        ws.once('open',()=>ws.send(JSON.stringify({type,text,sessionPath:locator,agentId:'hanako'})));
      });
      ws.terminate();ws=null;
      const observation={input:text,locator,received:{type:message.type,text:message.text||message.message,level:message.level},calls:trace().calls.slice(start)};run.dispatches.push(observation);
      if(type==='slash')check(`${label}-${text.split(' ')[0].slice(1)}${text.includes(' ')?'-args':''}-client-fallback-text-exact`,message.type==='slash_result'&&message.level==='success'&&message.text===MOOD_PROMPT,observation.received.text);
      return observation;
    }
    // 公共桌面输入入口登记稳定 manifest id；无模型失败是预期，不借用 App 的 session:create 权限。
    await dispatch('初始化隔离回归会话',sessionPath,'prompt');
    const first=await dispatch('/mood');
    if(!denied){
      const listed=first.calls.find(x=>x.verb==='session:list'),sent=first.calls.find(x=>x.verb==='session:send');
      check('granted-resolves-current-stable-session-id',listed?.result?.sessions.some(x=>x.sessionId&&x.sessionId===sent?.payload.sessionId)&&sent?.payload.scope==='all');
      check('granted-default-prescribed-text',sent?.payload.text===intro);
      check('granted-send-reaches-model-layer',sent?.error?.includes('No models available'),sent?.error||'send not reached');
      const withArgs=await dispatch(`/mood ${args}`,fs.realpathSync(sessionPath)),argsSend=withArgs.calls.find(x=>x.verb==='session:send');
      check('granted-args-prescribed-text-and-model-layer',argsSend?.payload.text===argsText&&argsSend?.error?.includes('No models available'),argsSend?.error||'send missing');
      check('granted-tmp-private-tmp-same-stable-session-id',sessionPath!==fs.realpathSync(sessionPath)&&!!sent?.payload.sessionId&&argsSend?.payload.sessionId===sent.payload.sessionId);
      const absent=await dispatch('/mood_no_path');check('no-path-no-session-query-and-warning',absent.calls.length===0&&trace().warnings.some(x=>x.includes('缺少会话路径')));
      const unmatched=await dispatch('/mood_unmatched');check('unmatched-path-no-send-and-warning',unmatched.calls.length===1&&unmatched.calls[0].verb==='session:list'&&trace().warnings.some(x=>x.includes('未找到当前会话')));
    }else check(`${label}-actual-host-permission-rejection`,first.calls.some(x=>x.error?.includes(denied)),JSON.stringify(first.calls.map(x=>({verb:x.verb,error:x.error}))));
    run.sessionBytes=fs.statSync(sessionPath).size;
  }finally{
    ws?.terminate();if(host?.pid){try{process.kill(-host.pid,'SIGTERM');}catch{}const deadline=Date.now()+2500;while(exit===undefined&&Date.now()<deadline)await delay(50);try{process.kill(-host.pid,'SIGKILL');}catch{}}
    if(logFd!==undefined)fs.closeSync(logFd);
  }
}
for(const[label,denied]of[['granted',null],['read-denied','app/sessions.read'],['manage-denied','app/sessions.manage'],['turn-denied','app/session.start-turn']]){
  try{await scenario(label,denied);}catch(error){check(`${label}-host-execution`,false,error.message);}
}
const failed=results.filter(x=>!x.ok);
console.log(JSON.stringify({passed:results.length-failed.length,total:results.length,failed,results,evidence},null,2));
process.exitCode=failed.length?1:0;
