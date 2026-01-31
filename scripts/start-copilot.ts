import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import * as readline from "readline";

const isWindows = process.platform === "win32";

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

// Generate 6-digit auth code
function generateAuthCode(): string {
  return Math.random().toString().slice(2, 8);
}

// Check if a command exists in PATH
function commandExists(command: string): boolean {
  const checkCmd = isWindows ? "where" : "which";
  const result = spawnSync(checkCmd, [command], { stdio: "pipe" });
  return result.status === 0;
}

// Ask user for confirmation
async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${colors.yellow}? ${question} (y/N): ${colors.reset}`, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// Install Copilot CLI
async function installCopilot(): Promise<boolean> {
  console.log(`${colors.cyan}> Installing GitHub Copilot CLI...${colors.reset}`);
  console.log(`${colors.yellow}  Please install manually using one of these methods:${colors.reset}`);
  
  if (isWindows) {
    console.log(`${colors.cyan}  winget install GitHub.Copilot${colors.reset}`);
  } else {
    console.log(`${colors.cyan}  brew install copilot-cli${colors.reset}`);
  }
  console.log(`${colors.cyan}  npm install -g @github/copilot${colors.reset}`);
  
  return false;
}

// Check dependencies
async function checkDependencies(): Promise<boolean> {
  console.log(`\n${colors.cyan}> Checking dependencies...${colors.reset}`);

  // Check copilot
  if (!commandExists("copilot")) {
    console.log(`${colors.red}[x] GitHub Copilot CLI is not installed${colors.reset}`);

    const shouldInstall = await confirm("Show installation instructions?");
    if (shouldInstall) {
      await installCopilot();
    }
    console.log(`${colors.yellow}[!] GitHub Copilot CLI is required${colors.reset}`);
    console.log(`${colors.yellow}    Install it and run bun run start:copilot again${colors.reset}`);
    return false;
  } else {
    console.log(`${colors.green}[ok] GitHub Copilot CLI is installed${colors.reset}`);
  }

  // Hint about cloudflared (optional)
  if (!commandExists("cloudflared")) {
    console.log(`${colors.yellow}[!] Cloudflared is not installed (optional, for public access feature)${colors.reset}`);
    console.log(`${colors.yellow}    Run bun run setup to install${colors.reset}`);
  } else {
    console.log(`${colors.green}[ok] Cloudflared is installed${colors.reset}`);
  }

  return true;
}

async function main() {
  // Check dependencies first
  const depsOk = await checkDependencies();
  if (!depsOk) {
    process.exit(1);
  }

  const authCode = generateAuthCode();
  const authCodePath = path.join(process.cwd(), ".auth-code");

  // Save auth code to file
  fs.writeFileSync(authCodePath, authCode);

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.magenta}${colors.bold}Starting GitHub Copilot Remote${colors.reset}`);
  console.log("=".repeat(60));
  console.log(`\nAccess Code: ${colors.bold}${authCode}${colors.reset}\n`);

  // Environment variables for the bridge
  const bridgePort = "4096";
  const acpPort = "4097";
  const cwd = process.cwd();

  // 1. Start Copilot Bridge Server (which also starts Copilot ACP internally)
  console.log("Starting Copilot Bridge Server...");
  const bridgeProcess = spawn(
    "bun",
    ["run", "scripts/copilot-bridge.ts"],
    {
      stdio: "inherit",
      shell: isWindows,
      env: {
        ...process.env,
        BRIDGE_PORT: bridgePort,
        COPILOT_ACP_PORT: acpPort,
        COPILOT_CWD: cwd,
      },
    },
  );

  // Wait for bridge to start
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 2. Start Vite dev server
  console.log("Starting Web UI...");
  const viteProcess = spawn("vite", ["--host", "--port", "5174"], {
    stdio: "inherit",
    shell: isWindows,
    env: {
      ...process.env,
      VITE_OPENCODE_API: `http://localhost:${bridgePort}`,
      VITE_BACKEND_TYPE: "copilot",
    },
  });

  console.log("\n" + "=".repeat(60));
  console.log(`${colors.green}All services started!${colors.reset}`);
  console.log(`Web UI: ${colors.cyan}http://localhost:5174${colors.reset}`);
  console.log(`Use code: ${colors.bold}${authCode}${colors.reset}`);
  console.log(`Backend: ${colors.magenta}GitHub Copilot${colors.reset}`);
  console.log("=".repeat(60) + "\n");

  // Handle exit signals
  const cleanup = () => {
    console.log("\nShutting down...");
    bridgeProcess.kill();
    viteProcess.kill();
    if (fs.existsSync(authCodePath)) {
      fs.unlinkSync(authCodePath);
    }
    process.exit();
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch(console.error);
