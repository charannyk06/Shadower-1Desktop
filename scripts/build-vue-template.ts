/**
 * Build Vue/Vite template for E2B
 * Run with: npx tsx scripts/build-vue-template.ts
 */

import { Template, defaultBuildLogger, waitForPort } from "e2b";
import "dotenv/config";

const E2B_API_KEY = process.env.E2B_API_KEY;

if (!E2B_API_KEY) {
  console.error("❌ E2B_API_KEY not set in environment");
  process.exit(1);
}

console.log("🚀 Building Vue/Vite template...\n");

// Simple Vue + Vite template (no Tailwind to keep it simple and fast)
const vueTemplate = Template()
  .fromNodeImage("22-slim")
  .aptInstall(["curl", "git"])
  .setWorkdir("/home/user")
  // Create a Vue + Vite project
  .runCmd("npm create vite@latest my-vue-app -- --template vue-ts")
  .runCmd("cd my-vue-app && npm install")
  // Move files to /home/user
  .runCmd("cp -r my-vue-app/* . 2>/dev/null || true")
  .runCmd("cp -r my-vue-app/.* . 2>/dev/null || true")
  .runCmd("rm -rf my-vue-app")
  // Configure Vite to listen on 0.0.0.0
  .runCmd(`cat > vite.config.ts << 'VITECONFIG'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 3000
  }
})
VITECONFIG`)
  .setStartCmd("npm run dev", waitForPort(3000));

async function main() {
  console.log("📦 Building template: shadower-vue");
  console.log("━".repeat(50));

  try {
    const result = await Template.build(vueTemplate, {
      alias: "shadower-vue",
      cpuCount: 2,
      memoryMB: 2048,
      onBuildLogs: defaultBuildLogger(),
    });

    console.log(`\n✅ Template shadower-vue built successfully!`);
    console.log(`   Template ID: ${result.templateId}`);
    console.log(`   Alias: shadower-vue`);
  } catch (error: any) {
    console.error(`\n❌ Failed: ${error.message}`);
    throw error;
  }
}

main().catch(console.error);
