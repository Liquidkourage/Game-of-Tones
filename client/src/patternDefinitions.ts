// Shared bingo pattern definitions for consistency across all interfaces

export type BingoPattern = 'line' | 'four_corners' | 'x' | 't' | 'l' | 'u' | 'plus' | 'full_card' | 'custom';

export interface PatternDefinition {
  value: BingoPattern;
  label: string;
  description: string;
  positions: string[];
}

export interface SavedCustomPattern {
  id: string;
  name: string;
  positions: string[];
  createdAt: number;
}

export const BINGO_PATTERNS: Record<BingoPattern, PatternDefinition> = {
  line: {
    value: 'line',
    label: 'Line',
    description: 'Any row, column, or diagonal',
    positions: [] // Dynamic - any complete line
  },
  four_corners: {
    value: 'four_corners',
    label: 'Four Corners',
    description: 'All four corner squares',
    positions: ['0-0', '0-4', '4-0', '4-4']
  },
  x: {
    value: 'x',
    label: 'X Pattern',
    description: 'Both diagonal lines',
    positions: ['0-0', '1-1', '2-2', '3-3', '4-4', '0-4', '1-3', '2-2', '3-1', '4-0']
  },
  t: {
    value: 't',
    label: 'T Pattern',
    description: 'Top row + middle column',
    positions: ['0-0', '0-1', '0-2', '0-3', '0-4', '1-2', '2-2', '3-2', '4-2']
  },
  l: {
    value: 'l',
    label: 'L Pattern',
    description: 'Left column + bottom row',
    positions: ['0-0', '1-0', '2-0', '3-0', '4-0', '4-1', '4-2', '4-3', '4-4']
  },
  u: {
    value: 'u',
    label: 'U Pattern',
    description: 'Left + right columns + bottom row',
    positions: ['0-0', '1-0', '2-0', '3-0', '4-0', '0-4', '1-4', '2-4', '3-4', '4-4', '4-1', '4-2', '4-3']
  },
  plus: {
    value: 'plus',
    label: 'Plus Pattern',
    description: 'Middle row + middle column',
    positions: ['2-0', '2-1', '2-2', '2-3', '2-4', '0-2', '1-2', '3-2', '4-2']
  },
  full_card: {
    value: 'full_card',
    label: 'Full Card',
    description: 'All 25 squares',
    positions: Array.from({ length: 25 }, (_, i) => `${Math.floor(i / 5)}-${i % 5}`)
  },
  custom: {
    value: 'custom',
    label: 'Custom',
    description: 'Custom pattern (set squares manually)',
    positions: [] // User-defined
  }
};

export const PATTERN_OPTIONS = Object.values(BINGO_PATTERNS);

// Helper function to check if a position is part of a pattern
export function isPositionInPattern(position: string, pattern: BingoPattern, customPositions?: string[]): boolean {
  if (pattern === 'custom') {
    return customPositions ? customPositions.includes(position) : false;
  }
  
  const patternDef = BINGO_PATTERNS[pattern];
  if (!patternDef) return false;
  
  return patternDef.positions.includes(position);
}

// Helper function to get pattern display name
export function getPatternDisplayName(pattern: BingoPattern): string {
  return BINGO_PATTERNS[pattern]?.label || pattern;
}

// Helper function to validate pattern positions
export function validatePatternPositions(positions: string[]): boolean {
  return positions.every(pos => /^[0-4]-[0-4]$/.test(pos));
}

// Custom pattern storage utilities
const CUSTOM_PATTERNS_KEY = 'bingo_custom_patterns';

export function getSavedCustomPatterns(): SavedCustomPattern[] {
  try {
    const stored = localStorage.getItem(CUSTOM_PATTERNS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveCustomPattern(pattern: Omit<SavedCustomPattern, 'id' | 'createdAt'>): SavedCustomPattern {
  const savedPattern: SavedCustomPattern = {
    ...pattern,
    id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: Date.now()
  };
  
  const existing = getSavedCustomPatterns();
  existing.push(savedPattern);
  
  try {
    localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(existing));
  } catch (error) {
    console.error('Failed to save custom pattern:', error);
  }
  
  return savedPattern;
}

export function deleteCustomPattern(id: string): void {
  const existing = getSavedCustomPatterns();
  const filtered = existing.filter(p => p.id !== id);
  
  try {
    localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to delete custom pattern:', error);
  }
}
