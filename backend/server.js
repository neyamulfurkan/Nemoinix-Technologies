// backend/server.js
// Main Express.js server file - entry point for the entire backend application
// GLOBAL REFERENCE: File Tree Structure, API Endpoints Structure, Environment Variables, Middleware requirements
// PURPOSE: Initialize Express server, configure middleware, register routes, connect database, start listening

// Import dependencies
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

// Import configuration
const { connectDatabase, closePool } = require('./config/database');

// Import middleware
const errorHandler = require('./middleware/errorHandler').errorHandler;

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const competitionRoutes = require('./routes/competitions');
const clubRoutes = require('./routes/clubs');
const orderRoutes = require('./routes/orders');
const studentRoutes = require('./routes/students');
const clubAdminRoutes = require('./routes/club-admin');
const superAdminRoutes = require('./routes/super-admin');
const uploadRoutes = require('./routes/upload');

// Initialize Express app
const app = express();

// Trust proxy (for deployment behind reverse proxy)
app.set('trust proxy', 1);

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, Postman, or same-origin)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'https://nemionix-technologies.onrender.com',
            process.env.FRONTEND_URL
        ].filter(Boolean);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(null, true); // Allow all origins in development
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware (ORDER IS CRITICAL!)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false
})); // Security headers
app.use(cors(corsOptions)); // CORS
app.use(morgan('dev')); // HTTP request logging
app.use(express.json({ limit: '10mb' })); // JSON body parser
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // URL-encoded body parser

// Serve static files (frontend) - serve parent directory which contains HTML files
app.use(express.static(path.join(__dirname, '..')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API information endpoint
app.get('/api', (req, res) => {
    res.status(200).json({
        name: 'Bangladesh Robotics Marketplace API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            auth: '/api/auth',
            products: '/api/products',
            competitions: '/api/competitions',
            clubs: '/api/clubs',
            orders: '/api/orders',
            students: '/api/students',
            clubAdmin: '/api/club-admin',
            superAdmin: '/api/super-admin'
        }
    });
});

// API Routes (SPECIFIC ROUTES FIRST - Order matters!)
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/club-admin', clubAdminRoutes); // MUST be before /api/products to catch /api/club-admin/products
app.use('/api/clubs', clubRoutes);
app.use('/api/products', productRoutes);
app.use('/api/competitions', competitionRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/super-admin', superAdminRoutes);

// 404 handler for API routes only
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            message: 'API endpoint not found',
            path: req.originalUrl
        });
    }
    next();
});



// Global error handler (MUST BE LAST)
app.use(errorHandler);

// Database connection and server start
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Validate required environment variables
        const requiredEnvVars = [
            'DB_HOST',
            'DB_NAME',
            'DB_USER',
            'DB_PASSWORD',
            'JWT_SECRET'
        ];

        const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
            console.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
            console.warn('⚠️  Server will start but some features may not work properly.');
        }

        // Check Cloudinary configuration
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            console.warn('⚠️  Cloudinary credentials not configured. Image uploads will fail.');
        }

        // Connect to database
        await connectDatabase();
        console.log('✅ Database connected successfully');
        
        // Start server
        const server = app.listen(PORT, () => {
            console.log('\n🚀 Server started successfully');
            console.log('================================');
            console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🌐 Server URL: http://localhost:${PORT}`);
            console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
            console.log(`🔗 API Base: http://localhost:${PORT}/api`);
            console.log(`❤️  Health Check: http://localhost:${PORT}/health`);
            console.log('================================\n');
        });

        // Graceful shutdown handler
        const gracefulShutdown = () => {
            console.log('\n👋 Received shutdown signal, closing gracefully...');
            
            server.close(() => {
                console.log('✅ HTTP server closed');
                
                // Close database connections
                closePool().then(() => {
                    console.log('✅ Database connections closed');
                    console.log('👋 Goodbye!');
                    process.exit(0);
                }).catch(err => {
                    console.error('❌ Error closing database:', err);
                    process.exit(1);
                });
            });

            // Force close after 10 seconds
            setTimeout(() => {
                console.error('⚠️  Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };

        // Handle shutdown signals
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);

    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Promise Rejection:', err);
    console.error('Stack:', err.stack);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    console.error('Stack:', err.stack);
    process.exit(1);
});

// Start the server
startServer();

module.exports = app;