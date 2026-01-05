// backend/services/rewardService.js
// Reward points calculation, tier management, and leaderboard updates.
// GLOBAL REFERENCE: Reward System Configuration, Commission Rates, Tier Thresholds
// PURPOSE: Handle all reward-related business logic and automated point awards.

const db = require('../config/database');
const Club = require('../models/clubModel');

class RewardService {
    constructor() {
        // Tier thresholds
        this.tiers = {
            bronze: { min: 0, max: 499, name: 'Bronze' },
            silver: { min: 500, max: 1499, name: 'Silver' },
            gold: { min: 1500, max: 4999, name: 'Gold' },
            platinum: { min: 5000, max: Infinity, name: 'Platinum' }
        };
        
        // Points per action
        this.pointRules = {
            COMPETITION_CREATED: parseInt(process.env.POINTS_COMPETITION_CREATED) || 100,
            PER_100_TAKA: parseInt(process.env.POINTS_PER_100_TAKA) || 10,
            FIVE_STAR_REVIEW: parseInt(process.env.POINTS_FIVE_STAR_REVIEW) || 20,
            FAST_SHIPPING: parseInt(process.env.POINTS_FAST_SHIPPING) || 5,
            FIRST_SALE: 50,
            MILESTONE_10: 100,
            MILESTONE_50: 500,
            MILESTONE_100: 1000
        };
        
        // Commission rates loaded from database
        this.commissionRates = null;
        this.loadCommissionRates();
    }
    
    // Load commission rates from database
    async loadCommissionRates() {
        try {
            const setting = await db.getOne(
                `SELECT setting_value FROM platform_settings WHERE setting_key = 'commission_rates'`
            );
            
            if (setting && setting.setting_value) {
                const rates = typeof setting.setting_value === 'string' 
                    ? JSON.parse(setting.setting_value) 
                    : setting.setting_value;
                
                this.commissionRates = {
                    bronze: parseFloat(rates.bronze) / 100 || 0.05,
                    silver: parseFloat(rates.silver) / 100 || 0.03,
                    gold: parseFloat(rates.gold) / 100 || 0.02,
                    platinum: parseFloat(rates.platinum) / 100 || 0.01
                };
            }
        } catch (error) {
            console.error('Error loading commission rates:', error);
            this.commissionRates = {
                bronze: 0.05,
                silver: 0.03,
                gold: 0.02,
                platinum: 0.01
            };
        }
    }
    
    // Award points for competition creation
    async awardCompetitionPoints(clubId, competitionId, competitionTitle) {
        try {
            await Club.addRewardPoints(
                clubId,
                this.pointRules.COMPETITION_CREATED,
                'competition_created',
                `Created competition: ${competitionTitle}`,
                competitionId
            );
            
            console.log(`✅ Awarded ${this.pointRules.COMPETITION_CREATED} points to club ${clubId} for creating competition`);
            
            // Check for tier upgrade
            await this.checkAndUpgradeTier(clubId);
        } catch (error) {
            console.error('Error awarding competition points:', error);
        }
    }
    
    // Award points for sales (10 points per ৳100)
    async awardSalesPoints(clubId, orderTotal, orderId) {
        try {
            const points = Math.floor(orderTotal / 100) * this.pointRules.PER_100_TAKA;
            
            if (points > 0) {
                await Club.addRewardPoints(
                    clubId,
                    points,
                    'sale',
                    `Sales: ৳${orderTotal.toFixed(2)}`,
                    orderId
                );
                
                console.log(`✅ Awarded ${points} points to club ${clubId} for sale of ৳${orderTotal}`);
                
                // Check for milestones
                await this.checkSalesMilestones(clubId);
                
                // Check for tier upgrade
                await this.checkAndUpgradeTier(clubId);
            }
        } catch (error) {
            console.error('Error awarding sales points:', error);
        }
    }
    
    // Award points for 5-star reviews
    async awardReviewPoints(clubId, reviewId, productName) {
        try {
            await Club.addRewardPoints(
                clubId,
                this.pointRules.FIVE_STAR_REVIEW,
                'five_star_review',
                `5-star review on: ${productName}`,
                reviewId
            );
            
            console.log(`✅ Awarded ${this.pointRules.FIVE_STAR_REVIEW} points to club ${clubId} for 5-star review`);
            
            // Check for tier upgrade
            await this.checkAndUpgradeTier(clubId);
        } catch (error) {
            console.error('Error awarding review points:', error);
        }
    }
    
    // Award bonus points for fast shipping (<24h)
    async awardFastShippingBonus(clubId, orderItemId) {
        try {
            await Club.addRewardPoints(
                clubId,
                this.pointRules.FAST_SHIPPING,
                'fast_shipping',
                'Fast shipping bonus (shipped within 24 hours)',
                orderItemId
            );
            
            console.log(`✅ Awarded ${this.pointRules.FAST_SHIPPING} bonus points to club ${clubId} for fast shipping`);
        } catch (error) {
            console.error('Error awarding fast shipping bonus:', error);
        }
    }
    
    // Check and award sales milestones
    async checkSalesMilestones(clubId) {
        try {
            const club = await Club.findById(clubId);
            if (!club) return;
            
            const milestones = [
                { count: 1, points: this.pointRules.FIRST_SALE, type: 'first_sale', description: 'First sale milestone!' },
                { count: 10, points: this.pointRules.MILESTONE_10, type: 'milestone_10', description: '10 sales milestone!' },
                { count: 50, points: this.pointRules.MILESTONE_50, type: 'milestone_50', description: '50 sales milestone!' },
                { count: 100, points: this.pointRules.MILESTONE_100, type: 'milestone_100', description: '100 sales milestone!' }
            ];
            
            for (const milestone of milestones) {
                if (club.total_sales === milestone.count) {
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
                        
                        console.log(`🎉 Club ${clubId} reached ${milestone.description}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error checking sales milestones:', error);
        }
    }
    
    // Calculate tier from points
    getTierFromPoints(points) {
        if (points >= this.tiers.platinum.min) return 'platinum';
        if (points >= this.tiers.gold.min) return 'gold';
        if (points >= this.tiers.silver.min) return 'silver';
        return 'bronze';
    }
    
    // Get commission rate for tier
    async getCommissionRate(tier) {
        if (!this.commissionRates) {
            await this.loadCommissionRates();
        }
        return this.commissionRates[tier.toLowerCase()] || this.commissionRates.bronze;
    }
    
    // Calculate progress to next tier
    getTierProgress(currentPoints, currentTier) {
        const tier = this.tiers[currentTier.toLowerCase()];
        
        if (!tier || currentTier.toLowerCase() === 'platinum') {
            return {
                currentTier: 'platinum',
                currentTierName: 'Platinum',
                progress: 100,
                pointsToNext: 0,
                nextTier: null,
                nextTierName: null,
                isMaxTier: true
            };
        }
        
        const progress = ((currentPoints - tier.min) / (tier.max - tier.min + 1)) * 100;
        const pointsToNext = tier.max - currentPoints + 1;
        
        const tierOrder = ['bronze', 'silver', 'gold', 'platinum'];
        const currentIndex = tierOrder.indexOf(currentTier.toLowerCase());
        const nextTier = currentIndex < tierOrder.length - 1 ? tierOrder[currentIndex + 1] : null;
        
        return {
            currentTier: currentTier.toLowerCase(),
            currentTierName: this.tiers[currentTier.toLowerCase()].name,
            progress: Math.max(0, Math.min(100, Math.round(progress))),
            pointsToNext: Math.max(0, pointsToNext),
            nextTier,
            nextTierName: nextTier ? this.tiers[nextTier].name : null,
            isMaxTier: false
        };
    }
    
    // Get club benefits based on tier
    getTierBenefits(tier) {
        const benefits = {
            bronze: [
                'Basic marketplace features',
                '5% platform commission',
                'Standard listing visibility',
                'Email support'
            ],
            silver: [
                'All Bronze benefits',
                '3% platform commission (save 2%)',
                'Verified club badge',
                'Homepage featuring eligibility',
                'Priority customer support',
                'Basic analytics dashboard'
            ],
            gold: [
                'All Silver benefits',
                '2% platform commission (save 3%)',
                'Free featured product posts (1/month)',
                'Advanced analytics dashboard',
                'Early access to new features',
                'Promotional tools access'
            ],
            platinum: [
                'All Gold benefits',
                '1% platform commission (best rate - save 4%)',
                'Unlimited featured posts',
                'Premium badge with trophy icon',
                'Revenue sharing opportunities',
                'Dedicated account manager',
                'Priority in search results',
                'Custom branding options'
            ]
        };
        
        return benefits[tier.toLowerCase()] || benefits.bronze;
    }
    
    // Update leaderboard rankings (run periodically)
    async updateLeaderboardRankings() {
        try {
            // This can be run as a cron job or called after point updates
            await db.query(`
                WITH ranked_clubs AS (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY reward_points DESC) as new_rank
                    FROM clubs
                    WHERE status = 'approved'
                )
                UPDATE clubs c
                SET leaderboard_rank = rc.new_rank
                FROM ranked_clubs rc
                WHERE c.id = rc.id
            `);
            
            console.log('✅ Leaderboard rankings updated');
        } catch (error) {
            console.error('Error updating leaderboard:', error);
        }
    }
    
    // Get reward history for club
    async getRewardHistory(clubId, limit = 50) {
        try {
            const history = await db.getMany(`
                SELECT *
                FROM reward_history
                WHERE club_id = $1
                ORDER BY created_at DESC
                LIMIT $2
            `, [clubId, limit]);
            
            return history;
        } catch (error) {
            console.error('Error fetching reward history:', error);
            return [];
        }
    }
    
    // Get reward summary
    async getRewardSummary(clubId) {
        try {
            const summary = await db.getOne(`
                SELECT 
                    SUM(CASE WHEN action_type = 'sale' THEN points_earned ELSE 0 END) as sales_points,
                    SUM(CASE WHEN action_type = 'competition_created' THEN points_earned ELSE 0 END) as competition_points,
                    SUM(CASE WHEN action_type = 'five_star_review' THEN points_earned ELSE 0 END) as review_points,
                    SUM(CASE WHEN action_type = 'fast_shipping' THEN points_earned ELSE 0 END) as shipping_points,
                    SUM(CASE WHEN action_type LIKE 'milestone%' OR action_type = 'first_sale' THEN points_earned ELSE 0 END) as milestone_points,
                    SUM(CASE WHEN points_earned > 0 THEN points_earned ELSE 0 END) as total_earned,
                    COUNT(*) as total_activities
                FROM reward_history
                WHERE club_id = $1
            `, [clubId]);
            
            return summary;
        } catch (error) {
            console.error('Error fetching reward summary:', error);
            return null;
        }
    }
    
    // Calculate earnings after commission
    async calculateEarnings(orderTotal, tier) {
        const commissionRate = await this.getCommissionRate(tier);
        const clubEarnings = orderTotal * (1 - commissionRate);
        const platformCommission = orderTotal * commissionRate;
        
        return {
            clubEarnings: Math.round(clubEarnings * 100) / 100,
            platformCommission: Math.round(platformCommission * 100) / 100,
            commissionRate,
            commissionPercentage: `${(commissionRate * 100).toFixed(1)}%`
        };
    }
    
    // Generate monthly reward report for club
    async generateMonthlyReport(clubId, year, month) {
        try {
            const report = await db.getOne(`
                SELECT 
                    SUM(CASE WHEN action_type = 'sale' THEN points_earned ELSE 0 END) as sales_points,
                    SUM(CASE WHEN action_type = 'competition_created' THEN points_earned ELSE 0 END) as competition_points,
                    SUM(CASE WHEN action_type = 'five_star_review' THEN points_earned ELSE 0 END) as review_points,
                    SUM(CASE WHEN action_type = 'fast_shipping' THEN points_earned ELSE 0 END) as shipping_points,
                    SUM(CASE WHEN action_type LIKE 'milestone%' OR action_type = 'first_sale' THEN points_earned ELSE 0 END) as milestone_points,
                    SUM(points_earned) as total_points,
                    COUNT(*) as total_activities
                FROM reward_history
                WHERE club_id = $1
                    AND EXTRACT(YEAR FROM created_at) = $2
                    AND EXTRACT(MONTH FROM created_at) = $3
            `, [clubId, year, month]);
            
            return report;
        } catch (error) {
            console.error('Error generating monthly report:', error);
            return null;
        }
    }
    
    // Manually award bonus points (admin function)
    async awardBonusPoints(clubId, points, reason, adminId) {
        try {
            const actionType = points > 0 ? 'admin_bonus' : 'admin_deduction';
            const description = `Admin adjustment by user ${adminId}: ${reason}`;
            
            if (points > 0) {
                await Club.addRewardPoints(clubId, points, actionType, description, adminId);
            } else {
                await Club.subtractRewardPoints(clubId, Math.abs(points), actionType, description);
            }
            
            console.log(`✅ Admin ${points > 0 ? 'awarded' : 'deducted'} ${Math.abs(points)} points for club ${clubId}`);
            
            // Check for tier changes
            await this.checkAndUpgradeTier(clubId);
        } catch (error) {
            console.error('Error awarding bonus points:', error);
            throw error;
        }
    }
    
    // Check and upgrade tier if needed
    async checkAndUpgradeTier(clubId) {
        try {
            const club = await Club.findById(clubId);
            if (!club) return { upgraded: false };
            
            const newTier = this.getTierFromPoints(club.reward_points);
            
            if (newTier !== club.reward_tier) {
                await db.query(
                    'UPDATE clubs SET reward_tier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [newTier, clubId]
                );
                
                console.log(`🎉 Club ${clubId} upgraded from ${club.reward_tier} to ${newTier}!`);
                
                // TODO: Send notification email about tier upgrade
                
                return { upgraded: true, oldTier: club.reward_tier, newTier };
            }
            
            return { upgraded: false };
        } catch (error) {
            console.error('Error checking tier upgrade:', error);
            return { upgraded: false };
        }
    }
    
    // Get tier info for club
    async getTierInfo(clubId) {
        try {
            const club = await Club.findById(clubId);
            if (!club) return null;
            
            const progressInfo = this.getTierProgress(club.reward_points, club.reward_tier);
            const benefits = this.getTierBenefits(club.reward_tier);
            const commissionRate = this.getCommissionRate(club.reward_tier);
            
            return {
                ...progressInfo,
                current_points: club.reward_points,
                commission_rate: commissionRate,
                commission_percentage: `${(commissionRate * 100).toFixed(1)}%`,
                benefits
            };
        } catch (error) {
            console.error('Error getting tier info:', error);
            return null;
        }
    }
    
    // Get platform-wide reward statistics
    async getPlatformStatistics() {
        try {
            const stats = await db.getOne(`
                SELECT 
                    SUM(reward_points) as total_points_awarded,
                    COUNT(DISTINCT id) as clubs_with_points,
                    AVG(reward_points) as avg_points_per_club
                FROM clubs
                WHERE status = 'approved'
            `);
            
            const tierDistribution = await db.getMany(`
                SELECT 
                    reward_tier,
                    COUNT(*) as club_count,
                    ROUND(AVG(reward_points)) as avg_points
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
            
            const activityCount = await db.getOne(`
                SELECT COUNT(*) as total_actions
                FROM reward_history
            `);
            
            return {
                ...stats,
                tier_distribution: tierDistribution,
                total_reward_actions: parseInt(activityCount.total_actions)
            };
        } catch (error) {
            console.error('Error getting platform statistics:', error);
            return null;
        }
    }
}

// Create singleton instance
const rewardService = new RewardService();

module.exports = rewardService;