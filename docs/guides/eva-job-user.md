# EVA job user on macOS (one-time setup)

EVA jobs can run as a separate macOS user, `_nervjob`, so that every process a job starts belongs to that user and ends with the job ([B-099](../work/records/B-099.md), [decisions/eva-runner.md](../decisions/eva-runner.md)). This page is the one-time setup on a Mac. Run each block in Terminal, with an admin account, and compare the output.

`_nervjob` is a service account like `_www` or `_spotlight`: no password, no login, no home folder, no shell. It is hidden from the login window and from System Settings → Users & Groups, and nothing of it runs except while an EVA job runs. On a managed Mac, creating a local account and a sudoers file is visible to device management.

## 1. Create the user

Pick a free id below 500 (the command prints the ids in use; `499` is usually free):

```bash
dscl . -list /Users UniqueID | awk '$2 < 500 {print $2}' | sort -n | tail -3
sudo dscl . -create /Users/_nervjob
sudo dscl . -create /Users/_nervjob UniqueID 499
sudo dscl . -create /Users/_nervjob PrimaryGroupID -2
sudo dscl . -create /Users/_nervjob UserShell /usr/bin/false
sudo dscl . -create /Users/_nervjob NFSHomeDirectory /var/empty
sudo dscl . -create /Users/_nervjob RealName "NERV EVA jobs"
sudo dscl . -create /Users/_nervjob IsHidden 1
id _nervjob
```

Expected: the last line reads `uid=499(_nervjob) gid=4294967294(nogroup) …` (with the id you chose). Not `staff`: your home folder is readable by `staff`, never by `_nervjob`.

## 2. Create the shared folder

```bash
sudo mkdir -p /Users/Shared/nerv-eva
sudo chown "$(whoami)":staff /Users/Shared/nerv-eva
sudo chmod 1775 /Users/Shared/nerv-eva
ls -ld /Users/Shared/nerv-eva
```

Expected: `drwxrwxr-t … <you> staff … /Users/Shared/nerv-eva`.

## 3. Allow exactly two commands as `_nervjob`

```bash
echo "$(whoami) ALL=(_nervjob) NOPASSWD: /usr/bin/sandbox-exec, /bin/kill" | sudo tee /etc/sudoers.d/nerv-eva
sudo chmod 440 /etc/sudoers.d/nerv-eva
sudo visudo -c -f /etc/sudoers.d/nerv-eva
sudo -n -u _nervjob /bin/kill -0 -1; echo "kill: $?"
sudo -n -u _nervjob /usr/bin/true; echo "other: $?"
```

Expected: `parsed OK`, then `kill: 0` or `kill: 1` (allowed; 1 only means `_nervjob` runs nothing now), then a `sudo: a password is required` line and `other: 1`: every other command is refused.

## 4. Tell NERV

```bash
nerv eva job-user _nervjob /Users/Shared/nerv-eva
```

Expected: `EVA jobs run as _nervjob in /Users/Shared/nerv-eva.`

## Undo

```bash
nerv eva job-user off
sudo rm /etc/sudoers.d/nerv-eva
sudo rm -rf /Users/Shared/nerv-eva
sudo dscl . -delete /Users/_nervjob
```
