# Complete Website Integration Guide for Shadower Downloads

## For Website Developer - Copy-Paste Ready Code

### Problem: GitHub API Rate Limits
GitHub API has a 60 requests/hour limit for unauthenticated requests. Instead of using the API, we use **direct download URLs** that bypass rate limits entirely.

---

## Option 1: Zero API Calls (Recommended)

This approach uses GitHub's built-in redirect feature - no API calls, no rate limits.

### Step 1: Add This JavaScript to Your Website

```javascript
/**
 * Shadower Desktop Downloads - Rate Limit Free Version
 * Uses GitHub's direct download redirects (no API calls)
 */
const ShadowerDownloader = {
  // GitHub repository info
  owner: 'charannyk06',
  repo: 'Shadower-1Desktop',

  // Direct download base URL (GitHub auto-redirects to latest)
  getBaseUrl() {
    return `https://github.com/${this.owner}/${this.repo}/releases/latest/download`;
  },

  // Exact file names from v1.0.3 release
  files: {
    windows: 'Shadower.Setup.1.0.0.exe',     // Windows installer
    macArm: 'Shadower-1.0.0-arm64.dmg',      // Apple Silicon
    macIntel: 'Shadower-1.0.0.dmg',          // Intel Mac
    linux: 'Shadower-1.0.0.AppImage'         // Linux (when available)
  },

  // Detect user's OS
  detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();

    if (platform.includes('win') || ua.includes('windows')) return 'windows';
    if (platform.includes('mac') || ua.includes('mac')) return 'mac';
    if (platform.includes('linux') || ua.includes('linux')) return 'linux';
    return 'unknown';
  },

  // Detect Mac architecture (best effort)
  detectMacArch() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          if (renderer && renderer.includes('Apple')) return 'arm';
        }
      }
    } catch (e) {}
    return 'arm'; // Default to ARM for modern Macs
  },

  // Get download URL for platform
  getDownloadUrl(platform) {
    const base = this.getBaseUrl();

    switch (platform) {
      case 'windows':
        return `${base}/${this.files.windows}`;
      case 'mac':
      case 'mac-arm':
        return `${base}/${this.files.macArm}`;
      case 'mac-intel':
        return `${base}/${this.files.macIntel}`;
      case 'linux':
        return `${base}/${this.files.linux}`;
      default:
        return `https://github.com/${this.owner}/${this.repo}/releases/latest`;
    }
  },

  // Download for specific platform
  download(platform) {
    let targetPlatform = platform;

    // Auto-detect if needed
    if (!platform || platform === 'auto') {
      targetPlatform = this.detectOS();
      if (targetPlatform === 'mac') {
        const arch = this.detectMacArch();
        targetPlatform = arch === 'arm' ? 'mac-arm' : 'mac-intel';
      }
    }

    const url = this.getDownloadUrl(targetPlatform);

    // Track download (optional - if you have analytics)
    if (typeof gtag === 'function') {
      gtag('event', 'download', {
        event_category: 'Desktop App',
        event_label: targetPlatform
      });
    }

    // Trigger download
    window.location.href = url;
  },

  // Go to releases page (fallback)
  openReleasesPage() {
    window.open(`https://github.com/${this.owner}/${this.repo}/releases/latest`, '_blank');
  }
};

// Make globally available
window.ShadowerDownloader = ShadowerDownloader;
```

### Step 2: Add Download Buttons HTML

```html
<!-- Available on Desktop Section -->
<div class="download-section">
  <p class="download-label">Available on Desktop</p>

  <div class="download-buttons">
    <!-- Windows Button -->
    <button
      class="download-btn windows"
      onclick="ShadowerDownloader.download('windows')"
    >
      <svg class="icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
      </svg>
      <span>Download for Windows</span>
    </button>

    <!-- macOS Button -->
    <button
      class="download-btn macos"
      onclick="ShadowerDownloader.download('mac')"
    >
      <svg class="icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
      <span>Download for macOS</span>
    </button>
  </div>
</div>
```

### Step 3: Add CSS Styles

```css
.download-section {
  text-align: center;
  padding: 40px 20px;
}

.download-label {
  color: #888;
  font-size: 14px;
  margin-bottom: 16px;
}

.download-buttons {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border: 1px solid #333;
  border-radius: 8px;
  background: #1a1a1a;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.download-btn:hover {
  background: #2a2a2a;
  border-color: #444;
  transform: translateY(-1px);
}

.download-btn .icon {
  width: 18px;
  height: 18px;
}

/* Platform-specific colors (optional) */
.download-btn.windows:hover {
  border-color: #0078d4;
}

.download-btn.macos:hover {
  border-color: #999;
}
```

---

## Option 2: With Version Display (Uses API Once)

If you want to show the version number, use this approach which caches the API response.

```javascript
const ShadowerDownloaderWithVersion = {
  ...ShadowerDownloader,

  cachedVersion: null,

  async fetchVersion() {
    if (this.cachedVersion) return this.cachedVersion;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`,
        { headers: { 'Accept': 'application/vnd.github.v3+json' } }
      );

      if (response.ok) {
        const data = await response.json();
        this.cachedVersion = data.tag_name?.replace(/^v/, '') || null;

        // Cache in localStorage for 1 hour
        localStorage.setItem('shadower_version', JSON.stringify({
          version: this.cachedVersion,
          timestamp: Date.now()
        }));
      }
    } catch (e) {
      // Try localStorage cache
      try {
        const cached = JSON.parse(localStorage.getItem('shadower_version'));
        if (cached && (Date.now() - cached.timestamp) < 3600000) {
          this.cachedVersion = cached.version;
        }
      } catch (e) {}
    }

    return this.cachedVersion;
  },

  async displayVersion(selector) {
    const version = await this.fetchVersion();
    if (version) {
      document.querySelectorAll(selector).forEach(el => {
        el.textContent = `v${version}`;
      });
    }
  }
};

// Usage: Show version on page load
document.addEventListener('DOMContentLoaded', () => {
  ShadowerDownloaderWithVersion.displayVersion('[data-shadower-version]');
});
```

```html
<span data-shadower-version>Latest</span>
```

---

## Verified File Names (v1.0.3 Release)

The following file names are confirmed working:

```javascript
files: {
  windows: 'Shadower.Setup.1.0.0.exe',      // Windows installer
  macArm: 'Shadower-1.0.0-arm64.dmg',       // Apple Silicon DMG
  macIntel: 'Shadower-1.0.0.dmg',           // Intel Mac DMG
  linux: 'Shadower-1.0.0.AppImage'          // Linux (future)
}
```

**Download URLs:**
- **Windows**: `https://github.com/charannyk06/Shadower-1Desktop/releases/latest/download/Shadower.Setup.1.0.0.exe`
- **macOS ARM**: `https://github.com/charannyk06/Shadower-1Desktop/releases/latest/download/Shadower-1.0.0-arm64.dmg`
- **macOS Intel**: `https://github.com/charannyk06/Shadower-1Desktop/releases/latest/download/Shadower-1.0.0.dmg`

---

## Complete Copy-Paste Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Download Shadower</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container { text-align: center; padding: 40px; }
    h1 { font-size: 48px; margin-bottom: 8px; }
    .tagline { color: #888; font-size: 18px; margin-bottom: 40px; }
    .download-label { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
    .buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 14px 24px; border: 1px solid #333; border-radius: 8px;
      background: #111; color: #fff; font-size: 14px; font-weight: 500;
      cursor: pointer; transition: all 0.2s;
    }
    .btn:hover { background: #1a1a1a; border-color: #555; transform: translateY(-2px); }
    .btn svg { width: 20px; height: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Shadower</h1>
    <p class="tagline">AI Agent Orchestration Platform</p>

    <p class="download-label">Available on Desktop</p>
    <div class="buttons">
      <button class="btn" onclick="ShadowerDownloader.download('windows')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>
        Download for Windows
      </button>
      <button class="btn" onclick="ShadowerDownloader.download('mac')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
        Download for macOS
      </button>
    </div>
  </div>

  <script>
    const ShadowerDownloader = {
      owner: 'charannyk06',
      repo: 'Shadower-1Desktop',

      // Exact file names from v1.0.3 release
      files: {
        windows: 'Shadower.Setup.1.0.0.exe',
        macArm: 'Shadower-1.0.0-arm64.dmg',
        macIntel: 'Shadower-1.0.0.dmg'
      },

      getBaseUrl() {
        return `https://github.com/${this.owner}/${this.repo}/releases/latest/download`;
      },

      detectOS() {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('win')) return 'windows';
        if (ua.includes('mac')) return 'mac';
        return 'unknown';
      },

      detectMacArch() {
        try {
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl');
          if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).includes('Apple')) return 'arm';
          }
        } catch(e) {}
        return 'arm';
      },

      download(platform) {
        let p = platform || this.detectOS();
        let file;

        if (p === 'windows') file = this.files.windows;
        else if (p === 'mac') file = this.detectMacArch() === 'arm' ? this.files.macArm : this.files.macIntel;
        else { window.location.href = `https://github.com/${this.owner}/${this.repo}/releases/latest`; return; }

        window.location.href = `${this.getBaseUrl()}/${file}`;
      }
    };
  </script>
</body>
</html>
```

---

## Fixing GitHub Actions Rate Limits

For your GitHub Actions issue, the rate limits are different:

1. **Authenticated requests** (with `GITHUB_TOKEN`): 1,000 requests/hour
2. **GitHub Actions**: Uses the built-in token automatically

If you're hitting limits, it's likely because:
- Too many workflow runs
- Actions downloading from public API

**Solutions:**
1. Add caching to your workflow
2. Use `actions/cache@v4` for dependencies
3. Avoid triggering on every push - use tags only

Let me know if you want me to update the workflow file to fix the rate limit issues.
