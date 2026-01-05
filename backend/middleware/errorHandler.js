// backend/middleware/errorHandler.js
// Global error handling middleware for consistent error responses.
// GLOBAL REFERENCE: API Response Structure, Error Handling
// PURPOSE: Catch all errors, log them, and return consistent JSON error responses.

// Custom error class
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        
        Error.captureStackTrace(this, this.constructor);
    }
}

// Global error handler middleware
function errorHandler(err, req, res, next) {
    let error = { ...err };
    error.message = err.message;
    error.statusCode = err.statusCode || 500;
    
    // Log error for debugging
    console.error('Error:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        user: req.user?.id || 'Not authenticated',
        body: req.method !== 'GET' ? req.body : undefined,
        timestamp: new Date().toISOString()
    });
    
    // PostgreSQL errors
    if (err.code) {
        // Unique violation (duplicate key)
        if (err.code === '23505') {
            const field = err.detail ? err.detail.match(/Key \((.*?)\)/)?.[1] : 'field';
            error.message = `Duplicate value for ${field}. This ${field} is already in use.`;
            error.statusCode = 400;
        }
        
        // Foreign key violation
        if (err.code === '23503') {
            error.message = 'Referenced resource does not exist';
            error.statusCode = 400;
        }
        
        // Not null violation
        if (err.code === '23502') {
            const column = err.column || 'field';
            error.message = `Missing required field: ${column}`;
            error.statusCode = 400;
        }
        
        // Check violation
        if (err.code === '23514') {
            error.message = 'Invalid data: constraint violation';
            error.statusCode = 400;
        }
        
        // Invalid text representation (bad UUID, etc.)
        if (err.code === '22P02') {
            error.message = 'Invalid ID format';
            error.statusCode = 400;
        }
    }
    
    // Mongoose/MongoDB-style errors (for compatibility if ever switching)
    if (err.name === 'CastError') {
        error.message = 'Resource not found';
        error.statusCode = 404;
    }
    
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors || {}).map(val => val.message);
        error.message = messages.join(', ') || 'Validation error';
        error.statusCode = 400;
    }
    
    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error.message = 'Invalid authentication token';
        error.statusCode = 401;
    }
    
    if (err.name === 'TokenExpiredError') {
        error.message = 'Authentication token has expired';
        error.statusCode = 401;
    }
    
    // Multer errors (file upload)
    if (err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
            error.message = 'File size too large. Maximum size is 5MB.';
            error.statusCode = 400;
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            error.message = 'Too many files uploaded';
            error.statusCode = 400;
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            error.message = 'Unexpected file field';
            error.statusCode = 400;
        } else {
            error.message = 'File upload error';
            error.statusCode = 400;
        }
    }
    
    // Cloudinary errors
    if (err.http_code) {
        error.message = 'Image upload failed. Please try again.';
        error.statusCode = 500;
    }
    
    // Syntax errors in JSON
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        error.message = 'Invalid JSON format';
        error.statusCode = 400;
    }
    
    // Rate limit errors
    if (err.message && err.message.includes('Too many requests')) {
        error.statusCode = 429;
    }
    
    // Send response
    const response = {
        success: false,
        message: error.message || 'Internal server error',
        statusCode: error.statusCode
    };
    
    // Add stack trace in development mode
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
        response.error = {
            code: err.code,
            name: err.name,
            detail: err.detail
        };
    }
    
    res.status(error.statusCode).json(response);
}

// Not found middleware (404)
function notFound(req, res, next) {
    const error = new AppError(
        `Route ${req.originalUrl} not found`,
        404
    );
    next(error);
}

// Async handler wrapper (eliminates try-catch in controllers)
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Validation error helper
function validationError(field, message) {
    const error = new AppError(message || `Invalid ${field}`, 400);
    error.field = field;
    return error;
}

// Not found error helper
function notFoundError(resource = 'Resource') {
    return new AppError(`${resource} not found`, 404);
}

// Unauthorized error helper
function unauthorizedError(message = 'Unauthorized access') {
    return new AppError(message, 401);
}

// Forbidden error helper
function forbiddenError(message = 'Access forbidden') {
    return new AppError(message, 403);
}

// Conflict error helper
function conflictError(message = 'Resource conflict') {
    return new AppError(message, 409);
}

// Bad request error helper
function badRequestError(message = 'Bad request') {
    return new AppError(message, 400);
}

// Service unavailable error helper
function serviceUnavailableError(message = 'Service temporarily unavailable') {
    return new AppError(message, 503);
}

module.exports = {
    errorHandler,
    notFound,
    asyncHandler,
    AppError,
    validationError,
    notFoundError,
    unauthorizedError,
    forbiddenError,
    conflictError,
    badRequestError,
    serviceUnavailableError
};