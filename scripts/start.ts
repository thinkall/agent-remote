import { spawn } from "child_process";
import fs from "fs";
import path from "path";

// 生成 6 位验证码
function generateAuthCode(): string {
  return Math.random().toString().slice(2, 8);
}

async function main() {
  const authCode = generateAuthCode();
  const authCodePath = path.join(process.cwd(), ".auth-code");

  // 保存验证码到文件
  fs.writeFileSync(authCodePath, authCode);

  console.log("\n" + "=".repeat(60));
  console.log("🚀 Starting OpenCode Remote");
  console.log("=".repeat(60));
  console.log(`\n🔐 Access Code: ${authCode}\n`);

  // 1. 启动 OpenCode Server
  console.log("📦 Starting OpenCode Server...");
  const opencodeProcess = spawn(
    "opencode",
    ["serve", "--hostname", "0.0.0.0", "--port", "4096", "--cors"],
    {
      stdio: "inherit",
      env: { ...process.env },
    },
  );

  // 等待 OpenCode Server 启动
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 2. 启动 Vite 开发服务器
  console.log("🌐 Starting Web UI...");
  const viteProcess = spawn("vite", ["--host", "--port", "5174"], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_OPENCODE_API: "http://localhost:4096",
    },
  });

  console.log("\n" + "=".repeat(60));
  console.log("✅ All services started!");
  console.log("📱 Web UI: http://localhost:5174");
  console.log(`🔐 Use code: ${authCode}`);
  console.log("=".repeat(60) + "\n");

  // 处理退出信号
  const cleanup = () => {
    console.log("\n🛑 Shutting down...");
    opencodeProcess.kill();
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
