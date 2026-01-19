import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Next.js Configuration for Electron-Only Application
 *
 * This application is Electron-only. We always export static files.
 * No web server mode is supported.
 */
export default () => {
  const nextConfig: NextConfig = {
    // Only use static export in production builds
    // In development, we need dynamic rendering for pages with force-dynamic
    ...(process.env.NODE_ENV === "production" && { output: "export" }),
    cleanDistDir: true,
    // Always use Electron-optimized settings
    images: {
      unoptimized: true,
    },
    trailingSlash: true,
    devIndicators: {
      position: "bottom-right",
    },
    env: {
      NO_HTTPS: process.env.NO_HTTPS,
    },
    turbopack: {
      root: process.cwd(),
    },
    experimental: {
      taint: true,
      authInterrupts: true,
    },
    serverExternalPackages: [
      "pino",
      "pino-pretty",
      "thread-stream",
      "drizzle-orm",
      "better-sqlite3", // SQLite for local database
      "duckdb", // DuckDB for vector search
      "onnxruntime-node", // Local embeddings
      "@xenova/transformers", // Local embeddings
      "chrome-remote-interface", // Chrome DevTools protocol
    ],
    // Handle pino/thread-stream test file imports from stagehand
    webpack: (config, { isServer }) => {
      if (isServer) {
        // Externalize packages that have issues with Next.js bundling
        config.externals = config.externals || [];
        config.externals.push({
          "thread-stream": "commonjs thread-stream",
          pino: "commonjs pino",
          "pino-pretty": "commonjs pino-pretty",
        });
        // Ignore Electron service imports that don't exist in Next.js build
        config.externals.push({
          "../../../../electron/services/chrome-devtools":
            "commonjs electron-services-chrome-devtools",
        });
      }
      return config;
    },
    async headers() {
      return [
        {
          // Apply headers to all routes
          source: "/:path*",
          headers: [
            {
              key: "X-Frame-Options",
              value: "SAMEORIGIN", // Allow iframes from same origin (needed for theater mode preview)
            },
            {
              key: "Content-Security-Policy",
              value: [
                "default-src 'self'",
                // NOTE: 'unsafe-inline' 'unsafe-eval' needed for CSS-in-JS (Tailwind) and dynamic scripts
                // Allow CDNs for fragment previews (Tailwind CDN, Chart.js, etc.)
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com",
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
                "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
                "img-src 'self' data: https: blob: file:",
                // Allow connections for API services
                "connect-src 'self' https: wss: ws:",
                // Allow iframes for previews (office, docs, etc.)
                "frame-src 'self' blob: file: https://view.officeapps.live.com https://docs.google.com",
                "frame-ancestors 'self'", // Prevent clickjacking
                "object-src 'none'", // Block plugins (Flash, Java, etc.)
                "base-uri 'self'", // Prevent base tag hijacking
                "form-action 'self'", // Restrict form submissions
                "worker-src 'self' blob:", // Allow web workers
                "upgrade-insecure-requests", // Force HTTPS
              ].join("; "),
            },
            {
              // Permissions policy for camera/microphone (if desktop preview needs them)
              key: "Permissions-Policy",
              value: "camera=(), microphone=(), geolocation=()",
            },
          ],
        },
        {
          // Browser stream endpoint needs to allow SSE
          source: "/api/browser/stream",
          headers: [
            {
              key: "Cache-Control",
              value: "no-cache, no-transform",
            },
            {
              key: "X-Accel-Buffering",
              value: "no", // Disable buffering for SSE
            },
          ],
        },
      ];
    },
  };
  const withNextIntl = createNextIntlPlugin();
  return withNextIntl(nextConfig);
};
