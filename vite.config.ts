import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [
    solid(),
    {
      name: "auth-middleware",
      configureServer(server) {
        // 提供验证码验证端点
        server.middlewares.use("/api/auth/verify", (req, res, next) => {
          if (req.method !== "POST") {
            // @ts-ignore
            res.statusCode = 405;
            res.end();
            return;
          }

          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const { code } = JSON.parse(body);
              const authCodePath = path.join(process.cwd(), ".auth-code");

              if (!fs.existsSync(authCodePath)) {
                // @ts-ignore
                res.statusCode = 500;
                res.end(JSON.stringify({ error: "Auth code not found" }));
                return;
              }

              const validCode = fs.readFileSync(authCodePath, "utf-8").trim();

              if (code === validCode) {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ success: true, token: validCode }));
              } else {
                // @ts-ignore
                res.statusCode = 401;
                res.end(JSON.stringify({ error: "Invalid code" }));
              }
            } catch (err) {
              // @ts-ignore
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Bad request" }));
            }
          });
        });
      },
    },
  ],
  server: {
    port: 5174,
    proxy: {
      "/opencode-api": {
        target: "http://localhost:4096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode-api/, ""),
      },
      // Keep SSE connection open
      "/opencode-api/global/event": {
        target: "http://localhost:4096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode-api/, ""),
        timeout: 0,
      },
    },
  },
});
