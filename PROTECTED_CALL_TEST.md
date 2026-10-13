# VISH Protected Call — Desktop Test

A VISH protected call is a VISH-to-VISH WebRTC room. It does **not** attach itself to a normal SIM, cellular, WhatsApp, Teams, or other third-party call.

## Same-desktop test

1. Start VISH and open `http://127.0.0.1:8000` in Chrome.
2. Open **Calls**.
3. Click **Join protected call** and allow microphone permission.
4. Click **Open second test participant**.
5. In the new tab, click **Join protected call** and allow microphone permission.
6. Both tabs should show the same room code.
7. Watch the diagnostics: **MIC**, **SIGNAL**, **PEER**, **ICE**.
8. The final status should become **Connected — Protected peer-to-peer audio established**.
9. Once connected, **Analyze remote stream 5s** becomes enabled.

If audio feedback occurs because both tabs use the same physical microphone/speakers, mute the speaker/output of one tab. The connection can still be tested.

## If it does not connect

- Refresh both tabs once after installing this fixed build so the updated service worker is active.
- Verify Chrome microphone permission is **Allow** for `127.0.0.1`.
- Leave the room in both tabs and retry with a new room code.
- Check the diagnostics. A failure at **MIC** is a permission/browser issue; **SIGNAL** is WebSocket/backend; **PEER** means the second VISH participant has not joined; **ICE** is the WebRTC network path.
- Do not test by making a normal phone call and then clicking Join; that call is outside the browser's audio pipeline.

## Two physical devices

`127.0.0.1` always means "this device", so a phone cannot connect to the desktop by opening the desktop's `127.0.0.1` URL. For two physical devices, deploy VISH at a reachable **HTTPS** URL (or use a proper HTTPS development tunnel/reverse proxy). Modern browsers normally block microphone/WebRTC capture on insecure non-localhost HTTP origins.
