# FPV Blackbox Log Decoding and Vibration Analysis Feasibility (`F-100-T01`)

Status: Feasibility study (`2026-11-15`). Scope: `F-100` (local-only Betaflight `.bbl`/`.bfl` analysis; no cloud upload).

## 1. Decoder Candidates Tried Locally (No Upload)

| Candidate | Runtime / Ecosystem | Local Check Result | Notes |
|---|---|---|---|
| `betaflight/blackbox-tools` (`blackbox_decode`) | Native C++ CLI | Not preinstalled (`blackbox_decode not found` on host) | Reference Betaflight decoder; emits CSV per flight session and supports all current Betaflight headers/predictors, but requires per-OS binary distribution. |
| `orangebox` (PyPI) | Python 3 (stdlib) | `pip install orangebox` failed on macOS Python 3.9 / `pip 21.2.4` (`ValueError: ("EntryPoint must be in 'name=module:attrs [extras]' format", 'bb2csv = scripts/bb2csv')`) | Pure-Python decoder, but its PyPI wheel metadata fails on older `pkg_resources` and lags behind newer Betaflight firmware encodings. |
| `blackbox-log` (Rust / WASM) / Blackbox Explorer JS parser | Node.js / WASM | Candidate for in-process Node decoding | Runs directly inside NERV's Node runtime with no Python or native compiler prerequisite if compiled to WASM or vendored. |

## 2. What Frame, Motor, Prop, and ESC Problems Look Like in the Data

Using **gyro Power Spectral Density (PSD) / spectrogram** over a throttle sweep (hover to high throttle and back), plus `motor[0..3]` and `eRPM` telemetry when logged:

- **Frame resonance**: **Horizontal constant-frequency bands** on the gyro spectrum (e.g., fixed 150–300 Hz band) that stay at the same frequency regardless of throttle changes. Indicates structural ringing (loose arm/stack/camera hardware or inherent frame stiffness mode).
  - Sources: [Betaflight Blackbox tuning & filtering docs](https://betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide), [LibDrone Blackbox spectral analysis](https://www.libdrone.eu/).
- **Motor / bearing problems**: **Diagonal/slanted harmonic lines** rising linearly with motor RPM/throttle. With BiDi DShot RPM filtering active, healthy motor harmonics are heavily attenuated; persistent loud harmonics or asymmetric `motor[0..3]` drive point to a damaged bearing, bent shaft, or desynchronized RPM notch.
  - Sources: [LibDrone Blackbox spectral analysis](https://www.libdrone.eu/), [Betaflight Blackbox Explorer](https://betaflight.com/docs/wiki/app/blackbox-explorer).
- **Propeller problems**: **Low-to-mid frequency slanted bands** tracking throttle/blade-pass frequency (often 1x/2x/3x blade pass), paired with elevated Roll/Pitch oscillation or uneven motor effort across diagonally opposed motors. If props were swapped and the same vibration persists, pure prop imbalance is less likely than motor/frame issues.
  - Sources: [QuadMeUp Blackbox vibration guide](https://quadmeup.com/), [Betaflight Blackbox tuning docs](https://betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide).
- **ESC / electrical noise**: **Wideband high-frequency fuzz or sharp spikes present immediately at arming (0% throttle)**, or sudden `eRPM` dropouts / `motor[0..3]` saturation spikes (desync). Points to missing/damaged low-ESR capacitor, ground loop, or noisy power/sensor routing.

## 3. Recommendation and Limits

- **Recommendation**:
  1. Decode logs **strictly locally** using either a bundled/checked `blackbox_decode` CLI binary (official Betaflight parser) or a WASM build of `blackbox-log` inside NERV's Node runtime (avoiding `orangebox` / Python packaging fragility).
  2. Compute per-axis (`Roll`, `Pitch`, `Yaw`) Welch PSD / spectrogram over `gyroADC` (and `gyroUnfilt` when `debug_mode = GYRO_SCALED` is enabled) binned by throttle, and correlate peaks with `motor[0..3]` averages/variance and `eRPM`.
  3. Present ranked candidate causes with the exact frequency/motor evidence from the log rather than a single guess.
- **Limits (what the log cannot tell)**:
  - Without `gyroUnfilt` (`debug_mode = GYRO_SCALED`), post-filter `gyroADC` hides high-frequency noise already attenuated by Betaflight's gyro lowpass/RPM filters.
  - Without BiDi DShot `eRPM` telemetry, motor RPM harmonics cannot be cleanly separated from prop blade-pass harmonics or attributed to a single motor without a props-off motor spin check.
  - A blackbox log cannot identify *which* physical screw or carbon part is loose—only that a constant-frequency structural resonance exists.
