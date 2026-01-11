// backend/config/cloudinary.js
// Cloudinary configuration for image upload handling
// GLOBAL REFERENCE: Environment Variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)
// PURPOSE: Configure Cloudinary SDK and provide upload helper functions

const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

// Verify configuration
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.warn('⚠️  Cloudinary credentials not configured. Using placeholder images.');
} else {
    console.log('✅ Cloudinary configured:', process.env.CLOUDINARY_CLOUD_NAME);
}

// Upload image from buffer
async function uploadImage(buffer, options = {}) {
    return new Promise((resolve, reject) => {
        const uploadOptions = {
            folder: options.folder || 'robotics-marketplace',
            resource_type: 'image',
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
            transformation: options.transformation || [
                { quality: 'auto:best' },
                { fetch_format: 'auto' },
                { width: 1920, height: 1080, crop: 'limit' },
                { quality: 'auto' },
                { fetch_format: 'auto' }
            ],
            ...options
        };

        const uploadStream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => {
                if (error) {
                    console.error('Cloudinary upload error:', error);
                    reject(error);
                } else {
                    resolve({
                        url: result.secure_url,
                        public_id: result.public_id,
                        width: result.width,
                        height: result.height,
                        format: result.format,
                        size: result.bytes
                    });
                }
            }
        );

        // Convert buffer to stream and pipe to upload
        const readableStream = Readable.from(buffer);
        readableStream.pipe(uploadStream);
    });
}

// Upload image from URL
async function uploadImageFromUrl(url, options = {}) {
    try {
        const uploadOptions = {
            folder: options.folder || 'robotics-marketplace',
            resource_type: 'image',
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
            transformation: options.transformation || [
                { quality: 'auto:best' },
                { fetch_format: 'auto' },
                { width: 1920, height: 1080, crop: 'limit' },
                { quality: 'auto' },
                { fetch_format: 'auto' }
            ],
            ...options
        };

        const result = await cloudinary.uploader.upload(url, uploadOptions);

        return {
            url: result.secure_url,
            public_id: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            size: result.bytes
        };
    } catch (error) {
        console.error('Cloudinary upload from URL error:', error);
        throw error;
    }
}

// Upload multiple images
async function uploadMultipleImages(buffers, options = {}) {
    const uploadPromises = buffers.map((buffer, index) => {
        const imageOptions = { ...options };
        
        // Add index to public_id if specified
        if (options.public_id) {
            imageOptions.public_id = `${options.public_id}_${index}`;
        }
        
        return uploadImage(buffer, imageOptions);
    });
    
    return Promise.all(uploadPromises);
}

// Delete image by public_id
async function deleteImage(publicId) {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result.result === 'ok';
    } catch (error) {
        console.error('Cloudinary delete error:', error);
        throw error;
    }
}

// Delete multiple images
async function deleteMultipleImages(publicIds) {
    try {
        const result = await cloudinary.api.delete_resources(publicIds);
        return result;
    } catch (error) {
        console.error('Cloudinary bulk delete error:', error);
        throw error;
    }
}

// Get image details
async function getImageDetails(publicId) {
    try {
        const result = await cloudinary.api.resource(publicId);
        return result;
    } catch (error) {
        console.error('Cloudinary get details error:', error);
        throw error;
    }
}

// Generate transformation URL
function getTransformedUrl(publicId, transformations) {
    try {
        return cloudinary.url(publicId, {
            transformation: transformations,
            secure: true
        });
    } catch (error) {
        console.error('Cloudinary transformation error:', error);
        throw error;
    }
}

// Upload buffer with folder and public_id (for auth route compatibility)
async function uploadBuffer(buffer, folder, publicId) {
    return uploadImage(buffer, {
        folder: folder,
        public_id: publicId
    });
}

// Upload product image (with specific optimizations)
async function uploadProductImage(buffer, productId) {
    return uploadImage(buffer, {
        folder: 'robotics-marketplace/products',
        public_id: `product_${productId}_${Date.now()}`,
        transformation: [
            { width: 800, height: 800, crop: 'limit' },
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
        ]
    });
}

// Upload competition banner (with specific optimizations)
async function uploadCompetitionBanner(buffer, competitionId) {
    return uploadImage(buffer, {
        folder: 'robotics-marketplace/competitions',
        public_id: `competition_${competitionId}_${Date.now()}`,
        transformation: [
            { width: 1200, height: 600, crop: 'limit' },
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
        ]
    });
}

// Upload club logo (with specific optimizations)
async function uploadClubLogo(buffer, clubId) {
    return uploadImage(buffer, {
        folder: 'robotics-marketplace/clubs',
        public_id: `club_logo_${clubId}_${Date.now()}`,
        transformation: [
            { width: 400, height: 400, crop: 'limit' },
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
        ]
    });
}

// Upload user avatar (with specific optimizations)
async function uploadUserAvatar(buffer, userId) {
    return uploadImage(buffer, {
        folder: 'robotics-marketplace/avatars',
        public_id: `avatar_${userId}_${Date.now()}`,
        transformation: [
            { width: 200, height: 200, crop: 'fill', gravity: 'face' },
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
        ]
    });
}

// List images in a folder
async function listImagesByFolder(folder) {
    try {
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: folder,
            max_results: 500
        });
        return result.resources;
    } catch (error) {
        console.error('Cloudinary list images error:', error);
        throw error;
    }
}

// Extract public_id from Cloudinary URL
function extractPublicId(url) {
    try {
        // Example URL: https://res.cloudinary.com/demo/image/upload/v1234567890/sample.jpg
        const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\./);
        return matches ? matches[1] : null;
    } catch (error) {
        console.error('Error extracting public_id:', error);
        return null;
    }
}

module.exports = {
    cloudinary,
    uploadImage,
    uploadBuffer,
    uploadImageFromUrl,
    uploadMultipleImages,
    deleteImage,
    deleteMultipleImages,
    getImageDetails,
    getTransformedUrl,
    uploadProductImage,
    uploadCompetitionBanner,
    uploadClubLogo,
    uploadUserAvatar,
    listImagesByFolder,
    extractPublicId
};