/**
 * Song Lookup Service
 * Validates song titles against real music databases
 * Uses MusicBrainz API and Spotify API for accurate song verification
 */

export interface SongLookupResult {
  found: boolean;
  confidence: number; // 0-1
  originalTitle: string;
  cleanedTitle: string;
  artist: string;
  album?: string;
  year?: number;
  source: 'musicbrainz' | 'spotify' | 'none';
  warnings: string[];
  suggestions: string[];
}

export interface SongLookupOptions {
  useMusicBrainz?: boolean;
  useSpotify?: boolean;
  minConfidence?: number;
  timeout?: number;
}

const DEFAULT_OPTIONS: SongLookupOptions = {
  useMusicBrainz: true,
  useSpotify: true,
  minConfidence: 0.7,
  timeout: 5000
};

/**
 * Look up a song using multiple APIs to validate the title
 */
export async function lookupSong(
  title: string,
  artist: string,
  options: SongLookupOptions = DEFAULT_OPTIONS
): Promise<SongLookupResult> {
  const result: SongLookupResult = {
    found: false,
    confidence: 0,
    originalTitle: title,
    cleanedTitle: title,
    artist: artist,
    source: 'none',
    warnings: [],
    suggestions: []
  };

  try {
    // Try MusicBrainz first (free, comprehensive)
    if (options.useMusicBrainz) {
      const musicBrainzResult = await lookupMusicBrainz(title, artist, options.timeout);
      if (musicBrainzResult.found && musicBrainzResult.confidence >= (options.minConfidence || 0.7)) {
        return musicBrainzResult;
      }
    }

    // Fallback to Spotify if available
    if (options.useSpotify) {
      const spotifyResult = await lookupSpotify(title, artist, options.timeout);
      if (spotifyResult.found && spotifyResult.confidence >= (options.minConfidence || 0.7)) {
        return spotifyResult;
      }
    }

    // If no good matches found, return the original with low confidence
    result.warnings.push('No matching song found in music databases');
    result.suggestions.push('Verify the song title and artist name are correct');
    
  } catch (error) {
    result.warnings.push(`Lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    result.suggestions.push('Check your internet connection and try again');
  }

  return result;
}

/**
 * Look up song using MusicBrainz API
 */
async function lookupMusicBrainz(
  title: string,
  artist: string,
  timeout: number = 5000
): Promise<SongLookupResult> {
  const result: SongLookupResult = {
    found: false,
    confidence: 0,
    originalTitle: title,
    cleanedTitle: title,
    artist: artist,
    source: 'musicbrainz',
    warnings: [],
    suggestions: []
  };

  try {
    // MusicBrainz API endpoint
    const baseUrl = 'https://musicbrainz.org/ws/2';
    const query = `recording:"${encodeURIComponent(title)}" AND artist:"${encodeURIComponent(artist)}"`;
    const url = `${baseUrl}/recording?query=${query}&fmt=json&limit=5`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GameOfTones/1.0 (https://github.com/Liquidkourage/Game-of-Tones)'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`MusicBrainz API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.recordings && data.recordings.length > 0) {
      const recording = data.recordings[0];
      
      // Calculate confidence based on title and artist match
      const titleMatch = calculateStringSimilarity(title.toLowerCase(), recording.title.toLowerCase());
      const artistMatch = recording['artist-credit'] && recording['artist-credit'].length > 0 
        ? calculateStringSimilarity(artist.toLowerCase(), recording['artist-credit'][0].name.toLowerCase())
        : 0;

      const confidence = (titleMatch + artistMatch) / 2;

      if (confidence >= 0.7) {
        result.found = true;
        result.confidence = confidence;
        result.cleanedTitle = recording.title;
        result.artist = recording['artist-credit'][0].name;
        
        if (recording.releases && recording.releases.length > 0) {
          result.album = recording.releases[0].title;
          if (recording.releases[0].date) {
            result.year = parseInt(recording.releases[0].date.split('-')[0]);
          }
        }

        if (confidence < 0.9) {
          result.warnings.push('Title or artist name may not match exactly');
        }
      }
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      result.warnings.push('MusicBrainz lookup timed out');
    } else {
      result.warnings.push(`MusicBrainz lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return result;
}

/**
 * Look up song using Spotify API (requires access token)
 */
async function lookupSpotify(
  title: string,
  artist: string,
  timeout: number = 5000
): Promise<SongLookupResult> {
  const result: SongLookupResult = {
    found: false,
    confidence: 0,
    originalTitle: title,
    cleanedTitle: title,
    artist: artist,
    source: 'spotify',
    warnings: [],
    suggestions: []
  };

  try {
    // Check if we have Spotify access token
    const spotifyToken = localStorage.getItem('spotify_access_token');
    if (!spotifyToken) {
      result.warnings.push('Spotify access token not available');
      return result;
    }

    const query = `track:"${title}" artist:"${artist}"`;
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${spotifyToken}`,
        'Content-Type': 'application/json'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401) {
        result.warnings.push('Spotify token expired or invalid');
      } else {
        throw new Error(`Spotify API error: ${response.status}`);
      }
      return result;
    }

    const data = await response.json();
    
    if (data.tracks && data.tracks.items && data.tracks.items.length > 0) {
      const track = data.tracks.items[0];
      
      // Calculate confidence based on title and artist match
      const titleMatch = calculateStringSimilarity(title.toLowerCase(), track.name.toLowerCase());
      const artistMatch = track.artists && track.artists.length > 0 
        ? calculateStringSimilarity(artist.toLowerCase(), track.artists[0].name.toLowerCase())
        : 0;

      const confidence = (titleMatch + artistMatch) / 2;

      if (confidence >= 0.7) {
        result.found = true;
        result.confidence = confidence;
        result.cleanedTitle = track.name;
        result.artist = track.artists[0].name;
        result.album = track.album.name;
        result.year = track.album.release_date ? parseInt(track.album.release_date.split('-')[0]) : undefined;

        if (confidence < 0.9) {
          result.warnings.push('Title or artist name may not match exactly');
        }
      }
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      result.warnings.push('Spotify lookup timed out');
    } else {
      result.warnings.push(`Spotify lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return result;
}

/**
 * Calculate string similarity using Levenshtein distance
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) {
    return 1.0;
  }
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }
  
  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Batch lookup multiple songs
 */
export async function lookupSongList(
  songs: Array<{ id: string; name: string; artist: string }>,
  options: SongLookupOptions = DEFAULT_OPTIONS
): Promise<Array<{ id: string; lookup: SongLookupResult }>> {
  const results = await Promise.allSettled(
    songs.map(async (song) => ({
      id: song.id,
      lookup: await lookupSong(song.name, song.artist, options)
    }))
  );

  return results
    .filter((result): result is PromiseFulfilledResult<{ id: string; lookup: SongLookupResult }> => 
      result.status === 'fulfilled'
    )
    .map(result => result.value);
}

/**
 * Get a user-friendly lookup message
 */
export function getLookupMessage(lookup: SongLookupResult): string {
  if (lookup.found && lookup.confidence >= 0.9) {
    return '✅ Song verified in database';
  } else if (lookup.found && lookup.confidence >= 0.7) {
    return '⚠️ Song found but may need review';
  } else {
    return '❌ Song not found in database';
  }
}

/**
 * Get lookup color for UI display
 */
export function getLookupColor(lookup: SongLookupResult): string {
  if (lookup.found && lookup.confidence >= 0.9) {
    return '#00ff88'; // Green
  } else if (lookup.found && lookup.confidence >= 0.7) {
    return '#ffaa00'; // Orange
  } else {
    return '#ff4444'; // Red
  }
}
