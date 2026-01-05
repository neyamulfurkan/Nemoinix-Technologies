// js/cart.js
// Shopping cart management with localStorage persistence and calculations
// GLOBAL REFERENCE: User Workflows → Student → Shopping, Cart Structure, API Endpoints
// PURPOSE: Handle all cart operations for the frontend

(function(global) {
  'use strict';

  // Get dependencies
  const config = typeof window !== 'undefined' && window.CONFIG ? window.CONFIG : {};
  const utils = typeof window !== 'undefined' && window.Utils ? window.Utils : {};
  
  const STORAGE_KEYS = config.STORAGE_KEYS || { CART: 'cart' };
  const SHIPPING_COSTS = config.SHIPPING_COSTS || { dhaka: 60, outside_dhaka: 80, free_threshold: 1000 };

  // ========================================
  // CART STATE MANAGEMENT
  // ========================================

  // Get cart from localStorage
  function getCart() {
    try {
      const cartStr = localStorage.getItem(STORAGE_KEYS.CART);
      if (!cartStr) {
        return {
          items: [],
          totalItems: 0,
          subtotal: 0,
          shipping: 0,
          total: 0
        };
      }
      return JSON.parse(cartStr);
    } catch (error) {
      console.error('Error reading cart:', error);
      return {
        items: [],
        totalItems: 0,
        subtotal: 0,
        shipping: 0,
        total: 0
      };
    }
  }

  // Save cart to localStorage
  function saveCart(cart) {
    try {
      localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cart));
      updateCartBadge();
      triggerCartUpdate();
      return true;
    } catch (error) {
      console.error('Error saving cart:', error);
      return false;
    }
  }

  // Calculate cart totals
  function calculateTotals(items, district = null) {
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    
    let shipping = 0;
    if (district && utils.calculateShipping) {
      shipping = utils.calculateShipping(district, subtotal);
    } else if (subtotal > 0 && subtotal < SHIPPING_COSTS.free_threshold) {
      shipping = SHIPPING_COSTS.outside_dhaka; // Default to higher shipping
    }
    
    const total = subtotal + shipping;
    
    return {
      subtotal,
      totalItems,
      shipping,
      total
    };
  }

  // ========================================
  // CART OPERATIONS
  // ========================================

  // Add item to cart
  function addItem(product, quantity = 1) {
    const cart = getCart();
    
    // Check if item already exists
    const existingIndex = cart.items.findIndex(item => item.product_id === product.id);
    
    if (existingIndex >= 0) {
      // Update quantity
      const newQuantity = cart.items[existingIndex].quantity + quantity;
      
      // Check stock
      if (newQuantity > product.stock) {
        if (utils.showToast) {
          utils.showToast(`Only ${product.stock} items available in stock`, 'warning');
        }
        return false;
      }
      
      cart.items[existingIndex].quantity = newQuantity;
    } else {
      // Add new item
      if (quantity > product.stock) {
        if (utils.showToast) {
          utils.showToast(`Only ${product.stock} items available in stock`, 'warning');
        }
        return false;
      }
      
      cart.items.push({
        product_id: product.id,
        name: product.name,
        slug: product.slug,
        price: product.price,
        quantity: quantity,
        image_url: product.images && product.images.length > 0 ? product.images[0].image_url : null,
        club_id: product.club_id,
        club_name: product.club_name,
        stock: product.stock
      });
    }
    
    // Recalculate totals
    const totals = calculateTotals(cart.items);
    Object.assign(cart, totals);
    
    saveCart(cart);
    
    if (utils.showToast) {
      utils.showToast('Item added to cart', 'success');
    }
    
    return true;
  }

  // Update item quantity
  function updateQuantity(productId, quantity) {
    const cart = getCart();
    const itemIndex = cart.items.findIndex(item => item.product_id === productId);
    
    if (itemIndex < 0) {
      return false;
    }
    
    if (quantity <= 0) {
      return removeItem(productId);
    }
    
    // Check stock
    if (quantity > cart.items[itemIndex].stock) {
      if (utils.showToast) {
        utils.showToast(`Only ${cart.items[itemIndex].stock} items available`, 'warning');
      }
      return false;
    }
    
    cart.items[itemIndex].quantity = quantity;
    
    // Recalculate totals
    const totals = calculateTotals(cart.items);
    Object.assign(cart, totals);
    
    saveCart(cart);
    return true;
  }

  // Remove item from cart
  function removeItem(productId) {
    const cart = getCart();
    cart.items = cart.items.filter(item => item.product_id !== productId);
    
    // Recalculate totals
    const totals = calculateTotals(cart.items);
    Object.assign(cart, totals);
    
    saveCart(cart);
    
    if (utils.showToast) {
      utils.showToast('Item removed from cart', 'info');
    }
    
    return true;
  }

  // Clear entire cart
  function clearCart() {
    const emptyCart = {
      items: [],
      totalItems: 0,
      subtotal: 0,
      shipping: 0,
      total: 0
    };
    
    saveCart(emptyCart);
    return true;
  }

  // Get item count
  function getItemCount() {
    const cart = getCart();
    return cart.totalItems;
  }

  // Check if product is in cart
  function isInCart(productId) {
    const cart = getCart();
    return cart.items.some(item => item.product_id === productId);
  }

  // Get item quantity
  function getItemQuantity(productId) {
    const cart = getCart();
    const item = cart.items.find(item => item.product_id === productId);
    return item ? item.quantity : 0;
  }

  // Update shipping based on district
  function updateShipping(district) {
    const cart = getCart();
    const totals = calculateTotals(cart.items, district);
    Object.assign(cart, totals);
    saveCart(cart);
    return cart;
  }

  // ========================================
  // UI UPDATE FUNCTIONS
  // ========================================

    // Update cart badge in navbar - fetch from API
  async function updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    const cartBadge = document.getElementById('cartBadge');
    
    let count = 0;
    
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const API_BASE = (typeof window !== 'undefined' && window.CONFIG) ? window.CONFIG.API_BASE_URL : 'http://localhost:3000/api';
        const response = await fetch(`${API_BASE}/students/cart`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          let items = [];
          if (data.success && data.cart && data.cart.items && Array.isArray(data.cart.items)) {
            items = data.cart.items;
          } else if (data.success && data.data && data.data.items && Array.isArray(data.data.items)) {
            items = data.data.items;
          }
          
          count = items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
        }
      } catch (error) {
        console.error('Failed to fetch cart from API:', error);
      }
    }
    
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    
    if (cartBadge) {
      cartBadge.textContent = count;
      cartBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  // Trigger custom cart update event
  function triggerCartUpdate() {
    const event = new CustomEvent('cartUpdated', { 
      detail: getCart() 
    });
    window.dispatchEvent(event);
  }

  // Render cart items (for cart page or dropdown)
  function renderCartItems(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const cart = getCart();
    
    if (cart.items.length === 0) {
      container.innerHTML = `
        <div class="empty-cart">
          <i class="fas fa-shopping-cart" style="font-size: 48px; color: var(--gray-400); margin-bottom: 16px;"></i>
          <p style="color: var(--gray-600);">Your cart is empty</p>
          <a href="/products.html" class="btn btn-primary" style="margin-top: 16px;">Start Shopping</a>
        </div>
      `;
      return;
    }
    
    let html = '';
    
    cart.items.forEach(item => {
      html += `
        <div class="cart-item" data-product-id="${item.product_id}">
          <img src="${item.image_url || (utils.getPlaceholderImage ? utils.getPlaceholderImage('product') : '')}" 
               alt="${item.name}" 
               class="cart-item-image"
               onerror="Utils.handleImageError(this, 'product')">
          
          <div class="cart-item-details">
            <h4 class="cart-item-name">${item.name}</h4>
            <p class="cart-item-seller">Sold by: ${item.club_name}</p>
            <p class="cart-item-price">${utils.formatPrice ? utils.formatPrice(item.price) : '৳' + item.price}</p>
          </div>
          
          <div class="cart-item-controls">
            <div class="quantity-controls">
              <button class="btn-quantity-minus" onclick="Cart.updateQuantity(${item.product_id}, ${item.quantity - 1})">
                <i class="fas fa-minus"></i>
              </button>
              <input type="number" 
                     class="quantity-input" 
                     value="${item.quantity}" 
                     min="1" 
                     max="${item.stock}"
                     onchange="Cart.updateQuantity(${item.product_id}, parseInt(this.value))">
              <button class="btn-quantity-plus" onclick="Cart.updateQuantity(${item.product_id}, ${item.quantity + 1})">
                <i class="fas fa-plus"></i>
              </button>
            </div>
            
            <p class="cart-item-subtotal">
              ${utils.formatPrice ? utils.formatPrice(item.price * item.quantity) : '৳' + (item.price * item.quantity)}
            </p>
            
            <button class="btn-remove" onclick="Cart.removeItem(${item.product_id})" title="Remove">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }

  // Render cart summary (for cart page or checkout)
  function renderCartSummary(containerId, district = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const cart = getCart();
    
    // Update shipping if district provided
    let displayCart = cart;
    if (district) {
      displayCart = { ...cart, ...calculateTotals(cart.items, district) };
    }
    
    const formatPrice = utils.formatPrice || ((amount) => '৳' + amount);
    const freeShippingThreshold = SHIPPING_COSTS.free_threshold;
    const remainingForFree = freeShippingThreshold - displayCart.subtotal;
    
    let html = `
      <div class="cart-summary">
        <h3>Order Summary</h3>
        
        <div class="summary-row">
          <span>Subtotal (${displayCart.totalItems} items)</span>
          <span>${formatPrice(displayCart.subtotal)}</span>
        </div>
        
        <div class="summary-row">
          <span>Shipping</span>
          <span>${displayCart.shipping === 0 ? 'FREE' : formatPrice(displayCart.shipping)}</span>
        </div>
    `;
    
    if (remainingForFree > 0 && displayCart.subtotal > 0) {
      html += `
        <div class="free-shipping-notice">
          <i class="fas fa-truck"></i>
          Add ${formatPrice(remainingForFree)} more for FREE shipping!
        </div>
      `;
    }
    
    html += `
        <div class="summary-row total">
          <span>Total</span>
          <span>${formatPrice(displayCart.total)}</span>
        </div>
      </div>
    `;
    
    container.innerHTML = html;
  }

  // ========================================
  // VALIDATION
  // ========================================

  // Validate cart before checkout
  function validateCart() {
    const cart = getCart();
    
    if (cart.items.length === 0) {
      if (utils.showToast) {
        utils.showToast('Your cart is empty', 'warning');
      }
      return false;
    }
    
    // Check if all items are still in stock (would need API call in real scenario)
    // For now, just basic validation
    
    return true;
  }

  // ========================================
  // SYNC WITH SERVER (for logged-in users)
  // ========================================

  // Sync local cart with server
  async function syncWithServer(apiClient) {
    if (!apiClient) return;
    
    const cart = getCart();
    
    try {
      // Get server cart
      const serverCart = await apiClient.cart.getItems();
      
      // Merge carts (server takes priority)
      // This is a simplified version - you might want more sophisticated merging
      if (serverCart && serverCart.items) {
        saveCart(serverCart);
      }
    } catch (error) {
      console.error('Error syncing cart:', error);
      // Continue with local cart
    }
  }

  // ========================================
  // INITIALIZATION
  // ========================================

  // Initialize cart on page load
  async function init() {
    await updateCartBadge();
    
    // Listen for storage changes (cart updated in another tab)
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEYS.CART) {
        updateCartBadge();
        triggerCartUpdate();
      }
    });
  }

  // Cart module object
  const Cart = {
    // State
    getCart,
    saveCart,
    
    // Operations
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    getItemCount,
    isInCart,
    getItemQuantity,
    updateShipping,
    
    // UI
    updateCartBadge,
    renderCartItems,
    renderCartSummary,
    
    // Validation
    validateCart,
    
    // Sync
    syncWithServer,
    
    // Init
    init
  };

  // Auto-initialize when DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Export for different module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Cart;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() { return Cart; });
  } else {
    global.Cart = Cart;
  }

})(typeof window !== 'undefined' ? window : this);