=====================================
SHADOWER - macOS Installation Guide
=====================================

IMPORTANT: If you see "Shadower is damaged and can't be opened"

This happens because the app is not code-signed with an Apple Developer certificate.
Follow these steps to install:

METHOD 1: Terminal Command (Recommended)
----------------------------------------
1. Drag Shadower.app to your Applications folder
2. Open Terminal (Applications > Utilities > Terminal)
3. Run this command:

   xattr -cr /Applications/Shadower.app

4. Open Shadower from Applications

METHOD 2: Right-Click to Open
-----------------------------
1. Drag Shadower.app to your Applications folder
2. Right-click (or Control-click) on Shadower.app
3. Select "Open" from the context menu
4. Click "Open" in the security dialog

TROUBLESHOOTING
---------------
If you still can't open the app, try:

1. System Settings > Privacy & Security
2. Scroll down to the Security section
3. Look for "Shadower was blocked" message
4. Click "Open Anyway"

SUPPORT
-------
GitHub: https://github.com/charannyk06/Shadower-1Desktop
Website: https://shadower.io
