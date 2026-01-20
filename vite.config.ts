import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "path";

// Plugin to fix Electron renderer process.env read-only issue
const electronEnvFix = () => {
  return {
    name: "electron-env-fix",
    resolveId(id: string) {
      // Intercept env.mjs to provide a safe version
      if (id === "/@vite/env" || id.includes("env.mjs")) {
        return "\0electron-env-fix";
      }
      return null;
    },
    load(id: string) {
      // Provide a safe env.mjs that doesn't modify process.env
      if (id === "\0electron-env-fix") {
        return `
          // Electron-safe env module - process.env is read-only in renderer
          // Use import.meta.env instead for Vite env variables
          export const MODE = ${JSON.stringify(process.env.NODE_ENV || "development")};
          export const DEV = ${process.env.NODE_ENV !== "production"};
          export const PROD = ${process.env.NODE_ENV === "production"};
          export const SSR = false;
        `;
      }
      return null;
    },
    transform(code: string, _id: string) {
      // Fix any other code that tries to assign to process.env
      if (code.includes("process.env.NODE_ENV =")) {
        return code.replace(
          /process\.env\.([A-Z_]+)\s*=/g,
          "// process.env.$1 = (read-only in Electron renderer)",
        );
      }
      return null;
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(), // Preserves existing tsconfig path aliases
    electronEnvFix(), // Fix Electron process.env issues
  ],
  root: "src",
  base: "./", // Relative paths for file:// protocol in Electron
  publicDir: "../public",
  build: {
    outDir: "../out",
    emptyOutDir: true,
    target: "chrome120", // Electron uses Chromium
    minify: "esbuild",
    sourcemap: process.env.NODE_ENV === "development",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
      },
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-router": ["@tanstack/react-router"],
          "vendor-ui": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-popover",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
          ],
          "vendor-ai": ["ai", "@ai-sdk/react"],
          "vendor-workflow": ["@xyflow/react"],
          "vendor-editor": [
            "@tiptap/react",
            "@tiptap/starter-kit",
            "@tiptap/extension-mention",
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      ui: resolve(__dirname, "src/components/ui"),
      lib: resolve(__dirname, "src/lib"),
      "app-types": resolve(__dirname, "src/types"),
      auth: resolve(__dirname, "src/lib/auth"),
      logger: resolve(__dirname, "src/lib/logger.ts"),
      "load-env": resolve(__dirname, "src/lib/load-env.ts"),
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "zustand",
      "swr",
      "framer-motion",
      "@tanstack/react-router",
    ],
    exclude: ["electron"],
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  // Disable CSS code splitting for better Electron compatibility
  css: {
    devSourcemap: true,
  },
  // Environment variables
  // In Electron renderer, process.env is read-only, so we use define to replace it at build time
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "development",
    ),
  },
  // Disable Vite's automatic env variable injection to prevent modifying process.env
  // Electron renderer has read-only process.env, so we handle env vars differently
  envPrefix: "VITE_",
});
