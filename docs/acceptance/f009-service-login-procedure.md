# F-009: Mac login/logout and Linux user-service acceptance procedure

Goal: verify that the Mac user service survives login/logout and choose/verify a Linux target with `systemd --user`.

## Part 1 — Mac login/logout acceptance (Neo Tokyo-3, Terminal)

1. Confirm the per-user service is installed and running:
   ```zsh
   npm start -- service status
   ```
   Expected: service is loaded and running on `http://127.0.0.1:4317`.
2. Log out of macOS (Apple menu → Log Out) and log back in.
3. After logging back in, check without starting NERV manually:
   ```zsh
   npm start -- service status
   ```
   Expected: `launchd` restarted the service automatically at login and `status` reports running.

## Part 2 — Linux target selection and acceptance (selected Linux host, bash)

1. On the chosen Linux host, install and start the user service:
   ```bash
   npm start -- service install
   npm start -- service status
   npm start -- service stop
   npm start -- service start
   ```
   Expected: `systemd --user` unit installs, starts, stops, and restarts cleanly; `127.0.0.1:4317` serves the UI/API.
2. Enable lingering if headless background operation after logout is required, then log out and back in to confirm persistence.
