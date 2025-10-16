# Multi-Tenant Implementation Plan

## Phase 1: Quick Start (Environment Variables)

### Step 1: Add License Key Support
```javascript
// Add to room creation
app.post('/api/rooms/create', (req, res) => {
  const { licenseKey } = req.body;
  const organizationId = validateLicenseKey(licenseKey);
  
  if (!organizationId) {
    return res.status(401).json({ error: 'Invalid license key' });
  }
  
  const roomId = generateRoomId();
  rooms[roomId] = {
    id: roomId,
    organizationId: organizationId,
    // ... existing room properties
  };
});
```

### Step 2: Organization-Specific Environment Variables
```bash
# For organization "ACME"
ORG_ACME_SPOTIFY_ACCESS_TOKEN=BQC4...
ORG_ACME_SPOTIFY_REFRESH_TOKEN=AQD...

# For organization "BETA"  
ORG_BETA_SPOTIFY_ACCESS_TOKEN=BQD5...
ORG_BETA_SPOTIFY_REFRESH_TOKEN=AQE...
```

### Step 3: Multi-Tenant Spotify Service
```javascript
class MultiTenantSpotifyManager {
  constructor() {
    this.orgServices = new Map();
    this.orgTokens = new Map();
  }
  
  getService(organizationId) {
    if (!this.orgServices.has(organizationId)) {
      const service = new SpotifyService();
      this.orgServices.set(organizationId, service);
      
      // Load org-specific tokens
      const tokens = this.loadOrgTokens(organizationId);
      if (tokens) {
        service.setTokens(tokens.accessToken, tokens.refreshToken);
        this.orgTokens.set(organizationId, tokens);
      }
    }
    return this.orgServices.get(organizationId);
  }
  
  loadOrgTokens(organizationId) {
    const accessToken = process.env[`ORG_${organizationId}_SPOTIFY_ACCESS_TOKEN`];
    const refreshToken = process.env[`ORG_${organizationId}_SPOTIFY_REFRESH_TOKEN`];
    
    if (accessToken && refreshToken) {
      return { accessToken, refreshToken };
    }
    return null;
  }
}
```

## Phase 2: License Key Validation

### Simple License Key Format
```
TEMPO-{ORG_CODE}-{YEAR}-{CHECKSUM}
Examples:
- TEMPO-ACME-2024-A1B2C3
- TEMPO-BETA-2024-D4E5F6
```

### Validation Function
```javascript
function validateLicenseKey(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return null;
  }
  
  const parts = licenseKey.split('-');
  if (parts.length !== 4 || parts[0] !== 'TEMPO') {
    return null;
  }
  
  const [prefix, orgCode, year, checksum] = parts;
  
  // Validate year
  const currentYear = new Date().getFullYear();
  if (parseInt(year) > currentYear + 1) {
    return null;
  }
  
  // Validate checksum (simple example)
  const expectedChecksum = generateChecksum(orgCode, year);
  if (checksum !== expectedChecksum) {
    return null;
  }
  
  return orgCode; // Return organization ID
}

function generateChecksum(orgCode, year) {
  // Simple checksum - in production use crypto
  const combined = orgCode + year + 'TEMPO_SECRET';
  return combined.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0).toString(16).toUpperCase().substring(0, 6);
}
```

## Phase 3: API Updates

### Room Creation with License
```javascript
// Frontend: Room creation
const createRoom = async (licenseKey) => {
  const response = await fetch('/api/rooms/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey })
  });
  
  if (!response.ok) {
    throw new Error('Invalid license key');
  }
  
  return response.json();
};
```

### Organization-Aware Spotify Endpoints
```javascript
// Get organization from room
function getOrganizationFromRoom(roomId) {
  const room = rooms[roomId];
  return room ? room.organizationId : 'DEFAULT';
}

// Updated Spotify endpoints
app.get('/api/spotify/playlists', async (req, res) => {
  const { roomId } = req.query;
  const organizationId = getOrganizationFromRoom(roomId);
  
  const spotifyService = multiTenantManager.getService(organizationId);
  // ... rest of playlist logic
});
```

## Deployment Strategy

### For Each New Customer:
1. **Generate license key**: `TEMPO-CUSTOMER-2024-ABC123`
2. **Customer connects Spotify**: Using their own Spotify account
3. **Set environment variables**: 
   ```
   ORG_CUSTOMER_SPOTIFY_ACCESS_TOKEN=...
   ORG_CUSTOMER_SPOTIFY_REFRESH_TOKEN=...
   ```
4. **Customer uses license key**: In room creation

### Benefits:
- ✅ **Isolated Spotify accounts** per customer
- ✅ **Simple deployment** (just env vars)
- ✅ **Backward compatible** (existing users get DEFAULT org)
- ✅ **Scalable** (add customers without code changes)

### Next Steps:
1. Would you like me to implement Phase 1 (license key + multi-tenant Spotify)?
2. What license key format would you prefer?
3. How do you want to distribute license keys to customers?
