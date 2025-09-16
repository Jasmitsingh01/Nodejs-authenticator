# 🚀 Quick Start Guide

## Get the Node.js OTP Server Running in 5 Minutes!

### 1. 📂 Navigate to the Directory
```bash
cd "Nodejs authenticator"
```

### 2. 📦 Install Dependencies
```bash
npm install
```

### 3. ⚙️ Setup Environment (Optional)
```bash
# Copy the example environment file
cp env.example .env

# Edit .env if you want to use MongoDB (optional)
# The server works without MongoDB for testing
```

### 4. 🚀 Start the Server
```bash
npm start
```

### 5. 🌐 Open Your Browser
Navigate to: **http://localhost:3000**

## 🎯 What You Can Do Right Away

### Without Registration (Guest Mode):
- ✅ Upload QR code images
- ✅ See live OTP codes with countdown timers
- ✅ Copy codes to clipboard
- ✅ Use camera to scan QR codes
- ✅ Paste QR images from clipboard

### With Registration:
- ✅ Save QR codes permanently
- ✅ Manage your OTP collection
- ✅ Delete saved codes
- ✅ Search and organize codes

## 🧪 Test with Sample QR Codes

You can test with any TOTP QR codes from:
- Google Authenticator
- Microsoft Authenticator 
- Any 2FA-enabled service

## 🔧 Development Mode
```bash
npm run dev
# Server restarts automatically on file changes
```

## 📱 Mobile Testing
The interface is mobile-responsive! Test on your phone at:
`http://YOUR_COMPUTER_IP:3000`

## 🐛 Troubleshooting

### Port Already in Use?
```bash
# Kill any running Node processes
taskkill /f /im node.exe
# Or change the port in .env file
PORT=3001
```

### MongoDB Connection Issues?
The server runs fine without MongoDB - just limited to guest mode.

### File Upload Issues?
Check the `uploads/` folder is created and writable.

## 🎉 Success!
If you see the OTP Authenticator interface with login/register options, you're all set! 

The server is now running with:
- ✅ User authentication
- ✅ QR code processing  
- ✅ Real-time OTP generation
- ✅ Live countdown timers
- ✅ Session persistence
