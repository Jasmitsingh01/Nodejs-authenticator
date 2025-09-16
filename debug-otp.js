const OTPGenerator = require('./services/otp-generator');
const { parseOTPAuth } = require('./lib/otp-parser');

// Test OTP generation with a known working example
console.log('🧪 Debugging OTP Code Generation...\n');

// Known working TOTP example
const testOTPUrl = 'otpauth://totp/TestService:testuser@example.com?secret=JBSWY3DPEHPK3PXP&issuer=TestService&algorithm=SHA1&digits=6&period=30';

try {
    console.log('1. Testing OTP URL parsing...');
    const parsedData = parseOTPAuth(testOTPUrl);
    console.log('✅ Parsed OTP data:', {
        type: parsedData.type,
        issuer: parsedData.issuer,
        account: parsedData.account,
        secret: parsedData.secret,
        algorithm: parsedData.algorithm,
        digits: parsedData.digits,
        period: parsedData.period
    });

    console.log('\n2. Testing current code generation...');
    const currentCode = OTPGenerator.generateCurrentCode(parsedData);
    console.log('✅ Current code generated:', currentCode);

    console.log('\n3. Testing multiple codes...');
    const multipleCodes = OTPGenerator.getMultipleCodes(parsedData, 3);
    console.log('✅ Multiple codes:', multipleCodes);

    console.log('\n4. Testing Base32 decoding...');
    const testSecret = 'JBSWY3DPEHPK3PXP';
    try {
        const decoded = OTPGenerator.base32ToBuffer(testSecret);
        console.log('✅ Base32 decoded successfully, buffer length:', decoded.length);
        console.log('   Buffer hex:', decoded.toString('hex'));
    } catch (error) {
        console.log('❌ Base32 decoding failed:', error.message);
    }

    console.log('\n5. Testing manual TOTP generation...');
    const currentTime = Math.floor(Date.now() / 1000);
    const period = 30;
    const counter = Math.floor(currentTime / period);
    const timeRemaining = period - (currentTime % period);
    
    console.log('   Current time:', currentTime);
    console.log('   Counter:', counter);
    console.log('   Time remaining:', timeRemaining);
    
    try {
        const manualCode = OTPGenerator.generateOTPCode(testSecret, counter, 6, 'SHA1', false);
        console.log('✅ Manual TOTP code:', manualCode);
    } catch (error) {
        console.log('❌ Manual TOTP generation failed:', error.message);
        console.log('   Error details:', error);
    }

} catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('   Stack trace:', error.stack);
}

// Test with different secrets
console.log('\n6. Testing with different secret formats...');

const testCases = [
    'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ', // From your original example
    'JBSWY3DPEHPK3PXP',                  // Simple test case
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',  // Another test case
];

testCases.forEach((secret, index) => {
    try {
        console.log(`\nTest case ${index + 1}: ${secret}`);
        const testData = {
            type: 'totp',
            secret: secret,
            algorithm: 'SHA1',
            digits: 6,
            period: 30
        };
        
        const code = OTPGenerator.generateCurrentCode(testData);
        console.log(`✅ Generated code: ${code.code} (${code.timeRemaining}s remaining)`);
    } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
    }
});

console.log('\n🎯 Debug complete!');
