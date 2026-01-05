// backend/models/userModel.js
// User model with authentication methods (password hashing, token generation, validation).
// GLOBAL REFERENCE: User Object Structure, Database Schema → users table, JWT Configuration
// PURPOSE: Handle all user-related database operations and authentication logic.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');

// User Model
class User {
    // Create new user
    static async create(userData) {
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(userData.password, salt);
        
        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        const user = await db.insertOne('users', {
            email: userData.email.toLowerCase(),
            password_hash: passwordHash,
            full_name: userData.full_name,
            phone: userData.phone,
            role: userData.role || 'student',
            university: userData.university || null,
            student_id: userData.student_id || null,
            department: userData.department || null,
            verification_token: verificationToken,
            is_verified: true  // Auto-verify for testing (TODO: Change to false in production)
        });
        
        return { user, verificationToken };
    }
    
    // Find user by email
    static async findByEmail(email) {
        return await db.getOne(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
    }
    
    // Find user by ID
    static async findById(id) {
        return await db.getOne(
            'SELECT id, email, full_name, phone, role, university, student_id, department, is_verified, avatar_url, created_at, last_login FROM users WHERE id = $1',
            [id]
        );
    }
    
    // Find user by ID with password (for password verification)
    static async findByIdWithPassword(id) {
        return await db.getOne(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );
    }
    
    // Get all users (for admin) - Only active/verified users
    static async findAll(filters = {}) {
        let query = 'SELECT id, email, full_name, phone, role, university, is_verified, created_at, last_login FROM users WHERE is_verified = TRUE';
        const params = [];
        let paramCount = 1;
        
        if (filters.role) {
            query += ` AND role = $${paramCount}`;
            params.push(filters.role);
            paramCount++;
        }
        
        if (filters.university) {
            query += ` AND university = $${paramCount}`;
            params.push(filters.university);
            paramCount++;
        }
        
        if (filters.is_verified !== undefined) {
            query += ` AND is_verified = $${paramCount}`;
            params.push(filters.is_verified);
            paramCount++;
        }
        
        if (filters.search) {
            query += ` AND (full_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
            params.push(`%${filters.search}%`);
            paramCount++;
        }
        
        query += ' ORDER BY created_at DESC';
        
        // Pagination
        const limit = filters.limit || 50;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        return await db.getMany(query, params);
    }
    
    // Count users by role
    static async countByRole(role = null) {
        if (role) {
            return await db.count('users', 'role = $1', [role]);
        }
        return await db.count('users');
    }
    
    // Verify password
    static async verifyPassword(inputPassword, hashedPassword) {
        return await bcrypt.compare(inputPassword, hashedPassword);
    }
    
    // Generate JWT token
    static generateToken(userId) {
        return jwt.sign(
            { userId },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '7d' }
        );
    }
    
    // Verify JWT token
    static verifyToken(token) {
        try {
            return jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return null;
        }
    }
    
    // Verify email
    static async verifyEmail(token) {
        const user = await db.getOne(
            'SELECT id, email FROM users WHERE verification_token = $1',
            [token]
        );
        
        if (!user) return null;
        
        await db.query(
            'UPDATE users SET is_verified = TRUE, verification_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );
        
        return user;
    }
    
    // Resend verification email
    static async resendVerification(email) {
        const user = await User.findByEmail(email);
        
        if (!user) {
            throw new Error('User not found');
        }
        
        if (user.is_verified) {
            throw new Error('Email already verified');
        }
        
        // Generate new token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        await db.query(
            'UPDATE users SET verification_token = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [verificationToken, user.id]
        );
        
        return { user, verificationToken };
    }
    
    // Update user profile
    static async updateProfile(userId, updates) {
        const allowedFields = ['full_name', 'phone', 'university', 'student_id', 'department', 'avatar_url'];
        const filteredUpdates = {};
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                filteredUpdates[field] = updates[field];
            }
        }
        
        if (Object.keys(filteredUpdates).length === 0) {
            throw new Error('No valid fields to update');
        }
        
        return await db.updateOne('users', userId, filteredUpdates);
    }
    
    // Change password
    static async changePassword(userId, currentPassword, newPassword) {
        const user = await db.getOne(
            'SELECT password_hash FROM users WHERE id = $1',
            [userId]
        );
        
        if (!user) {
            throw new Error('User not found');
        }
        
        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) {
            throw new Error('Current password is incorrect');
        }
        
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(newPassword, salt);
        
        await db.query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newHash, userId]
        );
        
        return true;
    }
    
    // Generate password reset token
    static async generatePasswordResetToken(email) {
        const user = await User.findByEmail(email);
        if (!user) return null;
        
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
        
        await db.query(
            'UPDATE users SET reset_token = $1, reset_token_expiry = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [resetToken, resetTokenExpiry, user.id]
        );
        
        return resetToken;
    }
    
    // Reset password with token
    static async resetPassword(token, newPassword) {
        const user = await db.getOne(
            'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > CURRENT_TIMESTAMP',
            [token]
        );
        
        if (!user) {
            throw new Error('Invalid or expired reset token');
        }
        
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);
        
        await db.query(
            'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [passwordHash, user.id]
        );
        
        return true;
    }
    
    // Update last login
    static async updateLastLogin(userId) {
        await db.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [userId]
        );
    }
    
    // Check if email exists
    static async emailExists(email) {
        return await db.exists('users', 'email = $1', [email.toLowerCase()]);
    }
    
    // Ban/suspend user (super admin)
    static async banUser(userId) {
        // You might want to add a 'status' column to users table
        // For now, we'll just set is_verified to false
        await db.query(
            'UPDATE users SET is_verified = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [userId]
        );
        return true;
    }
    
    // Delete user account
    static async deleteAccount(userId) {
        return await db.deleteOne('users', userId);
    }
    
    // Get user statistics
    static async getStatistics() {
        const stats = await db.getOne(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN role = 'student' THEN 1 END) as total_students,
                COUNT(CASE WHEN role = 'club_admin' THEN 1 END) as total_club_admins,
                COUNT(CASE WHEN is_verified = TRUE THEN 1 END) as verified_users,
                COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as new_users_30d,
                COUNT(CASE WHEN last_login > NOW() - INTERVAL '7 days' THEN 1 END) as active_users_7d
            FROM users
        `);
        
        return stats;
    }
}

module.exports = User;