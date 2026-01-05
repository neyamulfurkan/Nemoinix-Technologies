// backend/models/orderModel.js
// Order model with order items, status tracking, and fulfillment management.
// GLOBAL REFERENCE: Order Object Structure, Database Schema → orders table, order_items table
// PURPOSE: Handle order creation, tracking, and fulfillment operations.

const db = require('../config/database');
const crypto = require('crypto');

class Order {
    // Generate unique order number
    static generateOrderNumber() {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = crypto.randomBytes(2).toString('hex').toUpperCase();
        return `BD${timestamp}${random}`;
    }
    
    // Create new order
    static async create(orderData) {
        return await db.transaction(async (client) => {
            // Generate order number
            const orderNumber = Order.generateOrderNumber();
            
            // Insert order
            const orderResult = await client.query(`
                INSERT INTO orders (
                    order_number, user_id, total_amount, shipping_cost,
                    grand_total, payment_method, payment_screenshot_url,
                    transaction_id, payment_status, order_status,
                    delivery_name, delivery_phone, delivery_address,
                    delivery_city, delivery_district, delivery_division,
                    delivery_postal_code
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING *
            `, [
                orderNumber,
                orderData.user_id,
                orderData.total_amount,
                orderData.shipping_cost,
                orderData.grand_total,
                orderData.payment_method,
                orderData.payment_screenshot_url || null,
                orderData.transaction_id || null,
                orderData.payment_status || 'pending',
                'pending',
                orderData.delivery_name,
                orderData.delivery_phone,
                orderData.delivery_address,
                orderData.delivery_city,
                orderData.delivery_district,
                orderData.delivery_division,
                orderData.delivery_postal_code
            ]);
            
            const order = orderResult.rows[0];
            
            // Insert order items
            for (const item of orderData.items) {
                await client.query(`
                    INSERT INTO order_items (
                        order_id, product_id, club_id, product_name,
                        price, quantity, subtotal, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    order.id,
                    item.product_id,
                    item.club_id,
                    item.product_name,
                    item.price,
                    item.quantity,
                    item.subtotal,
                    'pending'
                ]);
                
                // Decrement product stock
                await client.query(
                    'UPDATE products SET stock = stock - $1, sales_count = sales_count + 1 WHERE id = $2',
                    [item.quantity, item.product_id]
                );
            }
            
            return order;
        });
    }
    
    // Find order by ID with all items
    static async findById(id) {
        const order = await db.getOne(`
            SELECT 
                o.*,
                u.full_name as user_name,
                u.email as user_email,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', oi.id,
                            'product_id', oi.product_id,
                            'product_name', oi.product_name,
                            'product_image', (
                                SELECT image_url 
                                FROM product_images 
                                WHERE product_id = oi.product_id 
                                ORDER BY display_order 
                                LIMIT 1
                            ),
                            'club_id', oi.club_id,
                            'club_name', c.club_name,
                            'price', oi.price,
                            'quantity', oi.quantity,
                            'subtotal', oi.subtotal,
                            'status', oi.status,
                            'tracking_number', oi.tracking_number,
                            'courier_name', oi.courier_name
                        )
                        ORDER BY oi.id
                    ) FILTER (WHERE oi.id IS NOT NULL),
                    '[]'
                ) as items
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN clubs c ON oi.club_id = c.id
            WHERE o.id = $1
            GROUP BY o.id, u.full_name, u.email
        `, [id]);
        
        if (order) {
            order.items = typeof order.items === 'string'
                ? JSON.parse(order.items)
                : order.items;
        }
        
        return order;
    }
    
    // Find order by order number
    static async findByOrderNumber(orderNumber) {
        const order = await db.getOne(`
            SELECT 
                o.*,
                u.full_name as user_name,
                u.email as user_email,
                u.phone as user_phone,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', oi.id,
                            'product_id', oi.product_id,
                            'product_name', oi.product_name,
                            'product_image', (
                                SELECT image_url 
                                FROM product_images 
                                WHERE product_id = oi.product_id 
                                ORDER BY display_order 
                                LIMIT 1
                            ),
                            'club_id', oi.club_id,
                            'club_name', c.club_name,
                            'price', oi.price,
                            'quantity', oi.quantity,
                            'subtotal', oi.subtotal,
                            'status', oi.status,
                            'tracking_number', oi.tracking_number,
                            'courier_name', oi.courier_name
                        )
                        ORDER BY oi.id
                    ) FILTER (WHERE oi.id IS NOT NULL),
                    '[]'
                ) as items
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN clubs c ON oi.club_id = c.id
            WHERE o.order_number = $1
            GROUP BY o.id, u.full_name, u.email, u.phone
        `, [orderNumber]);
        
        if (order) {
            order.items = typeof order.items === 'string'
                ? JSON.parse(order.items)
                : order.items;
        }
        
        return order;
    }
    
    // Get user's orders
    static async findByUserId(userId, filters = {}) {
        let query = `
            SELECT 
                o.*,
                COUNT(oi.id) as item_count
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.user_id = $1
        `;
        const params = [userId];
        let paramCount = 2;
        
        if (filters.status) {
            query += ` AND o.order_status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        query += ' GROUP BY o.id ORDER BY o.created_at DESC';
        
        // Pagination
        const limit = filters.limit || 20;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        return await db.getMany(query, params);
    }
    
    // Get club's received orders
    static async findByClubId(clubId, filters = {}) {
        let query = `
            SELECT DISTINCT
                o.id,
                o.order_number,
                o.created_at,
                o.order_status,
                o.payment_status,
                o.grand_total,
                u.full_name as user_name,
                u.email as user_email,
                u.phone as user_phone,
                COUNT(oi.id) as item_count,
                SUM(oi.subtotal) as club_total
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN users u ON o.user_id = u.id
            WHERE oi.club_id = $1
        `;
        const params = [clubId];
        let paramCount = 2;
        
        if (filters.status) {
            query += ` AND oi.status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        query += ' GROUP BY o.id, u.full_name, u.email, u.phone ORDER BY o.created_at DESC';
        
        // Pagination
        const limit = filters.limit || 20;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        return await db.getMany(query, params);
    }
    
    // Get all orders (for super admin)
    static async findAll(filters = {}) {
        let query = `
            SELECT 
                o.*,
                u.full_name as user_name,
                u.email as user_email,
                COUNT(oi.id) as item_count
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;
        
        if (filters.status) {
            query += ` AND o.order_status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        if (filters.payment_status) {
            query += ` AND o.payment_status = $${paramCount}`;
            params.push(filters.payment_status);
            paramCount++;
        }
        
        if (filters.search) {
            query += ` AND (o.order_number ILIKE $${paramCount} OR u.full_name ILIKE $${paramCount})`;
            params.push(`%${filters.search}%`);
            paramCount++;
        }
        
        query += ' GROUP BY o.id, u.full_name, u.email ORDER BY o.created_at DESC';
        
        // Pagination
        const limit = filters.limit || 50;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        
        return await db.getMany(query, params);
    }
    
    // Update order status
    static async updateStatus(id, status) {
        await db.query(
            'UPDATE orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, id]
        );
    }
    
    // Update payment status
    static async updatePaymentStatus(id, status) {
        await db.query(
            'UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, id]
        );
    }
    
    // Update order item status
    static async updateItemStatus(itemId, status, trackingNumber = null, courierName = null) {
        const updates = { status };
        
        if (trackingNumber) updates.tracking_number = trackingNumber;
        if (courierName) updates.courier_name = courierName;
        
        await db.updateOne('order_items', itemId, updates);
    }
    
    // Confirm delivery
    static async confirmDelivery(id) {
        await db.transaction(async (client) => {
            // Get order payment method to check if COD
            const order = await client.query(
                'SELECT payment_method, payment_status FROM orders WHERE id = $1',
                [id]
            );
            
            if (!order.rows[0]) {
                throw new Error('Order not found');
            }
            
            const paymentMethod = order.rows[0].payment_method;
            const currentPaymentStatus = order.rows[0].payment_status;
            
            // Update order status
            await client.query(
                'UPDATE orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['delivered', id]
            );
            
            // If Cash on Delivery, mark payment as verified upon delivery
            if (paymentMethod === 'cash_on_delivery' && currentPaymentStatus === 'pending') {
                await client.query(
                    'UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    ['verified', id]
                );
            }
            
            // Update all order items status
            await client.query(
                'UPDATE order_items SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2',
                ['delivered', id]
            );
            
            // Update club earnings
            const items = await client.query(
                'SELECT club_id, subtotal FROM order_items WHERE order_id = $1',
                [id]
            );
            
            for (const item of items.rows) {
                await client.query(
                    'UPDATE clubs SET total_earnings = total_earnings + $1, total_sales = total_sales + 1 WHERE id = $2',
                    [item.subtotal, item.club_id]
                );
            }
        });
    }
    
    // Cancel order
    static async cancel(id) {
        await db.transaction(async (client) => {
            // Get order items
            const items = await client.query(
                'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
                [id]
            );
            
            // Restore product stock
            for (const item of items.rows) {
                await client.query(
                    'UPDATE products SET stock = stock + $1, sales_count = GREATEST(0, sales_count - 1) WHERE id = $2',
                    [item.quantity, item.product_id]
                );
            }
            
            // Update order status
            await client.query(
                'UPDATE orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['cancelled', id]
            );
            
            // Update order items status
            await client.query(
                'UPDATE order_items SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2',
                ['cancelled', id]
            );
        });
    }
    
    // Get order statistics
    static async getStatistics(filters = {}) {
        let whereClause = '1=1';
        const params = [];
        let paramCount = 1;
        
        if (filters.club_id) {
            whereClause = 'oi.club_id = $1';
            params.push(filters.club_id);
            paramCount++;
        }
        
        if (filters.user_id) {
            whereClause += ` AND o.user_id = $${paramCount}`;
            params.push(filters.user_id);
            paramCount++;
        }
        
        const query = `
            SELECT 
                COUNT(DISTINCT o.id) as total_orders,
                COUNT(DISTINCT CASE WHEN o.order_status = 'pending' THEN o.id END) as pending_orders,
                COUNT(DISTINCT CASE WHEN o.order_status = 'delivered' THEN o.id END) as delivered_orders,
                COALESCE(SUM(CASE WHEN o.order_status = 'delivered' THEN ${filters.club_id ? 'oi.subtotal' : 'o.grand_total'} END), 0) as total_revenue
            FROM orders o
            ${filters.club_id ? 'JOIN order_items oi ON o.id = oi.order_id' : 'LEFT JOIN order_items oi ON o.id = oi.order_id'}
            WHERE ${whereClause}
        `;
        
        return await db.getOne(query, params);
    }
    
    // Count orders
    static async count(filters = {}) {
        let whereClause = '1=1';
        const params = [];
        let paramCount = 1;
        
        if (filters.status) {
            whereClause += ` AND order_status = $${paramCount}`;
            params.push(filters.status);
            paramCount++;
        }
        
        if (filters.user_id) {
            whereClause += ` AND user_id = $${paramCount}`;
            params.push(filters.user_id);
            paramCount++;
        }
        
        return await db.count('orders', whereClause, params);
    }
}

module.exports = Order;