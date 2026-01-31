<div align="center">

# OpenCode Remote

**[English](./README.md)** | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

**Access OpenCode or GitHub Copilot CLI from Any Device, Anywhere**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-1.1.15+-green.svg)](https://opencode.ai)
[![Copilot CLI](https://img.shields.io/badge/Copilot%20CLI-Supported-purple.svg)](https://docs.github.com/copilot/concepts/agents/about-copilot-cli)

<img src="https://opencode.ai/logo.svg" alt="OpenCode Remote" width="120" />

*Use your powerful workstation to run AI coding agents while accessing them from a tablet, phone, or any browser — even across the internet.*

**Now with GitHub Copilot CLI support!** 🎉

</div>

---

## Why OpenCode Remote?

AI coding agents like OpenCode and GitHub Copilot CLI need to run on machines with:
- Access to your codebase and development environment
- Proper API keys and configurations
- Sufficient computing power

But what if you want to **use your phone on the couch**, **pair program from an iPad**, or **access your dev machine from anywhere in the world**?

**OpenCode Remote** solves this by providing a desktop app and web interface that works from any device with a browser.

### Supported Backends

| Backend | Description |
|---------|-------------|
| **OpenCode** | The open-source AI coding agent from opencode.ai |
| **GitHub Copilot CLI** | GitHub's official AI coding agent (requires Copilot subscription) |

### Key Features

| Feature | Description |
|---------|-------------|
| **Desktop App** | Native Electron app for macOS and Windows with bundled OpenCode and Cloudflare Tunnel |
| **Remote Access from Any Device** | Access OpenCode through a clean web UI from phones, tablets, laptops — any device with a browser |
| **One-Click Public Tunnel** | Enable internet access with a single toggle using Cloudflare Tunnel — no port forwarding or VPN needed |
| **LAN Access** | Instantly accessible from any device on your local network |
| **QR Code Connection** | Scan to connect from mobile devices — no typing URLs |
| **Device Management** | Manage connected devices, rename them, or revoke access |
| **Secure by Default** | Device-based authentication with secure token storage |
| **Real-time Streaming** | Live message streaming via Server-Sent Events |

---

## Quick Start

### Option 1: Desktop App (Recommended)

Download the latest release for your platform:

- **macOS (Apple Silicon)**: `OpenCode Remote-x.x.x-arm64.dmg`
- **macOS (Intel)**: `OpenCode Remote-x.x.x-x64.dmg`
- **Windows**: `OpenCode Remote-x.x.x-setup.exe`

The desktop app bundles everything you need — no additional installation required.

### Option 2: Development Mode

#### With OpenCode Backend

```bash
# Clone the repository
git clone https://github.com/realDuang/opencode-remote.git
cd opencode-remote

# Install dependencies
bun install

# Download bundled binaries
bun run update:opencode
bun run update:cloudflared

# Start in development mode
bun run dev
```

#### With GitHub Copilot CLI Backend

```bash
# Clone the repository
git clone https://github.com/realDuang/opencode-remote.git
cd opencode-remote

# Install dependencies
bun install

# Make sure GitHub Copilot CLI is installed and authenticated
# Install: npm install -g @github/copilot
# Or: brew install copilot-cli (macOS)
# Or: winget install GitHub.Copilot (Windows)
# Then authenticate: copilot (follow the login prompts)

# Start with Copilot backend
bun run start:copilot
```

> **Note:** GitHub Copilot CLI requires an active [Copilot subscription](https://github.com/features/copilot/plans). The Copilot backend uses the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) to communicate with the CLI.

---

## Remote Access Guide

### Method 1: LAN Access (Same Network)

Access from any device on your local network:

1. Open the desktop app and go to the **Remote Access** section
2. Find your machine's IP address displayed on the page
3. Open `http://<your-ip>:5173` from another device
4. Authenticate with the device code

**Or scan the QR code** displayed on the Remote Access page.

### Method 2: Public Internet Access

Access from anywhere in the world with Cloudflare Tunnel:

1. Go to **Remote Access** in the desktop app
2. Toggle on **"Public Access"**
3. Share the generated `*.trycloudflare.com` URL

**No port forwarding, no firewall changes, no VPN required.**

```
┌──────────────────────────────────────────────────────────┐
│                    Your Phone/Tablet                      │
│                          ↓                                │
│              https://xyz.trycloudflare.com                │
│                          ↓                                │
│                  Cloudflare Network                       │
│                          ↓                                │
│              Your Workstation (OpenCode)                  │
└──────────────────────────────────────────────────────────┘
```

---

## Device Management

The desktop app includes a device management system:

- **View connected devices**: See all devices that have accessed your OpenCode instance
- **Rename devices**: Give meaningful names to your devices
- **Revoke access**: Remove devices you no longer want to have access
- **Revoke all others**: Quickly revoke access from all devices except the current one

---

## Development

### Commands

```bash
# Start in development mode (Electron + Vite HMR)
bun run dev

# Start with OpenCode backend (web mode)
bun run start

# Start with GitHub Copilot CLI backend (web mode)
bun run start:copilot

# Build for production
bun run build

# Package for distribution
bun run dist:mac:arm64  # macOS Apple Silicon
bun run dist:mac:x64    # macOS Intel
bun run dist:win        # Windows

# Update bundled binaries
bun run update:opencode
bun run update:cloudflared

# Type checking
bun run typecheck
```

### Project Structure

```
opencode-remote/
├── electron/
│   ├── main/              # Electron main process
│   │   ├── services/      # OpenCode process, tunnel, device store
│   │   └── ipc-handlers.ts
│   └── preload/           # Preload scripts for IPC
├── src/
│   ├── pages/             # Page components (Chat, Settings, Devices)
│   ├── components/        # UI components
│   ├── lib/               # Core libraries (API client, auth, i18n)
│   ├── stores/            # State management
│   └── types/             # TypeScript definitions (incl. Copilot ACP types)
├── scripts/
│   ├── start.ts           # OpenCode web mode startup
│   ├── start-copilot.ts   # Copilot CLI web mode startup
│   ├── copilot-bridge.ts  # ACP to REST bridge server
│   ├── update-opencode.ts # Download OpenCode binary
│   └── update-cloudflared.ts
├── electron.vite.config.ts
└── electron-builder.yml
```

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Electron + SolidJS |
| Build Tool | electron-vite |
| Styling | Tailwind CSS v4 |
| Language | TypeScript |
| Package Manager | Bun |
| Tunnel | Cloudflare Tunnel |

---

## Security

OpenCode Remote uses multiple layers of security:

| Layer | Protection |
|-------|------------|
| **Device Auth** | Each device must be authorized to access |
| **Token Auth** | Secure tokens stored per-device |
| **HTTPS** | Public tunnel automatically uses HTTPS via Cloudflare |
| **Ephemeral URLs** | Public tunnel URLs change each time you start the tunnel |

**Best Practices:**
- Revoke access from devices you no longer use
- Disable public tunnel when not needed
- Use for personal use only — not designed for multi-user scenarios

---

## Troubleshooting

### OpenCode binary not found

```bash
# Download the latest OpenCode binary
bun run update:opencode
```

### Public tunnel not working

```bash
# Download cloudflared binary
bun run update:cloudflared
```

### Build fails on Windows

Ensure you have the required build tools installed for Electron.

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

### Code Style
- TypeScript strict mode
- SolidJS reactive patterns
- Tailwind for styling

### Commit Convention
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation
- `refactor:` Code refactoring

---

## License

[MIT](LICENSE)

---

## Links

- [OpenCode](https://opencode.ai) — The AI coding agent
- [OpenCode Documentation](https://opencode.ai/docs) — OpenCode documentation
- [GitHub Copilot CLI](https://docs.github.com/copilot/concepts/agents/about-copilot-cli) — GitHub Copilot CLI documentation
- [Agent Client Protocol](https://agentclientprotocol.com/) — Protocol used for Copilot CLI integration
- [Issues](https://github.com/realDuang/opencode-remote/issues) — Report bugs or request features

---

<div align="center">

**Built with [OpenCode](https://opencode.ai), [GitHub Copilot](https://github.com/features/copilot), [Electron](https://electronjs.org) and [SolidJS](https://solidjs.com)**

</div>
