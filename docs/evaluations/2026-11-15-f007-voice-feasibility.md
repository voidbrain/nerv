# F-007 Step 1a — Local STT and TTS Feasibility on Mac (Italian & English)

Measured 2026-11-15 on the Mac development host (`arm64` Darwin) with neutral Italian and English test phrases. No private recordings or transcripts were captured or committed.

## 1. Host Inventory

| Candidate | Kind | Availability on Mac Host | Notes |
|---|---|---|---|
| macOS `/usr/bin/say` | TTS | Installed (`/usr/bin/say`) | Built-in `it_IT` (`Alice`, `Eddy`, `Flo`) and `en_US`/`en_GB` (`Daniel`, `Albert`, `Eddy`, `Flo`) voices |
| `piper` | TTS | Not installed (`piper not found`) | Would require downloading ONNX voice models (~60 MB per language) |
| Browser `speechSynthesis` | TTS | Available in PWA/browser | Zero-install UI fallback; depends on host OS voices |
| `whisper.cpp` / `whisper-cli` / `whisper` | STT | Not installed | Would require `whisper.cpp` binary + multilingual GGML weights (`base` ~140 MB or `small` ~460 MB) |
| Apple `SFSpeechRecognizer` (`swift`) | STT | `/usr/bin/swift` installed | Native macOS `Speech` framework supports `requiresOnDeviceRecognition = true` for `it-IT` and `en-US`/`en-GB` with owner permission |
| Python speech packages (`faster-whisper`, `vosk`) | STT | Not installed | Not present in host Python environment |

## 2. Measured TTS Latency (`/usr/bin/say`)

Synthesized directly to temporary `.aiff` files (deleted immediately after timing):

| Language | Voice | Neutral Phrase | Elapsed | Output Size |
|---|---|---|---|---|
| `it-IT` | `Alice` | `"Stato delle basi e promemoria per stasera alle nove."` | `900.4 ms` | `129,796 bytes` |
| `en-GB` | `Daniel` | `"Base status and reminders for nine o clock tonight."` | `675.5 ms` | `138,344 bytes` |

Both Italian and English synthesis complete in under 1 second locally with zero network calls and zero extra binary dependencies.

## 3. STT Assessment & Recommendation

- **Mac companion (`F-007-T03`)**: Use Apple `SFSpeechRecognizer` (`it-IT` and `en-US`/`en-GB`) with `requiresOnDeviceRecognition = true` for push-to-talk, or `whisper.cpp` (`small` multilingual) if an offline cross-platform CLI path is later required.
- **PWA / Dashboard (`F-007-T03`)**: Capture push-to-talk audio/transcript only while pressed, always display the recognized transcript for explicit owner confirmation before dispatching any mutating or physical action, and never execute silent physical activation.
- **TTS (`F-007-T04`)**: Use `/usr/bin/say` on macOS (or browser `speechSynthesis` in the PWA) with `Alice` (`it-IT`) and `Daniel` (`en-GB`).
