# Prompt caching and actual cost

Read when you compare prompt caching or model cost. Moved from [task context](task-context.md) unchanged (F-078).

## Prompt caching and actual cost

Keep stable governing instructions in authoritative files and load only applicable task context. Where an authorized host adapter controls prompt construction, reuse stable instruction prefixes and keep dynamic task data separate. This guide does not configure a provider cache, promise cache hits, store private prompts externally or remove applicable rules to shorten input.

Prompt caching and compaction are different operations. Cached input can still be processed/billed, compaction has work of its own, and a fresh thread must reload essential instructions. Fewer visible messages or a shorter summary is not proof of lower total spend. Measure provider-reported input/output/cached usage, context preparation and repeated reads when available; missing usage remains unknown. Keep actual totals separate from savings estimates and compare similar tasks/configurations. Useful context continuity can cost less than repeatedly reconstructing an unfinished task.

For a host exposing them, official OpenAI documentation describes [fresh threads and compaction](https://learn.chatgpt.com/docs/app-server) and [provider prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching). These are capability examples, not a required provider, installation or a guarantee that those APIs are available in the current session.
