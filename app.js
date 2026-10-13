const navItems = [
  { id:'home', label:'Protection', icon:'home' },
  { id:'calls', label:'Calls', icon:'phone' },
  { id:'security', label:'Security', icon:'lock' },
  { id:'alerts', label:'Alerts', icon:'bell' },
  { id:'privacy', label:'Privacy', icon:'user' }
];

const state = {
  page:'home', profiles:[], currentAudio:null, enrollmentSamples:[],
  session:null, challenge:null, modalScenario:'tts', modalResult:null, modalAudio:null,
  room:null, pc:null, ws:null, local:null, remote:null, peer:null, meterContext:null,
  pendingIce:[], callTrace:[]
};

const content = document.querySelector('#content');
const modalRoot = document.querySelector('#modalRoot');
const title = document.querySelector('#pageTitle');
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

function icon(name){ return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function escapeHtml(v=''){ return String(v).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function riskPill(label='INCONCLUSIVE'){
  const c=String(label).toLowerCase().replaceAll(' ','-');
  return `<span class="risk-pill ${c}">${escapeHtml(label)}</span>`;
}
function money(n){ return '₹'+Number(n||0).toLocaleString('en-IN'); }
function sensitivity(amount){ amount=+amount||0; return amount>=5000000?'CRITICAL':amount>=1000000?'HIGH':amount>=100000?'MODERATE':'LOW'; }
function randomId(){ return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0,12); }

async function api(path, options={}){
  const r=await fetch(path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  let body={}; try{ body=await r.json(); }catch{}
  if(!r.ok){
    const d=body.detail;
    const msg=typeof d==='string'?d:(d?.message||body.message||JSON.stringify(d||body));
    throw new Error(msg);
  }
  return body;
}

function toast(message){
  const t=document.createElement('div'); t.className='toast'; t.textContent=message;
  document.querySelector('#toastRegion').append(t); setTimeout(()=>t.remove(),2800);
}

function renderNav(){
  const html=navItems.map(n=>`<button class="nav-btn ${state.page===n.id?'active':''}" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></button>`).join('');
  $('#desktopNav').innerHTML=html; $('#bottomNav').innerHTML=html;
  $$('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));
}

async function loadProfiles(){ state.profiles=await api('/api/profiles'); return state.profiles; }
function profileOptions(){ return state.profiles.length ? state.profiles.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.role)}</option>`).join('') : '<option value="">No enrolled profiles</option>'; }

async function navigate(page){
  state.page=page; renderNav(); title.textContent=navItems.find(n=>n.id===page)?.label||'VISH';
  try{
    if(page==='home') await renderHome();
    if(page==='calls') await renderCalls();
    if(page==='security') await renderSecurity();
    if(page==='alerts') await renderAlerts();
    if(page==='privacy') await renderPrivacy();
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){
    content.innerHTML=`<article class="card page-card"><p class="eyebrow">CONNECTION ERROR</p><h3>VISH backend is not available</h3><p class="subtle">${escapeHtml(e.message)}</p><button class="btn btn-primary" id="retryPage">Retry</button></article>`;
    $('#retryPage').onclick=()=>navigate(page);
  }
}

async function renderHome(){
  const [caps,auditRows]=await Promise.all([api('/api/capabilities'),api('/api/audit-ui?limit=6')]);
  content.innerHTML=$('#homeTemplate').innerHTML;
  const mini=$$('.mini-card');
  if(mini[0]) mini[0].querySelector('small').textContent='Native Android integration required';
  if(mini[2]) mini[2].querySelector('small').textContent='OS capability dependent';
  const recent=auditRows.find(r=>r.event_type==='VOICE_ANALYZED'||r.event_type==='CHALLENGE_VERIFIED');
  if(recent){
    const card=$('.dashboard-card');
    const risk=recent.risk||'INCONCLUSIVE';
    card.querySelector('.risk-pill').outerHTML=riskPill(risk);
    card.querySelector('.section-head h3').textContent='Latest real prototype event';
    card.querySelector('.explain-strip span').textContent='This panel is connected to the working backend audit trail. Voice similarity is evidence only—not identity confirmation.';
  }
  $('.hero-actions [data-action="start-call"]').onclick=()=>navigate('calls');
  $('.hero-actions [data-action="open-lab"]').onclick=()=>openLab('tts');
  $('.text-button[data-nav="calls"]').onclick=()=>navigate('calls');
  $('.orb-core span').textContent=caps.api_keys_required?'API configuration required':'Zero paid API keys';
}

async function renderCalls(){
  await loadProfiles();
  const audit=await api('/api/audit-ui?limit=30');
  const analyzed=audit.filter(r=>['VOICE_ANALYZED','CHALLENGE_VERIFIED','CONTROLLED_SIMULATOR_ANALYZED'].includes(r.event_type)).slice(0,6);
  if(!state.room) state.room=Math.random().toString(36).slice(2,7).toUpperCase();
  content.innerHTML=`
  <section class="page-grid">
    <div class="stack">
      <article class="card page-card premium-call-panel">
        <div class="section-head"><div><p class="eyebrow">VISH PROTECTED CHANNEL</p><h3>Secure WebRTC voice room</h3></div><span class="tag good">REAL P2P AUDIO</span></div>
        <div class="protected-call-note"><strong>This does not attach to an ordinary SIM / WhatsApp call.</strong><span>Both participants must open VISH and join the same protected room. On this desktop, use “Open second test participant” to verify the call path immediately.</span></div>
        <div class="form-grid two mt16"><label>Room code<input id="roomCode" class="input code" value="${state.room}" maxlength="16"></label><label>Analyze remote as<select id="callProfile" class="input">${profileOptions()}</select></label></div>
        <div class="console-actions mt16"><button class="btn btn-primary" id="joinCall">${icon('phone')} Join protected call</button><button class="btn btn-secondary" id="openPeer">Open second test participant</button><button class="btn btn-ghost" id="copyRoom">Copy room link</button><button class="btn btn-danger" id="leaveCall" disabled>Leave call</button></div>
        <div class="call-status-card" id="callStatus"><span class="pulse-dot"></span><div><strong>Disconnected</strong><small>Join when ready</small></div></div>
        <div class="call-diagnostics" id="callDiagnostics"><span>MIC · waiting</span><span>SIGNAL · waiting</span><span>PEER · waiting</span><span>ICE · waiting</span></div>
        <audio id="remoteAudio" autoplay controls class="audio-player"></audio><div class="live-meter"><i id="liveMeter"></i></div>
      </article>

      <article class="card page-card">
        <div class="section-head"><div><p class="eyebrow">LIVE TRUST CHECK</p><h3>Analyze protected-call audio</h3></div><span class="tag">MICROPHONE</span></div>
        <div class="form-grid two"><label>Enrolled identity<select id="liveProfile" class="input">${profileOptions()}</select></label><label>Requested amount (₹)<input id="liveAmount" class="input" type="number" value="2500000"></label></div>
        <div class="record-zone"><button class="record-button" id="liveMic">${icon('wave')}</button><div><strong id="liveRecTitle">Capture 4–6 seconds</strong><span id="liveRecText">Real microphone audio is sent to the local VISH backend for analysis.</span></div></div>
        <div class="console-actions"><button class="btn btn-primary" id="analyzeLive">Analyze captured voice</button><button class="btn btn-secondary" id="loadGenuine">Load deterministic genuine demo</button><button class="btn btn-ghost" id="analyzeRemote" disabled>Analyze remote stream 5s</button></div>
        <div id="liveResult"></div>
      </article>

      <article class="card page-card">
        <div class="section-head"><div><p class="eyebrow">VERIFICATION HISTORY</p><h3>Recent trust decisions</h3></div><button class="text-button" id="refreshHistory">Refresh</button></div>
        ${analyzed.length?analyzed.map(r=>historyCard(r)).join(''):'<div class="empty-premium">No voice decisions yet. Run a live check or attack demo.</div>'}
      </article>
    </div>

    <div class="stack">
      <article class="card page-card"><p class="eyebrow">CALL TYPE TRUTHFULNESS</p><h3>What VISH can actually analyze</h3><div class="capability-table">
        <div class="cap-row"><div><strong>VISH Protected WebRTC</strong><p>Full audio stream under VISH control.</p></div><span class="tag good">AVAILABLE</span></div>
        <div class="cap-row"><div><strong>Browser microphone</strong><p>Real capture after user permission.</p></div><span class="tag good">AVAILABLE</span></div>
        <div class="cap-row"><div><strong>Ordinary SIM-call audio</strong><p>Not exposed to a normal browser/third-party app.</p></div><span class="tag warn">RESTRICTED</span></div>
        <div class="cap-row"><div><strong>Background persistence</strong><p>Native Android foreground service required for guaranteed operation.</p></div><span class="tag warn">NATIVE ONLY</span></div>
      </div></article>
      <article class="card page-card"><p class="eyebrow">PROTECTED CALL RULE</p><h3>Audio is never secretly captured</h3><p class="subtle">This prototype only records after an explicit microphone action or during a VISH-controlled WebRTC session. If the platform cannot expose call audio, VISH reports that limitation instead of inventing a result.</p></article>
      <article class="card page-card"><p class="eyebrow">QUICK DEMO</p><h3>Need a guaranteed SIH presentation flow?</h3><p class="subtle">The deterministic demo fixtures exercise the same backend risk pipeline even if a venue browser blocks microphone access.</p><button class="btn btn-secondary" id="openAttackLab">${icon('flask')} Open attack lab</button></article>
    </div>
  </section>`;
  $('#liveMic').onclick=()=>recordInto('live');
  $('#loadGenuine').onclick=async()=>{const d=await api('/api/demo/audio/human');state.currentAudio=d.audio_b64;$('#liveRecTitle').textContent='Genuine demo loaded';$('#liveRecText').textContent='Deterministic local demo fixture ready.';toast('Genuine demo audio loaded');};
  $('#analyzeLive').onclick=analyzeLive;
  $('#joinCall').onclick=joinProtectedCall; $('#leaveCall').onclick=leaveProtectedCall; $('#analyzeRemote').onclick=analyzeRemoteStream;
  $('#openPeer').onclick=openSecondParticipant; $('#copyRoom').onclick=copyRoomLink;
  $('#refreshHistory').onclick=()=>renderCalls(); $('#openAttackLab').onclick=()=>openLab('tts');
}

function historyCard(r){
  const t=new Date(r.created_at).toLocaleString();
  const detail=r.detail||{}; const risk=r.risk||detail.final_risk||'INCONCLUSIVE';
  const reason=(detail.reason_codes||[]).slice(0,2).join(' · ')||r.event_type.replaceAll('_',' ');
  return `<div class="call-card compact"><div class="call-avatar">VI</div><div><h4>${escapeHtml(detail.claimed_identity?.name||'VISH session')}</h4><p>${escapeHtml(reason)} · ${escapeHtml(t)}</p><div class="call-meta"><span class="tag">${escapeHtml(r.event_type.replaceAll('_',' '))}</span></div></div>${riskPill(risk)}</div>`;
}

function encodeWav16k(samples,inputRate){
  const targetRate=16000;
  let out;
  if(inputRate===targetRate){out=samples;}else{
    const ratio=inputRate/targetRate, n=Math.max(1,Math.floor(samples.length/ratio)); out=new Float32Array(n);
    for(let i=0;i<n;i++){
      const a=Math.floor(i*ratio), b=Math.min(samples.length,Math.floor((i+1)*ratio)); let sum=0;
      for(let j=a;j<b;j++)sum+=samples[j]; out[i]=sum/Math.max(1,b-a);
    }
  }
  const buf=new ArrayBuffer(44+out.length*2),v=new DataView(buf);
  const write=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i))};
  write(0,'RIFF');v.setUint32(4,36+out.length*2,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,targetRate,true);v.setUint32(28,targetRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,out.length*2,true);
  let o=44;for(let i=0;i<out.length;i++,o+=2){const x=Math.max(-1,Math.min(1,out[i]));v.setInt16(o,x<0?x*32768:x*32767,true)}
  return new Blob([buf],{type:'audio/wav'});
}
async function recordBlob(seconds=5, sourceStream=null, onState=()=>{}){
  let stream=sourceStream, own=false;
  if(!stream){stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});own=true;}
  const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)throw new Error('Web Audio API is unavailable in this browser.');
  const ctx=new Ctx();await ctx.resume();const src=ctx.createMediaStreamSource(stream);const proc=ctx.createScriptProcessor(4096,1,1);const mute=ctx.createGain();mute.gain.value=0;
  const chunks=[];proc.onaudioprocess=e=>chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));src.connect(proc);proc.connect(mute);mute.connect(ctx.destination);onState(true,proc);
  await new Promise(res=>setTimeout(res,seconds*1000));onState(false,proc);try{src.disconnect();proc.disconnect();mute.disconnect()}catch{}if(own)stream.getTracks().forEach(t=>t.stop());
  const total=chunks.reduce((n,a)=>n+a.length,0),merged=new Float32Array(total);let off=0;for(const a of chunks){merged.set(a,off);off+=a.length}const rate=ctx.sampleRate;await ctx.close();
  if(!merged.length)throw new Error('No audio samples were captured.');return encodeWav16k(merged,rate);
}
function blob64(blob){ return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)}); }

async function recordInto(mode){
  const btn=mode==='live'?$('#liveMic'):null, titleEl=mode==='live'?$('#liveRecTitle'):null, textEl=mode==='live'?$('#liveRecText'):null;
  try{
    const blob=await recordBlob(5,null,(live)=>{if(btn)btn.classList.toggle('recording',live);if(titleEl)titleEl.textContent=live?'Recording…':'Capture complete';if(textEl)textEl.textContent=live?'Speak naturally. Recording stops automatically.':'Processing recording…';});
    state.currentAudio=await blob64(blob); if(titleEl)titleEl.textContent='Recording ready'; if(textEl)textEl.textContent='Captured audio is ready for VISH analysis.'; toast('Voice sample captured');
  }catch(e){toast('Microphone unavailable: '+e.message);}
}

async function analyzeLive(){
  try{
    if(!state.currentAudio) throw new Error('Capture or load a voice sample first.');
    const profile=$('#liveProfile').value; if(!profile) throw new Error('Enroll or select a trusted profile first.');
    const amount=+$('#liveAmount').value||0;
    const out=await api('/api/analyze',{method:'POST',body:JSON.stringify({audio_b64:state.currentAudio,profile_id:profile,sensitivity:sensitivity(amount),action:'Protected voice interaction',amount})});
    state.session=out.session_id; $('#liveResult').innerHTML=renderAnalysisResult(out,'live'); bindResultActions($('#liveResult'),out);
  }catch(e){toast(e.message);}
}

function renderAnalysisResult(r,scope='modal'){
  const reasons=[...(r.reason_codes||[]),...(r.passive_reasons||[])].filter((x,i,a)=>a.indexOf(x)===i);
  return `<div class="decision-box premium-result ${String(r.final_risk).toLowerCase()}">
    <div class="decision-line"><div><p class="eyebrow">FINAL WORKFLOW RISK</p><strong class="risk-title">${escapeHtml(r.final_risk)}</strong></div>${riskPill(r.final_risk)}</div>
    <div class="evidence-grid result-metrics">
      <div class="evidence-tile"><span>Speaker similarity</span><strong>${Number(r.speaker_similarity||0).toFixed(1)}%</strong><small>Similarity ≠ identity</small></div>
      <div class="evidence-tile"><span>Passive spoof evidence</span><strong>${escapeHtml(r.passive_spoof_evidence||'—')}</strong><small>Prototype DSP evidence</small></div>
      <div class="evidence-tile"><span>Audio quality</span><strong>${escapeHtml(r.audio_quality||'—')}</strong><small>${Number(r.audio_quality_score||0).toFixed(0)} / 100</small></div>
      <div class="evidence-tile"><span>Transaction sensitivity</span><strong>${escapeHtml(r.sensitivity||'—')}</strong><small>${money(r.amount)}</small></div>
    </div>
    <p>${escapeHtml(r.recommended_action||'')}</p>
    <div class="reason-list">${reasons.map(x=>`<span class="tag ${r.final_risk==='LOW'?'good':r.final_risk==='INCONCLUSIVE'?'warn':'danger'}">${escapeHtml(x)}</span>`).join('')}</div>
    <p class="subtle tiny">${escapeHtml(r.anti_spoof_model||'')}</p>
    <div class="console-actions">${r.challenge_recommended?`<button class="btn btn-primary" data-result-challenge="${scope}">Run fresh VISH handshake</button>`:''}${['HIGH','CRITICAL'].includes(r.final_risk)?`<button class="btn btn-danger" data-result-approval="${scope}">Independent verification</button>`:''}</div>
  </div><div data-challenge-area="${scope}"></div>`;
}
function bindResultActions(root,r){
  const c=$('[data-result-challenge]',root); if(c)c.onclick=()=>startChallenge(r.session_id,c.dataset.resultChallenge);
  const a=$('[data-result-approval]',root); if(a)a.onclick=()=>createApproval(r.session_id);
}

async function startChallenge(sessionId,scope='live'){
  try{
    const ch=await api('/api/challenge/new?session_id='+encodeURIComponent(sessionId),{method:'POST'}); state.challenge=ch; state.session=sessionId;
    const area=document.querySelector(`[data-challenge-area="${scope}"]`); if(!area)return;
    area.innerHTML=`<div class="challenge-card working-challenge"><p>FRESH VISH CHALLENGE · SESSION-BOUND · 90 SECONDS</p><div class="challenge-text">${escapeHtml(ch.prompt)}</div><p>Record the caller saying the fresh number sequence. One ordinary mistake is retryable and is never automatically treated as fraud.</p><div class="record-zone small-zone"><button class="record-button" id="challengeMic-${scope}">${icon('wave')}</button><div><strong id="challengeTitle-${scope}">Record challenge response</strong><span id="challengeText-${scope}">Use the fresh phrase above.</span></div></div><label class="field-label">Recognized / entered digits<input class="input" id="challengeTranscript-${scope}" placeholder="${escapeHtml(ch.expected)}"></label><div class="console-actions"><button class="btn btn-primary" id="verifyChallenge-${scope}">Verify response</button><button class="btn btn-secondary" id="fillChallenge-${scope}">Use expected digits</button><button class="btn btn-ghost" id="suspiciousChallenge-${scope}">Simulate suspicious response</button></div><div id="challengeFinal-${scope}"></div></div>`;
    let responseAudio=null, latency=1200;
    $(`#challengeMic-${scope}`).onclick=async()=>{
      const start=performance.now(); try{const blob=await recordBlob(5,null,(live)=>{$(`#challengeMic-${scope}`).classList.toggle('recording',live);$(`#challengeTitle-${scope}`).textContent=live?'Recording challenge…':'Challenge captured';});responseAudio=await blob64(blob);latency=Math.round(performance.now()-start);$(`#challengeText-${scope}`).textContent='Challenge audio ready.';}catch(e){toast(e.message)}
    };
    $(`#fillChallenge-${scope}`).onclick=()=>{$(`#challengeTranscript-${scope}`).value=ch.expected;};
    $(`#suspiciousChallenge-${scope}`).onclick=async()=>{const d=await api('/api/demo/audio/tts');responseAudio=d.audio_b64;latency=8000;$(`#challengeTranscript-${scope}`).value='9999';$(`#challengeText-${scope}`).textContent='Controlled suspicious response loaded.';};
    $(`#verifyChallenge-${scope}`).onclick=async()=>{
      try{
        if(!responseAudio){const d=await api('/api/demo/audio/human');responseAudio=d.audio_b64;toast('No recording found; using local deterministic demo response.');}
        const out=await api('/api/challenge/verify',{method:'POST',body:JSON.stringify({challenge_id:ch.challenge_id,audio_b64:responseAudio,transcript:$(`#challengeTranscript-${scope}`).value,response_latency_ms:latency})});
        state.session=sessionId; $(`#challengeFinal-${scope}`).innerHTML=renderChallengeFinal(out); const a=$('[data-create-approval]',$(`#challengeFinal-${scope}`));if(a)a.onclick=()=>createApproval(sessionId);
      }catch(e){toast(e.message)}
    };
  }catch(e){toast(e.message)}
}
function renderChallengeFinal(r){return `<div class="verification-sheet"><div class="decision-line"><strong>Challenge: ${escapeHtml(r.challenge_status||'—')}</strong>${riskPill(r.final_risk)}</div><p>${escapeHtml(r.recommended_action||'')}</p><div class="reason-list">${(r.reason_codes||[]).map(x=>`<span class="tag ${r.final_risk==='LOW'?'good':'danger'}">${escapeHtml(x)}</span>`).join('')}</div>${['HIGH','CRITICAL'].includes(r.final_risk)?'<div class="console-actions"><button class="btn btn-danger" data-create-approval>Request independent verification</button></div>':''}</div>`;}

async function createApproval(sessionId){
  try{
    await api('/api/approvals',{method:'POST',body:JSON.stringify({session_id:sessionId,title:'VISH high-risk voice verification',details:'A high-risk protected voice workflow requires confirmation from a separately trusted device/account. Did you initiate this action?'})});
    toast('Independent verification request created'); closeModal(); navigate('alerts');
  }catch(e){toast(e.message)}
}

async function renderSecurity(){
  await loadProfiles(); const caps=await api('/api/capabilities');
  content.innerHTML=`<section class="page-grid"><div class="stack">
    <article class="card page-card"><div class="section-head"><div><p class="eyebrow">TRUSTED VOICE ENROLLMENT</p><h3>Create protected profile</h3></div><span class="tag good">3 SAMPLES REQUIRED</span></div>
      <p class="subtle">Voice alone cannot authorize enrollment. This demo requires explicit consent, three natural samples, and the organizational approval code.</p>
      <div class="form-grid two"><label>Name<input class="input" id="enrollName" placeholder="Ananya Rao"></label><label>Authorized role<input class="input" id="enrollRole" placeholder="CFO"></label><label class="span-two">Organizational approval code<input class="input code" id="approvalCode" value="VISH-DEMO-ADMIN"></label></div>
      <div class="sample-grid">${[0,1,2].map(i=>`<div class="sample-card" id="sampleCard${i}"><span>Sample ${i+1}</span><strong id="sampleStatus${i}">Not recorded</strong><button class="btn btn-secondary" data-record-sample="${i}">${icon('wave')} Record 5s</button></div>`).join('')}</div>
      <label class="consent-line"><input type="checkbox" id="enrollConsent" checked> I explicitly consent to creating a protected voice template for this prototype.</label>
      <div class="console-actions"><button class="btn btn-primary" id="saveEnrollment">Create trusted profile</button><button class="btn btn-secondary" id="loadDemoSamples">Load 3 deterministic demo samples</button></div>
      <div class="explain-strip">${icon('info')}<span>Raw enrollment recordings are processed to a local feature template and are not stored in the database.</span></div>
    </article>
    <article class="card page-card"><div class="section-head"><div><p class="eyebrow">PROTECTED PROFILES</p><h3>Known identities</h3></div><span class="tag good">${state.profiles.length} ACTIVE</span></div>${state.profiles.length?state.profiles.map(profileRow).join(''):'<div class="empty-premium">No profiles yet. Create one above.</div>'}</article>
  </div><div class="stack">
    <article class="card page-card"><p class="eyebrow">PLATFORM CAPABILITY CHECK</p><h3>This prototype</h3><div class="capability-table"><div class="cap-row"><div><strong>Protected voice channel</strong><p>WebRTC / controlled stream</p></div><span class="tag good">AVAILABLE</span></div><div class="cap-row"><div><strong>Microphone analysis</strong><p>Permission-bound browser capture</p></div><span class="tag good">AVAILABLE</span></div><div class="cap-row"><div><strong>Cellular voice analysis</strong><p>Requires native/OEM enterprise integration</p></div><span class="tag warn">RESTRICTED</span></div><div class="cap-row"><div><strong>External API keys</strong><p>Core engine runs locally</p></div><span class="tag good">${caps.api_keys_required?'REQUIRED':'NONE'}</span></div></div></article>
    <article class="card page-card"><p class="eyebrow">PROTOTYPE SECURITY POLICY</p><h3>Adaptive verification</h3><div class="policy-grid"><div class="policy-tile"><strong>LOW sensitivity</strong><p>Passive screening; no needless challenge.</p></div><div class="policy-tile"><strong>MODERATE</strong><p>Step up only if evidence is weak.</p></div><div class="policy-tile"><strong>HIGH</strong><p>Fresh VISH challenge when justified.</p></div><div class="policy-tile"><strong>CRITICAL</strong><p>Active check + independent human confirmation.</p></div></div></article>
  </div></section>`;
  $$('[data-record-sample]').forEach(b=>b.onclick=()=>captureEnrollmentSample(+b.dataset.recordSample));
  $('#loadDemoSamples').onclick=loadDemoEnrollmentSamples; $('#saveEnrollment').onclick=saveEnrollment;
  $$('[data-delete-profile]').forEach(b=>b.onclick=()=>deleteProfile(b.dataset.deleteProfile));
}
function profileRow(p){return `<div class="list-row"><div class="row-left"><div class="profile-badge">${escapeHtml(p.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase())}</div><div class="row-copy"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.role)} · template quality ${Math.round(p.quality)}%</span></div></div><div class="row-actions"><span class="tag good">ACTIVE</span><button class="icon-button tiny-button" data-delete-profile="${p.id}" title="Delete profile">×</button></div></div>`;}
async function captureEnrollmentSample(i){
  const btn=$(`[data-record-sample="${i}"]`); try{const blob=await recordBlob(5,null,live=>{btn.classList.toggle('recording-btn',live);btn.textContent=live?'Recording…':'Recorded';});state.enrollmentSamples[i]=await blob64(blob);$(`#sampleCard${i}`).classList.add('ready');$(`#sampleStatus${i}`).textContent='Ready';toast(`Sample ${i+1} captured`);}catch(e){toast('Microphone unavailable: '+e.message)}
}
async function loadDemoEnrollmentSamples(){
  const d=await api('/api/demo/audio/human'); state.enrollmentSamples=[d.audio_b64,d.audio_b64,d.audio_b64];
  [0,1,2].forEach(i=>{$(`#sampleCard${i}`).classList.add('ready');$(`#sampleStatus${i}`).textContent='Demo ready';});
  $('#enrollName').value='Ananya Rao';$('#enrollRole').value='CFO';toast('Three demo enrollment samples loaded');
}
async function saveEnrollment(){
  try{
    if(state.enrollmentSamples.filter(Boolean).length<3)throw new Error('Record all three enrollment samples.');
    const body={name:$('#enrollName').value.trim(),role:$('#enrollRole').value.trim(),consent:$('#enrollConsent').checked,approval_code:$('#approvalCode').value.trim(),audio_samples_b64:state.enrollmentSamples.filter(Boolean)};
    const r=await api('/api/enroll',{method:'POST',body:JSON.stringify(body)}); state.enrollmentSamples=[]; toast(`${r.name} enrolled using ${r.sample_count} samples`); await renderSecurity();
  }catch(e){toast(e.message)}
}
async function deleteProfile(id){if(confirm('Delete this protected voice profile?')){try{await api('/api/profiles/'+encodeURIComponent(id),{method:'DELETE'});toast('Profile deleted');renderSecurity()}catch(e){toast(e.message)}}}

async function renderAlerts(){
  const [approvals,audit]=await Promise.all([api('/api/approvals'),api('/api/audit-ui?limit=40')]);
  const critical=audit.filter(r=>(r.risk==='CRITICAL'||r.detail?.final_risk==='CRITICAL')).slice(0,4);
  content.innerHTML=`<section class="page-grid"><div class="stack">
    <article class="card page-card"><div class="section-head"><div><p class="eyebrow">INDEPENDENT VERIFICATION</p><h3>Trusted-device approvals</h3></div><span class="tag ${approvals.some(a=>a.status==='PENDING')?'warn':'good'}">${approvals.filter(a=>a.status==='PENDING').length} PENDING</span></div>
    ${approvals.length?approvals.map(approvalCard).join(''):'<div class="empty-premium">No verification requests. Run a high-risk attack demo to create one.</div>'}</article>
    ${critical.length?critical.map(r=>`<article class="card alert-card"><div class="section-head"><div><p class="eyebrow">CRITICAL · ${new Date(r.created_at).toLocaleString()}</p><h4>Voice authenticity could not be sufficiently verified</h4></div>${riskPill('CRITICAL')}</div><p>${escapeHtml((r.detail?.reason_codes||['Multiple independent suspicious signals']).join(' · '))}</p><div class="reason-codes">${(r.detail?.reason_codes||[]).map(x=>`<span class="tag danger">${escapeHtml(x)}</span>`).join('')}</div></article>`).join(''):''}
  </div><div class="stack"><article class="card page-card"><p class="eyebrow">ALERT PHILOSOPHY</p><h3>Evidence, not emotion</h3><p class="subtle">Urgency, accent, anger, slang, profanity, nervousness, or language switching are not fraud signals. VISH evaluates security evidence instead of personality.</p></article><article class="card page-card"><p class="eyebrow">ESCALATION</p><h3>Human stays in control</h3><p class="subtle">For critical cases, VISH holds the workflow and requests confirmation through a separately trusted device/account—not the incoming caller number.</p><button class="btn btn-secondary" id="openAlertDemo">Run high-risk demo</button></article></div></section>`;
  $$('[data-approval-decision]').forEach(b=>b.onclick=()=>respondApproval(b.dataset.approvalToken,b.dataset.approvalDecision));
  $('#openAlertDemo').onclick=()=>openLab('tts');
}
function approvalCard(a){return `<div class="verification-sheet approval-premium"><div class="decision-line"><div><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.details)}</p></div>${riskPill(a.status==='PENDING'?'HIGH':a.status==='APPROVED'?'LOW':'CRITICAL')}</div><small>${new Date(a.created_at*1000).toLocaleString()}</small>${a.status==='PENDING'?`<div class="console-actions"><button class="btn btn-primary" data-approval-token="${a.token}" data-approval-decision="YES">YES — I initiated it</button><button class="btn btn-danger" data-approval-token="${a.token}" data-approval-decision="NO">NO — I did not</button></div>`:`<div class="reason-list"><span class="tag ${a.status==='APPROVED'?'good':'danger'}">${escapeHtml(a.status)}</span></div>`}</div>`;}
async function respondApproval(token,decision){try{const r=await api('/api/approvals/'+token+'/respond',{method:'POST',body:JSON.stringify({decision})});toast(`Independent verification ${r.status}`);renderAlerts()}catch(e){toast(e.message)}}

async function renderPrivacy(){
  const [audit,verify]=await Promise.all([api('/api/audit-ui?limit=60'),api('/api/audit/verify')]);
  content.innerHTML=`<section class="page-grid"><div class="stack"><article class="card page-card"><div class="section-head"><div><p class="eyebrow">PRIVACY BY DESIGN</p><h3>Data controls</h3></div><span class="tag good">RAW AUDIO OFF</span></div><div class="list-row"><div class="row-left"><div class="round-icon">${icon('lock')}</div><div class="row-copy"><strong>Raw audio retention</strong><span>Processed transiently; not stored by the prototype database.</span></div></div><span class="tag good">DISABLED</span></div><div class="list-row"><div class="row-left"><div class="round-icon">${icon('shield')}</div><div class="row-copy"><strong>Voice template</strong><span>Local spectral feature vector only.</span></div></div><span class="tag good">PROTECTED</span></div><div class="list-row"><div class="row-left"><div class="round-icon">${icon('check')}</div><div class="row-copy"><strong>Tamper-evident audit chain</strong><span>SHA-256 hash chain across audit events.</span></div></div><span class="tag ${verify.valid?'good':'danger'}">${verify.valid?'VALID':'BROKEN'}</span></div><div class="console-actions"><button class="btn btn-secondary" id="exportData">Export security metadata</button><button class="btn btn-danger" id="wipeData">Delete all local data</button></div></article>
  <article class="card page-card"><p class="eyebrow">AUDIT INTEGRITY</p><h3>${verify.events_checked} events verified</h3><p class="subtle code-wrap">Head hash: ${escapeHtml(verify.head_hash||'GENESIS')}</p></article></div>
  <div class="stack"><article class="card page-card"><div class="section-head"><div><p class="eyebrow">SECURITY AUDIT TRAIL</p><h3>Recent events</h3></div><button class="text-button" id="refreshAudit">Refresh</button></div><div class="audit-scroll">${audit.length?audit.map(r=>`<div class="audit-row"><div><strong>${escapeHtml(r.event_type.replaceAll('_',' '))}</strong><span>${new Date(r.created_at).toLocaleString()}</span></div><div>${r.risk?riskPill(r.risk):'<span class="tag">AUDIT</span>'}</div></div>`).join(''):'<div class="empty-premium">No audit events yet.</div>'}</div></article></div></section>`;
  $('#refreshAudit').onclick=()=>renderPrivacy();
  $('#exportData').onclick=exportPrivacy; $('#wipeData').onclick=wipePrivacy;
}
async function exportPrivacy(){try{const d=await api('/api/privacy/export');const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vish-security-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Security metadata export created')}catch(e){toast(e.message)}}
async function wipePrivacy(){if(!confirm('Delete all local VISH prototype profiles, sessions, approvals and audit events?'))return;try{await api('/api/privacy/delete-all',{method:'DELETE'});state.profiles=[];state.enrollmentSamples=[];state.currentAudio=null;toast('All local prototype data deleted');renderPrivacy()}catch(e){toast(e.message)}}

function openLab(selected='tts'){
  state.modalScenario=selected; state.modalResult=null; state.challenge=null; state.modalAudio=null;
  modalRoot.className='modal-root active'; modalRoot.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="VISH attack lab"><div class="modal-head"><div><p class="eyebrow">SIH INTERACTIVE PROTOTYPE <span class="demo-label">REAL BACKEND PIPELINE</span></p><h2>Protected call · Voice trust decision</h2></div><button class="close-btn" id="closeModal" aria-label="Close">×</button></div><div class="modal-body" id="labBody"></div></div>`;
  $('#closeModal').onclick=closeModal; renderLab();
}
function closeModal(){modalRoot.className='modal-root';modalRoot.innerHTML='';}
async function renderLab(){
  const names={human:['Genuine CFO','Natural controlled human-like fixture.'],tts:['AI synthetic voice','Controlled TTS-like fixture.'],replay:['Replay recording','Controlled replay/re-recording fixture.'],conversion:['Voice conversion','Controlled voice-conversion-style fixture.'],poor:['Poor audio','Insufficient evidence; system should abstain.']};
  const body=$('#labBody'); if(!body)return;
  body.innerHTML=`<p class="subtle">These deterministic cases exercise the working backend. They are known-ground-truth demo fixtures, not claims of validated real-world detection accuracy.</p><div class="scenario-grid">${Object.entries(names).map(([k,v])=>`<button class="scenario ${k===state.modalScenario?'active':''}" data-scenario="${k}"><strong>${v[0]}</strong><span>${v[1]}</span></button>`).join('')}</div><div class="call-console"><div class="caller-panel"><div class="caller-identity"><div class="call-avatar">AR</div><h3>Ananya Rao</h3><p>Claimed role · CFO</p></div><div class="waveform ${state.modalResult?'active':''}">${Array.from({length:28},(_,i)=>`<i style="height:${8+((i*13)%34)}px"></i>`).join('')}</div><div class="amount-box"><span>REQUESTED ACTION</span><strong>₹25,00,000</strong><span>Fund transfer · HIGH sensitivity</span></div><div class="console-actions"><button class="btn btn-primary" id="runScenario">${icon('flask')} Run real backend analysis</button><button class="btn btn-secondary" id="useLiveModal">${icon('wave')} Analyze my microphone instead</button></div></div><div class="evidence-panel" id="modalEvidence">${state.modalResult?renderAnalysisResult(state.modalResult,'modal'):`<div class="section-head"><div><p class="eyebrow">EVIDENCE FUSION</p><h3>Trust signals</h3></div>${riskPill('INCONCLUSIVE')}</div><div class="decision-box"><div class="decision-line"><strong>Workflow risk</strong><span class="tag">AWAITING EVIDENCE</span></div><p>VISH does not make a decision until usable evidence is available.</p></div>`}</div></div>`;
  $$('[data-scenario]',body).forEach(b=>b.onclick=()=>{state.modalScenario=b.dataset.scenario;state.modalResult=null;renderLab()});
  $('#runScenario').onclick=runDemoScenario; $('#useLiveModal').onclick=runLiveModal;
  if(state.modalResult)bindResultActions($('#modalEvidence'),state.modalResult);
}
async function runDemoScenario(){
  const btn=$('#runScenario');try{btn.disabled=true;btn.textContent='Analyzing real backend…';const r=await api(`/api/demo/run/${state.modalScenario}?sensitivity=HIGH&amount=2500000`,{method:'POST'});state.modalResult=r;state.session=r.session_id;await renderLab();toast(`${state.modalScenario} analysis complete`);}catch(e){toast(e.message);btn.disabled=false}}
async function runLiveModal(){
  try{
    await loadProfiles(); if(!state.profiles.length){toast('Enroll a trusted profile first, or use the deterministic demo.');return;}
    const blob=await recordBlob(5,null,live=>{$('#useLiveModal').textContent=live?'Recording 5s…':'Processing…'});const b64=await blob64(blob);const r=await api('/api/analyze',{method:'POST',body:JSON.stringify({audio_b64:b64,profile_id:state.profiles[0].id,sensitivity:'HIGH',action:'Fund transfer',amount:2500000})});state.modalResult=r;state.session=r.session_id;renderLab();
  }catch(e){toast(e.message);renderLab()}
}

function roomLink(){
  const room=($('#roomCode')?.value||state.room||'').trim().toUpperCase();
  const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('page','calls');u.searchParams.set('room',room);return u.toString();
}
async function copyRoomLink(){
  try{await navigator.clipboard.writeText(roomLink());toast('Protected-room link copied');}
  catch{toast(`Room code: ${($('#roomCode')?.value||state.room||'').trim().toUpperCase()}`)}
}
function openSecondParticipant(){
  const room=($('#roomCode')?.value||state.room||'').trim().toUpperCase();if(!room){toast('Enter a room code first');return;}
  const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('page','calls');u.searchParams.set('room',room);u.searchParams.set('peer','1');
  const w=window.open(u.toString(),'_blank','noopener');if(!w)toast('Popup blocked. Copy the room link and open it in another tab.');
}
function callTrace(step){
  state.callTrace.push(step);if(state.callTrace.length>8)state.callTrace.shift();
  const el=$('#callDiagnostics');if(!el)return;
  const status={mic:'waiting',signal:'waiting',peer:'waiting',ice:'waiting'};
  for(const s of state.callTrace){if(s.startsWith('MIC:'))status.mic=s.slice(4);if(s.startsWith('SIGNAL:'))status.signal=s.slice(7);if(s.startsWith('PEER:'))status.peer=s.slice(5);if(s.startsWith('ICE:'))status.ice=s.slice(4)}
  el.innerHTML=`<span>MIC · ${escapeHtml(status.mic)}</span><span>SIGNAL · ${escapeHtml(status.signal)}</span><span>PEER · ${escapeHtml(status.peer)}</span><span>ICE · ${escapeHtml(status.ice)}</span>`;
}
async function flushPendingIce(){
  if(!state.pc?.remoteDescription)return;
  const q=state.pendingIce.splice(0);for(const c of q){try{await state.pc.addIceCandidate(c)}catch(e){console.warn('VISH ICE candidate rejected',e)}}
}
async function sendOffer(target){
  if(!state.pc||!state.ws||state.ws.readyState!==WebSocket.OPEN)return;
  state.peer=target;callTrace('PEER:found');
  const offer=await state.pc.createOffer({offerToReceiveAudio:true});await state.pc.setLocalDescription(offer);
  state.ws.send(JSON.stringify({type:'offer',target,sdp:state.pc.localDescription}));setCallStatus('Connecting','Offer sent · negotiating protected audio');
}

async function joinProtectedCall(){
  try{
    const room=$('#roomCode').value.trim().toUpperCase(); if(!room)throw new Error('Enter a room code.'); state.room=room;state.pendingIce=[];state.callTrace=[];
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone capture is unavailable in this browser context. Use http://127.0.0.1:8000 on this desktop or deploy VISH over HTTPS for another physical device.');
    setCallStatus('Requesting microphone','Allow microphone access to enter the protected room');
    state.local=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});callTrace('MIC:ready');
    state.pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}],iceCandidatePoolSize:4}); state.local.getTracks().forEach(t=>state.pc.addTrack(t,state.local));
    state.pc.ontrack=async e=>{state.remote=e.streams[0]||new MediaStream([e.track]);const audio=$('#remoteAudio');audio.srcObject=state.remote;try{await audio.play()}catch{}setCallStatus('Negotiating','Remote audio track negotiated · establishing network path');startMeter(state.remote)};
    state.pc.onconnectionstatechange=()=>{const s=state.pc?.connectionState||'closed';callTrace('ICE:'+s);if(s==='connected'){setCallStatus('Connected','Protected peer-to-peer audio established');if($('#analyzeRemote')&&state.remote)$('#analyzeRemote').disabled=false;}if(['failed','disconnected'].includes(s)){setCallStatus('Connection issue',`WebRTC ${s}. Keep both VISH tabs open and try rejoining.`);if($('#analyzeRemote'))$('#analyzeRemote').disabled=true;}};
    state.pc.oniceconnectionstatechange=()=>{const s=state.pc?.iceConnectionState;if(s)callTrace('ICE:'+s)};
    const id=randomId(),proto=location.protocol==='https:'?'wss':'ws';state.ws=new WebSocket(`${proto}://${location.host}/ws/signal/${encodeURIComponent(room)}/${id}`);
    state.pc.onicecandidate=e=>{if(e.candidate&&state.peer&&state.ws?.readyState===1)state.ws.send(JSON.stringify({type:'ice',target:state.peer,candidate:e.candidate}))};
    state.ws.onopen=()=>{callTrace('SIGNAL:connected');setCallStatus('Waiting for peer',`Room ${room} · open the same VISH room in a second tab/device`)};
    state.ws.onerror=()=>{callTrace('SIGNAL:error');setCallStatus('Signaling error','Could not reach the VISH WebSocket signaling service')};
    state.ws.onclose=()=>{callTrace('SIGNAL:closed');if(state.pc&&!['closed','failed'].includes(state.pc.connectionState))setCallStatus('Signaling closed','Leave and rejoin the protected room')};
    state.ws.onmessage=async e=>{try{
      const m=JSON.parse(e.data);
      if(m.type==='room-full'){setCallStatus('Room full','This protected room already has two participants');toast('Room full. Use another room code.');leaveProtectedCall(false);return;}
      if(m.type==='error'){setCallStatus('Signaling error',m.message||'Protected signaling rejected the request');toast(m.message||'Signaling error');return;}
      if(m.type==='peer-unavailable'){setCallStatus('Peer unavailable','The other participant left before negotiation completed');callTrace('PEER:waiting');return;}
      if(m.type==='peers'){
        if(m.peers.length){state.peer=m.peers[0];callTrace('PEER:found');await sendOffer(state.peer)}else callTrace('PEER:waiting');
      }
      if(m.type==='peer-joined'){state.peer=m.peer;callTrace('PEER:found');setCallStatus('Peer joined','Waiting for protected-call offer');}
      if(m.type==='offer'){
        state.peer=m.from;callTrace('PEER:offer received');await state.pc.setRemoteDescription(new RTCSessionDescription(m.sdp));await flushPendingIce();
        const answer=await state.pc.createAnswer();await state.pc.setLocalDescription(answer);state.ws.send(JSON.stringify({type:'answer',target:m.from,sdp:state.pc.localDescription}));setCallStatus('Connecting','Answer sent · establishing protected audio');
      }
      if(m.type==='answer'){await state.pc.setRemoteDescription(new RTCSessionDescription(m.sdp));await flushPendingIce();setCallStatus('Connecting','Answer received · checking network path');}
      if(m.type==='ice'){
        const candidate=new RTCIceCandidate(m.candidate);if(state.pc.remoteDescription)try{await state.pc.addIceCandidate(candidate)}catch(e){console.warn('VISH ICE add failed',e)}else state.pendingIce.push(candidate);
      }
      if(m.type==='peer-left'){state.peer=null;state.remote=null;setCallStatus('Peer left','Waiting for another VISH participant');callTrace('PEER:waiting');$('#analyzeRemote').disabled=true;}
    }catch(err){console.error('VISH signaling handler failed',err);setCallStatus('Negotiation error',err.message||'Protected-call negotiation failed');toast('Protected-call negotiation failed: '+(err.message||err));}};
    $('#joinCall').disabled=true;$('#leaveCall').disabled=false;
  }catch(e){console.error(e);toast('Protected call could not start: '+e.message);setCallStatus('Could not join',e.message);leaveProtectedCall(false)}
}
function setCallStatus(a,b){const el=$('#callStatus');if(el)el.innerHTML=`<span class="pulse-dot"></span><div><strong>${escapeHtml(a)}</strong><small>${escapeHtml(b)}</small></div>`;}
function leaveProtectedCall(rerender=true){try{state.ws?.close();state.pc?.close();state.local?.getTracks().forEach(t=>t.stop());state.meterContext?.close()}catch{}state.ws=state.pc=state.local=state.remote=state.peer=state.meterContext=null;state.pendingIce=[];if(rerender)renderCalls();else{if($('#joinCall'))$('#joinCall').disabled=false;if($('#leaveCall'))$('#leaveCall').disabled=true;}}
function startMeter(stream){try{const ctx=new AudioContext(),src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser(),data=new Uint8Array(128);src.connect(an);an.fftSize=256;state.meterContext=ctx;(function loop(){if(!state.remote||!$('#liveMeter'))return;an.getByteFrequencyData(data);const v=data.reduce((a,b)=>a+b,0)/(data.length*255);$('#liveMeter').style.width=Math.min(100,v*220)+'%';requestAnimationFrame(loop)})();}catch{}}
async function analyzeRemoteStream(){
  try{
    if(!state.remote)throw new Error('No remote stream is connected.');const pid=$('#callProfile').value;if(!pid)throw new Error('Enroll/select a trusted profile first.');const btn=$('#analyzeRemote');btn.disabled=true;btn.textContent='Capturing remote 5s…';const blob=await recordBlob(5,state.remote);const b64=await blob64(blob);const amount=+$('#liveAmount').value||0;const out=await api('/api/analyze',{method:'POST',body:JSON.stringify({audio_b64:b64,profile_id:pid,sensitivity:sensitivity(amount),action:'Protected WebRTC call',amount})});state.session=out.session_id;$('#liveResult').innerHTML=renderAnalysisResult(out,'live');bindResultActions($('#liveResult'),out);btn.disabled=false;btn.textContent='Analyze remote stream 5s';
  }catch(e){toast(e.message);if($('#analyzeRemote')){$('#analyzeRemote').disabled=!state.remote;$('#analyzeRemote').textContent='Analyze remote stream 5s';}}
}

$('#demoLabBtn').onclick=()=>openLab('tts');
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
modalRoot.addEventListener('click',e=>{if(e.target===modalRoot)closeModal()});
const initial=new URLSearchParams(location.search);if(initial.get('room'))state.room=initial.get('room').trim().toUpperCase().slice(0,16);
renderNav(); navigate(initial.get('page')==='calls'?'calls':'home');
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{}));}
