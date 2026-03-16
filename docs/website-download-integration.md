# Shadower Desktop Download Integration Guide

This guide explains how to integrate download buttons for Shadower Desktop on your website (shadower.io).

## Quick Start

### Option 1: Using the Download Script (Recommended)

Include the download script and use data attributes:

```html
<!-- Include the download helper script -->
<script src="https://cdn.jsdelivr.net/gh/shadower-app/Shadower-Desktop@main/public/downloads/shadower-downloads.js"></script>

<!-- Download buttons with data attributes -->
<button data-download="windows">
  <span>Download for Windows</span>
</button>

<button data-download="mac">
  <span>Download for macOS</span>
</button>

<!-- Initialize on page load -->
<script>
  document.addEventListener('DOMContentLoaded', function() {
    ShadowerDownloads.init();
  });
</script>
```

### Option 2: Direct Function Calls

```html
<script src="https://cdn.jsdelivr.net/gh/shadower-app/Shadower-Desktop@main/public/downloads/shadower-downloads.js"></script>

<button onclick="ShadowerDownloads.download('windows')">
  Download for Windows
</button>

<button onclick="ShadowerDownloads.download('mac')">
  Download for macOS
</button>
```

### Option 3: Static Links (No JavaScript Required)

Use GitHub's release redirect feature for simple static links:

```html
<!-- These always point to the latest release -->
<a href="https://github.com/shadower-app/Shadower-Desktop/releases/latest">
  Download Shadower
</a>
```

## API Reference

### `ShadowerDownloads.download(platform)`

Downloads the app for the specified platform.

```javascript
// Download for Windows
ShadowerDownloads.download('windows');

// Download for macOS (auto-detects ARM vs Intel)
ShadowerDownloads.download('mac');

// Download for Linux
ShadowerDownloads.download('linux');

// Auto-detect user's platform
ShadowerDownloads.download('auto');
```

### `ShadowerDownloads.getAllDownloads()`

Returns all available download URLs:

```javascript
const downloads = await ShadowerDownloads.getAllDownloads();
console.log(downloads);
// {
//   version: "1.0.0",
//   releaseDate: "2025-01-30T...",
//   windows: "https://github.com/.../Shadower-Setup-1.0.0.exe",
//   macArm64: "https://github.com/.../Shadower-1.0.0-arm64.dmg",
//   macX64: "https://github.com/.../Shadower-1.0.0-x64.dmg",
//   linux: "https://github.com/.../Shadower-1.0.0.AppImage",
//   releasePage: "https://github.com/.../releases/tag/v1.0.0"
// }
```

### `ShadowerDownloads.detectOS()`

Returns the user's operating system:

```javascript
const os = ShadowerDownloads.detectOS();
// Returns: 'windows', 'mac', 'linux', or 'unknown'
```

### `ShadowerDownloads.init(options)`

Initialize download buttons with data attributes:

```javascript
ShadowerDownloads.init({
  windowsSelector: '[data-download="windows"]',
  macSelector: '[data-download="mac"]',
  linuxSelector: '[data-download="linux"]',
  autoSelector: '[data-download="auto"]',
  versionSelector: '[data-shadower-version]'
});
```

## Complete Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Download Shadower</title>
  <style>
    .download-section {
      text-align: center;
      padding: 40px;
    }
    .download-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      margin: 8px;
      border: none;
      border-radius: 8px;
      background: #1a1a1a;
      color: white;
      font-size: 16px;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .download-btn:hover {
      transform: translateY(-2px);
    }
    .download-btn.windows { background: #0078d4; }
    .download-btn.mac { background: #333; }
    .version-badge {
      font-size: 12px;
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="download-section">
    <h2>Download Shadower Desktop</h2>
    <p>Version: <span data-shadower-version>Loading...</span></p>

    <button class="download-btn windows" data-download="windows">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
      </svg>
      Download for Windows
    </button>

    <button class="download-btn mac" data-download="mac">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
      Download for macOS
    </button>
  </div>

  <script src="https://cdn.jsdelivr.net/gh/shadower-app/Shadower-Desktop@main/public/downloads/shadower-downloads.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      ShadowerDownloads.init();
    });
  </script>
</body>
</html>
```

## Analytics Integration

The download script automatically tracks downloads if Google Analytics (gtag) is present:

```javascript
// If gtag is available, downloads are tracked as:
gtag('event', 'download', {
  'event_category': 'Desktop App',
  'event_label': 'windows', // or 'mac-arm64', 'mac-x64', 'linux'
  'value': 1
});
```

## Auto-Update System

Once users install Shadower Desktop, they will receive automatic updates:

1. The app checks GitHub Releases on startup (with 5-second delay)
2. If a new version is available, it downloads in the background
3. A notification appears: "Update available: v{version}"
4. When download completes, a banner shows "Restart Now" button
5. Clicking restart applies the update automatically

Users don't need to re-download from the website for updates.

## Supported Platforms

| Platform | Architecture | File Type |
|----------|--------------|-----------|
| Windows | x64 | `.exe` (NSIS installer) |
| macOS | ARM64 (Apple Silicon) | `.dmg` |
| macOS | x64 (Intel) | `.dmg` |
| Linux | x64, arm64 | `.AppImage`, `.deb` |

## Troubleshooting

### Downloads not working?

1. Check that releases exist at: https://github.com/shadower-app/Shadower-Desktop/releases
2. Ensure release assets have the expected naming convention
3. Check browser console for any errors

### Version not showing?

The version badge requires a published GitHub release. Create a release with a tag like `v1.0.0`.

### CORS issues?

The GitHub API allows CORS requests. If you encounter issues, ensure you're loading the script from HTTPS.
