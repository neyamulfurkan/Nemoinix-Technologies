// backend/services/paymentService.js
// Payment processing service for future bKash/Nagad integration.
// GLOBAL REFERENCE: Payment Methods, Order Structure
// PURPOSE: Handle payment verification, processing, and webhook management (prepared for future integration).

const crypto = require('crypto');
const axios = require('axios');
const db = require('../config/database');

class PaymentService {
    constructor() {
        // bKash configuration
        this.bkash = {
            baseUrl: process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
            appKey: process.env.BKASH_APP_KEY,
            appSecret: process.env.BKASH_APP_SECRET,
            username: process.env.BKASH_USERNAME,
            password: process.env.BKASH_PASSWORD,
            token: null,
            tokenExpiry: null
        };
        
        // Nagad configuration
        this.nagad = {
            baseUrl: process.env.NAGAD_BASE_URL || 'http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs',
            merchantId: process.env.NAGAD_MERCHANT_ID,
            merchantNumber: process.env.NAGAD_MERCHANT_NUMBER,
            publicKey: process.env.NAGAD_PUBLIC_KEY,
            privateKey: process.env.NAGAD_PRIVATE_KEY
        };
        
        // Payment status mapping
        this.paymentStatuses = {
            PENDING: 'pending',
            VERIFIED: 'verified',
            FAILED: 'failed',
            REFUNDED: 'refunded'
        };
    }
    
    // ============= bKash Methods =============
    
    // Get bKash auth token
    async getBkashToken() {
        // Check if token is still valid
        if (this.bkash.token && this.bkash.tokenExpiry > Date.now()) {
            return this.bkash.token;
        }
        
        try {
            const response = await axios.post(
                `${this.bkash.baseUrl}/checkout/token/grant`,
                {
                    app_key: this.bkash.appKey,
                    app_secret: this.bkash.appSecret
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        username: this.bkash.username,
                        password: this.bkash.password
                    }
                }
            );
            
            this.bkash.token = response.data.id_token;
            this.bkash.tokenExpiry = Date.now() + (3600 * 1000); // 1 hour
            
            console.log('✅ bKash token obtained');
            return this.bkash.token;
        } catch (error) {
            console.error('❌ bKash token error:', error.message);
            throw new Error('Failed to authenticate with bKash');
        }
    }
    
    // Create bKash payment
    async createBkashPayment(amount, orderId) {
        try {
            const token = await this.getBkashToken();
            
            const response = await axios.post(
                `${this.bkash.baseUrl}/checkout/payment/create`,
                {
                    mode: '0011',
                    payerReference: orderId,
                    callbackURL: `${process.env.FRONTEND_URL}/payment-callback`,
                    amount: amount.toString(),
                    currency: 'BDT',
                    intent: 'sale',
                    merchantInvoiceNumber: orderId
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: token,
                        'X-APP-Key': this.bkash.appKey
                    }
                }
            );
            
            console.log('✅ bKash payment created:', response.data.paymentID);
            
            return {
                success: true,
                paymentId: response.data.paymentID,
                bkashURL: response.data.bkashURL
            };
        } catch (error) {
            console.error('❌ bKash payment creation error:', error.message);
            throw new Error('Failed to create bKash payment');
        }
    }
    
    // Execute bKash payment
    async executeBkashPayment(paymentId) {
        try {
            const token = await this.getBkashToken();
            
            const response = await axios.post(
                `${this.bkash.baseUrl}/checkout/payment/execute/${paymentId}`,
                {},
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: token,
                        'X-APP-Key': this.bkash.appKey
                    }
                }
            );
            
            const success = response.data.statusCode === '0000';
            
            console.log(`${success ? '✅' : '❌'} bKash payment execution:`, paymentId);
            
            return {
                success,
                transactionId: response.data.trxID,
                paymentId: response.data.paymentID,
                amount: response.data.amount
            };
        } catch (error) {
            console.error('❌ bKash payment execution error:', error.message);
            throw new Error('Failed to execute bKash payment');
        }
    }
    
    // Query bKash payment status
    async queryBkashPayment(paymentId) {
        try {
            const token = await this.getBkashToken();
            
            const response = await axios.get(
                `${this.bkash.baseUrl}/checkout/payment/query/${paymentId}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: token,
                        'X-APP-Key': this.bkash.appKey
                    }
                }
            );
            
            return {
                success: true,
                status: response.data.transactionStatus,
                transactionId: response.data.trxID,
                amount: response.data.amount
            };
        } catch (error) {
            console.error('❌ bKash query error:', error.message);
            throw new Error('Failed to query bKash payment');
        }
    }
    
    // ============= Nagad Methods =============
    
    // Generate Nagad signature
    generateNagadSignature(data) {
        try {
            const dataString = JSON.stringify(data);
            const sign = crypto.createSign('SHA256');
            sign.update(dataString);
            sign.end();
            
            return sign.sign(this.nagad.privateKey, 'base64');
        } catch (error) {
            console.error('❌ Nagad signature error:', error.message);
            throw new Error('Failed to generate Nagad signature');
        }
    }
    
    // Create Nagad payment
    async createNagadPayment(amount, orderId) {
        try {
            const timestamp = Date.now().toString();
            
            const paymentData = {
                merchantId: this.nagad.merchantId,
                orderId: orderId,
                amount: amount.toString(),
                datetime: timestamp,
                challenge: crypto.randomBytes(16).toString('hex')
            };
            
            const signature = this.generateNagadSignature(paymentData);
            
            const response = await axios.post(
                `${this.nagad.baseUrl}/check-out/initialize/${this.nagad.merchantId}/${orderId}`,
                {
                    ...paymentData,
                    signature
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-KM-Api-Version': 'v-0.2.0'
                    }
                }
            );
            
            console.log('✅ Nagad payment created');
            
            return {
                success: true,
                paymentReferenceId: response.data.paymentReferenceId,
                challengeToken: response.data.challenge
            };
        } catch (error) {
            console.error('❌ Nagad payment creation error:', error.message);
            throw new Error('Failed to create Nagad payment');
        }
    }
    
    // Verify Nagad payment
    async verifyNagadPayment(paymentReferenceId) {
        try {
            const response = await axios.get(
                `${this.nagad.baseUrl}/verify/payment/${paymentReferenceId}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-KM-Api-Version': 'v-0.2.0'
                    }
                }
            );
            
            const success = response.data.status === 'Success';
            
            console.log(`${success ? '✅' : '❌'} Nagad payment verification:`, paymentReferenceId);
            
            return {
                success,
                transactionId: response.data.issuerPaymentRefNo,
                amount: response.data.amount
            };
        } catch (error) {
            console.error('❌ Nagad verification error:', error.message);
            throw new Error('Failed to verify Nagad payment');
        }
    }
    
    // ============= Manual Verification (Current Implementation) =============
    
    // Verify payment screenshot manually
    async verifyManualPayment(orderId, transactionId, screenshotUrl, method) {
        try {
            await db.query(
                'UPDATE orders SET payment_status = $1, transaction_id = $2, payment_screenshot_url = $3, updated_at = CURRENT_TIMESTAMP WHERE order_number = $4',
                ['pending', transactionId, screenshotUrl, orderId]
            );
            
            console.log('✅ Manual payment submitted for verification:', orderId);
            
            return {
                success: true,
                status: 'pending',
                message: 'Payment submitted for verification. Admin will verify shortly.'
            };
        } catch (error) {
            console.error('❌ Manual payment verification error:', error.message);
            throw error;
        }
    }
    
    // Admin approve payment
    async approvePayment(orderId) {
        try {
            await db.query(
                'UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE order_number = $2',
                ['verified', orderId]
            );
            
            console.log('✅ Payment approved:', orderId);
            
            return {
                success: true,
                status: 'verified'
            };
        } catch (error) {
            console.error('❌ Payment approval error:', error.message);
            throw error;
        }
    }
    
    // Admin reject payment
    async rejectPayment(orderId, reason) {
        try {
            await db.query(
                'UPDATE orders SET payment_status = $1, payment_rejection_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE order_number = $3',
                ['failed', reason, orderId]
            );
            
            console.log('❌ Payment rejected:', orderId);
            
            return {
                success: true,
                status: 'failed'
            };
        } catch (error) {
            console.error('❌ Payment rejection error:', error.message);
            throw error;
        }
    }
    
    // ============= Refund Processing =============
    
    // Process refund
    async processRefund(orderId, amount, reason) {
        try {
            // Get order payment details
            const order = await db.getOne(
                'SELECT payment_method, transaction_id, payment_status FROM orders WHERE order_number = $1',
                [orderId]
            );
            
            if (!order) {
                throw new Error('Order not found');
            }
            
            if (order.payment_status === 'refunded') {
                throw new Error('Order already refunded');
            }
            
            // For now, just mark as refunded (actual refund processing would go here)
            await db.query(
                `UPDATE orders 
                 SET payment_status = $1, 
                     refund_amount = $2, 
                     refund_reason = $3, 
                     refund_date = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE order_number = $4`,
                ['refunded', amount, reason, orderId]
            );
            
            // TODO: Implement actual bKash/Nagad refund API calls when integrated
            
            console.log('✅ Refund processed:', orderId, 'Amount:', amount);
            
            return {
                success: true,
                refundAmount: amount,
                status: 'refunded',
                message: 'Refund will be processed within 7-10 business days'
            };
        } catch (error) {
            console.error('❌ Refund processing error:', error.message);
            throw error;
        }
    }
    
    // ============= Webhook Handlers =============
    
    // Handle bKash webhook
    async handleBkashWebhook(payload) {
        try {
            // Verify webhook signature (implement based on bKash documentation)
            // Process payment status update
            // Update order in database
            
            console.log('📥 bKash webhook received:', payload);
            
            const { paymentID, trxID, transactionStatus, merchantInvoiceNumber } = payload;
            
            if (transactionStatus === 'Completed') {
                await db.query(
                    'UPDATE orders SET payment_status = $1, transaction_id = $2 WHERE order_number = $3',
                    ['verified', trxID, merchantInvoiceNumber]
                );
            }
            
            return {
                success: true,
                message: 'Webhook processed'
            };
        } catch (error) {
            console.error('❌ bKash webhook error:', error.message);
            throw error;
        }
    }
    
    // Handle Nagad webhook
    async handleNagadWebhook(payload) {
        try {
            // Verify webhook signature
            // Process payment status update
            // Update order in database
            
            console.log('📥 Nagad webhook received:', payload);
            
            const { orderId, status, issuerPaymentRefNo } = payload;
            
            if (status === 'Success') {
                await db.query(
                    'UPDATE orders SET payment_status = $1, transaction_id = $2 WHERE order_number = $3',
                    ['verified', issuerPaymentRefNo, orderId]
                );
            }
            
            return {
                success: true,
                message: 'Webhook processed'
            };
        } catch (error) {
            console.error('❌ Nagad webhook error:', error.message);
            throw error;
        }
    }
    
    // ============= Utility Methods =============
    
    // Generate payment reference ID
    generatePaymentReference() {
        const timestamp = Date.now().toString();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `PAY${timestamp}${random}`;
    }
    
    // Validate payment amount
    validatePaymentAmount(amount) {
        const minAmount = 1;
        const maxAmount = 1000000;
        return amount >= minAmount && amount <= maxAmount;
    }
    
    // Check payment method availability
    isPaymentMethodAvailable(method) {
        const availableMethods = ['cash_on_delivery', 'bkash', 'nagad'];
        return availableMethods.includes(method.toLowerCase());
    }
    
    // Get payment method display name
    getPaymentMethodName(method) {
        const names = {
            cash_on_delivery: 'Cash on Delivery',
            bkash: 'bKash',
            nagad: 'Nagad'
        };
        return names[method.toLowerCase()] || method;
    }
    
    // Calculate payment gateway fees
    calculateGatewayFees(amount, method) {
        const fees = {
            cash_on_delivery: 50, // Flat COD fee
            bkash: amount * 0.015, // 1.5% transaction fee
            nagad: amount * 0.015 // 1.5% transaction fee
        };
        
        return Math.round(fees[method.toLowerCase()] || 0);
    }
    
    // Get payment statistics
    async getPaymentStatistics(filters = {}) {
        try {
            let whereClause = '1=1';
            const params = [];
            let paramCount = 1;
            
            if (filters.start_date) {
                whereClause += ` AND created_at >= $${paramCount}`;
                params.push(filters.start_date);
                paramCount++;
            }
            
            if (filters.end_date) {
                whereClause += ` AND created_at <= $${paramCount}`;
                params.push(filters.end_date);
                paramCount++;
            }
            
            const stats = await db.getOne(`
                SELECT 
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN payment_method = 'cash_on_delivery' THEN 1 ELSE 0 END) as cod_orders,
                    SUM(CASE WHEN payment_method = 'bkash' THEN 1 ELSE 0 END) as bkash_orders,
                    SUM(CASE WHEN payment_method = 'nagad' THEN 1 ELSE 0 END) as nagad_orders,
                    SUM(CASE WHEN payment_status = 'verified' THEN 1 ELSE 0 END) as verified_payments,
                    SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END) as pending_payments,
                    SUM(CASE WHEN payment_status = 'failed' THEN 1 ELSE 0 END) as failed_payments,
                    COALESCE(SUM(grand_total), 0) as total_amount,
                    COALESCE(SUM(CASE WHEN payment_status = 'verified' THEN grand_total ELSE 0 END), 0) as verified_amount
                FROM orders
                WHERE ${whereClause}
            `, params);
            
            return stats;
        } catch (error) {
            console.error('❌ Error getting payment statistics:', error.message);
            return null;
        }
    }
    
    // Verify payment screenshot exists and is valid
    validatePaymentScreenshot(screenshotUrl) {
        if (!screenshotUrl) return false;
        
        // Check if it's a valid URL
        try {
            new URL(screenshotUrl);
            return true;
        } catch {
            return false;
        }
    }
}

// Create singleton instance
const paymentService = new PaymentService();

module.exports = paymentService;