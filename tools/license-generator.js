#!/usr/bin/env node

/**
 * TEMPO License Key Generator
 * 
 * Generates license keys for multi-tenant TEMPO deployments
 * Format: TEMPO-{ORG_CODE}-{YEAR}-{CHECKSUM}
 * 
 * Usage:
 *   node license-generator.js ACME
 *   node license-generator.js BETA 2025
 *   node license-generator.js --list
 */

const crypto = require('crypto');

// Default secret - should match server/index.js
const DEFAULT_SECRET = process.env.LICENSE_SECRET || 'TEMPO_DEFAULT_SECRET_2024';

function generateChecksum(orgCode, year, secret = DEFAULT_SECRET) {
  const combined = orgCode + year + secret;
  
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16).toUpperCase().substring(0, 6);
}

function generateLicenseKey(orgCode, year = null) {
  // Validate org code
  if (!orgCode || typeof orgCode !== 'string') {
    throw new Error('Organization code is required');
  }
  
  // Clean and validate org code
  orgCode = orgCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (orgCode.length < 2 || orgCode.length > 10) {
    throw new Error('Organization code must be 2-10 alphanumeric characters');
  }
  
  // Default to current year
  if (!year) {
    year = new Date().getFullYear();
  }
  
  // Validate year
  const currentYear = new Date().getFullYear();
  if (year < 2024 || year > currentYear + 5) {
    throw new Error(`Year must be between 2024 and ${currentYear + 5}`);
  }
  
  // Generate checksum
  const checksum = generateChecksum(orgCode, year.toString());
  
  // Format license key
  const licenseKey = `TEMPO-${orgCode}-${year}-${checksum}`;
  
  return {
    licenseKey,
    organizationId: orgCode,
    year: year,
    checksum: checksum,
    envVarPrefix: orgCode === 'DEFAULT' ? '' : `ORG_${orgCode}_`
  };
}

function validateLicenseKey(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { valid: false, error: 'License key is required' };
  }
  
  const parts = licenseKey.split('-');
  if (parts.length !== 4 || parts[0] !== 'TEMPO') {
    return { valid: false, error: 'Invalid license key format' };
  }
  
  const [prefix, orgCode, year, checksum] = parts;
  
  // Validate year
  const currentYear = new Date().getFullYear();
  const yearNum = parseInt(year);
  if (yearNum < 2024 || yearNum > currentYear + 5) {
    return { valid: false, error: `Invalid year: ${year}` };
  }
  
  // Validate checksum
  const expectedChecksum = generateChecksum(orgCode, year);
  if (checksum !== expectedChecksum) {
    return { valid: false, error: 'Invalid checksum' };
  }
  
  return {
    valid: true,
    organizationId: orgCode,
    year: yearNum,
    checksum: checksum,
    envVarPrefix: orgCode === 'DEFAULT' ? '' : `ORG_${orgCode}_`
  };
}

function displayHelp() {
  console.log(`
🎵 TEMPO License Key Generator

USAGE:
  node license-generator.js <ORG_CODE> [YEAR]
  node license-generator.js --validate <LICENSE_KEY>
  node license-generator.js --list
  node license-generator.js --help

EXAMPLES:
  node license-generator.js ACME           # Generate for ACME (current year)
  node license-generator.js BETA 2025     # Generate for BETA (year 2025)
  node license-generator.js --validate TEMPO-ACME-2024-A1B2C3
  node license-generator.js --list         # List example organizations

ORGANIZATION CODES:
  - 2-10 alphanumeric characters
  - Will be converted to uppercase
  - Used as organization ID in the system
  - Examples: ACME, BETA, CORP123, MUSIC

ENVIRONMENT VARIABLES:
  LICENSE_SECRET - Custom secret for checksum generation
                  (should match server deployment)
`);
}

function listExamples() {
  const examples = [
    'ACME',
    'BETA', 
    'CORP',
    'MUSIC',
    'EVENT',
    'PARTY',
    'CLUB',
    'RADIO'
  ];
  
  console.log('\n🏢 Example License Keys:\n');
  
  examples.forEach(org => {
    try {
      const license = generateLicenseKey(org);
      console.log(`Organization: ${org.padEnd(8)} → ${license.licenseKey}`);
    } catch (error) {
      console.log(`Organization: ${org.padEnd(8)} → Error: ${error.message}`);
    }
  });
  
  console.log('\n💡 Environment Variable Setup:');
  console.log('For each customer, add these to Railway Variables:');
  console.log('  ORG_ACME_SPOTIFY_ACCESS_TOKEN=...');
  console.log('  ORG_ACME_SPOTIFY_REFRESH_TOKEN=...');
  console.log('');
}

// Main CLI logic
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    displayHelp();
    return;
  }
  
  if (args[0] === '--list' || args[0] === '-l') {
    listExamples();
    return;
  }
  
  if (args[0] === '--validate' || args[0] === '-v') {
    if (!args[1]) {
      console.error('❌ License key required for validation');
      process.exit(1);
    }
    
    const result = validateLicenseKey(args[1]);
    if (result.valid) {
      console.log('✅ License key is VALID');
      console.log(`   Organization: ${result.organizationId}`);
      console.log(`   Year: ${result.year}`);
      console.log(`   Checksum: ${result.checksum}`);
      console.log(`   Env Prefix: ${result.envVarPrefix || '(none - default org)'}`);
    } else {
      console.log('❌ License key is INVALID');
      console.log(`   Error: ${result.error}`);
      process.exit(1);
    }
    return;
  }
  
  // Generate license key
  const orgCode = args[0];
  const year = args[1] ? parseInt(args[1]) : null;
  
  try {
    const license = generateLicenseKey(orgCode, year);
    
    console.log('\n🎵 TEMPO License Key Generated!\n');
    console.log(`License Key: ${license.licenseKey}`);
    console.log(`Organization: ${license.organizationId}`);
    console.log(`Year: ${license.year}`);
    console.log(`Checksum: ${license.checksum}`);
    console.log('');
    console.log('🚀 Environment Variables for Railway:');
    console.log(`   ${license.envVarPrefix}SPOTIFY_ACCESS_TOKEN=<customer_access_token>`);
    console.log(`   ${license.envVarPrefix}SPOTIFY_REFRESH_TOKEN=<customer_refresh_token>`);
    console.log('');
    console.log('📋 Customer Instructions:');
    console.log(`1. Customer connects their Spotify account`);
    console.log(`2. Get their tokens from /api/spotify/tokens endpoint`);
    console.log(`3. Add the environment variables above to Railway`);
    console.log(`4. Customer uses license key: ${license.licenseKey}`);
    console.log('');
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Export for testing
if (require.main === module) {
  main();
} else {
  module.exports = {
    generateLicenseKey,
    validateLicenseKey,
    generateChecksum
  };
}
