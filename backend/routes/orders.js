// backend/routes/orders.js
// Order routes for creating orders, tracking, and student order management.
// GLOBAL REFERENCE: API Endpoints → /api/orders/*, Order Structure
// PURPOSE: Student order creation, tracking, and review submission.

const express = require('express');
const router = express.Router();
const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadImage } = require('../config/cloudinary');
const { sendOrderConfirmation } = require('../config/email');
const db = require('../config/database');

// @route   POST /api/orders
// @desc    Create new order
// @access  Private (Student)
router.post('/', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { 
        items, 
        delivery_info, 
        payment_method, 
        payment_screenshot, 
        transaction_id 
    } = req.body;
    
    // Validate
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Cart is empty'
        });
    }
    
    if (!delivery_info) {
        return res.status(400).json({
            success: false,
            message: 'Delivery information is required'
        });
    }
    
    // Validate delivery info fields
    const requiredFields = ['full_name', 'phone', 'address', 'city', 'district', 'division', 'postal_code'];
    for (const field of requiredFields) {
        if (!delivery_info[field]) {
            return res.status(400).json({
                success: false,
                message: `Delivery ${field} is required`
            });
        }
    }
    
    // Validate payment method
    if (!['cash_on_delivery', 'bkash', 'nagad'].includes(payment_method)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid payment method'
        });
    }
    
    // Check stock availability and get product details
    const orderItems = [];
    let subtotal = 0;
    
    for (const item of items) {
        const product = await Product.findById(item.product_id);
        
        if (!product) {
            return res.status(400).json({
                success: false,
                message: `Product ${item.product_id} not found`
            });
        }
        
        if (product.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `Product ${product.name} is not available`
            });
        }
        
        if (product.stock < item.quantity) {
            return res.status(400).json({
                success: false,
                message: `Insufficient stock for ${product.name}. Only ${product.stock} available.`
            });
        }
        
        const itemSubtotal = product.price * item.quantity;
        subtotal += itemSubtotal;
        
        orderItems.push({
            product_id: product.id,
            club_id: product.club_id,
            product_name: product.name,
            price: product.price,
            quantity: item.quantity,
            subtotal: itemSubtotal
        });
    }
    
    // Calculate shipping cost (district-based)
    const dhakaDistricts = ['Dhaka', 'Gazipur', 'Narayanganj', 'Narsingdi', 'Manikganj', 'Munshiganj'];
    const shippingCost = dhakaDistricts.includes(delivery_info.district) ? 60 : 100;
    
    const grandTotal = subtotal + shippingCost;
    
    // Upload payment screenshot if provided
    let screenshotUrl = null;
    if (payment_screenshot && payment_method !== 'cash_on_delivery') {
        try {
            const buffer = Buffer.from(payment_screenshot.split(',')[1], 'base64');
            const upload = await uploadImage(buffer, { 
                folder: 'robotics-marketplace/payment-screenshots',
                public_id: `payment_${req.user.id}_${Date.now()}`
            });
            screenshotUrl = upload.url;
        } catch (error) {
            console.error('Payment screenshot upload failed:', error);
        }
    }
    
    // Create order
    const order = await Order.create({
        user_id: req.user.id,
        items: orderItems,
        total_amount: subtotal,
        shipping_cost: shippingCost,
        grand_total: grandTotal,
        payment_method,
        payment_screenshot_url: screenshotUrl,
        transaction_id: transaction_id || null,
        payment_status: payment_method === 'cash_on_delivery' ? 'pending' : 'pending',
        delivery_name: delivery_info.full_name,
        delivery_phone: delivery_info.phone,
        delivery_address: delivery_info.address,
        delivery_city: delivery_info.city,
        delivery_district: delivery_info.district,
        delivery_division: delivery_info.division,
        delivery_postal_code: delivery_info.postal_code
    });
    
    // Get full order details with items
    const fullOrder = await Order.findById(order.id);
    
    // Send confirmation email
    try {
        await sendOrderConfirmation(fullOrder, req.user);
    } catch (emailError) {
        console.error('Order confirmation email failed:', emailError);
    }
    
    // Clear user's cart
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
    
    res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        data: {
            order_number: order.order_number,
            order_id: order.id,
            grand_total: order.grand_total,
            payment_method: order.payment_method,
            created_at: order.created_at
        }
    });
}));

// @route   GET /api/orders/my-orders
// @desc    Get user's orders with full item details
// @access  Private (Student)
router.get('/my-orders', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const filters = {
        status: req.query.status,
        search: req.query.search,
        sort_by: req.query.sort_by || 'created_at',
        order_by: req.query.order_by || 'desc',
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 10
    };
    
    const orders = await Order.findByUserId(req.user.id, filters);
    
    // Get full details for each order including items
    const ordersWithItems = await Promise.all(
        orders.map(async (order) => {
            const fullOrder = await Order.findById(order.id);
            return fullOrder;
        })
    );
    
    const totalCount = await Order.count({ user_id: req.user.id, status: filters.status });
    
    res.json({
        success: true,
        data: ordersWithItems,
        total: totalCount,
        page: filters.page,
        limit: filters.limit,
        pagination: {
            page: filters.page,
            limit: filters.limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / filters.limit)
        }
    });
}));

// @route   GET /api/orders/:orderNumber
// @desc    Get order details by order number
// @access  Private
router.get('/:orderNumber', authenticate, asyncHandler(async (req, res) => {
    const order = await Order.findByOrderNumber(req.params.orderNumber);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: 'Order not found'
        });
    }
    
    // Check ownership (student) or club access (club admin with items in order)
    if (req.user.role === 'student') {
        if (order.user_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
    } else if (req.user.role === 'club_admin') {
        // Check if any items belong to this club
        const hasClubItems = order.items.some(item => item.club_id === req.user.club_id);
        if (!hasClubItems) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
    }
    
    // Get tracking info from first shipped item
    const shippedItem = order.items.find(item => item.tracking_number);
    if (shippedItem) {
        order.tracking_number = shippedItem.tracking_number;
        order.courier_name = shippedItem.courier_name;
    }
    
    res.json({
        success: true,
        data: order
    });
}));

// @route   PUT /api/orders/:id/confirm-delivery
// @desc    Confirm order delivery
// @access  Private (Student)
router.put('/:id/confirm-delivery', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: 'Order not found'
        });
    }
    
    if (order.user_id !== req.user.id) {
        return res.status(403).json({
            success: false,
            message: 'Access denied'
        });
    }
    
    if (order.order_status !== 'shipped') {
        return res.status(400).json({
            success: false,
            message: 'Order must be in shipped status to confirm delivery'
        });
    }
    
    await Order.confirmDelivery(req.params.id);
    
    res.json({
        success: true,
        message: 'Delivery confirmed successfully. You can now review the products.'
    });
}));

// @route   GET /api/orders/:id/reviewable-items
// @desc    Get items from delivered order that haven't been reviewed yet
// @access  Private (Student)
router.get('/:id/reviewable-items', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    // Get order
    const order = await Order.findById(req.params.id);
    
    if (!order || order.user_id !== req.user.id) {
        return res.status(403).json({
            success: false,
            message: 'Access denied'
        });
    }
    
    if (order.order_status !== 'delivered') {
        return res.status(400).json({
            success: false,
            message: 'Can only review delivered orders'
        });
    }
    
    // Get items that haven't been reviewed
    const reviewableItems = [];
    
    for (const item of order.items) {
        // Check if already reviewed
        const existingReview = await db.getOne(
            'SELECT id FROM reviews WHERE order_item_id = $1 AND user_id = $2',
            [item.id, req.user.id]
        );
        
        if (!existingReview) {
            reviewableItems.push({
                id: item.id,
                product_id: item.product_id,
                product_name: item.product_name,
                product_image: item.product_image,
                club_id: item.club_id,
                club_name: item.club_name,
                price: item.price,
                quantity: item.quantity
            });
        }
    }
    
    res.json({
        success: true,
        items: reviewableItems
    });
}));

// @route   POST /api/orders/:id/review
// @desc    Add review for delivered order items
// @access  Private (Student)
router.post('/:id/review', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { product_id, rating, review_text, images } = req.body;
    
    if (!product_id || !rating) {
        return res.status(400).json({
            success: false,
            message: 'Product ID and rating are required'
        });
    }
    
    if (rating < 1 || rating > 5) {
        return res.status(400).json({
            success: false,
            message: 'Rating must be between 1 and 5'
        });
    }
    
    // Get order
    const order = await Order.findById(req.params.id);
    
    if (!order || order.user_id !== req.user.id) {
        return res.status(403).json({
            success: false,
            message: 'Access denied'
        });
    }
    
    if (order.order_status !== 'delivered') {
        return res.status(400).json({
            success: false,
            message: 'Can only review delivered orders'
        });
    }
    
    // Find the order item
    const orderItem = order.items.find(item => item.product_id === product_id);
    if (!orderItem) {
        return res.status(400).json({
            success: false,
            message: 'Product not found in this order'
        });
    }
    
    // Check if already reviewed
    const existingReview = await db.getOne(
        'SELECT id FROM reviews WHERE order_item_id = $1 AND user_id = $2',
        [orderItem.id, req.user.id]
    );
    
    if (existingReview) {
        return res.status(400).json({
            success: false,
            message: 'You have already reviewed this product'
        });
    }
    
    // Upload review images if provided
    let imageUrls = [];
    if (images && Array.isArray(images) && images.length > 0) {
        for (const imageBase64 of images.slice(0, 5)) { // Max 5 images
            try {
                const buffer = Buffer.from(imageBase64.split(',')[1], 'base64');
                const upload = await uploadImage(buffer, { 
                    folder: 'robotics-marketplace/review-images',
                    public_id: `review_${req.user.id}_${Date.now()}`
                });
                imageUrls.push(upload.url);
            } catch (error) {
                console.error('Review image upload failed:', error);
            }
        }
    }
    
    // Create review
    const review = await db.insertOne('reviews', {
        product_id: product_id,
        user_id: req.user.id,
        order_item_id: orderItem.id,
        rating,
        review_text: review_text || null,
        is_verified_purchase: true
    });
    
    // Insert review images
    for (const imageUrl of imageUrls) {
        await db.query(
            'INSERT INTO review_images (review_id, image_url) VALUES ($1, $2)',
            [review.id, imageUrl]
        );
    }
    
    // Update product average rating
    await Product.updateAverageRating(product_id);
    
    // Update club average rating
    const Club = require('../models/clubModel');
    await Club.updateAverageRating(orderItem.club_id);
    
    // Award reward points to club for 5-star review
    if (rating === 5) {
        const Reward = require('../models/rewardModel');
        const product = await Product.findById(product_id);
        await Reward.awardReviewPoints(orderItem.club_id, review.id, product.name);
    }
    
    res.json({
        success: true,
        message: 'Review submitted successfully. Thank you for your feedback!',
        data: {
            review_id: review.id,
            rating: review.rating
        }
    });
}));
// @desc    Add review for delivered order items
// @access  Private (Student)
router.post('/:id/review', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { product_id, rating, review_text, images } = req.body;
    
    if (!product_id || !rating) {
        return res.status(400).json({
            success: false,
            message: 'Product ID and rating are required'
        });
    }
    
    if (rating < 1 || rating > 5) {
        return res.status(400).json({
            success: false,
            message: 'Rating must be between 1 and 5'
        });
    }
    
    // Get order
    const order = await Order.findById(req.params.id);
    
    if (!order || order.user_id !== req.user.id) {
        return res.status(403).json({
            success: false,
            message: 'Access denied'
        });
    }
    
    if (order.order_status !== 'delivered') {
        return res.status(400).json({
            success: false,
            message: 'Can only review delivered orders'
        });
    }
    
    // Find the order item
    const orderItem = order.items.find(item => item.product_id === product_id);
    if (!orderItem) {
        return res.status(400).json({
            success: false,
            message: 'Product not found in this order'
        });
    }
    
    // Check if already reviewed
    const existingReview = await db.getOne(
        'SELECT id FROM reviews WHERE order_item_id = $1 AND user_id = $2',
        [orderItem.id, req.user.id]
    );
    
    if (existingReview) {
        return res.status(400).json({
            success: false,
            message: 'You have already reviewed this product'
        });
    }
    
    // Upload review images if provided
    let imageUrls = [];
    if (images && Array.isArray(images) && images.length > 0) {
        for (const imageBase64 of images.slice(0, 5)) { // Max 5 images
            try {
                const buffer = Buffer.from(imageBase64.split(',')[1], 'base64');
                const upload = await uploadImage(buffer, { 
                    folder: 'robotics-marketplace/review-images',
                    public_id: `review_${req.user.id}_${Date.now()}`
                });
                imageUrls.push(upload.url);
            } catch (error) {
                console.error('Review image upload failed:', error);
            }
        }
    }
    
    // Create review
    const review = await db.insertOne('reviews', {
        product_id: product_id,
        user_id: req.user.id,
        order_item_id: orderItem.id,
        rating,
        review_text: review_text || null,
        is_verified_purchase: true
    });
    
    // Insert review images
    for (const imageUrl of imageUrls) {
        await db.query(
            'INSERT INTO review_images (review_id, image_url) VALUES ($1, $2)',
            [review.id, imageUrl]
        );
    }
    
    // Update product average rating
    await Product.updateAverageRating(product_id);
    
    // Update club average rating
    const Club = require('../models/clubModel');
    await Club.updateAverageRating(orderItem.club_id);
    
    // Award reward points to club for 5-star review
    if (rating === 5) {
        const Reward = require('../models/rewardModel');
        const product = await Product.findById(product_id);
        await Reward.awardReviewPoints(orderItem.club_id, review.id, product.name);
    }
    
    res.json({
        success: true,
        message: 'Review submitted successfully. Thank you for your feedback!',
        data: {
            review_id: review.id,
            rating: review.rating
        }
    });
}));

// @route   PUT /api/orders/:id/cancel
// @desc    Cancel order
// @access  Private (Student)
router.put('/:id/cancel', authenticate, authorize('student'), asyncHandler(async (req, res) => {
    const { cancellation_reason } = req.body;
    
    const order = await Order.findById(req.params.id);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: 'Order not found'
        });
    }
    
    if (order.user_id !== req.user.id) {
        return res.status(403).json({
            success: false,
            message: 'Access denied'
        });
    }
    
    if (!['pending', 'confirmed'].includes(order.order_status)) {
        return res.status(400).json({
            success: false,
            message: 'Only pending or confirmed orders can be cancelled'
        });
    }
    
    // Update order status to cancelled
    await db.query(
        `UPDATE orders SET order_status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id]
    );
    
    // Update all order items to cancelled
    await db.query(
        `UPDATE order_items SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
        [req.params.id]
    );
    
    // Restore product stock
    for (const item of order.items) {
        await db.query(
            `UPDATE products SET stock = stock + $1 WHERE id = $2`,
            [item.quantity, item.product_id]
        );
    }
    
    res.json({
        success: true,
        message: 'Order cancelled successfully'
    });
}));

// @route   GET /api/orders/:orderNumber/invoice
// @desc    Get order invoice data
// @access  Private
router.get('/:orderNumber/invoice', authenticate, asyncHandler(async (req, res) => {
    const order = await Order.findByOrderNumber(req.params.orderNumber);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: 'Order not found'
        });
    }
    
    // Check access
    if (req.user.role === 'student' && order.user_id !== req.user.id) {
        return res.status(403).json({
            success: false,
            message: 'Access denied'
        });
    }
    
    // Return invoice data (frontend can generate PDF)
    res.json({
        success: true,
        data: {
            order_number: order.order_number,
            order_date: order.created_at,
            customer: {
                name: order.user_name,
                email: order.user_email,
                phone: order.user_phone
            },
            delivery: {
                name: order.delivery_name,
                phone: order.delivery_phone,
                address: order.delivery_address,
                city: order.delivery_city,
                district: order.delivery_district,
                postal_code: order.delivery_postal_code
            },
            items: order.items,
            subtotal: order.total_amount,
            shipping: order.shipping_cost,
            total: order.grand_total,
            payment_method: order.payment_method,
            payment_status: order.payment_status
        }
    });
}));

module.exports = router;