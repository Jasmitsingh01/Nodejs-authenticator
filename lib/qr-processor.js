const jsQR = require('jsqr');
const QRCode = require('qrcode-reader');
const { createCanvas, loadImage } = require('canvas');

/**
 * Process QR code from image buffer
 * @param {Buffer} imageBuffer - The image buffer
 * @param {string} mimeType - The MIME type of the image
 * @returns {Promise<string|null>} - The QR code data or null if not found
 */
async function processQRImage(imageBuffer, mimeType) {
  try {
    // First try with jsQR (fast method)
    const jsQRResult = await processWithJsQR(imageBuffer);
    if (jsQRResult) {
      console.log('QR code found with jsQR');
      return jsQRResult;
    }

    // Fallback to qrcode-reader (more robust)
    const qrReaderResult = await processWithQRReader(imageBuffer);
    if (qrReaderResult) {
      console.log('QR code found with qrcode-reader');
      return qrReaderResult;
    }

    console.log('No QR code found in image');
    return null;

  } catch (error) {
    console.error('Error processing QR image:', error);
    throw new Error(`Failed to process QR image: ${error.message}`);
  }
}

/**
 * Process QR code using jsQR library (Canvas-based)
 * @param {Buffer} imageBuffer - The image buffer
 * @returns {Promise<string|null>} - The QR code data or null
 */
async function processWithJsQR(imageBuffer) {
  try {
    // Load image using Canvas
    const image = await loadImage(imageBuffer);
    
    // Create canvas and draw image
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Process with jsQR
    const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });
    
    if (qrCode && qrCode.data) {
      // Validate if it's an OTP URL
      if (isValidOTPUrl(qrCode.data)) {
        return qrCode.data;
      }
    }
    
    // Try with inversion
    const qrCodeInverted = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "onlyInvert",
    });
    
    if (qrCodeInverted && qrCodeInverted.data && isValidOTPUrl(qrCodeInverted.data)) {
      return qrCodeInverted.data;
    }
    
    // Try with both
    const qrCodeBoth = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
    
    if (qrCodeBoth && qrCodeBoth.data && isValidOTPUrl(qrCodeBoth.data)) {
      return qrCodeBoth.data;
    }
    
    return null;
    
  } catch (error) {
    console.error('jsQR processing error:', error);
    return null;
  }
}

/**
 * Process QR code using qrcode-reader library
 * @param {Buffer} imageBuffer - The image buffer
 * @returns {Promise<string|null>} - The QR code data or null
 */
function processWithQRReader(imageBuffer) {
  return new Promise((resolve) => {
    try {
      // Convert buffer to data URL
      const base64 = imageBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      
      const qr = new QRCode();
      qr.callback = (error, result) => {
        if (error) {
          console.error('qrcode-reader error:', error);
          resolve(null);
          return;
        }
        
        if (result && result.result && isValidOTPUrl(result.result)) {
          resolve(result.result);
        } else {
          resolve(null);
        }
      };
      
      qr.decode(dataUrl);
      
    } catch (error) {
      console.error('qrcode-reader processing error:', error);
      resolve(null);
    }
  });
}

/**
 * Check if the QR code data is a valid OTP URL
 * @param {string} data - The QR code data
 * @returns {boolean} - True if valid OTP URL
 */
function isValidOTPUrl(data) {
  if (!data || typeof data !== 'string') {
    return false;
  }
  
  // Check for otpauth:// or otpauth-migration:// URLs
  return data.startsWith('otpauth://') || data.startsWith('otpauth-migration://');
}

/**
 * Enhanced image processing with multiple attempts
 * @param {Buffer} imageBuffer - The image buffer
 * @returns {Promise<string|null>} - The QR code data or null
 */
async function processQRImageEnhanced(imageBuffer) {
  try {
    const image = await loadImage(imageBuffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    
    // Try different processing approaches
    const approaches = [
      // Original image
      () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      },
      
      // Enhanced contrast
      () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.filter = 'contrast(200%) brightness(150%)';
        ctx.drawImage(image, 0, 0);
        ctx.filter = 'none';
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      },
      
      // Grayscale
      () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.filter = 'grayscale(100%) contrast(200%)';
        ctx.drawImage(image, 0, 0);
        ctx.filter = 'none';
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      },
      
      // High contrast
      () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.filter = 'contrast(300%) brightness(100%)';
        ctx.drawImage(image, 0, 0);
        ctx.filter = 'none';
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    ];
    
    for (let i = 0; i < approaches.length; i++) {
      try {
        const imageData = approaches[i]();
        
        // Try all inversion modes
        const inversionModes = ['dontInvert', 'onlyInvert', 'attemptBoth'];
        
        for (const mode of inversionModes) {
          const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: mode,
          });
          
          if (qrCode && qrCode.data && isValidOTPUrl(qrCode.data)) {
            console.log(`QR code found with approach ${i + 1}, mode: ${mode}`);
            return qrCode.data;
          }
        }
      } catch (approachError) {
        console.error(`Approach ${i + 1} failed:`, approachError);
        continue;
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('Enhanced processing error:', error);
    return null;
  }
}

module.exports = {
  processQRImage,
  processQRImageEnhanced,
  isValidOTPUrl,
};
