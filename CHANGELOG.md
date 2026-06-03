# Change Log

## 0.2.0

- Defer expanding `// >[text]` until the marker has a closing `]` and the cursor leaves the line (or the editor blurs)
- Multi-line markers, per-line `{length,align,uppercase}` overrides, and safe delete inside `[...]`
- Click-to-edit collapse/expand with no dirty buffer when the title is unchanged
- Cursor placed below the box when leaving collapsed edit mode; Down-arrow no longer lands on the bottom border
- Settings: `headerHelper.length`, `headerHelper.align`, `headerHelper.uppercase` (default uppercase off)

## 0.1.0

- Multi-line headers: consecutive `// >` lines expand to a box with one row per line
- Initial release
- Expand `// >[text]` (and `#`, `/* */` variants) into ASCII box headers
- Collapse to marker on focus for editing; re-expand on blur
- Settings: `headerHelper.length`, `headerHelper.align`, `headerHelper.uppercase`
