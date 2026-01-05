// backend/routes/products.js
// Product routes for browsing, searching, filtering, and viewing products.
// GLOBAL REFERENCE: API Endpoints → /api/products/*, Product Structure
// PURPOSE: Public and authenticated product endpoints.

const express = require('express');
const router = express.Router();
const Product = require('../models/productModel');
const { asyncHandler } = require('../middleware/errorHandler');
const { optionalAuth, authenticate } = require('../middleware/auth');
const db = require('../config/database');

// @route   GET /api/products
// @desc    Get all products with filters
// @access  Public
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
    const filters = {
        club_id: req.query.club_id,
        category: req.query.category,
        search: req.query.search,
        min_price: req.query.min_price ? parseFloat(req.query.min_price) : undefined,
        max_price: req.query.max_price ? parseFloat(req.query.max_price) : undefined,
        in_stock: req.query.in_stock === 'true',
        condition: req.query.condition,
        sort_by: req.query.sort_by || 'created_at',
        order_by: req.query.order_by || 'DESC',
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 24
    };
    
    console.log('Fetching products with filters:', filters);
    
    const products = await Product.findAll(filters);
    
    console.log(`Found ${products.length} products`);
    
    // Get total count for pagination
    const totalCount = await Product.count({
        category: filters.category,
        club_id: filters.club_id
    });
    
    res.json({
        success: true,
        data: products,
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

// @route   GET /api/products/featured
// @desc    Get featured products
// @access  Public
router.get('/featured', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 8;
    const products = await Product.getFeatured(limit);
    
    res.json({
        success: true,
        data: products
    });
}));

// @route   GET /api/products/recommended
// @desc    Get recommended products
// @access  Public
router.get('/recommended', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 4;
    
    // Get top selling products as recommended
    const recommended = await Product.findAll({
        sort_by: 'sales_count',
        order_by: 'DESC',
        limit: limit,
        page: 1
    });
    
    res.json({
        success: true,
        data: recommended
    });
}));

// @route   GET /api/products/categories
// @desc    Get all product categories with counts
// @access  Public
router.get('/categories', asyncHandler(async (req, res) => {
    const categories = await db.getMany(`
        SELECT 
            category,
            COUNT(*) as product_count,
            MIN(price) as min_price,
            MAX(price) as max_price
        FROM products
        WHERE status = 'active' AND stock > 0
        GROUP BY category
        ORDER BY category
    `);
    
    res.json({
        success: true,
        data: categories
    });
}));

// @route   GET /api/products/search/suggestions
// @desc    Get search suggestions (autocomplete)
// @access  Public
router.get('/search/suggestions', asyncHandler(async (req, res) => {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
        return res.json({
            success: true,
            suggestions: []
        });
    }
    
    const suggestions = await db.getMany(`
        SELECT DISTINCT name, slug
        FROM products
        WHERE name ILIKE $1 AND status = 'active'
        ORDER BY sales_count DESC, views DESC
        LIMIT 5
    `, [`%${q}%`]);
    
    res.json({
        success: true,
        suggestions: suggestions.map(s => ({ name: s.name, slug: s.slug }))
    });
}));

// @route   GET /api/products/:id
// @desc    Get single product by ID
// @access  Public
router.get('/:id', asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found'
        });
    }
    
    // Get reviews with user info and images
    const reviews = await db.getMany(`
        SELECT 
            r.*,
            u.full_name as reviewer_name,
            u.avatar_url as reviewer_avatar,
            COALESCE(
                json_agg(
                    ri.image_url
                ) FILTER (WHERE ri.image_url IS NOT NULL),
                '[]'
            ) as images
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        LEFT JOIN review_images ri ON r.id = ri.review_id
        WHERE r.product_id = $1
        GROUP BY r.id, u.full_name, u.avatar_url
        ORDER BY r.created_at DESC
        LIMIT 10
    `, [product.id]);
    
    // Parse images
    reviews.forEach(review => {
        if (typeof review.images === 'string') {
            review.images = JSON.parse(review.images);
        }
    });
    
    product.reviews = reviews;
    
    // Get related competitions
    const relatedCompetitions = await db.getMany(`
        SELECT 
            c.id,
            c.title,
            c.slug,
            c.competition_date,
            c.registration_deadline,
            c.registration_fee
        FROM competitions c
        JOIN competition_products cp ON c.id = cp.competition_id
        WHERE cp.product_id = $1 
        AND c.status = 'active'
        AND c.competition_date >= CURRENT_DATE
        ORDER BY c.competition_date ASC
        LIMIT 3
    `, [product.id]);
    
    product.related_competitions = relatedCompetitions;
    
    res.json({
        success: true,
        data: product
    });
}));

// @route   POST /api/products/:id/views
// @desc    Increment product views
// @access  Public
router.post('/:id/views', asyncHandler(async (req, res) => {
    const productExists = await db.exists('products', 'id = $1', [req.params.id]);
    
    if (!productExists) {
        return res.status(404).json({
            success: false,
            message: 'Product not found'
        });
    }
    
    await Product.incrementViews(req.params.id);
    
    res.json({
        success: true,
        message: 'View counted'
    });
}));

// @route   GET /api/products/:id/related
// @desc    Get related products
// @access  Public
router.get('/:id/related', asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found'
        });
    }
    
    const limit = parseInt(req.query.limit) || 6;
    const related = await Product.getRelated(product.id, product.category, limit);
    
    res.json({
        success: true,
        data: related
    });
}));

// @route   POST /api/products/check-stock
// @desc    Check stock availability for multiple products
// @access  Public
router.post('/check-stock', asyncHandler(async (req, res) => {
    const { items } = req.body;
    
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({
            success: false,
            message: 'items array is required with format [{product_id, quantity}]'
        });
    }
    
    const stockChecks = [];
    
    for (const item of items) {
        const product = await db.getOne(
            'SELECT id, name, stock, price, status FROM products WHERE id = $1',
            [item.product_id]
        );
        
        if (!product) {
            stockChecks.push({
                product_id: item.product_id,
                available: false,
                reason: 'Product not found'
            });
        } else if (product.status !== 'active') {
            stockChecks.push({
                product_id: item.product_id,
                available: false,
                reason: 'Product not available'
            });
        } else if (product.stock < item.quantity) {
            stockChecks.push({
                product_id: item.product_id,
                available: false,
                reason: 'Insufficient stock',
                current_stock: product.stock,
                requested: item.quantity
            });
        } else {
            stockChecks.push({
                product_id: item.product_id,
                available: true,
                name: product.name,
                price: product.price,
                stock: product.stock
            });
        }
    }
    
    res.json({
        success: true,
        data: stockChecks
    });
}));

// @route   GET /api/products/category/:category
// @desc    Get products by category
// @access  Public
router.get('/category/:category', asyncHandler(async (req, res) => {
    const { category } = req.params;
    const limit = parseInt(req.query.limit) || 12;
    const page = parseInt(req.query.page) || 1;
    
    const products = await Product.findAll({
        category,
        page,
        limit,
        sort_by: req.query.sort_by || 'created_at',
        order_by: req.query.order_by || 'DESC'
    });
    
    const totalCount = await Product.count({ category });
    
    res.json({
        success: true,
        data: products,
        pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit)
        }
    });
}));

// @route   GET /api/products/club/:clubSlug
// @desc    Get products by club slug
// @access  Public
router.get('/club/:clubSlug', asyncHandler(async (req, res) => {
    const Club = require('../models/clubModel');
    const club = await Club.findBySlug(req.params.clubSlug);
    
    if (!club) {
        return res.status(404).json({
            success: false,
            message: 'Club not found'
        });
    }
    
    const limit = parseInt(req.query.limit) || 12;
    const page = parseInt(req.query.page) || 1;
    
    const products = await Product.findAll({
        club_id: club.id,
        page,
        limit,
        sort_by: req.query.sort_by || 'created_at',
        order_by: req.query.order_by || 'DESC'
    });
    
    const totalCount = await Product.count({ club_id: club.id });
    
    res.json({
        success: true,
        data: products,
        club: {
            id: club.id,
            name: club.club_name,
            slug: club.slug,
            logo_url: club.logo_url
        },
        pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit)
        }
    });
}));

module.exports = router;