# VISH — Final Premium Working Prototype

**Voice Integrity Security Handshake** — a local, zero-paid-API-key SIH prototype for protected voice trust decisions.

This build deliberately combines the **original premium VISH UI** with the **working FastAPI/audio/security engine**. Anything shown as AVAILABLE is implemented in this package. Platform-restricted capabilities are visibly labelled rather than simulated as if they were available.

## Quick start

### Windows
1. Extract the ZIP.
2. Install Python 3.10+ if it is not already installed. During Python installation, enable **Add Python to PATH**.
3. Double-click **`start.bat`**.
4. Your browser opens **http://127.0.0.1:8000**.
5. Allow microphone permission when you use live recording.

### macOS / Linux
```bash
chmod +x start.sh
./start.sh
```
Then open `http://127.0.0.1:8000`.

### Demo organizational approval code
`VISH-DEMO-ADMIN`

No OpenAI, Gemini, ElevenLabs, Twilio or Hugging Face API key is required.

## What actually works

- Premium responsive VISH dashboard (desktop + mobile)
- Local FastAPI backend
- SQLite persistence
- Browser microphone capture
- Browser-side 16 kHz PCM WAV encoding (normal app recording does **not** require FFmpeg)
- Three-sample trusted voice enrollment
- Explicit enrollment consent
- Demo organizational approval gate
- Local acoustic speaker-similarity template
- Audio-quality gate with **INCONCLUSIVE** abstention
- Experimental explainable anti-spoof DSP evidence
- Genuine / synthetic / replay / voice-conversion / poor-audio controlled scenarios
- Transaction-aware LOW / MODERATE / HIGH / CRITICAL policy
- Fresh, random, session-bound challenge
- 90-second challenge expiry
- Used-challenge replay protection
- Challenge correctness + response-latency evidence
- One ordinary genuine challenge mistake → **RETRY**, not "fake"
- Independent trusted-device/account approval workflow
- YES / NO approval decisions
- WebRTC protected-call UI
- WebSocket room signaling backend
- Remote protected-stream analysis path
- PWA manifest + root service worker
- Privacy export without raw audio
- Delete-all local data control
- SHA-256 tamper-evident audit hash chain + verification endpoint
- Zero paid external API keys for the core prototype

## Fast SIH demo

### 1. Enrollment
Open **Security** → either:
- record three real 5-second natural speech samples, or
- click **Load 3 deterministic demo samples**.

Enter name/role, keep consent enabled and use `VISH-DEMO-ADMIN`, then create the profile.

### 2. Genuine voice
Open **Calls** → **Load deterministic genuine demo** → **Analyze captured voice**.

Expected controlled result: **LOW** with speaker similarity shown only as similarity evidence.

### 3. AI/synthetic attack
Click the flask icon or **Open attack lab** → choose **AI synthetic voice** → run backend analysis.

Expected flow:
`HIGH → fresh VISH handshake → suspicious response → CRITICAL → independent verification`.

Choose **NO — I did not** on the Alerts screen to demonstrate the workflow being held.

### 4. Poor audio
In the attack lab choose **Poor audio**.

Expected controlled result: **INCONCLUSIVE**. VISH does not convert unusable audio into a fraud accusation.

### 5. Protected call — correct way to test it
A **VISH Protected Call is not an ordinary SIM/WhatsApp call**. Both participants must be inside VISH and must join the same VISH room.

For the most reliable desktop test:
1. Open **Calls**.
2. Click **Join protected call** in the first VISH tab and allow microphone access.
3. Click **Open second test participant**.
4. In the new tab, click **Join protected call** and allow microphone access. The room code is carried across automatically.
5. Watch the four live diagnostics: **MIC / SIGNAL / PEER / ICE**. They should progress to ready/connected states.
6. When the status becomes **Connected**, remote audio is available and **Analyze remote stream 5s** becomes enabled.

The protected-call client now queues early ICE candidates instead of discarding them, has explicit room-full/peer-left/error handling, and uses deterministic offer ownership to avoid WebRTC negotiation glare.

If you use two different physical devices, the second device cannot use the desktop's `127.0.0.1` address. It needs a reachable deployment URL, and microphone/WebRTC access should be served over **HTTPS**. Modern browsers restrict microphone access on insecure non-localhost origins.

## Important platform boundary

This package does **not** claim that an ordinary app can secretly capture arbitrary SIM/cellular call audio. Full voice analysis is provided for VISH-controlled microphone/WebRTC audio. Native Android call-screening/OEM/enterprise telephony integration is a separate platform capability.

Likewise, an installable browser/PWA cannot guarantee continuous microphone processing after Android suspends the browser or locks the device. Guaranteed background protected-call processing requires a native Android foreground service. The UI labels this limitation explicitly instead of faking an "always listening" state.

## Anti-spoof model status

The anti-spoof component is intentionally labelled **Prototype DSP Model**. The controlled transformations are useful for demonstrating evidence fusion and workflow behavior, but they are **not** a claim of validated real-world deepfake-detection accuracy. A research/production deployment should replace or augment it with a benchmarked anti-spoof model and report measured precision/recall/F1 on declared datasets.

## Project structure

- `vish_server.py` — FastAPI APIs, audio features, risk engine, challenges, approvals, simulator, audit, WebSocket signaling
- `static/index.html` — premium VISH shell
- `static/styles.css` — original premium UI + working-prototype controls
- `static/app.js` — microphone, enrollment, real API flows, WebRTC UI, attack lab, privacy/audit UI
- `static/manifest.json` / `static/sw.js` — PWA configuration
- `data/` — local SQLite database created on first run
- `tests/test_all.py` — backend/security/signaling regression suite
- `tests/ui_test.py` — premium rendered UI and end-to-end flow regression test used during packaging
- `tests/test_protected_call_js.py` — protected-call client negotiation, early-ICE queue, offer/answer and real Chromium WebRTC API smoke test
- `TEST_REPORT.md` — final QA results and test boundary

## Optional FFmpeg

The shipped UI records directly to 16 kHz WAV, so FFmpeg is not needed for normal browser recording. The backend still contains an optional FFmpeg fallback if developers call the API with compressed audio formats such as WebM/MP3/M4A.
