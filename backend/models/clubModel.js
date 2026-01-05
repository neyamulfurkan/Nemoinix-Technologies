// backend/models/clubModel.js
// Club model with reward point calculations and tier management.
// GLOBAL REFERENCE: Club Object Structure, Database Schema → clubs table, Reward System
// PURPOSE: Handle club operations, reward points, tier calculations, and statistics.

const db = require('../config/database');

class Club {
    // Create new club application (for pending approval)
    static async createPending(clubData) {
        return await db.insertOne('clubs', {
            user_id: clubData.user_id,
            club_name: clubData.club_name,
            slug: clubData.slug,
            university: clubData.university,
            established_year: clubData.established_year || null,
            description: clubData.description,
            logo_url: clubData.logo_url ? clubData.logo_url : null,
            certificate_url: clubData.certificate_url ? clubData.certificate_url : null,
            contact_email: clubData.contact_email || null,
            status: 'pending',
            reward_points: 0,
            reward_tier: 'bronze'
        });
    }
    
    // Find club by ID
    static async findById(id) {
        return await db.getOne('SELECT * FROM clubs WHERE id = $1', [id]);
    }
    
    // Find club by slug
    static async findBySlug(slug) {
        return await db.getOne('SELECT * FROM clubs WHERE slug = $1', [slug]);
    }
    
    // Find club by user ID
    static async findByUserId(userId) {
        return await db.getOne('SELECT * FROM clubs WHERE user_id = $1', [userId]);
    }
    // Find club by name and university
    static async findByNameAndUniversity(clubName, university) {
        return await db.getOne(
            'SELECT * FROM clubs WHERE club_name = $1 AND university = $2 AND status = $3',
            [clubName, university, 'approved']
        );
    }
    // Check if slug exists
    static async slugExists(slug, excludeId = null) {
        if (excludeId) {
            return await db.exists('clubs', 'slug = $1 AND id != $2', [slug, excludeId]);
        }
        return await db.exists('clubs', 'slug = $1', [slug]);
    }
    
    // Get all clubs with filters
    // Get all clubs with filters
    static async findAll(filters = {}) {
        let query = `
            SELECT 
                c.id,
                c.user_id,
                c.club_name,
                c.slug,
                c.university,
                c.established_year,
                c.description,
                c.cover_photo_url,
                c.logo_url,
                c.facebook_url,
                c.instagram_url,
                c.website_url,
                c.contact_email,
                c.status,
                c.certificate_url,
                c.reward_points,
                c.reward_tier,
                c.total_earnings,
                c.total_sales,
                c.average_rating,
                c.created_at,
                c.updated_at,
                COALESCE(COUNT(DISTINCT p.id), 0) as product_count,
                COALESCE(COUNT(DISTINCT comp.id), 0) as competition_count,
                ROW_NUMBER() OVER (ORDER BY c.reward_points DESC, c.average_rating DESC) as leaderboard_rank
            FROM clubs c
            LEFT JOIN products p ON c.id = p.club_id AND p.status = 'active'
            LEFT JOIN competitions comp ON c.id = comp.club_id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;
        
        if (filters.status) {
            query += ` AND c.status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        if (filters.university) {
            query += ` AND c.university = $${paramCount}`;
            params.push(filters.university);
            paramCount++;
        }
        
        if (filters.tier) {
            query += ` AND c.reward_tier = $${paramCount}`;
            params.push(filters.tier);
            paramCount++;
        }
        
        if (filters.search) {
            query += ` AND (c.club_name ILIKE $${paramCount} OR c.university ILIKE $${paramCount})`;
            params.push(`%${filters.search}%`);
            paramCount++;
        }
        
        // Group by all selected columns
        query += ` GROUP BY c.id, c.user_id, c.club_name, c.slug, c.university, c.established_year, 
                   c.description, c.cover_photo_url, c.logo_url, c.facebook_url, c.instagram_url, 
                   c.website_url, c.contact_email, c.status, c.certificate_url, c.reward_points, 
                   c.reward_tier, c.total_earnings, c.total_sales, c.average_rating, c.created_at, c.updated_at`;
        
        // Sorting
        const sortBy = filters.sort_by || 'c.reward_points';
        const orderBy = filters.order_by || 'DESC';
        query += ` ORDER BY ${sortBy} ${orderBy}, c.average_rating DESC`;
        
        // Pagination
        const limit = filters.limit || 12;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        console.log('Executing query:', query);
        console.log('With params:', params);
        
        return await db.getMany(query, params);
    }
    
    // Get total count with filters
    static async count(filters = {}) {
        let whereClause = '1=1';
        const params = [];
        let paramCount = 1;
        
        if (filters.status) {
            whereClause += ` AND status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        if (filters.university) {
            whereClause += ` AND university = $${paramCount}`;
            params.push(filters.university);
            paramCount++;
        }
        
        return await db.count('clubs', whereClause, params);
    }
    
    // Approve club
    static async approve(id) {
        const result = await db.query(
            'UPDATE clubs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['approved', id]
        );
        return result.rows[0];
    }
    
    // Reject club
    static async reject(id) {
        const result = await db.query(
            'UPDATE clubs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['rejected', id]
        );
        return result.rows[0];
    }
    
    // Suspend club
    static async suspend(id) {
        const result = await db.query(
            'UPDATE clubs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['suspended', id]
        );
        return result.rows[0];
    }
    
    // Update club profile
    static async updateProfile(id, updates) {
        const allowedFields = [
            'club_name', 'slug', 'description', 'cover_photo_url', 'logo_url',
            'facebook_url', 'instagram_url', 'website_url', 'contact_email', 
            'contact_phone', 'established_year'
        ];
        
        const filteredUpdates = {};
        for (const field of allowedFields) {
            if (updates[field] !== undefined && updates[field] !== null) {
                filteredUpdates[field] = updates[field];
            }
        }
        
        if (Object.keys(filteredUpdates).length === 0) {
            throw new Error('No valid fields to update');
        }
        
        const result = await db.updateOne('clubs', id, filteredUpdates);
        
        // If logo was updated, trigger timestamp updates on related entities
        if (filteredUpdates.logo_url) {
            await db.query(
                'UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE club_id = $1',
                [id]
            );
            await db.query(
                'UPDATE competitions SET updated_at = CURRENT_TIMESTAMP WHERE club_id = $1',
                [id]
            );
        }
        
        return result;
    }
    
    // Add reward points
    static async addRewardPoints(clubId, points, actionType, description, relatedId = null) {
        await db.transaction(async (client) => {
            // Add points to club
            await client.query(
                'UPDATE clubs SET reward_points = reward_points + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [points, clubId]
            );
            
            // Record in history
            await client.query(
                'INSERT INTO reward_history (club_id, action_type, points_earned, description, related_id) VALUES ($1, $2, $3, $4, $5)',
                [clubId, actionType, points, description, relatedId]
            );
            
            // Update tier if needed
            await Club.updateTier(clubId, client);
        });
    }
    
    // Subtract reward points (for penalties)
    static async subtractRewardPoints(clubId, points, actionType, description) {
        await db.transaction(async (client) => {
            await client.query(
                'UPDATE clubs SET reward_points = GREATEST(0, reward_points - $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [points, clubId]
            );
            
            await client.query(
                'INSERT INTO reward_history (club_id, action_type, points_earned, description) VALUES ($1, $2, $3, $4)',
                [clubId, actionType, -points, description]
            );
            
            await Club.updateTier(clubId, client);
        });
    }
    
    // Update tier based on points
    static async updateTier(clubId, client = null) {
        const executeQuery = client ? client.query.bind(client) : db.query.bind(db);
        
        const result = client 
            ? await client.query('SELECT reward_points FROM clubs WHERE id = $1', [clubId])
            : await db.getOne('SELECT reward_points FROM clubs WHERE id = $1', [clubId]);
        
        const club = client ? result.rows[0] : result;
        if (!club) return;
        
        const points = club.reward_points;
        let newTier;
        
        if (points >= 5000) newTier = 'platinum';
        else if (points >= 1500) newTier = 'gold';
        else if (points >= 500) newTier = 'silver';
        else newTier = 'bronze';
        
        await executeQuery(
            'UPDATE clubs SET reward_tier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newTier, clubId]
        );
    }
    
    // Get club statistics
    static async getStatistics(clubId) {
        const stats = await db.getOne(`
            SELECT 
                c.id,
                c.club_name,
                c.reward_points,
                c.reward_tier,
                c.total_earnings,
                c.total_sales,
                c.average_rating,
                COALESCE(COUNT(DISTINCT p.id), 0) as product_count,
                COALESCE(COUNT(DISTINCT comp.id), 0) as competition_count,
                COALESCE(COUNT(DISTINCT CASE WHEN oi.status = 'pending' THEN o.id END), 0) as pending_orders,
                COALESCE(COUNT(DISTINCT CASE WHEN o.order_status = 'delivered' THEN o.id END), 0) as completed_orders
            FROM clubs c
            LEFT JOIN products p ON c.id = p.club_id AND p.status = 'active'
            LEFT JOIN competitions comp ON c.id = comp.club_id
            LEFT JOIN order_items oi ON c.id = oi.club_id
            LEFT JOIN orders o ON oi.order_id = o.id
            WHERE c.id = $1
            GROUP BY c.id, c.club_name, c.reward_points, c.reward_tier, c.total_earnings, c.total_sales, c.average_rating
        `, [clubId]);
        
        return stats;
    }
    
    // Get leaderboard
    static async getLeaderboard(limit = 10) {
        const leaderboard = await db.getMany(`
            WITH club_stats AS (
                SELECT 
                    c.id,
                    c.club_name,
                    c.slug,
                    c.university,
                    c.logo_url,
                    c.reward_points,
                    c.reward_tier,
                    c.total_sales,
                    c.average_rating,
                    c.established_year,
                    COALESCE(COUNT(DISTINCT p.id), 0) as product_count,
                    COALESCE(COUNT(DISTINCT comp.id), 0) as competition_count,
                    ROW_NUMBER() OVER (ORDER BY c.reward_points DESC, c.average_rating DESC) as leaderboard_rank
                FROM clubs c
                LEFT JOIN products p ON c.id = p.club_id AND p.status = 'active'
                LEFT JOIN competitions comp ON c.id = comp.club_id
                WHERE c.status = 'approved'
                GROUP BY c.id, c.club_name, c.slug, c.university, c.logo_url, c.reward_points, c.reward_tier, c.total_sales, c.average_rating, c.established_year
            )
            SELECT * FROM club_stats
            ORDER BY reward_points DESC, average_rating DESC
            LIMIT $1
        `, [limit]);
        
        console.log(`Leaderboard query returned ${leaderboard.length} clubs`);
        return leaderboard;
    }
    
    // Get club's rank
    static async getClubRank(clubId) {
        const result = await db.getOne(`
            SELECT rank FROM (
                SELECT id, ROW_NUMBER() OVER (ORDER BY reward_points DESC) as rank
                FROM clubs
                WHERE status = 'approved'
            ) ranked
            WHERE id = $1
        `, [clubId]);
        
        return result ? result.rank : null;
    }
    
    // Update earnings
    static async updateEarnings(clubId, amount) {
        await db.query(
            'UPDATE clubs SET total_earnings = total_earnings + $1, total_sales = total_sales + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [amount, clubId]
        );
    }
    
    // Update average rating
    static async updateAverageRating(clubId) {
        const result = await db.getOne(`
            SELECT AVG(r.rating) as avg_rating
            FROM reviews r
            JOIN products p ON r.product_id = p.id
            WHERE p.club_id = $1
        `, [clubId]);
        
        const avgRating = result && result.avg_rating ? parseFloat(result.avg_rating) : 0;
        
        await db.query(
            'UPDATE clubs SET average_rating = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [avgRating, clubId]
        );
    }
    
    // Calculate commission rate based on tier (reads from database)
    static async getCommissionRate(tier) {
        try {
            const setting = await db.getOne(
                `SELECT setting_value FROM platform_settings WHERE setting_key = 'commission_rates'`
            );
            
            if (setting && setting.setting_value) {
                const rates = typeof setting.setting_value === 'string' 
                    ? JSON.parse(setting.setting_value) 
                    : setting.setting_value;
                
                const rate = parseFloat(rates[tier.toLowerCase()]);
                return isNaN(rate) ? 0.05 : rate / 100; // Convert percentage to decimal
            }
        } catch (error) {
            console.error('Error fetching commission rate:', error);
        }
        
        // Fallback to defaults
        const fallbackRates = {
            bronze: 0.05,
            silver: 0.03,
            gold: 0.02,
            platinum: 0.01
        };
        return fallbackRates[tier.toLowerCase()] || 0.05;
    }
    
    // Synchronous version for backwards compatibility (uses cached rates)
    static getCommissionRateSync(tier) {
        // This is a fallback - use getCommissionRate() async version when possible
        const rates = {
            bronze: 0.05,
            silver: 0.03,
            gold: 0.02,
            platinum: 0.01
        };
        return rates[tier.toLowerCase()] || 0.05;
    }
    
    // Get reward history
    static async getRewardHistory(clubId, limit = 50) {
        return await db.getMany(`
            SELECT * FROM reward_history
            WHERE club_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [clubId, limit]);
    }
    
    // Get featured clubs
    static async getFeatured(limit = 3) {
        return await db.getMany(`
            SELECT * FROM clubs
            WHERE status = 'approved'
            ORDER BY reward_points DESC, average_rating DESC
            LIMIT $1
        `, [limit]);
    }
    
    // Get all universities (for filters)
    static async getUniversities() {
        const result = await db.getMany(`
            SELECT DISTINCT university
            FROM clubs
            WHERE status = 'approved'
            ORDER BY university
        `);
        return result.map(r => r.university);
    }
    
    // Platform statistics
    static async getPlatformStatistics() {
        const stats = await db.getOne(`
            SELECT 
                COUNT(*) as total_clubs,
                COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_clubs,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_clubs,
                SUM(total_earnings) as total_platform_earnings,
                SUM(total_sales) as total_platform_sales,
                AVG(average_rating) as platform_avg_rating
            FROM clubs
        `);
        
        return stats;
    }
}

module.exports = Club;