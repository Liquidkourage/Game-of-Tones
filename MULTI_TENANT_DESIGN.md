# Multi-Tenant Spotify Architecture Design

## Current State (Single Tenant)
- One global `spotifyService` instance
- One global `spotifyTokens` variable  
- All rooms share the same Spotify account
- Environment variables: `SPOTIFY_ACCESS_TOKEN`, `SPOTIFY_REFRESH_TOKEN`

## Proposed Multi-Tenant Architecture

### 1. Organization/License Model
```javascript
// Organization entity
{
  id: "org_123",
  name: "Acme Entertainment",
  licenseKey: "TEMPO_ACME_2024_XYZ789",
  spotifyTokens: {
    accessToken: "...",
    refreshToken: "...",
    expiresAt: 1234567890
  },
  createdAt: "2024-01-01",
  isActive: true
}
```

### 2. Room-to-Organization Mapping
```javascript
// Rooms belong to organizations
{
  roomId: "room_abc123",
  organizationId: "org_123",
  hostName: "John Doe",
  createdAt: "2024-01-01"
}
```

### 3. Per-Organization Spotify Services
```javascript
// Map of organization ID to Spotify service
const orgSpotifyServices = new Map();
const orgSpotifyTokens = new Map();

// Get Spotify service for a specific organization
function getSpotifyService(organizationId) {
  if (!orgSpotifyServices.has(organizationId)) {
    const service = new SpotifyService();
    orgSpotifyServices.set(organizationId, service);
  }
  return orgSpotifyServices.get(organizationId);
}
```

## Implementation Options

### Option A: Database-Based (Recommended for Scale)
- **Storage**: PostgreSQL/MongoDB for organizations and tokens
- **Benefits**: Scalable, persistent, supports complex queries
- **Drawbacks**: Requires database setup and management

### Option B: Environment Variable Namespacing (Quick Start)
- **Storage**: Environment variables with org prefixes
- **Example**: `ORG_ACME_SPOTIFY_ACCESS_TOKEN`, `ORG_ACME_SPOTIFY_REFRESH_TOKEN`
- **Benefits**: Simple, works with current Railway setup
- **Drawbacks**: Limited scalability, manual env var management

### Option C: File-Based Multi-Tenant (Development)
- **Storage**: JSON files per organization (`tokens_org_123.json`)
- **Benefits**: Simple for development/testing
- **Drawbacks**: Not suitable for production deployment

## Recommended Implementation Plan

### Phase 1: License Key System
1. **Add license validation** to room creation
2. **Map rooms to organizations** via license keys
3. **Maintain backward compatibility** (default org for existing users)

### Phase 2: Multi-Tenant Spotify
1. **Refactor Spotify service** to be per-organization
2. **Add organization-specific token storage**
3. **Update all Spotify endpoints** to use organization context

### Phase 3: Management Interface
1. **Organization dashboard** for license holders
2. **Spotify connection management** per organization
3. **Usage analytics** and billing integration

## API Changes Required

### New Endpoints
```
POST /api/organizations/create
GET  /api/organizations/:orgId/spotify/status
POST /api/organizations/:orgId/spotify/auth
GET  /api/organizations/:orgId/spotify/callback
```

### Modified Endpoints
```
POST /api/rooms/create { licenseKey: "..." }
GET  /api/spotify/playlists?roomId=abc123  // Auto-detect org from room
```

## License Key Format
```
TEMPO-{ORG_CODE}-{YEAR}-{RANDOM}
Example: TEMPO-ACME-2024-XYZ789
```

## Migration Strategy
1. **Default organization** for existing users
2. **Gradual migration** of existing rooms
3. **Backward compatibility** during transition period
