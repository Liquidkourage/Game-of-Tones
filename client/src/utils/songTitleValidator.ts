/**
 * Song Title Validation Utility
 * Detects potentially over-cleaned or problematic song titles
 * to help ensure important words aren't missing
 * Now includes real song database lookup for accurate validation
 */

import { lookupSong, SongLookupResult, getLookupMessage, getLookupColor } from './songLookupService';

export interface ValidationResult {
  isValid: boolean;
  confidence: number; // 0-1, where 1 is very confident it's a real song
  warnings: string[];
  suggestions: string[];
  lookupResult?: SongLookupResult; // Real database lookup result
  useLookup: boolean; // Whether lookup was used
}

export interface SongValidationOptions {
  minLength?: number;
  maxLength?: number;
  requireCommonWords?: boolean;
  checkForOverCleaning?: boolean;
  checkForGenericTitles?: boolean;
  useLookup?: boolean; // Whether to use real song database lookup
  lookupTimeout?: number; // Timeout for lookup requests
}

const DEFAULT_OPTIONS: SongValidationOptions = {
  minLength: 3,
  maxLength: 100,
  requireCommonWords: true,
  checkForOverCleaning: true,
  checkForGenericTitles: true,
  useLookup: true,
  lookupTimeout: 3000
};

// Common words that appear in many song titles
const COMMON_SONG_WORDS = [
  'love', 'heart', 'dream', 'night', 'day', 'time', 'life', 'world', 'home',
  'baby', 'girl', 'boy', 'man', 'woman', 'friend', 'family', 'mother', 'father',
  'sun', 'moon', 'star', 'sky', 'rain', 'fire', 'water', 'wind', 'earth',
  'music', 'song', 'dance', 'sing', 'play', 'rock', 'roll', 'blues', 'jazz',
  'happy', 'sad', 'free', 'wild', 'young', 'old', 'new', 'good', 'bad',
  'big', 'small', 'high', 'low', 'fast', 'slow', 'hot', 'cold', 'warm',
  'red', 'blue', 'green', 'black', 'white', 'gold', 'silver', 'bright',
  'city', 'town', 'street', 'road', 'house', 'door', 'window', 'room',
  'car', 'train', 'plane', 'boat', 'ship', 'fly', 'drive', 'walk', 'run',
  'eyes', 'hands', 'face', 'smile', 'tears', 'kiss', 'touch', 'hold',
  'break', 'fall', 'rise', 'turn', 'change', 'stay', 'go', 'come', 'leave',
  'find', 'lose', 'win', 'fight', 'peace', 'war', 'hope', 'fear', 'pain'
];

// Generic titles that might indicate over-cleaning
const GENERIC_TITLES = [
  'song', 'music', 'track', 'melody', 'tune', 'beat', 'rhythm', 'sound',
  'piece', 'composition', 'number', 'hit', 'single', 'album', 'record',
  'untitled', 'unknown', 'mystery', 'secret', 'hidden', 'lost', 'found'
];

// Very short titles that might be problematic
const SUSPICIOUSLY_SHORT = [
  'a', 'an', 'the', 'i', 'me', 'my', 'we', 'us', 'it', 'is', 'am', 'are',
  'be', 'do', 'go', 'no', 'so', 'up', 'in', 'on', 'at', 'to', 'of', 'or',
  'oh', 'ah', 'la', 'da', 'na', 'yeah', 'hey', 'wow', 'yes', 'ok'
];

// Known complete song titles that are short but valid
const KNOWN_COMPLETE_TITLES = [
  'lowdown', 'uptown', 'downtown', 'uptight'
];

/**
 * Validates a song title to detect potential issues
 * Now includes real song database lookup for accurate validation
 */
export async function validateSongTitle(
  title: string, 
  originalTitle?: string,
  artist?: string,
  options: SongValidationOptions = DEFAULT_OPTIONS
): Promise<ValidationResult> {
  const result: ValidationResult = {
    isValid: true,
    confidence: 1.0,
    warnings: [],
    suggestions: [],
    useLookup: false
  };

  if (!title || typeof title !== 'string') {
    result.isValid = false;
    result.confidence = 0;
    result.warnings.push('Title is empty or invalid');
    return result;
  }

  const cleanTitle = title.trim();
  const words = cleanTitle.toLowerCase().split(/\s+/).filter(word => word.length > 0);

  // Check minimum length
  if (cleanTitle.length < (options.minLength || 3)) {
    result.warnings.push(`Title is very short (${cleanTitle.length} characters)`);
    result.confidence -= 0.3;
  }

  // Check maximum length
  if (cleanTitle.length > (options.maxLength || 100)) {
    result.warnings.push(`Title is very long (${cleanTitle.length} characters)`);
    result.confidence -= 0.1;
  }

  // Check for suspiciously short titles
  if (SUSPICIOUSLY_SHORT.includes(cleanTitle.toLowerCase())) {
    result.warnings.push('Title appears to be a single common word');
    result.confidence -= 0.5;
    result.suggestions.push('Consider if this is the complete song title');
  }

  // Check for generic titles
  if (options.checkForGenericTitles) {
    const isGeneric = GENERIC_TITLES.some(generic => 
      cleanTitle.toLowerCase().includes(generic.toLowerCase())
    );
    if (isGeneric && words.length <= 2) {
      result.warnings.push('Title appears generic or incomplete');
      result.confidence -= 0.4;
      result.suggestions.push('This might be missing the actual song name');
    }
  }

  // Check for common song words (if enabled)
  if (options.requireCommonWords && words.length > 1) {
    const hasCommonWords = words.some(word => 
      COMMON_SONG_WORDS.includes(word.toLowerCase())
    );
    if (!hasCommonWords && words.length >= 3) {
      result.warnings.push('Title doesn\'t contain common song words');
      result.confidence -= 0.2;
    }
  }

  // Check for over-cleaning by comparing with original
  if (options.checkForOverCleaning && originalTitle) {
    const originalWords = originalTitle.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const cleanedWords = words;
    
    // Only flag as over-cleaned if:
    // 1. We removed more than 50% of words AND
    // 2. The cleaned title is suspiciously short (less than 3 words) AND
    // 3. The original title had technical metadata that was removed
    const wordReduction = (originalWords.length - cleanedWords.length) / originalWords.length;
    const originalHasTechnicalMetadata = /\(feat\.|featuring|with|from|live|remaster|version|explicit|clean|radio edit|single version|album version|extended|instrumental|acoustic|studio\)/i.test(originalTitle);
    const cleanedIsVeryShort = cleanedWords.length < 3;
    
    if (wordReduction > 0.5 && cleanedIsVeryShort && originalHasTechnicalMetadata) {
      // But don't flag if the cleaned title is a known complete song title
      const isKnownCompleteTitle = cleanedWords.length >= 2 || 
        KNOWN_COMPLETE_TITLES.includes(cleanTitle.toLowerCase()) ||
        !SUSPICIOUSLY_SHORT.includes(cleanTitle.toLowerCase()) ||
        !GENERIC_TITLES.some(generic => cleanTitle.toLowerCase().includes(generic.toLowerCase()));
      
      if (!isKnownCompleteTitle) {
        result.warnings.push('Title may be over-cleaned (removed >50% of words)');
        result.confidence -= 0.3;
        result.suggestions.push('Consider keeping more of the original title');
      }
    }

    // If original had recognizable patterns but cleaned doesn't
    const originalHasPatterns = /\(feat\.|featuring|with|from|live|remaster|version\)/i.test(originalTitle);
    const cleanedHasPatterns = /\(feat\.|featuring|with|from|live|remaster|version\)/i.test(cleanTitle);
    
    if (originalHasPatterns && !cleanedHasPatterns && wordReduction > 0.3) {
      result.warnings.push('Removed potentially important information');
      result.confidence -= 0.2;
      result.suggestions.push('Some removed text might be important for recognition');
    }
  }

  // Check for titles that are just numbers or symbols
  if (/^[\d\s\-_\.]+$/.test(cleanTitle)) {
    result.warnings.push('Title contains only numbers and symbols');
    result.confidence -= 0.6;
    result.suggestions.push('This doesn\'t appear to be a song title');
  }

  // Check for titles that are all caps (might indicate issues)
  if (cleanTitle === cleanTitle.toUpperCase() && cleanTitle.length > 5) {
    result.warnings.push('Title is in all caps');
    result.confidence -= 0.1;
    result.suggestions.push('Consider proper capitalization');
  }

  // Use real song database lookup if enabled and artist is provided
  if (options.useLookup && artist && title.length > 2) {
    try {
      result.useLookup = true;
      const lookupResult = await lookupSong(title, artist, {
        timeout: options.lookupTimeout || 3000
      });
      
      result.lookupResult = lookupResult;
      
      if (lookupResult.found) {
        // If lookup found the song, use its confidence
        result.confidence = Math.max(result.confidence, lookupResult.confidence);
        
        if (lookupResult.confidence >= 0.9) {
          result.warnings = result.warnings.filter(w => !w.includes('over-cleaned'));
          result.suggestions.push('Song verified in music database');
        } else if (lookupResult.confidence >= 0.7) {
          result.warnings.push('Song found but title may not match exactly');
          result.suggestions.push('Consider using the exact title from the database');
        }
      } else {
        // If lookup didn't find the song, it might be over-cleaned or incorrect
        result.confidence = Math.min(result.confidence, 0.3);
        result.warnings.push('Song not found in music databases');
        result.suggestions.push('Verify the song title and artist are correct');
        result.suggestions.push('The title might be over-cleaned or misspelled');
      }
    } catch (error) {
      result.warnings.push(`Database lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.suggestions.push('Using pattern-based validation only');
    }
  }

  // Determine overall validity
  result.isValid = result.confidence >= 0.5;
  result.confidence = Math.max(0, Math.min(1, result.confidence));

  return result;
}

/**
 * Get a validation summary for multiple songs
 */
export async function validateSongList(
  songs: Array<{ id: string; name: string; originalName?: string; artist?: string }>,
  options: SongValidationOptions = DEFAULT_OPTIONS
): Promise<{
  totalSongs: number;
  validSongs: number;
  problematicSongs: Array<{
    id: string;
    name: string;
    originalName?: string;
    artist?: string;
    validation: ValidationResult;
  }>;
  overallConfidence: number;
}> {
  const problematicSongs: Array<{
    id: string;
    name: string;
    originalName?: string;
    artist?: string;
    validation: ValidationResult;
  }> = [];

  let totalConfidence = 0;

  // Process songs in parallel for better performance
  const validationPromises = songs.map(async (song) => {
    const validation = await validateSongTitle(song.name, song.originalName, song.artist, options);
    return { song, validation };
  });

  const results = await Promise.allSettled(validationPromises);

  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      const { song, validation } = result.value;
      totalConfidence += validation.confidence;

      if (!validation.isValid || validation.confidence < 0.7) {
        problematicSongs.push({
          id: song.id,
          name: song.name,
          originalName: song.originalName,
          artist: song.artist,
          validation
        });
      }
    }
  });

  return {
    totalSongs: songs.length,
    validSongs: songs.length - problematicSongs.length,
    problematicSongs,
    overallConfidence: songs.length > 0 ? totalConfidence / songs.length : 1
  };
}

/**
 * Get a user-friendly validation message
 */
export function getValidationMessage(validation: ValidationResult): string {
  if (validation.isValid && validation.confidence >= 0.8) {
    return '✅ Title looks good';
  } else if (validation.isValid && validation.confidence >= 0.6) {
    return '⚠️ Title might need review';
  } else {
    return '❌ Title needs attention';
  }
}

/**
 * Get validation color for UI display
 */
export function getValidationColor(validation: ValidationResult): string {
  if (validation.isValid && validation.confidence >= 0.8) {
    return '#00ff88'; // Green
  } else if (validation.isValid && validation.confidence >= 0.6) {
    return '#ffaa00'; // Orange
  } else {
    return '#ff4444'; // Red
  }
}

/**
 * Quick synchronous validation for immediate UI display
 * Uses only pattern-based validation without database lookup
 */
export function validateSongTitleSync(
  title: string, 
  originalTitle?: string,
  options: SongValidationOptions = DEFAULT_OPTIONS
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    confidence: 1.0,
    warnings: [],
    suggestions: [],
    useLookup: false
  };

  if (!title || typeof title !== 'string') {
    result.isValid = false;
    result.confidence = 0;
    result.warnings.push('Title is empty or invalid');
    return result;
  }

  const cleanTitle = title.trim();
  const words = cleanTitle.toLowerCase().split(/\s+/).filter(word => word.length > 0);

  // Check minimum length
  if (cleanTitle.length < (options.minLength || 3)) {
    result.warnings.push(`Title is very short (${cleanTitle.length} characters)`);
    result.confidence -= 0.3;
  }

  // Check for suspiciously short titles
  if (SUSPICIOUSLY_SHORT.includes(cleanTitle.toLowerCase())) {
    result.warnings.push('Title appears to be a single common word');
    result.confidence -= 0.5;
    result.suggestions.push('Consider if this is the complete song title');
  }

  // Check for generic titles
  if (options.checkForGenericTitles) {
    const isGeneric = GENERIC_TITLES.some(generic => 
      cleanTitle.toLowerCase().includes(generic.toLowerCase())
    );
    if (isGeneric && words.length <= 2) {
      result.warnings.push('Title appears generic or incomplete');
      result.confidence -= 0.4;
      result.suggestions.push('This might be missing the actual song name');
    }
  }

  // Check for over-cleaning by comparing with original
  if (options.checkForOverCleaning && originalTitle) {
    const originalWords = originalTitle.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const cleanedWords = words;
    
    // Only flag as over-cleaned if:
    // 1. We removed more than 50% of words AND
    // 2. The cleaned title is suspiciously short (less than 3 words) AND
    // 3. The original title had technical metadata that was removed
    const wordReduction = (originalWords.length - cleanedWords.length) / originalWords.length;
    const originalHasTechnicalMetadata = /\(feat\.|featuring|with|from|live|remaster|version|explicit|clean|radio edit|single version|album version|extended|instrumental|acoustic|studio\)/i.test(originalTitle);
    const cleanedIsVeryShort = cleanedWords.length < 3;
    
    if (wordReduction > 0.5 && cleanedIsVeryShort && originalHasTechnicalMetadata) {
      // But don't flag if the cleaned title is a known complete song title
      const isKnownCompleteTitle = cleanedWords.length >= 2 || 
        KNOWN_COMPLETE_TITLES.includes(cleanTitle.toLowerCase()) ||
        !SUSPICIOUSLY_SHORT.includes(cleanTitle.toLowerCase()) ||
        !GENERIC_TITLES.some(generic => cleanTitle.toLowerCase().includes(generic.toLowerCase()));
      
      if (!isKnownCompleteTitle) {
        result.warnings.push('Title may be over-cleaned (removed >50% of words)');
        result.confidence -= 0.3;
        result.suggestions.push('Consider keeping more of the original title');
      }
    }
  }

  // Determine overall validity
  result.isValid = result.confidence >= 0.5;
  result.confidence = Math.max(0, Math.min(1, result.confidence));

  return result;
}
