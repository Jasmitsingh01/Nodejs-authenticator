const mongoose = require('mongoose');

const otpEntrySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  serviceName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  accountName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  issuer: {
    type: String,
    trim: true,
    maxlength: 100
  },
  // Encrypted OTP configuration
  otpConfig: {
    secret: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['totp', 'hotp', 'steam', 'battle', 'hex', 'hhex'],
      default: 'totp'
    },
    algorithm: {
      type: String,
      enum: ['SHA1', 'SHA256', 'SHA512', 'GOST3411_2012_256', 'GOST3411_2012_512'],
      default: 'SHA1'
    },
    digits: {
      type: Number,
      min: 4,
      max: 10,
      default: 6
    },
    period: {
      type: Number,
      min: 15,
      max: 300,
      default: 30
    },
    counter: {
      type: Number,
      default: 0
    }
  },
  originalUrl: {
    type: String,
    required: true
  },
  qrCodeImage: {
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    path: String,
    uploadDate: {
      type: Date,
      default: Date.now
    }
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  favorite: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    maxlength: 500
  },
  usage: {
    lastUsed: {
      type: Date,
      default: null
    },
    useCount: {
      type: Number,
      default: 0
    },
    lastGeneratedCode: {
      type: String,
      default: null
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      // Don't expose sensitive data in JSON
      if (ret.otpConfig && ret.otpConfig.secret) {
        ret.otpConfig.secret = '***HIDDEN***';
      }
      return ret;
    }
  }
});

// Virtual for display name
otpEntrySchema.virtual('displayName').get(function() {
  if (this.issuer) {
    return `${this.issuer} - ${this.accountName}`;
  }
  return `${this.serviceName} - ${this.accountName}`;
});

// Method to update usage statistics
otpEntrySchema.methods.updateUsage = async function(generatedCode = null) {
  this.usage.lastUsed = new Date();
  this.usage.useCount += 1;
  if (generatedCode) {
    this.usage.lastGeneratedCode = generatedCode;
  }
  return this.save();
};

// Method to increment HOTP counter
otpEntrySchema.methods.incrementCounter = async function() {
  if (this.otpConfig.type === 'hotp' || this.otpConfig.type === 'hhex') {
    this.otpConfig.counter += 1;
    return this.save();
  }
};

// Indexes for performance
otpEntrySchema.index({ userId: 1, createdAt: -1 });
otpEntrySchema.index({ userId: 1, serviceName: 1 });
otpEntrySchema.index({ userId: 1, favorite: -1, createdAt: -1 });
otpEntrySchema.index({ userId: 1, 'usage.lastUsed': -1 });

// Compound text index for search
otpEntrySchema.index({
  serviceName: 'text',
  accountName: 'text',
  issuer: 'text',
  tags: 'text',
  notes: 'text'
});

module.exports = mongoose.model('OTPEntry', otpEntrySchema);
