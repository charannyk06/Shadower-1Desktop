/**
 * Shadower Desktop Download Helper
 *
 * This script provides utilities for downloading Shadower Desktop
 * from GitHub Releases. Include it on shadower.io to enable
 * one-click downloads for Windows and macOS.
 *
 * Usage:
 *   <script src="shadower-downloads.js"></script>
 *   <button onclick="ShadowerDownloads.download('windows')">Download for Windows</button>
 *   <button onclick="ShadowerDownloads.download('mac')">Download for macOS</button>
 */

(function(global) {
  'use strict';

  const GITHUB_OWNER = 'shadower-app';
  const GITHUB_REPO = 'Shadower-Desktop';
  const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  // Cache for release data
  let cachedRelease = null;
  let cacheTime = 0;
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Detect user's operating system
   */
  function detectOS() {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform?.toLowerCase() || '';

    if (platform.includes('win') || userAgent.includes('windows')) {
      return 'windows';
    }
    if (platform.includes('mac') || userAgent.includes('macintosh')) {
      return 'mac';
    }
    if (platform.includes('linux') || userAgent.includes('linux')) {
      return 'linux';
    }
    return 'unknown';
  }

  /**
   * Detect if Mac is Apple Silicon (ARM) or Intel (x64)
   * Note: This is a best-effort detection and may not be 100% accurate
   */
  function detectMacArch() {
    // Check for Apple Silicon indicators
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        // Apple Silicon Macs use Apple GPU
        if (renderer && renderer.includes('Apple')) {
          return 'arm64';
        }
      }
    }

    // Default to arm64 for newer Macs (post-2020)
    // Users can always choose the other architecture from releases page
    return 'arm64';
  }

  /**
   * Fetch latest release info from GitHub
   */
  async function fetchLatestRelease() {
    // Return cached data if still valid
    if (cachedRelease && (Date.now() - cacheTime) < CACHE_DURATION) {
      return cachedRelease;
    }

    try {
      const response = await fetch(RELEASES_API, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      cachedRelease = await response.json();
      cacheTime = Date.now();
      return cachedRelease;
    } catch (error) {
      console.error('[ShadowerDownloads] Failed to fetch release:', error);
      return null;
    }
  }

  /**
   * Find download URL for a specific platform from release assets
   */
  function findAssetUrl(release, platform, arch) {
    if (!release || !release.assets) return null;

    const assets = release.assets;

    // Define patterns for each platform (based on actual v1.0.3 release file names)
    // Windows: Shadower.Setup.1.0.0.exe
    // macOS ARM: Shadower-1.0.0-arm64.dmg
    // macOS Intel: Shadower-1.0.0.dmg (no arch suffix)
    const patterns = {
      'windows': [
        /Shadower\.Setup\.[0-9.]+\.exe$/i,
        /Shadower[- ]Setup.*\.exe$/i,
        /Shadower.*\.exe$/i
      ],
      'mac-arm64': [
        /Shadower-[0-9.]+-arm64\.dmg$/i,
        /Shadower.*arm64\.dmg$/i
      ],
      'mac-x64': [
        // Intel Mac DMG has no arch suffix, so match DMG without arm64
        /Shadower-[0-9.]+\.dmg$/i
      ],
      'linux': [
        /Shadower.*\.AppImage$/i,
        /shadower.*\.deb$/i
      ]
    };

    const key = platform === 'mac' ? `mac-${arch || 'arm64'}` : platform;
    const platformPatterns = patterns[key] || [];

    for (const pattern of platformPatterns) {
      const asset = assets.find(a => pattern.test(a.name));
      if (asset) {
        return asset.browser_download_url;
      }
    }

    return null;
  }

  /**
   * Get download URL for current platform
   */
  async function getDownloadUrl(platform, arch) {
    const release = await fetchLatestRelease();

    if (!release) {
      // Fallback to releases page
      return RELEASES_PAGE;
    }

    const url = findAssetUrl(release, platform, arch);
    return url || RELEASES_PAGE;
  }

  /**
   * Get all available downloads
   */
  async function getAllDownloads() {
    const release = await fetchLatestRelease();

    if (!release) {
      return {
        version: null,
        windows: RELEASES_PAGE,
        macArm64: RELEASES_PAGE,
        macX64: RELEASES_PAGE,
        linux: RELEASES_PAGE,
        releasePage: RELEASES_PAGE
      };
    }

    return {
      version: release.tag_name?.replace(/^v/, '') || release.name,
      releaseDate: release.published_at,
      releaseNotes: release.body,
      windows: findAssetUrl(release, 'windows') || RELEASES_PAGE,
      macArm64: findAssetUrl(release, 'mac', 'arm64') || RELEASES_PAGE,
      macX64: findAssetUrl(release, 'mac', 'x64') || RELEASES_PAGE,
      linux: findAssetUrl(release, 'linux') || RELEASES_PAGE,
      releasePage: release.html_url || RELEASES_PAGE
    };
  }

  /**
   * Trigger download for specified platform
   */
  async function download(platform) {
    let targetPlatform = platform;
    let arch = null;

    // Auto-detect if not specified
    if (!platform || platform === 'auto') {
      targetPlatform = detectOS();
    }

    // Handle Mac architecture
    if (targetPlatform === 'mac') {
      arch = detectMacArch();
    }

    const url = await getDownloadUrl(targetPlatform, arch);

    // Track download (if analytics available)
    if (typeof gtag === 'function') {
      gtag('event', 'download', {
        'event_category': 'Desktop App',
        'event_label': `${targetPlatform}${arch ? `-${arch}` : ''}`,
        'value': 1
      });
    }

    // Open download URL
    window.location.href = url;
  }

  /**
   * Initialize download buttons
   * Call this after DOM is ready
   */
  function init(options = {}) {
    const {
      windowsSelector = '[data-download="windows"]',
      macSelector = '[data-download="mac"]',
      linuxSelector = '[data-download="linux"]',
      autoSelector = '[data-download="auto"]',
      versionSelector = '[data-shadower-version]'
    } = options;

    // Bind click handlers
    document.querySelectorAll(windowsSelector).forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        download('windows');
      });
    });

    document.querySelectorAll(macSelector).forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        download('mac');
      });
    });

    document.querySelectorAll(linuxSelector).forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        download('linux');
      });
    });

    document.querySelectorAll(autoSelector).forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        download('auto');
      });
    });

    // Update version badges
    getAllDownloads().then(downloads => {
      if (downloads.version) {
        document.querySelectorAll(versionSelector).forEach(el => {
          el.textContent = `v${downloads.version}`;
        });
      }
    });
  }

  // Export to global scope
  global.ShadowerDownloads = {
    download,
    getDownloadUrl,
    getAllDownloads,
    detectOS,
    detectMacArch,
    init,
    RELEASES_PAGE
  };

})(typeof window !== 'undefined' ? window : this);
