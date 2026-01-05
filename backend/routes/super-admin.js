// backend/routes/super-admin.js
// Super admin routes for platform-wide management and moderation.
// GLOBAL REFERENCE: API Endpoints → /api/super-admin/*
// PURPOSE: Complete platform administration and oversight.

const express = require('express');
const router = express.Router();
const Club = require('../models/clubModel');
const User = require('../models/userModel');
const Product = require('../models/productModel');
const Competition = require('../models/competitionModel');
const Order = require('../models/orderModel');
const Reward = require('../models/rewardModel');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { sendClubApproved, sendClubRejected } = require('../config/email');
const db = require('../config/database');

// Public stats endpoint (no auth required) - must be BEFORE the auth middleware
router.get('/stats', asyncHandler(async (req, res) => {
    const stats = await db.getOne(`
        SELECT 
            (SELECT COUNT(*) FROM clubs WHERE status = 'approved') as total_clubs,
            (SELECT COUNT(*) FROM products WHERE status = 'active') as total_products,
            (SELECT COUNT(*) FROM competitions WHERE status = 'active') as total_competitions,
            (SELECT COUNT(*) FROM users WHERE role = 'student') as total_students
    `);
    
    res.json({
        success: true,
        totalClubs: parseInt(stats.total_clubs) || 0,
        totalProducts: parseInt(stats.total_products) || 0,
        totalCompetitions: parseInt(stats.total_competitions) || 0,
        totalStudents: parseInt(stats.total_students) || 0
    });
}));

// All routes below require super_admin role
router.use(authenticate, authorize('super_admin'));

// @route   GET /api/super-admin/dashboard
// @desc    Get super admin dashboard stats
// @access  Private (Super Admin)
router.get('/dashboard', asyncHandler(async (req, res) => {
    const stats = await db.getOne(`
        SELECT 
            (SELECT COUNT(*) FROM users WHERE is_verified = TRUE) as total_users,
            (SELECT COUNT(*) FROM users WHERE role = 'student' AND is_verified = TRUE) as total_students,
            (SELECT COUNT(*) FROM users WHERE role = 'club_admin' AND is_verified = TRUE) as total_club_admins,
            (SELECT COUNT(*) FROM clubs WHERE status = 'approved') as active_clubs,
            (SELECT COUNT(*) FROM clubs WHERE status = 'pending') as pending_clubs,
            (SELECT COUNT(*) FROM products WHERE status = 'active') as total_products,
            (SELECT COUNT(*) FROM competitions WHERE status = 'active') as total_competitions,
            (SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURRENT_DATE) as orders_today,
            (SELECT COUNT(*) FROM orders) as total_orders,
            (SELECT COALESCE(SUM(grand_total), 0) FROM orders WHERE order_status = 'delivered') as total_sales,
            (SELECT COALESCE(SUM(grand_total * 0.05), 0) FROM orders WHERE order_status = 'delivered' AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', CURRENT_DATE)) as revenue_this_month
    `);
    
    // Get recent activity
    const recentActivity = await db.getMany(`
        SELECT 
            al.*,
            u.full_name as user_name,
            u.role as user_role
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ORDER BY al.created_at DESC
        LIMIT 10
    `);
    
    // Get platform growth (last 30 days)
    const growth = await db.getOne(`
        SELECT 
            COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as new_users_30d,
            COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as new_users_7d
        FROM users
    `);
    
    res.json({
        success: true,
        data: {
            statistics: stats,
            growth,
            recent_activity: recentActivity
        }
    });
}));

// ============= CLUB MANAGEMENT =============

// @route   GET /api/super-admin/clubs/pending
// @desc    Get pending club applications
// @access  Private (Super Admin)
router.get('/clubs/pending', asyncHandler(async (req, res) => {
    const clubs = await db.getMany(`
        SELECT 
            c.id,
            c.user_id,
            c.club_name,
            c.slug,
            c.university,
            c.established_year,
            c.description,
            c.logo_url,
            c.certificate_url,
            c.facebook_url,
            c.instagram_url,
            c.website_url,
            c.contact_email,
            c.status,
            c.created_at,
            c.updated_at,
            u.email as user_email,
            u.full_name as user_name,
            u.full_name as admin_name,
            u.phone as user_phone
        FROM clubs c
        JOIN users u ON c.user_id = u.id
        WHERE c.status = 'pending'
        ORDER BY c.created_at ASC
    `);
    
    res.json({
        success: true,
        pending: clubs,
        data: clubs
    });
}));
// @route   DELETE /api/super-admin/clubs/:id
// @desc    Delete club
// @access  Private (Super Admin)
router.delete('/clubs/:id', asyncHandler(async (req, res) => {
    // Check if club exists
    const club = await Club.findById(req.params.id);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    // Delete club and associated data
    await db.query('DELETE FROM clubs WHERE id = $1', [req.params.id]);
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'club_deleted', `Deleted club: ${club.club_name} (ID: ${req.params.id})`]
    );
    
    res.json({
        success: true,
        message: 'Club deleted successfully'
    });
}));

// @route   GET /api/super-admin/clubs/applications
// @desc    Get pending club applications (alias)
// @access  Private (Super Admin)
router.get('/clubs/applications', asyncHandler(async (req, res) => {
    const clubs = await db.getMany(`
        SELECT 
            c.*,
            u.email as user_email,
            u.full_name as user_name,
            u.phone as user_phone
        FROM clubs c
        JOIN users u ON c.user_id = u.id
        WHERE c.status = 'pending'
        ORDER BY c.created_at ASC
    `);
    
    res.json({
        success: true,
        data: clubs
    });
}));
// @route   PUT /api/super-admin/clubs/:id/activate
// @desc    Activate/Unsuspend club
// @access  Private (Super Admin)
router.put('/clubs/:id/activate', asyncHandler(async (req, res) => {
    // Check if club exists
    const club = await Club.findById(req.params.id);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    // Update club status to approved
    await db.query(
        'UPDATE clubs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['approved', req.params.id]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'club_activated', `Activated club: ${club.club_name} (ID: ${req.params.id})`]
    );
    
    res.json({
        success: true,
        message: 'Club activated successfully'
    });
}));
// @route   PUT /api/super-admin/clubs/:id/approve
// @desc    Approve club application
// @access  Private (Super Admin)
router.put('/clubs/:id/approve', asyncHandler(async (req, res) => {
    const club = await Club.findById(req.params.id);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    if (club.status !== 'pending') {
        return res.status(400).json({
            success: false,
            message: 'Club is not in pending status'
        });
    }
    
    // Allow multiple clubs with same name - skip duplicate check
    
    await Club.approve(req.params.id);
    
    // Get user info
    const user = await User.findById(club.user_id);
    
    // Send approval email
    try {
        await sendClubApproved(club, user);
    } catch (emailError) {
        console.error('Approval email failed:', emailError);
    }
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'club_approved', `Approved club: ${club.club_name}`]
    );
    
    res.json({
        success: true,
        message: 'Club approved successfully'
    });
}));

// @route   PUT /api/super-admin/clubs/:id/reject
// @desc    Reject club application
// @access  Private (Super Admin)
router.put('/clubs/:id/reject', asyncHandler(async (req, res) => {
    const { reason } = req.body;
    
    if (!reason) {
        return res.status(400).json({
            success: false,
            message: 'Rejection reason is required'
        });
    }
    
    const club = await Club.findById(req.params.id);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    await Club.reject(req.params.id);
    
    // Get user info
    const user = await User.findById(club.user_id);
    
    // Send rejection email
    try {
        await sendClubRejected(club, user, reason);
    } catch (emailError) {
        console.error('Rejection email failed:', emailError);
    }
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'club_rejected', `Rejected club: ${club.club_name} - Reason: ${reason}`]
    );
    
    res.json({
        success: true,
        message: 'Club application rejected'
    });
}));

// @route   DELETE /api/super-admin/clubs/:id/delete-application
// @desc    Delete club application (rejected only)
// @access  Private (Super Admin)
router.delete('/clubs/:id/delete-application', asyncHandler(async (req, res) => {
    const club = await Club.findById(req.params.id);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    // Only allow deletion of rejected applications
    if (club.status !== 'rejected') {
        return res.status(400).json({
            success: false,
            message: 'Can only delete rejected applications'
        });
    }
    
    // Delete the club and associated user account
    await db.query('DELETE FROM clubs WHERE id = $1', [req.params.id]);
    await db.query('DELETE FROM users WHERE id = $1', [club.user_id]);
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'club_application_deleted', `Deleted rejected application: ${club.club_name}`]
    );
    
    res.json({
        success: true,
        message: 'Club application deleted successfully'
    });
}));

// @route   GET /api/super-admin/clubs
// @desc    Get all clubs
// @access  Private (Super Admin)
router.get('/clubs', asyncHandler(async (req, res) => {
    const filters = {
        status: req.query.status,
        university: req.query.university,
        tier: req.query.tier,
        search: req.query.search,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
    };
    
    const clubs = await Club.findAll(filters);
    const totalCount = await Club.count(filters);
    
    // Get stats for all clubs (not filtered)
    const statsQuery = await db.getOne(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended,
            COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
        FROM clubs
    `);
    
    res.json({
        success: true,
        clubs: clubs,
        stats: {
            total: parseInt(statsQuery.total) || 0,
            approved: parseInt(statsQuery.approved) || 0,
            pending: parseInt(statsQuery.pending) || 0,
            suspended: parseInt(statsQuery.suspended) || 0,
            rejected: parseInt(statsQuery.rejected) || 0
        },
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / filters.limit)
        }
    });
}));

// @route   PUT /api/super-admin/clubs/:id/suspend
// @desc    Suspend club
// @access  Private (Super Admin)
router.put('/clubs/:id/suspend', asyncHandler(async (req, res) => {
    const { reason } = req.body;
    
    // Check if club exists
    const club = await Club.findById(req.params.id);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    // Update club status to suspended
    await db.query(
        'UPDATE clubs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['suspended', req.params.id]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'club_suspended', `Suspended club: ${club.club_name} (ID: ${req.params.id}) - Reason: ${reason || 'Not specified'}`]
    );
    
    res.json({
        success: true,
        message: 'Club suspended successfully'
    });
}));

// @route   GET /api/super-admin/clubs/:id
// @desc    Get club details
// @access  Private (Super Admin)
router.get('/clubs/:id', asyncHandler(async (req, res) => {
    const club = await Club.findById(req.params.id);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    const stats = await Club.getStatistics(club.id);
    const rewardHistory = await Reward.getHistory(club.id, { limit: 20 });
    
    res.json({
        success: true,
        data: {
            ...club,
            statistics: stats,
            reward_history: rewardHistory
        }
    });
}));

// ============= USER MANAGEMENT =============

// @route   GET /api/super-admin/users
// @desc    Get all users
// @access  Private (Super Admin)
router.get('/users', asyncHandler(async (req, res) => {
    const filters = {
        role: req.query.role,
        search: req.query.search,
        is_verified: req.query.is_verified,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
    };
    
    const users = await User.findAll(filters);
    const totalCount = await User.countByRole(filters.role);
    
    // Get stats for all ACTIVE users only (exclude deleted/banned)
    const statsQuery = await db.getOne(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN role = 'student' THEN 1 END) as students,
            COUNT(CASE WHEN role = 'club_admin' THEN 1 END) as club_admins,
            COUNT(CASE WHEN role = 'super_admin' THEN 1 END) as super_admins
        FROM users
        WHERE is_verified = TRUE
    `);
    
    res.json({
        success: true,
        users: users,
        stats: {
            total: parseInt(statsQuery.total) || 0,
            students: parseInt(statsQuery.students) || 0,
            club_admins: parseInt(statsQuery.club_admins) || 0,
            super_admins: parseInt(statsQuery.super_admins) || 0
        },
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / filters.limit)
        }
    });
}));

// @route   GET /api/super-admin/users/:id
// @desc    Get user details
// @access  Private (Super Admin)
router.get('/users/:id', asyncHandler(async (req, res) => {
    // Get full user data including all fields
    const user = await db.getOne(`
        SELECT 
            id, email, full_name, phone, role, university, student_id, 
            department, is_verified, avatar_url, created_at, last_login
        FROM users 
        WHERE id = $1
    `, [req.params.id]);
    
    if (!user) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }
    
    // Get user's club if club_admin
    let club = null;
    let clubName = null;
    if (user.role === 'club_admin') {
        club = await db.getOne(
            'SELECT id, club_name, slug, logo_url, status FROM clubs WHERE user_id = $1',
            [user.id]
        );
        if (club) {
            clubName = club.club_name;
        }
    }
    
    // Get activity stats
    const activityStats = await db.getOne(`
        SELECT 
            (SELECT COUNT(*) FROM orders WHERE user_id = $1) as orders,
            (SELECT COUNT(*) FROM competition_registrations WHERE user_id = $1) as competitions,
            (SELECT COUNT(*) FROM reviews WHERE user_id = $1) as reviews
    `, [user.id]);
    
    // Get recent activity
    const recentActivity = await db.getMany(`
        SELECT action_type, description, created_at
        FROM activity_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 10
    `, [user.id]);
    
    res.json({
        success: true,
        ...user,
        club_name: clubName,
        activity_stats: activityStats,
        recent_activity: recentActivity,
        is_suspended: false // Default to false if column doesn't exist
    });
}));

// @route   PUT /api/super-admin/users/:id/ban
// @desc    Ban user
// @access  Private (Super Admin)
router.put('/users/:id/ban', asyncHandler(async (req, res) => {
    const { reason } = req.body;
    
    await User.banUser(req.params.id);
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'user_banned', `Banned user ID: ${req.params.id} - Reason: ${reason || 'Not specified'}`]
    );
    
    res.json({
        success: true,
        message: 'User banned successfully'
    });
}));

// @route   PUT /api/super-admin/users/:id/unban
// @desc    Unban user
// @access  Private (Super Admin)
router.put('/users/:id/unban', asyncHandler(async (req, res) => {
    await db.query(
        'UPDATE users SET is_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [req.params.id]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'user_unbanned', `Unbanned user ID: ${req.params.id}`]
    );
    
    res.json({
        success: true,
        message: 'User unbanned successfully'
    });
}));
// @route   DELETE /api/super-admin/users/:id
// @desc    Permanently delete user
// @access  Private (Super Admin)
router.delete('/users/:id', asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    
    if (!user) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }
    
    // Prevent deleting yourself
    if (user.id === req.user.id) {
        return res.status(400).json({
            success: false,
            message: 'Cannot delete your own account'
        });
    }
    
    // If user is club admin, delete their club first
    if (user.role === 'club_admin') {
        await db.query('DELETE FROM clubs WHERE user_id = $1', [req.params.id]);
    }
    
    // Delete user (cascading deletes will handle related records)
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'user_deleted', `Permanently deleted user: ${user.full_name} (${user.email})`]
    );
    
    res.json({
        success: true,
        message: 'User deleted permanently'
    });
}));
// ============= PRODUCT MODERATION =============

// @route   GET /api/super-admin/products
// @desc    Get all products
// @access  Private (Super Admin)
router.get('/products', asyncHandler(async (req, res) => {
    const filters = {
        status: req.query.status,
        category: req.query.category,
        club_id: req.query.club_id,
        search: req.query.search,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
    };
    
    const products = await Product.findAll(filters);
    const totalCount = await Product.count(filters);
    
    // Get stats
    const statsQuery = await db.getOne(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
            COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended,
            0 as reported
        FROM products
    `);
    
    res.json({
        success: true,
        products: products,
        data: products,
        stats: {
            total: parseInt(statsQuery.total) || 0,
            active: parseInt(statsQuery.active) || 0,
            suspended: parseInt(statsQuery.suspended) || 0,
            reported: parseInt(statsQuery.reported) || 0
        },
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / filters.limit)
        }
    });
}));

// @route   PUT /api/super-admin/products/:id/suspend
// @desc    Suspend product
// @access  Private (Super Admin)
router.put('/products/:id/suspend', asyncHandler(async (req, res) => {
    const { reason } = req.body;
    
    await db.query(
        'UPDATE products SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['suspended', req.params.id]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'product_suspended', `Suspended product ID: ${req.params.id} - Reason: ${reason || 'Not specified'}`]
    );
    
    res.json({
        success: true,
        message: 'Product suspended successfully'
    });
}));

// @route   PUT /api/super-admin/products/:id/unsuspend
// @desc    Unsuspend product
// @access  Private (Super Admin)
router.put('/products/:id/unsuspend', asyncHandler(async (req, res) => {
    await db.query(
        'UPDATE products SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['active', req.params.id]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'product_unsuspended', `Unsuspended product ID: ${req.params.id}`]
    );
    
    res.json({
        success: true,
        message: 'Product unsuspended successfully'
    });
}));

// @route   DELETE /api/super-admin/products/:id
// @desc    Delete product
// @access  Private (Super Admin)
router.delete('/products/:id', asyncHandler(async (req, res) => {
    await Product.delete(req.params.id);
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'product_deleted', `Deleted product ID: ${req.params.id}`]
    );
    
    res.json({
        success: true,
        message: 'Product deleted successfully'
    });
}));

// ============= COMPETITION MODERATION =============

// @route   GET /api/super-admin/competitions
// @desc    Get all competitions
// @access  Private (Super Admin)
router.get('/competitions', asyncHandler(async (req, res) => {
    const filters = {
        status: req.query.status,
        category: req.query.category,
        club_id: req.query.club_id,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
    };
    
    // Build query
    let query = `
        SELECT 
            c.*,
            cl.club_name,
            cl.slug as club_slug,
            cl.logo_url as club_logo
        FROM competitions c
        LEFT JOIN clubs cl ON c.club_id = cl.id
        WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (filters.status) {
        query += ` AND c.status = $${paramCount}`;
        params.push(filters.status);
        paramCount++;
    }
    
    if (filters.category) {
        query += ` AND c.category = $${paramCount}`;
        params.push(filters.category);
        paramCount++;
    }
    
    if (filters.club_id) {
        query += ` AND c.club_id = $${paramCount}`;
        params.push(filters.club_id);
        paramCount++;
    }
    
    query += ' ORDER BY c.created_at DESC';
    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(filters.limit, (filters.page - 1) * filters.limit);
    
    const competitions = await db.getMany(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM competitions c WHERE 1=1';
    const countParams = [];
    let countParamCount = 1;
    
    if (filters.status) {
        countQuery += ` AND c.status = $${countParamCount}`;
        countParams.push(filters.status);
        countParamCount++;
    }
    
    if (filters.category) {
        countQuery += ` AND c.category = $${countParamCount}`;
        countParams.push(filters.category);
        countParamCount++;
    }
    
    if (filters.club_id) {
        countQuery += ` AND c.club_id = $${countParamCount}`;
        countParams.push(filters.club_id);
        countParamCount++;
    }
    
    const totalCount = await db.getOne(countQuery, countParams);
    
    res.json({
        success: true,
        data: competitions,
        competitions: competitions,
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: parseInt(totalCount.count),
            totalPages: Math.ceil(totalCount.count / filters.limit)
        }
    });
}));

// @route   PUT /api/super-admin/competitions/:id/feature
// @desc    Set competition as featured
// @access  Private (Super Admin)
router.put('/competitions/:id/feature', asyncHandler(async (req, res) => {
    const { is_featured } = req.body;
    
    await Competition.setFeatured(req.params.id, is_featured);
    
    res.json({
        success: true,
        message: `Competition ${is_featured ? 'featured' : 'unfeatured'} successfully`
    });
}));

// @route   PUT /api/super-admin/competitions/:id/suspend
// @desc    Suspend competition
// @access  Private (Super Admin)
router.put('/competitions/:id/suspend', asyncHandler(async (req, res) => {
    const { reason, notify_club } = req.body;
    
    await db.query(
        'UPDATE competitions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['suspended', req.params.id]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'competition_suspended', `Suspended competition ID: ${req.params.id} - Reason: ${reason || 'Not specified'}`]
    );
    
    res.json({
        success: true,
        message: 'Competition suspended successfully'
    });
}));

// @route   PUT /api/super-admin/competitions/:id/unsuspend
// @desc    Unsuspend competition
// @access  Private (Super Admin)
router.put('/competitions/:id/unsuspend', asyncHandler(async (req, res) => {
    await db.query(
        'UPDATE competitions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['active', req.params.id]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'competition_unsuspended', `Unsuspended competition ID: ${req.params.id}`]
    );
    
    res.json({
        success: true,
        message: 'Competition unsuspended successfully'
    });
}));

// @route   DELETE /api/super-admin/competitions/:id
// @desc    Delete competition
// @access  Private (Super Admin)
router.delete('/competitions/:id', asyncHandler(async (req, res) => {
    await Competition.delete(req.params.id);
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'competition_deleted', `Deleted competition ID: ${req.params.id}`]
    );
    
    res.json({
        success: true,
        message: 'Competition deleted successfully'
    });
}));

// ============= ORDERS OVERVIEW =============

// @route   GET /api/super-admin/orders
// @desc    Get all orders
// @access  Private (Super Admin)
router.get('/orders', asyncHandler(async (req, res) => {
    const filters = {
        status: req.query.status,
        payment_status: req.query.payment_status,
        search: req.query.search,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
    };
    
    // Get all orders with items
    let query = `
        SELECT 
            o.id,
            o.order_number,
            o.user_id,
            o.total_amount,
            o.shipping_cost,
            o.grand_total,
            o.payment_method,
            o.payment_screenshot_url,
            o.transaction_id,
            o.payment_status,
            o.order_status,
            o.delivery_name,
            o.delivery_phone,
            o.delivery_address,
            o.delivery_city,
            o.delivery_district,
            o.delivery_division,
            o.delivery_postal_code,
            o.created_at,
            o.updated_at,
            u.full_name as customer_name,
            u.email as customer_email,
            u.phone as customer_phone
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (filters.status) {
        query += ` AND o.order_status = $${paramCount}`;
        params.push(filters.status);
        paramCount++;
    }
    
    if (filters.payment_status) {
        query += ` AND o.payment_status = $${paramCount}`;
        params.push(filters.payment_status);
        paramCount++;
    }
    
    if (filters.search) {
        query += ` AND (o.order_number ILIKE $${paramCount} OR u.full_name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`;
        params.push(`%${filters.search}%`);
        paramCount++;
    }
    
    query += ' ORDER BY o.created_at DESC';
    
    const orders = await db.getMany(query, params);
    
    // Get items for each order
    for (let order of orders) {
        const items = await db.getMany(`
            SELECT 
                oi.*,
                c.club_name,
                c.slug as club_slug
            FROM order_items oi
            LEFT JOIN clubs c ON oi.club_id = c.id
            WHERE oi.order_id = $1
        `, [order.id]);
        order.items = items;
    }
    
    // Get stats
    const stats = await db.getOne(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 END) as today,
            COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN grand_total ELSE 0 END), 0) as today_value,
            COUNT(CASE WHEN order_status IN ('pending', 'confirmed') THEN 1 END) as pending,
            0 as disputed
        FROM orders
    `);
    
    res.json({
        success: true,
        orders: orders,
        stats: {
            total: parseInt(stats.total) || 0,
            today: parseInt(stats.today) || 0,
            today_value: parseFloat(stats.today_value) || 0,
            pending: parseInt(stats.pending) || 0,
            disputed: parseInt(stats.disputed) || 0
        },
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: orders.length,
            totalPages: Math.ceil(orders.length / filters.limit)
        }
    });
}));

// @route   GET /api/super-admin/orders/:id
// @desc    Get order details
// @access  Private (Super Admin)
router.get('/orders/:id', asyncHandler(async (req, res) => {
    // Get order with customer info
    const order = await db.getOne(`
        SELECT 
            o.*,
            u.full_name as customer_name,
            u.email as customer_email,
            u.phone as customer_phone
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.id = $1
    `, [req.params.id]);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: 'Order not found'
        });
    }
    
    // Get order items with club info
    const items = await db.getMany(`
        SELECT 
            oi.*,
            c.club_name,
            c.slug as club_slug
        FROM order_items oi
        LEFT JOIN clubs c ON oi.club_id = c.id
        WHERE oi.order_id = $1
    `, [req.params.id]);
    
    order.items = items;
    
    res.json({
        success: true,
        data: order
    });
}));

// ============= FINANCIAL MANAGEMENT =============

// @route   GET /api/super-admin/financials/overview
// @desc    Get financial overview
// @access  Private (Super Admin)
router.get('/financials/overview', asyncHandler(async (req, res) => {
    const overview = await db.getOne(`
        SELECT 
            COALESCE(SUM(grand_total), 0) as total_sales,
            COALESCE(SUM(grand_total * 0.05), 0) as total_commission,
            COALESCE(SUM(CASE WHEN DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', CURRENT_DATE) THEN grand_total * 0.05 ELSE 0 END), 0) as commission_this_month,
            COALESCE(SUM(CASE WHEN DATE_TRUNC('year', updated_at) = DATE_TRUNC('year', CURRENT_DATE) THEN grand_total * 0.05 ELSE 0 END), 0) as commission_this_year,
            COUNT(*) as total_orders_delivered
        FROM orders
        WHERE order_status = 'delivered'
    `);
    
    // Club earnings breakdown
    const clubEarnings = await db.getMany(`
        SELECT 
            c.club_name,
            c.reward_tier,
            COUNT(DISTINCT o.id) as order_count,
            COALESCE(SUM(oi.subtotal), 0) as total_revenue
        FROM clubs c
        JOIN order_items oi ON c.id = oi.club_id
        JOIN orders o ON oi.order_id = o.id
        WHERE o.order_status = 'delivered'
        GROUP BY c.id, c.club_name, c.reward_tier
        ORDER BY total_revenue DESC
        LIMIT 10
    `);
    
    res.json({
        success: true,
        data: {
            overview,
            top_earning_clubs: clubEarnings
        }
    });
}));

// @route   GET /api/super-admin/financials/transactions
// @desc    Get commission transactions
// @access  Private (Super Admin)
router.get('/financials/transactions', asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const transactions = await db.getMany(`
        SELECT 
            o.order_number,
            o.created_at,
            o.updated_at as delivered_at,
            o.grand_total,
            o.grand_total * 0.05 as commission,
            u.full_name as customer_name,
            COUNT(oi.id) as item_count
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.order_status = 'delivered'
        GROUP BY o.id, o.order_number, o.created_at, o.updated_at, o.grand_total, u.full_name
        ORDER BY o.updated_at DESC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    const totalCount = await db.getOne(
        "SELECT COUNT(*) FROM orders WHERE order_status = 'delivered'"
    );
    
    res.json({
        success: true,
        data: transactions,
        pagination: {
            page,
            limit,
            total: parseInt(totalCount.count),
            totalPages: Math.ceil(totalCount.count / limit)
        }
    });
}));

// ============= REWARD SYSTEM =============

// @route   POST /api/super-admin/rewards/adjust
// @desc    Manually adjust club reward points
// @access  Private (Super Admin)
router.post('/rewards/adjust', asyncHandler(async (req, res) => {
    const { club_id, points, reason } = req.body;
    
    if (!club_id || !points || !reason) {
        return res.status(400).json({
            success: false,
            message: 'Club ID, points, and reason are required'
        });
    }
    
    await Reward.manualAdjustment(club_id, parseInt(points), reason, req.user.id);
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'reward_adjusted', `Adjusted ${points} points for club ID: ${club_id} - Reason: ${reason}`]
    );
    
    res.json({
        success: true,
        message: 'Reward points adjusted successfully'
    });
}));

// @route   GET /api/super-admin/rewards/statistics
// @desc    Get reward system statistics
// @access  Private (Super Admin)
router.get('/rewards/statistics', asyncHandler(async (req, res) => {
    const stats = await Reward.getPlatformStatistics();
    
    res.json({
        success: true,
        data: stats
    });
}));

// ============= ACTIVITY LOGS =============

// @route   GET /api/super-admin/activity-logs
// @desc    Get activity logs
// @access  Private (Super Admin)
router.get('/activity-logs', asyncHandler(async (req, res) => {
    let query = `
        SELECT 
            al.*,
            u.full_name as user_name,
            u.email as user_email,
            u.role as user_role
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (req.query.action_type) {
        query += ` AND al.action_type = $${paramCount}`;
        params.push(req.query.action_type);
        paramCount++;
    }
    
    if (req.query.user_id) {
        query += ` AND al.user_id = $${paramCount}`;
        params.push(req.query.user_id);
        paramCount++;
    }
    
    if (req.query.date_from) {
        query += ` AND al.created_at >= $${paramCount}`;
        params.push(req.query.date_from);
        paramCount++;
    }
    
    query += ' ORDER BY al.created_at DESC LIMIT 100';
    
    const logs = await db.getMany(query, params);
    
    res.json({
        success: true,
        data: logs
    });
}));

// ============= PLATFORM SETTINGS =============

// @route   GET /api/super-admin/settings
// @desc    Get platform settings
// @access  Private (Super Admin)
router.get('/settings', asyncHandler(async (req, res) => {
    const settings = await db.getMany('SELECT * FROM platform_settings ORDER BY setting_key');
    
    // Convert to key-value object
    const settingsObj = {};
    settings.forEach(setting => {
        settingsObj[setting.setting_key] = typeof setting.setting_value === 'string' 
            ? JSON.parse(setting.setting_value) 
            : setting.setting_value;
    });
    
    res.json({
        success: true,
        data: settingsObj
    });
}));

// @route   PUT /api/super-admin/settings
// @desc    Update platform settings
// @access  Private (Super Admin)
router.put('/settings', asyncHandler(async (req, res) => {
    const { key, value } = req.body;
    
    if (!key || value === undefined) {
        return res.status(400).json({
            success: false,
            message: 'Key and value are required'
        });
    }
    
    await db.query(
        `INSERT INTO platform_settings (setting_key, setting_value) 
         VALUES ($1, $2) 
         ON CONFLICT (setting_key) 
         DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP`,
        [key, JSON.stringify(value)]
    );
    
    // Log activity
    await db.query(
        'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
        [req.user.id, 'settings_updated', `Updated setting: ${key}`]
    );
    
    res.json({
        success: true,
        message: 'Settings updated successfully'
    });
}));

// ============= ANALYTICS =============

// @route   GET /api/super-admin/analytics/overview
// @desc    Get platform analytics
// @access  Private (Super Admin)
router.get('/analytics/overview', asyncHandler(async (req, res) => {
    // User growth
    const userGrowth = await db.getMany(`
        SELECT 
            DATE_TRUNC('month', created_at) as month,
            COUNT(*) as count
        FROM users
        WHERE created_at > NOW() - INTERVAL '12 months'
        GROUP BY month
        ORDER BY month
    `);
    
    // Sales trends
    const salesTrends = await db.getMany(`
        SELECT 
            DATE_TRUNC('month', created_at) as month,
            COUNT(*) as order_count,
            SUM(grand_total) as revenue
        FROM orders
        WHERE order_status = 'delivered' AND created_at > NOW() - INTERVAL '12 months'
        GROUP BY month
        ORDER BY month
    `);
    
    // Category performance
    const categoryStats = await db.getMany(`
        SELECT 
            p.category,
            COUNT(DISTINCT p.id) as product_count,
            COUNT(DISTINCT oi.order_id) as order_count,
            COALESCE(SUM(oi.subtotal), 0) as revenue
        FROM products p
        LEFT JOIN order_items oi ON p.id = oi.product_id
        LEFT JOIN orders o ON oi.order_id = o.id AND o.order_status = 'delivered'
        GROUP BY p.category
        ORDER BY revenue DESC
    `);
    
    res.json({
        success: true,
        data: {
            user_growth: userGrowth,
            sales_trends: salesTrends,
            category_performance: categoryStats
        }
    });
}));

// ============= ADDITIONAL DASHBOARD ROUTES =============

// @route   GET /api/super-admin/activity-feed
// @desc    Get recent activity feed
// @access  Private (Super Admin)
router.get('/activity-feed', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const activities = await db.getMany(`
        SELECT al.*, u.full_name as user_name, u.role as user_role
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ORDER BY al.created_at DESC
        LIMIT $1
    `, [limit]);
    res.json({ success: true, data: activities });
}));

// @route   GET /api/super-admin/pending-tasks
// @desc    Get pending tasks count
// @access  Private (Super Admin)
router.get('/pending-tasks', asyncHandler(async (req, res) => {
    const pendingClubs = await db.getOne(`SELECT COUNT(*) FROM clubs WHERE status = 'pending'`);
    res.json({ success: true, data: { pending_clubs: parseInt(pendingClubs.count), total_pending: parseInt(pendingClubs.count) } });
}));

// @route   GET /api/super-admin/top-clubs
// @desc    Get top performing clubs
// @access  Private (Super Admin)
router.get('/top-clubs', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 5;
    const clubs = await db.getMany(`
        SELECT id, club_name, logo_url, reward_tier, reward_points, total_sales, average_rating
        FROM clubs WHERE status = 'approved' ORDER BY reward_points DESC LIMIT $1
    `, [limit]);
    res.json({ success: true, data: clubs });
}));

// @route   GET /api/super-admin/system-health
// @desc    Get system health status
// @access  Private (Super Admin)
router.get('/system-health', asyncHandler(async (req, res) => {
    const dbHealth = await db.query('SELECT NOW()').then(() => 'healthy').catch(() => 'unhealthy');
    res.json({ success: true, data: { database: dbHealth, server: 'healthy', uptime: Math.floor(process.uptime()), memory: process.memoryUsage() } });
}));

// @route   GET /api/super-admin/settings/commission
// @desc    Get commission settings
// @access  Private (Super Admin)
router.get('/settings/commission', asyncHandler(async (req, res) => {
    const setting = await db.getOne(`SELECT setting_value FROM platform_settings WHERE setting_key = 'commission_rates'`);
    const settings = setting ? (typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value) : { bronze: 5, silver: 3, gold: 2, platinum: 1 };
    res.json({ success: true, settings: settings });
}));

// @route   PUT /api/super-admin/settings/commission
// @desc    Update commission settings
// @access  Private (Super Admin)
router.put('/settings/commission', asyncHandler(async (req, res) => {
    const { settings } = req.body;
    await db.query(`INSERT INTO platform_settings (setting_key, setting_value) VALUES ('commission_rates', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP`, [JSON.stringify(settings)]);
    await db.query('INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)', [req.user.id, 'settings_updated', 'Updated commission settings']);
    res.json({ success: true, message: 'Commission settings updated successfully' });
}));

// @route   GET /api/super-admin/financials/pending-payouts
// @desc    Get pending payouts
// @access  Private (Super Admin)
router.get('/financials/pending-payouts', asyncHandler(async (req, res) => {
    const payouts = await db.getMany(`
        WITH club_earnings AS (
            SELECT 
                c.id as club_id,
                c.club_name,
                c.university,
                c.logo_url as club_logo,
                c.total_earnings,
                c.reward_tier,
                COALESCE(SUM(CASE 
                    WHEN oi.status = 'delivered' 
                    AND o.payment_status = 'verified'
                    AND NOT EXISTS (
                        SELECT 1 FROM payouts p2 
                        WHERE p2.club_id = c.id 
                        AND p2.status = 'paid'
                        AND o.updated_at BETWEEN p2.period_start AND p2.period_end
                    )
                    THEN oi.subtotal 
                    ELSE 0 
                END), 0) as gross_amount,
                (SELECT MAX(period_end) FROM payouts WHERE club_id = c.id AND status = 'paid') as last_payout_date,
                COALESCE(
                    (SELECT MAX(period_end) + INTERVAL '1 day' FROM payouts WHERE club_id = c.id AND status = 'paid'),
                    (SELECT MIN(o2.updated_at)::date FROM orders o2 
                     JOIN order_items oi2 ON o2.id = oi2.order_id 
                     WHERE oi2.club_id = c.id AND oi2.status = 'delivered')
                ) as period_start,
                CURRENT_DATE as period_end
            FROM clubs c
            LEFT JOIN order_items oi ON c.id = oi.club_id
            LEFT JOIN orders o ON oi.order_id = o.id
            WHERE c.status = 'approved'
            GROUP BY c.id, c.club_name, c.university, c.logo_url, c.total_earnings, c.reward_tier
        ),
        commission_rates AS (
            SELECT 
                setting_value->>'bronze' as bronze_rate,
                setting_value->>'silver' as silver_rate,
                setting_value->>'gold' as gold_rate,
                setting_value->>'platinum' as platinum_rate
            FROM platform_settings 
            WHERE setting_key = 'commission_rates'
        )
        SELECT 
            ce.club_id,
            ce.club_name,
            ce.university,
            ce.club_logo,
            ce.total_earnings,
            ce.reward_tier,
            ce.gross_amount,
            CASE ce.reward_tier
                WHEN 'bronze' THEN ce.gross_amount * (1 - COALESCE(cr.bronze_rate::decimal, 0.05))
                WHEN 'silver' THEN ce.gross_amount * (1 - COALESCE(cr.silver_rate::decimal, 0.03))
                WHEN 'gold' THEN ce.gross_amount * (1 - COALESCE(cr.gold_rate::decimal, 0.02))
                WHEN 'platinum' THEN ce.gross_amount * (1 - COALESCE(cr.platinum_rate::decimal, 0.01))
                ELSE ce.gross_amount * 0.95
            END as amount_due,
            ce.last_payout_date,
            ce.period_start,
            ce.period_end
        FROM club_earnings ce
        CROSS JOIN commission_rates cr
        WHERE ce.gross_amount > 0
        ORDER BY amount_due DESC
    `);
    res.json({ success: true, payouts: payouts });
}));

// @route   GET /api/super-admin/financials/history
// @desc    Get financial history
// @access  Private (Super Admin)
router.get('/financials/history', asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'all';
    let whereClause = 'WHERE 1=1';
    if (filter === 'pending') whereClause += " AND p.status = 'pending'";
    if (filter === 'paid') whereClause += " AND p.status = 'paid'";
    const history = await db.getMany(`
        SELECT 
            p.*,
            c.club_name,
            c.university,
            c.logo_url as club_logo
        FROM payouts p 
        JOIN clubs c ON p.club_id = c.id 
        ${whereClause} 
        ORDER BY p.created_at DESC 
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const totalCount = await db.getOne(`SELECT COUNT(*) FROM payouts p ${whereClause}`);
    res.json({ success: true, payouts: history, pagination: { page, limit, total: parseInt(totalCount.count), totalPages: Math.ceil(totalCount.count / limit) } });
}));

// @route   GET /api/super-admin/security-alerts
// @desc    Get security alerts
// @access  Private (Super Admin)
router.get('/security-alerts', asyncHandler(async (req, res) => {
    const alerts = await db.getMany(`SELECT * FROM activity_logs WHERE action_type IN ('login_failed', 'user_banned', 'suspicious_activity') ORDER BY created_at DESC LIMIT 50`);
    res.json({ success: true, data: alerts });
}));

// @route   GET /api/super-admin/banned-ips
// @desc    Get banned IPs
// @access  Private (Super Admin)
router.get('/banned-ips', asyncHandler(async (req, res) => {
    res.json({ success: true, data: [] });
}));

// @route   GET /api/super-admin/rewards/config
// @desc    Get rewards configuration
// @access  Private (Super Admin)
router.get('/rewards/config', asyncHandler(async (req, res) => {
    const setting = await db.getOne(`SELECT setting_value FROM platform_settings WHERE setting_key = 'reward_config'`);
    const defaultConfig = { points_per_100_taka: 10, points_competition: 100, points_review: 20, tier_thresholds: { bronze: 0, silver: 500, gold: 1500, platinum: 5000 } };
    res.json({ success: true, data: setting ? (typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value) : defaultConfig });
}));


// @route   GET /api/super-admin/clubs/search
// @desc    Search clubs for reward adjustment
// @access  Private (Super Admin)
router.get('/clubs/search', asyncHandler(async (req, res) => {
    const query = req.query.q;
    
    if (!query || query.length < 2) {
        return res.json({ success: true, clubs: [] });
    }
    
    const clubs = await db.getMany(`
        SELECT 
            id, club_name, slug, university, logo_url, 
            reward_tier, reward_points, status
        FROM clubs
        WHERE status = 'approved'
        AND (
            club_name ILIKE $1 
            OR university ILIKE $1
        )
        ORDER BY reward_points DESC
        LIMIT 10
    `, [`%${query}%`]);
    
    res.json({ success: true, clubs: clubs });
}));

// @route   GET /api/super-admin/rewards/config
// @desc    Get reward system configuration
// @access  Private (Super Admin)
router.get('/rewards/config', asyncHandler(async (req, res) => {
    try {
        // Get reward config from platform_settings
        const rewardSetting = await db.getOne(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'reward_config'`
        );
        
        const commissionSetting = await db.getOne(
            `SELECT setting_value FROM platform_settings WHERE setting_key = 'commission_rates'`
        );
        
        // Parse settings
        let rewardConfig = rewardSetting && rewardSetting.setting_value 
            ? (typeof rewardSetting.setting_value === 'string' ? JSON.parse(rewardSetting.setting_value) : rewardSetting.setting_value)
            : {
                points: {
                    competition_created: 100,
                    per_100_sales: 10,
                    five_star_review: 20,
                    fast_shipping: 5
                },
                tiers: {
                    bronze: { min: 0, max: 499 },
                    silver: { min: 500, max: 1499 },
                    gold: { min: 1500, max: 4999 },
                    platinum: { min: 5000, max: Infinity }
                }
            };
        
        let commissionRates = commissionSetting && commissionSetting.setting_value
            ? (typeof commissionSetting.setting_value === 'string' ? JSON.parse(commissionSetting.setting_value) : commissionSetting.setting_value)
            : { bronze: 5, silver: 3, gold: 2, platinum: 1 };
        
        // Combine into config
        const config = {
            ...rewardConfig,
            benefits: {
                bronze: {
                    commission: parseFloat(commissionRates.bronze) || 5,
                    verified_badge: false,
                    homepage_featuring: false,
                    advanced_analytics: false,
                    revenue_sharing: false,
                    trophy_display: false,
                    free_posts: 0,
                    free_ads: 0
                },
                silver: {
                    commission: parseFloat(commissionRates.silver) || 3,
                    verified_badge: true,
                    homepage_featuring: true,
                    advanced_analytics: false,
                    revenue_sharing: false,
                    trophy_display: false,
                    free_posts: 0,
                    free_ads: 0
                },
                gold: {
                    commission: parseFloat(commissionRates.gold) || 2,
                    verified_badge: true,
                    homepage_featuring: true,
                    advanced_analytics: true,
                    revenue_sharing: false,
                    trophy_display: false,
                    free_posts: 5,
                    free_ads: 0
                },
                platinum: {
                    commission: parseFloat(commissionRates.platinum) || 1,
                    verified_badge: true,
                    homepage_featuring: true,
                    advanced_analytics: true,
                    revenue_sharing: true,
                    trophy_display: true,
                    free_posts: 15,
                    free_ads: 3
                }
            }
        };
        
        res.json({ success: true, config: config });
    } catch (error) {
        console.error('Error loading reward config:', error);
        res.status(500).json({ success: false, message: 'Failed to load reward configuration' });
    }
}));

// @route   PUT /api/super-admin/rewards/config
// @desc    Update reward system configuration
// @access  Private (Super Admin)
router.put('/rewards/config', asyncHandler(async (req, res) => {
    const config = req.body;
    
    if (!config) {
        return res.status(400).json({
            success: false,
            message: 'Configuration data is required'
        });
    }
    
    await db.transaction(async (client) => {
        // Save reward config (points and tiers)
        const rewardConfig = {
            points: config.points,
            tiers: config.tiers
        };
        
        await client.query(
            `INSERT INTO platform_settings (setting_key, setting_value) 
             VALUES ('reward_config', $1) 
             ON CONFLICT (setting_key) 
             DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
            [JSON.stringify(rewardConfig)]
        );
        
        // Save commission rates
        const commissionRates = {
            bronze: config.benefits.bronze.commission,
            silver: config.benefits.silver.commission,
            gold: config.benefits.gold.commission,
            platinum: config.benefits.platinum.commission
        };
        
        await client.query(
            `INSERT INTO platform_settings (setting_key, setting_value) 
             VALUES ('commission_rates', $1) 
             ON CONFLICT (setting_key) 
             DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
            [JSON.stringify(commissionRates)]
        );
        
        // Log activity
        await client.query(
            'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
            [req.user.id, 'reward_config_updated', 'Updated reward system configuration']
        );
    });
    
    res.json({ success: true, message: 'Reward configuration updated successfully' });
}));


// @route   GET /api/super-admin/financials/overview
// @desc    Get financial overview statistics
// @access  Private (Super Admin)
router.get('/financials/overview', asyncHandler(async (req, res) => {
    const overview = await db.getOne(`
        WITH delivered_orders AS (
            SELECT 
                o.id,
                o.grand_total,
                o.created_at,
                o.updated_at,
                oi.subtotal,
                oi.club_id,
                c.reward_tier
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN clubs c ON oi.club_id = c.id
            WHERE o.order_status = 'delivered' 
            AND o.payment_status = 'verified'
            AND oi.status = 'delivered'
        ),
        commission_calc AS (
            SELECT 
                SUM(grand_total) as total_revenue,
                SUM(CASE WHEN DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', CURRENT_DATE) 
                    THEN grand_total ELSE 0 END) as month_revenue,
                SUM(CASE 
                    WHEN reward_tier = 'bronze' THEN subtotal * 0.05
                    WHEN reward_tier = 'silver' THEN subtotal * 0.03
                    WHEN reward_tier = 'gold' THEN subtotal * 0.02
                    WHEN reward_tier = 'platinum' THEN subtotal * 0.01
                    ELSE subtotal * 0.05
                END) as commission_earned,
                COUNT(DISTINCT CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE) 
                    THEN id END) as month_transactions,
                AVG(CASE 
                    WHEN reward_tier = 'bronze' THEN 5.0
                    WHEN reward_tier = 'silver' THEN 3.0
                    WHEN reward_tier = 'gold' THEN 2.0
                    WHEN reward_tier = 'platinum' THEN 1.0
                    ELSE 5.0
                END) as avg_commission_rate
            FROM delivered_orders
        ),
        pending_payouts AS (
            SELECT 
                COALESCE(SUM(CASE 
                    WHEN reward_tier = 'bronze' THEN subtotal * 0.95
                    WHEN reward_tier = 'silver' THEN subtotal * 0.97
                    WHEN reward_tier = 'gold' THEN subtotal * 0.98
                    WHEN reward_tier = 'platinum' THEN subtotal * 0.99
                    ELSE subtotal * 0.95
                END), 0) as total_pending,
                COUNT(DISTINCT club_id) as pending_clubs_count
            FROM delivered_orders
            WHERE NOT EXISTS (
                SELECT 1 FROM payouts p
                WHERE p.club_id = delivered_orders.club_id
                AND p.status = 'paid'
                AND delivered_orders.updated_at BETWEEN p.period_start AND p.period_end
            )
        )
        SELECT 
            COALESCE(cc.total_revenue, 0) as total_revenue,
            COALESCE(cc.month_revenue, 0) as month_revenue,
            COALESCE(cc.commission_earned, 0) as commission_earned,
            COALESCE(pp.total_pending, 0) as payouts_pending,
            COALESCE(cc.month_transactions, 0) as month_transactions,
            ROUND(COALESCE(cc.avg_commission_rate, 5.0), 1) as avg_commission_rate,
            COALESCE(pp.pending_clubs_count, 0) as pending_clubs_count
        FROM commission_calc cc
        CROSS JOIN pending_payouts pp
    `);
    res.json({ success: true, overview: overview });
}));

// @route   POST /api/super-admin/financials/process-payout
// @desc    Process a single payout
// @access  Private (Super Admin)
router.post('/financials/process-payout', asyncHandler(async (req, res) => {
    const { club_id, amount, payment_method, payment_reference, notes } = req.body;
    
    if (!club_id || !amount || !payment_method || !payment_reference) {
        return res.status(400).json({
            success: false,
            message: 'Club ID, amount, payment method, and reference are required'
        });
    }
    
    await db.transaction(async (client) => {
        // Get the actual period for this payout
        const periodResult = await client.query(`
            SELECT 
                COALESCE(
                    (SELECT MAX(period_end) + INTERVAL '1 day' FROM payouts WHERE club_id = $1 AND status = 'paid'),
                    (SELECT MIN(o.updated_at)::date FROM orders o 
                     JOIN order_items oi ON o.id = oi.order_id 
                     WHERE oi.club_id = $1 AND oi.status = 'delivered')
                ) as period_start,
                CURRENT_DATE as period_end
        `, [club_id]);
        
        const period = periodResult.rows[0];
        
        await client.query(`
            INSERT INTO payouts (
                club_id, amount, period_start, period_end, 
                status, payment_method, payment_reference
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [club_id, amount, period.period_start, period.period_end, 'paid', payment_method, payment_reference]);
        
        // Update club's total_earnings to reflect actual paid amount
        await client.query(
            'UPDATE clubs SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [club_id]
        );
        
        await client.query(
            'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
            [req.user.id, 'payout_processed', `Processed payout of ৳${amount} for club ID: ${club_id} via ${payment_method}. Ref: ${payment_reference}`]
        );
    });
    
    res.json({ success: true, message: 'Payout processed successfully' });
}));

// @route   POST /api/super-admin/financials/process-all-payouts
// @desc    Process all pending payouts
// @access  Private (Super Admin)
router.post('/financials/process-all-payouts', asyncHandler(async (req, res) => {
    const pendingPayouts = await db.getMany(`
        SELECT 
            c.id as club_id,
            c.club_name,
            COALESCE(SUM(oi.subtotal), 0) as amount_due
        FROM clubs c
        LEFT JOIN order_items oi ON c.id = oi.club_id
        LEFT JOIN orders o ON oi.order_id = o.id
        WHERE c.status = 'approved' AND oi.status = 'delivered'
        GROUP BY c.id, c.club_name
        HAVING COALESCE(SUM(oi.subtotal), 0) > 0
    `);
    
    let processedCount = 0;
    
    await db.transaction(async (client) => {
        for (const payout of pendingPayouts) {
            await client.query(`
                INSERT INTO payouts (
                    club_id, amount, period_start, period_end, 
                    status, payment_method
                ) VALUES ($1, $2, CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, $3, $4)
            `, [payout.club_id, payout.amount_due, 'pending', 'bank_transfer']);
            processedCount++;
        }
        
        await client.query(
            'INSERT INTO activity_logs (user_id, action_type, description) VALUES ($1, $2, $3)',
            [req.user.id, 'payouts_processed_all', `Initiated ${processedCount} payouts for processing`]
        );
    });
    
    res.json({ success: true, message: `${processedCount} payouts queued for processing`, count: processedCount });
}));
// @route   GET /api/super-admin/analytics
// @desc    Get platform analytics with date range
// @access  Private (Super Admin)
router.get('/analytics', asyncHandler(async (req, res) => {
    const dateFrom = req.query.date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const dateTo = req.query.date_to || new Date().toISOString();
    const userGrowth = await db.getMany(`SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as count FROM users WHERE created_at BETWEEN $1 AND $2 GROUP BY date ORDER BY date`, [dateFrom, dateTo]);
    const salesTrends = await db.getMany(`SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as order_count, COALESCE(SUM(grand_total), 0) as revenue FROM orders WHERE order_status = 'delivered' AND created_at BETWEEN $1 AND $2 GROUP BY date ORDER BY date`, [dateFrom, dateTo]);
    const categoryStats = await db.getMany(`SELECT p.category, COUNT(DISTINCT p.id) as product_count, COUNT(DISTINCT oi.order_id) as order_count, COALESCE(SUM(oi.subtotal), 0) as revenue FROM products p LEFT JOIN order_items oi ON p.id = oi.product_id LEFT JOIN orders o ON oi.order_id = o.id WHERE (o.order_status = 'delivered' OR o.id IS NULL) AND (o.created_at BETWEEN $1 AND $2 OR o.id IS NULL) GROUP BY p.category ORDER BY revenue DESC`, [dateFrom, dateTo]);
    res.json({ success: true, data: { user_growth: userGrowth, sales_trends: salesTrends, category_performance: categoryStats } });
}));

module.exports = router;