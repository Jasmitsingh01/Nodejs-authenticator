const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Session = require('../models/Session');
const { 
  generateToken, 
  generateRefreshToken, 
  parseDeviceInfo, 
  authenticateToken 
} = require('../middleware/auth');

const router = express.Router();

// Rate limiting for auth endpoints (relaxed for development)
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.',
    code: 'AUTH_RATE_LIMIT'
  }
});

// Register new user
router.post('/register', [
  body('username')
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be 3-30 characters long')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('firstName')
    .optional()
    .isLength({ max: 50 })
    .withMessage('First name must be less than 50 characters'),
  body('lastName')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Last name must be less than 50 characters')
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

    const { username, email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { username: username },
        { email: email }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: existingUser.username === username 
          ? 'Username already exists' 
          : 'Email already registered',
        code: 'USER_EXISTS'
      });
    }

    // Create new user
    const user = new User({
      username,
      email,
      password,
      profile: {
        firstName: firstName || '',
        lastName: lastName || ''
      }
    });

    await user.save();

    // Create session
    const deviceInfo = parseDeviceInfo(req.get('User-Agent'), req.ip);
    const session = new Session({
      userId: user._id,
      sessionToken: generateToken(user._id),
      deviceInfo,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    await session.save();

    // Generate tokens
    const accessToken = generateToken(user._id, session._id);
    const refreshToken = generateRefreshToken(user._id, session._id);

    // Update user login info
    await user.updateLastLogin();

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        profile: user.profile,
        settings: user.settings,
        createdAt: user.createdAt
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '24h'
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      code: 'REGISTRATION_ERROR'
    });
  }
});

// Login user
router.post('/login', authLimiter, [
  body('login')
    .notEmpty()
    .withMessage('Username or email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
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

    const { login, password, rememberMe } = req.body;

    // Find user by username or email
    const user = await User.findOne({
      $or: [
        { username: login },
        { email: login }
      ],
      isActive: true
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Create session
    const deviceInfo = parseDeviceInfo(req.get('User-Agent'), req.ip);
    const expiryHours = rememberMe ? 24 * 7 : 24; // 7 days if remember me, otherwise 24 hours
    
    const session = new Session({
      userId: user._id,
      sessionToken: generateToken(user._id),
      deviceInfo,
      expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000)
    });

    await session.save();

    // Generate tokens
    const tokenExpiry = rememberMe ? '7d' : '24h';
    const accessToken = generateToken(user._id, session._id, tokenExpiry);
    const refreshToken = generateRefreshToken(user._id, session._id);

    // Update user login info
    await user.updateLastLogin();

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        profile: user.profile,
        settings: user.settings,
        lastLogin: user.lastLogin,
        loginCount: user.loginCount
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: tokenExpiry
      },
      session: {
        id: session._id,
        expiresAt: session.expiresAt,
        deviceInfo: session.deviceInfo
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      code: 'LOGIN_ERROR'
    });
  }
});

// Refresh token
router.post('/refresh', [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
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

    const { refreshToken } = req.body;

    // Verify refresh token
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    // Find user and session
    const user = await User.findById(decoded.userId);
    const session = await Session.findById(decoded.sessionId);

    if (!user || !user.isActive || !session || !session.isActive || session.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Extend session
    await session.extend();

    // Generate new access token
    const accessToken = generateToken(user._id, session._id);

    res.json({
      success: true,
      tokens: {
        accessToken,
        expiresIn: '24h'
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Token refresh failed',
      code: 'REFRESH_ERROR'
    });
  }
});

// Logout user
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Deactivate current session
    if (req.session) {
      await req.session.deactivate();
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
      code: 'LOGOUT_ERROR'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        displayName: req.user.displayName,
        profile: req.user.profile,
        settings: req.user.settings,
        lastLogin: req.user.lastLogin,
        loginCount: req.user.loginCount,
        createdAt: req.user.createdAt
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile',
      code: 'PROFILE_ERROR'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, [
  body('firstName')
    .optional()
    .isLength({ max: 50 })
    .withMessage('First name must be less than 50 characters'),
  body('lastName')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Last name must be less than 50 characters'),
  body('settings.theme')
    .optional()
    .isIn(['light', 'dark', 'auto'])
    .withMessage('Theme must be light, dark, or auto'),
  body('settings.autoRefresh')
    .optional()
    .isBoolean()
    .withMessage('Auto refresh must be a boolean'),
  body('settings.showSeconds')
    .optional()
    .isBoolean()
    .withMessage('Show seconds must be a boolean')
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

    const { firstName, lastName, settings } = req.body;
    const user = req.user;

    // Update profile
    if (firstName !== undefined) user.profile.firstName = firstName;
    if (lastName !== undefined) user.profile.lastName = lastName;

    // Update settings
    if (settings) {
      if (settings.theme !== undefined) user.settings.theme = settings.theme;
      if (settings.autoRefresh !== undefined) user.settings.autoRefresh = settings.autoRefresh;
      if (settings.showSeconds !== undefined) user.settings.showSeconds = settings.showSeconds;
      if (settings.sortBy !== undefined) user.settings.sortBy = settings.sortBy;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        profile: user.profile,
        settings: user.settings
      }
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      code: 'UPDATE_ERROR'
    });
  }
});

// Get user sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await Session.find({
      userId: req.userId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).sort({ lastActivity: -1 });

    res.json({
      success: true,
      sessions: sessions.map(session => ({
        id: session._id,
        deviceInfo: session.deviceInfo,
        location: session.location,
        lastActivity: session.lastActivity,
        expiresAt: session.expiresAt,
        isCurrent: req.session && session._id.equals(req.session._id)
      }))
    });

  } catch (error) {
    console.error('Sessions fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions',
      code: 'SESSIONS_ERROR'
    });
  }
});

// Revoke session
router.delete('/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await Session.findOne({
      _id: sessionId,
      userId: req.userId
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }

    await session.deactivate();

    res.json({
      success: true,
      message: 'Session revoked successfully'
    });

  } catch (error) {
    console.error('Session revoke error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke session',
      code: 'REVOKE_ERROR'
    });
  }
});

module.exports = router;
