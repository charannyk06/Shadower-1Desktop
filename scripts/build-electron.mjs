import * as esbuild from "esbuild";
import { glob } from "glob";
import path from "path";
import fs from "fs";

// Find all TypeScript files in electron directory
const entryPoints = await glob("electron/**/*.ts", {
  ignore: ["electron/**/*.d.ts"],
  cwd: process.cwd(),
});

console.log(`Building ${entryPoints.length} electron files...`);

// Clean dist-electron directory
const distDir = "dist-electron";
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}

// List of packages that should remain as external requires (not bundled)
const externalPackages = [
  "electron",
  "electron-squirrel-startup",
  "electron-updater",
  "better-sqlite3",
  "duckdb",
  "onnxruntime-node",
  "@xenova/transformers",
  "chrome-remote-interface",
  "fs-extra",
  "electron-store",
  "drizzle-orm",
  "drizzle-orm/better-sqlite3",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  // agent-browser uses playwright-core which has require.resolve() calls
  // that break when bundled - keep external
  "agent-browser",
  "agent-browser/*",
  // Ollama packages - ollama-js uses whatwg-fetch polyfill that doesn't work
  // properly when bundled in Electron's Node.js context
  "ollama",
  "ai-sdk-ollama",
];

// Helper to resolve a path, trying .ts extension if needed
function resolveWithExtensions(basePath, subPath) {
  const fullPath = path.resolve(basePath, subPath);

  // Check if it's already a file with extension
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return fullPath;
  }

  // Try adding .ts extension
  const tsPath = fullPath + ".ts";
  if (fs.existsSync(tsPath)) {
    return tsPath;
  }

  // Try adding .tsx extension
  const tsxPath = fullPath + ".tsx";
  if (fs.existsSync(tsxPath)) {
    return tsxPath;
  }

  // Try index.ts in the directory
  const indexPath = path.join(fullPath, "index.ts");
  if (fs.existsSync(indexPath)) {
    return indexPath;
  }

  // Return the original path and let esbuild handle the error
  return fullPath;
}

// Path aliases to match tsconfig.json and vite.config.ts
const aliasPlugin = {
  name: "alias",
  setup(build) {
    // Resolve lib/* to src/lib/*
    build.onResolve({ filter: /^lib\// }, (args) => {
      const subPath = args.path.replace(/^lib\//, "");
      return {
        path: resolveWithExtensions(
          path.resolve(process.cwd(), "src/lib"),
          subPath,
        ),
        namespace: "file",
      };
    });

    // Resolve lib (without path) to src/lib
    build.onResolve({ filter: /^lib$/ }, (_args) => {
      return {
        path: resolveWithExtensions(process.cwd(), "src/lib/index"),
        namespace: "file",
      };
    });

    // Resolve @/* to src/*
    build.onResolve({ filter: /^@\// }, (args) => {
      const subPath = args.path.replace(/^@\//, "");
      return {
        path: resolveWithExtensions(
          path.resolve(process.cwd(), "src"),
          subPath,
        ),
        namespace: "file",
      };
    });

    // Resolve ui/* to src/components/ui/*
    build.onResolve({ filter: /^ui\// }, (args) => {
      const subPath = args.path.replace(/^ui\//, "");
      return {
        path: resolveWithExtensions(
          path.resolve(process.cwd(), "src/components/ui"),
          subPath,
        ),
        namespace: "file",
      };
    });

    // Resolve app-types/* to src/types/*
    build.onResolve({ filter: /^app-types\// }, (args) => {
      const subPath = args.path.replace(/^app-types\//, "");
      return {
        path: resolveWithExtensions(
          path.resolve(process.cwd(), "src/types"),
          subPath,
        ),
        namespace: "file",
      };
    });

    // Resolve logger to src/lib/logger.ts
    build.onResolve({ filter: /^logger$/ }, (_args) => {
      return {
        path: path.resolve(process.cwd(), "src/lib/logger.ts"),
        namespace: "file",
      };
    });

    // Resolve auth/* to src/lib/auth/*
    build.onResolve({ filter: /^auth\// }, (args) => {
      const subPath = args.path.replace(/^auth\//, "");
      return {
        path: resolveWithExtensions(
          path.resolve(process.cwd(), "src/lib/auth"),
          subPath,
        ),
        namespace: "file",
      };
    });

    // Resolve load-env to src/lib/load-env.ts
    build.onResolve({ filter: /^load-env$/ }, (_args) => {
      return {
        path: path.resolve(process.cwd(), "src/lib/load-env.ts"),
        namespace: "file",
      };
    });
  },
};

try {
  // Build main and preload as bundled entry points with .cjs extension
  await esbuild.build({
    entryPoints: ["electron/main.ts", "electron/preload.ts"],
    outdir: "dist-electron/electron",
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    sourcemap: true,
    external: externalPackages,
    logLevel: "info",
    outExtension: { ".js": ".cjs" },
    plugins: [aliasPlugin],
  });

  // Note: All IPC handlers and services are now statically imported in main.ts
  // and bundled together, so we don't need to build them separately.
  // This was causing issues with module resolution for unbundled files.

  // Create a package.json in dist-electron to override "type": "module"
  fs.writeFileSync(
    path.join(distDir, "package.json"),
    JSON.stringify({ type: "commonjs" }, null, 2),
  );

  console.log("Electron build completed successfully!");
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
