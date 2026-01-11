// backend/routes/competitions.js
// Competition routes for browsing, registering, and managing competitions.
// GLOBAL REFERENCE: API Endpoints → /api/competitions/*, Competition Structure
// PURPOSE: Public competition browsing and student registration endpoints.

const express = require('express');
const router = express.Router();
const Competition = require('../models/competitionModel');
const Registration = require('../models/registrationModel');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadImage } = require('../config/cloudinary');
const db = require('../config/database');

// @route   GET /api/competitions
// @desc    Get all competitions with filters
// @access  Public
router.get('/', asyncHandler(async (req, res) => {
    const filters = {
        club_id: req.query.club_id,
        category: req.query.category,
        search: req.query.search,
        location: req.query.location,
        sort_by: req.query.sort_by || 'competition_date',
        order_by: req.query.order_by || 'ASC',
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 12
    };
    
    // Handle status filter
    if (req.query.status === 'upcoming') {
        filters.upcoming = true;
    } else if (req.query.status === 'past') {
        filters.past = true;
    }
    
    // Handle registration status
    if (req.query.registration_open === 'true') {
        filters.registration_open = true;
    }
    
    // Parallel execution
    const [competitions, totalCount] = await Promise.all([
        Competition.findAll(filters),
        Competition.count(filters)
    ]);
    
    // Add user registration status if authenticated
    if (req.user) {
        const competitionIds = competitions.map(c => c.id);
        if (competitionIds.length > 0) {
            const registrations = await db.getMany(`
                SELECT competition_id, registration_status 
                FROM competition_registrations 
                WHERE competition_id = ANY($1) AND user_id = $2
            `, [competitionIds, req.user.id]);
            
            const regMap = {};
            registrations.forEach(r => {
                regMap[r.competition_id] = r.registration_status;
            });
            
            competitions.forEach(comp => {
                comp.user_registration_status = regMap[comp.id] || null;
            });
        }
    }
    
    res.json({
        success: true,
        data: competitions,
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

// @route   GET /api/competitions/featured
// @desc    Get featured competitions
// @access  Public
router.get('/featured', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 5;
    const competitions = await Competition.getFeatured(limit);
    
    res.json({
        success: true,
        data: competitions
    });
}));

// @route   GET /api/competitions/upcoming
// @desc    Get upcoming competitions
// @access  Public
router.get('/upcoming', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 5;
    const competitions = await Competition.getUpcoming(limit);
    
    res.json({
        success: true,
        data: competitions
    });
}));

// @route   GET /api/competitions/categories
// @desc    Get all competition categories
// @access  Public
router.get('/categories', asyncHandler(async (req, res) => {
    const categories = await Competition.getCategories();
    
    res.json({
        success: true,
        data: categories
    });
}));

// @route   GET /api/competitions/:id
// @desc    Get single competition by ID
// @access  Public
router.get('/:id', asyncHandler(async (req, res) => {
    const competition = await Competition.findById(req.params.id);
    
    if (!competition) {
        return res.status(404).json({
            success: false,
            message: 'Competition not found'
        });
    }
    
    // Get registration statistics
    const regStats = await Registration.getStatistics(competition.id);
    competition.registration_stats = regStats;
    
    // Get total applications count (all statuses)
    const totalApplications = await db.getOne(
        'SELECT COUNT(*)::integer as count FROM competition_registrations WHERE competition_id = $1',
        [competition.id]
    );
    competition.total_applications = parseInt(totalApplications.count) || 0;
    
    // Get approved registrations count only
    const approvedCount = await db.getOne(
        'SELECT COUNT(*)::integer as count FROM competition_registrations WHERE competition_id = $1 AND registration_status = $2',
        [competition.id, 'approved']
    );
    competition.approved_count = parseInt(approvedCount.count) || 0;
    
    // Check if registration is still open
    const isOpen = await Competition.isRegistrationOpen(competition.id);
    competition.is_registration_open = isOpen;
    
    // Get required products - ONLY if they actually exist in junction table
    const requiredProducts = await db.getMany(`
        SELECT 
            p.id,
            p.name,
            p.price,
            p.stock,
            c.club_name,
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order LIMIT 1) as image_url
        FROM competition_products cp
        JOIN products p ON cp.product_id = p.id AND p.status = 'active'
        JOIN clubs c ON p.club_id = c.id
        WHERE cp.competition_id = $1
        ORDER BY cp.is_required DESC
    `, [competition.id]);
    
    // CRITICAL: Only set required_products if there are actual products linked
    competition.required_products = requiredProducts.length > 0 ? requiredProducts : null;
    
    // Check if current user has registered (if authenticated)
    if (req.user) {
        const userRegistration = await db.getOne(`
            SELECT registration_status 
            FROM competition_registrations 
            WHERE competition_id = $1 AND user_id = $2
            ORDER BY created_at DESC
            LIMIT 1
        `, [competition.id, req.user.id]);
        
        competition.user_registration_status = userRegistration ? userRegistration.registration_status : null;
    }
    
    res.json({
        success: true,
        data: competition,
        competition: competition
    });
}));

// @route   POST /api/competitions/:id/views
// @desc    Increment competition views
// @access  Public
router.post('/:id/views', asyncHandler(async (req, res) => {
    const competitionExists = await db.exists('competitions', 'id = $1', [req.params.id]);
    
    if (!competitionExists) {
        return res.status(404).json({
            success: false,
            message: 'Competition not found'
        });
    }
    
    await Competition.incrementViews(req.params.id);
    
    res.json({
        success: true,
        message: 'View counted'
    });
}));

// @route   POST /api/competitions/:id/register
// @desc    Register for competition
// @access  Private (Student)
router.post('/:id/register', authenticate, asyncHandler(async (req, res) => {
    const competitionId = req.params.id;
    const { team_name, team_members, phone, payment_method, payment_screenshot, transaction_id } = req.body;
    
    // Validate required fields
    if (!team_name || !team_members || !phone || !payment_method) {
        return res.status(400).json({
            success: false,
            message: 'Please provide all required fields: team_name, team_members, phone, payment_method'
        });
    }
    
    // Validate payment method
    if (!['cash_on_delivery', 'bkash', 'nagad'].includes(payment_method)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid payment method'
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
    
    // Check if already registered (pending or approved only)
    const existingReg = await Registration.checkExistingRegistration(req.user.id, competitionId);
    if (existingReg) {
        return res.status(400).json({
            success: false,
            message: 'You have already registered for this competition',
            registration_status: existingReg.registration_status
        });
    }
    
    // Get competition details
    const competition = await Competition.findById(competitionId);
    
    if (!competition) {
        return res.status(404).json({
            success: false,
            message: 'Competition not found'
        });
    }
    
    // Check if registration is open
    const isOpen = await Competition.isRegistrationOpen(competitionId);
    if (!isOpen) {
        return res.status(400).json({
            success: false,
            message: 'Registration is closed for this competition'
        });
    }
    
    // Upload payment screenshot if provided
    let screenshotUrl = null;
    if (payment_screenshot && payment_method !== 'cash_on_delivery') {
        try {
            console.log('Uploading payment screenshot...');
            const buffer = Buffer.from(payment_screenshot.split(',')[1], 'base64');
            const upload = await uploadImage(buffer, { 
                folder: 'robotics-marketplace/payment-screenshots',
                public_id: `payment_${competitionId}_${req.user.id}_${Date.now()}`
            });
            screenshotUrl = upload.url;
            console.log('Screenshot uploaded successfully:', screenshotUrl);
        } catch (error) {
            console.error('Payment screenshot upload failed:', error);
            // Don't fail the registration, just log the error
        }
    } else {
        console.log('No screenshot to upload. Method:', payment_method, 'Screenshot provided:', !!payment_screenshot);
    }
    
    // Create registration
    const registration = await Registration.create({
        competition_id: competitionId,
        user_id: req.user.id,
        team_name,
        team_members,
        phone,
        registration_fee: competition.registration_fee,
        payment_method,
        payment_screenshot_url: screenshotUrl,
        transaction_id: transaction_id || null,
        registration_status: 'pending', // Requires admin approval
        payment_status: payment_method === 'cash_on_delivery' ? 'pending' : 'pending'
    });
    
    // Note: Registration count will be updated only when admin approves
    // await Competition.updateRegistrationCount(competitionId); // Removed - only count approved
    
    // Send confirmation email
    try {
        const { sendCompetitionRegistrationConfirmation } = require('../config/email');
        await sendCompetitionRegistrationConfirmation(registration, competition, req.user);
    } catch (emailError) {
        console.error('Email sending failed:', emailError);
    }
    
    // Award reward points to club
    const Reward = require('../models/rewardModel');
    await Reward.awardCompetitionPoints(competition.club_id, competition.id, competition.title);
    
    res.status(201).json({
        success: true,
        message: 'Registration submitted successfully. You will receive a confirmation email.',
        data: {
            registration_id: registration.id,
            team_name: registration.team_name,
            registration_fee: registration.registration_fee,
            payment_status: registration.payment_status,
            registration_status: registration.registration_status
        }
    });
}));

// @route   GET /api/competitions/:id/products
// @desc    Get products linked to competition
// @access  Public
router.get('/:id/products', asyncHandler(async (req, res) => {
    const products = await db.getMany(`
        SELECT 
            p.*,
            c.club_name,
            c.slug as club_slug,
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order LIMIT 1) as primary_image
        FROM competition_products cp
        JOIN products p ON cp.product_id = p.id
        JOIN clubs c ON p.club_id = c.id
        WHERE cp.competition_id = $1 AND p.status = 'active'
        ORDER BY cp.is_required DESC, p.name ASC
    `, [req.params.id]);
    
    res.json({
        success: true,
        data: products
    });
}));

// @route   GET /api/competitions/:id/registrations
// @desc    Get competition registrations count (public stats only)
// @access  Public
router.get('/:id/registrations', asyncHandler(async (req, res) => {
    const stats = await Registration.getStatistics(req.params.id);
    
    // Return only public stats
    res.json({
        success: true,
        data: {
            total_registrations: stats.total_registrations,
            approved_count: stats.approved_count
        }
    });
}));

// @route   POST /api/competitions/:id/duplicate
// @desc    Duplicate a competition (Club Admin)
// @access  Private (Club Admin)
router.post('/:id/duplicate', authenticate, authorize('club_admin'), asyncHandler(async (req, res) => {
    const competitionId = req.params.id;
    
    // Get original competition
    const original = await Competition.findById(competitionId);
    
    if (!original) {
        return res.status(404).json({
            success: false,
            message: 'Competition not found'
        });
    }
    
    // Verify ownership
    if (original.club_id !== req.user.club_id) {
        return res.status(403).json({
            success: false,
            message: 'You can only duplicate your own competitions'
        });
    }
    
    // Create duplicate with modified data
    const duplicateData = {
        club_id: original.club_id,
        title: `${original.title} (Copy)`,
        slug: `${original.slug}-copy-${Date.now()}`,
        description: original.description,
        category: original.category,
        competition_date: original.competition_date,
        competition_time: original.competition_time,
        venue: original.venue,
        location_lat: original.location_lat,
        location_lng: original.location_lng,
        registration_deadline: original.registration_deadline,
        max_participants: original.max_participants,
        registration_fee: original.registration_fee,
        prize_first: original.prize_first,
        prize_second: original.prize_second,
        prize_third: original.prize_third,
        rules: original.rules,
        eligibility: original.eligibility,
        banner_url: original.banner_url,
        contact_email: original.contact_email,
        contact_phone: original.contact_phone,
        status: 'active'
    };
    
    const duplicate = await Competition.create(duplicateData);
    
    // Copy linked products
    await db.query(`
        INSERT INTO competition_products (competition_id, product_id, is_required)
        SELECT $1, product_id, is_required
        FROM competition_products
        WHERE competition_id = $2
    `, [duplicate.id, competitionId]);
    
    res.status(201).json({
        success: true,
        message: 'Competition duplicated successfully',
        competition: duplicate
    });
}));

// @route   PUT /api/competitions/:id/cancel
// @desc    Cancel a competition (Club Admin)
// @access  Private (Club Admin)
router.put('/:id/cancel', authenticate, authorize('club_admin'), asyncHandler(async (req, res) => {
    const competitionId = req.params.id;
    
    // Get competition
    const competition = await Competition.findById(competitionId);
    
    if (!competition) {
        return res.status(404).json({
            success: false,
            message: 'Competition not found'
        });
    }
    
    // Verify ownership
    if (competition.club_id !== req.user.club_id) {
        return res.status(403).json({
            success: false,
            message: 'You can only cancel your own competitions'
        });
    }
    
    // Check if already cancelled
    if (competition.status === 'cancelled') {
        return res.status(400).json({
            success: false,
            message: 'Competition is already cancelled'
        });
    }
    
    // Update status to cancelled
    await db.query(
        'UPDATE competitions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['cancelled', competitionId]
    );
    
    // Notify all registered participants
    try {
        const registrations = await db.getMany(`
            SELECT cr.*, u.email, u.full_name
            FROM competition_registrations cr
            JOIN users u ON cr.user_id = u.id
            WHERE cr.competition_id = $1 AND cr.registration_status = 'approved'
        `, [competitionId]);
        
        const { sendCompetitionCancellation } = require('../config/email');
        for (const reg of registrations) {
            await sendCompetitionCancellation(reg, competition);
        }
    } catch (emailError) {
        console.error('Email notification failed:', emailError);
    }
    
    res.json({
        success: true,
        message: 'Competition cancelled successfully. All participants have been notified.'
    });
}));

// @route   DELETE /api/competitions/:id
// @desc    Delete a competition (Club Admin)
// @access  Private (Club Admin)
router.delete('/:id', authenticate, authorize('club_admin'), asyncHandler(async (req, res) => {
    const competitionId = req.params.id;
    
    // Get competition
    const competition = await Competition.findById(competitionId);
    
    if (!competition) {
        return res.status(404).json({
            success: false,
            message: 'Competition not found'
        });
    }
    
    // Verify ownership
    if (competition.club_id !== req.user.club_id) {
        return res.status(403).json({
            success: false,
            message: 'You can only delete your own competitions'
        });
    }
    
    // Check if competition has registrations
    const hasRegistrations = await db.getOne(
        'SELECT COUNT(*)::integer as count FROM competition_registrations WHERE competition_id = $1',
        [competitionId]
    );
    
    if (hasRegistrations.count > 0) {
        return res.status(400).json({
            success: false,
            message: 'Cannot delete competition with existing registrations. Cancel it instead.'
        });
    }
    
    // Delete competition (CASCADE will handle related records)
    await db.query('DELETE FROM competitions WHERE id = $1', [competitionId]);
    
    res.json({
        success: true,
        message: 'Competition deleted successfully'
    });
}));

module.exports = router;