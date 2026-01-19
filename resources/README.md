# Shadower App Resources

This directory contains resources required for building the Electron application.

## Required Icon Files

Before building the app for distribution, you need to add the following icon files:

### macOS (`icon.icns`)
- Format: Apple Icon Image format (.icns)
- Recommended: Include all standard sizes (16x16 through 1024x1024)
- Tool to create: Use `iconutil` on macOS or online converters

```bash
# Create iconset directory with PNG files
mkdir icon.iconset
# Add icon files: icon_16x16.png, icon_16x16@2x.png, icon_32x32.png, etc.
# Convert to icns
iconutil -c icns icon.iconset
```

### Windows (`icon.ico`)
- Format: Windows Icon format (.ico)
- Recommended: Include 16x16, 32x32, 48x48, 64x64, 128x128, 256x256 sizes
- Tool to create: ImageMagick or online converters

```bash
# Using ImageMagick
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Linux (`icon.png`)
- Format: PNG
- Recommended size: 512x512 or 1024x1024 pixels
- This will be used for AppImage and .deb packages

## Entitlements (macOS)

The `entitlements.mac.plist` file contains macOS security entitlements required for:
- Network access (API calls)
- File system access (user documents)
- Child process spawning (local sandbox/terminal)
- JIT compilation (Node.js/V8)

## Code Signing

### macOS Code Signing

For distribution, you'll need an Apple Developer certificate:

1. Get an Apple Developer account ($99/year)
2. Create a "Developer ID Application" certificate
3. Set environment variables:
   ```bash
   export APPLE_ID="your-apple-id@email.com"
   export APPLE_ID_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="YOUR_TEAM_ID"
   ```

4. The app will be automatically signed and notarized during build

### Windows Code Signing

For Windows distribution:

1. Purchase a code signing certificate from a trusted CA
2. Set environment variable:
   ```bash
   export WIN_CSC_LINK="path/to/certificate.pfx"
   export WIN_CSC_KEY_PASSWORD="certificate-password"
   ```

## Quick Start (Development)

For development without code signing, you can use placeholder icons:

```bash
# Create a simple placeholder icon (requires ImageMagick)
convert -size 512x512 xc:purple -fill white -gravity center \
  -pointsize 200 -annotate 0 'S' resources/icon.png

# For macOS (create .icns from PNG)
# Use an online converter or iconutil

# For Windows (create .ico from PNG)
convert resources/icon.png -define icon:auto-resize resources/icon.ico
```

## Building

Once icons are in place:

```bash
# Build for current platform
pnpm electron:build

# Build for specific platform
pnpm electron:build --mac
pnpm electron:build --win
pnpm electron:build --linux
```

## Troubleshooting

### "Icon not found" errors
Make sure icon files exist at:
- `resources/icon.icns` (macOS)
- `resources/icon.ico` (Windows)
- `resources/icon.png` (Linux)

### macOS notarization fails
- Ensure you have a valid Developer ID certificate
- Check that `entitlements.mac.plist` is correctly formatted
- Verify Apple ID credentials are set correctly

### Windows SmartScreen warnings
- Code signing with an EV certificate removes these warnings
- Standard certificates may show warnings initially until reputation is built
