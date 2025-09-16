const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const SERVER_URL = 'http://localhost:3000';

async function testServer() {
  console.log('🧪 Testing OTP QR Server...\n');

  try {
    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${SERVER_URL}/health`);
    console.log('✅ Health check passed:', healthResponse.data.status);
    console.log(`   Server version: ${healthResponse.data.version}`);
    console.log(`   Uptime: ${Math.round(healthResponse.data.uptime)}s\n`);

    // Test 2: API info
    console.log('2. Testing API info endpoint...');
    const apiResponse = await axios.get(`${SERVER_URL}/api`);
    console.log('✅ API info retrieved:', apiResponse.data.name);
    console.log(`   Available endpoints: ${Object.keys(apiResponse.data.endpoints).length}\n`);

    // Test 3: Test endpoint with sample data
    console.log('3. Testing sample OTP data...');
    const testResponse = await axios.get(`${SERVER_URL}/api/qr/test`);
    if (testResponse.data.success) {
      console.log('✅ Sample OTP data retrieved:');
      console.log(`   Type: ${testResponse.data.data.type}`);
      console.log(`   Issuer: ${testResponse.data.data.issuer}`);
      console.log(`   Account: ${testResponse.data.data.account}`);
      console.log(`   Algorithm: ${testResponse.data.data.algorithm}`);
      console.log(`   Digits: ${testResponse.data.data.digits}`);
      console.log(`   Period: ${testResponse.data.data.period}s\n`);
    } else {
      console.log('❌ Sample OTP test failed:', testResponse.data.error);
    }

    // Test 4: Base64 image processing (if you have a sample)
    console.log('4. Testing base64 image processing...');
    
    // Sample QR code data URL (this is a tiny test QR code)
    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    try {
      const base64Response = await axios.post(`${SERVER_URL}/api/qr/base64`, {
        image: sampleBase64
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (base64Response.data.success) {
        console.log('✅ Base64 processing works (though this sample may not contain QR data)');
      } else {
        console.log(`⚠️  Base64 endpoint works but no QR detected: ${base64Response.data.error}`);
      }
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('⚠️  Base64 endpoint works but sample image has no QR code (expected)');
      } else {
        console.log('❌ Base64 test error:', error.message);
      }
    }

    console.log('\n🎉 Server tests completed!');
    console.log('\n📋 Next steps:');
    console.log('   1. Open http://localhost:3000 in your browser');
    console.log('   2. Upload a QR code image containing OTP data');
    console.log('   3. Check the API documentation at http://localhost:3000/api/docs');

  } catch (error) {
    console.error('❌ Server test failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure the server is running:');
      console.log('   npm start    # or npm run dev');
    }
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  testServer();
}

module.exports = { testServer };
