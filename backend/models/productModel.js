// backend/models/productModel.js
// Product model with inventory management, ratings, and search functionality.
// GLOBAL REFERENCE: Product Object Structure, Database Schema → products table
// PURPOSE: Handle all product-related database operations, inventory, and analytics.

const db = require('../config/database');

class Product {
    // Create new product
    static async create(productData) {
        return await db.transaction(async (client) => {
            // Insert product
            const productResult = await client.query(`
                INSERT INTO products (
                    club_id, name, slug, description, category, price, 
                    original_price, stock, condition, weight, specifications, 
                    tags, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING *
            `, [
                productData.club_id,
                productData.name,
                productData.slug,
                productData.description,
                productData.category,
                productData.price,
                productData.original_price || null,
                productData.stock,
                productData.condition || 'new',
                productData.weight || null,
                JSON.stringify(productData.specifications || {}),
                productData.tags || [],
                productData.status || 'active'
            ]);
            
            const product = productResult.rows[0];
            
            // Insert product images if provided
            if (productData.images && productData.images.length > 0) {
                for (let i = 0; i < productData.images.length; i++) {
                    await client.query(
                        'INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)',
                        [product.id, productData.images[i], i]
                    );
                }
            }
            
            return product;
        });
    }
    
    // Find product by ID with all details
    static async findById(id) {
        const product = await db.getOne(`
            SELECT 
                p.*,
                c.club_name,
                c.slug as club_slug,
                c.logo_url as club_logo,
                c.university as club_university,
                c.average_rating as club_rating,
                COALESCE(
                    json_agg(
                        json_build_object('id', pi.id, 'image_url', pi.image_url, 'display_order', pi.display_order)
                        ORDER BY pi.display_order
                    ) FILTER (WHERE pi.id IS NOT NULL),
                    '[]'
                ) as images
            FROM products p
            LEFT JOIN clubs c ON p.club_id = c.id
            LEFT JOIN product_images pi ON p.id = pi.product_id
            WHERE p.id = $1
            GROUP BY p.id, c.club_name, c.slug, c.logo_url, c.university, c.average_rating
        `, [id]);
        
        // Parse JSON fields
        if (product) {
            product.specifications = typeof product.specifications === 'string' 
                ? JSON.parse(product.specifications) 
                : product.specifications;
            product.images = typeof product.images === 'string'
                ? JSON.parse(product.images)
                : product.images;
        }
        
        return product;
    }
    
    // Find product by slug
    static async findBySlug(slug) {
        const product = await db.getOne(`
            SELECT 
                p.*,
                c.club_name,
                c.slug as club_slug,
                c.logo_url as club_logo,
                c.university as club_university,
                COALESCE(
                    json_agg(
                        json_build_object('id', pi.id, 'image_url', pi.image_url, 'display_order', pi.display_order)
                        ORDER BY pi.display_order
                    ) FILTER (WHERE pi.id IS NOT NULL),
                    '[]'
                ) as images
            FROM products p
            LEFT JOIN clubs c ON p.club_id = c.id
            LEFT JOIN product_images pi ON p.id = pi.product_id
            WHERE p.slug = $1
            GROUP BY p.id, c.club_name, c.slug, c.logo_url, c.university
        `, [slug]);
        
        if (product) {
            product.specifications = typeof product.specifications === 'string' 
                ? JSON.parse(product.specifications) 
                : product.specifications;
            product.images = typeof product.images === 'string'
                ? JSON.parse(product.images)
                : product.images;
        }
        
        return product;
    }
    
    // Check if slug exists
    static async slugExists(slug, excludeId = null) {
        if (excludeId) {
            return await db.exists('products', 'slug = $1 AND id != $2', [slug, excludeId]);
        }
        return await db.exists('products', 'slug = $1', [slug]);
    }
    
    // Get all products with filters
    static async findAll(filters = {}) {
        let query = `
            SELECT 
                p.*,
                c.club_name,
                c.slug as club_slug,
                c.logo_url as club_logo,
                COALESCE(
                    json_agg(
                        json_build_object('id', pi.id, 'image_url', pi.image_url, 'display_order', pi.display_order)
                        ORDER BY pi.display_order
                    ) FILTER (WHERE pi.id IS NOT NULL),
                    '[]'
                ) as images
            FROM products p
            LEFT JOIN clubs c ON p.club_id = c.id
            LEFT JOIN product_images pi ON p.id = pi.product_id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;
        
        // Filters
        if (filters.status) {
            query += ` AND p.status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        if (filters.category) {
            query += ` AND p.category = $${paramCount}`;
            params.push(filters.category);
            paramCount++;
        }
        
        if (filters.club_id) {
            query += ` AND p.club_id = $${paramCount}`;
            params.push(filters.club_id);
            paramCount++;
        }
        
        if (filters.condition) {
            query += ` AND p.condition = $${paramCount}`;
            params.push(filters.condition);
            paramCount++;
        }
        
        if (filters.min_price) {
            query += ` AND p.price >= $${paramCount}`;
            params.push(filters.min_price);
            paramCount++;
        }
        
        if (filters.max_price) {
            query += ` AND p.price <= $${paramCount}`;
            params.push(filters.max_price);
            paramCount++;
        }
        
        if (filters.in_stock) {
            query += ` AND p.stock > 0`;
        }
        
        if (filters.search) {
            query += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount} OR $${paramCount} = ANY(p.tags))`;
            params.push(`%${filters.search}%`);
            paramCount++;
        }
        
        // Group by
        query += ` GROUP BY p.id, c.club_name, c.slug, c.logo_url`;
        
        // Sorting
        const sortBy = filters.sort_by || 'created_at';
        const orderBy = filters.order_by || 'DESC';
        
        if (sortBy === 'price') {
            query += ` ORDER BY p.price ${orderBy}`;
        } else if (sortBy === 'rating') {
            query += ` ORDER BY p.average_rating ${orderBy}`;
        } else if (sortBy === 'sales') {
            query += ` ORDER BY p.sales_count ${orderBy}`;
        } else if (sortBy === 'views') {
            query += ` ORDER BY p.views ${orderBy}`;
        } else {
            query += ` ORDER BY p.created_at ${orderBy}`;
        }
        
        // Pagination
        const limit = filters.limit || 12;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        const products = await db.getMany(query, params);
        
        // Parse JSON fields and ensure images are arrays
        return products.map(p => {
            // Parse images if string
            let imgs = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
            
            // Ensure it's an array
            if (!Array.isArray(imgs)) imgs = [];
            
            // Extract primary image URL - FIXED VERSION
            let primaryImage = null;
            if (imgs.length > 0) {
                const firstImg = imgs[0];
                // Handle object format with image_url property
                if (typeof firstImg === 'object' && firstImg !== null) {
                    primaryImage = firstImg.image_url || null;
                }
                // Handle string format (direct URL)
                else if (typeof firstImg === 'string') {
                    primaryImage = firstImg;
                }
            }
            
            // If still no primary image, check if there's a direct image_url on product
            if (!primaryImage && p.image_url) {
                primaryImage = p.image_url;
            }
            
            return {
                ...p,
                specifications: typeof p.specifications === 'string' ? JSON.parse(p.specifications) : p.specifications,
                images: imgs,
                primary_image: primaryImage,
                image_url: primaryImage // Add this for backward compatibility
            };
        });
    }
    
    // Get featured products
    static async getFeatured(limit = 8) {
        const products = await db.getMany(`
            SELECT 
                p.*,
                c.club_name,
                c.slug as club_slug,
                c.logo_url as club_logo,
                COALESCE(
                    (SELECT json_agg(json_build_object('image_url', image_url, 'display_order', display_order) ORDER BY display_order)
                     FROM product_images 
                     WHERE product_id = p.id),
                    '[]'::json
                ) as images
            FROM products p
            LEFT JOIN clubs c ON p.club_id = c.id
            WHERE p.status = 'active' AND p.stock > 0
            ORDER BY p.views DESC, p.sales_count DESC, p.average_rating DESC
            LIMIT $1
        `, [limit]);
        
        // Parse and add primary_image
        return products.map(p => {
            let imgs = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
            if (!Array.isArray(imgs)) imgs = [];
            
            let primaryImage = null;
            if (imgs.length > 0) {
                const firstImg = imgs[0];
                primaryImage = (typeof firstImg === 'object' && firstImg !== null && firstImg.image_url) 
                    ? firstImg.image_url 
                    : (typeof firstImg === 'string' ? firstImg : null);
            }
            
            return {
                ...p,
                images: imgs,
                primary_image: primaryImage
            };
        });
    }
    
    // Get products by category
    static async getByCategory(category, limit = 12) {
        return await db.getMany(`
            SELECT 
                p.*,
                c.club_name,
                (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order LIMIT 1) as primary_image
            FROM products p
            LEFT JOIN clubs c ON p.club_id = c.id
            WHERE p.category = $1 AND p.status = 'active' AND p.stock > 0
            ORDER BY p.created_at DESC
            LIMIT $2
        `, [category, limit]);
    }
    
    // Get related products (same category, exclude current)
    static async getRelated(productId, category, limit = 4) {
        return await db.getMany(`
            SELECT 
                p.*,
                c.club_name,
                (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order LIMIT 1) as primary_image
            FROM products p
            LEFT JOIN clubs c ON p.club_id = c.id
            WHERE p.category = $1 AND p.id != $2 AND p.status = 'active' AND p.stock > 0
            ORDER BY p.sales_count DESC, p.average_rating DESC
            LIMIT $3
        `, [category, productId, limit]);
    }
    
    // Update product
    static async update(id, updates) {
        return await db.transaction(async (client) => {
            // Update main product data
            const allowedFields = [
                'name', 'slug', 'description', 'category', 'price', 
                'original_price', 'stock', 'condition', 'weight', 
                'specifications', 'tags', 'status'
            ];
            
            const filteredUpdates = {};
            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    if (field === 'specifications') {
                        filteredUpdates[field] = JSON.stringify(updates[field]);
                    } else {
                        filteredUpdates[field] = updates[field];
                    }
                }
            }
            
            const productResult = await db.updateOne('products', id, filteredUpdates);
            const product = Array.isArray(productResult) ? productResult[0] : productResult;
            
            // Update images if provided
            if (updates.images) {
                // Delete old images
                await client.query('DELETE FROM product_images WHERE product_id = $1', [id]);
                
                // Insert new images
                for (let i = 0; i < updates.images.length; i++) {
                    await client.query(
                        'INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)',
                        [id, updates.images[i], i]
                    );
                }
            }
            
            return product;
        });
    }
    
    // Delete product
    static async delete(id) {
        return await db.deleteOne('products', id);
    }
    
    // Update stock
    static async updateStock(id, quantity) {
        await db.query(
            'UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [quantity, id]
        );
    }
    
    // Decrement stock (for orders)
    static async decrementStock(id, quantity) {
        const result = await db.query(
            'UPDATE products SET stock = stock - $1, sales_count = sales_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND stock >= $1 RETURNING *',
            [quantity, id]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Insufficient stock');
        }
        
        return result.rows[0];
    }
    
    // Increment stock (for cancelled orders)
    static async incrementStock(id, quantity) {
        await db.query(
            'UPDATE products SET stock = stock + $1, sales_count = GREATEST(0, sales_count - 1), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [quantity, id]
        );
    }
    
    // Increment views
    static async incrementViews(id) {
        await db.query(
            'UPDATE products SET views = views + 1 WHERE id = $1',
            [id]
        );
    }
    
    // Update average rating
    static async updateAverageRating(productId) {
        const result = await db.getOne(
            'SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM reviews WHERE product_id = $1',
            [productId]
        );
        
        const avgRating = result && result.avg_rating ? parseFloat(result.avg_rating) : 0;
        
        await db.query(
            'UPDATE products SET average_rating = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [avgRating, productId]
        );
        
        return avgRating;
    }
    
    // Get all categories
    static async getCategories() {
        const result = await db.getMany(
            'SELECT DISTINCT category FROM products WHERE status = $1 ORDER BY category',
            ['active']
        );
        return result.map(r => r.category);
    }
    
    // Count products
    static async count(filters = {}) {
        let whereClause = "1=1";
        const params = [];
        let paramCount = 1;
        
        if (filters.status) {
            whereClause += ` AND status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        if (filters.category) {
            whereClause += ` AND category = $${paramCount}`;
            params.push(filters.category);
            paramCount++;
        }
        
        if (filters.club_id) {
            whereClause += ` AND club_id = $${paramCount}`;
            params.push(filters.club_id);
            paramCount++;
        }
        
        return await db.count('products', whereClause, params);
    }
    
    // Get low stock products (for club admin alerts)
    static async getLowStock(clubId, threshold = 5) {
        return await db.getMany(
            'SELECT * FROM products WHERE club_id = $1 AND stock <= $2 AND stock > 0 AND status = $3 ORDER BY stock ASC',
            [clubId, threshold, 'active']
        );
    }
    
    // Get out of stock products
    static async getOutOfStock(clubId) {
        return await db.getMany(
            'SELECT * FROM products WHERE club_id = $1 AND stock = 0 AND status = $2',
            [clubId, 'active']
        );
    }
}

module.exports = Product;