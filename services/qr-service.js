const Jimp = require('jimp');
const jsQR = require('jsqr');
const { parseOTPAuth } = require('../lib/otp-parser');
const fs = require('fs').promises;

class QRService {
  /**
   * Process QR code from image file path
   * @param {string} imagePath - Path to the image file
   * @returns {Object} - Processing result
   */
  static async processQRImage(imagePath) {
    const startTime = Date.now();
    
    try {
      console.log(`Reading image from: ${imagePath}`);
      
      // Check if file exists
      try {
        await fs.access(imagePath);
      } catch (error) {
        return {
          success: false,
          error: 'Image file not found',
          code: 'FILE_NOT_FOUND',
          processingTime: Date.now() - startTime
        };
      }

      // Read and process the image
      const image = await Jimp.read(imagePath);
      const result = await this.processJimpImage(image);
      
      return {
        ...result,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      console.error('Error processing QR image:', error);
      return {
        success: false,
        error: 'Failed to process image file',
        code: 'IMAGE_PROCESSING_ERROR',
        details: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Process QR code from base64 image data
   * @param {string} base64Data - Base64 encoded image with data URL prefix
   * @returns {Object} - Processing result
   */
  static async processBase64QR(base64Data) {
    const startTime = Date.now();
    
    try {
      console.log('Processing base64 QR image');
      
      // Validate base64 format
      if (!base64Data || !base64Data.startsWith('data:image/')) {
        return {
          success: false,
          error: 'Invalid base64 image format. Must start with data:image/',
          code: 'INVALID_BASE64_FORMAT',
          processingTime: Date.now() - startTime
        };
      }

      // Convert base64 to buffer
      const base64String = base64Data.split(',')[1];
      if (!base64String) {
        return {
          success: false,
          error: 'Invalid base64 data. Missing base64 content after comma.',
          code: 'INVALID_BASE64_CONTENT',
          processingTime: Date.now() - startTime
        };
      }

      let buffer;
      try {
        buffer = Buffer.from(base64String, 'base64');
      } catch (error) {
        return {
          success: false,
          error: 'Invalid base64 encoding',
          code: 'BASE64_DECODE_ERROR',
          processingTime: Date.now() - startTime
        };
      }

      // Process with Jimp
      const image = await Jimp.read(buffer);
      const result = await this.processJimpImage(image);
      
      return {
        ...result,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      console.error('Error processing base64 QR:', error);
      return {
        success: false,
        error: 'Failed to process base64 image',
        code: 'BASE64_PROCESSING_ERROR',
        details: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Process a Jimp image object to extract QR code
   * @param {Jimp} image - Jimp image object
   * @returns {Object} - Processing result
   */
  static async processJimpImage(image) {
    try {
      console.log(`Processing image: ${image.getWidth()}x${image.getHeight()}`);
      
      // Get image info
      const imageInfo = {
        width: image.getWidth(),
        height: image.getHeight(),
        hasAlpha: image.hasAlpha(),
        // Jimp doesn't have getColorType, so we'll determine it from the bitmap
        channels: image.hasAlpha() ? 4 : 3
      };

      // Try multiple processing approaches for better QR detection
      const attempts = [
        // Original image
        { image: image.clone(), description: 'original' },
        // Grayscale
        { image: image.clone().greyscale(), description: 'grayscale' },
        // High contrast
        { image: image.clone().contrast(0.5), description: 'high contrast' },
        // Inverted (for dark QR codes on light background)
        { image: image.clone().invert(), description: 'inverted' },
        // Grayscale + contrast
        { image: image.clone().greyscale().contrast(0.3), description: 'grayscale + contrast' }
      ];

      // If image is very large, try a resized version
      if (image.getWidth() > 1000 || image.getHeight() > 1000) {
        const maxDimension = 800;
        const scale = Math.min(maxDimension / image.getWidth(), maxDimension / image.getHeight());
        attempts.push({
          image: image.clone().scale(scale),
          description: `resized to ${Math.round(image.getWidth() * scale)}x${Math.round(image.getHeight() * scale)}`
        });
      }

      let qrData = null;
      let successfulMethod = null;

      // Try each processing method
      for (const attempt of attempts) {
        try {
          console.log(`Trying QR detection with: ${attempt.description}`);
          
          const result = await this.extractQRFromJimp(attempt.image);
          if (result) {
            qrData = result;
            successfulMethod = attempt.description;
            console.log(`✅ QR code found using: ${attempt.description}`);
            break;
          }
        } catch (error) {
          console.log(`❌ Failed with ${attempt.description}:`, error.message);
          continue;
        }
      }

      if (!qrData) {
        return {
          success: false,
          error: 'No QR code detected in image',
          code: 'NO_QR_FOUND',
          imageInfo: imageInfo,
          attemptsCount: attempts.length
        };
      }

      // Parse the QR data
      console.log(`Found QR data: ${qrData.substring(0, 100)}...`);
      const parsedOTP = parseOTPAuth(qrData);
      
      if (!parsedOTP) {
        return {
          success: false,
          error: 'QR code does not contain valid OTP data',
          code: 'INVALID_QR_DATA',
          qrData: qrData,
          imageInfo: imageInfo,
          detectionMethod: successfulMethod
        };
      }

      return {
        success: true,
        data: parsedOTP,
        qrData: qrData,
        imageInfo: imageInfo,
        detectionMethod: successfulMethod
      };

    } catch (error) {
      console.error('Error in processJimpImage:', error);
      return {
        success: false,
        error: 'Failed to process image',
        code: 'IMAGE_PROCESSING_ERROR',
        details: error.message
      };
    }
  }

  /**
   * Extract QR code data from Jimp image
   * @param {Jimp} image - Jimp image object
   * @returns {string|null} - QR code data or null if not found
   */
  static async extractQRFromJimp(image) {
    try {
      // Convert Jimp image to ImageData format for jsQR
      const { data, width, height } = image.bitmap;
      
      // Jimp always stores images as RGBA, so we can use the data directly
      const imageData = new Uint8ClampedArray(data);

      // Try to decode QR code
      const qrCode = jsQR(imageData, width, height, {
        inversionAttempts: 'dontInvert'  // We'll handle inversion manually
      });

      if (qrCode && qrCode.data) {
        return qrCode.data;
      }

      // Try with inversion attempts
      const qrCodeWithInversion = jsQR(imageData, width, height, {
        inversionAttempts: 'attemptBoth'
      });

      if (qrCodeWithInversion && qrCodeWithInversion.data) {
        return qrCodeWithInversion.data;
      }

      return null;
      
    } catch (error) {
      console.error('Error extracting QR from Jimp:', error);
      return null;
    }
  }

  /**
   * Validate image before processing
   * @param {Buffer} buffer - Image buffer
   * @returns {Object} - Validation result
   */
  static async validateImage(buffer) {
    try {
      const image = await Jimp.read(buffer);
      const width = image.getWidth();
      const height = image.getHeight();
      
      // Check minimum dimensions
      if (width < 50 || height < 50) {
        return {
          valid: false,
          error: 'Image too small. Minimum size is 50x50 pixels.',
          code: 'IMAGE_TOO_SMALL'
        };
      }

      // Check maximum dimensions
      if (width > 4000 || height > 4000) {
        return {
          valid: false,
          error: 'Image too large. Maximum size is 4000x4000 pixels.',
          code: 'IMAGE_TOO_LARGE'
        };
      }

      return {
        valid: true,
        width: width,
        height: height,
        hasAlpha: image.hasAlpha()
      };
      
    } catch (error) {
      return {
        valid: false,
        error: 'Invalid image format or corrupted image.',
        code: 'INVALID_IMAGE',
        details: error.message
      };
    }
  }

  /**
   * Get supported image formats
   * @returns {Array} - Array of supported MIME types
   */
  static getSupportedFormats() {
    return [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff'
    ];
  }

  /**
   * Get processing statistics
   * @returns {Object} - Processing stats
   */
  static getStats() {
    return {
      supportedFormats: this.getSupportedFormats(),
      maxFileSize: '10MB',
      maxDimensions: '4000x4000',
      minDimensions: '50x50',
      qrLibrary: 'jsQR',
      imageLibrary: 'Jimp',
      processingMethods: [
        'original',
        'grayscale',
        'high contrast',
        'inverted',
        'grayscale + contrast',
        'resized (for large images)'
      ]
    };
  }
}

module.exports = QRService;
