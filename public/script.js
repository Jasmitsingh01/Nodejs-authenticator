// Authentication and session management
let currentUser = null;
let authToken = null;
let codeUpdateInterval = null;
let currentOTPData = null;
let savedCodes = [];

// DOM elements
const authOverlay = document.getElementById('authOverlay');
const authTabs = document.querySelectorAll('.auth-tab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginFormSubmit = document.getElementById('loginFormSubmit');
const registerFormSubmit = document.getElementById('registerFormSubmit');
const userMenu = document.getElementById('userMenu');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const myCodesSection = document.getElementById('myCodesSection');
const myCodesContent = document.getElementById('myCodesContent');
const myCodesEmpty = document.getElementById('myCodesEmpty');
const searchCodes = document.getElementById('searchCodes');
const refreshCodesBtn = document.getElementById('refreshCodesBtn');

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const resultsSection = document.getElementById('resultsSection');
const resultsContent = document.getElementById('resultsContent');
const loadingSection = document.getElementById('loadingSection');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const saveCodeBtn = document.getElementById('saveCodeBtn');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await checkAuthStatus();
});

// Authentication functions
async function checkAuthStatus() {
    const token = localStorage.getItem('authToken');
    if (token) {
        try {
            const response = await fetch('/api/auth/profile', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                setAuthenticatedUser(data.user, token);
                return;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
        }
        localStorage.removeItem('authToken');
    }
    
    showAuthOverlay();
}

function setAuthenticatedUser(user, token) {
    currentUser = user;
    authToken = token;
    userName.textContent = user.displayName || user.username;
    hideAuthOverlay();
    loadUserCodes();
}

function showAuthOverlay() {
    authOverlay.style.display = 'flex';
    myCodesSection.style.display = 'none';
    userMenu.style.display = 'none';
}

function hideAuthOverlay() {
    authOverlay.style.display = 'none';
    myCodesSection.style.display = 'block';
    userMenu.style.display = 'block';
}

// Setup event listeners
function setupEventListeners() {
    // Auth tab switching
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            switchAuthTab(targetTab);
        });
    });

    // Form submissions
    loginFormSubmit.addEventListener('submit', handleLogin);
    registerFormSubmit.addEventListener('submit', handleRegister);
    
    // Logout
    logoutBtn.addEventListener('click', handleLogout);

    // Search codes
    searchCodes.addEventListener('input', debounce(handleSearchCodes, 300));
    refreshCodesBtn.addEventListener('click', loadUserCodes);

    // File upload
    fileInput.addEventListener('change', handleFileUpload);
    
    // Drag and drop
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('drop', handleFileDrop);
    uploadArea.addEventListener('click', () => fileInput.click());

    // Camera controls
    setupCameraControls();

    // Clipboard paste
    document.addEventListener('paste', handleClipboardPaste);
}

function switchAuthTab(tab) {
    authTabs.forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    
    if (tab === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
    }
    
    clearAuthErrors();
}

function clearAuthErrors() {
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
}

function showAuthError(formType, message) {
    const errorElement = document.getElementById(`${formType}Error`);
    errorElement.textContent = message;
    errorElement.style.display = 'block';
}

async function handleLogin(e) {
    e.preventDefault();
    clearAuthErrors();
    
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            localStorage.setItem('authToken', result.tokens.accessToken);
            setAuthenticatedUser(result.user, result.tokens.accessToken);
        } else {
            showAuthError('login', result.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        showAuthError('login', 'Network error. Please try again.');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    clearAuthErrors();
    
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            localStorage.setItem('authToken', result.tokens.accessToken);
            setAuthenticatedUser(result.user, result.tokens.accessToken);
        } else {
            showAuthError('register', result.error || 'Registration failed');
        }
    } catch (error) {
        console.error('Register error:', error);
        showAuthError('register', 'Network error. Please try again.');
    }
}

async function handleLogout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    localStorage.removeItem('authToken');
    currentUser = null;
    authToken = null;
    savedCodes = [];
    stopLiveCodeUpdates();
    showAuthOverlay();
}

// Load and display user's saved OTP codes
async function loadUserCodes() {
    if (!authToken) return;
    
    try {
        const response = await fetch('/api/otp', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            savedCodes = data.entries || [];
            displayUserCodes(savedCodes);
        }
    } catch (error) {
        console.error('Failed to load codes:', error);
    }
}

function displayUserCodes(codes) {
    if (codes.length === 0) {
        myCodesContent.style.display = 'none';
        myCodesEmpty.style.display = 'block';
        return;
    }
    
    myCodesContent.style.display = 'grid';
    myCodesEmpty.style.display = 'none';
    
    myCodesContent.innerHTML = codes.map(code => generateCodeCard(code)).join('');
    
    // Start live updates for TOTP codes
    startLiveCodeUpdatesForSavedCodes();
}

function generateCodeCard(codeEntry) {
    return `
        <div class="code-card" data-code-id="${codeEntry.id}">
            <div class="code-header">
                <div>
                    <div class="code-service">${escapeHtml(codeEntry.serviceName)}</div>
                    <div class="code-account">${escapeHtml(codeEntry.accountName)}</div>
                </div>
                <div class="code-actions">
                    <button class="copy-code-btn" onclick="generateAndCopyCode('${codeEntry.id}')">📋</button>
                    <button class="delete-code-btn" onclick="deleteCode('${codeEntry.id}')">🗑️</button>
                </div>
            </div>
            <div class="code-display">
                <div class="code-value" id="code-${codeEntry.id}">••••••</div>
                <div class="code-timer" id="timer-${codeEntry.id}">
                    ${codeEntry.type === 'totp' ? 'Loading...' : 'Click to generate'}
                </div>
                <div class="timer-bar" id="timer-bar-${codeEntry.id}" style="${codeEntry.type === 'totp' ? '' : 'display: none;'}">
                    <div class="timer-progress" id="timer-progress-${codeEntry.id}"></div>
                </div>
            </div>
        </div>
    `;
}

async function generateAndCopyCode(codeId) {
    if (!authToken) return;
    
    try {
        const response = await fetch(`/api/otp/${codeId}/generate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const code = data.currentCode.code;
            
            // Update display
            document.getElementById(`code-${codeId}`).textContent = code;
            
            // Copy to clipboard
            await copyToClipboard(code);
            
            // Show feedback
            showNotification('Code copied to clipboard!');
        }
    } catch (error) {
        console.error('Failed to generate code:', error);
        showNotification('Failed to generate code', 'error');
    }
}

async function deleteCode(codeId) {
    if (!authToken || !confirm('Are you sure you want to delete this OTP code?')) return;
    
    try {
        const response = await fetch(`/api/otp/${codeId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            savedCodes = savedCodes.filter(code => code.id !== codeId);
            displayUserCodes(savedCodes);
            showNotification('Code deleted successfully');
        } else {
            const result = await response.json();
            console.error('Delete failed:', result);
            showNotification(`Failed to delete code: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Failed to delete code:', error);
        showNotification('Failed to delete code: Network error', 'error');
    }
}

function startLiveCodeUpdatesForSavedCodes() {
    // Update codes every second for TOTP entries
    if (codeUpdateInterval) clearInterval(codeUpdateInterval);
    
    codeUpdateInterval = setInterval(() => {
        savedCodes.forEach(async (codeEntry) => {
            if (codeEntry.type === 'totp') {
                try {
                    const response = await fetch(`/api/otp/${codeEntry.id}/generate`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${authToken}`
                        }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        const currentCode = data.currentCode;
                        
                        // Update display
                        const codeElement = document.getElementById(`code-${codeEntry.id}`);
                        const timerElement = document.getElementById(`timer-${codeEntry.id}`);
                        const progressElement = document.getElementById(`timer-progress-${codeEntry.id}`);
                        
                        if (codeElement) codeElement.textContent = currentCode.code;
                        if (timerElement) timerElement.textContent = `${currentCode.timeRemaining}s remaining`;
                        if (progressElement) {
                            const progress = ((currentCode.period - currentCode.timeRemaining) / currentCode.period) * 100;
                            progressElement.style.width = `${progress}%`;
                        }
                    }
                } catch (error) {
                    console.error('Failed to update code:', error);
                }
            }
        });
    }, 1000);
}

function handleSearchCodes(e) {
    const searchTerm = e.target.value.toLowerCase();
    const filteredCodes = savedCodes.filter(code => 
        code.serviceName.toLowerCase().includes(searchTerm) ||
        code.accountName.toLowerCase().includes(searchTerm) ||
        (code.issuer && code.issuer.toLowerCase().includes(searchTerm))
    );
    displayUserCodes(filteredCodes);
}

// File upload handling
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (file) {
        await processFile(file);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
}

function handleFileDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        processFile(file);
    }
}

async function processFile(file) {
    showLoading();
    
    const formData = new FormData();
    formData.append('qrImage', file);
    
    try {
        let response;
        let endpoint;
        
        if (authToken) {
            // Use authenticated endpoint to save to user's collection
            endpoint = '/api/otp/upload';
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                },
                body: formData
            });
        } else {
            // Use legacy endpoint for guest users
            endpoint = '/api/qr/upload';
            response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });
        }
        
        const result = await response.json();
        
        if (result.success) {
            showResults(result);
            if (authToken) {
                loadUserCodes(); // Refresh the codes list for authenticated users
            }
        } else {
            showError(result.error || 'Failed to process QR code');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showError('Network error. Please try again.');
    }
}

// Camera functionality
function setupCameraControls() {
    const startCamera = document.getElementById('startCamera');
    const capturePhoto = document.getElementById('capturePhoto');
    const stopCamera = document.getElementById('stopCamera');
    const cameraContainer = document.getElementById('cameraContainer');
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('captureCanvas');
    
    let stream = null;
    
    startCamera.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
            video.srcObject = stream;
            
            cameraContainer.style.display = 'block';
            startCamera.style.display = 'none';
            capturePhoto.style.display = 'inline-block';
            stopCamera.style.display = 'inline-block';
        } catch (error) {
            console.error('Camera error:', error);
            showNotification('Camera access denied or not available', 'error');
        }
    });
    
    capturePhoto.addEventListener('click', () => {
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        
        canvas.toBlob(blob => {
            const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
            processFile(file);
        }, 'image/jpeg', 0.9);
    });
    
    stopCamera.addEventListener('click', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        
        cameraContainer.style.display = 'none';
        startCamera.style.display = 'inline-block';
        capturePhoto.style.display = 'none';
        stopCamera.style.display = 'none';
    });
}

// Clipboard functionality
async function handleClipboardPaste(e) {
    if (!authToken) return;
    
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
                await processFile(file);
            }
            break;
        }
    }
}

// UI state management
function showLoading() {
    hideAllSections();
    loadingSection.style.display = 'block';
}

function showError(message) {
    hideAllSections();
    errorMessage.textContent = message;
    errorSection.style.display = 'block';
}

function showResults(result) {
    hideAllSections();
    resultsSection.style.display = 'block';
    resultsSection.classList.add('fade-in');
    
    resultsContent.innerHTML = generateResultsHTML(result);
    
    // Show save button if user is authenticated and result contains OTP data
    if (authToken && result.entry) {
        saveCodeBtn.style.display = 'inline-block';
        saveCodeBtn.onclick = () => {
            showNotification('QR code saved to your collection!');
            saveCodeBtn.style.display = 'none';
            loadUserCodes();
        };
    }
    
    // Start live code updates if we have TOTP codes
    if (result.currentCode && (result.currentCode.type === 'TOTP' || result.currentCode.type === 'Steam' || result.currentCode.type === 'Battle.net')) {
        startLiveCodeUpdates(result.data || result.entry);
    }
}

function hideAllSections() {
    resultsSection.style.display = 'none';
    loadingSection.style.display = 'none';
    errorSection.style.display = 'none';
}

function clearResults() {
    hideAllSections();
    stopLiveCodeUpdates();
    fileInput.value = '';
}

// Generate results HTML (same as before but with updated styling)
function generateResultsHTML(result) {
    let html = '';
    
    if (result.entry) {
        html += `
            <div style="background: #e8f5e8; border: 1px solid #28a745; border-radius: 8px; padding: 20px; margin: 15px 0;">
                <h4 style="color: #155724; margin-bottom: 10px;">✅ QR Code Saved Successfully!</h4>
                <p><strong>Service:</strong> ${escapeHtml(result.entry.serviceName)}</p>
                <p><strong>Account:</strong> ${escapeHtml(result.entry.accountName)}</p>
            </div>
        `;
    }
    
    html += generateCurrentCodeHTML(result.currentCode, result.codeError);
    html += generateMultipleCodesHTML(result.multipleCodes);
    
    if (result.processingTime) {
        html += `
            <div style="margin-top: 20px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 14px; color: #6c757d;">
                ⚡ Processed in ${result.processingTime}ms
            </div>
        `;
    }
    
    return html;
}

function generateCurrentCodeHTML(currentCode, codeError) {
    if (codeError) {
        return `
            <div style="background: #fed7d7; border: 1px solid #fc8181; border-radius: 8px; padding: 20px; margin: 15px 0;">
                <h4 style="color: #c53030; margin-bottom: 10px;">❌ Code Generation Error</h4>
                <p>${escapeHtml(codeError)}</p>
            </div>
        `;
    }

    if (!currentCode) {
        return '';
    }

    let html = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; padding: 25px; margin: 20px 0; text-align: center;">
            <h4 style="margin-bottom: 15px; font-size: 1.2rem;">🔐 Current OTP Code</h4>
            <div style="font-size: 2.5rem; font-family: 'Courier New', monospace; font-weight: bold; letter-spacing: 8px; margin: 15px 0;">
                <span class="current-otp-code">${currentCode.code}</span>
                <button class="copy-btn" onclick="copyToClipboard('${currentCode.code}')" style="margin-left: 15px; font-size: 0.8rem;">Copy</button>
            </div>
    `;

    if (currentCode.type === 'TOTP' || currentCode.type === 'Steam' || currentCode.type === 'Battle.net') {
        const timeBarWidth = ((currentCode.period - currentCode.timeRemaining) / currentCode.period) * 100;
        html += `
            <div style="margin-top: 20px;">
                <p style="margin-bottom: 8px;">⏱️ Time remaining: <strong><span class="time-remaining">${currentCode.timeRemaining} seconds</span></strong></p>
                <div style="background: rgba(255,255,255,0.3); border-radius: 10px; height: 8px; overflow: hidden;">
                    <div class="time-progress-bar" style="background: ${currentCode.timeRemaining > 10 ? '#48bb78' : '#e53e3e'}; height: 100%; width: ${timeBarWidth}%; transition: all 1s ease;"></div>
                </div>
                <p style="margin-top: 8px; font-size: 0.9rem; opacity: 0.9;">Next refresh: ${new Date(currentCode.nextRefresh).toLocaleTimeString()}</p>
            </div>
        `;
    } else if (currentCode.type === 'HOTP') {
        html += `
            <div style="margin-top: 15px;">
                <p>🔄 Counter: <strong>${currentCode.counter}</strong></p>
                <p style="font-size: 0.9rem; opacity: 0.9;">${currentCode.note}</p>
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

function generateMultipleCodesHTML(multipleCodes) {
    if (!multipleCodes || multipleCodes.length === 0) {
        return '';
    }

    let html = `
        <div style="margin: 20px 0;">
            <h4 style="margin-bottom: 15px;">📱 ${multipleCodes[0].type === 'HOTP' ? 'Next Counter Values' : 'Time Windows'}</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
    `;

    multipleCodes.forEach((codeData, index) => {
        const isActive = index === 0;
        const bgColor = isActive ? '#667eea' : '#e2e8f0';
        const textColor = isActive ? 'white' : '#4a5568';

        html += `
            <div class="multi-code-item" style="background: ${bgColor}; color: ${textColor}; padding: 15px; border-radius: 8px; text-align: center;">
                <div class="multi-code-value" style="font-family: 'Courier New', monospace; font-size: 1.4rem; font-weight: bold; margin-bottom: 8px;">
                    ${codeData.code}
                </div>
                <div style="font-size: 0.8rem; opacity: 0.8;">
                    ${codeData.timeWindow || `Counter ${codeData.counterValue}`}
                    <span class="multi-code-time">${codeData.timeRemaining ? ` (${codeData.timeRemaining}s)` : ''}</span>
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    return html;
}

// Live code updates
function startLiveCodeUpdates(otpData) {
    stopLiveCodeUpdates();
    currentOTPData = otpData;

    codeUpdateInterval = setInterval(async () => {
        await updateLiveCodes();
    }, 1000);
}

function stopLiveCodeUpdates() {
    if (codeUpdateInterval) {
        clearInterval(codeUpdateInterval);
        codeUpdateInterval = null;
    }
    currentOTPData = null;
}

async function updateLiveCodes() {
    if (!currentOTPData || !currentOTPData.originalUrl) return;

    try {
        const response = await fetch('/api/otp/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                otpUrl: currentOTPData.originalUrl
            })
        });

        if (!response.ok) return;

        const result = await response.json();
        if (!result.success || !result.currentCode) return;

        // Update the current code display
        const codeElement = document.querySelector('.current-otp-code');
        const timeElement = document.querySelector('.time-remaining');
        const progressElement = document.querySelector('.time-progress-bar');

        if (codeElement) {
            codeElement.textContent = result.currentCode.code;
        }

        if (timeElement) {
            timeElement.textContent = `${result.currentCode.timeRemaining} seconds`;
        }

        if (progressElement) {
            const timeBarWidth = ((result.currentCode.period - result.currentCode.timeRemaining) / result.currentCode.period) * 100;
            progressElement.style.width = `${timeBarWidth}%`;
            progressElement.style.backgroundColor = result.currentCode.timeRemaining > 10 ? '#48bb78' : '#e53e3e';
        }

        // Update multiple codes
        if (result.multipleCodes) {
            const multiCodeElements = document.querySelectorAll('.multi-code-item');
            result.multipleCodes.forEach((codeData, index) => {
                if (multiCodeElements[index]) {
                    const codeSpan = multiCodeElements[index].querySelector('.multi-code-value');
                    const timeSpan = multiCodeElements[index].querySelector('.multi-code-time');

                    if (codeSpan) codeSpan.textContent = codeData.code;
                    if (timeSpan && codeData.timeRemaining) {
                        timeSpan.textContent = `(${codeData.timeRemaining}s)`;
                    }
                }
            });
        }

    } catch (error) {
        console.error('Error updating live codes:', error);
    }
}

// Utility functions
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Copy failed:', error);
        return false;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showNotification(message, type = 'success') {
    // Simple notification system
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#dc3545' : '#28a745'};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        z-index: 10000;
        font-weight: 500;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        transition: all 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}