# Nodo style guide

Nodo is a local proactive personal agent. Its symbol is a vertical marine knot, monochrome, with coarse Game Boy-like pixels and minimal detail. Keep the editable icon in `web/public/knot.svg`; the generated concept is a design reference, not an exact pixel grid.

Use the tokens in `web/src/styles.css` as the palette source of truth: dark navy surfaces, pale text, muted labels and seafoam actions. The knot itself is one colour. Use system sans-serif for controls and Georgia italic for the introductory line. No remote fonts. Generous spacing, visible focus, persistent labels and explicit error messages. Main copy is calm and concrete. Avoid claims of connected devices or delivered phone notifications unless observed.

The workspace contains stable navigation, reminders, local inbox and diagnostics. Future GenUI uses validated component descriptions; it does not replace navigation or inject executable code. Distinguish planned, configured, connected, observed and failed states.
