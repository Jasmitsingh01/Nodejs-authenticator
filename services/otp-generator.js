const crypto = require('crypto');

/**
 * OTP Code Generator Service
 * Generates actual time-based and counter-based OTP codes
 */
class OTPGenerator {
  /**
   * Generate current OTP code
   * @param {Object} otpData - Parsed OTP data from QR code
   * @returns {Object} - Generated code with timing info
   */
  static generateCurrentCode(otpData) {
    if (!otpData || !otpData.secret) {
      throw new Error('Invalid OTP data or missing secret');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    
    switch (otpData.type) {
      case 'totp':
      case 'hex':
        return this.generateTOTP(otpData, currentTime);
      
      case 'hotp':
      case 'hhex':
        return this.generateHOTP(otpData);
      
      case 'steam':
        return this.generateSteamCode(otpData, currentTime);
      
      case 'battle':
        return this.generateBattleCode(otpData, currentTime);
      
      default:
        throw new Error(`Unsupported OTP type: ${otpData.type}`);
    }
  }

  /**
   * Generate Time-based OTP (TOTP)
   * @param {Object} otpData - OTP configuration
   * @param {number} currentTime - Current Unix timestamp
   * @returns {Object} - Generated TOTP code with timing
   */
  static generateTOTP(otpData, currentTime) {
    const period = otpData.period || 30;
    const counter = Math.floor(currentTime / period);
    const timeRemaining = period - (currentTime % period);
    
    const code = this.generateOTPCode(
      otpData.secret,
      counter,
      otpData.digits || 6,
      otpData.algorithm || 'SHA1',
      otpData.type === 'hex'
    );

    return {
      code: code,
      type: 'TOTP',
      timeRemaining: timeRemaining,
      period: period,
      counter: counter,
      nextRefresh: new Date((Math.floor(currentTime / period) + 1) * period * 1000),
      valid: timeRemaining > 0
    };
  }

  /**
   * Generate Counter-based OTP (HOTP)
   * @param {Object} otpData - OTP configuration
   * @returns {Object} - Generated HOTP code
   */
  static generateHOTP(otpData) {
    const counter = otpData.counter || 0;
    
    const code = this.generateOTPCode(
      otpData.secret,
      counter,
      otpData.digits || 6,
      otpData.algorithm || 'SHA1',
      otpData.type === 'hhex'
    );

    return {
      code: code,
      type: 'HOTP',
      counter: counter,
      nextCounter: counter + 1,
      note: 'Counter-based codes must be incremented after each use'
    };
  }

  /**
   * Generate Steam Guard code
   * @param {Object} otpData - OTP configuration
   * @param {number} currentTime - Current Unix timestamp
   * @returns {Object} - Generated Steam code
   */
  static generateSteamCode(otpData, currentTime) {
    const period = 30;
    const counter = Math.floor(currentTime / period);
    const timeRemaining = period - (currentTime % period);
    
    const code = this.generateSteamOTP(otpData.secret, counter);

    return {
      code: code,
      type: 'Steam',
      timeRemaining: timeRemaining,
      period: period,
      counter: counter,
      nextRefresh: new Date((Math.floor(currentTime / period) + 1) * period * 1000)
    };
  }

  /**
   * Generate Battle.net code
   * @param {Object} otpData - OTP configuration
   * @param {number} currentTime - Current Unix timestamp
   * @returns {Object} - Generated Battle.net code
   */
  static generateBattleCode(otpData, currentTime) {
    const period = 30;
    const counter = Math.floor(currentTime / period);
    const timeRemaining = period - (currentTime % period);
    
    const code = this.generateOTPCode(
      otpData.secret,
      counter,
      8, // Battle.net uses 8 digits
      'SHA1',
      false
    );

    return {
      code: code,
      type: 'Battle.net',
      timeRemaining: timeRemaining,
      period: period,
      counter: counter,
      nextRefresh: new Date((Math.floor(currentTime / period) + 1) * period * 1000)
    };
  }

  /**
   * Generate OTP code using HMAC
   * @param {string} secret - Base32 or hex encoded secret
   * @param {number} counter - Time counter or HOTP counter
   * @param {number} digits - Number of digits in code
   * @param {string} algorithm - Hash algorithm (SHA1, SHA256, SHA512)
   * @param {boolean} isHex - Whether secret is hex encoded
   * @returns {string} - Generated OTP code
   */
  static generateOTPCode(secret, counter, digits, algorithm, isHex = false) {
    // Decode secret
    const key = isHex ? this.hexToBuffer(secret) : this.base32ToBuffer(secret);
    
    // Convert counter to 8-byte buffer (big-endian)
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(0, 0);
    counterBuffer.writeUInt32BE(counter, 4);
    
    // Generate HMAC
    const hmac = crypto.createHmac(algorithm.toLowerCase(), key);
    hmac.update(counterBuffer);
    const hash = hmac.digest();
    
    // Dynamic truncation
    const offset = hash[hash.length - 1] & 0x0f;
    const truncatedHash = hash.readUInt32BE(offset) & 0x7fffffff;
    
    // Generate code
    const code = truncatedHash % Math.pow(10, digits);
    return code.toString().padStart(digits, '0');
  }

  /**
   * Generate Steam OTP code (special case)
   * @param {string} secret - Base32 encoded secret
   * @param {number} counter - Time counter
   * @returns {string} - Steam code (5 characters)
   */
  static generateSteamOTP(secret, counter) {
    const steamChars = '23456789BCDFGHJKMNPQRTVWXY';
    const key = this.base32ToBuffer(secret);
    
    // Convert counter to 8-byte buffer
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(0, 0);
    counterBuffer.writeUInt32BE(counter, 4);
    
    // Generate HMAC-SHA1
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(counterBuffer);
    const hash = hmac.digest();
    
    // Dynamic truncation
    const offset = hash[hash.length - 1] & 0x0f;
    const truncatedHash = hash.readUInt32BE(offset) & 0x7fffffff;
    
    // Convert to Steam format
    let code = '';
    let num = truncatedHash;
    for (let i = 0; i < 5; i++) {
      code += steamChars[num % steamChars.length];
      num = Math.floor(num / steamChars.length);
    }
    
    return code;
  }

  /**
   * Convert Base32 string to Buffer
   * @param {string} base32 - Base32 encoded string
   * @returns {Buffer} - Decoded buffer
   */
  static base32ToBuffer(base32) {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    let padding = 0;

    // Remove padding and convert to uppercase
    base32 = base32.toUpperCase().replace(/=/g, '');

    for (let i = 0; i < base32.length; i++) {
      const char = base32.charAt(i);
      const val = base32Chars.indexOf(char);
      if (val === -1) {
        throw new Error(`Invalid Base32 character: ${char}`);
      }
      bits += val.toString(2).padStart(5, '0');
    }

    // Convert bits to bytes
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      const byte = parseInt(bits.substr(i, 8), 2);
      bytes.push(byte);
    }

    return Buffer.from(bytes);
  }

  /**
   * Convert hex string to Buffer
   * @param {string} hex - Hex encoded string
   * @returns {Buffer} - Decoded buffer
   */
  static hexToBuffer(hex) {
    if (hex.length % 2 !== 0) {
      hex = '0' + hex;
    }
    return Buffer.from(hex, 'hex');
  }

  /**
   * Get multiple codes with timing information
   * @param {Object} otpData - OTP configuration
   * @param {number} count - Number of codes to generate (for TOTP shows next periods)
   * @returns {Array} - Array of generated codes
   */
  static getMultipleCodes(otpData, count = 3) {
    if (otpData.type === 'hotp' || otpData.type === 'hhex') {
      // For HOTP, generate next few counter values
      const codes = [];
      for (let i = 0; i < count; i++) {
        const hopData = { ...otpData, counter: (otpData.counter || 0) + i };
        const result = this.generateHOTP(hopData);
        codes.push({
          ...result,
          sequence: i,
          counterValue: hopData.counter
        });
      }
      return codes;
    } else {
      // For TOTP, generate current and next periods
      const currentTime = Math.floor(Date.now() / 1000);
      const period = otpData.period || 30;
      const codes = [];
      
      for (let i = 0; i < count; i++) {
        const timeOffset = i * period;
        const adjustedTime = currentTime + timeOffset;
        const result = this.generateTOTP(otpData, adjustedTime);
        codes.push({
          ...result,
          sequence: i,
          timeWindow: i === 0 ? 'current' : `+${i * period}s`,
          timestamp: new Date(adjustedTime * 1000)
        });
      }
      return codes;
    }
  }

  /**
   * Verify if a provided code matches the current expected code
   * @param {Object} otpData - OTP configuration
   * @param {string} providedCode - Code to verify
   * @param {number} windowSize - Time window tolerance (for TOTP)
   * @returns {Object} - Verification result
   */
  static verifyCode(otpData, providedCode, windowSize = 1) {
    const currentTime = Math.floor(Date.now() / 1000);
    
    if (otpData.type === 'hotp' || otpData.type === 'hhex') {
      // For HOTP, check current counter value
      const current = this.generateHOTP(otpData);
      return {
        valid: current.code === providedCode,
        counter: otpData.counter,
        providedCode: providedCode,
        expectedCode: current.code
      };
    } else {
      // For TOTP, check current time window and adjacent windows
      const period = otpData.period || 30;
      
      for (let i = -windowSize; i <= windowSize; i++) {
        const testTime = currentTime + (i * period);
        const testCode = this.generateTOTP(otpData, testTime);
        
        if (testCode.code === providedCode) {
          return {
            valid: true,
            timeOffset: i * period,
            providedCode: providedCode,
            expectedCode: testCode.code,
            timeWindow: i === 0 ? 'current' : (i < 0 ? 'previous' : 'next')
          };
        }
      }
      
      // No match found
      const current = this.generateTOTP(otpData, currentTime);
      return {
        valid: false,
        providedCode: providedCode,
        expectedCode: current.code,
        timeWindow: 'none'
      };
    }
  }
}

module.exports = OTPGenerator;

