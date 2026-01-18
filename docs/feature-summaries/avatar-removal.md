i have # Feature: Default Avatar Removal

## Overview
This update removes the hardcoded default "cool guy" avatar (`pf.png`) from the Shadower platform. Users who have not uploaded a profile picture will now see a clean letter-based fallback (initials) instead of a generic placeholder image.

## Changes
- **Updated `getUserAvatar` Utility**: Removed the hardcoded path to `/pf.png`. The function now returns an empty string when no image is present, triggering the UI's built-in initials fallback.
- **Cleaned up `DefaultAvatarDialog`**: Removed the `pf.png` option from the curated avatar selection list.
- **Updated Unit Tests**: Verified that the utility correctly handles empty/null image states by returning an empty string.

## Verification
The change was verified by inspecting the sidebar user menu, which now correctly displays the letter "T" for the test user instead of the previous placeholder image.

### Visual Confirmation
The following recording demonstrates the verification process and the successful removal of the default image:
![Avatar Removal Verification](/docs/assets/avatar_removal_demo.webp)

