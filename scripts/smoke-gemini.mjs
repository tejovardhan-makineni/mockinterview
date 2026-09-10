// Explicitly billable live-provider check. Local API only; synthetic data,
// typed answers and received audio counts, never microphone/camera recording.
// Run against a separate schema with real Gemini and USE_STUB_LLM=false.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = process.env.SMOKE_API_BASE || 'http://localhost:8083';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Local isolated API required');
let token, socket;
const observations = { text: {}, voice: {}, checks: [] };
const deadline = Date.now() + 240_000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(method, path, body, statuses = [200]) {
  const response = await fetch(origin + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
  const result = response.status === 204 ? null : await response.json();
  assert.ok(statuses.includes(response.status), `${method} ${path}: HTTP ${response.status}, code ${result?.code || 'unknown'}`);
  return { status: response.status, data: result };
}
async function open(id) {
  const { data } = await request('GET', '/ws-ticket');
  const messages = [];
  let audioPackets = 0, audioBytes = 0;
  socket = new WebSocket(origin.replace(/^http/, 'ws') + `/api/v1/sessions/${id}/live?token=${encodeURIComponent(data.ticket)}`);
  const thisSocket = socket;
  thisSocket.addEventListener('message', event => {
    if (typeof event.data === 'string') messages.push(JSON.parse(event.data));
    else { audioPackets++; audioBytes += event.data.size ?? event.data.byteLength ?? 0; }
  });
  return {
    messages, get audioPackets() { return audioPackets; }, get audioBytes() { return audioBytes; },
    send(message) { thisSocket.send(JSON.stringify(message)); },
    async wait(predicate, timeout = 40_000) {
      const until = Math.min(Date.now() + timeout, deadline);
      while (Date.now() < until) {
        const error = messages.find(m => m.type === 'error');
        if (error) throw new Error(`Live error: ${error.code}`);
        const at = messages.findIndex(predicate);
        if (at >= 0) return messages.splice(at, 1)[0];
        if (thisSocket.readyState === WebSocket.CLOSED) throw new Error('Live socket closed before expected message');
        await delay(50);
      }
      throw new Error('Live response timeout: ' + messages.map(m => m.type).join(','));
    },
    async audio(after = 0) {
      const until = Math.min(Date.now() + 40_000, deadline);
      while (audioPackets <= after && Date.now() < until) {
        const error = messages.find(m => m.type === 'error');
        if (error) throw new Error(`Live error: ${error.code}`);
        await delay(50);
      }
      assert.ok(audioPackets > after, 'No native audio packets');
    },
    async close(graceful = false) {
      if (graceful) { this.send({ type: 'end' }); await this.wait(m => m.type === 'saved'); }
      thisSocket.close();
      const until = Date.now() + 5_000;
      while (thisSocket.readyState !== WebSocket.CLOSED && Date.now() < until) await delay(50);
      await delay(350);
    },
  };
}
async function report(id) {
  await request('POST', `/sessions/${id}/finish`, undefined, [200, 202]);
  while (Date.now() < deadline) {
    const response = await request('GET', `/sessions/${id}/report`, undefined, [200, 202]);
    if (response.status === 200) {
      const serialized = JSON.stringify(response.data);
      assert.ok(!serialized.includes('Demo mode'), 'Unexpected demo scoring');
      return response.data;
    }
    await delay(1000);
  }
  throw new Error('Report exceeded the bounded provider-check budget');
}
const config = { face_id: 'alex', voice_id: 'aoede', personality: 'neutral', target_level: 'mid', challenge: 'standard', practice_mode: 'simulation', include_resume: false };
try {
  const auth = (await request('POST', '/auth/register', { email: `provider-${randomUUID()}@example.test`, password: `Provider-${randomUUID()}-only` })).data;
  token = auth.token;
  if (auth.development_action_url) await request('POST', '/auth/verify', { token: new URL(auth.development_action_url).searchParams.get('token') });
  let live;
  let event;
  if (process.env.SMOKE_ONLY !== 'voice') {
  const text = (await request('POST', '/sessions', { question_id: 'ai-output-critique-forecast', minutes: 5, mode: 'text', funding: 'platform', config })).data;
  live = await open(text.id);
  await live.wait(m => m.type === 'ready');
  observations.text.opening = (await live.wait(m => m.type === 'say')).text;
  const clarification = 'Were the visitors randomly assigned to the two periods, and do we have actual revenue data?';
  event = randomUUID();
  live.send({ type: 'user_text', text: clarification, event_id: event });
  await live.wait(m => m.type === 'ack' && m.event_id === event);
  observations.text.clarification = (await live.wait(m => m.type === 'say')).text;
  const finalText = 'I initially called the conversion change a 20 percentage point increase. Correction: 10 percent to 12 percent is two percentage points, or a 20 percent relative increase. These monthly samples were not randomized, so I cannot attribute the difference to the campaign. I would verify tracking definitions and compare channel mix and seasonality. There is no revenue data here, so I would remove the revenue prediction, label the remaining uncertainty, and propose an experiment with a prespecified conversion metric before recommending a larger rollout.';
  event = randomUUID();
  live.send({ type: 'user_text', text: finalText, event_id: event });
  await live.wait(m => m.type === 'ack' && m.event_id === event);
  observations.text.followup = (await live.wait(m => m.type === 'say')).text;
  await live.close(true);
  const textReport = await report(text.id);
  observations.text.report = { scored: textReport.scored, overall: textReport.overall, scores: textReport.scores, radar: textReport.radar };
  observations.checks.push('real text clarification and correction', 'text report persisted');
  }

  const voice = (await request('POST', '/sessions', { question_id: 'incident-triage-checkout', minutes: 5, mode: 'voice', funding: 'platform', config })).data;
  live = await open(voice.id);
  const ready = await live.wait(m => m.type === 'ready');
  assert.equal(ready.mode, 'voice');
  await live.audio();
  const answer = 'I would first stabilize checkout by confirming customer impact, then identify a safe rollback owner. I would compare the first elevated timeout with the release timestamp, inspect dependency latency and current error rate, and avoid a speculative multi-service change. We should define success before rollback, monitor payment outcomes, and communicate the impact and next update time.';
  event = randomUUID();
  live.send({ type: 'user_text', text: answer, event_id: event });
  await live.wait(m => m.type === 'ack' && m.event_id === event);
  await live.wait(m => m.type === 'turn_complete');
  observations.voice.beforeReconnect = live.messages.filter(m => m.type === 'transcript' && !m.streaming).map(m => ({ role: m.role, text: m.text }));
  observations.voice.interruptedEvent = live.messages.some(m => m.type === 'interrupted');
  observations.voice.audioPackets = live.audioPackets;
  observations.voice.audioBytes = live.audioBytes;
  await live.close();
  live = await open(voice.id);
  const resumed = await live.wait(m => m.type === 'ready');
  assert.equal(resumed.deadline_at, ready.deadline_at, 'Reconnect reset deadline');
  await delay(1200);
  observations.voice.unsolicitedReconnectAudioPackets = live.audioPackets;
  assert.equal(live.audioPackets, 0, 'Reconnect spoke before the waiting candidate answered');
  const finalVoice = 'My final correction is that I should not roll back simply because the deployment happened nearby in time. I will first confirm the correlation with the timeout configuration and the known rollback procedure, ask the incident owner to approve it, record the exact action, and verify checkout and payment success afterward. If the evidence does not fit, I will keep the mitigation reversible and state what remains unknown instead of claiming a root cause.';
  event = randomUUID();
  live.send({ type: 'user_text', text: finalVoice, event_id: event });
  await live.wait(m => m.type === 'ack' && m.event_id === event);
  await live.audio();
  await live.wait(m => m.type === 'turn_complete');
  observations.voice.reconnectedInterviewer = live.messages.filter(m => m.type === 'transcript' && m.role === 'interviewer' && !m.streaming).map(m => m.text);
  await live.close(true);
  const voiceReport = await report(voice.id);
  const transcript = (await request('GET', `/sessions/${voice.id}/transcript`)).data;
  const turns = Array.isArray(transcript) ? transcript : transcript.turns;
  assert.equal(turns.filter(t => t.text === finalVoice).length, 1, 'Final acknowledged voice-mode answer missing or duplicated');
  observations.voice.report = { scored: voiceReport.scored, overall: voiceReport.overall, scores: voiceReport.scores, radar: voiceReport.radar };
  observations.checks.push('native audio packets and transcription', 'typed barge-in attempted', 'native reconnect preserves deadline', 'final acknowledged answer preserved', 'voice report persisted');
  console.log(JSON.stringify({ result: 'passed', synthetic_data_only: true, ...observations }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: 'failed', error: error.message, ...observations }, null, 2));
  process.exitCode = 1;
} finally {
  if (socket && socket.readyState < 2) socket.close();
  if (token) { try { await request('DELETE', '/account', undefined, [204]); } catch { console.error('Synthetic account cleanup failed; remove isolated test schema.'); } }
}
