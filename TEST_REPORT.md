# VISH Final Premium Working Prototype — QA Report

## Final result

**PASS** for the implemented/claimed prototype feature set after the protected-call repair pass.

This build keeps the premium VISH UI and fixes the protected WebRTC room flow that could fail or be misunderstood as attaching to an ordinary phone call.

## Protected-call fixes in this release

- Clarified in the UI that **VISH Protected Call does not attach to a normal SIM/WhatsApp call**.
- Added **Open second test participant** for a reliable same-desktop two-tab demonstration.
- Added **Copy room link**.
- Added live **MIC / SIGNAL / PEER / ICE** diagnostics.
- Changed negotiation so the newcomer that sees an existing peer initiates the offer, reducing signaling races.
- Added an **early ICE queue**. ICE candidates received before `setRemoteDescription()` are held and flushed afterwards instead of being silently lost.
- Added explicit WebSocket signaling error handling, peer-unavailable handling and peer-left handling.
- Added a two-participant room limit with a clear **room-full** response.
- Added WebRTC connection-state handling so the UI only reports **Connected** when the peer connection actually reaches `connected`.
- Remote-stream analysis remains disabled until the protected peer connection is connected.
- Added a second STUN server fallback and ICE candidate pooling.
- Bumped the PWA service-worker cache so browsers do not keep the older protected-call JavaScript.

## Static/code checks

- `python -m py_compile vish_server.py run.py` — PASS
- `node --check static/app.js` — PASS
- Root application HTTP response — PASS
- CSS / JS / manifest HTTP responses — PASS
- Root service worker GET + `Service-Worker-Allowed: /` — PASS

## Backend/security regression suite

Console result:

`ALL_BACKEND_SECURITY_SIGNALING_TESTS_PASS`

Verified:

- Health/capability API
- No external API key requirement
- PWA service worker and manifest configuration
- Genuine controlled scenario → LOW
- Poor-audio scenario → INCONCLUSIVE
- Synthetic/TTS controlled scenario → elevated spoof evidence
- Replay controlled scenario → elevated spoof evidence
- Voice-conversion controlled scenario → elevated spoof evidence
- Explicit enrollment consent required
- Organizational enrollment approval code required
- Fewer than 3 enrollment samples rejected
- 3-sample enrollment succeeds
- Raw enrollment audio is not persisted by the database
- Enrolled-profile speaker comparison
- Fresh 90-second challenge generation
- Correct challenge response → PASSED
- Challenge reuse → rejected (HTTP 409)
- One ordinary challenge mistake + otherwise consistent evidence → MODERATE / RETRY CHALLENGE
- Synthetic/high-risk + suspicious challenge → CRITICAL
- Independent approval creation
- Independent approval denial
- Controlled replay / voice-conversion / synthetic transform endpoints
- Two-client WebSocket signaling relay
- ICE signaling relay
- Third participant receives room-full response
- Privacy export excludes raw audio
- SHA-256 audit hash chain verifies as valid
- Profile deletion

## Premium rendered UI / flow regression

Console result:

`ALL_PREMIUM_UI_RENDER_AND_FLOW_TESTS_PASS`

Verified:

- Premium Protection dashboard renders
- Desktop and mobile layouts
- 16 kHz WAV browser encoder produces a valid RIFF/WAV header
- Three-sample enrollment through the real backend
- Genuine analysis reaches real backend and displays LOW
- Speaker similarity / spoof evidence / audio quality remain separate
- Synthetic attack → HIGH → fresh challenge → CRITICAL
- Independent verification request and denial
- Privacy/audit screen and valid hash-chain status
- Protected-call controls render correctly
- No uncaught page JavaScript errors in tested flows

## Protected-call browser regression

Console result:

`ALL_PROTECTED_CALL_CLIENT_LOGIC_TESTS_PASS`

Verified in Chromium:

- Microphone acquisition path is invoked by Join
- Signaling WebSocket open state updates the UI
- Newcomer discovers an existing peer and generates a WebRTC offer
- Offer is targeted to the correct peer
- ICE received before remote description is queued rather than dropped
- Queued ICE is flushed after the remote offer is installed
- Answer is generated and sent back to the correct peer
- Connected connection-state updates the call UI
- Real Chromium `RTCPeerConnection` can create offer/answer descriptions and negotiate a remote audio track in the browser API smoke test

## Environment boundary for the final QA

The packaging environment blocks Chromium navigation/network access to localhost by administrator policy. Therefore a literal two-Chromium-tab media path to `127.0.0.1` could not be driven inside this sandbox. To compensate, the release was tested at three independent layers:

1. the real FastAPI/WebSocket server with simultaneous signaling clients,
2. the actual VISH protected-call JavaScript state machine in Chromium with controlled signaling/media mocks, and
3. the real Chromium WebRTC offer/answer/remote-track API path.

On a normal Windows desktop, use the new **Open second test participant** button so both tabs are on the same localhost origin and join the same room.

## Intentionally not claimed

These are platform limitations, not broken prototype features:

- Attaching a web app to arbitrary SIM/cellular/WhatsApp call audio
- Guaranteed background microphone analysis after a mobile browser/PWA is suspended or the phone is locked
- Production/forensic deepfake-detection accuracy
- Autonomous authorization of a high-value financial transaction

Native Android foreground-service + CallScreeningService/OEM/enterprise integration is the appropriate next layer for guaranteed Android background operation.
