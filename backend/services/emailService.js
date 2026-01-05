// backend/services/emailService.js
// Centralized email service for all transactional emails with template rendering.
// GLOBAL REFERENCE: Email Configuration, Email Templates, User/Order/Competition Structures
// PURPOSE: Handle all email operations with queue management and retry logic.

const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: process.env.EMAIL_PORT || 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });
        
        this.templateCache = new Map();
        this.emailQueue = [];
        this.isProcessing = false;
        
        // Verify connection on initialization (DISABLED FOR TESTING)
        // TODO: Enable in production
        // this.verifyConnection();
        console.log('⚠️  EmailService initialized (verification disabled for testing)');
    }
    
    // Load and compile template
    async loadTemplate(templateName) {
        // Check cache first
        if (this.templateCache.has(templateName)) {
            return this.templateCache.get(templateName);
        }
        
        try {
            const templatePath = path.join(__dirname, '../templates', `${templateName}.html`);
            const templateContent = await fs.readFile(templatePath, 'utf8');
            
            // Cache template content
            this.templateCache.set(templateName, templateContent);
            
            return templateContent;
        } catch (error) {
            console.error(`Failed to load template ${templateName}:`, error);
            // Return basic fallback template
            return this.getBasicTemplate();
        }
    }
    
    // Get basic fallback template
    getBasicTemplate() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>{{SUBJECT}}</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #1991EB; color: white; padding: 20px; text-align: center; }
                    .content { padding: 30px 20px; background: #f9f9f9; }
                    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>{{PLATFORM_NAME}}</h1>
                    </div>
                    <div class="content">
                        {{CONTENT}}
                    </div>
                    <div class="footer">
                        <p>© {{CURRENT_YEAR}} {{PLATFORM_NAME}}. All rights reserved.</p>
                        <p>Support: {{SUPPORT_EMAIL}}</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }
    
    // Replace placeholders in template
    replacePlaceholders(template, data) {
        let result = template;
        for (const [key, value] of Object.entries(data)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            result = result.replace(regex, value || '');
        }
        return result;
    }
    
    // Render template with data
    async renderTemplate(templateName, data) {
        const template = await this.loadTemplate(templateName);
        
        // Add global variables
        const globalData = {
            PLATFORM_NAME: process.env.PLATFORM_NAME || 'Bangladesh Robotics Marketplace',
            SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@roboticsbd.com',
            FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
            CURRENT_YEAR: new Date().getFullYear(),
            ...data
        };
        
        return this.replacePlaceholders(template, globalData);
    }
    
    // Send email
    async sendEmail({ to, subject, template, data = {}, html = null, attachments = [] }) {
        try {
            // Render HTML content
            const emailHtml = html || await this.renderTemplate(template, data);
            
            // Send email
            const info = await this.transporter.sendMail({
                from: process.env.EMAIL_FROM || '"Bangladesh Robotics Marketplace" <noreply@roboticsbd.com>',
                to,
                subject,
                html: emailHtml,
                attachments
            });
            
            console.log('✅ Email sent:', info.messageId, 'to:', to);
            
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('❌ Email sending error:', error.message);
            throw error;
        }
    }
    
    // Queue email for batch sending
    queueEmail(emailData) {
        this.emailQueue.push({
            ...emailData,
            attempts: 0,
            maxAttempts: 3,
            addedAt: new Date()
        });
        
        // Process queue if not already processing
        if (!this.isProcessing) {
            this.processQueue();
        }
    }
    
    // Process email queue
    async processQueue() {
        if (this.emailQueue.length === 0) {
            this.isProcessing = false;
            return;
        }
        
        this.isProcessing = true;
        
        const emailData = this.emailQueue.shift();
        
        try {
            await this.sendEmail(emailData);
        } catch (error) {
            emailData.attempts++;
            
            if (emailData.attempts < emailData.maxAttempts) {
                console.log(`⚠️  Retrying email (attempt ${emailData.attempts + 1}/${emailData.maxAttempts})`);
                this.emailQueue.push(emailData);
            } else {
                console.error('❌ Failed to send email after max attempts:', emailData.to);
            }
        }
        
        // Process next email after delay
        setTimeout(() => this.processQueue(), 1000);
    }
    
    // Predefined email methods
    async sendOrderConfirmation(order, user) {
        const itemsHtml = order.items.map(item => 
            `<tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px;">${item.product_name}</td>
                <td style="padding: 10px; text-align: center;">×${item.quantity}</td>
                <td style="padding: 10px; text-align: right;">৳${(item.price * item.quantity).toLocaleString('en-BD')}</td>
            </tr>`
        ).join('');
        
        return this.sendEmail({
            to: user.email,
            subject: `Order Confirmation - #${order.order_number}`,
            template: 'order-confirmation',
            data: {
                USER_NAME: user.full_name,
                ORDER_NUMBER: order.order_number,
                ORDER_DATE: new Date(order.created_at).toLocaleDateString('en-BD'),
                ORDER_TOTAL: `৳${order.grand_total.toLocaleString('en-BD')}`,
                SUBTOTAL: `৳${order.total_amount.toLocaleString('en-BD')}`,
                SHIPPING: `৳${order.shipping_cost.toLocaleString('en-BD')}`,
                ORDER_ITEMS: itemsHtml,
                DELIVERY_ADDRESS: `${order.delivery_address}, ${order.delivery_city}, ${order.delivery_district}`,
                TRACKING_URL: `${process.env.FRONTEND_URL}/order-detail.html?order=${order.order_number}`
            }
        });
    }
    
    async sendOrderShipped(order, user) {
        return this.sendEmail({
            to: user.email,
            subject: `Order Shipped - #${order.order_number}`,
            template: 'order-shipped',
            data: {
                USER_NAME: user.full_name,
                ORDER_NUMBER: order.order_number,
                TRACKING_NUMBER: order.tracking_number || 'Will be updated soon',
                COURIER_NAME: order.courier_name || 'Local Courier',
                TRACKING_URL: `${process.env.FRONTEND_URL}/order-detail.html?order=${order.order_number}`,
                DELIVERY_ADDRESS: `${order.delivery_address}, ${order.delivery_city}`
            }
        });
    }
    
    async sendOrderDelivered(order, user) {
        return this.sendEmail({
            to: user.email,
            subject: `Order Delivered - #${order.order_number}`,
            template: 'order-delivered',
            data: {
                USER_NAME: user.full_name,
                ORDER_NUMBER: order.order_number,
                REVIEW_URL: `${process.env.FRONTEND_URL}/order-detail.html?order=${order.order_number}#review`
            }
        });
    }
    
    async sendCompetitionRegistrationConfirmation(registration, competition, user) {
        return this.sendEmail({
            to: user.email,
            subject: `Registration Confirmed - ${competition.title}`,
            template: 'registration-confirmation',
            data: {
                USER_NAME: user.full_name,
                COMPETITION_TITLE: competition.title,
                COMPETITION_DATE: new Date(competition.competition_date).toLocaleDateString('en-BD'),
                COMPETITION_TIME: competition.competition_time || 'TBA',
                COMPETITION_VENUE: competition.venue,
                TEAM_NAME: registration.team_name,
                TEAM_MEMBERS: registration.team_members,
                REGISTRATION_FEE: `৳${registration.registration_fee.toLocaleString('en-BD')}`,
                PAYMENT_STATUS: registration.payment_status,
                COMPETITION_URL: `${process.env.FRONTEND_URL}/competition-detail.html?id=${competition.id}`
            }
        });
    }
    
    async sendCompetitionReminder(registration, competition, user) {
        return this.sendEmail({
            to: user.email,
            subject: `Reminder: ${competition.title} Tomorrow!`,
            template: 'competition-reminder',
            data: {
                USER_NAME: user.full_name,
                COMPETITION_TITLE: competition.title,
                COMPETITION_DATE: new Date(competition.competition_date).toLocaleDateString('en-BD'),
                COMPETITION_TIME: competition.competition_time || 'TBA',
                COMPETITION_VENUE: competition.venue,
                TEAM_NAME: registration.team_name,
                COMPETITION_URL: `${process.env.FRONTEND_URL}/competition-detail.html?id=${competition.id}`
            }
        });
    }
    
    async sendClubApplicationReceived(club, user) {
        return this.sendEmail({
            to: user.email,
            subject: 'Club Application Received',
            template: 'club-application-received',
            data: {
                USER_NAME: user.full_name,
                CLUB_NAME: club.club_name,
                UNIVERSITY: club.university,
                SUBMITTED_DATE: new Date(club.created_at).toLocaleDateString('en-BD')
            }
        });
    }
    
    async sendClubApproved(club, user) {
        return this.sendEmail({
            to: user.email,
            subject: '🎉 Club Application Approved!',
            template: 'club-approved',
            data: {
                USER_NAME: user.full_name,
                CLUB_NAME: club.club_name,
                UNIVERSITY: club.university,
                DASHBOARD_URL: `${process.env.FRONTEND_URL}/club-dashboard.html`,
                PROFILE_URL: `${process.env.FRONTEND_URL}/club-profile.html?slug=${club.slug}`
            }
        });
    }
    
    async sendClubRejected(club, user, reason) {
        return this.sendEmail({
            to: user.email,
            subject: 'Club Application Update',
            template: 'club-rejected',
            data: {
                USER_NAME: user.full_name,
                CLUB_NAME: club.club_name,
                REJECTION_REASON: reason || 'Unfortunately, we are unable to approve your application at this time.',
                SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@roboticsbd.com',
                REAPPLY_URL: `${process.env.FRONTEND_URL}/clubs/apply`
            }
        });
    }
    
    async sendPayoutNotification(club, payout) {
        return this.sendEmail({
            to: club.contact_email,
            subject: 'Payout Processed Successfully',
            template: 'payout-notification',
            data: {
                CLUB_NAME: club.club_name,
                PAYOUT_AMOUNT: `৳${payout.amount.toLocaleString('en-BD')}`,
                PAYOUT_PERIOD: `${new Date(payout.period_start).toLocaleDateString('en-BD')} - ${new Date(payout.period_end).toLocaleDateString('en-BD')}`,
                PAYMENT_METHOD: payout.payment_method || 'Bank Transfer',
                PAYMENT_REFERENCE: payout.payment_reference || 'Will be updated within 24 hours',
                DASHBOARD_URL: `${process.env.FRONTEND_URL}/my-earnings.html`
            }
        });
    }
    
    async sendEmailVerification(user, verificationToken) {
        const verificationUrl = `${process.env.FRONTEND_URL}/verify-email.html?token=${verificationToken}`;
        
        return this.sendEmail({
            to: user.email,
            subject: 'Verify Your Email Address',
            template: 'email-verification',
            data: {
                USER_NAME: user.full_name,
                VERIFICATION_URL: verificationUrl,
                EXPIRY_HOURS: 24
            }
        });
    }
    
    async sendPasswordReset(user, resetToken) {
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
        
        return this.sendEmail({
            to: user.email,
            subject: 'Password Reset Request',
            template: 'password-reset',
            data: {
                USER_NAME: user.full_name,
                RESET_URL: resetUrl,
                EXPIRY_HOURS: 1
            }
        });
    }
    
    async sendWelcomeEmail(user) {
        return this.sendEmail({
            to: user.email,
            subject: 'Welcome to Bangladesh Robotics Marketplace! 🎉',
            template: 'welcome',
            data: {
                USER_NAME: user.full_name,
                USER_ROLE: user.role,
                BROWSE_PRODUCTS_URL: `${process.env.FRONTEND_URL}/products.html`,
                BROWSE_COMPETITIONS_URL: `${process.env.FRONTEND_URL}/competitions.html`,
                PROFILE_URL: `${process.env.FRONTEND_URL}/my-profile.html`
            }
        });
    }
    
    async sendLowStockAlert(product, club) {
        return this.sendEmail({
            to: club.contact_email,
            subject: `Low Stock Alert: ${product.name}`,
            template: 'low-stock-alert',
            data: {
                CLUB_NAME: club.club_name,
                PRODUCT_NAME: product.name,
                CURRENT_STOCK: product.stock,
                PRODUCT_URL: `${process.env.FRONTEND_URL}/manage-products.html`
            }
        });
    }
    
    // Batch send to multiple recipients
    async sendBulkEmail({ recipients, subject, template, data = {} }) {
        for (const email of recipients) {
            this.queueEmail({ to: email, subject, template, data });
        }
        
        return { success: true, queued: recipients.length };
    }
    
    // Test email connection
    async verifyConnection() {
        try {
            await this.transporter.verify();
            console.log('✅ Email server connection verified');
            return true;
        } catch (error) {
            console.error('❌ Email server connection failed:', error.message);
            return false;
        }
    }
    
    // Clear template cache
    clearTemplateCache() {
        this.templateCache.clear();
        console.log('✅ Email template cache cleared');
    }
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;