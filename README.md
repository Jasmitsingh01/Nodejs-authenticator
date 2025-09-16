# OTP Authenticator Node.js Server

A complete Node.js server implementation converted from the browser extension, featuring user authentication, QR code processing, and real-time OTP generation.

## 🚀 Features

- **User Authentication**: JWT-based registration and login system
- **QR Code Processing**: Upload and process QR code images to extract OTP data
- **Real-time OTP Generation**: Live TOTP codes with countdown timers
- **MongoDB Integration**: Persistent storage for users and OTP entries
- **Modern Web Interface**: Responsive frontend with authentication
- **Multiple OTP Types**: Support for TOTP, HOTP, Steam, and Battle.net codes

## 📦 Installation

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   ```bash
   cp env.example .env
   # Edit .env file with your MongoDB connection and secrets
   ```

3. **Start MongoDB** (optional - server works without it):
   - Install MongoDB locally, or
   - Use MongoDB Atlas cloud service
   - Update `MONGODB_URI` in .env file

4. **Run the Server**:
   ```bash
   npm start
   # or for development
   npm run dev
   ```

## 🌐 Usage

### Web Interface
Navigate to `http://localhost:3000` to access the web interface.

### Authentication
- **Register**: Create a new account to save OTP codes permanently
- **Guest Mode**: Use without registration for temporary QR processing

### QR Code Processing
1. Upload QR code images via:
   - File upload
   - Camera capture
   - Clipboard paste
2. Get live OTP codes with countdown timers
3. Save codes to your collection (authenticated users)

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile

### OTP Management (Authenticated)
- `POST /api/otp/upload` - Upload QR and save to collection
- `GET /api/otp` - Get user's saved OTP entries
- `POST /api/otp/:id/generate` - Generate code for saved entry
- `DELETE /api/otp/:id` - Delete OTP entry

### Legacy QR Processing (Guest Access)
- `POST /api/qr/upload` - Process QR without saving
- `POST /api/qr/base64` - Process base64 QR image

### System
- `GET /health` - Health check
- `GET /api` - API information

## 🛠️ Configuration

### Environment Variables (.env)
```bash
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/otp-authenticator

# Security
JWT_SECRET=your-super-secret-jwt-key
SESSION_SECRET=your-super-secret-session-key

# File Upload
MAX_FILE_SIZE=10MB
UPLOAD_PATH=./uploads
```

## 🔧 Development

### Scripts
- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests

### File Structure
```
├── server.js              # Main server file
├── package.json           # Dependencies and scripts
├── .env                   # Environment configuration
├── config/               # Database configuration
├── middleware/           # Authentication middleware
├── models/              # MongoDB models
├── routes/              # API routes
├── services/            # Business logic services
├── public/              # Static web files
├── lib/                 # Shared libraries
└── uploads/             # QR code image storage
```

## 🔐 Security Features

- JWT token-based authentication
- Password hashing with bcrypt
- Rate limiting on auth endpoints
- Input validation and sanitization
- Secure file upload handling
- CORS and security headers

## 📱 Supported OTP Types

- **TOTP** (Time-based): Google Authenticator, Microsoft Authenticator
- **HOTP** (Counter-based): Hardware tokens
- **Steam**: Steam Guard codes
- **Battle.net**: Blizzard Authenticator

## 🎯 Key Differences from Browser Extension

1. **Server Architecture**: Express.js instead of browser APIs
2. **User Management**: Multi-user support with authentication
3. **Persistent Storage**: MongoDB instead of browser storage
4. **Web Interface**: Modern responsive UI instead of popup
5. **File Handling**: Server-side image processing with Jimp
6. **Real-time Updates**: Live OTP codes with countdown timers

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and questions:
1. Check the server logs for errors
2. Verify MongoDB connection
3. Ensure all environment variables are set
4. Check the browser console for frontend errors

## 🚀 Deployment

For production deployment:
1. Set `NODE_ENV=production`
2. Use a process manager like PM2
3. Set up reverse proxy with Nginx
4. Use MongoDB Atlas for database
5. Configure proper SSL certificates
