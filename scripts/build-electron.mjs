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
];

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
  });

  // Build other files without bundling
  const otherFiles = entryPoints.filter(
    (f) => !f.endsWith("main.ts") && !f.endsWith("preload.ts"),
  );

  if (otherFiles.length > 0) {
    await esbuild.build({
      entryPoints: otherFiles,
      outdir: "dist-electron",
      bundle: false,
      platform: "node",
      target: "node18",
      format: "cjs",
      sourcemap: true,
      outbase: ".",
      logLevel: "info",
      outExtension: { ".js": ".cjs" },
    });
  }

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
