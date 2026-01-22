import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import replace from "@rollup/plugin-replace";
import { resolve } from "path";

// Plugin to fix Electron renderer process.env read-only issue
const electronEnvFix = () => {
  return {
    name: "electron-env-fix",
    resolveId(id: string) {
      // Only intercept the exact Vite env module, not any file containing "env.mjs"
      if (id === "/@vite/env") {
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
    minify: "terser",
    sourcemap: process.env.NODE_ENV === "development",
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
      extensions: [".js", ".cjs"],
      ignoreDynamicRequires: true,
    },
    rollupOptions: {
      plugins: [
        replace({
          preventAssignment: true,
          "process.env.NODE_ENV": JSON.stringify(
            process.env.NODE_ENV || "production",
          ),
        }),
      ],
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
    esbuildOptions: {
      mainFields: ["module", "main"],
      resolveExtensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
    },
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
  // Explicitly set empty define to prevent default Vite defines from using esbuild
  define: {},
  // Disable Vite's automatic env variable injection to prevent modifying process.env
  // Electron renderer has read-only process.env, so we handle env vars differently
  envPrefix: "VITE_",
});
