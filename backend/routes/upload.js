// backend/routes/upload.js
// Image upload routes using Cloudinary
// GLOBAL REFERENCE: Cloudinary Configuration, Authentication Middleware
// PURPOSE: Handle image uploads for products, competitions, profiles

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const {
    uploadImage,
    uploadProductImage,
    uploadCompetitionBanner,
    uploadClubLogo,
    uploadUserAvatar,
    deleteImage
} = require('../config/cloudinary');

// Configure multer for memory storage (we'll upload to Cloudinary from memory)
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept images only
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// @route   POST /api/upload/image
// @desc    Upload single image (general purpose)
// @access  Private
router.post('/image', authenticate, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        // Upload to Cloudinary
        const result = await uploadImage(req.file.buffer, {
            folder: 'robotics-marketplace/general',
            public_id: `${Date.now()}_${req.user.id}`
        });

        res.status(200).json({
            success: true,
            message: 'Image uploaded successfully',
            imageUrl: result.url,
            publicId: result.public_id
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload image'
        });
    }
});

// @route   POST /api/upload/images
// @desc    Upload multiple images
// @access  Private
router.post('/images', authenticate, upload.array('images', 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No image files provided'
            });
        }

        const uploadPromises = req.files.map(file => 
            uploadImage(file.buffer, {
                folder: 'robotics-marketplace/general',
                public_id: `${Date.now()}_${req.user.id}_${Math.random().toString(36).substring(7)}`
            })
        );

        const results = await Promise.all(uploadPromises);

        res.status(200).json({
            success: true,
            message: 'Images uploaded successfully',
            images: results.map(r => ({
                url: r.url,
                publicId: r.public_id
            }))
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload images'
        });
    }
});

// @route   POST /api/upload/product
// @desc    Upload product image with optimization
// @access  Private (Club Admin only)
router.post('/product', authenticate, upload.single('image'), async (req, res) => {
    try {
        if (req.user.role !== 'club_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only club admins can upload product images'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        const productId = req.body.product_id || Date.now();
        const result = await uploadProductImage(req.file.buffer, productId);

        res.status(200).json({
            success: true,
            message: 'Product image uploaded successfully',
            imageUrl: result.url,
            publicId: result.public_id
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload product image'
        });
    }
});

// @route   POST /api/upload/competition
// @desc    Upload competition banner with optimization
// @access  Private (Club Admin only)
router.post('/competition', authenticate, upload.single('image'), async (req, res) => {
    try {
        if (req.user.role !== 'club_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only club admins can upload competition banners'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        const competitionId = req.body.competition_id || Date.now();
        const result = await uploadCompetitionBanner(req.file.buffer, competitionId);

        res.status(200).json({
            success: true,
            message: 'Competition banner uploaded successfully',
            imageUrl: result.url,
            publicId: result.public_id
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload competition banner'
        });
    }
});

// @route   POST /api/upload/club-logo
// @desc    Upload club logo
// @access  Private (Club Admin only)
router.post('/club-logo', authenticate, upload.single('image'), async (req, res) => {
    try {
        if (req.user.role !== 'club_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only club admins can upload club logos'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        const clubId = req.user.club_id || Date.now();
        const result = await uploadClubLogo(req.file.buffer, clubId);

        res.status(200).json({
            success: true,
            message: 'Club logo uploaded successfully',
            imageUrl: result.url,
            publicId: result.public_id
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload club logo'
        });
    }
});

// @route   POST /api/upload/avatar
// @desc    Upload user avatar
// @access  Private
router.post('/avatar', authenticate, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        const result = await uploadUserAvatar(req.file.buffer, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Avatar uploaded successfully',
            imageUrl: result.url,
            publicId: result.public_id
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload avatar'
        });
    }
});

// @route   DELETE /api/upload/:publicId
// @desc    Delete image from Cloudinary
// @access  Private
router.delete('/:publicId', authenticate, async (req, res) => {
    try {
        const publicId = req.params.publicId.replace(/-/g, '/'); // Convert back to proper format

        const result = await deleteImage(publicId);

        if (result) {
            res.status(200).json({
                success: true,
                message: 'Image deleted successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Image not found or already deleted'
            });
        }

    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete image'
        });
    }
});

// Error handling middleware for multer errors
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 5MB'
            });
        }
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
    
    if (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
    
    next();
});

module.exports = router;