const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');

// JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required',
        code: 'NO_TOKEN'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }

    // Check session if sessionId is in token
    if (decoded.sessionId) {
      const session = await Session.findById(decoded.sessionId);
      if (!session || !session.isActive || session.expiresAt < new Date()) {
        return res.status(401).json({
          success: false,
          error: 'Session expired',
          code: 'SESSION_EXPIRED'
        });
      }
      
      // Update last activity
      session.lastActivity = new Date();
      await session.save();
      req.sessionRecord = session;
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
};

// Optional authentication (for public endpoints that can work with or without auth)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (user && user.isActive) {
        req.user = user;
        req.userId = user._id;
      }
    }
    
    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    next();
  }
};

// No session-based authentication needed - JWT only

// Generate JWT token
const generateToken = (userId, sessionId = null, expiresIn = '24h') => {
  const payload = { userId };
  if (sessionId) {
    payload.sessionId = sessionId;
  }
  
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

// Generate refresh token (longer expiry)
const generateRefreshToken = (userId, sessionId = null) => {
  return generateToken(userId, sessionId, '7d');
};

// Parse device info from user agent
const parseDeviceInfo = (userAgent, ip) => {
  // Simple user agent parsing (in production, consider using a library like 'ua-parser-js')
  const deviceInfo = {
    userAgent: userAgent || 'Unknown',
    ip: ip || 'Unknown',
    browser: 'Unknown',
    os: 'Unknown',
    device: 'Unknown'
  };

  if (userAgent) {
    // Basic browser detection
    if (userAgent.includes('Chrome')) deviceInfo.browser = 'Chrome';
    else if (userAgent.includes('Firefox')) deviceInfo.browser = 'Firefox';
    else if (userAgent.includes('Safari')) deviceInfo.browser = 'Safari';
    else if (userAgent.includes('Edge')) deviceInfo.browser = 'Edge';

    // Basic OS detection
    if (userAgent.includes('Windows')) deviceInfo.os = 'Windows';
    else if (userAgent.includes('Mac')) deviceInfo.os = 'macOS';
    else if (userAgent.includes('Linux')) deviceInfo.os = 'Linux';
    else if (userAgent.includes('Android')) deviceInfo.os = 'Android';
    else if (userAgent.includes('iOS')) deviceInfo.os = 'iOS';

    // Basic device detection
    if (userAgent.includes('Mobile')) deviceInfo.device = 'Mobile';
    else if (userAgent.includes('Tablet')) deviceInfo.device = 'Tablet';
    else deviceInfo.device = 'Desktop';
  }

  return deviceInfo;
};

module.exports = {
  authenticateToken,
  optionalAuth,
  generateToken,
  generateRefreshToken,
  parseDeviceInfo
};
