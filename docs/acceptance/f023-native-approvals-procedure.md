# F-023: Paired Mac approval card, VoiceOver, and notification acceptance procedure

Goal: verify approval cards, countdown/expiry, VoiceOver labels, and macOS notification banners on the paired Mac.

## Steps (Neo Tokyo-3, Terminal + Companion UI)

1. Confirm the companion is paired and notifications are enabled.
2. Trigger a pending Blue approval card (or run a tool action requiring approval).
   Expected: a macOS notification banner arrives once for the pending approval.
3. Open the companion menu-bar panel and inspect the approval card:
   - Verify tool name, full arguments/diff/recipients, Pattern, Sync Ratio, reason, and remaining TTL countdown are shown.
   - Verify the card is read-only in the companion and opens the web workspace for the decision (no admin token in URL).
4. Turn on VoiceOver (`Cmd + F5`) and navigate through the approval card controls and text.
   Expected: all labels, countdown, and buttons announce clearly in the selected language (EN/IT).
5. Decide the card in the web workspace (or Telegram) and refresh the companion.
   Expected: the decided card disappears from the companion without duplicate notifications.
