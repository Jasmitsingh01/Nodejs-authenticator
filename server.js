require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { body, validationResult } = require('express-validator');

// Database and models
const database = require('./config/database');
const User = require('./models/User');

// Services
const QRService = process.env.NODE_ENV === 'production' 
  ? require('./services/qr-service-optimized')
  : require('./services/qr-service');
const OTPGenerator = require('./services/otp-generator');
const { formatOTPResponse } = require('./lib/otp-parser');

// Routes
const authRoutes = require('./routes/auth');
const otpRoutes = require('./routes/otp');

// Middleware
const { optionalAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy disabled temporarily to fix rate limiting error
// app.set('trust proxy', true);

// Initialize database connection
async function initializeDatabase() {
  try {
    await database.connect();
    console.log('🔌 Database connected successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.log('⚠️  Server will start without database features');
    console.log('💡 To use database features:');
    console.log('   1. Install MongoDB: https://www.mongodb.com/try/download/community');
    console.log('   2. Start MongoDB service');
    console.log('   3. Or use MongoDB Atlas: https://www.mongodb.com/atlas');
    console.log('   4. Set MONGODB_URI environment variable in Vercel');
    // Don't throw error, continue without database
  }
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));

// Rate limiting removed for development/testing
app.use(compression());
app.use(morgan('combined'));
app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins when credentials are needed
    callback(null, origin || '*');
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// No session middleware needed - using JWT tokens only
console.log('📝 Using JWT token-based authentication');

// Adjust body parser limits for Vercel deployment
const bodyLimit = process.env.NODE_ENV === 'production' ? '4mb' : '10mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// Create uploads directory if it doesn't exist (skip in serverless environments)
const uploadsDir = path.join(__dirname, 'uploads');
if (process.env.NODE_ENV !== 'production' && !fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (error) {
    console.warn('Could not create uploads directory:', error.message);
  }
}

// Configure multer for file uploads with memory storage for faster processing
const storage = process.env.NODE_ENV === 'production' 
  ? multer.memoryStorage() // Use memory storage in production for faster processing
  : multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadsDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname).toLowerCase();
        cb(null, `qr-${uniqueSuffix}${fileExtension}`);
      }
    });

const fileFilter = (req, file, cb) => {
  // Accept image files only
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: process.env.NODE_ENV === 'production' ? 10 * 1024 * 1024 : 10 * 1024 * 1024, // 4MB for Vercel, 10MB locally
    files: 1 // Only one file at a time
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);

// Legacy QR endpoints (for backward compatibility, no auth required)
app.post('/api/qr/upload', upload.single('qrImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided',
        code: 'NO_FILE'
      });
    }

    console.log(`Processing QR code upload (legacy endpoint)`);

    // Process the QR code - use buffer processing if available, otherwise file path
    const qrResult = req.file.buffer
      ? await QRService.processQRBuffer(req.file.buffer, req.file.mimetype)
      : await QRService.processQRImage(req.file.path);

    if (!qrResult.success) {
      // Clean up uploaded file (only needed for disk storage)
      if (req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (error) {
          console.warn('Could not delete uploaded file:', error.message);
        }
      }

      return res.status(400).json({
        success: false,
        error: qrResult.error,
        code: qrResult.code || 'PROCESSING_ERROR'
      });
    }

    // Parse OTP data
    const otpData = qrResult.data;
    
    // Generate current OTP codes
    let currentCode = null;
    let multipleCodes = null;
    let codeError = null;

    try {
      currentCode = OTPGenerator.generateCurrentCode(otpData);
      multipleCodes = OTPGenerator.getMultipleCodes(otpData, 5);
    } catch (error) {
      console.warn('Could not generate OTP code:', error.message);
      codeError = error.message;
    }

    // Clean up uploaded file (don't save for legacy endpoint, only needed for disk storage)
    if (req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (error) {
        console.warn('Could not delete uploaded file:', error.message);
      }
    }

    res.json({
      success: true,
      data: formatOTPResponse(otpData),
      currentCode: currentCode,
      multipleCodes: multipleCodes,
      codeError: codeError,
      processingTime: qrResult.processingTime
    });

  } catch (error) {
    console.error('QR upload error (legacy):', error);

    // Clean up uploaded file if it exists (only needed for disk storage)
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Could not delete uploaded file after error:', cleanupError.message);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Failed to process QR code',
      code: 'UPLOAD_ERROR'
    });
  }
});

app.post('/api/qr/base64', [
  body('image').notEmpty().withMessage('Base64 image data is required'),
  body('filename').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { image, filename } = req.body;

    console.log('Processing base64 QR code (legacy endpoint)');

    // Process the base64 image
    const qrResult = await QRService.processBase64Image(image, filename);

    if (!qrResult.success) {
      return res.status(400).json({
        success: false,
        error: qrResult.error,
        code: qrResult.code || 'PROCESSING_ERROR'
      });
    }

    // Parse OTP data
    const otpData = qrResult.data;
    
    // Generate current OTP codes
    let currentCode = null;
    let multipleCodes = null;
    let codeError = null;

    try {
      currentCode = OTPGenerator.generateCurrentCode(otpData);
      multipleCodes = OTPGenerator.getMultipleCodes(otpData, 5);
    } catch (error) {
      console.warn('Could not generate OTP code:', error.message);
      codeError = error.message;
    }

    res.json({
      success: true,
      data: formatOTPResponse(otpData),
      currentCode: currentCode,
      multipleCodes: multipleCodes,
      codeError: codeError,
      processingTime: qrResult.processingTime
    });

  } catch (error) {
    console.error('Base64 QR processing error (legacy):', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process QR code',
      code: 'PROCESSING_ERROR'
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: require('./package.json').version,
    uptime: process.uptime(),
    database: await database.healthCheck()
  };

  const statusCode = health.database.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API information endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'OTP QR Code API',
    version: require('./package.json').version,
    description: 'Extract OTP (One-Time Password) information from QR code images',
    endpoints: {
      'POST /api/qr/upload': 'Upload QR code image file',
      'POST /api/qr/base64': 'Submit base64 encoded QR code image',
      'GET /api/qr/test': 'Test endpoint with sample QR data',
      'GET /health': 'Health check endpoint',
      'GET /': 'Web interface for QR upload'
    },
    documentation: '/api/docs'
  });
});

// Upload QR code image file
app.post('/api/qr/upload', upload.single('qrImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided',
        code: 'NO_FILE'
      });
    }

    console.log(`Processing uploaded file: ${req.file.filename || 'buffer'}`);
    
    // Process the QR code - use buffer processing if available, otherwise file path
    const result = req.file.buffer
      ? await QRService.processQRBuffer(req.file.buffer, req.file.mimetype)
      : await QRService.processQRImage(req.file.path);
    
    // Clean up uploaded file (only needed for disk storage)
    if (req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Could not delete uploaded file:', cleanupError.message);
      }
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        code: result.code || 'PROCESSING_ERROR'
      });
    }

    // Format the response
    const formattedResponse = formatOTPResponse(result.data);
    
    // Generate current OTP code
    let currentCode = null;
    let multipleCodes = null;
    let codeError = null;
    
    try {
      currentCode = OTPGenerator.generateCurrentCode(result.data);
      multipleCodes = OTPGenerator.getMultipleCodes(result.data, 3);
    } catch (error) {
      console.warn('Could not generate OTP code:', error.message);
      codeError = error.message;
    }
    
    res.json({
              success: true,
      data: formattedResponse,
      currentCode: currentCode,
      multipleCodes: multipleCodes,
      codeError: codeError,
      processingTime: result.processingTime,
      imageInfo: {
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype
      }
    });

  } catch (error) {
    console.error('Error processing QR upload:', error);
    
    // Clean up file if it exists (only needed for disk storage)
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Could not delete uploaded file after error:', cleanupError.message);
      }
    }
    
    res.status(500).json({
              success: false,
      error: 'Internal server error while processing QR code',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Submit base64 encoded QR code image
app.post('/api/qr/base64', [
  body('image').notEmpty().withMessage('Base64 image data is required'),
  body('image').matches(/^data:image\/(jpeg|jpg|png|gif|webp);base64,/).withMessage('Invalid base64 image format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
            success: false,
        error: 'Validation failed',
        details: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { image } = req.body;
    
    console.log('Processing base64 image');
    
    // Process the base64 QR code
    const result = await QRService.processBase64QR(image);
    
    if (!result.success) {
      return res.status(400).json({
          success: false,
        error: result.error,
        code: result.code || 'PROCESSING_ERROR'
      });
    }

    // Format the response
    const formattedResponse = formatOTPResponse(result.data);
    
    // Generate current OTP code
    let currentCode = null;
    let multipleCodes = null;
    let codeError = null;
    
    try {
      currentCode = OTPGenerator.generateCurrentCode(result.data);
      multipleCodes = OTPGenerator.getMultipleCodes(result.data, 3);
    } catch (error) {
      console.warn('Could not generate OTP code:', error.message);
      codeError = error.message;
    }
    
    res.json({
      success: true,
      data: formattedResponse,
      currentCode: currentCode,
      multipleCodes: multipleCodes,
      codeError: codeError,
      processingTime: result.processingTime
    });

  } catch (error) {
    console.error('Error processing base64 QR:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while processing QR code',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Generate OTP codes from OTP URL
app.post('/api/otp/generate', [
  body('otpUrl').notEmpty().withMessage('OTP URL is required'),
  body('otpUrl').matches(/^otpauth:\/\//).withMessage('Invalid OTP URL format')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { otpUrl } = req.body;
    const { parseOTPAuth } = require('./lib/otp-parser');
    
    // Parse the OTP URL
    const parsedData = parseOTPAuth(otpUrl);
    if (!parsedData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP URL',
        code: 'INVALID_OTP_URL'
      });
    }

    // Generate codes
    let currentCode = null;
    let multipleCodes = null;
    let codeError = null;
    
    try {
      currentCode = OTPGenerator.generateCurrentCode(parsedData);
      multipleCodes = OTPGenerator.getMultipleCodes(parsedData, 5);
    } catch (error) {
      codeError = error.message;
    }

        res.json({
          success: true,
      data: formatOTPResponse(parsedData),
      currentCode: currentCode,
      multipleCodes: multipleCodes,
      codeError: codeError
    });

  } catch (error) {
    console.error('Error generating OTP codes:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while generating codes',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Verify OTP code
app.post('/api/otp/verify', [
  body('otpUrl').notEmpty().withMessage('OTP URL is required'),
  body('code').notEmpty().withMessage('Code to verify is required')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
          success: false,
        error: 'Validation failed',
        details: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { otpUrl, code } = req.body;
    const { parseOTPAuth } = require('./lib/otp-parser');
    
    // Parse the OTP URL
    const parsedData = parseOTPAuth(otpUrl);
    if (!parsedData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP URL',
        code: 'INVALID_OTP_URL'
      });
    }

    // Verify the code
    const verification = OTPGenerator.verifyCode(parsedData, code);
    
    res.json({
      success: true,
      verification: verification,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying OTP code:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while verifying code',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Test endpoint with sample data
app.get('/api/qr/test', (req, res) => {
  const sampleOTPUrl = 'otpauth://totp/Example:user@example.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=Example&algorithm=SHA1&digits=6&period=30';
  
  try {
    const { parseOTPAuth } = require('./lib/otp-parser');
    const parsedData = parseOTPAuth(sampleOTPUrl);
    const formattedResponse = formatOTPResponse(parsedData);
    
    res.json({
      success: true,
      data: formattedResponse,
      note: 'This is sample test data for demonstration purposes',
      sampleUrl: sampleOTPUrl
    });
  } catch (error) {
    console.error('Error generating test data:', error);
    res.status(500).json({
      success: false,
      error: 'Error generating test data',
      code: 'TEST_ERROR'
    });
  }
});

// API documentation
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'OTP QR Code API Documentation',
    version: '1.0.0',
    description: 'API for extracting OTP information from QR code images',
    
    endpoints: [
      {
        method: 'POST',
        path: '/api/qr/upload',
        description: 'Upload a QR code image file',
        contentType: 'multipart/form-data',
        parameters: {
          qrImage: {
            type: 'file',
            required: true,
            description: 'QR code image file (JPEG, PNG, GIF, WebP)',
            maxSize: '10MB'
          }
        },
        responses: {
          200: 'QR code successfully processed',
          400: 'Invalid file or QR code processing error',
          429: 'Rate limit exceeded',
          500: 'Internal server error'
        }
      },
      {
        method: 'POST',
        path: '/api/qr/base64',
        description: 'Submit base64 encoded QR code image',
        contentType: 'application/json',
        parameters: {
          image: {
            type: 'string',
            required: true,
            description: 'Base64 encoded image data with data URL format',
            example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...'
          }
        },
        responses: {
          200: 'QR code successfully processed',
          400: 'Invalid base64 data or QR code processing error',
          429: 'Rate limit exceeded',
          500: 'Internal server error'
        }
      }
    ],
    
    responseFormat: {
      success: true,
      data: {
        type: 'totp',
        label: 'Example:user@example.com',
        issuer: 'Example',
        account: 'user@example.com',
        secret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        counter: 0,
        hash: 'uuid-v4',
        originalUrl: 'otpauth://...',
        valid: true,
        validation: {
          valid: true,
          errors: [],
          warnings: []
        },
        generatedAt: '2024-01-01T00:00:00.000Z',
        typeDescription: 'Time-based (TOTP) - codes change every 30 seconds',
        algorithmDescription: 'SHA-1 (most common)'
      },
      processingTime: 150
    },
    
    errorCodes: {
      'NO_FILE': 'No image file provided in upload',
      'INVALID_IMAGE': 'Image could not be processed',
      'NO_QR_FOUND': 'No QR code detected in image',
      'INVALID_QR_DATA': 'QR code does not contain valid OTP data',
      'VALIDATION_ERROR': 'Request validation failed',
      'RATE_LIMIT_EXCEEDED': 'Too many requests',
      'PROCESSING_ERROR': 'Error processing QR code',
      'INTERNAL_ERROR': 'Internal server error'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB.',
        code: 'FILE_TOO_LARGE'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Only one file allowed.',
        code: 'TOO_MANY_FILES'
      });
    }
    return res.status(400).json({
        success: false,
      error: error.message,
      code: 'UPLOAD_ERROR'
    });
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: error.message,
      code: 'INVALID_FILE_TYPE'
    });
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    availableEndpoints: [
      'GET /',
      'GET /api',
      'GET /api/docs',
      'POST /api/qr/upload',
      'POST /api/qr/base64',
      'GET /api/qr/test',
      'GET /health'
    ]
  });
});

// Start the server with database initialization
async function startServer() {
  try {
    // Initialize database first
    await initializeDatabase();
    
    // Only start listening if not in serverless environment
    if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
      app.listen(PORT, () => {
        console.log('🎉 OTP Authenticator Server Started Successfully!');
        console.log('='.repeat(50));
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/health`);
        console.log(`📖 API docs: http://localhost:${PORT}/api`);
        console.log('');
        console.log('🔐 Authentication Endpoints:');
        console.log(`   Register: POST http://localhost:${PORT}/api/auth/register`);
        console.log(`   Login: POST http://localhost:${PORT}/api/auth/login`);
        console.log(`   Profile: GET http://localhost:${PORT}/api/auth/profile`);
        console.log('');
        console.log('📱 OTP Endpoints:');
        console.log(`   Upload QR: POST http://localhost:${PORT}/api/otp/upload`);
        console.log(`   List OTPs: GET http://localhost:${PORT}/api/otp`);
        console.log(`   Generate Code: POST http://localhost:${PORT}/api/otp/:id/generate`);
        console.log('');
        console.log('🌐 Web Interface: http://localhost:${PORT}');
        console.log('='.repeat(50));
        console.log('Press Ctrl+C to stop the server');
      });
    } else {
      console.log('🚀 OTP Authenticator Server Ready for Vercel!');
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
}

// Handle graceful shutdown (only in non-serverless environments)
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  process.on('SIGINT', async () => {
    console.log('\n📄 Shutting down server gracefully...');
    await database.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n📄 Shutting down server gracefully...');
    await database.disconnect();
    process.exit(0);
  });
}

startServer();

module.exports = app;