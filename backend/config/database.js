// backend/config/database.js
// PostgreSQL database connection and query helpers
// GLOBAL REFERENCE: Database Schema, Environment Variables
// PURPOSE: Database connection pool and helper functions for queries

const { Pool } = require('pg');

// Create connection pool with SSL support for Neon
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false  // Required for Neon PostgreSQL
    },
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
    console.log('📦 Database connection established');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database error:', err);
});

// Connect to database
async function connectDatabase() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        console.log('⏰ Database time:', result.rows[0].now);
        client.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        throw error;
    }
}

// Close pool
async function closePool() {
    try {
        await pool.end();
        console.log('Database pool closed');
    } catch (error) {
        console.error('Error closing pool:', error);
        throw error;
    }
}

// Query helper - execute query and return result
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        if (process.env.NODE_ENV === 'development') {
            console.log('Executed query', { text, duration, rows: result.rowCount });
        }
        
        return result;
    } catch (error) {
        console.error('Query error:', error);
        console.error('Query:', text);
        console.error('Params:', params);
        throw error;
    }
}

// Get one row
async function getOne(text, params) {
    const result = await query(text, params);
    return result.rows[0] || null;
}

// Get many rows
async function getMany(text, params) {
    const result = await query(text, params);
    return result.rows;
}

// Insert one record and return it
async function insertOne(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const text = `
        INSERT INTO ${table} (${keys.join(', ')})
        VALUES (${placeholders})
        RETURNING *
    `;
    
    const result = await query(text, values);
    return result.rows[0];
}

// Update one record by ID and return it
async function updateOne(table, id, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    
    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    
    const text = `
        UPDATE ${table}
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
    `;
    
    const result = await query(text, [id, ...values]);
    return result.rows[0];
}

// Delete one record by ID
async function deleteOne(table, id) {
    const text = `DELETE FROM ${table} WHERE id = $1 RETURNING *`;
    const result = await query(text, [id]);
    return result.rows[0];
}

// Check if record exists
async function exists(table, whereClause, params) {
    const text = `SELECT EXISTS(SELECT 1 FROM ${table} WHERE ${whereClause})`;
    const result = await query(text, params);
    return result.rows[0].exists;
}

// Count records
async function count(table, whereClause = '1=1', params = []) {
    const text = `SELECT COUNT(*) FROM ${table} WHERE ${whereClause}`;
    const result = await query(text, params);
    return parseInt(result.rows[0].count);
}

// Transaction helper
async function transaction(callback) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Batch insert
async function batchInsert(table, dataArray) {
    if (!dataArray || dataArray.length === 0) return [];
    
    const keys = Object.keys(dataArray[0]);
    const columns = keys.join(', ');
    
    let values = [];
    let placeholders = [];
    let paramCount = 1;
    
    dataArray.forEach((data, index) => {
        const rowPlaceholders = keys.map(() => `$${paramCount++}`);
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
        values.push(...Object.values(data));
    });
    
    const text = `
        INSERT INTO ${table} (${columns})
        VALUES ${placeholders.join(', ')}
        RETURNING *
    `;
    
    const result = await query(text, values);
    return result.rows;
}

// Paginate query
async function paginate(baseQuery, params, page = 1, limit = 10, orderBy = 'id DESC') {
    const offset = (page - 1) * limit;
    
    // Get total count
    const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS count_query`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);
    
    // Get paginated data
    const dataQuery = `
        ${baseQuery}
        ORDER BY ${orderBy}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    
    const dataResult = await query(dataQuery, [...params, limit, offset]);
    
    return {
        data: dataResult.rows,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
            hasNext: page < Math.ceil(total / limit),
            hasPrev: page > 1
        }
    };
}

// Search helper with full-text search
async function search(table, searchFields, searchTerm, additionalWhere = '1=1', params = []) {
    const searchConditions = searchFields.map(field => `${field} ILIKE $${params.length + 1}`).join(' OR ');
    
    const text = `
        SELECT * FROM ${table}
        WHERE (${searchConditions}) AND ${additionalWhere}
    `;
    
    const result = await query(text, [...params, `%${searchTerm}%`]);
    return result.rows;
}

// Get with relationships (simple join helper)
async function getWithRelation(baseTable, joinTable, joinCondition, whereClause = '1=1', params = []) {
    const text = `
        SELECT ${baseTable}.*, ${joinTable}.*
        FROM ${baseTable}
        LEFT JOIN ${joinTable} ON ${joinCondition}
        WHERE ${whereClause}
    `;
    
    const result = await query(text, params);
    return result.rows;
}

module.exports = {
    pool,
    connectDatabase,
    closePool,
    query,
    getOne,
    getMany,
    insertOne,
    updateOne,
    deleteOne,
    exists,
    count,
    transaction,
    batchInsert,
    paginate,
    search,
    getWithRelation
};