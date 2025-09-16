const { v4: uuidv4 } = require('uuid');

/**
 * OTP Types supported
 */
const OTPType = {
  TOTP: 'totp',
  HOTP: 'hotp',
  BATTLE: 'battle',
  STEAM: 'steam',
  HEX: 'hex',
  HHEX: 'hhex'
};

/**
 * OTP Algorithms supported
 */
const OTPAlgorithm = {
  SHA1: 'SHA1',
  SHA256: 'SHA256', 
  SHA512: 'SHA512',
  GOST3411_2012_256: 'GOST3411_2012_256',
  GOST3411_2012_512: 'GOST3411_2012_512'
};

/**
 * Parse otpauth:// or otpauth-migration:// URLs
 * @param {string} otpUrl - The OTP URL from QR code
 * @returns {Object|null} - Parsed OTP data or null if invalid
 */
function parseOTPAuth(otpUrl) {
  if (!otpUrl || typeof otpUrl !== 'string') {
    return null;
  }

  try {
    // Handle otpauth-migration:// URLs (Google Authenticator export)
    if (otpUrl.startsWith('otpauth-migration://')) {
      return parseMigrationUrl(otpUrl);
    }

    // Handle standard otpauth:// URLs
    if (otpUrl.startsWith('otpauth://')) {
      return parseStandardOTPUrl(otpUrl);
    }

    return null;
  } catch (error) {
    console.error('Error parsing OTP URL:', error);
    return null;
  }
}

/**
 * Parse standard otpauth:// URL
 * @param {string} otpUrl - The otpauth:// URL
 * @returns {Object|null} - Parsed OTP data
 */
function parseStandardOTPUrl(otpUrl) {
  try {
    // Extract the part after otpauth://
    let uri = otpUrl.split('otpauth://')[1];
    if (!uri) {
      return null;
    }

    // Extract type (totp or hotp)
    let type = uri.substr(0, 4).toLowerCase();
    uri = uri.substr(5);

    // Extract label and parameters
    let label = uri.split('?')[0];
    const parameterPart = uri.split('?')[1];
    
    if (!label || !parameterPart) {
      return null;
    }

    // Decode label
    try {
      label = decodeURIComponent(label);
    } catch (error) {
      console.error('Error decoding label:', error);
    }

    // Parse issuer and account from label
    let issuer;
    let account;
    if (label.indexOf(':') !== -1) {
      issuer = label.split(':')[0];
      account = label.split(':')[1];
    } else {
      account = label;
    }

    // Parse parameters
    const parameters = parameterPart.split('&');
    let secret = '';
    let algorithm;
    let period;
    let digits;
    let counter;

    parameters.forEach((item) => {
      const parameter = item.split('=');
      const key = parameter[0].toLowerCase();
      const value = parameter[1];

      switch (key) {
        case 'secret':
          secret = value;
          break;
        case 'issuer':
          try {
            issuer = decodeURIComponent(value);
          } catch {
            issuer = value;
          }
          issuer = issuer.replace(/\+/g, ' ');
          break;
        case 'counter':
          counter = Number(value);
          counter = isNaN(counter) || counter < 0 ? 0 : counter;
          break;
        case 'period':
          period = Number(value);
          period = isNaN(period) || period < 0 || period > 60 || 60 % period !== 0 
            ? undefined 
            : period;
          break;
        case 'digits':
          digits = Number(value);
          digits = isNaN(digits) || digits === 0 ? 6 : digits;
          break;
        case 'algorithm':
          algorithm = value.toUpperCase();
          break;
      }
    });

    // Validate secret
    if (!secret) {
      return null;
    }

    // Validate secret format
    if (!/^[0-9a-f]+$/i.test(secret) && !/^[2-7a-z]+=*$/i.test(secret)) {
      return {
        error: 'Invalid secret format',
        secret: secret,
        originalUrl: otpUrl
      };
    }

    // Determine actual type based on secret format
    if (!/^[2-7a-z]+=*$/i.test(secret) && /^[0-9a-f]+$/i.test(secret)) {
      if (type === 'totp') {
        type = 'hex';
      } else if (type === 'hotp') {
        type = 'hhex';
      }
    }

    // Handle special vendor formats
    if (/^(blz-|bliz-)/.test(secret)) {
      const secretMatches = secret.match(/^(blz-|bliz-)(.*)/);
      if (secretMatches && secretMatches.length >= 3) {
        secret = secretMatches[2];
        type = 'battle';
      }
    }

    if (/^stm-/.test(secret)) {
      const secretMatches = secret.match(/^stm-(.*)/);
      if (secretMatches && secretMatches.length >= 2) {
        secret = secretMatches[1];
        type = 'steam';
      }
    }

    // Build result object
    const result = {
      type: type,
      label: label,
      issuer: issuer || '',
      account: account || '',
      secret: secret,
      algorithm: algorithm || 'SHA1',
      digits: digits || 6,
      period: period || 30,
      counter: counter || 0,
      hash: uuidv4(),
      originalUrl: otpUrl,
      valid: true
    };

    return result;

  } catch (error) {
    console.error('Error parsing standard OTP URL:', error);
    return null;
  }
}

/**
 * Parse otpauth-migration:// URL (Google Authenticator export format)
 * @param {string} migrationUrl - The migration URL
 * @returns {Object|null} - Parsed migration data
 */
function parseMigrationUrl(migrationUrl) {
  try {
    // This is a simplified version - full implementation would need protobuf parsing
    // For now, return a structured response indicating migration URLs need special handling
    
    return {
      type: 'migration',
      originalUrl: migrationUrl,
      message: 'Migration URLs require specialized parsing',
      note: 'This appears to be a Google Authenticator migration QR code. These contain multiple accounts and require protobuf decoding.',
      suggestion: 'Try importing individual QR codes for each account instead.',
      valid: false
    };

  } catch (error) {
    console.error('Error parsing migration URL:', error);
    return null;
  }
}

/**
 * Validate OTP entry data
 * @param {Object} otpData - The parsed OTP data
 * @returns {Object} - Validation result
 */
function validateOTPData(otpData) {
  const errors = [];
  const warnings = [];

  if (!otpData) {
    return { valid: false, errors: ['No OTP data provided'] };
  }

  // Check required fields
  if (!otpData.secret) {
    errors.push('Secret is required');
  }

  if (!otpData.type) {
    errors.push('OTP type is required');
  }

  // Validate type
  if (otpData.type && !Object.values(OTPType).includes(otpData.type)) {
    errors.push(`Invalid OTP type: ${otpData.type}`);
  }

  // Validate algorithm
  if (otpData.algorithm && !Object.values(OTPAlgorithm).includes(otpData.algorithm)) {
    warnings.push(`Unknown algorithm: ${otpData.algorithm}, will default to SHA1`);
  }

  // Validate digits
  if (otpData.digits && (otpData.digits < 4 || otpData.digits > 10)) {
    warnings.push(`Unusual digit count: ${otpData.digits}, typical values are 6-8`);
  }

  // Validate period for TOTP
  if (otpData.type === OTPType.TOTP && otpData.period) {
    if (otpData.period < 15 || otpData.period > 300) {
      warnings.push(`Unusual period: ${otpData.period} seconds, typical value is 30`);
    }
  }

  // Check for missing issuer
  if (!otpData.issuer) {
    warnings.push('No issuer specified - this may make it harder to identify the account');
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

/**
 * Format OTP data for client response
 * @param {Object} otpData - The parsed OTP data
 * @returns {Object} - Formatted response
 */
function formatOTPResponse(otpData) {
  if (!otpData) {
    return null;
  }

  const validation = validateOTPData(otpData);

  return {
    ...otpData,
    validation: validation,
    generatedAt: new Date().toISOString(),
    // Add user-friendly type description
    typeDescription: getTypeDescription(otpData.type),
    // Add algorithm description
    algorithmDescription: getAlgorithmDescription(otpData.algorithm)
  };
}

/**
 * Get user-friendly description for OTP type
 * @param {string} type - OTP type
 * @returns {string} - Description
 */
function getTypeDescription(type) {
  const descriptions = {
    [OTPType.TOTP]: 'Time-based (TOTP) - codes change every 30 seconds',
    [OTPType.HOTP]: 'Counter-based (HOTP) - codes change when used',
    [OTPType.BATTLE]: 'Battle.net authenticator format',
    [OTPType.STEAM]: 'Steam Guard authenticator format',
    [OTPType.HEX]: 'Time-based with hex encoding',
    [OTPType.HHEX]: 'Counter-based with hex encoding'
  };

  return descriptions[type] || `Unknown type: ${type}`;
}

/**
 * Get user-friendly description for algorithm
 * @param {string} algorithm - Algorithm name
 * @returns {string} - Description
 */
function getAlgorithmDescription(algorithm) {
  const descriptions = {
    [OTPAlgorithm.SHA1]: 'SHA-1 (most common)',
    [OTPAlgorithm.SHA256]: 'SHA-256 (more secure)',
    [OTPAlgorithm.SHA512]: 'SHA-512 (most secure)',
    [OTPAlgorithm.GOST3411_2012_256]: 'GOST R 34.11-2012 256-bit',
    [OTPAlgorithm.GOST3411_2012_512]: 'GOST R 34.11-2012 512-bit'
  };

  return descriptions[algorithm] || `Custom algorithm: ${algorithm}`;
}

module.exports = {
  parseOTPAuth,
  parseStandardOTPUrl,
  parseMigrationUrl,
  validateOTPData,
  formatOTPResponse,
  OTPType,
  OTPAlgorithm
};
