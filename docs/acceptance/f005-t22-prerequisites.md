# F-005-T22: prerequisite checks on the Linux VM

Decision (owner, 2026-11-13): the Linux VM, set up once ([setup](linux-vm.md)). The demonstration shows NERV reporting a missing, an old and a supported Node.js before it installs anything.

## 1. No Node.js: inspect from the Mac (macOS Terminal, NERV checkout)

```bash
npm start -- nodes inspect --ssh nerv-linux --out vm-inspection-1.json
```

Expected: the inspection completes read-only and reports that Node.js is missing on `nerv-linux`; nothing is installed or changed on the VM.

## 2. An old Node.js (inside the VM)

```bash
ssh nerv-linux 'sudo apt-get update -qq && sudo apt-get install -y -qq nodejs && node --version'
npm start -- nodes inspect --ssh nerv-linux --out vm-inspection-2.json
```

Expected: Ubuntu's packaged Node.js (18.x) is installed, and the inspection reports it as below the version NERV requires (`engines.node` ≥ 24).

## 3. A supported Node.js, then the local check before install

```bash
ssh nerv-linux 'curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y -qq nodejs && node --version'
ssh nerv-linux 'git clone https://github.com/voidbrain/nerv.git && cd nerv && npm ci && npm start -- nodes lifecycle-inspect --action install --out install-plan.json'
```

Read the NodeSource script before running it if you prefer (`curl -fsSL https://deb.nodesource.com/setup_24.x | less`). Expected: Node 24.x; `lifecycle-inspect` prints a plan whose prerequisite checks (Node version, executable, non-interactive `systemd --user` session) all pass, or names the one that does not. Nothing is installed until a plan is applied (that is F-005-T26).

## Report

Tell the agent the result of the three inspections. It records the evidence in F-005 and closes the step.
