# Nodo style guide

Nodo is a local proactive personal agent. Its symbol is now a simple vertical monochrome wrapped marine knot, following the user-selected nautical reference. Keep the editable mark in `web/public/knot.svg`; no stock preview, watermark or generated raster concept is shipped. Reference: https://www.shutterstock.com/image-vector/knot-icon-symbol-design-nautical-260nw-1217085040.jpg . The SVG is a project-local geometric rendition, not a licensed stock download.

Use the tokens in `web/src/styles.css` as the palette source of truth: dark navy surfaces, pale text, muted labels and seafoam actions. The knot itself is one colour. Use system sans-serif for controls and Georgia italic for the introductory line. No remote fonts. Generous spacing, visible focus, persistent labels and explicit error messages. Main copy is calm and concrete. Avoid claims of connected devices or delivered phone notifications unless observed.

The workspace contains stable navigation, reminders, local inbox and diagnostics. GenUI foundations use validated Web Component descriptions; it does not replace navigation or inject executable code. Distinguish planned, configured, connected, observed and failed states.

Italian is the default UI language; English is selectable. Keep messages in web/src/i18n.ts with matching keys. User reminder content is never translated automatically. Browser date inputs and formatted dates use browser local time, explicitly labelled; server configuration defaults to Europe/Rome for future scheduling semantics. Changing the UI language does not reinterpret stored UTC deadlines. CLI command names and raw doctor fields remain technical English.

The status card uses the existing theme tokens through a Shadow DOM. Shadow DOM encapsulates styles; it is not a security boundary. The current surface is deterministic, not LLM-generated. Preserve text escaping and bounded descriptions in every renderer.

The native menu uses a monochrome template drawing of the wrapped-knot geometry, with Italian default and English selection. The scrollable menu displays at most five pending reminders and Mac-local dates. Quit companion leaves the daemon running. Native pairing uses a SecureField; never show or copy the administrative bearer token into the app. Local forget and server revocation are distinct. Native/system error details may retain the OS language.

Notification enablement says “from now”; denied/failed permissions remain visible. Stop Nodo uses a destructive confirmation; Quit companion is a separate action. Service loaded, daemon connected and login enabled/approval-required must be shown as distinct states. Never present OS notification submission as proof the user saw a banner.
