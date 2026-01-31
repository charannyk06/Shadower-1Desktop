#!/bin/bash
# Shadower macOS Installation Helper
# This script removes the quarantine attribute from unsigned apps

APP_NAME="Shadower"
APP_PATH="/Applications/$APP_NAME.app"

echo "=========================================="
echo "  Shadower macOS Installation Helper"
echo "=========================================="
echo ""

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "Error: $APP_NAME.app not found in /Applications"
    echo ""
    echo "Please drag Shadower.app to Applications folder first,"
    echo "then run this script again."
    exit 1
fi

echo "Removing quarantine attribute from $APP_NAME..."
echo ""

# Remove quarantine attribute
xattr -cr "$APP_PATH"

if [ $? -eq 0 ]; then
    echo "Success! Quarantine attribute removed."
    echo ""
    echo "You can now open Shadower from your Applications folder."
    echo ""
    echo "Opening Shadower..."
    open "$APP_PATH"
else
    echo "Error: Failed to remove quarantine attribute."
    echo ""
    echo "Try running with sudo:"
    echo "  sudo xattr -cr \"$APP_PATH\""
    exit 1
fi
