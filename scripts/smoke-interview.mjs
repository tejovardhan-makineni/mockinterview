// Complete a disposable local/staging interview through the public HTTP + WS
// contracts. Requires Node >=22. Creates and deletes its own synthetic account.
// Never run this against production without an explicitly configured test inbox.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = process.env.SMOKE_API_BASE || 'http://localhost:8081';
if (!['localhost','127.0.0.1'].includes(new URL(origin).hostname) && !process.env.SMOKE_EMAIL) throw new Error('Remote smoke requires SMOKE_EMAIL for a controlled test account.');
let token; let uid; let socket;
const email = process.env.SMOKE_EMAIL || `smoke-${randomUUID()}@example.test`;
const password = `Smoke-${randomUUID()}-only`;
async function request(method,path,body,expected=200){
 const response=await fetch(origin+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=response.status===204?null:await response.json();
 assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data;
}
function openLive(id,ticket){
 const messages=[];const listeners=new Set();let closed=false;let socketError;
 const notify=()=>{for(const listener of listeners)listener();};
 socket=new WebSocket(origin.replace(/^http/,'ws')+`/api/v1/sessions/${id}/live?token=${encodeURIComponent(ticket)}`);
 socket.addEventListener('message',event=>{if(typeof event.data!=='string')return;const message=JSON.parse(event.data);messages.push(message);notify();});
 socket.addEventListener('close',()=>{closed=true;notify();});
 socket.addEventListener('error',()=>{socketError=new Error('WebSocket connection failed');notify();});
 return {send:message=>socket.send(JSON.stringify(message)),wait:predicate=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{listeners.delete(check);reject(new Error('WebSocket timed out; messages: '+messages.map(m=>m.type+':'+(m.code||'')).join(',')));},20000);
  function check(){const i=messages.findIndex(predicate);const failure=messages.find(m=>m.type==='error');if(i<0&&!failure&&!socketError&&!closed)return;clearTimeout(timer);listeners.delete(check);if(i>=0)return resolve(messages.splice(i,1)[0]);reject(socketError||new Error(failure?`WebSocket error: ${failure.code||''} ${failure.text||''}`:'WebSocket closed before expected message'));}
  listeners.add(check);check();
 }),silent:milliseconds=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{listeners.delete(check);resolve();},milliseconds);
  function check(){const unexpected=messages.find(m=>m.type==='say'||m.type==='error'||m.type==='transcript'&&m.role==='interviewer');if(!unexpected&&!closed&&!socketError)return;clearTimeout(timer);listeners.delete(check);reject(socketError||new Error(unexpected?`Unsolicited interviewer output after reconnect: ${JSON.stringify(unexpected)}`:'WebSocket closed during silent reconnect'));}
  listeners.add(check);check();
 })};
}
function assertPrivateExportOmitted(value){
 const forbidden=new Set(['password_hash','token_version','question_snapshot','usage_identity','lease_owner','lease_until','quota_exempt','global_daily_limit','session_credentials','ciphertext','api_key','auth_actions','scoring_jobs']);
 function visit(node,path='$'){if(!node||typeof node!=='object')return;for(const [key,child] of Object.entries(node)){assert.ok(!forbidden.has(key),`Account export disclosed private field ${path}.${key}`);visit(child,`${path}.${key}`);}}
 visit(value);
}
try{
 const questions=await request('GET','/questions');
 const list=Array.isArray(questions)?questions:questions.questions;
 assert.ok(list?.length>0,'public catalog is empty');
 const auth=await request('POST','/auth/register',{email,password});token=auth.token;uid=auth.user.id;
 assert.equal(auth.user.role==='admin',false,'registration granted admin');
 if(auth.development_action_url){const link=new URL(auth.development_action_url);await request('POST','/auth/verify',{token:link.searchParams.get('token')});}
 else if(auth.verification_required)throw new Error('Complete the controlled inbox verification before remote smoke; local mode returns a link.');
 const question=list.find(q=>q.id==='behavioral_conflict')||list.find(q=>q.modality==='conversational')||list[0];
 const session=await request('POST','/sessions',{question_id:question.id,minutes:5,mode:'text',funding:'platform'});
 const {ticket}=await request('GET','/ws-ticket');
 let live=openLive(session.id,ticket);await live.wait(m=>m.type==='ready');await live.wait(m=>m.type==='say');
 const eventID=randomUUID();
 const answer='On a service migration, I first clarified the customer impact and the rollback constraints. I compared a staged rollout with a full cutover, then proposed a small canary with latency and error budgets. I asked the team to challenge that decision, tested failure recovery, and took responsibility for reverting when a canary exposed missing data. We repaired the migration and documented the evidence before trying again.';
 live.send({type:'user_text',text:answer,event_id:eventID});await live.wait(m=>m.type==='ack'&&m.event_id===eventID);await live.wait(m=>m.type==='say');
 // Retransmission of an acknowledged answer must not duplicate the transcript.
 live.send({type:'user_text',text:answer,event_id:eventID});await live.wait(m=>m.type==='ack'&&m.event_id===eventID);
 const workspace={kind:'note',content:'Final decision: canary rollout, explicit rollback trigger, and a recovery rehearsal.',revision:1,data:{notes:'Preserve this exact text.'}};
 await request('POST',`/sessions/${session.id}/workspace`,workspace);
 live.send({type:'end'});await live.wait(m=>m.type==='saved');
 await new Promise(resolve=>{if(socket.readyState===WebSocket.CLOSED)return resolve();socket.addEventListener('close',resolve,{once:true});});
 let detail=await request('GET',`/sessions/${session.id}`);assert.equal(detail.workspace.content,workspace.content);assert.equal(detail.workspace.data.notes,workspace.data.notes);
 const oldDeadline=detail.deadline_at;
 const beforeResume=await request('GET',`/sessions/${session.id}/transcript`);
 const savedTurns=Array.isArray(beforeResume)?beforeResume:beforeResume.turns;
 assert.equal(savedTurns.at(-1)?.role,'interviewer','smoke must reconnect while awaiting the candidate');
 const next=await request('GET','/ws-ticket');live=openLive(session.id,next.ticket);const ready=await live.wait(m=>m.type==='ready');assert.equal(ready.deadline_at,oldDeadline,'resume reset the deadline');
 await live.silent(1000);live.send({type:'end'});await live.wait(m=>m.type==='saved');
 await new Promise(resolve=>{if(socket.readyState===WebSocket.CLOSED)return resolve();socket.addEventListener('close',resolve,{once:true});});
 await request('POST',`/sessions/${session.id}/finish`,undefined,202);
 let report;
 for(let i=0;i<40;i++){
  const res=await fetch(origin+`/api/v1/sessions/${session.id}/report`,{headers:{Authorization:`Bearer ${token}`}});
  if(res.status===200){report=await res.json();break;}
  assert.equal(res.status,202);await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.ok(report,'report not persisted');
 const transcript=await request('GET',`/sessions/${session.id}/transcript`);
 const turns=Array.isArray(transcript)?transcript:transcript.turns;
 assert.equal(turns.filter(t=>t.text===answer).length,1,'answer duplicated or lost');
 assert.equal(turns.filter(t=>t.event_id===eventID).length,1,'saved transcript lost the acknowledged event identity');
 assert.equal(turns.length,savedTurns.length,'reconnect generated an unsolicited interviewer turn');
 await request('POST',`/sessions/${session.id}/finish`,undefined,200);
 const exported=await request('GET','/account/export');assertPrivateExportOmitted(exported);assert.equal(exported.account.id,uid);
 await request('POST','/feedback',{kind:'interview',rating:4,message:'',context:{session_id:session.id,target:'interviewer_realism'}});
 console.log(JSON.stringify({result:'passed',catalog_count:list.length,checks:['public catalog','registration and verification','provider-ready handshake','acknowledged answer deduplication','exact workspace restore','silent reconnect with unchanged deadline','durable scoring','idempotent finish','private export','rating-only feedback']},null,2));
}finally{
 if(socket&&socket.readyState<2)socket.close();
 if(token&&uid){try{await request('DELETE','/account',undefined,204);}catch{console.error('Cleanup failed: delete the synthetic smoke account from the local test database.');}}
}
