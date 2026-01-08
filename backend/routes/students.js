// backend/routes/students.js
// Student-specific routes for cart management, registrations, and profile.
// GLOBAL REFERENCE: API Endpoints → /api/students/*
// PURPOSE: Student dashboard data, cart sync, and registration management.

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const db = require('../config/database');

// @route   GET /api/students/dashboard/stats
// @desc    Get student dashboard statistics
// @access  Private (Student)
router.get('/dashboard/stats', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    // Get order stats
    const orderStats = await db.getOne(`
        SELECT 
            COUNT(CASE WHEN order_status IN ('pending', 'confirmed', 'processing', 'shipped') THEN 1 END) as active_orders,
            COUNT(CASE WHEN order_status = 'delivered' THEN 1 END) as completed_orders,
            COUNT(*) as total_orders,
            COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN grand_total ELSE 0 END), 0) as total_spent
        FROM orders
        WHERE user_id = $1
    `, [req.user.id]);
    
    // Get upcoming competitions
    const upcomingCompetitions = await db.getOne(`
        SELECT COUNT(*) as count
        FROM competition_registrations cr
        JOIN competitions c ON cr.competition_id = c.id
        WHERE cr.user_id = $1 
            AND c.competition_date >= CURRENT_DATE
            AND cr.registration_status = 'approved'
    `, [req.user.id]);
    
    // Get cart items count
    const cartItems = await db.getOne(
        'SELECT COUNT(*) as count, COALESCE(SUM(ci.quantity), 0) as total_items FROM cart_items ci WHERE user_id = $1',
        [req.user.id]
    );
    
    // Get pending reviews count
    const pendingReviews = await db.getOne(`
        SELECT COUNT(DISTINCT oi.product_id) as count
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        LEFT JOIN reviews r ON oi.id = r.order_item_id AND r.user_id = $1
        WHERE o.user_id = $1 
            AND o.order_status = 'delivered'
            AND r.id IS NULL
    `, [req.user.id]);
    
    res.json({
        success: true,
        data: {
            active_orders: parseInt(orderStats.active_orders) || 0,
            completed_orders: parseInt(orderStats.completed_orders) || 0,
            total_orders: parseInt(orderStats.total_orders) || 0,
            total_spent: parseFloat(orderStats.total_spent) || 0,
            upcoming_competitions: parseInt(upcomingCompetitions.count) || 0,
            cart_items: parseInt(cartItems.total_items) || 0,
            pending_reviews: parseInt(pendingReviews.count) || 0
        }
    });
}));

// @route   GET /api/students/orders-stats
// @desc    Get orders statistics for profile page
// @access  Private (Student)
router.get('/orders-stats', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const stats = await db.getOne(`
        SELECT 
            COUNT(*) as total_orders,
            COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN grand_total ELSE 0 END), 0) as total_spent
        FROM orders
        WHERE user_id = $1
    `, [req.user.id]);
    
    res.json({
        success: true,
        total_orders: parseInt(stats.total_orders) || 0,
        total_spent: parseFloat(stats.total_spent) || 0
    });
}));

// @route   GET /api/students/competitions-stats
// @desc    Get competitions statistics for profile page
// @access  Private (Student)
router.get('/competitions-stats', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const stats = await db.getOne(`
        SELECT COUNT(*) as total_registrations
        FROM competition_registrations
        WHERE user_id = $1
    `, [req.user.id]);
    
    res.json({
        success: true,
        total_registrations: parseInt(stats.total_registrations) || 0
    });
}));

// @route   GET /api/students/reviews-stats
// @desc    Get reviews statistics for profile page
// @access  Private (Student)
router.get('/reviews-stats', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const stats = await db.getOne(`
        SELECT COUNT(*) as total_reviews
        FROM reviews
        WHERE user_id = $1
    `, [req.user.id]);
    
    res.json({
        success: true,
        total_reviews: parseInt(stats.total_reviews) || 0
    });
}));

// @route   GET /api/students/registrations
// @desc    Get student's competition registrations
// @access  Private (Student)
router.get('/registrations', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { status, limit } = req.query;
    
    let query = `
        SELECT 
            cr.*,
            c.id as competition_id,
            c.title as competition_title,
            c.banner_url as competition_banner,
            c.competition_date,
            c.competition_time,
            c.venue,
            c.club_id,
            cl.club_name
        FROM competition_registrations cr
        JOIN competitions c ON cr.competition_id = c.id
        JOIN clubs cl ON c.club_id = cl.id
        WHERE cr.user_id = $1
    `;
    
    const params = [req.user.id];
    
    if (status === 'upcoming') {
        query += ` AND c.competition_date >= CURRENT_DATE AND cr.registration_status != 'cancelled'`;
    } else if (status === 'past') {
        query += ` AND c.competition_date < CURRENT_DATE`;
    }
    
    query += ` ORDER BY cr.created_at DESC`;
    
    if (limit) {
        query += ` LIMIT ${parseInt(limit)}`;
    }
    
    const rows = await db.getMany(query, params);
    
    // Transform to expected structure
    const registrations = rows.map(row => ({
        id: row.id,
        team_name: row.team_name,
        team_members: row.team_members,
        phone: row.phone,
        registration_fee: row.registration_fee,
        payment_method: row.payment_method,
        payment_status: row.payment_status,
        registration_status: row.registration_status,
        created_at: row.created_at,
        competition: {
            id: row.competition_id,
            title: row.competition_title,
            banner_url: row.competition_banner,
            competition_date: row.competition_date,
            competition_time: row.competition_time,
            venue: row.venue,
            club_id: row.club_id,
            club_name: row.club_name
        }
    }));
    
    res.json({
        success: true,
        data: registrations,
        registrations: registrations
    });
}));

// @route   GET /api/students/cart
// @desc    Get cart items
// @access  Private (Any authenticated user)
router.get('/cart', authenticate, asyncHandler(async (req, res) => {
    console.log('===== GET CART REQUEST =====');
    console.log('User ID:', req.user.id);
    console.log('User Role:', req.user.role);
    
    const cartItems = await db.getMany(`
        SELECT 
            ci.*,
            p.name,
            p.price,
            p.original_price,
            p.stock,
            p.status,
            c.club_name,
            c.slug as club_slug,
            c.logo_url as club_logo,
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order LIMIT 1) as image_url
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        JOIN clubs c ON p.club_id = c.id
        WHERE ci.user_id = $1
        ORDER BY ci.created_at DESC
    `, [req.user.id]);
    
    console.log('Cart items found:', cartItems.length);
    
    // Calculate totals
    let subtotal = 0;
    let totalItems = 0;
    
    for (const item of cartItems) {
        if (item.status === 'active' && item.stock >= item.quantity) {
            subtotal += item.price * item.quantity;
            totalItems += item.quantity;
        }
    }
    
    res.json({
        success: true,
        cart: {
            items: cartItems,
            totalItems: totalItems,
            subtotal: subtotal,
            shipping: 0,
            total: subtotal
        },
        data: {
            items: cartItems,
            summary: {
                subtotal,
                total_items: totalItems,
                item_count: cartItems.length
            }
        }
    });
}));

// @route   POST /api/students/cart
// @desc    Add item to cart
// @access  Private (Any authenticated user)
router.post('/cart', authenticate, asyncHandler(async (req, res) => {
    console.log('===== ADD TO CART REQUEST =====');
    console.log('User ID:', req.user.id);
    console.log('User Role:', req.user.role);
    console.log('Request Body:', req.body);
    
    const { product_id, quantity } = req.body;
    
    if (!product_id || !quantity) {
        console.log('❌ Missing product_id or quantity');
        return res.status(400).json({
            success: false,
            message: 'Product ID and quantity are required'
        });
    }
    
    if (quantity < 1) {
        console.log('❌ Invalid quantity');
        return res.status(400).json({
            success: false,
            message: 'Quantity must be at least 1'
        });
    }
    
    // Check if product exists and is active
    const product = await db.getOne(
        'SELECT id, name, stock, status FROM products WHERE id = $1',
        [product_id]
    );
    
    console.log('Product found:', product);
    
    if (!product) {
        console.log('❌ Product not found');
        return res.status(404).json({
            success: false,
            message: 'Product not found'
        });
    }
    
    if (product.status !== 'active') {
        console.log('❌ Product not active');
        return res.status(400).json({
            success: false,
            message: 'Product is not available'
        });
    }
    
    // Check if item already in cart
    const existing = await db.getOne(
        'SELECT id, quantity FROM cart_items WHERE user_id = $1 AND product_id = $2',
        [req.user.id, product_id]
    );
    
    console.log('Existing cart item:', existing);
    
    if (existing) {
        // Update quantity
        const newQuantity = existing.quantity + quantity;
        
        if (newQuantity > product.stock) {
            console.log('❌ Exceeds stock');
            return res.status(400).json({
                success: false,
                message: `Cannot add more. Only ${product.stock} items available.`
            });
        }
        
        await db.query(
            'UPDATE cart_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newQuantity, existing.id]
        );
        
        console.log('✅ Updated existing cart item');
    } else {
        // Check stock
        if (quantity > product.stock) {
            console.log('❌ Quantity exceeds stock');
            return res.status(400).json({
                success: false,
                message: `Only ${product.stock} items available`
            });
        }
        
        // Insert new item
        await db.query(
            'INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)',
            [req.user.id, product_id, quantity]
        );
        
        console.log('✅ Inserted new cart item');
    }
    
    res.json({
        success: true,
        message: 'Item added to cart successfully'
    });
}));

// @route   PUT /api/students/cart/:id
// @desc    Update cart item quantity
// @access  Private (Any authenticated user)
router.put('/cart/:id', authenticate, asyncHandler(async (req, res) => {
    const { quantity } = req.body;
    
    if (!quantity || quantity < 1) {
        return res.status(400).json({
            success: false,
            message: 'Valid quantity is required (minimum 1)'
        });
    }
    
    // Get cart item with product info
    const cartItem = await db.getOne(`
        SELECT ci.*, p.stock, p.status
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        WHERE ci.id = $1 AND ci.user_id = $2
    `, [req.params.id, req.user.id]);
    
    if (!cartItem) {
        return res.status(404).json({
            success: false,
            message: 'Cart item not found'
        });
    }
    
    if (quantity > cartItem.stock) {
        return res.status(400).json({
            success: false,
            message: `Only ${cartItem.stock} items available`
        });
    }
    
    await db.query(
        'UPDATE cart_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
        [quantity, req.params.id, req.user.id]
    );
    
    res.json({
        success: true,
        message: 'Cart updated successfully'
    });
}));

// @route   DELETE /api/students/cart/:id
// @desc    Remove item from cart
// @access  Private (Any authenticated user)
router.delete('/cart/:id', authenticate, asyncHandler(async (req, res) => {
    const result = await db.query(
        'DELETE FROM cart_items WHERE id = $1 AND user_id = $2 RETURNING *',
        [req.params.id, req.user.id]
    );
    
    if (result.rows.length === 0) {
        return res.status(404).json({
            success: false,
            message: 'Cart item not found'
        });
    }
    
    res.json({
        success: true,
        message: 'Item removed from cart'
    });
}));

// @route   DELETE /api/students/cart
// @desc    Clear entire cart
// @access  Private (Any authenticated user)
router.delete('/cart', authenticate, asyncHandler(async (req, res) => {
    await db.query(
        'DELETE FROM cart_items WHERE user_id = $1',
        [req.user.id]
    );
    
    res.json({
        success: true,
        message: 'Cart cleared successfully'
    });
}));

// @route   POST /api/students/cart/sync
// @desc    Sync cart from frontend localStorage
// @access  Private (Student)
router.post('/cart/sync', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { items } = req.body;
    
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({
            success: false,
            message: 'Items array is required'
        });
    }
    
    // Clear existing cart
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
    
    // Insert new items (with validation)
    let syncedCount = 0;
    for (const item of items) {
        if (!item.product_id || !item.quantity) continue;
        
        // Check if product exists and is available
        const product = await db.getOne(
            'SELECT id, stock, status FROM products WHERE id = $1',
            [item.product_id]
        );
        
        if (product && product.status === 'active' && product.stock >= item.quantity) {
            await db.query(
                'INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)',
                [req.user.id, item.product_id, item.quantity]
            );
            syncedCount++;
        }
    }
    
    res.json({
        success: true,
        message: `Cart synced successfully. ${syncedCount} items synced.`,
        synced_items: syncedCount
    });
}));

// @route   GET /api/students/addresses
// @desc    Get saved addresses
// @access  Private (Student)
router.get('/addresses', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    // Check if table exists first
    const tableExists = await db.getOne(`
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'user_addresses'
        )
    `);
    
    if (!tableExists.exists) {
        return res.json({
            success: true,
            data: []
        });
    }
    
    const addresses = await db.getMany(
        'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
        [req.user.id]
    );
    
    res.json({
        success: true,
        data: addresses
    });
}));

// @route   POST /api/students/addresses
// @desc    Add new address
// @access  Private (Student)
router.post('/addresses', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { full_name, phone, address, city, district, division, postal_code, is_default } = req.body;
    
    if (!full_name || !phone || !address || !city || !district || !division || !postal_code) {
        return res.status(400).json({
            success: false,
            message: 'All address fields are required'
        });
    }
    
    // Validate phone
    const phoneRegex = /^01[3-9]\d{8}$/;
    if (!phoneRegex.test(phone)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid phone number format'
        });
    }
    
    // If setting as default, unset other defaults first
    if (is_default) {
        await db.query(
            'UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1',
            [req.user.id]
        );
    }
    
    const newAddress = await db.insertOne('user_addresses', {
        user_id: req.user.id,
        full_name,
        phone,
        address,
        city,
        district,
        division,
        postal_code,
        is_default: is_default || false
    });
    
    res.status(201).json({
        success: true,
        message: 'Address added successfully',
        data: newAddress
    });
}));

// @route   PUT /api/students/addresses/:id
// @desc    Update address
// @access  Private (Student)
router.put('/addresses/:id', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { full_name, phone, address, city, district, division, postal_code, is_default } = req.body;
    
    // If setting as default, unset other defaults first
    if (is_default) {
        await db.query(
            'UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1 AND id != $2',
            [req.user.id, req.params.id]
        );
    }
    
    const updates = {};
    if (full_name) updates.full_name = full_name;
    if (phone) updates.phone = phone;
    if (address) updates.address = address;
    if (city) updates.city = city;
    if (district) updates.district = district;
    if (division) updates.division = division;
    if (postal_code) updates.postal_code = postal_code;
    if (is_default !== undefined) updates.is_default = is_default;
    
    const updated = await db.updateOne('user_addresses', req.params.id, updates);
    
    res.json({
        success: true,
        message: 'Address updated successfully',
        data: updated
    });
}));

// @route   DELETE /api/students/addresses/:id
// @desc    Delete address
// @access  Private (Student)
router.delete('/addresses/:id', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    await db.query(
        'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
    );
    
    res.json({
        success: true,
        message: 'Address deleted successfully'
    });
}));

// @route   GET /api/students/orders
// @desc    Get student's orders with filtering
// @access  Private (Student)
router.get('/orders', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { 
        status, 
        search, 
        sort_by = 'created_at', 
        order_by = 'desc',
        date_from,
        date_to,
        page = 1, 
        limit = 10 
    } = req.query;
    
    let query = `
        SELECT 
            o.id,
            o.order_number,
            o.total_amount,
            o.shipping_cost,
            o.grand_total,
            o.payment_method,
            o.payment_status,
            o.order_status,
            o.delivery_name,
            o.delivery_phone,
            o.delivery_address,
            o.delivery_city,
            o.delivery_district,
            o.created_at,
            o.updated_at
        FROM orders o
        WHERE o.user_id = $1
    `;
    
    const params = [req.user.id];
    let paramCount = 1;
    
    // Filter by status
    if (status && status !== 'all') {
        paramCount++;
        query += ` AND o.order_status = $${paramCount}`;
        params.push(status);
    }
    
    // Filter by search
    if (search) {
        paramCount++;
        query += ` AND (o.order_number ILIKE $${paramCount} OR o.delivery_name ILIKE $${paramCount})`;
        params.push(`%${search}%`);
    }
    
    // Filter by date range
    if (date_from) {
        paramCount++;
        query += ` AND o.created_at >= $${paramCount}`;
        params.push(date_from);
    }
    
    if (date_to) {
        paramCount++;
        query += ` AND o.created_at <= $${paramCount}`;
        params.push(date_to + ' 23:59:59');
    }
    
    // Sort
    const validSortFields = ['created_at', 'grand_total', 'order_status'];
    const validOrderBy = ['asc', 'desc'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const orderDirection = validOrderBy.includes(order_by.toLowerCase()) ? order_by.toUpperCase() : 'DESC';
    
    query += ` ORDER BY o.${sortField} ${orderDirection}`;
    
    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);
    
    const orders = await db.getMany(query, params);
    
    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM orders o WHERE o.user_id = $1`;
    const countResult = await db.getOne(countQuery, [req.user.id]);
    
    // Get items for each order
    for (let order of orders) {
        const items = await db.getMany(`
            SELECT 
                oi.id,
                oi.product_id,
                oi.product_name,
                oi.club_id,
                oi.price,
                oi.quantity,
                oi.subtotal,
                oi.status,
                c.club_name,
                (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order LIMIT 1) as product_image
            FROM order_items oi
            LEFT JOIN clubs c ON oi.club_id = c.id
            WHERE oi.order_id = $1
        `, [order.id]);
        
        order.items = items;
        
        // Check if all items reviewed
        const reviewedCount = await db.getOne(`
            SELECT COUNT(*) as count 
            FROM reviews r
            JOIN order_items oi ON r.order_item_id = oi.id
            WHERE oi.order_id = $1 AND r.user_id = $2
        `, [order.id, req.user.id]);
        
        order.all_reviewed = parseInt(reviewedCount.count) >= items.length;
    }
    
    res.json({
        success: true,
        data: orders,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.total) || 0
        }
    });
}));

// @route   POST /api/students/apply-coupon
// @desc    Apply coupon code to cart
// @access  Private
router.post('/apply-coupon', authenticate, asyncHandler(async (req, res) => {
    const { code, cart_total } = req.body;
    
    if (!code) {
        return res.status(400).json({
            success: false,
            message: 'Coupon code is required'
        });
    }
    
    // Validate coupon code (hardcoded for now - you can add a coupons table later)
    const validCoupons = {
        'WELCOME10': { discount: 0.10, min_amount: 500, max_discount: 100 },
        'ROBOT20': { discount: 0.20, min_amount: 1000, max_discount: 200 },
        'SAVE50': { discount: 50, min_amount: 300, max_discount: 50 }, // Fixed amount
        'FREESHIP': { discount: 0, min_amount: 0, max_discount: 0, free_shipping: true }
    };
    
    const coupon = validCoupons[code.toUpperCase()];
    
    if (!coupon) {
        return res.status(400).json({
            success: false,
            message: 'Invalid coupon code'
        });
    }
    
    if (cart_total < coupon.min_amount) {
        return res.status(400).json({
            success: false,
            message: `Minimum cart value of ৳${coupon.min_amount} required for this coupon`
        });
    }
    
    // Calculate discount
    let discount_amount = 0;
    
    if (coupon.free_shipping) {
        // Free shipping coupon
        discount_amount = 0; // Frontend will handle free shipping
    } else if (coupon.discount < 1) {
        // Percentage discount
        discount_amount = Math.min(cart_total * coupon.discount, coupon.max_discount);
    } else {
        // Fixed amount discount
        discount_amount = Math.min(coupon.discount, coupon.max_discount);
    }
    
    res.json({
        success: true,
        data: {
            success: true,
            code: code.toUpperCase(),
            discount_amount: Math.round(discount_amount),
            free_shipping: coupon.free_shipping || false,
            message: `Coupon applied successfully! You saved ৳${Math.round(discount_amount)}`
        }
    });
}));

module.exports = router;