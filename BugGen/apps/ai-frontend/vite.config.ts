import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function getPortFromUrl(maybeUrl: string | undefined, fallback: number) {
  if (!maybeUrl) return fallback;
  try {
    const u = new URL(maybeUrl);
    const p = Number(u.port);
    return Number.isFinite(p) && p > 0 ? p : fallback;
  } catch {
    const p = Number(maybeUrl);
    return Number.isFinite(p) && p > 0 ? p : fallback;
  }
}

export default defineConfig(({ mode }) => {
  const envDir = "../../";
  const env = loadEnv(mode, envDir, "");

  const aiBePort = env.AI_BE_PORT || "4000";
  const jiraZephyrPort = env.JIRA_ZEPHYR_PORT || "3006";
  const frontendPort = getPortFromUrl(env.AI_FRONTEND_PORT, 5173);

  return {
    envDir,
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(`http://localhost:${aiBePort}`),
      "import.meta.env.VITE_ZEPHYR_APP_URL": JSON.stringify(`http://localhost:${jiraZephyrPort}`)
    },
    server: {
      port: frontendPort,
      proxy: {
        "/api": {
          target: `http://localhost:${aiBePort}`,
          changeOrigin: true
        },
        "/ai-api": {
          target: `http://localhost:${aiBePort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ai-api/, "")
        },
        "/zephyr-api": {
          target: `http://localhost:${aiBePort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/zephyr-api/, "")
        }
      }
    }
  };
});
