// js/upload.js
// Image upload to Cloudinary with preview, validation, and progress
// GLOBAL REFERENCE: Environment Variables → Cloudinary, File Upload Limits
// PURPOSE: Handle all image uploads (products, competitions, profiles, reviews)

// Cloudinary Configuration - Direct values (not importing from config.js for standalone usage)
const CLOUDINARY_CLOUD_NAME = 'da35fjcqb';
const CLOUDINARY_UPLOAD_PRESET = 'robotics-marketplace';
const CLOUDINARY_API_BASE = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}`;
const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB - Allow large files for preprocessing
const MAX_PROCESSED_SIZE = 5 * 1024 * 1024; // 5MB - Max after processing
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/bmp', 'image/gif', 'image/tiff'];

// Remove the import statement below
/*
import { 
    */

// Helper function for toast notifications (inline version)
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = 'position: fixed; bottom: 2rem; right: 2rem; background: white; padding: 1rem 1.5rem; border-radius: 0.75rem; box-shadow: 0 10px 25px rgba(0,0,0,0.2); z-index: 10000; animation: slideIn 0.3s ease-out;';
    
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span style="margin-right: 0.5rem;">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Validate image file
function validateImage(file, maxSize = MAX_IMAGE_SIZE) {
    // Check if file exists
    if (!file) {
        throw new Error('No file selected');
    }
    
    // Check file type - Accept all common image formats
    if (!file.type.startsWith('image/')) {
        throw new Error('Please select a valid image file');
    }
    
    // Check file size - Allow large files as they will be compressed
    if (file.size > maxSize) {
        const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
        throw new Error(`Image must be less than ${maxMB}MB. Large images will be automatically optimized.`);
    }
    
    return true;
}

// Create image preview
function createImagePreview(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            resolve(e.target.result);
        };
        
        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };
        
        reader.readAsDataURL(preprocessed);
    });
}

// Upload single image to Cloudinary
async function uploadImage(file, options = {}) {
    try {
                // Validate original file
        validateImage(file, options.maxSize);
        
        // Preprocess image before upload
        let processedFile = await preprocessImage(file, options);
        
        // Ensure processed file meets size requirements
        processedFile = await validateProcessedImage(processedFile);
        
        // Create FormData
        const formData = new FormData();
        formData.append('file', processedFile);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        
        // Optional folder
        if (options.folder) {
            formData.append('folder', options.folder);
        }
        
        // Optional tags
        if (options.tags) {
            formData.append('tags', Array.isArray(options.tags) ? options.tags.join(',') : options.tags);
        }
        
        // Optional public_id
        if (options.public_id) {
            formData.append('public_id', options.public_id);
        }
        
        // Upload to Cloudinary
        const response = await fetch(
            `${CLOUDINARY_API_BASE}/image/upload`,
            {
                method: 'POST',
                body: formData
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || 'Upload failed');
        }
        
        const data = await response.json();
        
        return {
            url: data.secure_url,
            public_id: data.public_id,
            width: data.width,
            height: data.height,
            format: data.format,
            size: data.bytes
        };
        
    } catch (error) {
        console.error('Upload error:', error);
        throw error;
    }
}

// Upload multiple images
async function uploadMultipleImages(files, options = {}) {
    const fileArray = Array.from(files);
    
    // Validate all files first
    for (const file of fileArray) {
        try {
            validateImage(file, options.maxSize);
        } catch (error) {
            throw new Error(`${file.name}: ${error.message}`);
        }
    }
    
    // Upload all files
    const uploads = fileArray.map((file, index) => {
        const fileOptions = { ...options };
        
        // Add index to folder if provided
        if (options.folderPrefix) {
            fileOptions.folder = `${options.folderPrefix}/${index}`;
        }
        
        return uploadImage(file, fileOptions);
    });
    
    return Promise.all(uploads);
}

// Upload with progress tracking
async function uploadWithProgress(file, onProgress, options = {}) {
    try {
        validateImage(file, options.maxSize);
        
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            // Track progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    if (onProgress) {
                        onProgress(percentComplete);
                    }
                }
            });
            
            // Handle completion
            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve({
                            url: data.secure_url,
                            public_id: data.public_id,
                            width: data.width,
                            height: data.height,
                            format: data.format,
                            size: data.bytes
                        });
                    } catch (error) {
                        reject(new Error('Failed to parse response'));
                    }
                } else {
                    try {
                        const errorData = JSON.parse(xhr.responseText);
                        reject(new Error(errorData.error?.message || 'Upload failed'));
                    } catch {
                        reject(new Error('Upload failed'));
                    }
                }
            });
            
            // Handle errors
            xhr.addEventListener('error', () => {
                reject(new Error('Network error during upload'));
            });
            
            // Handle timeout
            xhr.addEventListener('timeout', () => {
                reject(new Error('Upload timeout'));
            });
            
            // Prepare and send request
            const formData = new FormData();
            formData.append('file', processedFile);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
            
            if (options.folder) {
                formData.append('folder', options.folder);
            }
            
            if (options.tags) {
                formData.append('tags', Array.isArray(options.tags) ? options.tags.join(',') : options.tags);
            }
            
            xhr.open('POST', `${CLOUDINARY_API_BASE}/image/upload`);
            xhr.timeout = 60000; // 60 second timeout
            xhr.send(formData);
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        throw error;
    }
}

// Upload multiple images with progress
async function uploadMultipleWithProgress(files, onProgress, options = {}) {
    const fileArray = Array.from(files);
    const results = [];
    let completedCount = 0;
    
    for (const file of fileArray) {
        try {
            const result = await uploadWithProgress(
                file,
                (fileProgress) => {
                    // Calculate overall progress
                    const overallProgress = Math.round(
                        ((completedCount + (fileProgress / 100)) / fileArray.length) * 100
                    );
                    if (onProgress) {
                        onProgress(overallProgress, completedCount, fileArray.length);
                    }
                },
                options
            );
            results.push(result);
            completedCount++;
            
            // Update progress after completion
            if (onProgress) {
                const overallProgress = Math.round((completedCount / fileArray.length) * 100);
                onProgress(overallProgress, completedCount, fileArray.length);
            }
        } catch (error) {
            console.error(`Failed to upload ${file.name}:`, error);
            results.push({ error: error.message, file: file.name });
        }
    }
    
    return results;
}

// Setup file input with preview
function setupFileInput(inputElement, previewElement, options = {}) {
    if (!inputElement) {
        console.error('Input element not found');
        return;
    }
    
    inputElement.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            // Validate
            validateImage(file, options.maxSize);
            
            // Show preview
            const preview = await createImagePreview(file);
            if (previewElement) {
                if (previewElement.tagName === 'IMG') {
                    previewElement.src = preview;
                    previewElement.style.display = 'block';
                } else {
                    previewElement.style.backgroundImage = `url(${preview})`;
                    previewElement.style.backgroundSize = 'cover';
                    previewElement.style.backgroundPosition = 'center';
                }
                
                // Show preview container if hidden
                const container = previewElement.closest('.preview-container, .file-preview');
                if (container) {
                    container.style.display = 'block';
                    container.classList.add('show');
                }
            }
            
            // Call callback if provided
            if (options.onPreview) {
                options.onPreview(preview, file);
            }
            
        } catch (error) {
            showToast(error.message, 'error');
            e.target.value = ''; // Clear input
            
            // Hide preview on error
            if (previewElement) {
                const container = previewElement.closest('.preview-container, .file-preview');
                if (container) {
                    container.style.display = 'none';
                    container.classList.remove('show');
                }
            }
        }
    });
}

// Setup multiple file input with previews
function setupMultipleFileInput(inputElement, previewContainer, options = {}) {
    if (!inputElement) {
        console.error('Input element not found');
        return;
    }
    
    inputElement.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        // Clear existing previews
        if (previewContainer) {
            previewContainer.innerHTML = '';
        }
        
        for (const file of files) {
            try {
                // Validate
                validateImage(file, options.maxSize);
                
                // Create preview
                const preview = await createImagePreview(file);
                
                if (previewContainer) {
                    // Create preview element
                    const previewEl = document.createElement('div');
                    previewEl.className = 'image-preview-item';
                    previewEl.innerHTML = `
                        <img src="${preview}" alt="${file.name}">
                        <div class="preview-overlay">
                            <span class="preview-name">${file.name}</span>
                            <button type="button" class="preview-remove" data-file="${file.name}">✕</button>
                        </div>
                    `;
                    
                    previewContainer.appendChild(previewEl);
                }
                
            } catch (error) {
                showToast(`${file.name}: ${error.message}`, 'error');
            }
        }
        
        // Call callback if provided
        if (options.onPreview) {
            options.onPreview(files);
        }
    });
}

// Setup drag and drop upload
function setupDragAndDrop(dropZone, options = {}) {
    if (!dropZone) {
        console.error('Drop zone element not found');
        return;
    }
    
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });
    
    // Highlight drop zone when dragging over
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('drag-over');
        });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('drag-over');
        });
    });
    
    // Handle drop
    dropZone.addEventListener('drop', async (e) => {
        const files = Array.from(e.dataTransfer.files);
        
        // Filter for image files only
        const imageFiles = files.filter(file => ALLOWED_IMAGE_TYPES.includes(file.type));
        
        if (imageFiles.length === 0) {
            showToast('Only JPG and PNG images are allowed', 'error');
            return;
        }
        
        if (options.multiple) {
            // Handle multiple files
            if (options.onFiles) {
                options.onFiles(imageFiles);
            }
        } else {
            // Handle single file
            const file = imageFiles[0];
            
            try {
                validateImage(file, options.maxSize);
                
                if (options.onFile) {
                    options.onFile(file);
                }
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    });
    
    // Optional: Make drop zone clickable to trigger file input
    if (options.fileInput) {
        dropZone.addEventListener('click', () => {
            options.fileInput.click();
        });
    }
}

// Compress image before upload (optional)
async function compressImage(file, maxWidth = 1920, quality = 0.9) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                // Calculate new dimensions
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                // Create canvas
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                // Draw and compress
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to blob
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            }));
                        } else {
                            reject(new Error('Failed to compress image'));
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(preprocessed);
    });
}

// Resize image to exact dimensions
async function resizeImage(file, width, height, maintainAspect = true) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                let targetWidth = width;
                let targetHeight = height;
                
                if (maintainAspect) {
                    const aspectRatio = img.width / img.height;
                    
                    if (img.width > img.height) {
                        targetHeight = width / aspectRatio;
                    } else {
                        targetWidth = height * aspectRatio;
                    }
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(new File([blob], file.name, {
                                type: file.type,
                                lastModified: Date.now()
                            }));
                        } else {
                            reject(new Error('Failed to resize image'));
                        }
                    },
                    file.type,
                    0.9
                );
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(preprocessed);
    });
}

// Get image dimensions
async function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                resolve({
                    width: img.width,
                    height: img.height,
                    aspectRatio: img.width / img.height
                });
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(preprocessed);
    });
}
// Preprocess image before upload
async function preprocessImage(file, options = {}) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                // Determine max dimensions based on image type
                let maxWidth = options.maxWidth || 1920;
                let maxHeight = options.maxHeight || 1920;
                
                // Calculate new dimensions while maintaining aspect ratio
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth || height > maxHeight) {
                    const aspectRatio = width / height;
                    
                    if (width > height) {
                        width = maxWidth;
                        height = width / aspectRatio;
                    } else {
                        height = maxHeight;
                        width = height * aspectRatio;
                    }
                }
                
                // Create canvas for processing
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                
                // Enable image smoothing for better quality
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                // Draw image
                ctx.drawImage(img, 0, 0, width, height);
                
                // Determine output format and quality
                let outputFormat = 'image/jpeg';
                let quality = 0.85;
                
                // Use WebP if supported and not already WebP
                if (canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0) {
                    outputFormat = 'image/webp';
                    quality = 0.90;
                }
                
                // For PNG images with transparency, keep PNG format
                if (file.type === 'image/png' && hasTransparency(ctx, width, height)) {
                    outputFormat = 'image/png';
                    quality = 0.92;
                }
                
                // Convert to blob
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            // Create new file with original name
                            const extension = outputFormat.split('/')[1];
                            const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
                            const processedFile = new File(
                                [blob], 
                                `${nameWithoutExt}.${extension}`,
                                { 
                                    type: outputFormat,
                                    lastModified: Date.now()
                                }
                            );
                            
                            // Only use processed version if it's smaller
                            if (processedFile.size < file.size) {
                                console.log(`Image optimized: ${file.size} → ${processedFile.size} bytes (${Math.round((1 - processedFile.size / file.size) * 100)}% reduction)`);
                                resolve(processedFile);
                            } else {
                                console.log('Original file is smaller, using original');
                                resolve(file);
                            }
                        } else {
                            reject(new Error('Failed to process image'));
                        }
                    },
                    outputFormat,
                    quality
                );
            };
            
            img.onerror = () => reject(new Error('Failed to load image for processing'));
            img.src = e.target.result;
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(preprocessed);
    });
}

// Check if image has transparency
function hasTransparency(ctx, width, height) {
    try {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Validate processed image size
async function validateProcessedImage(file) {
    if (file.size > MAX_PROCESSED_SIZE) {
        // If still too large, compress more aggressively
        return await preprocessImage(file, { 
            maxWidth: 1280, 
            maxHeight: 1280,
            quality: 0.75 
        });
    }
    return file;
}
// Delete image from Cloudinary (requires backend implementation)
async function deleteImage(publicId) {
    try {
        // This should be called through your backend API
        // Direct deletion from frontend is not secure
        console.warn('Image deletion should be handled by backend');
        throw new Error('Image deletion must be performed through backend API');
    } catch (error) {
        console.error('Delete error:', error);
        throw error;
    }
}

// Export functions
export {
    validateImage,
    createImagePreview,
    uploadImage,
    uploadMultipleImages,
    uploadWithProgress,
    uploadMultipleWithProgress,
    setupFileInput,
    setupMultipleFileInput,
    setupDragAndDrop,
    compressImage,
    resizeImage,
    getImageDimensions,
    deleteImage
};