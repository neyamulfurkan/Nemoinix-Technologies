// js/utils.js
// Utility functions for formatting, validation, UI helpers, and common operations
// GLOBAL REFERENCE: All workflows, Design System, Validation Rules
// PURPOSE: Shared helper functions used across all pages

(function(global) {
  'use strict';

  // Get config
  const config = typeof window !== 'undefined' && window.CONFIG ? window.CONFIG : {};

  // ========================================
  // FORMATTING UTILITIES
  // ========================================

  // Format currency in Bangladeshi Taka
  function formatPrice(amount) {
    if (amount === null || amount === undefined) return '৳0.00';
    const num = parseFloat(amount);
    if (isNaN(num)) return '৳0.00';
    return `৳${num.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // Format date
  function formatDate(dateString, format = 'DD MMM YYYY') {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    
    if (format === 'DD MMM YYYY') {
      return `${day} ${month} ${year}`;
    } else if (format === 'DD MMM YYYY, h:mm A') {
      return `${day} ${month} ${year}, ${hours12}:${minutes} ${ampm}`;
    }
    
    return date.toLocaleDateString('en-BD');
  }
// Format time
  function formatTime(timeString) {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  }
  // Format relative time (e.g., "2 hours ago")
  function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return formatDate(dateString);
  }

  // Format phone number
  function formatPhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  }

  // Calculate discount percentage
  function calculateDiscount(original, current) {
    if (!original || !current || original <= current) return 0;
    return Math.round(((original - current) / original) * 100);
  }

  // Format file size
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  // Truncate text
  function truncate(text, maxLength, suffix = '...') {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + suffix;
  }

  // ========================================
  // VALIDATION UTILITIES
  // ========================================

  // Validate email
  function isValidEmail(email) {
    const EMAIL_REGEX = config.EMAIL_REGEX || /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return EMAIL_REGEX.test(email);
  }

  // Validate Bangladesh phone
  function isValidBDPhone(phone) {
    const BD_PHONE_REGEX = config.BD_PHONE_REGEX || /^01[3-9]\d{8}$/;
    return BD_PHONE_REGEX.test(phone);
  }

  // Validate password strength
  function isValidPassword(password) {
    const PASSWORD_REGEX = config.PASSWORD_REGEX || /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return PASSWORD_REGEX.test(password);
  }

  // Get password strength
  function getPasswordStrength(password) {
    if (!password) return { strength: 0, text: 'No password', color: 'gray' };
    
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    
    if (strength <= 2) return { strength, text: 'Weak', color: 'error' };
    if (strength <= 4) return { strength, text: 'Medium', color: 'warning' };
    return { strength, text: 'Strong', color: 'success' };
  }

  // Validate file type
  function isValidFileType(file, allowedTypes) {
    return allowedTypes.includes(file.type);
  }

  // Validate file size
  function isValidFileSize(file, maxSize) {
    return file.size <= maxSize;
  }

  // ========================================
  // STRING UTILITIES
  // ========================================

  // Generate slug from text
  function generateSlug(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // Capitalize first letter
  function capitalize(text) {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Capitalize all words
  function capitalizeWords(text) {
    if (!text) return '';
    return text.split(' ').map(word => capitalize(word)).join(' ');
  }

  // ========================================
  // REWARD SYSTEM UTILITIES
  // ========================================

  // Get tier details
  function getTierDetails(tier) {
    const REWARD_TIERS = config.REWARD_TIERS || {
      bronze: { min: 0, max: 500, name: 'Bronze', commission: 0.05 },
      silver: { min: 500, max: 1500, name: 'Silver', commission: 0.03 },
      gold: { min: 1500, max: 5000, name: 'Gold', commission: 0.02 },
      platinum: { min: 5000, max: Infinity, name: 'Platinum', commission: 0.01 }
    };
    return REWARD_TIERS[tier] || REWARD_TIERS.bronze;
  }

  // Get tier color
  function getTierColor(tier) {
    const colors = {
      bronze: '#CD7F32',
      silver: '#C0C0C0',
      gold: '#FFD700',
      platinum: '#E5E4E2'
    };
    return colors[tier] || colors.bronze;
  }

  // Get tier next threshold
  function getTierThreshold(tier) {
    const details = getTierDetails(tier);
    return details.max === Infinity ? null : details.max;
  }

  // Calculate tier progress percentage
  function getTierProgress(currentPoints, currentTier) {
    const tier = getTierDetails(currentTier);
    
    if (currentTier === 'platinum') return 100;
    if (tier.max === Infinity) return 100;
    
    const progress = ((currentPoints - tier.min) / (tier.max - tier.min)) * 100;
    return Math.min(Math.max(progress, 0), 100);
  }

  // Get tier from points
  function getTierFromPoints(points) {
    const REWARD_TIERS = config.REWARD_TIERS || {};
    
    if (points >= 5000) return 'platinum';
    if (points >= 1500) return 'gold';
    if (points >= 500) return 'silver';
    return 'bronze';
  }

  // Calculate commission
  function calculateCommission(amount, tier) {
    const details = getTierDetails(tier);
    return amount * details.commission;
  }

  // ========================================
  // STATUS UTILITIES
  // ========================================

  // Get order status badge class
  function getOrderStatusClass(status) {
    const classes = {
      pending: 'badge-warning',
      confirmed: 'badge-info',
      processing: 'badge-info',
      shipped: 'badge-primary',
      delivered: 'badge-success',
      cancelled: 'badge-error'
    };
    return classes[status] || 'badge-secondary';
  }

  // Get payment status badge class
  function getPaymentStatusClass(status) {
    const classes = {
      pending: 'badge-warning',
      verified: 'badge-success',
      failed: 'badge-error'
    };
    return classes[status] || 'badge-secondary';
  }

  // Get order status text
  function getOrderStatusText(status) {
    const ORDER_STATUSES = config.ORDER_STATUSES || {};
    return ORDER_STATUSES[status] || capitalize(status);
  }

  // ========================================
  // SHIPPING UTILITIES
  // ========================================

  // Calculate shipping cost
  function calculateShipping(district, orderTotal) {
    const SHIPPING_COSTS = config.SHIPPING_COSTS || { dhaka: 60, outside_dhaka: 80, free_threshold: 1000 };
    const DHAKA_DISTRICTS = config.DHAKA_DISTRICTS || ['Dhaka'];
    
    // Free shipping threshold
    if (orderTotal >= SHIPPING_COSTS.free_threshold) return 0;
    
    // Check if district is in Dhaka
    const isDhaka = DHAKA_DISTRICTS.some(d => d.toLowerCase() === district.toLowerCase());
    return isDhaka ? SHIPPING_COSTS.dhaka : SHIPPING_COSTS.outside_dhaka;
  }

  // ========================================
  // UI UTILITIES
  // ========================================

  // Show toast notification
  function showToast(message, type = 'info', duration = 3000) {
    console.log('🔔 Showing toast:', message, type);
    
    let container = document.getElementById('toast-container');
    
    // Create container if it doesn't exist
    if (!container) {
      console.log('Creating toast container...');
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position: fixed; bottom: 2rem; right: 2rem; z-index: 99999; display: flex; flex-direction: column; gap: 1rem; pointer-events: none;';
      document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    
    container.appendChild(toast);
    console.log('Toast added to DOM');
    
    // Auto remove after duration
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        toast.remove();
        console.log('Toast removed');
      }, 300);
    }, duration);
  }

  // Show loading spinner
  function showLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('active');
    }
  }

  // Hide loading spinner
  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
  }

  // Confirm dialog
  function confirmDialog(message, onConfirm, onCancel) {
    if (confirm(message)) {
      if (onConfirm) onConfirm();
    } else {
      if (onCancel) onCancel();
    }
  }

  // Handle API errors
  function handleAPIError(error) {
    console.error('API Error:', error);
    hideLoading();
    
    const message = error?.message || error?.error || 'Something went wrong';
    
    if (message === 'Session expired. Please login again.' || message.includes('Unauthorized')) {
      showToast('Session expired. Please login again.', 'error');
      setTimeout(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
      }, 1500);
    } else {
      showToast(message, 'error');
    }
  }

  // Debounce function
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Throttle function
  function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // Copy to clipboard
  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
      }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('Failed to copy', 'error');
      });
    } else {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        showToast('Copied to clipboard!', 'success');
      } catch (err) {
        showToast('Failed to copy', 'error');
      }
      document.body.removeChild(textArea);
    }
  }

  // Scroll to element
  function scrollToElement(elementId, offset = 80) {
    const element = document.getElementById(elementId);
    if (element) {
      const y = element.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  // Get query parameters
  function getQueryParams() {
    const params = {};
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    
    for (const [key, value] of urlParams) {
      params[key] = value;
    }
    
    return params;
  }

  // Update query parameter
  function updateQueryParam(key, value) {
    const url = new URL(window.location);
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
    window.history.pushState({}, '', url);
  }

  // ========================================
  // LOCAL STORAGE UTILITIES
  // ========================================

  // Get from local storage
  function getFromStorage(key) {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;
      
      // Special handling for 'token' key - it's stored as plain string, not JSON
      if (key === 'token') {
        return item;
      }
      
      // Try to parse as JSON for other keys
      try {
        return JSON.parse(item);
      } catch (e) {
        // If JSON parse fails, return the raw value
        return item;
      }
    } catch (error) {
      console.error('Error reading from storage:', error);
      return null;
    }
  }

  // Save to local storage
  function saveToStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Error saving to storage:', error);
      return false;
    }
  }

  // Remove from local storage
  function removeFromStorage(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error('Error removing from storage:', error);
      return false;
    }
  }

  // ========================================
  // RATING UTILITIES
  // ========================================

  // Render star rating HTML
  function renderStars(rating, maxStars = 5) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = maxStars - fullStars - (hasHalfStar ? 1 : 0);
    
    let html = '';
    
    // Full stars
    for (let i = 0; i < fullStars; i++) {
      html += '<i class="fas fa-star"></i>';
    }
    
    // Half star
    if (hasHalfStar) {
      html += '<i class="fas fa-star-half-alt"></i>';
    }
    
    // Empty stars
    for (let i = 0; i < emptyStars; i++) {
      html += '<i class="far fa-star"></i>';
    }
    
    return html;
  }

  // ========================================
  // IMAGE UTILITIES
  // ========================================

  // Get placeholder image
  function getPlaceholderImage(type = 'product') {
    const placeholders = {
      product: '/assets/default-product.png',
      avatar: '/assets/default-avatar.png',
      club: '/assets/default-club-logo.png',
      banner: '/assets/default-banner.png'
    };
    return placeholders[type] || placeholders.product;
  }

  // Handle image error
  function handleImageError(img, type = 'product') {
    img.onerror = null; // Prevent infinite loop
    img.src = getPlaceholderImage(type);
  }
// Get auth token
  function getToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token');
  }
  // Utilities object
  // Update cart badge
  async function updateCartBadge() {
    const badge = document.getElementById('cartBadge') || document.getElementById('cart-badge');
    if (!badge) {
      return;
    }
    
    try {
      const token = getToken();
      if (!token) {
        badge.textContent = '0';
        badge.style.display = 'none';
        return;
      }
      
      const API_URL = config.API_BASE_URL || 'http://localhost:3000/api';
      const response = await fetch(`${API_URL}/students/cart`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        badge.textContent = '0';
        badge.style.display = 'none';
        return;
      }
      
      const data = await response.json();
      
      let totalQuantity = 0;
      
      // Try multiple response structures
      if (data.success && data.cart && data.cart.items && Array.isArray(data.cart.items)) {
        totalQuantity = data.cart.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
      } else if (data.success && data.data && data.data.items && Array.isArray(data.data.items)) {
        totalQuantity = data.data.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
      }
      
      badge.textContent = totalQuantity;
      badge.style.display = totalQuantity > 0 ? 'flex' : 'none';
    } catch (error) {
      console.error('Error updating cart badge:', error);
      badge.textContent = '0';
      badge.style.display = 'none';
    }
  }

  // Utilities object
  const Utils = {
    // Formatting
    formatPrice,
    formatDate,
    formatTime,
    formatRelativeTime,
    formatPhone,
    calculateDiscount,
    formatFileSize,
    truncate,
    
    // Validation
    isValidEmail,
    isValidBDPhone,
    isValidPassword,
    getPasswordStrength,
    isValidFileType,
    isValidFileSize,
    
    // String
    generateSlug,
    capitalize,
    capitalizeWords,
    
    // Reward System
    getTierDetails,
    getTierColor,
    getTierThreshold,
    getTierProgress,
    getTierFromPoints,
    calculateCommission,
    
    // Status
    getOrderStatusClass,
    getPaymentStatusClass,
    getOrderStatusText,
    
    // Shipping
    calculateShipping,
    
    // UI
    showToast,
    showLoading,
    hideLoading,
    confirmDialog,
    handleAPIError,
    debounce,
    throttle,
    copyToClipboard,
    scrollToElement,
    getQueryParams,
    updateQueryParam,
    
    // Storage
    getFromStorage,
    saveToStorage,
    removeFromStorage,
    
    // Rating
    renderStars,
    
    // Image
    getPlaceholderImage,
    handleImageError,
    
    // Cart
    updateCartBadge
  };

  // Export for different module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() { return Utils; });
  } else {
    global.Utils = Utils;
  }

})(typeof window !== 'undefined' ? window : this);