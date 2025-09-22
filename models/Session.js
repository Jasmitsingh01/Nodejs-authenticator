const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sessionToken: {
    type: String,
    required: true,
    unique: true
  },
  deviceInfo: {
    userAgent: String,
    ip: String,
    browser: String,
    os: String,
    device: String
  },
  location: {
    country: String,
    region: String,
    city: String,
    timezone: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  }
}, {
  timestamps: true
});

// Method to extend session
sessionSchema.methods.extend = function(hours = 24) {
  this.expiresAt = new Date(Date.now() + (hours * 60 * 60 * 1000));
  this.lastActivity = new Date();
  return this.save();
};

// Method to deactivate session
sessionSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};

// Indexes (sessionToken and expiresAt indexes are created by unique: true and expireAfterSeconds)
sessionSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('Session', sessionSchema);
