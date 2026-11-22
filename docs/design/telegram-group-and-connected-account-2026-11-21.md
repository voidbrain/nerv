# Telegram Multi-Bot Group & Connected-Account Assessment

**Date:** 2026-11-21  
**Scope:** Assessment for multi-bot Telegram groups, welcome/common-action panels, and connected-business-bot / user-client messaging.

## Current Authorization Boundary

In `src/telegram.ts`, `TelegramChannel` enforces a strict single-owner private-chat boundary:

1. Outbound and inbound authorization is pinned to a single numeric `config.telegram.chatId`.
2. `startChats()` and `handleUpdate()` accept owner commands, callbacks, and photo uploads only from that private chat (`from.id === this.chatId`).
3. All slash commands in `COMMAND_CATALOG` (`src/chat-command.ts`) are registered via `setMyCommands` (`telegramCommands()`) and routed deterministically before Misato/dispatch (`readCommand()` already supports `/cmd@BotName` suffixes).

**Invariant:** Private-chat authorization is **not widened** by this assessment. Any group or connected-account capability requires an explicit owner decision and separate configuration before implementation.

## Option 1: Multi-Bot Telegram Group

One shared Telegram group containing the bots for each enrolled base (for example `NERV-01` and `NERV-02`), plus a pinned welcome/common-action panel and `/cmd@BotName` slash menus generated from `COMMAND_CATALOG`.

| Aspect | Assessment |
|---|---|
| **Slash menus & targeting** | `COMMAND_CATALOG` and `telegramCommands()` already generate bot menus; `readCommand()` already parses `/cmd@BotName`. Each base bot can register the same catalog and answer only when addressed directly (`/status@BaseBot`). |
| **Welcome / common-action panel** | A pinned message with inline buttons for read-only actions (`/status`, `/cards`, `/reminders`, `/bases`) is feasible using the existing `TelegramApi.send` inline keyboard support, without widening write authority. |
| **Authorization risk** | Group messages arrive with `chat.id = groupId` (negative) and `from.id = senderId`. Accepting `chat.id === groupId` without checking `from.id === ownerChatId` would let any group member run commands or tap approval buttons. |
| **Delivery noise** | With multiple bots in one group, `one-channel` main-base outbound delivery must remain the single sender for shared briefs/reminders so the group does not receive N duplicates. |

**Guardrails if ever adopted:**
- Require explicit opt-in (`telegram.groupChatId`), never auto-enrolling groups from `getUpdates`.
- Verify `m.from?.id === this.chatId` (and `q.from.id === this.chatId`) on every group message and callback query.
- Keep `private` owner chat as the sole channel for sensitive approvals or require `/cmd@BotName` explicit addressing.

## Option 2: Connected Business Bot or User-Client Messaging

Messaging through an official Telegram Business Bot connection or a separately authorized user-client session (MTProto).

| Option | Assessment |
|---|---|
| **Official Telegram Business Bot** | Supported via Bot API `business_connection_id` without sharing the owner's user session. Authority is scoped by Telegram's Business permissions and remains auditable per bot token. Would require explicit `business_connection_id` handling and owner-only sender verification (`from.id === ownerChatId`). |
| **Separately authorized user-client (MTProto)** | Acts as the owner's personal account across all chats, widening blast radius far beyond a bot token and introducing session/2FA lifecycle management outside NERV's Bot API client. |
| **Ambient browser session impersonation** | **Rejected.** Driving an ambient Telegram Web browser session or reusing browser cookies/storage to impersonate the owner bypasses explicit API authorization and violates NERV's credential and boundary rules. |

## Recommendation

1. **Keep the current private-owner-chat boundary unchanged** — no silent widening.
2. Defer multi-bot group support until the owner explicitly asks for it; if requested, gate it behind `telegram.groupChatId` + strict `from.id === ownerChatId` + `@BotName` addressing.
3. Prefer the official **Telegram Business Bot API** over a user-client session if external chat integration is ever needed, and **never** impersonate the owner through an ambient browser session.
