const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { body, query, validationResult } = require('express-validator');
const OTPEntry = require('../models/OTPEntry');
const QRService = process.env.NODE_ENV === 'production' 
  ? require('../services/qr-service-optimized')
  : require('../services/qr-service');
const OTPGenerator = require('../services/otp-generator');
const { parseOTPAuth, formatOTPResponse } = require('../lib/otp-parser');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Configure multer for QR code image uploads with optimizations
const storage = process.env.NODE_ENV === 'production' 
  ? multer.memoryStorage() // Use memory storage in production for faster processing
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/qr-codes', req.userId.toString());
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname).toLowerCase();
        cb(null, `qr-${uniqueSuffix}${fileExtension}`);
      }
    });

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
    }
  },
  limits: {
    fileSize: process.env.NODE_ENV === 'production' ? 4 * 1024 * 1024 : 10 * 1024 * 1024, // 4MB for Vercel, 10MB locally
    files: 1
  }
});

// All routes require authentication
router.use(authenticateToken);

// Upload QR code and save OTP entry
router.post('/upload', upload.single('qrImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided',
        code: 'NO_FILE'
      });
    }

    console.log(`Processing QR code upload for user ${req.userId}`);

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
    
    // Generate optimized QR code image thumbnail (only in development with disk storage)
    let thumbnailPath = null;
    if (req.file.path) {
      thumbnailPath = req.file.path.replace(/\.[^.]+$/, '_thumb.webp');
      try {
        await sharp(req.file.path)
          .resize(200, 200, { 
            fit: 'inside',
            withoutEnlargement: true 
          })
          .webp({ quality: 80 })
          .toFile(thumbnailPath);
      } catch (error) {
        console.warn('Could not create thumbnail:', error.message);
        thumbnailPath = null;
      }
    }

    // Check if user already has this OTP entry
    const existingEntry = await OTPEntry.findOne({
      userId: req.userId,
      $or: [
        { originalUrl: otpData.originalUrl },
        {
          serviceName: otpData.issuer || 'Unknown',
          accountName: otpData.account || 'Unknown'
        }
      ]
    });

    if (existingEntry) {
      // Clean up uploaded files
      try {
        fs.unlinkSync(req.file.path);
        if (fs.existsSync(thumbnailPath)) {
          fs.unlinkSync(thumbnailPath);
        }
      } catch (error) {
        console.warn('Could not delete uploaded file:', error.message);
      }

      return res.status(409).json({
        success: false,
        error: 'OTP entry already exists for this service and account',
        code: 'DUPLICATE_ENTRY',
        existingEntry: {
          id: existingEntry._id,
          serviceName: existingEntry.serviceName,
          accountName: existingEntry.accountName,
          createdAt: existingEntry.createdAt
        }
      });
    }

    // Create new OTP entry
    const otpEntry = new OTPEntry({
      userId: req.userId,
      serviceName: otpData.issuer || 'Unknown Service',
      accountName: otpData.account || 'Unknown Account',
      issuer: otpData.issuer,
      otpConfig: {
        secret: otpData.secret,
        type: otpData.type,
        algorithm: otpData.algorithm,
        digits: otpData.digits,
        period: otpData.period,
        counter: otpData.counter || 0
      },
      originalUrl: otpData.originalUrl,
      qrCodeImage: {
        filename: req.file.filename || `qr-${Date.now()}-${Math.round(Math.random() * 1E9)}`,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path || null, // Will be null for memory storage
        thumbnailPath: thumbnailPath && fs.existsSync(thumbnailPath) ? thumbnailPath : null
      }
    });

    await otpEntry.save();

    // Generate current OTP codes
    let currentCode = null;
    let multipleCodes = null;
    let codeError = null;

    try {
      currentCode = OTPGenerator.generateCurrentCode(otpData);
      multipleCodes = OTPGenerator.getMultipleCodes(otpData, 3);
      
      // Update usage statistics
      await otpEntry.updateUsage(currentCode ? currentCode.code : null);
    } catch (error) {
      console.warn('Could not generate OTP code:', error.message);
      codeError = error.message;
    }

    res.status(201).json({
      success: true,
      message: 'OTP entry created successfully',
      entry: {
        id: otpEntry._id,
        serviceName: otpEntry.serviceName,
        accountName: otpEntry.accountName,
        issuer: otpEntry.issuer,
        type: otpEntry.otpConfig.type,
        algorithm: otpEntry.otpConfig.algorithm,
        digits: otpEntry.otpConfig.digits,
        period: otpEntry.otpConfig.period,
        displayName: otpEntry.displayName,
        createdAt: otpEntry.createdAt
      },
      currentCode: currentCode,
      multipleCodes: multipleCodes,
      codeError: codeError,
      processingTime: qrResult.processingTime
    });

  } catch (error) {
    console.error('OTP upload error:', error);

    // Clean up uploaded file if it exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Could not delete uploaded file after error:', cleanupError.message);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Failed to process OTP upload',
      code: 'UPLOAD_ERROR'
    });
  }
});

// Get all OTP entries for user
router.get('/', [
  query('search').optional().isString().trim(),
  query('favorite').optional().isBoolean(),
  query('sortBy').optional().isIn(['name', 'created', 'lastUsed']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
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

    const { 
      search, 
      favorite, 
      sortBy = 'created', 
      page = 1, 
      limit = 20 
    } = req.query;

    // Build query
    const query = { 
      userId: req.userId,
      isActive: true 
    };

    if (favorite !== undefined) {
      query.favorite = favorite === 'true';
    }

    if (search) {
      query.$text = { $search: search };
    }

    // Build sort
    let sort = {};
    switch (sortBy) {
      case 'name':
        sort = { serviceName: 1, accountName: 1 };
        break;
      case 'lastUsed':
        sort = { 'usage.lastUsed': -1, createdAt: -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    // Add favorites to top
    if (!search) {
      sort = { favorite: -1, ...sort };
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const [entries, total] = await Promise.all([
      OTPEntry.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .select('-otpConfig.secret'), // Don't include secret in list
      OTPEntry.countDocuments(query)
    ]);

    res.json({
      success: true,
      entries: entries.map(entry => ({
        id: entry._id,
        serviceName: entry.serviceName,
        accountName: entry.accountName,
        issuer: entry.issuer,
        displayName: entry.displayName,
        type: entry.otpConfig.type,
        algorithm: entry.otpConfig.algorithm,
        digits: entry.otpConfig.digits,
        period: entry.otpConfig.period,
        favorite: entry.favorite,
        tags: entry.tags,
        notes: entry.notes,
        usage: entry.usage,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get OTP entries error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch OTP entries',
      code: 'FETCH_ERROR'
    });
  }
});

// Get specific OTP entry
router.get('/:entryId', async (req, res) => {
  try {
    const { entryId } = req.params;

    const entry = await OTPEntry.findOne({
      _id: entryId,
      userId: req.userId,
      isActive: true
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'OTP entry not found',
        code: 'ENTRY_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      entry: {
        id: entry._id,
        serviceName: entry.serviceName,
        accountName: entry.accountName,
        issuer: entry.issuer,
        displayName: entry.displayName,
        otpConfig: {
          type: entry.otpConfig.type,
          algorithm: entry.otpConfig.algorithm,
          digits: entry.otpConfig.digits,
          period: entry.otpConfig.period,
          counter: entry.otpConfig.counter
          // secret is excluded for security
        },
        favorite: entry.favorite,
        tags: entry.tags,
        notes: entry.notes,
        usage: entry.usage,
        qrCodeImage: entry.qrCodeImage ? {
          filename: entry.qrCodeImage.filename,
          originalName: entry.qrCodeImage.originalName,
          uploadDate: entry.qrCodeImage.uploadDate
        } : null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      }
    });

  } catch (error) {
    console.error('Get OTP entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch OTP entry',
      code: 'FETCH_ERROR'
    });
  }
});

// Generate current code for OTP entry
router.post('/:entryId/generate', async (req, res) => {
  try {
    const { entryId } = req.params;

    const entry = await OTPEntry.findOne({
      _id: entryId,
      userId: req.userId,
      isActive: true
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'OTP entry not found',
        code: 'ENTRY_NOT_FOUND'
      });
    }

    // Build OTP data for generation
    const otpData = {
      type: entry.otpConfig.type,
      secret: entry.otpConfig.secret,
      algorithm: entry.otpConfig.algorithm,
      digits: entry.otpConfig.digits,
      period: entry.otpConfig.period,
      counter: entry.otpConfig.counter
    };

    // Generate codes
    const currentCode = OTPGenerator.generateCurrentCode(otpData);
    const multipleCodes = OTPGenerator.getMultipleCodes(otpData, 5);

    // Update usage statistics
    await entry.updateUsage(currentCode.code);

    // For HOTP, increment counter
    if (entry.otpConfig.type === 'hotp' || entry.otpConfig.type === 'hhex') {
      await entry.incrementCounter();
    }

    res.json({
      success: true,
      currentCode: currentCode,
      multipleCodes: multipleCodes,
      entry: {
        id: entry._id,
        serviceName: entry.serviceName,
        accountName: entry.accountName,
        displayName: entry.displayName
      }
    });

  } catch (error) {
    console.error('Generate OTP code error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate OTP code',
      code: 'GENERATION_ERROR'
    });
  }
});

// Update OTP entry
router.put('/:entryId', [
  body('serviceName').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('accountName').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('favorite').optional().isBoolean(),
  body('tags').optional().isArray(),
  body('tags.*').isString().trim().isLength({ min: 1, max: 30 }),
  body('notes').optional().isString().trim().isLength({ max: 500 })
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

    const { entryId } = req.params;
    const { serviceName, accountName, favorite, tags, notes } = req.body;

    const entry = await OTPEntry.findOne({
      _id: entryId,
      userId: req.userId,
      isActive: true
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'OTP entry not found',
        code: 'ENTRY_NOT_FOUND'
      });
    }

    // Update fields
    if (serviceName !== undefined) entry.serviceName = serviceName;
    if (accountName !== undefined) entry.accountName = accountName;
    if (favorite !== undefined) entry.favorite = favorite;
    if (tags !== undefined) entry.tags = tags;
    if (notes !== undefined) entry.notes = notes;

    await entry.save();

    res.json({
      success: true,
      message: 'OTP entry updated successfully',
      entry: {
        id: entry._id,
        serviceName: entry.serviceName,
        accountName: entry.accountName,
        displayName: entry.displayName,
        favorite: entry.favorite,
        tags: entry.tags,
        notes: entry.notes,
        updatedAt: entry.updatedAt
      }
    });

  } catch (error) {
    console.error('Update OTP entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update OTP entry',
      code: 'UPDATE_ERROR'
    });
  }
});

// Delete OTP entry
router.delete('/:entryId', async (req, res) => {
  try {
    const { entryId } = req.params;

    const entry = await OTPEntry.findOne({
      _id: entryId,
      userId: req.userId,
      isActive: true
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'OTP entry not found',
        code: 'ENTRY_NOT_FOUND'
      });
    }

    // Soft delete
    entry.isActive = false;
    await entry.save();

    // Clean up QR code images
    if (entry.qrCodeImage && entry.qrCodeImage.path) {
      try {
        if (fs.existsSync(entry.qrCodeImage.path)) {
          fs.unlinkSync(entry.qrCodeImage.path);
        }
        if (entry.qrCodeImage.thumbnailPath && fs.existsSync(entry.qrCodeImage.thumbnailPath)) {
          fs.unlinkSync(entry.qrCodeImage.thumbnailPath);
        }
      } catch (error) {
        console.warn('Could not delete QR code image files:', error.message);
      }
    }

    res.json({
      success: true,
      message: 'OTP entry deleted successfully'
    });

  } catch (error) {
    console.error('Delete OTP entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete OTP entry',
      code: 'DELETE_ERROR'
    });
  }
});

// Get QR code image
router.get('/:entryId/image', async (req, res) => {
  try {
    const { entryId } = req.params;
    const { thumbnail } = req.query;

    const entry = await OTPEntry.findOne({
      _id: entryId,
      userId: req.userId,
      isActive: true
    });

    if (!entry || !entry.qrCodeImage) {
      return res.status(404).json({
        success: false,
        error: 'QR code image not found',
        code: 'IMAGE_NOT_FOUND'
      });
    }

    const imagePath = thumbnail === 'true' && entry.qrCodeImage.thumbnailPath 
      ? entry.qrCodeImage.thumbnailPath 
      : entry.qrCodeImage.path;

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        success: false,
        error: 'Image file not found',
        code: 'FILE_NOT_FOUND'
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', thumbnail === 'true' ? 'image/webp' : entry.qrCodeImage.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${entry.qrCodeImage.filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

    // Stream the image
    const imageStream = fs.createReadStream(imagePath);
    imageStream.pipe(res);

  } catch (error) {
    console.error('Get QR image error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve image',
      code: 'IMAGE_ERROR'
    });
  }
});

// Get user statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const userId = req.userId;

    const [
      totalEntries,
      favoriteEntries,
      recentEntries,
      mostUsedEntries
    ] = await Promise.all([
      OTPEntry.countDocuments({ userId, isActive: true }),
      OTPEntry.countDocuments({ userId, isActive: true, favorite: true }),
      OTPEntry.countDocuments({ 
        userId, 
        isActive: true, 
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
      }),
      OTPEntry.find({ userId, isActive: true })
        .sort({ 'usage.useCount': -1 })
        .limit(5)
        .select('serviceName accountName usage.useCount')
    ]);

    res.json({
      success: true,
      stats: {
        totalEntries,
        favoriteEntries,
        recentEntries,
        mostUsed: mostUsedEntries.map(entry => ({
          serviceName: entry.serviceName,
          accountName: entry.accountName,
          useCount: entry.usage.useCount
        }))
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      code: 'STATS_ERROR'
    });
  }
});

module.exports = router;
