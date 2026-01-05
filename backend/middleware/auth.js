// backend/middleware/auth.js
// Authentication middleware for protecting routes and role-based access control.
// GLOBAL REFERENCE: User Object Structure, JWT Configuration, API Endpoints → Authentication
// PURPOSE: Verify JWT tokens, attach user to request, enforce role-based access.

const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Verify JWT token and attach user to request
async function authenticate(req, res, next) {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }
        
        const token = authHeader.split(' ')[1];
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const user = await db.getOne(
            'SELECT id, email, full_name, phone, role, is_verified, university, student_id, department, avatar_url FROM users WHERE id = $1',
            [decoded.userId]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Check if email is verified (DISABLED FOR TESTING)
        // TODO: Enable email verification requirement in production
        // if (!user.is_verified) {
        //     return res.status(403).json({
        //         success: false,
        //         message: 'Please verify your email first'
        //     });
        // }
        
        // If user is club_admin, attach club information
        if (user.role === 'club_admin') {
            const club = await db.getOne(
                'SELECT id, club_name, slug, status FROM clubs WHERE user_id = $1',
                [user.id]
            );
            
            if (club) {
                user.club_id = club.id;
                user.club_name = club.club_name;
                user.club_slug = club.slug;
                user.club_status = club.status;
            }
        }
        
        // Attach user to request
        req.user = user;
        next();
        
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }
        
        console.error('Authentication error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication failed'
        });
    }
}

// Require specific role(s)
function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Insufficient permissions.'
            });
        }
        
        next();
    };
}

// Optional authentication (attach user if token present, but don't require it)
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            const user = await db.getOne(
                'SELECT id, email, full_name, phone, role, is_verified FROM users WHERE id = $1',
                [decoded.userId]
            );
            
            if (user && user.is_verified) {
                // Attach club info if club_admin
                if (user.role === 'club_admin') {
                    const club = await db.getOne(
                        'SELECT id, club_name, slug FROM clubs WHERE user_id = $1',
                        [user.id]
                    );
                    
                    if (club) {
                        user.club_id = club.id;
                        user.club_name = club.club_name;
                        user.club_slug = club.slug;
                    }
                }
                
                req.user = user;
            }
        }
        
        next();
    } catch (error) {
        // Continue without user if token invalid or expired
        next();
    }
}

// Check if user owns club (for club admin routes)
async function authorizeClubAdmin(req, res, next) {
    try {
        if (req.user.role !== 'club_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only club admins can access this resource'
            });
        }
        
        // Get club for this user
        const club = await db.getOne(
            'SELECT * FROM clubs WHERE user_id = $1 AND status = $2',
            [req.user.id, 'approved']
        );
        
        if (!club) {
            return res.status(403).json({
                success: false,
                message: 'Your club is not approved or does not exist'
            });
        }
        
        // Attach club to request
        req.club = club;
        next();
        
    } catch (error) {
        console.error('Club authorization error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authorization failed'
        });
    }
}

// Check if club owns resource (product, competition, order)
function authorizeClubResource(resourceTable, resourceIdParam = 'id') {
    return async (req, res, next) => {
        try {
            const resourceId = req.params[resourceIdParam];
            const clubId = req.club.id;
            
            // Validate resource ID
            if (!resourceId || isNaN(resourceId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid resource ID'
                });
            }
            
            const resource = await db.getOne(
                `SELECT * FROM ${resourceTable} WHERE id = $1 AND club_id = $2`,
                [resourceId, clubId]
            );
            
            if (!resource) {
                return res.status(404).json({
                    success: false,
                    message: 'Resource not found or access denied'
                });
            }
            
            req.resource = resource;
            next();
            
        } catch (error) {
            console.error('Resource authorization error:', error);
            return res.status(500).json({
                success: false,
                message: 'Authorization failed'
            });
        }
    };
}

// Check if user owns order item (for reviews)
async function authorizeOrderOwnership(req, res, next) {
    try {
        const orderId = req.params.orderId || req.body.order_id;
        
        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required'
            });
        }
        
        const order = await db.getOne(
            'SELECT id, user_id, order_status FROM orders WHERE id = $1',
            [orderId]
        );
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.user_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. This is not your order.'
            });
        }
        
        // Only allow reviews for delivered orders
        if (order.order_status !== 'delivered') {
            return res.status(400).json({
                success: false,
                message: 'Can only review delivered orders'
            });
        }
        
        req.order = order;
        next();
        
    } catch (error) {
        console.error('Order ownership check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authorization failed'
        });
    }
}

// Rate limiting helper (to be used with route-specific middleware)
const requestCounts = new Map();

function rateLimit(maxRequests = 100, windowMs = 15 * 60 * 1000) {
    return (req, res, next) => {
        const identifier = req.user ? req.user.id : req.ip;
        const now = Date.now();
        const windowStart = now - windowMs;
        
        // Get or create request log for this identifier
        if (!requestCounts.has(identifier)) {
            requestCounts.set(identifier, []);
        }
        
        const requests = requestCounts.get(identifier);
        
        // Remove old requests outside the time window
        const recentRequests = requests.filter(timestamp => timestamp > windowStart);
        
        if (recentRequests.length >= maxRequests) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.'
            });
        }
        
        // Add current request
        recentRequests.push(now);
        requestCounts.set(identifier, recentRequests);
        
        next();
    };
}

// Clean up old rate limit data periodically
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [identifier, requests] of requestCounts.entries()) {
        const recentRequests = requests.filter(timestamp => timestamp > now - oneHour);
        
        if (recentRequests.length === 0) {
            requestCounts.delete(identifier);
        } else {
            requestCounts.set(identifier, recentRequests);
        }
    }
}, 60 * 60 * 1000); // Clean up every hour

module.exports = {
    authenticate,
    protect: authenticate, // Add alias for protect
    authorize,
    optionalAuth,
    authorizeClubAdmin,
    authorizeClubResource,
    authorizeOrderOwnership,
    rateLimit
};