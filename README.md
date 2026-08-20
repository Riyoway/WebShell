# WebShell

A minimal Alpine Linux shell that runs directly in the browser with CheerpX.

There is no desktop, app UI, multiplexer, or preinstalled user package set. The bundled production image is built from the Alpine Linux x86 minirootfs and boots directly into `/bin/sh` as root.

## Features

- Browser-only runtime (CSR)
- Alpine Linux x86 minirootfs
- Direct BusyBox `ash` / `/bin/sh` shell
- Persistent writable overlay in IndexedDB
- Tailscale networking through CheerpX
- Public Internet access through a Tailnet Exit Node
- PWA support
- Responsive full-screen xterm.js terminal
- WebGL terminal renderer with automatic fallback
- No server-side application runtime or Vercel Functions

## Development

```bash
npm install
npm run dev
```

If `public/webshell.ext2` is absent, development uses the public Alpine WebVM cloud image, so Windows development does not require WSL just to run the dev server.

## Production build

On Linux/WSL:

```bash
npm install
npm run build
```

`npm run build` creates `public/webshell.ext2` from Alpine minirootfs when it does not already exist.

Vercel can build the image automatically using the `installCommand` in `vercel.json`.

## Networking

WebShell uses the CheerpX Tailscale network interface. On first use, the terminal asks you to authenticate with Tailscale. Later boots reuse the browser-side Tailscale state when possible.

For public Internet access, your Tailnet must contain an online, allowed Exit Node. WebShell waits for an advertised Exit Node before starting the shell. DNS is configured with Google Public DNS after networking is ready.

The guest hostname is set to `Riyo-WebShell`. The display name shown by Tailscale itself can still be controlled by CheerpX/Tailscale and may need to be renamed once from the Tailscale admin console.

## Minimal image

The image builder intentionally does not run `apk add`. You start with Alpine minirootfs only. After networking is available, install anything you want yourself:

```sh
apk update
apk add git curl
```

Changes are written to the browser's IndexedDB overlay rather than the immutable base image.

## License

WebShell source code is MIT licensed. CheerpX is proprietary software provided separately by Leaning Technologies and is not covered by this repository's MIT license. Alpine Linux and xterm.js are distributed under their own licenses. See `THIRD_PARTY_NOTICES.md`.
