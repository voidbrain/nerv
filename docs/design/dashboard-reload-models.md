# Reload models: keep, move or remove (decision)

Owner question, 2026-11-26, on the dashboard line "Edited config.json? Apply it without a restart." and its **Reload models** button.

## What it does

- It asks the running service to re-read the models part of `config.json`. If the file is invalid the old settings stay in use and the dashboard says so.
- Nothing watches the file. After a hand edit, this button, `nerv reload` or a restart are the only ways to apply it.
- The model picker in settings already saves and applies its own changes; it does not need the button.

## Options

1. **Keep** where it is: one more line on the Health card for something done rarely.
2. **Move to an Advanced section** in settings, collapsed, with the text "Re-read the model settings from config.json" (recommended: the button stays for hand edits, the Health card is shorter).
3. **Remove**: owners then use `nerv reload` or restart after a hand edit.

## Reply

Send "reload: keep", "reload: advanced" or "reload: remove" in chat. The answer is recorded in F-152-T03.
