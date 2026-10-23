# Vega OS features that would help StudioX's architecture

Status: 23 October 2026, Vega SDK 0.24, React Native 0.83. Each item is a **request**, not a
claim about an existing API. "Not found" means not found in the 0.24 docs we read; it may
exist elsewhere.

| Request | Why it matters to StudioX | Current workaround |
| --- | --- | --- |
| **Focal point for `Image` `resizeMode="cover"`** (like CSS `object-position`) | Round portrait crops on the Map and in the co-viewer panel cut off the top of the head. | Every bundled photo is pre-cropped twice offline (square face crop, 4:3 scene crop). |
| **SeekBar scrub mode** in kepler-ui-components | D-pad scrubbing of a playing video is a core player interaction. The SeekBar resets its thumb on every `currentValue` change, calls `onSlidingEnd` on every key-up, and draws the thumb at 0:00 at the end of a bar with break markers. | The app freezes `currentValue` while scrubbing, commits one seek 600 ms after the last press (or on OK), clamps to total − 250 ms and avoids `enableAnimations`. |
| **Splash with audio, or a pre-mount intro** | The branded fracture sting should start before React mounts and carry its sound. `SplashScreenManager` documents PNG sequences only, with no audio. | A silent native-driver intro after mount ([opening-sequence](opening-sequence.md)). |
| **VVD screenshot, recording and key presses in the Vega CLI** (for example `vega device screenshot`, `vega device press KEY_RIGHT`) | An AI agent can verify a TV UI only if it can press keys and see the screen. | The Android emulator console (`telnet localhost 5554`, `auth`, `screenrecord screenshot` / `screenrecord start`) and `vega exec vda shell "inputd-cli button_press KEY_RIGHT"`. Neither is in the Vega docs. |
| **On-device speech input for apps** (a documented voice-query API) | Viewers could ask the co-viewer a free-form question with the remote's mic instead of a phone. Alexa voice is system-owned; as far as we found in the 0.24 docs (unverified), apps cannot receive free-form spoken questions. | Voice ask goes through the paired phone's microphone. |
| **Background task API able to poll a server job** | An upload's analysis runs on the backend and can outlast the app's time in the foreground; the TV should learn it finished even if the app was backgrounded. | Server-side job status; the TV polls the link's uploads every 4 s, only while the section is visible and the app is in the foreground. |
| **System share sheet / "send to phone" tied to the Amazon account** | Sending a card or link to the viewer's phone should not need a QR pairing step. | Pair a phone by QR code with the companion web page; the TV sends cards to that link. |
| **Native mask / clip API for Animated views** (text and vector shapes, native-driver friendly) | The fractured title clips each letter into rigid panes. | react-native-svg `ClipPath` + `Image` per letter inside native-driver `Animated.View`s. It works on the VVD, but there is no documented mask API to rely on. |
