// backend/routes/club-admin.js
// Club admin routes for managing products, competitions, orders, and earnings.
// GLOBAL REFERENCE: API Endpoints → /api/club-admin/*
// PURPOSE: Complete club management dashboard operations.

const express = require('express');
const router = express.Router();

const Product = require('../models/productModel');
const Competition = require('../models/competitionModel');
const Club = require('../models/clubModel');
const Order = require('../models/orderModel');
const Registration = require('../models/registrationModel');
const Reward = require('../models/rewardModel');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorizeClubAdmin, authorizeClubResource } = require('../middleware/auth');
const { uploadImage, uploadProductImage, uploadCompetitionBanner } = require('../config/cloudinary');
const { sendOrderShipped } = require('../config/email');
const multer = require('multer');
const db = require('../config/database');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// @route   GET /api/club-admin/dashboard
// @desc    Get club dashboard statistics
// @access  Private (Club Admin)
router.get('/dashboard', authenticate, authorizeClubAdmin, asyncHandler(async (req, res) => {
    const stats = await Club.getStatistics(req.club.id);
    
    // Get recent orders
    const recentOrders = await db.getMany(`
        SELECT DISTINCT
            o.id,
            o.order_number,
            o.created_at,
            o.order_status,
            u.full_name as customer_name
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN users u ON o.user_id = u.id
        WHERE oi.club_id = $1
        ORDER BY o.created_at DESC
        LIMIT 5
    `, [req.club.id]);
    
    // Get reward tier info with actual commission rate from database
    const tierInfo = await Reward.getTierInfo(req.club.id);
    
    res.json({
        success: true,
        data: {
            statistics: stats,
            recent_orders: recentOrders,
            reward_info: tierInfo
        }
    });
}));

// ============= PRODUCT ROUTES =============

// @route   GET /api/club-admin/products
// @desc    Get all club products
// @access  Private (Club Admin)
router.get('/products', authenticate, authorizeClubAdmin, asyncHandler(async (req, res) => {
    const filters = {
        club_id: req.club.id,
        status: req.query.status,
        category: req.query.category,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
    };
    
    const products = await Product.findAll(filters);
    
    // Count with same filters
    const countFilters = {
        club_id: req.club.id
    };
    if (req.query.status) {
        countFilters.status = req.query.status;
    }
    if (req.query.category) {
        countFilters.category = req.query.category;
    }
    const totalCount = await Product.count(countFilters);
    
    res.json({
        success: true,
        data: products,
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / filters.limit)
        }
    });
}));

// @route   POST /api/club-admin/products
// @desc    Create new product
// @access  Private (Club Admin)
router.post('/products', 
    authenticate, 
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const { 
            name, slug, description, category, price, original_price,
            stock, condition, weight, specifications, tags, images
        } = req.body;
        
        // Validate required fields
        if (!name || !description || !category || !price || stock === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Name, description, category, price, and stock are required'
            });
        }
        
        // Generate slug if not provided
        const finalSlug = slug || name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        
        // Check if slug exists
        if (await Product.slugExists(finalSlug)) {
            return res.status(400).json({
                success: false,
                message: 'Product slug already exists'
            });
        }
        
        const productData = {
            club_id: req.club.id,
            name,
            slug: finalSlug,
            description,
            category,
            price: parseFloat(price),
            original_price: original_price ? parseFloat(original_price) : null,
            stock: parseInt(stock),
            condition: condition || 'new',
            weight: weight ? parseInt(weight) : null,
            specifications: typeof specifications === 'string' ? JSON.parse(specifications) : (specifications || {}),
            tags: typeof tags === 'string' ? JSON.parse(tags) : (Array.isArray(tags) ? tags : []),
            images: images || []
        };
        
        console.log('Creating product with data:', JSON.stringify(productData, null, 2));
        
        const product = await Product.create(productData);
        
        console.log('Product created with ID:', product.id);
        console.log('Images to save:', productData.images);
        
        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: product
        });
    })
);

// @route   PUT /api/club-admin/products/:id
// @desc    Update product
// @access  Private (Club Admin)
router.put('/products/:id',
    authenticate,
    authorizeClubAdmin,
    authorizeClubResource('products'),
    upload.array('images', 5),
    asyncHandler(async (req, res) => {
        const updates = { ...req.body };
        
        // Parse JSON fields if they're strings
        if (updates.specifications) {
            updates.specifications = typeof updates.specifications === 'string' 
                ? JSON.parse(updates.specifications) 
                : updates.specifications;
        }
        if (updates.tags) {
            updates.tags = typeof updates.tags === 'string' 
                ? JSON.parse(updates.tags) 
                : (Array.isArray(updates.tags) ? updates.tags : []);
        }
        
        // Upload new images if provided
        if (req.files && req.files.length > 0) {
            const imageUrls = [];
            for (const file of req.files) {
                const upload = await uploadProductImage(file.buffer, req.club.id);
                imageUrls.push(upload.url);
            }
            updates.images = imageUrls;
        }
        
        const product = await Product.update(req.params.id, updates);
        
        res.json({
            success: true,
            message: 'Product updated successfully',
            data: product
        });
    })
);

// @route   DELETE /api/club-admin/products/:id
// @desc    Delete product
// @access  Private (Club Admin)
router.delete('/products/:id',
    authenticate,
    authorizeClubAdmin,
    authorizeClubResource('products'),
    asyncHandler(async (req, res) => {
        await Product.delete(req.params.id);
        
        res.json({
            success: true,
            message: 'Product deleted successfully'
        });
    })
);

// @route   GET /api/club-admin/products/low-stock
// @desc    Get low stock products
// @access  Private (Club Admin)
router.get('/products/low-stock', authenticate, authorizeClubAdmin, asyncHandler(async (req, res) => {
    const threshold = parseInt(req.query.threshold) || 5;
    const products = await Product.getLowStock(req.club.id, threshold);
    
    res.json({
        success: true,
        data: products
    });
}));

// ============= COMPETITION ROUTES =============

// @route   GET /api/club-admin/competitions
// @desc    Get all club competitions
// @access  Private (Club Admin)
router.get('/competitions', authenticate, authorizeClubAdmin, asyncHandler(async (req, res) => {
    const filters = {
        club_id: req.club.id,
        status: req.query.status,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
    };
    
    const competitions = await Competition.findAll(filters);
    const totalCount = await Competition.count({ club_id: req.club.id });
    
    res.json({
        success: true,
        data: competitions,
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / filters.limit)
        }
    });
}));

// @route   POST /api/club-admin/competitions
// @desc    Create new competition
// @access  Private (Club Admin)
router.post('/competitions',
    authenticate,
    authorizeClubAdmin,
    upload.single('banner'),
    asyncHandler(async (req, res) => {
        const {
            title, slug, description, category, competition_date, competition_time,
            venue, location_lat, location_lng, registration_deadline, max_participants,
            registration_fee, prize_first, prize_second, prize_third, rules, eligibility,
            contact_email, contact_phone, product_ids
        } = req.body;
        
        // Validate required fields
        if (!title || !description || !category || !competition_date || !venue || !registration_deadline || !registration_fee) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be provided'
            });
        }
        
        // Check if slug exists
        if (slug && await Competition.slugExists(slug)) {
            return res.status(400).json({
                success: false,
                message: 'Competition slug already exists'
            });
        }
        
        // Upload banner
        let bannerUrl = null;
        if (req.file) {
            const upload = await uploadCompetitionBanner(req.file.buffer, req.club.id);
            bannerUrl = upload.url;
        }
        
        // Parse product_ids safely
        let parsedProductIds = [];
        if (product_ids) {
            if (typeof product_ids === 'string') {
                try {
                    parsedProductIds = JSON.parse(product_ids);
                } catch (e) {
                    parsedProductIds = [];
                }
            } else if (Array.isArray(product_ids)) {
                parsedProductIds = product_ids;
            }
        }
        
        const competitionData = {
            club_id: req.club.id,
            title,
            slug: slug || title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'),
            description,
            category,
            competition_date,
            competition_time: competition_time || null,
            venue,
            location_lat: location_lat ? parseFloat(location_lat) : null,
            location_lng: location_lng ? parseFloat(location_lng) : null,
            registration_deadline,
            max_participants: max_participants ? parseInt(max_participants) : null,
            registration_fee: parseFloat(registration_fee),
            prize_first: prize_first ? parseFloat(prize_first) : null,
            prize_second: prize_second ? parseFloat(prize_second) : null,
            prize_third: prize_third ? parseFloat(prize_third) : null,
            rules: rules || null,
            eligibility: eligibility || null,
            banner_url: bannerUrl,
            contact_email: contact_email || req.club.contact_email,
            contact_phone: contact_phone || null,
            product_ids: parsedProductIds
        };
        
        const competition = await Competition.create(competitionData);
        
        // Award reward points for creating competition
        await Reward.awardCompetitionPoints(req.club.id, competition.id, competition.title);
        
        res.status(201).json({
            success: true,
            message: 'Competition created successfully. Reward points awarded!',
            data: competition
        });
    })
);

// @route   PUT /api/club-admin/competitions/:id
// @desc    Update competition
// @access  Private (Club Admin)
router.put('/competitions/:id',
    authenticate,
    authorizeClubAdmin,
    authorizeClubResource('competitions'),
    upload.single('banner'),
    asyncHandler(async (req, res) => {
        const updates = { ...req.body };
        
        // Upload new banner if provided
        if (req.file) {
            const upload = await uploadCompetitionBanner(req.file.buffer, req.club.id);
            updates.banner_url = upload.url;
        }
        
        // Parse product_ids if provided
        if (updates.product_ids && typeof updates.product_ids === 'string') {
            updates.product_ids = JSON.parse(updates.product_ids);
        }
        
        const competition = await Competition.update(req.params.id, updates);
        
        res.json({
            success: true,
            message: 'Competition updated successfully',
            data: competition
        });
    })
);

// @route   DELETE /api/club-admin/competitions/:id
// @desc    Delete competition
// @access  Private (Club Admin)
router.delete('/competitions/:id',
    authenticate,
    authorizeClubAdmin,
    authorizeClubResource('competitions'),
    asyncHandler(async (req, res) => {
        await Competition.delete(req.params.id);
        
        res.json({
            success: true,
            message: 'Competition deleted successfully'
        });
    })
);

// @route   GET /api/club-admin/competitions/:id/registrations
// @desc    Get competition registrations
// @access  Private (Club Admin)
router.get('/competitions/:id/registrations',
    authenticate,
    authorizeClubAdmin,
    authorizeClubResource('competitions'),
    asyncHandler(async (req, res) => {
        const filters = {
            registration_status: req.query.registration_status,
            payment_status: req.query.payment_status
        };
        
        // Get registrations directly with all needed fields
        let query = `
            SELECT 
                cr.id,
                cr.competition_id,
                cr.user_id,
                cr.team_name,
                cr.team_members,
                cr.phone,
                cr.registration_fee,
                cr.payment_method,
                cr.transaction_id,
                cr.payment_screenshot_url,
                cr.payment_status,
                cr.registration_status,
                cr.created_at,
                cr.updated_at,
                u.full_name as user_name,
                u.email as user_email
            FROM competition_registrations cr
            JOIN users u ON cr.user_id = u.id
            WHERE cr.competition_id = $1
        `;
        
        const params = [req.params.id];
        let paramCount = 1;
        
        if (filters.registration_status) {
            paramCount++;
            query += ` AND cr.registration_status = $${paramCount}`;
            params.push(filters.registration_status);
        }
        
        if (filters.payment_status) {
            paramCount++;
            query += ` AND cr.payment_status = $${paramCount}`;
            params.push(filters.payment_status);
        }
        
        query += ` ORDER BY cr.created_at DESC`;
        
        const registrations = await db.getMany(query, params);
        const stats = await Registration.getStatistics(req.params.id);
        
        res.json({
            success: true,
            registrations: registrations,
            statistics: stats
        });
    })
);

// @route   PUT /api/club-admin/registrations/:id/approve
// @desc    Approve competition registration
// @access  Private (Club Admin)
router.put('/registrations/:id/approve',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        // Verify registration belongs to club's competition
        const registration = await db.getOne(`
            SELECT cr.*, c.club_id 
            FROM competition_registrations cr
            JOIN competitions c ON cr.competition_id = c.id
            WHERE cr.id = $1
        `, [req.params.id]);
        
        if (!registration) {
            return res.status(404).json({
                success: false,
                message: 'Registration not found'
            });
        }
        
        if (registration.club_id !== req.club.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        await Registration.approve(req.params.id);
        
        // Update competition registration count (only approved registrations)
        const Competition = require('../models/competitionModel');
        await Competition.updateRegistrationCount(registration.competition_id);
        
        res.json({
            success: true,
            message: 'Registration approved successfully'
        });
    })
);

// @route   PUT /api/club-admin/registrations/:id/reject
// @desc    Reject competition registration
// @access  Private (Club Admin)
router.put('/registrations/:id/reject',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        // Verify registration belongs to club's competition
        const registration = await db.getOne(`
            SELECT cr.*, c.club_id 
            FROM competition_registrations cr
            JOIN competitions c ON cr.competition_id = c.id
            WHERE cr.id = $1
        `, [req.params.id]);
        
        if (!registration) {
            return res.status(404).json({
                success: false,
                message: 'Registration not found'
            });
        }
        
        if (registration.club_id !== req.club.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        await Registration.reject(req.params.id);
        
        // Update competition registration count (only approved registrations)
        const Competition = require('../models/competitionModel');
        await Competition.updateRegistrationCount(registration.competition_id);
        
        res.json({
            success: true,
            message: 'Registration rejected'
        });
    })
);

// @route   DELETE /api/club-admin/registrations/:id
// @desc    Delete competition registration permanently
// @access  Private (Club Admin)
router.delete('/registrations/:id',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        // Verify registration belongs to club's competition
        const registration = await db.getOne(`
            SELECT cr.*, c.club_id 
            FROM competition_registrations cr
            JOIN competitions c ON cr.competition_id = c.id
            WHERE cr.id = $1
        `, [req.params.id]);
        
        if (!registration) {
            return res.status(404).json({
                success: false,
                message: 'Registration not found'
            });
        }
        
        if (registration.club_id !== req.club.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        // Delete the registration
        await db.query('DELETE FROM competition_registrations WHERE id = $1', [req.params.id]);
        
        // Update competition registration count
        const Competition = require('../models/competitionModel');
        await Competition.updateRegistrationCount(registration.competition_id);
        
        res.json({
            success: true,
            message: 'Registration deleted successfully'
        });
    })
);
// @route   PUT /api/club-admin/registrations/:id/verify-payment
// @desc    Verify payment for registration
// @access  Private (Club Admin)
router.put('/registrations/:id/verify-payment',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        await Registration.verifyPayment(req.params.id);
        
        res.json({
            success: true,
            message: 'Payment verified successfully'
        });
    })
);

// ============= ORDER ROUTES =============

// @route   GET /api/club-admin/orders
// @desc    Get club's received orders
// @access  Private (Club Admin)
router.get('/orders',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const { status, search, page = 1, limit = 50 } = req.query;
        
        console.log('Club Admin Orders Request:', {
            club_id: req.club.id,
            status,
            search
        });
        
        let query = `
            SELECT DISTINCT
                o.id,
                o.order_number,
                o.user_id,
                o.total_amount,
                o.shipping_cost,
                o.grand_total,
                o.payment_method,
                o.payment_status,
                o.payment_screenshot_url,
                o.transaction_id,
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
                u.full_name as user_name,
                u.email as user_email,
                u.phone as user_phone
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN users u ON o.user_id = u.id
            WHERE oi.club_id = $1
        `;
        
        const params = [req.club.id];
        let paramCount = 1;
        
        if (status && status !== 'all') {
            paramCount++;
            query += ` AND o.order_status = $${paramCount}`;
            params.push(status);
        }
        
        if (search) {
            paramCount++;
            query += ` AND (o.order_number ILIKE $${paramCount} OR u.full_name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        query += ` ORDER BY o.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
        
        console.log('Executing query with params:', params);
        
        const orders = await db.getMany(query, params);
        
        console.log('Orders found:', orders.length);
        
        // Get items for each order (only items from this club)
        for (let order of orders) {
            const items = await db.getMany(`
                SELECT 
                    oi.id,
                    oi.product_id,
                    oi.product_name,
                    oi.price,
                    oi.quantity,
                    oi.subtotal,
                    oi.status,
                    oi.tracking_number,
                    oi.courier_name,
                    (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order LIMIT 1) as image_url
                FROM order_items oi
                WHERE oi.order_id = $1 AND oi.club_id = $2
            `, [order.id, req.club.id]);
            
            order.items = items;
        }
        
        res.json({
            success: true,
            data: orders
        });
    })
);

// @route   GET /api/club-admin/orders/:id
// @desc    Get order details
// @access  Private (Club Admin)
router.get('/orders/:id',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        // Check if order contains club's items
        const hasClubItems = order.items.some(item => item.club_id === req.club.id);
        if (!hasClubItems) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        res.json({
            success: true,
            data: order
        });
    })
);

// @route   PUT /api/club-admin/order-items/:id/confirm
// @desc    Confirm order item
// @access  Private (Club Admin)
router.put('/order-items/:id/confirm',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        // Verify item belongs to club
        const item = await db.getOne(
            'SELECT oi.*, o.order_status FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE oi.id = $1 AND oi.club_id = $2',
            [req.params.id, req.club.id]
        );
        
        if (!item) {
            return res.status(404).json({
                success: false,
                message: 'Order item not found'
            });
        }
        
        // Update order item status
        await db.query(
            'UPDATE order_items SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['confirmed', req.params.id]
        );
        
        // Update main order status if it's still pending
        if (item.order_status === 'pending') {
            await db.query(
                'UPDATE orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['confirmed', item.order_id]
            );
        }
        
        res.json({
            success: true,
            message: 'Order confirmed successfully'
        });
    })
);

// @route   PUT /api/club-admin/order-items/:id/ship
// @desc    Mark order item as shipped
// @access  Private (Club Admin)
router.put('/order-items/:id/ship',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const { tracking_number, courier_name } = req.body;
        
        if (!tracking_number || !courier_name) {
            return res.status(400).json({
                success: false,
                message: 'Tracking number and courier name are required'
            });
        }
        
        // Verify item belongs to club
        const item = await db.getOne(
            'SELECT oi.*, o.user_id, o.order_status FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE oi.id = $1 AND oi.club_id = $2',
            [req.params.id, req.club.id]
        );
        
        if (!item) {
            return res.status(404).json({
                success: false,
                message: 'Order item not found'
            });
        }
        
        // Update order item status with tracking info
        await db.query(
            'UPDATE order_items SET status = $1, tracking_number = $2, courier_name = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
            ['shipped', tracking_number, courier_name, req.params.id]
        );
        
        // Update main order status to shipped
        await db.query(
            'UPDATE orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['shipped', item.order_id]
        );
        
        // Check if shipped within 24 hours for bonus points
        const hoursSinceOrder = (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceOrder < 24) {
            const Reward = require('../models/rewardModel');
            await Reward.awardFastShippingPoints(req.club.id, item.order_id);
        }
        
        // Send shipped notification email
        try {
            const order = await Order.findById(item.order_id);
            const user = await db.getOne('SELECT * FROM users WHERE id = $1', [item.user_id]);
            await sendOrderShipped(order, user);
        } catch (emailError) {
            console.error('Shipping notification email failed:', emailError);
        }
        
        res.json({
            success: true,
            message: 'Order marked as shipped successfully'
        });
    })
);

// @route   PUT /api/club-admin/orders/:id/verify-payment
// @desc    Verify payment for delivered order
// @access  Private (Club Admin)
router.put('/orders/:id/verify-payment',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        // Verify order belongs to club and is delivered
        const order = await db.getOne(
            `SELECT o.*, oi.club_id 
             FROM orders o 
             JOIN order_items oi ON o.id = oi.order_id 
             WHERE o.id = $1 AND oi.club_id = $2 
             LIMIT 1`,
            [req.params.id, req.club.id]
        );
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.order_status !== 'delivered') {
            return res.status(400).json({
                success: false,
                message: 'Only delivered orders can have payment verified'
            });
        }
        
        if (order.payment_status === 'verified') {
            return res.status(400).json({
                success: false,
                message: 'Payment already verified'
            });
        }
        
        // Update payment status
        await db.query(
            'UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['verified', req.params.id]
        );
        
        res.json({
            success: true,
            message: 'Payment verified successfully'
        });
    })
);

// ============= EARNINGS ROUTES =============

// @route   GET /api/club-admin/earnings/summary
// @desc    Get earnings summary
// @access  Private (Club Admin)
router.get('/earnings/summary',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const club = await Club.findById(req.club.id);
        const commissionRate = await Club.getCommissionRate(club.reward_tier);
        
        // Total all-time earnings
        const totalEarnings = await db.getOne(`
            SELECT COALESCE(SUM(oi.subtotal * (1 - $1::numeric)), 0) as earnings
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.club_id = $2 
                AND o.order_status = 'delivered'
                AND o.payment_status = 'verified'
        `, [commissionRate, req.club.id]);
        
        // This month earnings
        const thisMonth = await db.getOne(`
            SELECT COALESCE(SUM(oi.subtotal * (1 - $1::numeric)), 0) as earnings
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.club_id = $2 
                AND o.order_status = 'delivered'
                AND DATE_TRUNC('month', o.updated_at) = DATE_TRUNC('month', CURRENT_DATE)
        `, [commissionRate, req.club.id]);
        
        // Last month earnings for trend calculation
        const lastMonth = await db.getOne(`
            SELECT COALESCE(SUM(oi.subtotal * (1 - $1::numeric)), 0) as earnings
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.club_id = $2 
                AND o.order_status = 'delivered'
                AND DATE_TRUNC('month', o.updated_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        `, [commissionRate, req.club.id]);
        
        // Pending earnings (orders not yet delivered)
        const pending = await db.getOne(`
            SELECT COALESCE(SUM(oi.subtotal * (1 - $1::numeric)), 0) as earnings
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.club_id = $2 
                AND o.order_status IN ('pending', 'confirmed', 'processing', 'shipped')
        `, [commissionRate, req.club.id]);
        
        // Available balance (delivered but not paid out)
        const available = await db.getOne(`
            SELECT COALESCE(SUM(oi.subtotal * (1 - $1::numeric)), 0) as earnings
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.club_id = $2 
                AND o.order_status = 'delivered'
                AND o.payment_status = 'verified'
                AND NOT EXISTS (
                    SELECT 1 FROM payouts p 
                    WHERE p.club_id = $2 
                    AND p.status = 'paid'
                    AND o.updated_at BETWEEN p.period_start AND p.period_end
                )
        `, [commissionRate, req.club.id]);
        
        // Calculate month-over-month trend
        const lastMonthVal = parseFloat(lastMonth.earnings) || 0;
        const thisMonthVal = parseFloat(thisMonth.earnings) || 0;
        let monthTrend = 0;
        if (lastMonthVal > 0) {
            monthTrend = Math.round(((thisMonthVal - lastMonthVal) / lastMonthVal) * 100);
        }
        
        res.json({
            success: true,
            club: club,
            summary: {
                total_earnings: parseFloat(totalEarnings.earnings) || 0,
                month_earnings: thisMonthVal,
                pending_amount: parseFloat(pending.earnings) || 0,
                available_balance: parseFloat(available.earnings) || 0,
                month_trend: monthTrend
            }
        });
    })
);

// @route   GET /api/club-admin/earnings/transactions
// @desc    Get earnings transactions
// @access  Private (Club Admin)
router.get('/earnings/transactions',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const club = await Club.findById(req.club.id);
        const commissionRate = await Club.getCommissionRate(club.reward_tier);
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        let query = `
            SELECT 
                o.id,
                o.order_number,
                o.created_at,
                o.updated_at,
                o.order_status as status,
                SUM(oi.subtotal) as order_total,
                u.full_name as customer_name
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN users u ON o.user_id = u.id
            WHERE oi.club_id = $1
        `;
        
        const params = [req.club.id];
        let paramCount = 1;
        
        // Date filters
        if (req.query.from_date) {
            paramCount++;
            query += ` AND o.created_at >= $${paramCount}`;
            params.push(req.query.from_date);
        }
        
        if (req.query.to_date) {
            paramCount++;
            query += ` AND o.created_at <= $${paramCount}`;
            params.push(req.query.to_date);
        }
        
        query += ` GROUP BY o.id, o.order_number, o.created_at, o.updated_at, o.order_status, u.full_name`;
        query += ` ORDER BY o.created_at DESC`;
        query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);
        
        const transactions = await db.getMany(query, params);
        
        const totalCount = await db.getOne(
            'SELECT COUNT(DISTINCT o.id) as count FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE oi.club_id = $1',
            [req.club.id]
        );
        
        res.json({
            success: true,
            transactions: transactions,
            pagination: {
                current_page: page,
                items_per_page: limit,
                total_items: parseInt(totalCount.count),
                total_pages: Math.ceil(parseInt(totalCount.count) / limit)
            }
        });
    })
);

// ============= PROFILE ROUTES =============

// @route   GET /api/club-admin/profile
// @desc    Get club profile for editing
// @access  Private (Club Admin)
router.get('/profile',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const club = await Club.findById(req.club.id);
        
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
    })
);

// @route   PUT /api/club-admin/profile
// @desc    Update club profile
// @access  Private (Club Admin)
router.put('/profile',
    authenticate,
    authorizeClubAdmin,
    upload.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'cover_photo', maxCount: 1 }
    ]),
    asyncHandler(async (req, res) => {
        const updates = { ...req.body };
        
        // Upload new logo if provided
        if (req.files && req.files.logo) {
            const upload = await uploadImage(req.files.logo[0].buffer, { 
                folder: 'robotics-marketplace/clubs',
                public_id: `club_logo_${req.club.id}_${Date.now()}`
            });
            updates.logo_url = upload.url;
        }
        
        // Upload new cover photo if provided
        if (req.files && req.files.cover_photo) {
            const upload = await uploadImage(req.files.cover_photo[0].buffer, { 
                folder: 'robotics-marketplace/club-covers',
                public_id: `club_cover_${req.club.id}_${Date.now()}`
            });
            updates.cover_photo_url = upload.url;
        }
        
        // Update club profile in database
        const result = await db.query(
            `UPDATE clubs 
             SET established_year = COALESCE($1, established_year),
                 description = COALESCE($2, description),
                 cover_photo_url = COALESCE($3, cover_photo_url),
                 logo_url = COALESCE($4, logo_url),
                 contact_email = COALESCE($5, contact_email),
                 contact_phone = COALESCE($6, contact_phone),
                 bkash_number = COALESCE($7, bkash_number),
                 nagad_number = COALESCE($8, nagad_number),
                 facebook_url = COALESCE($9, facebook_url),
                 instagram_url = COALESCE($10, instagram_url),
                 website_url = COALESCE($11, website_url),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $12
             RETURNING *`,
            [
                updates.established_year,
                updates.description,
                updates.cover_photo_url,
                updates.logo_url,
                updates.contact_email,
                updates.contact_phone,
                updates.bkash_number,
                updates.nagad_number,
                updates.facebook_url,
                updates.instagram_url,
                updates.website_url,
                req.club.id
            ]
        );
        
        const updatedClub = result.rows[0];
        
        // Update related products and competitions if logo changed
        if (updates.logo_url) {
            await db.query(
                `UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE club_id = $1`,
                [req.club.id]
            );
            await db.query(
                `UPDATE competitions SET updated_at = CURRENT_TIMESTAMP WHERE club_id = $1`,
                [req.club.id]
            );
        }
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: updatedClub
        });
    })
);
// @route   GET /api/club-admin/clubs/:id/payment-numbers
// @desc    Get club payment numbers for checkout
// @access  Private (Student)
router.get('/clubs/:id/payment-numbers',
    authenticate,
    asyncHandler(async (req, res) => {
        const club = await db.getOne(
            'SELECT bkash_number, nagad_number FROM clubs WHERE id = $1 AND status = $2',
            [req.params.id, 'approved']
        );
        
        if (!club) {
            return res.status(404).json({
                success: false,
                message: 'Club not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                bkash_number: club.bkash_number || '01812-345678',
                nagad_number: club.nagad_number || '01912-345678'
            }
        });
    })
);

// @route   GET /api/club-admin/earnings/chart
// @desc    Get earnings chart data
// @access  Private (Club Admin)
router.get('/earnings/chart',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const period = req.query.period || '12months';
        
        // CRITICAL: Fetch club first to get reward tier
        const club = await Club.findById(req.club.id);
        const commissionRate = await Club.getCommissionRate(club.reward_tier);
        
        let chartData = {
            labels: [],
            revenue: [],
            orders: []
        };
        
        if (period === '12months') {
            // Get last 12 months data
            const monthsData = await db.getMany(`
                SELECT 
                    TO_CHAR(months.month, 'Mon') as month,
                    COALESCE(SUM(oi.subtotal * (1 - $1::numeric)), 0) as revenue,
                    COUNT(DISTINCT o.id) as order_count
                FROM generate_series(
                    DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months'),
                    DATE_TRUNC('month', CURRENT_DATE),
                    '1 month'::interval
                ) AS months(month)
                LEFT JOIN orders o ON DATE_TRUNC('month', o.created_at) = months.month
                LEFT JOIN order_items oi ON o.id = oi.order_id AND oi.club_id = $2
                GROUP BY months.month
                ORDER BY months.month ASC
            `, [commissionRate, req.club.id]);
            
            chartData.labels = monthsData.map(m => m.month);
            chartData.revenue = monthsData.map(m => parseFloat(m.revenue) || 0);
            chartData.orders = monthsData.map(m => parseInt(m.order_count) || 0);
        }
        
        res.json({
            success: true,
            chartData: chartData
        });
    })
);


// @route   GET /api/club-admin/rewards/history
// @desc    Get reward points history
// @access  Private (Club Admin)
router.get('/rewards/history',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const filters = {
            action_type: req.query.action_type,
            limit: parseInt(req.query.limit) || 50,
            page: parseInt(req.query.page) || 1
        };
        
        const history = await Reward.getHistory(req.club.id, filters);
        const summary = await Reward.getSummary(req.club.id);
        const tierInfo = await Reward.getTierInfo(req.club.id);
        
        // Get actual commission rate from database
        const club = await Club.findById(req.club.id);
        const commissionRate = await Club.getCommissionRate(club.reward_tier);
        
        // Override tierInfo commission rate with actual database value
        if (tierInfo) {
            tierInfo.commission_rate = commissionRate;
            tierInfo.commission_percentage = `${(commissionRate * 100).toFixed(1)}%`;
        }
        
        res.json({
            success: true,
            data: {
                history,
                summary,
                tier_info: tierInfo
            }
        });
    })
);
// @route   GET /api/club-admin/earnings/payouts
// @desc    Get payout history
// @access  Private (Club Admin)
router.get('/earnings/payouts',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        const payouts = await db.getMany(`
            SELECT 
                id,
                amount,
                period_start,
                period_end,
                status,
                payment_method,
                payment_reference,
                created_at,
                updated_at
            FROM payouts
            WHERE club_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `, [req.club.id, limit, offset]);
        
        const totalCount = await db.getOne(
            'SELECT COUNT(*) as count FROM payouts WHERE club_id = $1',
            [req.club.id]
        );
        
        res.json({
            success: true,
            payouts: payouts,
            pagination: {
                current_page: page,
                items_per_page: limit,
                total_items: parseInt(totalCount.count),
                total_pages: Math.ceil(parseInt(totalCount.count) / limit)
            }
        });
    })
);

// @route   POST /api/club-admin/earnings/request-payout
// @desc    Request a payout
// @access  Private (Club Admin)
router.post('/earnings/request-payout',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        const club = await Club.findById(req.club.id);
        const commissionRate = await Club.getCommissionRate(club.reward_tier);
        
        // Calculate available balance
        const available = await db.getOne(`
            SELECT COALESCE(SUM(oi.subtotal * (1 - $2)), 0) as earnings
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.club_id = $1 
                AND o.order_status = 'delivered'
                AND o.payment_status = 'verified'
                AND NOT EXISTS (
                    SELECT 1 FROM payouts p 
                    WHERE p.club_id = $1 
                    AND p.status = 'paid'
                    AND o.updated_at BETWEEN p.period_start AND p.period_end
                )
        `, [req.club.id, commissionRate]);
        
        const availableAmount = parseFloat(available.earnings) || 0;
        
        if (availableAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'No available balance to request payout'
            });
        }
        
        // Create payout request
        const payout = await db.query(`
            INSERT INTO payouts (
                club_id, amount, period_start, period_end, status
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [
            req.club.id,
            availableAmount,
            new Date(new Date().setMonth(new Date().getMonth() - 1)),
            new Date(),
            'pending'
        ]);
        
        res.json({
            success: true,
            message: 'Payout request submitted successfully',
            payout: payout.rows[0]
        });
    })
);

// @route   GET /api/club-admin/earnings/export
// @desc    Export earnings report
// @access  Private (Club Admin)
router.get('/earnings/export',
    authenticate,
    authorizeClubAdmin,
    asyncHandler(async (req, res) => {
        // For now, return a simple message
        // In production, you would generate an Excel file here
        res.json({
            success: true,
            message: 'Export feature coming soon',
            note: 'This will generate an Excel file with earnings data'
        });
    })
);
// Public route to get platform settings (for checkout page)
router.get('/platform-settings/public', asyncHandler(async (req, res) => {
    try {
        const settings = await db.getOne(
            "SELECT setting_value FROM platform_settings WHERE setting_key = 'general'"
        );
        
        if (settings && settings.setting_value) {
            res.json({
                success: true,
                data: {
                    general: settings.setting_value
                }
            });
        } else {
            // Return defaults
            res.json({
                success: true,
                data: {
                    general: {
                        support_phone: '+880 1812-345678',
                        support_email: 'support@nemionix.com'
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error fetching public settings:', error);
        // Return defaults on error
        res.json({
            success: true,
            data: {
                general: {
                    support_phone: '+880 1812-345678',
                    support_email: 'support@nemionix.com'
                }
            }
        });
    }
}));

module.exports = router;