# F-085-T03: project report on two real projects, owner procedure

Checks the read-only report on one repository and one web page. NERV clones or fetches into a discarded quarantine folder and runs no code from it. Pick a public repository and a public page you know well, so you can tell what is missing. About 10 minutes.

```bash
# 1. A repository (replace the URL with one you know).
nerv quarantine report https://github.com/<owner>/<repo> --kind repo
```
Expected: JSON with what it is, recent activity, licence, how to build and test, and visible risks; every claim cites a file. Nothing is installed or run.

```bash
# 2. A web page (replace the URL).
nerv quarantine report https://<site>/<page> --kind page
```
Expected: the same sections where they apply, each citing the page; missing facts are said to be missing, not guessed.

Paste both outputs back, with one line on what was missing or wrong; the agent records them in this folder and closes F-085-T03.
