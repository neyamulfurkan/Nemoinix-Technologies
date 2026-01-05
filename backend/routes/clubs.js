// backend/routes/clubs.js
// Club routes for browsing, viewing profiles, and club applications.
// GLOBAL REFERENCE: API Endpoints → /api/clubs/*, Club Structure
// PURPOSE: Public club browsing and club application endpoints.

const express = require('express');
const router = express.Router();
const Club = require('../models/clubModel');
const User = require('../models/userModel');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadImage } = require('../config/cloudinary');
const { sendClubApplicationReceived } = require('../config/email');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// @route   GET /api/clubs
// @desc    Get all clubs with filters
// @access  Public
router.get('/', asyncHandler(async (req, res) => {
    const filters = {
        status: req.query.status || 'approved',
        university: req.query.university,
        tier: req.query.tier,
        search: req.query.search,
        sort_by: req.query.sort_by || 'reward_points',
        order_by: req.query.order_by || 'DESC',
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 12
    };
    
    console.log('Fetching clubs with filters:', filters);
    
    // Map invalid sort_by values to valid columns
    const validSortColumns = {
        'rank': 'reward_points',
        'reward_points': 'reward_points',
        'name': 'club_name',
        'products': 'total_sales',
        'competitions': 'id',
        'rating': 'average_rating',
        'newest': 'created_at'
    };
    
    // Ensure valid sort column
    if (filters.sort_by && validSortColumns[filters.sort_by]) {
        filters.sort_by = validSortColumns[filters.sort_by];
    } else {
        filters.sort_by = 'reward_points';
    }
    
    const clubs = await Club.findAll(filters);
    const totalCount = await Club.count(filters);
    
    console.log(`Found ${clubs.length} clubs, total count: ${totalCount}`);
    
    // Add computed fields for frontend
    const enrichedClubs = clubs.map(club => ({
        ...club,
        product_count: club.product_count || 0,
        competition_count: club.competition_count || 0,
        average_rating: club.average_rating || 0,
        leaderboard_rank: club.leaderboard_rank || 0
    }));
    
    res.json({
        success: true,
        data: enrichedClubs,
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / filters.limit),
            hasNext: filters.page < Math.ceil(totalCount / filters.limit),
            hasPrev: filters.page > 1
        }
    });
}));

// @route   GET /api/clubs/leaderboard
// @desc    Get clubs leaderboard
// @access  Public
router.get('/leaderboard', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = await Club.getLeaderboard(limit);
    
    res.json({
        success: true,
        data: leaderboard
    });
}));

// @route   GET /api/clubs/featured
// @desc    Get featured clubs
// @access  Public
router.get('/featured', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 3;
    const clubs = await Club.getFeatured(limit);
    
    res.json({
        success: true,
        data: clubs
    });
}));

module.exports = router;

// @route   GET /api/clubs/universities
// @desc    Get all universities list
// @access  Public
router.get('/universities', asyncHandler(async (req, res) => {
    const universities = await Club.getUniversities();
    
    res.json({
        success: true,
        data: universities
    });
}));

// @route   GET /api/clubs/profile
// @desc    Get own club profile (use club-admin route instead)
// @access  Private (Club Admin)
router.get('/profile', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'club_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only club admins can access this resource'
            });
        }

        const clubId = req.user.club_id;
        
        if (!clubId) {
            return res.status(404).json({
                success: false,
                message: 'Club not found for this user'
            });
        }

        // Use raw database query with proper JOIN to get fresh data
        const db = require('../config/database');
        
        const club = await db.getOne(
            `SELECT c.*, 
                    COUNT(DISTINCT p.id) as product_count,
                    COUNT(DISTINCT comp.id) as competition_count
             FROM clubs c
             LEFT JOIN products p ON c.id = p.club_id AND p.status = 'active'
             LEFT JOIN competitions comp ON c.id = comp.club_id
             WHERE c.id = $1
             GROUP BY c.id`,
            [clubId]
        );

        if (!club) {
            return res.status(404).json({
                success: false,
                message: 'Club not found'
            });
        }

        res.json({
            success: true,
            data: club
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch profile'
        });
    }
});

// @route   GET /api/clubs/:slug
// @desc    Get single club by slug
// @access  Public
router.get('/:slug', asyncHandler(async (req, res) => {
    console.log('Fetching club by slug:', req.params.slug);
    
    const club = await Club.findBySlug(req.params.slug);
    
    if (!club) {
        console.log('Club not found:', req.params.slug);
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    console.log('Found club:', club.club_name);
    
    if (club.status !== 'approved') {
        return res.status(403).json({
            success: false,
            message: 'Club is not publicly accessible'
        });
    }
    
    // Get statistics
    const stats = await Club.getStatistics(club.id);
    
    // Get leaderboard rank
    const rank = await Club.getClubRank(club.id);
    
    // Get product and competition counts from database
    const db = require('../config/database');
    const productCount = await db.getOne(
        'SELECT COUNT(*) as count FROM products WHERE club_id = $1 AND status = $2',
        [club.id, 'active']
    );
    const competitionCount = await db.getOne(
        'SELECT COUNT(*) as count FROM competitions WHERE club_id = $1',
        [club.id]
    );
    
    console.log('Club stats:', { products: productCount?.count, competitions: competitionCount?.count });
    
    res.json({
        success: true,
        data: {
            ...club,
            product_count: parseInt(productCount?.count || 0),
            competition_count: parseInt(competitionCount?.count || 0),
            statistics: stats,
            leaderboard_rank: rank
        }
    });
}));

// @route   POST /api/clubs/apply
// @desc    Apply as new club
// @access  Public
router.post('/apply', 
    upload.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'certificate', maxCount: 1 }
    ]),
    asyncHandler(async (req, res) => {
        const { 
            email, 
            password,
            full_name,
            club_name, 
            university, 
            established_year, 
            description,
            phone,
            contact_email
        } = req.body;
        
        // Validate required fields
        if (!email || !password || !full_name || !club_name || !university || !established_year || !description || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }
        
        // Validate password
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters'
            });
        }
        
        // Validate phone number
        const phoneRegex = /^01[3-9]\d{8}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format'
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
        
        // Validate .edu.bd or .ac.bd domain (optional for flexibility)
        // if (!email.endsWith('.edu.bd') && !email.endsWith('.ac.bd')) {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Club email must be from .edu.bd or .ac.bd domain'
        //     });
        // }
        
        // Check if email already exists
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }
        
        // Check if files uploaded
        if (!req.files || !req.files.logo || !req.files.certificate) {
            return res.status(400).json({
                success: false,
                message: 'Club logo and registration certificate are required'
            });
        }
        
        // Validate file types
        const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        const allowedDocTypes = [...allowedImageTypes, 'application/pdf'];
        
        if (!allowedImageTypes.includes(req.files.logo[0].mimetype)) {
            return res.status(400).json({
                success: false,
                message: 'Logo must be an image (JPG, PNG, WEBP)'
            });
        }
        
        if (!allowedDocTypes.includes(req.files.certificate[0].mimetype)) {
            return res.status(400).json({
                success: false,
                message: 'Certificate must be an image or PDF'
            });
        }
        
        // Upload logo
        const logoUpload = await uploadImage(req.files.logo[0].buffer, { 
            folder: 'robotics-marketplace/clubs',
            public_id: `club_logo_${Date.now()}`,
            transformation: [
                { width: 400, height: 400, crop: 'fill' },
                { quality: 'auto:good' }
            ]
        });
        
        // Upload certificate
        const certificateUpload = await uploadImage(req.files.certificate[0].buffer, { 
            folder: 'robotics-marketplace/club-certificates',
            public_id: `club_cert_${Date.now()}`
        });
        
        // Generate slug
        const baseSlug = club_name.toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
        
        // Check if slug exists and make it unique
        let slug = baseSlug;
        let counter = 1;
        while (await Club.slugExists(slug)) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }
        
        // Create user account
        const { user, verificationToken } = await User.create({
            email,
            password,
            full_name,
            phone,
            role: 'club_admin'
        });
        
        // Create club
        const club = await Club.create({
            user_id: user.id,
            club_name,
            slug,
            university,
            established_year: parseInt(established_year),
            description,
            logo_url: logoUpload.url,
            certificate_url: certificateUpload.url,
            contact_email: contact_email || email
        });
        
        // Send application received email
        try {
            await sendClubApplicationReceived(club, user);
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
        }
        
        res.status(201).json({
            success: true,
            message: 'Club application submitted successfully. You will receive an email once reviewed.',
            data: {
                club_id: club.id,
                club_name: club.club_name,
                slug: club.slug,
                status: club.status,
                user_email: user.email
            }
        });
    })
);

// @route   GET /api/clubs/:slug/products
// @desc    Get club products
// @access  Public
router.get('/:slug/products', asyncHandler(async (req, res) => {
    const club = await Club.findBySlug(req.params.slug);
    
    if (!club || club.status !== 'approved') {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    const Product = require('../models/productModel');
    const products = await Product.findAll({
        club_id: club.id,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 12,
        sort_by: req.query.sort_by || 'created_at',
        order_by: req.query.order_by || 'DESC'
    });
    
    const totalCount = await Product.count({ club_id: club.id });
    
    res.json({
        success: true,
        data: products,
        pagination: {
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 12,
            total: totalCount,
            totalPages: Math.ceil(totalCount / (parseInt(req.query.limit) || 12))
        }
    });
}));

// @route   GET /api/clubs/:slug/competitions
// @desc    Get club competitions
// @access  Public
router.get('/:slug/competitions', asyncHandler(async (req, res) => {
    const club = await Club.findBySlug(req.params.slug);
    
    if (!club || club.status !== 'approved') {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    const Competition = require('../models/competitionModel');
    const competitions = await Competition.findAll({
        club_id: club.id,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 12,
        sort_by: req.query.sort_by || 'competition_date',
        order_by: req.query.order_by || 'ASC'
    });
    
    const totalCount = await Competition.count({ club_id: club.id });
    
    res.json({
        success: true,
        data: competitions,
        pagination: {
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 12,
            total: totalCount,
            totalPages: Math.ceil(totalCount / (parseInt(req.query.limit) || 12))
        }
    });
}));
// @route   GET /api/clubs/similar
// @desc    Get similar clubs
// @access  Public
router.get('/similar', asyncHandler(async (req, res) => {
    const excludeId = req.query.exclude ? parseInt(req.query.exclude) : null;
    const limit = parseInt(req.query.limit) || 3;
    
    let query = `
        SELECT 
            c.id,
            c.club_name,
            c.slug,
            c.university,
            c.logo_url,
            c.reward_tier,
            c.average_rating,
            COALESCE(COUNT(DISTINCT p.id), 0) as product_count
        FROM clubs c
        LEFT JOIN products p ON c.id = p.club_id AND p.status = 'active'
        WHERE c.status = 'approved'
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (excludeId) {
        query += ` AND c.id != $${paramCount}`;
        params.push(excludeId);
        paramCount++;
    }
    
    query += ` GROUP BY c.id, c.club_name, c.slug, c.university, c.logo_url, c.reward_tier, c.average_rating`;
    query += ` ORDER BY c.reward_points DESC, c.average_rating DESC`;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
    
    const clubs = await db.getMany(query, params);
    
    res.json({
        success: true,
        data: clubs
    });
}));