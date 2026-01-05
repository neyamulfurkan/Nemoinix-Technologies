// backend/models/registrationModel.js
// Competition registration model with payment verification and approval workflow.
// GLOBAL REFERENCE: Database Schema → competition_registrations table
// PURPOSE: Handle competition registrations, payment verification, and approval process.

const db = require('../config/database');

class Registration {
    // Create new registration
    static async create(registrationData) {
        const registration = await db.insertOne('competition_registrations', {
            competition_id: registrationData.competition_id,
            user_id: registrationData.user_id,
            team_name: registrationData.team_name,
            team_members: registrationData.team_members,
            phone: registrationData.phone,
            registration_fee: registrationData.registration_fee,
            payment_method: registrationData.payment_method,
            payment_screenshot_url: registrationData.payment_screenshot_url || null,
            transaction_id: registrationData.transaction_id || null,
            payment_status: registrationData.payment_method === 'cash_on_delivery' ? 'pending' : 'pending',
            registration_status: 'pending'
        });
        
        return registration;
    }
    
    // Find registration by ID
    static async findById(id) {
        return await db.getOne(`
            SELECT 
                cr.*,
                c.title as competition_title,
                c.competition_date,
                c.competition_time,
                c.venue,
                c.club_id,
                u.full_name as user_name,
                u.email as user_email,
                cl.club_name
            FROM competition_registrations cr
            JOIN competitions c ON cr.competition_id = c.id
            JOIN users u ON cr.user_id = u.id
            JOIN clubs cl ON c.club_id = cl.id
            WHERE cr.id = $1
        `, [id]);
    }
    
    // Find user registrations
    static async findByUserId(userId, filters = {}) {
        let query = `
            SELECT 
                cr.*,
                c.title,
                c.competition_date,
                c.competition_time,
                c.venue,
                c.banner_url,
                c.slug as competition_slug,
                club.club_name,
                club.logo_url as club_logo
            FROM competition_registrations cr
            JOIN competitions c ON cr.competition_id = c.id
            JOIN clubs club ON c.club_id = club.id
            WHERE cr.user_id = $1
        `;
        
        const params = [userId];
        let paramCount = 2;
        
        if (filters.status === 'upcoming') {
            query += ` AND c.competition_date >= CURRENT_DATE`;
        } else if (filters.status === 'past') {
            query += ` AND c.competition_date < CURRENT_DATE`;
        }
        
        if (filters.registration_status) {
            query += ` AND cr.registration_status = $${paramCount}`;
            params.push(filters.registration_status);
            paramCount++;
        }
        
        if (filters.payment_status) {
            query += ` AND cr.payment_status = $${paramCount}`;
            params.push(filters.payment_status);
            paramCount++;
        }
        
        query += ' ORDER BY c.competition_date ASC';
        
        return await db.getMany(query, params);
    }
    
    // Find competition registrations (for club admin)
    static async findByCompetitionId(competitionId, filters = {}) {
        let query = `
            SELECT 
                cr.*,
                u.full_name,
                u.email,
                u.phone as user_phone,
                u.university,
                u.student_id
            FROM competition_registrations cr
            JOIN users u ON cr.user_id = u.id
            WHERE cr.competition_id = $1
        `;
        
        const params = [competitionId];
        let paramCount = 2;
        
        if (filters.registration_status) {
            query += ` AND cr.registration_status = $${paramCount}`;
            params.push(filters.registration_status);
            paramCount++;
        }
        
        if (filters.payment_status) {
            query += ` AND cr.payment_status = $${paramCount}`;
            params.push(filters.payment_status);
            paramCount++;
        }
        
        query += ' ORDER BY cr.created_at DESC';
        
        return await db.getMany(query, params);
    }
    
    // Check if user already registered (excluding rejected/cancelled)
    static async checkExistingRegistration(userId, competitionId) {
        const existing = await db.getOne(
            'SELECT id, registration_status FROM competition_registrations WHERE user_id = $1 AND competition_id = $2 AND registration_status NOT IN ($3, $4)',
            [userId, competitionId, 'rejected', 'cancelled']
        );
        return existing;
    }
    
    // Approve registration
    static async approve(id) {
        const result = await db.query(
            'UPDATE competition_registrations SET registration_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['approved', id]
        );
        return result.rows[0];
    }
    
    // Reject registration
    static async reject(id) {
        const result = await db.query(
            'UPDATE competition_registrations SET registration_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['rejected', id]
        );
        return result.rows[0];
    }
    
    // Verify payment
    static async verifyPayment(id) {
        const result = await db.query(
            'UPDATE competition_registrations SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['verified', id]
        );
        return result.rows[0];
    }
    
    // Mark payment as failed
    static async failPayment(id) {
        const result = await db.query(
            'UPDATE competition_registrations SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['failed', id]
        );
        return result.rows[0];
    }
    
    // Update registration
    static async update(id, updates) {
        const allowedFields = ['team_name', 'team_members', 'phone', 'payment_screenshot_url', 'transaction_id'];
        const filteredUpdates = {};
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                filteredUpdates[field] = updates[field];
            }
        }
        
        if (Object.keys(filteredUpdates).length === 0) {
            throw new Error('No valid fields to update');
        }
        
        return await db.updateOne('competition_registrations', id, filteredUpdates);
    }
    
    // Delete registration
    static async delete(id) {
        return await db.deleteOne('competition_registrations', id);
    }
    
    // Get registration statistics for a competition
    static async getStatistics(competitionId) {
        return await db.getOne(`
            SELECT 
                COUNT(*) as total_registrations,
                COUNT(CASE WHEN registration_status = 'approved' THEN 1 END) as approved_count,
                COUNT(CASE WHEN registration_status = 'pending' THEN 1 END) as pending_count,
                COUNT(CASE WHEN registration_status = 'rejected' THEN 1 END) as rejected_count,
                COUNT(CASE WHEN payment_status = 'verified' THEN 1 END) as paid_count,
                COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_payment_count,
                SUM(registration_fee) as total_revenue,
                SUM(CASE WHEN payment_status = 'verified' THEN registration_fee ELSE 0 END) as verified_revenue
            FROM competition_registrations
            WHERE competition_id = $1
        `, [competitionId]);
    }
    
    // Get all registrations for club (across all competitions)
    static async findByClubId(clubId, filters = {}) {
        let query = `
            SELECT 
                cr.*,
                c.title as competition_title,
                c.competition_date,
                u.full_name as user_name,
                u.email as user_email
            FROM competition_registrations cr
            JOIN competitions c ON cr.competition_id = c.id
            JOIN users u ON cr.user_id = u.id
            WHERE c.club_id = $1
        `;
        
        const params = [clubId];
        let paramCount = 2;
        
        if (filters.registration_status) {
            query += ` AND cr.registration_status = $${paramCount}`;
            params.push(filters.registration_status);
            paramCount++;
        }
        
        if (filters.payment_status) {
            query += ` AND cr.payment_status = $${paramCount}`;
            params.push(filters.payment_status);
            paramCount++;
        }
        
        query += ' ORDER BY cr.created_at DESC LIMIT 100';
        
        return await db.getMany(query, params);
    }
    
    // Count registrations
    static async count(filters = {}) {
        let whereClause = '1=1';
        const params = [];
        let paramCount = 1;
        
        if (filters.competition_id) {
            whereClause += ` AND competition_id = $${paramCount}`;
            params.push(filters.competition_id);
            paramCount++;
        }
        
        if (filters.user_id) {
            whereClause += ` AND user_id = $${paramCount}`;
            params.push(filters.user_id);
            paramCount++;
        }
        
        if (filters.registration_status) {
            whereClause += ` AND registration_status = $${paramCount}`;
            params.push(filters.registration_status);
            paramCount++;
        }
        
        return await db.count('competition_registrations', whereClause, params);
    }
    
    // Get recent registrations for dashboard
    static async getRecent(clubId, limit = 10) {
        return await db.getMany(`
            SELECT 
                cr.*,
                c.title as competition_title,
                u.full_name as user_name,
                u.email as user_email
            FROM competition_registrations cr
            JOIN competitions c ON cr.competition_id = c.id
            JOIN users u ON cr.user_id = u.id
            WHERE c.club_id = $1
            ORDER BY cr.created_at DESC
            LIMIT $2
        `, [clubId, limit]);
    }
}

module.exports = Registration;