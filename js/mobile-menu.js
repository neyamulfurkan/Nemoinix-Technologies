/**
 * Mobile Menu Handler for Nemionix Technologies
 * Handles responsive navigation and mobile UI interactions
 */

(function() {
    'use strict';

    // Wait for DOM to be fully loaded
    document.addEventListener('DOMContentLoaded', function() {
        initMobileMenu();
        initResponsiveElements();
        handleWindowResize();
    });

    /**
     * Initialize mobile menu functionality
     */
    function initMobileMenu() {
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const navMenu = document.querySelector('.nav-menu');
        const body = document.body;

        if (!mobileMenuToggle || !navMenu) {
            console.warn('Mobile menu elements not found');
            return;
        }
        
        console.log('Mobile menu initialized');

        // Toggle mobile menu
        mobileMenuToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const isActive = navMenu.classList.toggle('active');
            mobileMenuToggle.classList.toggle('active');
            
            // Prevent body scroll when menu is open
            if (isActive) {
                body.style.overflow = 'hidden';
            } else {
                body.style.overflow = '';
            }
        });

        // Close menu when clicking nav link
        const navLinks = navMenu.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                navMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
                body.style.overflow = '';
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', function(e) {
            if (!navMenu.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
                navMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
                body.style.overflow = '';
            }
        });

        // Handle escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && navMenu.classList.contains('active')) {
                navMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
                body.style.overflow = '';
            }
        });
    }

    /**
     * Initialize responsive elements
     */
    function initResponsiveElements() {
        // Handle filter sidebar on mobile (products/competitions pages)
        const filtersSidebar = document.getElementById('filtersSidebar');
        const mobileFilterBtn = document.querySelector('.mobile-filter-btn');
        
        if (filtersSidebar && mobileFilterBtn) {
            mobileFilterBtn.addEventListener('click', function() {
                filtersSidebar.classList.toggle('active');
                document.body.style.overflow = filtersSidebar.classList.contains('active') ? 'hidden' : '';
            });

            // Close button for filters
            const closeBtn = document.createElement('button');
            closeBtn.className = 'filter-close-btn';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = function() {
                filtersSidebar.classList.remove('active');
                document.body.style.overflow = '';
            };
            
            if (!filtersSidebar.querySelector('.filter-close-btn')) {
                filtersSidebar.insertBefore(closeBtn, filtersSidebar.firstChild);
            }
        }

        // Handle responsive tables
        makeTablesResponsive();
        
        // Handle responsive cards grid
        adjustCardsGrid();
    }

    /**
     * Make tables responsive with horizontal scroll
     */
    function makeTablesResponsive() {
        const tables = document.querySelectorAll('.table, table');
        
        tables.forEach(table => {
            if (!table.parentElement.classList.contains('table-responsive')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'table-responsive';
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
        });
    }

    /**
     * Adjust cards grid based on screen size
     */
    function adjustCardsGrid() {
        const grids = document.querySelectorAll('.competitions-grid, .products-grid, .clubs-grid');
        
        function updateGridColumns() {
            const width = window.innerWidth;
            
            grids.forEach(grid => {
                if (width < 640) {
                    grid.style.gridTemplateColumns = '1fr';
                } else if (width < 768) {
                    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
                } else if (width < 1024) {
                    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
                } else {
                    grid.style.gridTemplateColumns = '';
                }
            });
        }

        updateGridColumns();
        window.addEventListener('resize', debounce(updateGridColumns, 250));
    }

    /**
     * Handle window resize events
     */
    function handleWindowResize() {
        let resizeTimer;
        
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function() {
                // Close mobile menu on resize to desktop
                if (window.innerWidth > 1024) {
                    const navMenu = document.querySelector('.nav-menu');
                    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
                    
                    if (navMenu) {
                        navMenu.classList.remove('active');
                    }
                    if (mobileMenuToggle) {
                        mobileMenuToggle.classList.remove('active');
                    }
                    document.body.style.overflow = '';
                }

                // Adjust elements
                adjustCardsGrid();
            }, 250);
        });
    }

    /**
     * Debounce function to limit function calls
     */
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

    /**
     * Handle touch events for better mobile experience
     */
    function initTouchHandlers() {
        // Add touch-friendly hover states
        const cards = document.querySelectorAll('.card, .product-card, .competition-card, .club-card');
        
        cards.forEach(card => {
            card.addEventListener('touchstart', function() {
                this.classList.add('touch-active');
            });
            
            card.addEventListener('touchend', function() {
                setTimeout(() => {
                    this.classList.remove('touch-active');
                }, 300);
            });
        });
    }

    // Initialize touch handlers
    initTouchHandlers();
})();