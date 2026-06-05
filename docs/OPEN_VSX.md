# Publishing to Open VSX

[Open VSX](https://open-vsx.org/) is the extension registry used by VSCodium, Gitpod, Eclipse Theia, and other VS Code–compatible editors.

Publisher namespace: **blackswan** (must match `publisher` in `package.json`).

## One-time setup

1. Sign in at [open-vsx.org](https://open-vsx.org/) (GitHub login).
2. Sign the [Eclipse Contributor Agreement](https://www.eclipse.org/legal/eca/) if prompted (required for publishing).
3. Create the namespace (first time only):
   - [User settings → Namespaces](https://open-vsx.org/user-settings/namespaces), or
   - CLI: `npx ovsx create-namespace blackswan -p YOUR_TOKEN`
4. Create a [Personal Access Token](https://open-vsx.org/user-settings/tokens) with publish scope.

## Publish from your machine

```bash
cd /path/to/vscode-header-helper
npm ci
export OVSX_PAT=your_token_here   # or: npx ovsx publish -p your_token_here
npm run publish:openvsx
```

To publish an existing VSIX:

```bash
npx ovsx publish header-helper-0.2.0.vsix -p YOUR_TOKEN
```

## Publish via GitHub Actions

1. Create a [Personal Access Token](https://open-vsx.org/user-settings/tokens) with publish scope for namespace **blackswan**.
2. Add repository secret **OVSX_PAT** (GitHub repo → Settings → Secrets and variables → Actions → New repository secret).
3. Push a version tag or run the workflow manually:
   - Tag: `git tag v0.2.1 && git push origin v0.2.1`
   - Manual: Actions → **Publish to Open VSX** → **Run workflow**

The workflow fails fast if `OVSX_PAT` is missing. After a successful run, confirm the version at:

https://open-vsx.org/api/blackswan/header-helper/versions

After publish, the extension appears at:

https://open-vsx.org/extension/blackswan/header-helper
