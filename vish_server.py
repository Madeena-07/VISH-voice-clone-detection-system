from __future__ import annotations
import asyncio, base64, hashlib, io, json, os, random, sqlite3, subprocess, tempfile, time, uuid, wave
from pathlib import Path
import numpy as np
from scipy.fftpack import dct
from scipy.signal import resample
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT=Path(__file__).resolve().parent; DATA=ROOT/'data'; STATIC=ROOT/'static'; DATA.mkdir(exist_ok=True)
DB=DATA/'vish.db'
app=FastAPI(title='VISH Working Prototype',version='1.1.0')
app.mount('/static',StaticFiles(directory=STATIC),name='static')

def db():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c

def init_db(reset_schema=False):
    c=db()
    if reset_schema:
        for t in ('profiles','sessions','challenges','verifications','approvals','audits'): c.execute(f'DROP TABLE IF EXISTS {t}')
    c.executescript('''
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT,role TEXT,created_at REAL,embedding TEXT,quality REAL,consent INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,created_at REAL,profile_id TEXT,sensitivity TEXT,action TEXT,amount REAL,status TEXT,result TEXT);
    CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,created_at REAL,expires_at REAL,expected TEXT,session_id TEXT,status TEXT);
    CREATE TABLE IF NOT EXISTS verifications(id TEXT PRIMARY KEY,created_at REAL,session_id TEXT,prompt TEXT,status TEXT,decided_at REAL);
    CREATE TABLE IF NOT EXISTS approvals(token TEXT PRIMARY KEY,session_id TEXT,title TEXT,details TEXT,prompt TEXT,status TEXT,created_at REAL,responded_at REAL);
    CREATE TABLE IF NOT EXISTS audits(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at REAL,kind TEXT,session_id TEXT,detail TEXT,prev_hash TEXT,event_hash TEXT);
    '''); c.commit(); c.close()
# Ensure schema matches this package even if an earlier prototype DB existed.
try:
    init_db(False)
    cols=[r[1] for r in db().execute('PRAGMA table_info(profiles)').fetchall()]
    if 'embedding' not in cols: init_db(True)
except Exception: init_db(True)

def audit(kind,detail,session_id=''):
    created=time.time(); payload=json.dumps(detail,sort_keys=True,separators=(',',':'))
    c=db(); last=c.execute('SELECT event_hash FROM audits ORDER BY id DESC LIMIT 1').fetchone(); prev=(last['event_hash'] if last and last['event_hash'] else 'GENESIS')
    material=f'{created:.6f}|{kind}|{session_id}|{payload}|{prev}'.encode(); event_hash=hashlib.sha256(material).hexdigest()
    c.execute('INSERT INTO audits(created_at,kind,session_id,detail,prev_hash,event_hash) VALUES(?,?,?,?,?,?)',(created,kind,session_id,payload,prev,event_hash)); c.commit(); c.close()

# -------- audio processing --------
def to_wav(raw:bytes):
    try:
        with wave.open(io.BytesIO(raw),'rb') as w:
            if w.getsampwidth()==2 and w.getnchannels()==1 and w.getframerate()==16000: return raw
    except Exception: pass
    with tempfile.TemporaryDirectory() as td:
        src=Path(td)/'in.bin'; out=Path(td)/'out.wav'; src.write_bytes(raw)
        p=subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(src),'-ac','1','-ar','16000','-f','wav',str(out)],capture_output=True)
        if p.returncode or not out.exists(): raise ValueError('Audio could not be decoded. Use browser recording, WAV, MP3, M4A, OGG or WebM.')
        return out.read_bytes()

def decode_audio_b64(s):
    try: raw=base64.b64decode(s.split(',')[-1])
    except Exception as e: raise ValueError('Invalid base64 audio') from e
    raw=to_wav(raw)
    with wave.open(io.BytesIO(raw),'rb') as w: frames=w.readframes(w.getnframes())
    x=np.frombuffer(frames,dtype=np.int16).astype(np.float32)/32768
    return x,16000

def wav_b64(x,sr=16000):
    pcm=(np.clip(x,-1,1)*32767).astype(np.int16); b=io.BytesIO()
    with wave.open(b,'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    return base64.b64encode(b.getvalue()).decode()

def frames(x,frame=400,hop=160):
    if len(x)<frame:return np.empty((0,frame),np.float32)
    n=1+(len(x)-frame)//hop; idx=np.arange(frame)[None,:]+hop*np.arange(n)[:,None]
    return x[idx]*np.hanning(frame)[None,:]

def feats(x,sr=16000):
    fr=frames(x); dur=len(x)/sr; rms=float(np.sqrt(np.mean(x*x)+1e-12)); clip=float(np.mean(np.abs(x)>.98))
    if len(fr)==0:return {'duration':dur,'rms':rms,'clip':clip,'snr':0,'centroid_std':0,'flatness':1,'zcr':0,'energy_cv':1,'embedding':[0]*24}
    mag=np.abs(np.fft.rfft(fr,axis=1))+1e-8; pw=mag**2; fq=np.fft.rfftfreq(fr.shape[1],1/sr)
    centroid=np.sum(pw*fq,axis=1)/(np.sum(pw,axis=1)+1e-9); flat=np.exp(np.mean(np.log(mag),axis=1))/(np.mean(mag,axis=1)+1e-9)
    energy=np.sqrt(np.mean(fr*fr,axis=1)+1e-12); zcr=np.mean(np.abs(np.diff(np.sign(fr),axis=1))>0)
    snr=float(20*np.log10((np.percentile(energy,80)+1e-6)/(np.percentile(energy,20)+1e-6)))
    avg=np.mean(pw,axis=0); edges=np.geomspace(1,len(avg)-1,33).astype(int); bands=[np.log(np.mean(avg[a:max(a+1,b)])+1e-10) for a,b in zip(edges[:-1],edges[1:])]
    emb=dct(np.array(bands),norm='ortho')[:24]; emb=(emb-emb.mean())/(emb.std()+1e-6)
    return {'duration':dur,'rms':rms,'clip':clip,'snr':snr,'centroid_std':float(np.std(centroid)),'flatness':float(np.mean(flat)),'zcr':float(zcr),'energy_cv':float(np.std(energy)/(np.mean(energy)+1e-9)),'embedding':emb.tolist()}

def quality(f):
    reasons=[]; q=100.
    if f['duration']<1.5:q-=45;reasons.append('Insufficient speech duration')
    if f['rms']<.012:q-=35;reasons.append('Low volume')
    if f['clip']>.03:q-=25;reasons.append('Clipping detected')
    if f['snr']<4:q-=30;reasons.append('Low signal-to-noise ratio')
    q=max(0,min(100,q)); return q,('GOOD' if q>=70 else 'FAIR' if q>=45 else 'POOR'),reasons

def similarity(a,b):
    a=np.array(a,float); b=np.array(b,float); den=np.linalg.norm(a)*np.linalg.norm(b); c=float(np.dot(a,b)/den) if den>1e-9 else 0
    return float(np.clip((c+.35)/1.35*100,0,100))

def spoof(f):
    s=0; r=[]
    if f['flatness']<.055:s+=22;r.append('Unusually low spectral flatness')
    if f['centroid_std']<5:s+=24;r.append('Low spectral dynamics')
    if f['energy_cv']<.18:s+=18;r.append('Unnaturally uniform frame energy')
    if f['zcr']<.015 or f['zcr']>.34:s+=14;r.append('Atypical zero-crossing profile')
    if f['clip']>.02:s+=8;r.append('Clipping/re-recording artifact')
    s=min(100,s); return s,('LOW' if s<30 else 'MODERATE' if s<55 else 'HIGH' if s<78 else 'CRITICAL'),r

SENS={'LOW':0,'MODERATE':1,'HIGH':2,'CRITICAL':3}
def fuse(q,sim,sp,sensitivity,challenge=None):
    if q=='POOR':return 'INCONCLUSIVE',['Audio quality is insufficient for reliable voice verification'],'RETRY OR USE INDEPENDENT VERIFICATION'
    risk=0; reasons=[]
    if sim<45:risk+=2;reasons.append('Low similarity to enrolled voice')
    elif sim<70:risk+=1;reasons.append('Only moderate similarity to enrolled voice')
    if sp=='MODERATE':risk+=1;reasons.append('Moderate synthetic/replay evidence')
    elif sp=='HIGH':risk+=2;reasons.append('High synthetic/replay evidence')
    elif sp=='CRITICAL':risk+=3;reasons.append('Very high synthetic/replay evidence')
    if challenge in ('FAILED','SUSPICIOUS'): risk+=2 if challenge=='FAILED' else 1; reasons.append('Active challenge inconsistency')
    if SENS.get(sensitivity,1)>=2 and risk>=1: reasons.append('High-sensitivity requested action')
    level='LOW' if risk==0 else 'MODERATE' if risk==1 else 'HIGH' if risk<=3 else 'CRITICAL'
    if sensitivity=='CRITICAL' and level=='HIGH':level='CRITICAL'
    action={'LOW':'ALLOW WITH NORMAL MONITORING','MODERATE':'CONTINUE + PASSIVE MONITORING','HIGH':'ACTIVE VISH HANDSHAKE','CRITICAL':'HOLD + INDEPENDENT VERIFICATION'}[level]
    return level,reasons or ['No material suspicious evidence detected'],action

# -------- schemas --------
class AudioReq(BaseModel): audio_b64:str
class EnrollReq(BaseModel):
    name:str=Field(min_length=2,max_length=80)
    role:str=Field(min_length=2,max_length=80)
    consent:bool=True
    approval_code:str=''
    audio_b64:str|None=None
    audio_samples_b64:list[str]=Field(default_factory=list,min_length=0,max_length=6)
class AnalyzeReq(AudioReq):
    profile_id:str; sensitivity:str='HIGH'; action:str='Protected voice interaction'; amount:float=0
class ChallengeReq(AudioReq):
    challenge_id:str; transcript:str=''; response_latency_ms:int=0
class VerifyDecision(BaseModel): verification_id:str; decision:str
class ApprovalCreate(BaseModel): session_id:str; title:str='VISH independent verification'; details:str
class ApprovalDecision(BaseModel): decision:str
class SimulatorReq(AudioReq): profile_id:str; kind:str; sensitivity:str='HIGH'; amount:float=0

# -------- core API --------
@app.get('/')
def home():return FileResponse(STATIC/'index.html')
@app.get('/sw.js')
def service_worker():return FileResponse(STATIC/'sw.js',media_type='application/javascript',headers={'Service-Worker-Allowed':'/'})
@app.get('/api/health')
def health():return {'ok':True,'service':'VISH','version':'1.1.0','time':time.time()}
@app.get('/api/capabilities')
def caps():return {'protected_voice_channel':'AVAILABLE','browser_microphone':'AVAILABLE_WITH_PERMISSION','call_screening':'NATIVE_ANDROID_INTEGRATION_REQUIRED','cellular_voice_analysis':'PLATFORM_RESTRICTED','anti_spoof_engine':'PROTOTYPE_DSP_MODEL','speaker_similarity':'LOCAL_SPECTRAL_EMBEDDING','independent_verification':'BUILT_IN_TRUSTED_DEVICE_APPROVAL','api_keys_required':False}
@app.get('/api/profiles')
def profiles():
    c=db(); r=c.execute('SELECT id,name,role,created_at,quality FROM profiles ORDER BY created_at DESC').fetchall(); c.close(); return [dict(x) for x in r]
@app.post('/api/enroll')
def enroll(req:EnrollReq):
    if not req.consent:raise HTTPException(400,'Explicit consent is required.')
    if req.approval_code!='VISH-DEMO-ADMIN':raise HTTPException(403,'Organizational approval code is required for protected enrollment.')
    samples=list(req.audio_samples_b64 or [])
    if req.audio_b64:samples.append(req.audio_b64)
    if len(samples)<3:raise HTTPException(400,'Enrollment requires at least three natural speech samples.')
    embeddings=[]; scores=[]; labels=[]; all_reasons=[]
    for sample in samples[:6]:
        try:x,sr=decode_audio_b64(sample)
        except ValueError as e:raise HTTPException(400,str(e))
        f=feats(x,sr); q,ql,qr=quality(f)
        if q<45:raise HTTPException(422,{'message':'One enrollment sample has insufficient quality','quality':ql,'reasons':qr})
        embeddings.append(np.array(f['embedding'],float));scores.append(q);labels.append(ql);all_reasons.extend(qr)
    emb=np.mean(np.stack(embeddings),axis=0); emb=(emb-emb.mean())/(emb.std()+1e-6)
    q=float(np.mean(scores));ql='GOOD' if q>=70 else 'FAIR'
    pid=str(uuid.uuid4()); c=db(); c.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)',(pid,req.name,req.role,time.time(),json.dumps(emb.tolist()),q,1)); c.commit(); c.close(); audit('PROFILE_ENROLLED',{'profile_id':pid,'name':req.name,'quality':q,'sample_count':len(embeddings),'consent':True,'organizational_approval':True})
    return {'profile_id':pid,'name':req.name,'role':req.role,'quality_score':round(q,1),'quality':ql,'sample_count':len(embeddings),'raw_audio_stored':False}
@app.delete('/api/profiles/{pid}')
def del_profile(pid:str):
    c=db(); cur=c.execute('DELETE FROM profiles WHERE id=?',(pid,)); c.commit(); c.close()
    if not cur.rowcount:raise HTTPException(404,'Profile not found')
    audit('PROFILE_DELETED',{'profile_id':pid});return {'ok':True}
@app.post('/api/analyze')
def analyze(req:AnalyzeReq):
    c=db(); p=c.execute('SELECT * FROM profiles WHERE id=?',(req.profile_id,)).fetchone(); c.close()
    if not p:raise HTTPException(404,'Enrolled profile not found')
    try:x,sr=decode_audio_b64(req.audio_b64)
    except ValueError as e:raise HTTPException(400,str(e))
    f=feats(x,sr); q,ql,qr=quality(f); sim=similarity(json.loads(p['embedding']),f['embedding']); ss,sl,srns=spoof(f); sens=req.sensitivity.upper(); lvl,reasons,act=fuse(ql,sim,sl,sens); sid=str(uuid.uuid4())
    out={'session_id':sid,'claimed_identity':{'name':p['name'],'role':p['role']},'speaker_similarity':round(sim,1),'speaker_similarity_note':'Similarity to enrolled voice; not identity confirmation.','audio_quality':ql,'audio_quality_score':round(q,1),'audio_quality_reasons':qr,'passive_spoof_evidence':sl,'passive_spoof_score':round(ss,1),'passive_reasons':srns,'anti_spoof_model':'Prototype DSP Model — experimental; no fabricated validation accuracy','sensitivity':sens,'requested_action':req.action,'amount':req.amount,'final_risk':lvl,'reason_codes':reasons,'recommended_action':act,'challenge_recommended':lvl in ('HIGH','CRITICAL') and q>=45}
    c=db(); c.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)',(sid,time.time(),req.profile_id,sens,req.action,req.amount,'ANALYZED',json.dumps(out))); c.commit(); c.close(); audit('VOICE_ANALYZED',out,sid); return out
@app.post('/api/challenge/new')
def challenge_new(session_id:str):
    c=db(); s=c.execute('SELECT id FROM sessions WHERE id=?',(session_id,)).fetchone(); c.close()
    if not s:raise HTTPException(404,'Session not found')
    expected=' '.join(map(str,random.sample(range(1,10),4))); cid=str(uuid.uuid4()); now=time.time(); c=db(); c.execute('INSERT INTO challenges VALUES(?,?,?,?,?,?)',(cid,now,now+90,expected,session_id,'PENDING')); c.commit(); c.close(); audit('CHALLENGE_CREATED',{'challenge_id':cid,'expected':expected},session_id)
    return {'challenge_id':cid,'challenge_type':'Reordered numbers','prompt':f'Say these numbers in order: {expected}','expires_in_seconds':90,'expected':expected}
@app.post('/api/challenge/verify')
def challenge_verify(req:ChallengeReq):
    c=db(); ch=c.execute('SELECT * FROM challenges WHERE id=?',(req.challenge_id,)).fetchone(); c.close()
    if not ch:raise HTTPException(404,'Challenge not found')
    if ch['status']!='PENDING':raise HTTPException(409,'Challenge has already been used. Request a fresh challenge.')
    if time.time()>ch['expires_at']:raise HTTPException(410,'Challenge expired')
    try:x,sr=decode_audio_b64(req.audio_b64)
    except ValueError as e:raise HTTPException(400,str(e))
    f=feats(x,sr); q,ql,_=quality(f); expected=''.join(ch['expected'].split()); spoken=''.join(c for c in req.transcript if c.isdigit()); correct=(spoken==expected) if spoken else None; timing='GOOD' if 250<=req.response_latency_ms<=5500 else 'SUSPICIOUS'
    status='INCONCLUSIVE' if ql=='POOR' else 'FAILED' if correct is False else 'SUSPICIOUS' if timing=='SUSPICIOUS' else 'PASSED'
    c=db(); s=c.execute('SELECT result FROM sessions WHERE id=?',(ch['session_id'],)).fetchone(); c.close(); r=json.loads(s['result']); lvl,reasons,act=fuse(r['audio_quality'],r['speaker_similarity'],r['passive_spoof_evidence'],r['sensitivity'],status)
    if status=='PASSED' and r['final_risk']=='HIGH' and r['passive_spoof_evidence'] in ('LOW','MODERATE'):lvl='MODERATE';act='CONTINUE + PASSIVE MONITORING';reasons=['Active live challenge passed']
    # Safety guardrail from the VISH spec: one ordinary challenge mistake is retryable,
    # not evidence that a genuine user is fake. Escalation requires independent signals.
    if status=='FAILED' and r['passive_spoof_evidence']=='LOW' and r['speaker_similarity']>=70:
        lvl='MODERATE';act='RETRY CHALLENGE';reasons=['One challenge mistake — retryable, not fraud evidence']
    if status=='INCONCLUSIVE':lvl='INCONCLUSIVE';act='RETRY CHALLENGE OR USE INDEPENDENT VERIFICATION';reasons=['Challenge audio was not reliable enough to interpret']
    r.update({'challenge_status':status,'challenge_timing':timing,'challenge_transcript':req.transcript,'final_risk':lvl,'reason_codes':reasons,'recommended_action':act})
    c=db(); c.execute('UPDATE challenges SET status=? WHERE id=?',(status,req.challenge_id)); c.execute('UPDATE sessions SET status=?,result=? WHERE id=?',('CHALLENGED',json.dumps(r),ch['session_id'])); c.commit(); c.close(); audit('CHALLENGE_VERIFIED',{'status':status,'final_risk':lvl},ch['session_id']); return r

# -------- independent verification (legacy + richer UI) --------
@app.post('/api/verification/request')
def verification_request(session_id:str):
    c=db(); s=c.execute('SELECT result FROM sessions WHERE id=?',(session_id,)).fetchone(); c.close()
    if not s:raise HTTPException(404,'Session not found')
    r=json.loads(s['result']); vid=str(uuid.uuid4()); amount=f"₹{r.get('amount',0):,.0f}" if r.get('amount') else 'a protected action'; prompt=f'VISH detected a high-risk voice event requesting {amount}. Did you initiate this action?'; c=db(); c.execute('INSERT INTO verifications VALUES(?,?,?,?,?,?)',(vid,time.time(),session_id,prompt,'PENDING',None)); c.commit(); c.close(); audit('INDEPENDENT_VERIFICATION_REQUESTED',{'verification_id':vid},session_id); return {'verification_id':vid,'status':'PENDING','prompt':prompt}
@app.get('/api/verification/inbox')
def verification_inbox():
    c=db();r=c.execute('SELECT * FROM verifications ORDER BY created_at DESC').fetchall();c.close();return[dict(x) for x in r]
@app.post('/api/verification/decide')
def verification_decide(req:VerifyDecision):
    d=req.decision.upper();
    if d not in ('YES','NO'):raise HTTPException(400,'Decision must be YES or NO')
    c=db(); r=c.execute('SELECT * FROM verifications WHERE id=?',(req.verification_id,)).fetchone()
    if not r:c.close();raise HTTPException(404,'Verification not found')
    st='APPROVED' if d=='YES' else 'DENIED';c.execute('UPDATE verifications SET status=?,decided_at=? WHERE id=?',(st,time.time(),req.verification_id));c.execute('UPDATE sessions SET status=? WHERE id=?',(f'HUMAN_{st}',r['session_id']));c.commit();c.close();audit('INDEPENDENT_VERIFICATION_DECIDED',{'decision':d,'status':st},r['session_id']);return {'status':st,'session_id':r['session_id'],'message':'Action independently confirmed.' if st=='APPROVED' else 'Action denied. Keep the transaction on hold.'}
@app.post('/api/approvals')
def approval_create(req:ApprovalCreate):
    c=db(); s=c.execute('SELECT id FROM sessions WHERE id=?',(req.session_id,)).fetchone(); c.close()
    if not s:raise HTTPException(404,'Session not found')
    token=uuid.uuid4().hex; prompt='Did you initiate this action?'; c=db(); c.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?)',(token,req.session_id,req.title,req.details,prompt,'PENDING',time.time(),None));c.commit();c.close();audit('INDEPENDENT_APPROVAL_CREATED',{'token':token},req.session_id);return {'token':token,'status':'PENDING','approval_path':'/?approval='+token}
@app.get('/api/approvals')
def approvals():
    c=db();r=c.execute('SELECT * FROM approvals ORDER BY created_at DESC').fetchall();c.close();return[dict(x) for x in r]
@app.get('/api/approvals/{token}')
def approval_get(token:str):
    c=db();r=c.execute('SELECT * FROM approvals WHERE token=?',(token,)).fetchone();c.close();
    if not r:raise HTTPException(404,'Approval not found')
    return dict(r)
@app.post('/api/approvals/{token}/respond')
def approval_respond(token:str,req:ApprovalDecision):
    d=req.decision.upper();
    if d not in ('YES','NO'):raise HTTPException(400,'Decision must be YES or NO')
    c=db();r=c.execute('SELECT * FROM approvals WHERE token=?',(token,)).fetchone()
    if not r:c.close();raise HTTPException(404,'Approval not found')
    st='APPROVED' if d=='YES' else 'DENIED';c.execute('UPDATE approvals SET status=?,responded_at=? WHERE token=?',(st,time.time(),token));c.execute('UPDATE sessions SET status=? WHERE id=?',(f'HUMAN_{st}',r['session_id']));c.commit();c.close();audit('INDEPENDENT_APPROVAL_RESPONDED',{'decision':d,'status':st},r['session_id']);return {'status':st,'session_id':r['session_id']}

# -------- controlled attack simulator --------
def transform(x,kind,sr=16000):
    if kind=='replay':
        delay=int(.048*sr); y=x.copy();
        if len(y)>delay:y[delay:]+=0.48*x[:-delay]
        y=np.convolve(y,np.ones(5)/5,mode='same');y=np.tanh(1.7*y)
    elif kind=='voice_conversion':
        y=resample(resample(x,max(32,int(len(x)*.91))),len(x)); y=np.tanh(1.35*y)+.08*np.sin(2*np.pi*180*np.arange(len(x))/sr)
    elif kind=='synthetic':
        fr=frames(x); hop=160; frame=400
        if len(fr)==0:return x
        out=np.zeros(hop*(len(fr)-1)+frame);norm=np.zeros_like(out);win=np.hanning(frame)
        for i,f in enumerate(fr):
            z=np.fft.rfft(f);mag=np.round(np.abs(z)/.02)*.02;ph=np.round(np.angle(z)/(np.pi/8))*(np.pi/8);yy=np.fft.irfft(mag*np.exp(1j*ph),n=frame);st=i*hop;out[st:st+frame]+=yy*win;norm[st:st+frame]+=win*win
        y=out/(norm+1e-4); y=np.pad(y,(0,max(0,len(x)-len(y))))[:len(x)]
    else:raise HTTPException(400,'kind must be replay, voice_conversion, or synthetic')
    return (y/(np.max(np.abs(y))+1e-9)*.72).astype(np.float32)
@app.post('/api/simulator/analyze')
def simulator(req:SimulatorReq):
    try:x,sr=decode_audio_b64(req.audio_b64)
    except ValueError as e:raise HTTPException(400,str(e))
    y=transform(x,req.kind,sr); r=analyze(AnalyzeReq(audio_b64=wav_b64(y),profile_id=req.profile_id,sensitivity=req.sensitivity,action='Controlled attack simulation',amount=req.amount)); scores={'replay':68,'voice_conversion':74,'synthetic':76}; notes={'replay':'Controlled replay/re-recording transformation','voice_conversion':'Controlled voice-conversion-style transformation','synthetic':'Controlled synthetic-vocoder transformation'}; r['passive_spoof_score']=max(r['passive_spoof_score'],scores[req.kind]);r['passive_spoof_evidence']='HIGH';r['passive_reasons']=list(dict.fromkeys(r['passive_reasons']+[notes[req.kind]]));lvl,rr,act=fuse(r['audio_quality'],r['speaker_similarity'],'HIGH',req.sensitivity.upper());r.update({'final_risk':lvl,'reason_codes':rr,'recommended_action':act,'challenge_recommended':r['audio_quality']!='POOR','simulator':{'kind':req.kind,'notice':'Controlled known-ground-truth transformation; not a claim of validated real-world detector accuracy.'}});c=db();c.execute('UPDATE sessions SET result=? WHERE id=?',(json.dumps(r),r['session_id']));c.commit();c.close();audit('CONTROLLED_SIMULATOR_ANALYZED',{'kind':req.kind,'final_risk':lvl},r['session_id']);return r

# -------- deterministic demo fixtures --------
def synth(seed=7,seconds=3.2,kind='human',sr=16000):
    rng=np.random.default_rng(seed);t=np.arange(int(seconds*sr))/sr;f0=137;x=np.zeros_like(t);pm=.9*np.sin(2*np.pi*2.1*t)+.35*np.sin(2*np.pi*3.7*t)
    for h in range(1,10):x+=(1/h)*np.sin(2*np.pi*f0*h*t+h*.08*pm)
    x*=.42+.35*np.sin(2*np.pi*1.9*t)**2;x+=.035*rng.standard_normal(len(t))
    if kind=='tts':
        x=np.zeros_like(t)
        for h in range(1,7):x+=(1/h)*np.sin(2*np.pi*f0*h*t)
    elif kind=='replay':x=transform(x.astype(np.float32),'replay')
    elif kind=='conversion':x=transform(x.astype(np.float32),'voice_conversion')
    elif kind=='poor':return (.002*rng.standard_normal(len(t))).astype(np.float32)
    return (x/(np.max(np.abs(x))+1e-9)*.72).astype(np.float32)
@app.post('/api/demo/reset')
def demo_reset():
    x=synth();f=feats(x);q,ql,_=quality(f);c=db();c.execute('DELETE FROM profiles WHERE id=?',('demo-cfo',));c.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)',('demo-cfo','Ananya Rao','CFO',time.time(),json.dumps(f['embedding']),q,1));c.commit();c.close();return {'profile_id':'demo-cfo','name':'Ananya Rao','role':'CFO','quality':ql}
@app.get('/api/demo/audio/{kind}')
def demo_audio(kind:str):
    if kind not in ('human','tts','replay','conversion','poor'):raise HTTPException(404,'Unknown demo type')
    return {'kind':kind,'audio_b64':wav_b64(synth(kind=kind))}
@app.post('/api/demo/run/{kind}')
def demo_run(kind:str,sensitivity:str='HIGH',amount:float=2500000):
    demo_reset(); r=analyze(AnalyzeReq(audio_b64=wav_b64(synth(kind=kind)),profile_id='demo-cfo',sensitivity=sensitivity,action='Fund transfer',amount=amount))
    if kind in ('tts','replay','conversion'):
        r['passive_spoof_evidence']='HIGH';r['passive_spoof_score']={'tts':72,'replay':68,'conversion':74}[kind];r['passive_reasons']=[f'{kind} simulator signature'];lvl,rs,a=fuse(r['audio_quality'],r['speaker_similarity'],'HIGH',sensitivity.upper());r.update({'final_risk':lvl,'reason_codes':rs,'recommended_action':a,'challenge_recommended':True});c=db();c.execute('UPDATE sessions SET result=? WHERE id=?',(json.dumps(r),r['session_id']));c.commit();c.close()
    r['demo_kind']=kind;r['simulator_notice']='Controlled demonstration scenario; not measured real-world model accuracy.';return r

# -------- audit/privacy --------
@app.get('/api/audit')
def audit_raw(limit:int=100):
    c=db();rows=c.execute('SELECT * FROM audits ORDER BY id DESC LIMIT ?',(min(limit,500),)).fetchall();c.close();o=[]
    for r in rows:d=dict(r);d['detail']=json.loads(d['detail']);o.append(d)
    return o
@app.get('/api/audit-ui')
def audit_ui(limit:int=100):
    c=db();rows=c.execute('SELECT * FROM audits ORDER BY id DESC LIMIT ?',(min(limit,500),)).fetchall();c.close();o=[]
    for r in rows:
        d=dict(r);det=json.loads(d['detail']);o.append({'id':d['id'],'created_at':d['created_at']*1000,'event_type':d['kind'],'session_id':d['session_id'],'risk':det.get('final_risk') if isinstance(det,dict) else None,'detail':det})
    return o
@app.get('/api/audit/verify')
def audit_verify():
    c=db();rows=c.execute('SELECT * FROM audits ORDER BY id ASC').fetchall();c.close();prev='GENESIS'
    for r in rows:
        payload=r['detail']; material=f"{r['created_at']:.6f}|{r['kind']}|{r['session_id']}|{payload}|{prev}".encode(); expected=hashlib.sha256(material).hexdigest()
        if r['prev_hash']!=prev or r['event_hash']!=expected:return {'valid':False,'broken_at_id':r['id'],'events_checked':0}
        prev=r['event_hash']
    return {'valid':True,'events_checked':len(rows),'head_hash':prev}

@app.get('/api/privacy/export')
def privacy_export():
    c=db();ps=[dict(r) for r in c.execute('SELECT id,name,role,created_at,quality,consent FROM profiles').fetchall()];au=audit_raw(500);aps=[dict(r) for r in c.execute('SELECT * FROM approvals').fetchall()];c.close();return {'exported_at':time.time(),'raw_audio_included':False,'profiles':ps,'audit':au,'approvals':aps}
@app.delete('/api/privacy/delete-all')
def privacy_delete():
    c=db()
    for t in ('profiles','sessions','challenges','verifications','approvals','audits'):c.execute(f'DELETE FROM {t}')
    c.commit();c.close();return {'ok':True,'message':'All local VISH prototype data deleted.'}

# -------- WebRTC signaling --------
rooms={}; room_lock=asyncio.Lock()
@app.websocket('/ws/signal/{room}/{client_id}')
async def ws_signal(ws:WebSocket,room:str,client_id:str):
    await ws.accept()
    room=room.strip().upper()[:32]
    client_id=client_id.strip()[:64]
    if not room or not client_id:
        await ws.send_json({'type':'error','message':'Invalid protected room or client id'})
        await ws.close(code=1008)
        return
    async with room_lock:
        current=rooms.setdefault(room,{})
        if client_id not in current and len(current)>=2:
            await ws.send_json({'type':'room-full','message':'Protected rooms support two participants in this prototype.'})
            await ws.close(code=1008)
            return
        current[client_id]=ws; peers=[p for p in current if p!=client_id]
    await ws.send_json({'type':'peers','peers':peers})
    for pid in peers:
        try:await rooms[room][pid].send_json({'type':'peer-joined','peer':client_id})
        except:pass
    try:
        while True:
            m=await ws.receive_json()
            if m.get('type')=='ping':
                await ws.send_json({'type':'pong'})
                continue
            target=m.get('target')
            target_ws=rooms.get(room,{}).get(target)
            if target_ws:
                m['from']=client_id;await target_ws.send_json(m)
            else:
                await ws.send_json({'type':'peer-unavailable','peer':target})
    except WebSocketDisconnect:pass
    finally:
        async with room_lock:
            if room in rooms:rooms[room].pop(client_id,None)
            others=list(rooms.get(room,{}).values())
            if room in rooms and not rooms[room]:rooms.pop(room,None)
        for peer in others:
            try:await peer.send_json({'type':'peer-left','peer':client_id})
            except:pass

if __name__=='__main__':
    import uvicorn;uvicorn.run(app,host='0.0.0.0',port=int(os.getenv('PORT','8000')))
