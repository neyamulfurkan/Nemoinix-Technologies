// backend/routes/auth.js
// Authentication routes for registration, login, email verification, and password management.
// GLOBAL REFERENCE: User Workflows → All user types → Sign Up & Login, API Endpoints → /api/auth/*
// PURPOSE: Handle user authentication, registration, email verification, and password reset.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const User = require('../models/userModel');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const { sendEmailVerification, sendPasswordReset, sendWelcomeEmail } = require('../config/email');

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory temporarily
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max file size
    },
    fileFilter: (req, file, cb) => {
        // Allow only images and PDFs
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only JPG, PNG, and PDF files are allowed'));
        }
    }
});

// @route   POST /api/auth/register
// @desc    Register new user (student or club admin)
// @access  Public
router.post('/register', upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'certificate', maxCount: 1 }
]), asyncHandler(async (req, res) => {
    // Extract data from req.body (multer populates this with form fields)
    const { 
        email, 
        password, 
        full_name, 
        phone, 
        role, 
        university, 
        student_id, 
        department,
        club_name,
        established_year,
        description
    } = req.body;
    
    console.log('Received registration data:', {
        email,
        role,
        full_name,
        club_name,
        hasFiles: !!req.files
    });
    
    // Validate required fields
    if (!email || !password || !full_name || !phone || !role) {
        return res.status(400).json({
            success: false,
            message: 'Please provide all required fields'
        });
    }
    
    // Validate role
    if (!['student', 'club_admin'].includes(role)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid role. Must be student or club_admin'
        });
    }
    
    // Validate student fields
    if (role === 'student' && (!university || !student_id || !department)) {
        return res.status(400).json({
            success: false,
            message: 'University, student ID, and department are required for students'
        });
    }
    
    // Validate club fields
    if (role === 'club_admin') {
        if (!club_name || !university || !established_year || !description) {
            return res.status(400).json({
                success: false,
                message: 'Club name, university, established year, and description are required for clubs'
            });
        }
        
        if (description.length < 50) {
            return res.status(400).json({
                success: false,
                message: 'Club description must be at least 50 characters'
            });
        }
    }
    
    // Validate password
    if (password.length < 8) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 8 characters'
        });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid email format'
        });
    }
    
    // Note: Email domain validation removed - all valid emails accepted for club registration
    
    // Validate phone number (BD format)
    const phoneRegex = /^01[3-9]\d{8}$/;
    if (!phoneRegex.test(phone)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid phone number. Must be in format 01XXXXXXXXX'
        });
    }
    
    // Check if user already exists
    try {
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }
    } catch (dbError) {
        console.error('Database error checking email:', dbError);
        return res.status(500).json({
            success: false,
            message: 'Database error. Please try again.'
        });
    }
    
   // Handle file uploads if club registration
    let logoUrl = null;
    let certificateUrl = null;
    
    if (role === 'club_admin') {
        console.log('Files received:', req.files ? Object.keys(req.files) : 'none');
        
        const cloudinary = require('../config/cloudinary');
        
        try {
            // Check if Cloudinary is configured
            if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
                console.warn('⚠️  Cloudinary not configured - files will not be uploaded');
            } else {
                // Upload logo if provided
                if (req.files && req.files.logo && req.files.logo[0]) {
                    const logoResult = await cloudinary.uploadBuffer(
                        req.files.logo[0].buffer,
                        'clubs/logos',
                        `logo_${Date.now()}`
                    );
                    logoUrl = logoResult.url;
                    console.log('✅ Logo uploaded to Cloudinary:', logoUrl);
                }
                
                // Upload certificate if provided
                if (req.files && req.files.certificate && req.files.certificate[0]) {
                    const certResult = await cloudinary.uploadBuffer(
                        req.files.certificate[0].buffer,
                        'clubs/certificates',
                        `cert_${Date.now()}`
                    );
                    certificateUrl = certResult.url;
                    console.log('✅ Certificate uploaded to Cloudinary:', certificateUrl);
                }
            }
            
        } catch (uploadError) {
            console.error('❌ Cloudinary upload failed:', uploadError.message);
            // Continue registration even if upload fails
            // Frontend will show "No logo/certificate uploaded" warnings
        }
    }
    
    // Create user
    const { user, verificationToken } = await User.create({
        email,
        password,
        full_name: role === 'club_admin' ? club_name : full_name,
        phone,
        role,
        university: role === 'club_admin' ? university : university,
        student_id: role === 'club_admin' ? null : student_id,
        department: role === 'club_admin' ? null : department
    });
    
    // If club admin, create club record
    if (role === 'club_admin') {
        const Club = require('../models/clubModel');
        
        // Generate slug from club name
        const slug = club_name
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
        
        await Club.createPending({
            user_id: user.id,
            club_name,
            slug: slug,
            university,
            established_year,
            description,
            logo_url: logoUrl || null,
            certificate_url: certificateUrl || null,
            contact_email: email,
            contact_phone: phone
        });
    }
    
    // AUTO-VERIFY FOR TESTING - Remove this block in production
    const db = require('../config/database');
    await db.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [user.id]);
    
    const message = role === 'club_admin' 
        ? 'Club application submitted successfully. You can login once approved.'
        : 'Registration successful. You can now login immediately.';
    
    res.status(201).json({
        success: true,
        message: message,
        data: {
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                club_name: role === 'club_admin' ? club_name : null
            }
        }
    });
}));

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    
    // Validate
    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: 'Please provide email and password'
        });
    }
    
    // Find user
    let user;
    try {
        user = await User.findByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
    } catch (dbError) {
        console.error('Database error during login:', dbError);
        return res.status(500).json({
            success: false,
            message: 'Server error. Please try again.'
        });
    }
    
    // Check password
    const isValidPassword = await User.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
        return res.status(401).json({
            success: false,
            message: 'Invalid email or password'
        });
    }
    
    // Check if email is verified (except for super_admin)
    // DISABLED FOR TESTING - Enable this in production
    /*
    if (user.role !== 'super_admin' && !user.is_verified) {
        return res.status(403).json({
            success: false,
            message: 'Please verify your email before logging in. Check your inbox for the verification link.',
            requires_verification: true
        });
    }
    */
    
    // Get club info if club_admin
    let clubInfo = null;
    if (user.role === 'club_admin') {
        const Club = require('../models/clubModel');
        const club = await Club.findByUserId(user.id);
        
        if (!club) {
            return res.status(403).json({
                success: false,
                message: 'Club application not found. Please contact support.'
            });
        }
        
        // Check club status
        if (club.status === 'pending') {
            return res.status(403).json({
                success: false,
                message: 'Your club application is pending approval. You will receive an email once it is reviewed.',
                club_status: 'pending'
            });
        }
        
        if (club.status === 'rejected') {
            return res.status(403).json({
                success: false,
                message: 'Your club application has been rejected. Please contact support for more information.',
                club_status: 'rejected'
            });
        }
        
        if (club.status === 'suspended') {
            return res.status(403).json({
                success: false,
                message: 'Your club has been suspended. Please contact support.',
                club_status: 'suspended'
            });
        }
        
        clubInfo = {
            club_id: club.id,
            club_name: club.club_name,
            club_slug: club.slug,
            club_logo: club.logo_url,
            club_status: club.status,
            reward_tier: club.reward_tier,
            reward_points: club.reward_points
        };
    }
    
    // Update last login
    await User.updateLastLogin(user.id);
    
    // Generate token
    const token = User.generateToken(user.id);
    
    res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            phone: user.phone,
            role: user.role,
            university: user.university,
            student_id: user.student_id,
            department: user.department,
            is_verified: user.is_verified,
            avatar_url: user.avatar_url,
            ...clubInfo
        }
    });
}));

// @route   POST /api/auth/verify-email
// @desc    Verify user email with token
// @access  Public
router.post('/verify-email', asyncHandler(async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({
            success: false,
            message: 'Verification token is required'
        });
    }
    
    const user = await User.verifyEmail(token);
    
    if (!user) {
        return res.status(400).json({
            success: false,
            message: 'Invalid or expired verification token'
        });
    }
    
    res.json({
        success: true,
        message: 'Email verified successfully. You can now login.'
    });
}));

// @route   POST /api/auth/resend-verification
// @desc    Resend verification email
// @access  Public
router.post('/resend-verification', asyncHandler(async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }
    
    try {
        const { user, verificationToken } = await User.resendVerification(email);
        await sendEmailVerification(user, verificationToken);
        
        res.json({
            success: true,
            message: 'Verification email sent successfully'
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
}));

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', asyncHandler(async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }
    
    const resetToken = await User.generatePasswordResetToken(email);
    
    if (!resetToken) {
        return res.status(404).json({
            success: false,
            message: 'No account found with this email'
        });
    }
    
    
    
    res.json({
        success: true,
        message: 'Password reset link sent to your email'
    });
}));

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password', asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    
    if (!token || !password) {
        return res.status(400).json({
            success: false,
            message: 'Token and new password are required'
        });
    }
    
    if (password.length < 8) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 8 characters'
        });
    }
    
    try {
        await User.resetPassword(token, password);
        
        res.json({
            success: true,
            message: 'Password reset successful. You can now login with your new password.'
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
}));

// @route   GET /api/auth/me
// @desc    Get current user info
// @access  Private
router.get('/me', authenticate, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    
    if (!user) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }
    
    // Get club info if club_admin
    let clubInfo = null;
    if (user.role === 'club_admin') {
        const Club = require('../models/clubModel');
        const club = await Club.findByUserId(user.id);
        if (club) {
            clubInfo = {
                club_id: club.id,
                club_name: club.club_name,
                club_slug: club.slug,
                club_logo: club.logo_url,
                club_status: club.status,
                reward_tier: club.reward_tier,
                reward_points: club.reward_points
            };
        }
    }
    
    res.json({
        success: true,
        user: {
            ...user,
            ...clubInfo
        }
    });
}));


router.put('/profile', authenticate, asyncHandler(async (req, res) => {
    const updates = req.body;
    
    // Validate phone if provided
    if (updates.phone) {
        const phoneRegex = /^01[3-9]\d{8}$/;
        if (!phoneRegex.test(updates.phone)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format'
            });
        }
    }
    
    const updatedUser = await User.updateProfile(req.user.id, updates);
    
    res.json({
        success: true,
        message: 'Profile updated successfully',
        user: updatedUser
    });
}));

// @route   PUT /api/auth/password
// @desc    Change password
// @access  Private
router.put('/password', authenticate, asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
        return res.status(400).json({
            success: false,
            message: 'Current password and new password are required'
        });
    }
    
    if (new_password.length < 8) {
        return res.status(400).json({
            success: false,
            message: 'New password must be at least 8 characters'
        });
    }
    
    try {
        await User.changePassword(req.user.id, current_password, new_password);
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
}));

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal, server logs)
// @access  Private
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
    // Log logout activity
    const db = require('../config/database');
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description, ip_address) VALUES ($1, $2, $3, $4)',
        [req.user.id, 'logout', 'User logged out', req.ip]
    );
    
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
}));

// @route   GET /api/auth/check-email
// @desc    Check if email exists (for frontend validation)
// @access  Public
router.get('/check-email', asyncHandler(async (req, res) => {
    const { email } = req.query;
    
    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }
    
    const exists = await User.emailExists(email);
    
    res.json({
        success: true,
        exists
    });
}));

// @route   PUT /api/auth/avatar
// @desc    Update user avatar
// @access  Private
router.put('/avatar', authenticate, asyncHandler(async (req, res) => {
    const multer = require('multer');
    const cloudinary = require('../config/cloudinary');
    const db = require('../config/database'); // FIX: Import db
    
    // Configure multer for memory storage
    const storage = multer.memoryStorage();
    const upload = multer({
        storage: storage,
        limits: {
            fileSize: 2 * 1024 * 1024 // 2MB limit
        },
        fileFilter: (req, file, cb) => {
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Only image files are allowed'));
            }
        }
    }).single('avatar');
    
    // Handle upload
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({
                success: false,
                message: err.message || 'Error uploading file'
            });
        }
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }
        
        try {
            // Upload to Cloudinary
            const result = await cloudinary.uploadUserAvatar(req.file.buffer, req.user.id);
            
            // Update user avatar in database
            await db.query(
                'UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [result.url, req.user.id]
            );
            
            // Get updated user
            const updatedUser = await db.getOne(
                'SELECT id, email, full_name, phone, role, university, student_id, department, is_verified, avatar_url, created_at, last_login FROM users WHERE id = $1',
                [req.user.id]
            );
            
            res.json({
                success: true,
                message: 'Avatar updated successfully',
                user: updatedUser
            });
            
        } catch (error) {
            console.error('Avatar upload error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to upload avatar'
            });
        }
    });
}));

module.exports = router;