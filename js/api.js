// js/api.js
// Centralized API client for all HTTP requests with authentication, error handling, and response parsing
// GLOBAL REFERENCE: API Endpoints Structure, Authentication, Error Handling
// PURPOSE: Single API wrapper used by all pages to communicate with backend

(function(global) {
    'use strict';

    const API_BASE_URL = (typeof window !== 'undefined' && window.CONFIG) ? window.CONFIG.API_BASE_URL : 'http://localhost:3000/api';
    const API_TIMEOUT = global.CONFIG ? global.CONFIG.API_TIMEOUT : 30000;

    // Get token from localStorage
    function getToken() {
        return localStorage.getItem('token');
    }

    // Logout function
    function logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
    }

    // API Client class
    class APIClient {
        constructor() {
            this.baseURL = API_BASE_URL;
            this.timeout = API_TIMEOUT;
            this.cache = new Map();
            this.cacheTimeout = 60000; // 1 minute cache
        }
        
        // Build headers
        _getHeaders(customHeaders = {}) {
            const headers = {
                'Content-Type': 'application/json',
                ...customHeaders
            };
            
            // Add auth token if available
            const token = getToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            return headers;
        }
        
        // Handle response
        async _handleResponse(response) {
            // Parse JSON
            let data;
            try {
                data = await response.json();
            } catch (error) {
                data = {};
            }
            
            // Check for errors
            if (!response.ok) {
                // Handle 401 Unauthorized
                if (response.status === 401) {
                    logout(); // Auto logout on auth failure
                    throw new Error('Session expired. Please login again.');
                }
                
                // Throw error with message from API
                throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
            }
            
            return data;
        }
        
        // Handle timeout
        _timeout(ms, promise) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error('Request timeout'));
                }, ms);
                
                promise
                    .then(value => {
                        clearTimeout(timer);
                        resolve(value);
                    })
                    .catch(error => {
                        clearTimeout(timer);
                        reject(error);
                    });
            });
        }
        
        // GET request with caching
    
    // GET request with caching
    async get(endpoint, params = {}) {
        const url = new URL(`${this.baseURL}${endpoint}`);
        
        // Add query parameters
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
                url.searchParams.append(key, params[key]);
            }
        });
        
        const cacheKey = url.toString();
        
        // Check cache synchronously
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
            this.cache.delete(cacheKey);
        }
        
        // Fetch with timeout
        const fetchPromise = fetch(url.toString(), {
            method: 'GET',
            headers: this._getHeaders()
        });
        
        const response = await this._timeout(this.timeout, fetchPromise);
        const data = await this._handleResponse(response);
        
        // Cache result
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        
        return data;
    }
        // POST request
        async post(endpoint, body = {}, customHeaders = {}) {
            const fetchPromise = fetch(`${this.baseURL}${endpoint}`, {
                method: 'POST',
                headers: this._getHeaders(customHeaders),
                body: JSON.stringify(body)
            });
            
            const response = await this._timeout(this.timeout, fetchPromise);
            return this._handleResponse(response);
        }
        
        // PUT request
        async put(endpoint, body = {}) {
            const fetchPromise = fetch(`${this.baseURL}${endpoint}`, {
                method: 'PUT',
                headers: this._getHeaders(),
                body: JSON.stringify(body)
            });
            
            const response = await this._timeout(this.timeout, fetchPromise);
            return this._handleResponse(response);
        }
        
        // PATCH request
        async patch(endpoint, body = {}) {
            const fetchPromise = fetch(`${this.baseURL}${endpoint}`, {
                method: 'PATCH',
                headers: this._getHeaders(),
                body: JSON.stringify(body)
            });
            
            const response = await this._timeout(this.timeout, fetchPromise);
            return this._handleResponse(response);
        }
        
        // DELETE request
        async delete(endpoint) {
            const fetchPromise = fetch(`${this.baseURL}${endpoint}`, {
                method: 'DELETE',
                headers: this._getHeaders()
            });
            
            const response = await this._timeout(this.timeout, fetchPromise);
            return this._handleResponse(response);
        }
        
        // POST with FormData (for file uploads)
        async postFormData(endpoint, formData) {
            const headers = {};
            
            // Add auth token
            const token = getToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            // Don't set Content-Type for FormData (browser handles it)
            const fetchPromise = fetch(`${this.baseURL}${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: formData
            });
            
            const response = await this._timeout(this.timeout, fetchPromise);
            return this._handleResponse(response);
        }
        // PUT with FormData (for file uploads)
        async putFormData(endpoint, formData) {
            const headers = {};
            
            // Add auth token
            const token = getToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            // Don't set Content-Type for FormData (browser handles it)
            const fetchPromise = fetch(`${this.baseURL}${endpoint}`, {
                method: 'PUT',
                headers: headers,
                body: formData
            });
            
            const response = await this._timeout(this.timeout, fetchPromise);
            return this._handleResponse(response);
        }
        // PUT with FormData (for file uploads)
        async putFormData(endpoint, formData) {
            const headers = {};
            
            // Add auth token
            const token = getToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            // Don't set Content-Type for FormData (browser handles it)
            const fetchPromise = fetch(`${this.baseURL}${endpoint}`, {
                method: 'PUT',
                headers: headers,
                body: formData
            });
            
            const response = await this._timeout(this.timeout, fetchPromise);
            return this._handleResponse(response);
        }
    }

    // Create singleton instance
    const apiClient = new APIClient();

    // Export to global
    global.apiClient = apiClient;
    global.APIClient = APIClient;

})(typeof window !== 'undefined' ? window : this);