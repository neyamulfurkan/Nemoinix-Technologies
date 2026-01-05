// js/config.js
// Central configuration file with all global constants, API endpoints, and environment-specific settings

(function(global) {
  'use strict';

  // API Configuration
  // Force localhost for development - change this when deploying
  const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api' 
    : 'https://nemoinix-technologies.onrender.com/api';
  
  // Use this for production:
  // const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  //   ? 'http://localhost:3000/api' 
  //   : 'https://api.nemionix.com.bd/api';
  const API_TIMEOUT = 30000; // 30 seconds

  // Cloudinary Configuration (public values only)
  const CLOUDINARY_CLOUD_NAME = 'your_cloud_name';
  const CLOUDINARY_UPLOAD_PRESET = 'your_preset';
  const CLOUDINARY_API_BASE = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}`;

  // Google Maps Configuration
  const GOOGLE_MAPS_API_KEY = 'your_google_maps_key';
  const DEFAULT_MAP_CENTER = { lat: 23.8103, lng: 90.4125 }; // Bangladesh center
  const DEFAULT_MAP_ZOOM = 7;

  // App Configuration
  const APP_NAME = 'Bangladesh Robotics Marketplace';
  const SUPPORT_EMAIL = 'support@roboticsbd.com';

  // Pagination
  const DEFAULT_PAGE_SIZE = 12;
  const PRODUCTS_PER_PAGE = 24;
  const ORDERS_PER_PAGE = 10;
  const COMPETITIONS_PER_PAGE = 12;

  // File Upload Limits
  const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
  const MAX_IMAGES_COUNT = 5;
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];
  const MAX_CERTIFICATE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_CERTIFICATE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

  // Validation Rules
  const BD_PHONE_REGEX = /^01[3-9]\d{8}$/;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PASSWORD_MIN_LENGTH = 8;
  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  // Reward System
  const REWARD_TIERS = {
    bronze: { min: 0, max: 500, name: 'Bronze', commission: 0.05 },
    silver: { min: 500, max: 1500, name: 'Silver', commission: 0.03 },
    gold: { min: 1500, max: 5000, name: 'Gold', commission: 0.02 },
    platinum: { min: 5000, max: Infinity, name: 'Platinum', commission: 0.01 }
  };

  const REWARD_POINTS = {
    COMPETITION_CREATED: 100,
    PER_100_TAKA: 10,
    FIVE_STAR_REVIEW: 20,
    FAST_SHIPPING: 5
  };

  // Commission Rates
  const COMMISSION_RATES = {
    bronze: 0.05,
    silver: 0.03,
    gold: 0.02,
    platinum: 0.01
  };

  // Shipping Configuration
  const SHIPPING_COSTS = {
    dhaka: 60,
    outside_dhaka: 80,
    free_threshold: 1000
  };

  const DHAKA_DISTRICTS = [
    'Dhaka', 'Gazipur', 'Narayanganj', 'Narsingdi', 
    'Manikganj', 'Munshiganj', 'Tangail', 'Kishoreganj'
  ];

  // Bangladesh Districts (All 64)
  const BD_DISTRICTS = [
    'Dhaka', 'Chittagong', 'Rajshahi', 'Khulna', 'Barisal',
    'Sylhet', 'Rangpur', 'Mymensingh', 'Gazipur', 'Narayanganj',
    'Comilla', 'Cox\'s Bazar', 'Jessore', 'Bogra', 'Dinajpur',
    'Pabna', 'Faridpur', 'Tangail', 'Narsingdi', 'Kushtia',
    'Brahmanbaria', 'Noakhali', 'Feni', 'Chandpur', 'Lakshmipur',
    'Bhola', 'Patuakhali', 'Barguna', 'Jhalokati', 'Pirojpur',
    'Satkhira', 'Bagerhat', 'Chuadanga', 'Jhenaidah', 'Magura',
    'Meherpur', 'Narail', 'Jamalpur', 'Netrokona', 'Sherpur',
    'Sunamganj', 'Habiganj', 'Moulvibazar', 'Natore', 'Naogaon',
    'Nawabganj', 'Sirajganj', 'Joypurhat', 'Panchagarh', 'Thakurgaon',
    'Nilphamari', 'Lalmonirhat', 'Kurigram', 'Gaibandha', 'Kishoreganj',
    'Munshiganj', 'Madaripur', 'Gopalganj', 'Shariatpur', 'Rajbari',
    'Manikganj', 'Pirojpur', 'Bandarban'
  ];

  // Bangladesh Divisions
  const BD_DIVISIONS = [
    'Dhaka', 'Chittagong', 'Rajshahi', 'Khulna', 
    'Barisal', 'Sylhet', 'Rangpur', 'Mymensingh'
  ];

  // Product Categories
  const PRODUCT_CATEGORIES = [
    'Microcontrollers',
    'Sensors',
    'Motors & Drivers',
    'Power & Battery',
    'Communication Modules',
    'Displays',
    'Tools & Equipment',
    'Mechanical Parts',
    'Cables & Connectors',
    'Other Components'
  ];

  // Competition Categories
  const COMPETITION_CATEGORIES = [
    'Line Following',
    'Maze Solving',
    'Soccer Robot',
    'Sumo Robot',
    'Drone Competition',
    'Project Showcase',
    'Innovation Challenge',
    'Other'
  ];

  // Order Statuses
  const ORDER_STATUSES = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };

  // Payment Methods
  const PAYMENT_METHODS = {
    cash_on_delivery: 'Cash on Delivery',
    bkash: 'bKash',
    nagad: 'Nagad'
  };

  // Local Storage Keys
  const STORAGE_KEYS = {
    TOKEN: 'token',
    USER: 'user',
    CART: 'cart',
    RECENTLY_VIEWED: 'recentlyViewed',
    THEME: 'theme'
  };

  // Toast/Notification Duration
  const TOAST_DURATION = 3000; // 3 seconds

  // Debounce Delays
  const SEARCH_DEBOUNCE = 300; // 300ms
  const INPUT_DEBOUNCE = 500; // 500ms

  // Date Formats
  const DATE_FORMAT = 'DD MMM YYYY';
  const DATETIME_FORMAT = 'DD MMM YYYY, h:mm A';

  // Config object
  const CONFIG = {
    API_BASE_URL,
    API_TIMEOUT,
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_UPLOAD_PRESET,
    CLOUDINARY_API_BASE,
    GOOGLE_MAPS_API_KEY,
    DEFAULT_MAP_CENTER,
    DEFAULT_MAP_ZOOM,
    APP_NAME,
    SUPPORT_EMAIL,
    DEFAULT_PAGE_SIZE,
    PRODUCTS_PER_PAGE,
    ORDERS_PER_PAGE,
    COMPETITIONS_PER_PAGE,
    MAX_IMAGE_SIZE,
    MAX_IMAGES_COUNT,
    ALLOWED_IMAGE_TYPES,
    MAX_CERTIFICATE_SIZE,
    ALLOWED_CERTIFICATE_TYPES,
    BD_PHONE_REGEX,
    EMAIL_REGEX,
    PASSWORD_MIN_LENGTH,
    PASSWORD_REGEX,
    REWARD_TIERS,
    REWARD_POINTS,
    COMMISSION_RATES,
    SHIPPING_COSTS,
    DHAKA_DISTRICTS,
    BD_DISTRICTS,
    BD_DIVISIONS,
    PRODUCT_CATEGORIES,
    COMPETITION_CATEGORIES,
    ORDER_STATUSES,
    PAYMENT_METHODS,
    STORAGE_KEYS,
    TOAST_DURATION,
    SEARCH_DEBOUNCE,
    INPUT_DEBOUNCE,
    DATE_FORMAT,
    DATETIME_FORMAT
  };

  // Export for different module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() { return CONFIG; });
  } else {
    global.CONFIG = CONFIG;
  }

})(typeof window !== 'undefined' ? window : this);

