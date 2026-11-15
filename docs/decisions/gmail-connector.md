# Gmail Connector, Scopes and Credentials (F-086-T01)

Date: 2026-11-15  
Status: Accepted (decision for F-086)

## 1. Connector Choice & Pinned Version

- **Connector**: Direct **Gmail REST API v1** (`https://gmail.googleapis.com/gmail/v1`, pinned API version `v1`, OAuth 2.0 token endpoint `https://oauth2.googleapis.com/token`) implemented as a narrow NERV connector module rather than an unpinned third-party MCP server.
- **Why**: Zero external npm/MCP supply-chain dependencies, exact control over request/response fields, and guaranteed `tainted: true` provenance tagging on every fetched message before any model sees it.

## 2. Scopes & Gate Classes (Read-Only First)

1. **Phase 1 (Read-only default)**: Request only the narrowest read scope:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - Supports searching threads/messages and reading headers/bodies.
   - All fetched mail subjects, senders, and bodies are marked `tainted: true` (`F-027`) and treated strictly as untrusted data, never instructions.
2. **Phase 2 (Drafts — Orange)**: Requires explicit owner opt-in to add `https://www.googleapis.com/auth/gmail.compose` (not `mail.google.com`). Creating a draft is an **Orange** action gated behind an owner approval card.
3. **Phase 3 (Send — Blue)**: Sending mail is a **Blue** action requiring explicit owner approval on an approval card showing recipient, subject, and full body before any `messages.send` call runs.

## 3. Credential Storage & Rotation (F-066)

- OAuth client ID/secret and refresh/access tokens are stored exclusively under **F-066** (NERV's local mode-`0600` credential store outside Git and outside model-readable workspaces).
- Credentials are never written to `config.json`, Git, logs, or error messages, and are never mounted into coding or quarantine sandboxes (`eva-01`..`eva-03`).
- Token refresh and rotation follow `F-066` rotation/expiry tracking (`credentialAges`).
