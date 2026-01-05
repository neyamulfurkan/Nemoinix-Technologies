// backend/models/competitionModel.js
// Competition model with registration management and product linking.
// GLOBAL REFERENCE: Competition Object Structure, Database Schema → competitions table
// PURPOSE: Handle competition operations, registrations, and product associations.

const db = require('../config/database');

class Competition {
    // Create new competition
    static async create(competitionData) {
        return await db.transaction(async (client) => {
            // Insert competition
            const compResult = await client.query(`
                INSERT INTO competitions (
                    club_id, title, slug, description, category,
                    competition_date, competition_time, venue,
                    location_lat, location_lng, registration_deadline,
                    max_participants, registration_fee,
                    prize_first, prize_second, prize_third,
                    rules, eligibility, banner_url,
                    contact_email, contact_phone, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
                RETURNING *
            `, [
                competitionData.club_id,
                competitionData.title,
                competitionData.slug,
                competitionData.description,
                competitionData.category,
                competitionData.competition_date,
                competitionData.competition_time || null,
                competitionData.venue,
                competitionData.location_lat || null,
                competitionData.location_lng || null,
                competitionData.registration_deadline,
                competitionData.max_participants || null,
                competitionData.registration_fee,
                competitionData.prize_first || null,
                competitionData.prize_second || null,
                competitionData.prize_third || null,
                competitionData.rules || null,
                competitionData.eligibility || null,
                competitionData.banner_url || null,
                competitionData.contact_email || null,
                competitionData.contact_phone || null,
                competitionData.status || 'active'
            ]);
            
            const competition = compResult.rows[0];
            
            // Link products ONLY if provided and not empty
            if (competitionData.product_ids && 
                Array.isArray(competitionData.product_ids) && 
                competitionData.product_ids.length > 0) {
                console.log('Linking products to competition:', competitionData.product_ids);
                for (const productId of competitionData.product_ids) {
                    // Verify product exists before linking
                    const productExists = await client.query(
                        'SELECT id FROM products WHERE id = $1 AND status = $2',
                        [productId, 'active']
                    );
                    
                    if (productExists.rows.length > 0) {
                        await client.query(
                            'INSERT INTO competition_products (competition_id, product_id, is_required) VALUES ($1, $2, $3)',
                            [competition.id, productId, true]
                        );
                    }
                }
            } else {
                console.log('No products to link for competition:', competition.id);
            }
            
            return competition;
        });
    }
    
    // Find competition by ID with all details
    static async findById(id) {
        const competition = await db.getOne(`
            SELECT 
                c.*,
                cl.club_name,
                cl.slug as club_slug,
                cl.logo_url as club_logo,
                cl.university as club_university,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', p.id,
                            'name', p.name,
                            'price', p.price,
                            'image_url', (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order LIMIT 1),
                            'club_name', pcl.club_name,
                            'stock', p.stock
                        )
                        ORDER BY cp.id
                    ) FILTER (WHERE p.id IS NOT NULL),
                    '[]'
                ) as required_products
            FROM competitions c
            LEFT JOIN clubs cl ON c.club_id = cl.id
            LEFT JOIN competition_products cp ON c.id = cp.competition_id
            LEFT JOIN products p ON cp.product_id = p.id
            LEFT JOIN clubs pcl ON p.club_id = pcl.id
            WHERE c.id = $1
            GROUP BY c.id, cl.club_name, cl.slug, cl.logo_url, cl.university
        `, [id]);
        
        if (competition) {
            competition.required_products = typeof competition.required_products === 'string'
                ? JSON.parse(competition.required_products)
                : competition.required_products;
        }
        
        return competition;
    }
    
    // Find competition by slug
    static async findBySlug(slug) {
        const competition = await db.getOne(`
            SELECT 
                c.*,
                cl.club_name,
                cl.slug as club_slug,
                cl.logo_url as club_logo,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', p.id,
                            'name', p.name,
                            'price', p.price,
                            'image_url', (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order LIMIT 1),
                            'club_name', pcl.club_name
                        )
                        ORDER BY cp.id
                    ) FILTER (WHERE p.id IS NOT NULL),
                    '[]'
                ) as required_products
            FROM competitions c
            LEFT JOIN clubs cl ON c.club_id = cl.id
            LEFT JOIN competition_products cp ON c.id = cp.competition_id
            LEFT JOIN products p ON cp.product_id = p.id
            LEFT JOIN clubs pcl ON p.club_id = pcl.id
            WHERE c.slug = $1
            GROUP BY c.id, cl.club_name, cl.slug, cl.logo_url
        `, [slug]);
        
        if (competition) {
            competition.required_products = typeof competition.required_products === 'string'
                ? JSON.parse(competition.required_products)
                : competition.required_products;
        }
        
        return competition;
    }
    
    // Check if slug exists
    static async slugExists(slug, excludeId = null) {
        if (excludeId) {
            return await db.exists('competitions', 'slug = $1 AND id != $2', [slug, excludeId]);
        }
        return await db.exists('competitions', 'slug = $1', [slug]);
    }
    
    // Get all competitions with filters
    static async findAll(filters = {}) {
        let query = `
            SELECT 
                c.*,
                cl.club_name,
                cl.slug as club_slug,
                cl.logo_url as club_logo
            FROM competitions c
            LEFT JOIN clubs cl ON c.club_id = cl.id
            WHERE c.status = 'active'
        `;
        const params = [];
        let paramCount = 1;
        
        // Filters
        if (filters.category) {
            query += ` AND c.category = $${paramCount}`;
            params.push(filters.category);
            paramCount++;
        }
        
        if (filters.club_id) {
            query += ` AND c.club_id = $${paramCount}`;
            params.push(filters.club_id);
            paramCount++;
        }
        
        if (filters.upcoming) {
            query += ` AND c.competition_date >= CURRENT_DATE`;
        }
        
        if (filters.past) {
            query += ` AND c.competition_date < CURRENT_DATE`;
        }
        
        if (filters.registration_open) {
            query += ` AND c.registration_deadline >= CURRENT_DATE`;
        }
        
        if (filters.location) {
            query += ` AND c.venue ILIKE $${paramCount}`;
            params.push(`%${filters.location}%`);
            paramCount++;
        }
        
        if (filters.search) {
            query += ` AND (c.title ILIKE $${paramCount} OR c.description ILIKE $${paramCount})`;
            params.push(`%${filters.search}%`);
            paramCount++;
        }
        
        // Sorting
        const sortBy = filters.sort_by || 'competition_date';
        const orderBy = filters.order_by || 'ASC';
        query += ` ORDER BY c.${sortBy} ${orderBy}`;
        
        // Pagination
        const limit = filters.limit || 12;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        return await db.getMany(query, params);
    }
    
    // Get upcoming competitions
    static async getUpcoming(limit = 5) {
        return await db.getMany(`
            SELECT 
                c.*,
                cl.club_name,
                cl.slug as club_slug,
                cl.logo_url as club_logo
            FROM competitions c
            LEFT JOIN clubs cl ON c.club_id = cl.id
            WHERE c.status = 'active' 
            AND c.competition_date >= CURRENT_DATE
            ORDER BY c.competition_date ASC
            LIMIT $1
        `, [limit]);
    }
    
    // Get featured competitions
    static async getFeatured(limit = 5) {
        return await db.getMany(`
            SELECT 
                c.*,
                cl.club_name,
                cl.slug as club_slug,
                cl.logo_url as club_logo
            FROM competitions c
            LEFT JOIN clubs cl ON c.club_id = cl.id
            WHERE c.is_featured = true 
            AND c.status = 'active'
            AND c.competition_date >= CURRENT_DATE
            ORDER BY c.competition_date ASC
            LIMIT $1
        `, [limit]);
    }
    
    // Update competition
    static async update(id, updates) {
        return await db.transaction(async (client) => {
            // Update main competition data
            const allowedFields = [
                'title', 'slug', 'description', 'category',
                'competition_date', 'competition_time', 'venue',
                'location_lat', 'location_lng', 'registration_deadline',
                'max_participants', 'registration_fee',
                'prize_first', 'prize_second', 'prize_third',
                'rules', 'eligibility', 'banner_url',
                'contact_email', 'contact_phone', 'status'
            ];
            
            const filteredUpdates = {};
            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    filteredUpdates[field] = updates[field];
                }
            }
            
            const competitionResult = await db.updateOne('competitions', id, filteredUpdates);
            const competition = Array.isArray(competitionResult) ? competitionResult[0] : competitionResult;
            
            // Update linked products if provided
            if (updates.product_ids !== undefined) {
                // Always delete old links first
                await client.query('DELETE FROM competition_products WHERE competition_id = $1', [id]);
                
                // Only insert new links if array has items
                if (Array.isArray(updates.product_ids) && updates.product_ids.length > 0) {
                    console.log('Updating product links for competition:', id);
                    for (const productId of updates.product_ids) {
                        // Verify product exists before linking
                        const productExists = await client.query(
                            'SELECT id FROM products WHERE id = $1 AND status = $2',
                            [productId, 'active']
                        );
                        
                        if (productExists.rows.length > 0) {
                            await client.query(
                                'INSERT INTO competition_products (competition_id, product_id, is_required) VALUES ($1, $2, $3)',
                                [id, productId, true]
                            );
                        }
                    }
                } else {
                    console.log('Clearing all product links for competition:', id);
                }
            }
            
            return competition;
        });
    }
    
    // Delete competition
    static async delete(id) {
        return await db.deleteOne('competitions', id);
    }
    
    // Increment views
    static async incrementViews(id) {
        await db.query(
            'UPDATE competitions SET views = views + 1 WHERE id = $1',
            [id]
        );
    }
    
    // Update registration count (only approved registrations)
    static async updateRegistrationCount(id) {
        const result = await db.getOne(
            'SELECT COUNT(*) as count FROM competition_registrations WHERE competition_id = $1 AND registration_status = $2',
            [id, 'approved']
        );
        
        await db.query(
            'UPDATE competitions SET registration_count = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [result.count, id]
        );
    }
    
    // Check if registration is open
    static async isRegistrationOpen(id) {
        const competition = await db.getOne(
            'SELECT registration_deadline, max_participants, registration_count FROM competitions WHERE id = $1',
            [id]
        );
        
        if (!competition) return false;
        
        const now = new Date();
        const deadline = new Date(competition.registration_deadline);
        
        if (now > deadline) return false;
        
        if (competition.max_participants && competition.registration_count >= competition.max_participants) {
            return false;
        }
        
        return true;
    }
    
    // Get all categories
    static async getCategories() {
        const result = await db.getMany(
            'SELECT DISTINCT category FROM competitions WHERE status = $1 ORDER BY category',
            ['active']
        );
        return result.map(r => r.category);
    }
    
    // Count competitions
    static async count(filters = {}) {
        let whereClause = "status = 'active'";
        const params = [];
        let paramCount = 1;
        
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
        
        if (filters.upcoming) {
            whereClause += ` AND competition_date >= CURRENT_DATE`;
        }
        
        return await db.count('competitions', whereClause, params);
    }
    
    // Set featured status
    static async setFeatured(id, isFeatured) {
        await db.query(
            'UPDATE competitions SET is_featured = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [isFeatured, id]
        );
    }
}

module.exports = Competition;