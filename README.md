# Header Helper

VS Code extension that turns section header markers into ASCII box comments.

Install from [Open VSX](https://open-vsx.org/extension/terminalsin/header-helper) (VSCodium, Gitpod, etc.) or build from source.

## Usage

Type one or more consecutive marker lines (each must start with `// >`):

```javascript
// >[Constants]

// >[Small header]{length:30,align:left}

// >[Line one]
// >[Line two]
// >[Line three]{length:50,align:left}
```

You can also omit brackets: `// > Constants` (options still go on the last line as `{length:30,...}`).

Per-header options in `{...}` override workspace settings: `length` (20–120), `align` (`center` | `left` | `right`), `uppercase` (`true` | `false`). `width` is an alias for `length`.

When the marker is complete (`]` closed) and you move the cursor away, it expands to:

```javascript
// ╔══════════════════════════════════════════════════════════════════════╗
// ║                              Constants                               ║
// ╚══════════════════════════════════════════════════════════════════════╝
```

Set `"headerHelper.uppercase": true` to render titles in all caps inside the box.

### Editing

- **Click inside the box** — collapses to `// >[your text]` for easy editing. Press **Enter** to add another `// >[` line with the cursor inside the brackets.
- **Click outside** — saves your title and expands back to the ASCII box (also when switching files or leaving the window).
- **Edit the box directly** — change the title in the middle line; when the cursor leaves the box, it normalizes to a clean box again.
- **Safe delete** — while editing the marker (`// >[text]`) or the box title line, Backspace, Delete, and ⌘←/⌘→ delete only the title characters, not `// >[` or the box borders.

Also supports `# >[text]` and `/* >[text] */` comment styles.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `headerHelper.length` | `70` | Inner width between vertical borders (20–120) |
| `headerHelper.align` | `center` | Title alignment: `center`, `left`, or `right` |
| `headerHelper.uppercase` | `false` | Uppercase the title inside the box only (marker text unchanged) |

Example:

```json
{
  "headerHelper.length": 70,
  "headerHelper.align": "left",
  "headerHelper.uppercase": true
}
```

## Development

```bash
npm install
npm run compile
```

Press F5 in VS Code to launch an Extension Development Host.

## Install

Search **Header Helper** in the VS Code Extensions view, or install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=terminalsin.header-helper).
