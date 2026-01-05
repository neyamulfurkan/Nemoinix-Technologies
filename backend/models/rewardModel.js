// backend/models/rewardModel.js
// Reward system model for managing points, tiers, and history.
// GLOBAL REFERENCE: Reward System, Database Schema → reward_history table
// PURPOSE: Calculate and award points, track history, manage tier benefits.

const db = require('../config/database');
const Club = require('./clubModel');

class Reward {
    // Point values for different actions
    static POINTS = {
        COMPETITION_CREATED: 100,
        SALES_PER_100_TAKA: 10,
        FIVE_STAR_REVIEW: 20,
        FAST_SHIPPING: 5,
        FIRST_SALE: 50,
        MILESTONE_10_SALES: 100,
        MILESTONE_50_SALES: 500,
        MILESTONE_100_SALES: 1000
    };
    
    // Tier thresholds
    static TIERS = {
        BRONZE: { min: 0, max: 499 },
        SILVER: { min: 500, max: 1499 },
        GOLD: { min: 1500, max: 4999 },
        PLATINUM: { min: 5000, max: Infinity }
    };
    
    // Award points for competition creation
    static async awardCompetitionPoints(clubId, competitionId, competitionTitle) {
        await Club.addRewardPoints(
            clubId,
            Reward.POINTS.COMPETITION_CREATED,
            'competition_created',
            `Created competition: ${competitionTitle}`,
            competitionId
        );
    }
    
    // Award points for sales
    static async awardSalesPoints(clubId, orderId, amount) {
        const points = Math.floor(amount / 100) * Reward.POINTS.SALES_PER_100_TAKA;
        
        if (points > 0) {
            await Club.addRewardPoints(
                clubId,
                points,
                'sales',
                `Sales: ৳${amount.toFixed(2)}`,
                orderId
            );
        }
    }
    
    // Award points for 5-star review
    static async awardReviewPoints(clubId, reviewId, productName) {
        await Club.addRewardPoints(
            clubId,
            Reward.POINTS.FIVE_STAR_REVIEW,
            'five_star_review',
            `Received 5-star review on: ${productName}`,
            reviewId
        );
    }
    
    // Award points for fast shipping (within 24 hours)
    static async awardFastShippingPoints(clubId, orderId) {
        await Club.addRewardPoints(
            clubId,
            Reward.POINTS.FAST_SHIPPING,
            'fast_shipping',
            'Fast shipping bonus (< 24 hours)',
            orderId
        );
    }
    
    // Award milestone points
    static async checkAndAwardMilestones(clubId) {
        const club = await Club.findById(clubId);
        if (!club) return;
        
        const totalSales = club.total_sales;
        
        // Check if club just reached a milestone
        const milestones = [
            { count: 1, points: Reward.POINTS.FIRST_SALE, type: 'first_sale', description: 'First sale milestone!' },
            { count: 10, points: Reward.POINTS.MILESTONE_10_SALES, type: 'milestone_10', description: '10 sales milestone!' },
            { count: 50, points: Reward.POINTS.MILESTONE_50_SALES, type: 'milestone_50', description: '50 sales milestone!' },
            { count: 100, points: Reward.POINTS.MILESTONE_100_SALES, type: 'milestone_100', description: '100 sales milestone!' }
        ];
        
        for (const milestone of milestones) {
            if (totalSales === milestone.count) {
                // Check if already awarded
                const exists = await db.exists(
                    'reward_history',
                    'club_id = $1 AND action_type = $2',
                    [clubId, milestone.type]
                );
                
                if (!exists) {
                    await Club.addRewardPoints(
                        clubId,
                        milestone.points,
                        milestone.type,
                        milestone.description,
                        null
                    );
                }
            }
        }
    }
    
    // Get reward history
    static async getHistory(clubId, filters = {}) {
        let query = `
            SELECT * FROM reward_history
            WHERE club_id = $1
        `;
        const params = [clubId];
        let paramCount = 2;
        
        if (filters.action_type) {
            query += ` AND action_type = $${paramCount}`;
            params.push(filters.action_type);
            paramCount++;
        }
        
        if (filters.start_date) {
            query += ` AND created_at >= $${paramCount}`;
            params.push(filters.start_date);
            paramCount++;
        }
        
        if (filters.end_date) {
            query += ` AND created_at <= $${paramCount}`;
            params.push(filters.end_date);
            paramCount++;
        }
        
        query += ' ORDER BY created_at DESC';
        
        const limit = filters.limit || 50;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        return await db.getMany(query, params);
    }
    
    // Get points summary
    static async getSummary(clubId) {
        const summary = await db.getOne(`
            SELECT 
                SUM(CASE WHEN action_type = 'competition_created' THEN points_earned ELSE 0 END) as competition_points,
                SUM(CASE WHEN action_type = 'sales' THEN points_earned ELSE 0 END) as sales_points,
                SUM(CASE WHEN action_type = 'five_star_review' THEN points_earned ELSE 0 END) as review_points,
                SUM(CASE WHEN action_type = 'fast_shipping' THEN points_earned ELSE 0 END) as shipping_points,
                SUM(CASE WHEN action_type LIKE 'milestone%' OR action_type = 'first_sale' THEN points_earned ELSE 0 END) as milestone_points,
                SUM(CASE WHEN points_earned > 0 THEN points_earned ELSE 0 END) as total_earned,
                SUM(CASE WHEN points_earned < 0 THEN ABS(points_earned) ELSE 0 END) as total_deducted,
                COUNT(*) as total_actions
            FROM reward_history
            WHERE club_id = $1
        `, [clubId]);
        
        return summary;
    }
    
    // Get tier info for club
    static async getTierInfo(clubId) {
        const club = await Club.findById(clubId);
        if (!club) return null;
        
        const currentPoints = club.reward_points;
        const currentTier = club.reward_tier;
        
        let nextTier = null;
        let pointsToNextTier = 0;
        let progressPercentage = 0;
        
        if (currentTier === 'bronze') {
            nextTier = 'silver';
            pointsToNextTier = Reward.TIERS.SILVER.min - currentPoints;
            progressPercentage = (currentPoints / Reward.TIERS.SILVER.min) * 100;
        } else if (currentTier === 'silver') {
            nextTier = 'gold';
            pointsToNextTier = Reward.TIERS.GOLD.min - currentPoints;
            const tierRange = Reward.TIERS.GOLD.min - Reward.TIERS.SILVER.min;
            progressPercentage = ((currentPoints - Reward.TIERS.SILVER.min) / tierRange) * 100;
        } else if (currentTier === 'gold') {
            nextTier = 'platinum';
            pointsToNextTier = Reward.TIERS.PLATINUM.min - currentPoints;
            const tierRange = Reward.TIERS.PLATINUM.min - Reward.TIERS.GOLD.min;
            progressPercentage = ((currentPoints - Reward.TIERS.GOLD.min) / tierRange) * 100;
        } else {
            nextTier = null;
            pointsToNextTier = 0;
            progressPercentage = 100;
        }
        
        // Fetch actual commission rate from database
        const commissionRate = await Club.getCommissionRate(currentTier);
        
        return {
            current_tier: currentTier,
            current_points: currentPoints,
            next_tier: nextTier,
            points_to_next_tier: Math.max(0, pointsToNextTier),
            progress_percentage: Math.min(100, Math.max(0, progressPercentage)),
            commission_rate: commissionRate,
            commission_percentage: `${(commissionRate * 100).toFixed(1)}%`,
            benefits: Reward.getTierBenefits(currentTier)
        };
    }
    
    // Get tier benefits
    static getTierBenefits(tier) {
        const benefits = {
            bronze: [
                'Basic seller features',
                '5% platform commission',
                'Standard support',
                'Product listings',
                'Competition hosting'
            ],
            silver: [
                'All Bronze benefits',
                '3% platform commission',
                'Verified badge',
                'Homepage featuring',
                'Priority support',
                'Advanced analytics'
            ],
            gold: [
                'All Silver benefits',
                '2% platform commission',
                'Free featured posts (2/month)',
                'Advanced analytics',
                'Promotional tools',
                'Custom branding'
            ],
            platinum: [
                'All Gold benefits',
                '1% platform commission',
                'Free advertisements',
                'Revenue sharing program',
                'Platinum trophy badge',
                'Dedicated account manager',
                'API access'
            ]
        };
        
        return benefits[tier] || benefits.bronze;
    }
    
    // Calculate points for order (with fast shipping check)
    static async calculateAndAwardOrderPoints(clubId, orderId, orderAmount, orderCreatedAt) {
        await db.transaction(async (client) => {
            // Award sales points
            await Reward.awardSalesPoints(clubId, orderId, orderAmount);
            
            // Check for fast shipping
            const orderItem = await client.query(
                'SELECT updated_at FROM order_items WHERE order_id = $1 AND status = $2 LIMIT 1',
                [orderId, 'shipped']
            );
            
            if (orderItem.rows.length > 0) {
                const shippedAt = new Date(orderItem.rows[0].updated_at);
                const createdAt = new Date(orderCreatedAt);
                const hoursDiff = (shippedAt - createdAt) / (1000 * 60 * 60);
                
                if (hoursDiff < 24) {
                    await Reward.awardFastShippingPoints(clubId, orderId);
                }
            }
            
            // Check milestones
            await Reward.checkAndAwardMilestones(clubId);
        });
    }
    
    // Manually adjust points (super admin only)
    static async manualAdjustment(clubId, points, reason, adminId) {
        const actionType = points > 0 ? 'manual_addition' : 'manual_deduction';
        const description = `Manual adjustment by admin ${adminId}: ${reason}`;
        
        if (points > 0) {
            await Club.addRewardPoints(clubId, points, actionType, description, null);
        } else {
            await Club.subtractRewardPoints(clubId, Math.abs(points), actionType, description);
        }
    }
    
    // Get platform-wide reward statistics
    static async getPlatformStatistics() {
        const stats = await db.getOne(`
            SELECT 
                SUM(points_earned) as total_points_awarded,
                COUNT(DISTINCT club_id) as clubs_with_points,
                COUNT(*) as total_reward_actions,
                AVG(points_earned) as avg_points_per_action
            FROM reward_history
            WHERE points_earned > 0
        `);
        
        const tierDistribution = await db.getMany(`
            SELECT 
                reward_tier,
                COUNT(*) as club_count
            FROM clubs
            WHERE status = 'approved'
            GROUP BY reward_tier
            ORDER BY 
                CASE reward_tier
                    WHEN 'platinum' THEN 4
                    WHEN 'gold' THEN 3
                    WHEN 'silver' THEN 2
                    WHEN 'bronze' THEN 1
                END DESC
        `);
        
        return {
            ...stats,
            tier_distribution: tierDistribution
        };
    }
    
    // Get recent activities for club
    static async getRecentActivities(clubId, limit = 10) {
        return await db.getMany(`
            SELECT * FROM reward_history
            WHERE club_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [clubId, limit]);
    }
}

module.exports = Reward;