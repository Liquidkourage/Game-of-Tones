# 🎵 TEMPO Customer Onboarding Guide

## Overview
This guide walks through setting up TEMPO for a new customer organization with their own Spotify account.

## Prerequisites
- Customer has a **Spotify Premium** account
- Access to Railway deployment dashboard
- Customer's license key (generated using license-generator.js)

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Generate License Key
```bash
# Run the license generator
node tools/license-generator.js ACME

# Output:
# License Key: TEMPO-ACME-2024-A1B2C3
# Environment Variables for Railway:
#   ORG_ACME_SPOTIFY_ACCESS_TOKEN=<customer_access_token>
#   ORG_ACME_SPOTIFY_REFRESH_TOKEN=<customer_refresh_token>
```

### Step 2: Customer Spotify Connection
1. **Send customer the license key**: `TEMPO-ACME-2024-A1B2C3`
2. **Customer visits your TEMPO app**: `https://your-app.railway.app`
3. **Customer creates a room** using their license key
4. **Customer connects their Spotify account** (one-time setup)
5. **Get customer's tokens**: Visit `/api/spotify/tokens?roomId=<their_room_id>`

### Step 3: Add Environment Variables
In Railway dashboard → Variables tab, add:
```
ORG_ACME_SPOTIFY_ACCESS_TOKEN=BQC4h8WO...
ORG_ACME_SPOTIFY_REFRESH_TOKEN=AQD9k2L...
```

### Step 4: Deploy & Test
- Railway auto-deploys with new environment variables
- Customer's rooms now use their Spotify account automatically
- Test by creating a room with their license key

---

## 📋 Detailed Customer Instructions

### For Your Customer (Email Template)

```
Subject: Your TEMPO Music Bingo License - Setup Instructions

Hi [Customer Name],

Welcome to TEMPO! Here's everything you need to get started:

🎵 YOUR LICENSE KEY: TEMPO-ACME-2024-A1B2C3

📝 SETUP STEPS:
1. Visit: https://your-tempo-app.railway.app
2. Click "Host a Game"
3. Enter your license key: TEMPO-ACME-2024-A1B2C3
4. Connect your Spotify Premium account (one-time setup)
5. Start creating amazing music bingo games!

🎯 WHAT YOU GET:
✅ Your own private Spotify integration
✅ Access to your Spotify playlists
✅ Unlimited rooms and games
✅ Professional music bingo hosting

❓ NEED HELP?
- Email: support@your-company.com
- Documentation: https://your-docs-site.com

Happy hosting!
The TEMPO Team
```

---

## 🔧 Technical Details

### License Key Format
```
TEMPO-{ORG_CODE}-{YEAR}-{CHECKSUM}
├── TEMPO: Product identifier
├── ORG_CODE: Customer organization (2-10 chars)
├── YEAR: License year (2024+)
└── CHECKSUM: Validation hash
```

### Environment Variable Naming
```
Default Organization (backward compatibility):
  SPOTIFY_ACCESS_TOKEN
  SPOTIFY_REFRESH_TOKEN

Customer Organizations:
  ORG_ACME_SPOTIFY_ACCESS_TOKEN
  ORG_ACME_SPOTIFY_REFRESH_TOKEN
  ORG_BETA_SPOTIFY_ACCESS_TOKEN
  ORG_BETA_SPOTIFY_REFRESH_TOKEN
```

### Room-to-Organization Mapping
```javascript
// When customer creates room with license key:
{
  roomId: "room_abc123",
  organizationId: "ACME",           // From license key
  licenseKey: "TEMPO-ACME-2024-...", // Stored for reference
  createdAt: "2024-01-01T00:00:00Z"
}

// All Spotify API calls for this room use ACME's tokens
```

---

## 🛠️ Management Tools

### Validate License Keys
```bash
node tools/license-generator.js --validate TEMPO-ACME-2024-A1B2C3
# ✅ License key is VALID
#    Organization: ACME
#    Year: 2024
```

### List Example Keys
```bash
node tools/license-generator.js --list
# Shows example license keys for common organization names
```

### Check Customer Status
```bash
# Visit in browser:
https://your-app.railway.app/api/spotify/status?roomId=<customer_room>

# Response includes organization info:
{
  "connected": true,
  "hasTokens": true,
  "organizationId": "ACME"
}
```

---

## 🚨 Troubleshooting

### Customer Can't Connect Spotify
**Problem**: "Invalid license key" error
**Solution**: 
1. Verify license key format: `TEMPO-ORG-YEAR-CHECKSUM`
2. Check year is valid (2024+)
3. Regenerate key if needed

### Customer's Playlists Don't Load
**Problem**: 401 error or "Spotify not connected"
**Solution**:
1. Check environment variables are set correctly
2. Verify customer completed Spotify OAuth flow
3. Check Railway logs for token validation errors

### Multiple Customers Sharing Tokens
**Problem**: Customer A sees Customer B's playlists
**Solution**:
1. Verify each customer has unique license key
2. Check environment variable naming (ORG_X_ prefix)
3. Ensure rooms are created with correct license keys

---

## 📊 Scaling Considerations

### Current Limits
- **Environment Variables**: Railway supports 100+ variables
- **Spotify API**: Rate limits per customer account
- **Room Capacity**: No change from single-tenant

### Adding More Customers
1. Generate new license key
2. Customer connects Spotify
3. Add 2 environment variables
4. Deploy (automatic)

### Monitoring
- Track active organizations via room creation logs
- Monitor Spotify API usage per organization
- Set up alerts for failed token refreshes

---

## 🔐 Security Notes

### License Key Security
- License keys are **not secret** (customers share them)
- Validation prevents unauthorized access
- Checksum prevents tampering

### Spotify Token Security
- Tokens stored as environment variables (encrypted at rest)
- Each customer's tokens isolated
- Automatic refresh prevents expiration

### Access Control
- Customers can only access their own Spotify data
- Room isolation by organization
- No cross-customer data leakage

---

## 💰 Business Model Integration

### Billing Tracking
```javascript
// Track usage per organization
const orgUsage = {
  organizationId: "ACME",
  roomsCreated: 15,
  gamesPlayed: 47,
  lastActive: "2024-01-15",
  licenseKey: "TEMPO-ACME-2024-..."
};
```

### License Expiration
```javascript
// Check license year in validation
if (parseInt(year) < currentYear) {
  return { valid: false, error: 'License expired' };
}
```

### Feature Flags
```javascript
// Organization-specific features
const orgFeatures = {
  "ACME": ["premium-themes", "custom-branding"],
  "BETA": ["basic-features"]
};
```

---

## 📞 Support Checklist

When customer contacts support:

1. **Get their license key** - identifies organization
2. **Check environment variables** - verify tokens are set
3. **Test room creation** - ensure license validation works
4. **Check Spotify connection** - visit `/api/spotify/status?roomId=X`
5. **Review Railway logs** - look for organization-specific errors

Common fixes:
- Regenerate license key
- Re-add environment variables
- Customer re-connects Spotify
- Clear browser cache/localStorage
