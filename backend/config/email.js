// backend/config/email.js
// Resend configuration for sending transactional emails
// GLOBAL REFERENCE: Environment Variables (RESEND_API_KEY, EMAIL_FROM)
// PURPOSE: Configure Resend email service and provide email sending functions with templates

const { Resend } = require('resend');
const fs = require('fs').promises;
const path = require('path');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Verify API key is present
if (!process.env.RESEND_API_KEY) {
    console.error('⚠️ RESEND_API_KEY is not set in environment variables');
    console.error('Emails will not be sent. Please add RESEND_API_KEY to your .env file');
} else {
    console.log('✅ Resend email service initialized');
}

// Load email template
async function loadTemplate(templateName) {
    try {
        const templatePath = path.join(__dirname, '../templates', `${templateName}.html`);
        const template = await fs.readFile(templatePath, 'utf8');
        return template;
    } catch (error) {
        console.error(`Failed to load template ${templateName}:`, error.message);
        // Return basic fallback template
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>{{SUBJECT}}</title>
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2>{{PLATFORM_NAME}}</h2>
                    <div>{{CONTENT}}</div>
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; color: #666;">
                        © {{CURRENT_YEAR}} {{PLATFORM_NAME}}. All rights reserved.
                    </p>
                </div>
            </body>
            </html>
        `;
    }
}

// Replace placeholders in template
function replacePlaceholders(template, data) {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value || '');
    }
    return result;
}

// Send email with template
async function sendEmail({ to, subject, template, data = {}, html = null }) {
    try {
        // Check if Resend is configured
        if (!process.env.RESEND_API_KEY) {
            console.warn(`⚠️ Email not sent (Resend not configured): ${subject} to ${to}`);
            return { success: false, error: 'Resend not configured' };
        }

        // Use provided HTML or load template
        let emailHtml;
        
        if (html) {
            emailHtml = html;
        } else if (template) {
            const htmlTemplate = await loadTemplate(template);
            emailHtml = replacePlaceholders(htmlTemplate, {
                ...data,
                PLATFORM_NAME: process.env.PLATFORM_NAME || 'Bangladesh Robotics Marketplace',
                SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@roboticsbd.com',
                FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
                CURRENT_YEAR: new Date().getFullYear(),
                SUBJECT: subject
            });
        } else {
            throw new Error('Either template or html must be provided');
        }

        // Send email via Resend
        console.log('📧 Attempting to send email...');
        console.log('   From:', process.env.EMAIL_FROM || 'onboarding@resend.dev');
        console.log('   To:', to);
        console.log('   Subject:', subject);
        console.log('   API Key present:', !!process.env.RESEND_API_KEY);
        console.log('   API Key starts with:', process.env.RESEND_API_KEY?.substring(0, 5));
        
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
            to: to,
            subject: subject,
            html: emailHtml
        });

        console.log('📬 Resend API Response:', JSON.stringify(result, null, 2));

        // Check if email actually sent
        if (!result || !result.id) {
            console.error('❌ Resend returned no message ID - email NOT sent!');
            console.error('   This usually means invalid FROM address or unverified domain');
            console.error('   Current EMAIL_FROM:', process.env.EMAIL_FROM);
            console.error('   Full result object:', result);
            return { success: false, error: 'Email send failed - no message ID returned' };
        }

        console.log('✅ Email sent via Resend:', result.id, 'to:', to);
        return { success: true, messageId: result.id };
    } catch (error) {
        console.error('❌ Resend email error:', error.message);
        console.error('   Full error:', JSON.stringify(error, null, 2));
        console.error('   Error name:', error.name);
        console.error('   Error stack:', error.stack);
        throw error;
    }
}

// Predefined email functions

// Send order confirmation email
async function sendOrderConfirmation(order, user) {
    return sendEmail({
        to: user.email,
        subject: `Order Confirmation - #${order.order_number}`,
        template: 'order-confirmation',
        data: {
            USER_NAME: user.full_name,
            ORDER_NUMBER: order.order_number,
            ORDER_DATE: new Date(order.created_at).toLocaleDateString('en-BD'),
            ORDER_TOTAL: `৳${order.grand_total.toLocaleString('en-BD')}`,
            ORDER_ITEMS: order.items ? order.items.map(item => 
                `${item.product_name} x ${item.quantity} = ৳${(item.price * item.quantity).toLocaleString('en-BD')}`
            ).join('<br>') : '',
            DELIVERY_ADDRESS: `${order.delivery_address}, ${order.delivery_city}, ${order.delivery_district}`,
            TRACKING_URL: `${process.env.FRONTEND_URL}/order-detail.html?order=${order.order_number}`
        }
    });
}

// Send order shipped notification
async function sendOrderShipped(order, user) {
    return sendEmail({
        to: user.email,
        subject: `Order Shipped - #${order.order_number}`,
        template: 'order-shipped',
        data: {
            USER_NAME: user.full_name,
            ORDER_NUMBER: order.order_number,
            TRACKING_NUMBER: order.tracking_number || 'Will be updated soon',
            COURIER_NAME: order.courier_name || 'Standard Delivery',
            ESTIMATED_DELIVERY: order.estimated_delivery ? new Date(order.estimated_delivery).toLocaleDateString('en-BD') : 'Within 3-5 business days',
            TRACKING_URL: `${process.env.FRONTEND_URL}/order-detail.html?order=${order.order_number}`
        }
    });
}

// Send order delivered notification
async function sendOrderDelivered(order, user) {
    return sendEmail({
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

// Send competition registration confirmation
async function sendCompetitionRegistrationConfirmation(registration, competition, user) {
    return sendEmail({
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
            TEAM_MEMBERS: registration.team_members || 'N/A',
            REGISTRATION_FEE: `৳${registration.registration_fee.toLocaleString('en-BD')}`,
            PAYMENT_STATUS: registration.payment_status,
            COMPETITION_URL: `${process.env.FRONTEND_URL}/competition-detail.html?id=${competition.id}`
        }
    });
}

// Send competition reminder (1 day before)
async function sendCompetitionReminder(registration, competition, user) {
    return sendEmail({
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

// Send club application received notification
async function sendClubApplicationReceived(club, user) {
    return sendEmail({
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

// Send club approved notification
async function sendClubApproved(club, user) {
    return sendEmail({
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

// Send club rejected notification
async function sendClubRejected(club, user, reason) {
    return sendEmail({
        to: user.email,
        subject: 'Club Application Update',
        template: 'club-rejected',
        data: {
            USER_NAME: user.full_name,
            CLUB_NAME: club.club_name,
            REJECTION_REASON: reason || 'Please contact support for more details.',
            SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@roboticsbd.com',
            REAPPLY_URL: `${process.env.FRONTEND_URL}/club-registration.html`
        }
    });
}

// Send payout notification
async function sendPayoutNotification(club, payout) {
    return sendEmail({
        to: club.contact_email,
        subject: 'Payout Processed Successfully',
        template: 'payout-notification',
        data: {
            CLUB_NAME: club.club_name,
            PAYOUT_AMOUNT: `৳${payout.amount.toLocaleString('en-BD')}`,
            PAYOUT_PERIOD: `${new Date(payout.period_start).toLocaleDateString('en-BD')} - ${new Date(payout.period_end).toLocaleDateString('en-BD')}`,
            PAYMENT_METHOD: payout.payment_method,
            PAYMENT_REFERENCE: payout.payment_reference || 'Will be updated within 24 hours',
            DASHBOARD_URL: `${process.env.FRONTEND_URL}/my-earnings.html`
        }
    });
}

// Send welcome email for new users
async function sendWelcomeEmail(user) {
    return sendEmail({
        to: user.email,
        subject: 'Welcome to Bangladesh Robotics Marketplace!',
        template: 'welcome',
        data: {
            USER_NAME: user.full_name,
            USER_ROLE: user.role,
            DASHBOARD_URL: `${process.env.FRONTEND_URL}/${user.role}-dashboard.html`,
            EXPLORE_URL: `${process.env.FRONTEND_URL}/products.html`
        }
    });
}

// Send password reset email
async function sendPasswordReset(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
    
    return sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        template: 'password-reset',
        data: {
            USER_NAME: user.full_name,
            RESET_URL: resetUrl,
            RESET_TOKEN: resetToken,
            EXPIRES_IN: '1 hour'
        }
    });
}

// Send email verification
async function sendEmailVerification(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email.html?token=${verificationToken}`;
    
    return sendEmail({
        to: user.email,
        subject: 'Verify Your Email Address',
        template: 'email-verification',
        data: {
            USER_NAME: user.full_name,
            VERIFICATION_URL: verificationUrl,
            VERIFICATION_TOKEN: verificationToken
        }
    });
}

// Send low stock alert to club admin
async function sendLowStockAlert(product, club) {
    return sendEmail({
        to: club.contact_email,
        subject: `Low Stock Alert: ${product.name}`,
        template: 'low-stock-alert',
        data: {
            CLUB_NAME: club.club_name,
            PRODUCT_NAME: product.name,
            CURRENT_STOCK: product.stock,
            PRODUCT_URL: `${process.env.FRONTEND_URL}/club-dashboard.html#products`
        }
    });
}

module.exports = {
    sendEmail,
    sendOrderConfirmation,
    sendOrderShipped,
    sendOrderDelivered,
    sendCompetitionRegistrationConfirmation,
    sendCompetitionReminder,
    sendClubApplicationReceived,
    sendClubApproved,
    sendClubRejected,
    sendPayoutNotification,
    sendWelcomeEmail,
    sendPasswordReset,
    sendEmailVerification,
    sendLowStockAlert
};