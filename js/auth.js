// js/auth.js
// Authentication management - login state, token storage, role-based access, session handling
// GLOBAL REFERENCE: User Workflows → Authentication, API Endpoints → /api/auth/*, JWT Configuration, User Object Structure
// PURPOSE: Centralized authentication logic for the entire frontend

(function(global) {
  'use strict';

  // Get config (handle both module and script scenarios)
  const config = typeof window !== 'undefined' && window.CONFIG ? window.CONFIG : {};
  const API_BASE_URL = config.API_BASE_URL || 'http://localhost:3000/api';
  const STORAGE_KEYS = config.STORAGE_KEYS || {
    TOKEN: 'token',
    USER: 'user',
    CART: 'cart'
  };

  // Get current user from storage
  function getCurrentUser() {
    const userStr = localStorage.getItem(STORAGE_KEYS.USER) || 
                    sessionStorage.getItem(STORAGE_KEYS.USER);
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      console.error('Error parsing user data:', e);
      return null;
    }
  }

  // Get auth token
  function getToken() {
    return localStorage.getItem(STORAGE_KEYS.TOKEN) || 
           sessionStorage.getItem(STORAGE_KEYS.TOKEN);
  }

  // Check if user is logged in
  function isLoggedIn() {
    return !!getToken();
  }

  // Check user role
  function hasRole(role) {
    const user = getCurrentUser();
    return user && user.role === role;
  }

  // Check if user is student
  function isStudent() {
    return hasRole('student');
  }

  // Check if user is club admin
  function isClubAdmin() {
    return hasRole('club_admin');
  }

  // Check if user is super admin
  function isSuperAdmin() {
    return hasRole('super_admin');
  }

  // Login function
  async function login(email, password, rememberMe = true) {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }
      
      // Store token and user
      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(STORAGE_KEYS.TOKEN, data.token);
      storage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
      
      return data.user;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  // Logout function
  async function logout() {
    try {
      // Call logout API
      const token = getToken();
      if (token) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }).catch(err => console.error('Logout API error:', err));
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear storage
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER);
      localStorage.removeItem(STORAGE_KEYS.CART);
      sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
      sessionStorage.removeItem(STORAGE_KEYS.USER);
      
      // Redirect to login
      window.location.href = '/login.html';
    }
  }

  // Verify token validity
  async function verifyToken() {
    const token = getToken();
    if (!token) return null;
    
    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) throw new Error('Invalid token');
      
      const data = await response.json();
      
      // Update stored user data
      const storage = localStorage.getItem(STORAGE_KEYS.TOKEN) ? localStorage : sessionStorage;
      storage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
      
      return data.user;
    } catch (error) {
      console.error('Token verification error:', error);
      // Token invalid, clear storage
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER);
      sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
      sessionStorage.removeItem(STORAGE_KEYS.USER);
      return null;
    }
  }

  // Require authentication (use on protected pages)
  async function requireAuth(allowedRoles = []) {
    const token = getToken();
    
    if (!token) {
      // Not logged in, redirect to login
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login.html?redirect=${redirect}`;
      return false;
    }
    
    // Verify token
    const user = await verifyToken();
    
    if (!user) {
      return false;
    }
    
    // Check role if specified
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      // Wrong role, redirect to appropriate dashboard
      redirectToDashboard(user.role);
      return false;
    }
    
    return true;
  }

  // Redirect to appropriate dashboard based on role
  function redirectToDashboard(role) {
    const dashboards = {
      student: '/student-dashboard.html',
      club_admin: '/club-dashboard.html',
      super_admin: '/super-admin-dashboard.html'
    };
    
    window.location.href = dashboards[role] || '/index.html';
  }

  // Auto redirect if logged in (for login/signup pages)
  function redirectIfLoggedIn() {
    if (isLoggedIn()) {
      const user = getCurrentUser();
      if (user) {
        redirectToDashboard(user.role);
        return true;
      }
    }
    return false;
  }

  // Update user profile in storage
  function updateUserProfile(updatedUser) {
    const storage = localStorage.getItem(STORAGE_KEYS.TOKEN) ? localStorage : sessionStorage;
    const currentUser = getCurrentUser();
    const merged = { ...currentUser, ...updatedUser };
    storage.setItem(STORAGE_KEYS.USER, JSON.stringify(merged));
  }

  // Check if email is verified
  function isEmailVerified() {
    const user = getCurrentUser();
    return user ? user.is_verified : false;
  }

  // Get user initials for avatar
  function getUserInitials() {
    const user = getCurrentUser();
    if (!user || !user.full_name) return '?';
    
    const names = user.full_name.trim().split(' ');
    if (names.length >= 2) {
      return (names[0][0] + names[names.length - 1][0]).toUpperCase();
    }
    return user.full_name[0].toUpperCase();
  }

  // Get user's club info (for club admins)
  function getClubInfo() {
    const user = getCurrentUser();
    if (!user || user.role !== 'club_admin') return null;
    
    return {
      club_id: user.club_id,
      club_name: user.club_name,
      club_slug: user.club_slug,
      club_logo: user.club_logo,
      club_status: user.club_status,
      reward_tier: user.reward_tier,
      reward_points: user.reward_points
    };
  }

  // Check if club is approved (for club admins)
  function isClubApproved() {
    const clubInfo = getClubInfo();
    return clubInfo && clubInfo.club_status === 'approved';
  }

  // Auth module object
  const Auth = {
    getCurrentUser,
    getToken,
    isLoggedIn,
    hasRole,
    isStudent,
    isClubAdmin,
    isSuperAdmin,
    login,
    logout,
    verifyToken,
    requireAuth,
    redirectToDashboard,
    redirectIfLoggedIn,
    updateUserProfile,
    isEmailVerified,
    getUserInitials,
    getClubInfo,
    isClubApproved
  };

  // Export for different module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Auth;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() { return Auth; });
  } else {
    global.Auth = Auth;
  }

})(typeof window !== 'undefined' ? window : this);