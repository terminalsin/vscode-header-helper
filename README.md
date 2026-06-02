# Header Helper

VS Code extension that turns section header markers into ASCII box comments.

## Usage

Type a marker on its own line:

```javascript
// >[Constants]
```

It expands automatically to:

```javascript
// ╔══════════════════════════════════════════════════════════════════════╗
// ║                              CONSTANTS                               ║
// ╚══════════════════════════════════════════════════════════════════════╝
```

### Editing

- **Click inside the box** — collapses to `// >[your text]` for easy editing.
- **Click outside** — expands back to the ASCII box (re-centered and re-drawn).
- **Edit the box directly** — change the title in the middle line; when the cursor leaves the box, it normalizes to a clean box again.

Also supports `# >[text]` and `/* >[text] */` comment styles.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `headerHelper.innerWidth` | `70` | Inner width between vertical borders |
| `headerHelper.uppercase` | `true` | Uppercase title inside the box |

## Development

```bash
npm install
npm run compile
```

Press F5 in VS Code to launch an Extension Development Host.

## Install

Search **Header Helper** in the VS Code Extensions view, or install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=terminalsin.header-helper).
