const Jimp = require('jimp');
const jsQR = require('jsqr');
const fs = require('fs').promises;

class QRServiceOptimized {
  /**
   * Process QR code from memory buffer (optimized for Vercel)
   * @param {Buffer} buffer - Image buffer
   * @param {string} mimeType - Image MIME type
   * @returns {Object} - Processing result
   */
  static async processQRBuffer(buffer, mimeType) {
    const startTime = Date.now();
    
    try {
      console.log(`Processing QR from buffer, size: ${buffer.length} bytes`);
      
      // Read image from buffer
      const image = await Jimp.read(buffer);
      
      // Apply quick optimizations for faster processing
      const optimizedImage = await this.optimizeForQRDetection(image);
      
      // Process with optimized approach
      const result = await this.fastQRScan(optimizedImage);
      
      return {
        ...result,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      console.error('Error processing QR buffer:', error);
      return {
        success: false,
        error: 'Failed to process image buffer',
        code: 'BUFFER_PROCESSING_ERROR',
        details: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Process QR code from image file path (fallback for local development)
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
      const optimizedImage = await this.optimizeForQRDetection(image);
      const result = await this.fastQRScan(optimizedImage);
      
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
   * Optimize image for faster QR detection
   * @param {Jimp} image - Original image
   * @returns {Jimp} - Optimized image
   */
  static async optimizeForQRDetection(image) {
    const width = image.getWidth();
    const height = image.getHeight();
    
    // Resize large images for faster processing
    let optimized = image.clone();
    
    if (width > 800 || height > 800) {
      const maxDimension = 800;
      const scale = Math.min(maxDimension / width, maxDimension / height);
      optimized = optimized.scale(scale);
      console.log(`Resized image from ${width}x${height} to ${optimized.getWidth()}x${optimized.getHeight()}`);
    }
    
    // Convert to grayscale for faster processing
    optimized = optimized.greyscale();
    
    // Apply slight contrast enhancement
    optimized = optimized.contrast(0.2);
    
    return optimized;
  }

  /**
   * Fast QR scanning with minimal attempts
   * @param {Jimp} image - Preprocessed image
   * @returns {Object} - Scan result
   */
  static async fastQRScan(image) {
    try {
      const width = image.getWidth();
      const height = image.getHeight();
      
      // Convert to image data format for jsQR
      const imageData = {
        data: new Uint8ClampedArray(image.bitmap.data),
        width: width,
        height: height
      };

      // Try original optimized image first
      let qrResult = jsQR(imageData.data, width, height);
      
      if (qrResult) {
        console.log('QR code detected on first attempt');
        return this.processQRResult(qrResult, 'optimized');
      }

      // If that fails, try with inverted colors (quick attempt)
      const inverted = image.clone().invert();
      const invertedData = {
        data: new Uint8ClampedArray(inverted.bitmap.data),
        width: width,
        height: height
      };
      
      qrResult = jsQR(invertedData.data, width, height);
      
      if (qrResult) {
        console.log('QR code detected with inversion');
        return this.processQRResult(qrResult, 'inverted');
      }

      // If still no luck, try with higher contrast
      const highContrast = image.clone().contrast(0.5);
      const contrastData = {
        data: new Uint8ClampedArray(highContrast.bitmap.data),
        width: width,
        height: height
      };
      
      qrResult = jsQR(contrastData.data, width, height);
      
      if (qrResult) {
        console.log('QR code detected with high contrast');
        return this.processQRResult(qrResult, 'high-contrast');
      }

      return {
        success: false,
        error: 'No QR code found in image',
        code: 'NO_QR_FOUND'
      };

    } catch (error) {
      console.error('Error during QR scanning:', error);
      return {
        success: false,
        error: 'Failed to scan QR code',
        code: 'SCAN_ERROR',
        details: error.message
      };
    }
  }

  /**
   * Process QR scan result
   * @param {Object} qrResult - jsQR result
   * @param {string} method - Detection method used
   * @returns {Object} - Processed result
   */
  static processQRResult(qrResult, method) {
    try {
      const qrText = qrResult.data;
      console.log(`QR code detected (${method}):`, qrText.substring(0, 100) + '...');

      // Parse OTP data
      const { parseOTPAuth } = require('../lib/otp-parser');
      const otpData = parseOTPAuth(qrText);

      if (!otpData) {
        return {
          success: false,
          error: 'QR code does not contain valid OTP data',
          code: 'INVALID_OTP_DATA',
          rawData: qrText
        };
      }

      return {
        success: true,
        data: otpData,
        rawData: qrText,
        detectionMethod: method,
        qrLocation: {
          topLeft: qrResult.location.topLeftCorner,
          topRight: qrResult.location.topRightCorner,
          bottomLeft: qrResult.location.bottomLeftCorner,
          bottomRight: qrResult.location.bottomRightCorner
        }
      };

    } catch (error) {
      console.error('Error processing QR result:', error);
      return {
        success: false,
        error: 'Failed to process QR data',
        code: 'QR_PROCESSING_ERROR',
        details: error.message
      };
    }
  }

  /**
   * Legacy method name for compatibility with older routes
   * @param {string} base64Data - Base64 encoded image with data URL prefix
   * @returns {Object} - Processing result
   */
  static async processBase64Image(base64Data) {
    return await this.processBase64QR(base64Data);
  }

  /**
   * Process QR code from base64 image data (optimized)
   * @param {string} base64Data - Base64 encoded image with data URL prefix
   * @returns {Object} - Processing result
   */
  static async processBase64QR(base64Data) {
    const startTime = Date.now();
    
    try {
      console.log('Processing base64 QR image');
      
      // Extract base64 data without data URL prefix
      const base64Match = base64Data.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
      if (!base64Match) {
        return {
          success: false,
          error: 'Invalid base64 image format',
          code: 'INVALID_BASE64_FORMAT',
          processingTime: Date.now() - startTime
        };
      }

      const base64String = base64Match[1];
      const buffer = Buffer.from(base64String, 'base64');
      
      // Process using buffer method for consistency
      const result = await this.processQRBuffer(buffer, 'image/jpeg');
      
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
   * Get processing statistics
   * @returns {Object} - Processing stats
   */
  static getStats() {
    return {
      supportedFormats: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
      maxFileSize: process.env.NODE_ENV === 'production' ? '4MB' : '10MB',
      maxDimensions: '800x800 (auto-resized)',
      minDimensions: '50x50',
      qrLibrary: 'jsQR',
      imageLibrary: 'Jimp',
      optimizations: [
        'Memory buffer processing',
        'Automatic image resizing',
        'Grayscale conversion',
        'Minimal processing attempts',
        'Early detection termination'
      ]
    };
  }
}

module.exports = QRServiceOptimized;
