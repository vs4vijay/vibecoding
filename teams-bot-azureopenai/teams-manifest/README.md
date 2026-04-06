# Teams Manifest

This directory contains the Microsoft Teams app manifest and icons for deploying the bot to Teams.

## Files Required

1. **manifest.json** - The app manifest (provided)
2. **color.png** - Color icon (192x192 pixels)
3. **outline.png** - Outline icon (32x32 pixels)

## Setup Instructions

1. **Update manifest.json**:
   - Replace `YOUR-BOT-APP-ID-HERE` with your actual Bot App ID
   - Update company name and URLs
   - Customize bot name and description

2. **Add Icons**:
   - Create or add a `color.png` (192x192 pixels)
   - Create or add an `outline.png` (32x32 pixels)

3. **Package the App**:
   ```bash
   zip -r teams-app.zip manifest.json color.png outline.png
   ```

4. **Upload to Teams**:
   - Open Microsoft Teams
   - Go to Apps → Manage your apps
   - Click "Upload an app" → "Upload a custom app"
   - Select the `teams-app.zip` file
   - Follow the prompts to install

## Icon Guidelines

### Color Icon (color.png)
- Size: 192x192 pixels
- Format: PNG
- Background: Can be colored
- Should represent your bot/company

### Outline Icon (outline.png)
- Size: 32x32 pixels
- Format: PNG with transparency
- Monochrome white icon on transparent background
- Used in Teams UI when space is limited

## Manifest Properties

### Key Fields to Customize

- **id**: Your Bot App ID from Azure
- **developer.name**: Your company name
- **developer.websiteUrl**: Your company website
- **developer.privacyUrl**: Your privacy policy URL
- **developer.termsOfUseUrl**: Your terms of use URL
- **name.short**: Bot display name (max 30 chars)
- **name.full**: Full bot name (max 100 chars)
- **description.short**: Short description (max 80 chars)
- **description.full**: Full description (max 4000 chars)

### Bot Scopes

The bot is configured for:
- **personal**: 1-on-1 chats with the bot
- **team**: Channels in teams
- **groupchat**: Group chats

## Testing

Before production deployment:
1. Test in Bot Framework Emulator
2. Sideload to Teams for testing
3. Test in all scopes (personal, team, groupchat)
4. Verify commands work correctly

## Production Deployment

For organization-wide deployment:
1. Submit to Teams App Store (for public apps)
2. Or deploy via Teams Admin Center (for internal apps)
3. Set up app policies and permissions
4. Configure usage analytics

## References

- [Teams App Manifest Schema](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/schema/manifest-schema)
- [Teams App Icons](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/schema/manifest-schema#icons)
- [Publish Teams Apps](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/overview)
