# Linux VM on Neo Tokyo-3 (set up once)

The owner chose a Linux VM on the Mac (2026-11-13) as the Linux target for F-005-T22 (prerequisite checks), F-005-T26 and F-009-T03 (Linux user service). It is set up once and kept. [Multipass](https://canonical.com/multipass) runs Ubuntu VMs on Apple Silicon with `systemd --user`, which the Linux service needs.

## Create the VM (macOS Terminal, Neo Tokyo-3)

```bash
brew install --cask multipass
multipass launch 24.04 --name nerv-linux --cpus 2 --memory 4G --disk 20G
multipass info nerv-linux
```

Expected: `State: Running` and an `IPv4` address (`192.168.64.x`).

## Let the Mac reach it over SSH

```bash
multipass exec nerv-linux -- bash -c "mkdir -p ~/.ssh && echo '$(cat ~/.ssh/id_ed25519.pub)' >> ~/.ssh/authorized_keys"
printf '\nHost nerv-linux\n  HostName %s\n  User ubuntu\n' "$(multipass info nerv-linux | awk '/IPv4/{print $2}')" >> ~/.ssh/config
ssh nerv-linux 'uname -a; systemctl --user --version | head -1'
```

Expected: a `Linux nerv-linux … aarch64` line and a `systemd` version. If you use another key, replace `id_ed25519.pub`.

The VM starts without Node.js on purpose: F-005-T22 shows NERV reporting that before anything is installed.

Remove it later with `multipass delete --purge nerv-linux` (nothing else on the Mac changes).
