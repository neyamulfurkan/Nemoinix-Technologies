// js/map.js
// Google Maps integration for location selection and display
// GLOBAL REFERENCE: Environment Variables → GOOGLE_MAPS_API_KEY, Competition Structure (location_lat, location_lng)
// PURPOSE: Handle all map-related functionality for competition venues and location selection

import { GOOGLE_MAPS_API_KEY, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from './config.js';
import { showToast } from './utils.js';

// Check if Google Maps API is loaded
function isGoogleMapsLoaded() {
    return typeof google !== 'undefined' && typeof google.maps !== 'undefined';
}

// Load Google Maps API dynamically
function loadGoogleMapsAPI() {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (isGoogleMapsLoaded()) {
            resolve();
            return;
        }
        
        // Check if script is already being loaded
        if (window.googleMapsLoading) {
            // Wait for existing load
            const checkInterval = setInterval(() => {
                if (isGoogleMapsLoaded()) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
            return;
        }
        
        window.googleMapsLoading = true;
        
        // Create script element
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
        script.async = true;
        script.defer = true;
        
        script.onload = () => {
            window.googleMapsLoading = false;
            resolve();
        };
        
        script.onerror = () => {
            window.googleMapsLoading = false;
            reject(new Error('Failed to load Google Maps'));
        };
        
        document.head.appendChild(script);
    });
}

// Initialize map for display only (competitions page, competition detail)
async function initDisplayMap(containerId, options = {}) {
    await loadGoogleMapsAPI();
    
    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error(`Map container #${containerId} not found`);
    }
    
    const mapOptions = {
        center: options.center || DEFAULT_MAP_CENTER,
        zoom: options.zoom || DEFAULT_MAP_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        ...options.mapOptions
    };
    
    const map = new google.maps.Map(container, mapOptions);
    
    return map;
}

// Add marker to map
function addMarker(map, position, options = {}) {
    const marker = new google.maps.Marker({
        map: map,
        position: position,
        title: options.title || '',
        icon: options.icon || null,
        animation: options.animation || null,
        draggable: options.draggable || false
    });
    
    // Add info window if content provided
    if (options.infoContent) {
        const infoWindow = new google.maps.InfoWindow({
            content: options.infoContent,
            maxWidth: options.maxWidth || 300
        });
        
        marker.addListener('click', () => {
            // Close other info windows if closeOthers is true
            if (options.closeOthers && map._openInfoWindows) {
                map._openInfoWindows.forEach(iw => iw.close());
                map._openInfoWindows = [];
            }
            
            infoWindow.open(map, marker);
            
            // Track open info windows
            if (!map._openInfoWindows) {
                map._openInfoWindows = [];
            }
            map._openInfoWindows.push(infoWindow);
        });
        
        // Auto-open if specified
        if (options.autoOpen) {
            infoWindow.open(map, marker);
            if (!map._openInfoWindows) {
                map._openInfoWindows = [];
            }
            map._openInfoWindows.push(infoWindow);
        }
        
        // Store info window reference
        marker.infoWindow = infoWindow;
    }
    
    return marker;
}

// Initialize map for location selection (create competition form)
async function initLocationPicker(containerId, options = {}) {
    await loadGoogleMapsAPI();
    
    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error(`Map container #${containerId} not found`);
    }
    
    const initialPosition = options.initialPosition || DEFAULT_MAP_CENTER;
    
    const map = new google.maps.Map(container, {
        center: initialPosition,
        zoom: options.zoom || 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true
    });
    
    // Add draggable marker
    const marker = new google.maps.Marker({
        map: map,
        position: initialPosition,
        draggable: true,
        animation: google.maps.Animation.DROP,
        title: 'Drag to set location'
    });
    
    // Info window
    const infoWindow = new google.maps.InfoWindow({
        content: '<div style="padding: 5px; font-size: 13px;">Drag the marker to select venue location</div>'
    });
    infoWindow.open(map, marker);
    
    // Update position on drag
    marker.addListener('dragend', () => {
        const position = marker.getPosition();
        const coords = {
            lat: position.lat(),
            lng: position.lng()
        };
        
        if (options.onPositionChange) {
            options.onPositionChange(coords);
        }
        
        // Reverse geocode to get address
        if (options.onAddressChange) {
            reverseGeocode(position).then(address => {
                options.onAddressChange(address);
            }).catch(error => {
                console.error('Reverse geocoding failed:', error);
            });
        }
        
        // Update info window
        infoWindow.setContent(`<div style="padding: 5px; font-size: 13px;">Location selected:<br><strong>${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</strong></div>`);
    });
    
    // Add search box for easy location finding
    if (options.enableSearch) {
        const searchBox = createSearchBox(map, marker, options, infoWindow);
        container.parentNode.insertBefore(searchBox, container);
    }
    
    // Add current location button
    if (options.enableCurrentLocation) {
        addCurrentLocationButton(map, marker, options, infoWindow);
    }
    
    return {
        map,
        marker,
        infoWindow,
        getPosition: () => {
            const pos = marker.getPosition();
            return { lat: pos.lat(), lng: pos.lng() };
        },
        setPosition: (lat, lng) => {
            const position = new google.maps.LatLng(lat, lng);
            marker.setPosition(position);
            map.setCenter(position);
            
            // Trigger callbacks
            if (options.onPositionChange) {
                options.onPositionChange({ lat, lng });
            }
            
            if (options.onAddressChange) {
                reverseGeocode(position).then(address => {
                    options.onAddressChange(address);
                }).catch(error => {
                    console.error('Reverse geocoding failed:', error);
                });
            }
        }
    };
}

// Create search box for location picker
function createSearchBox(map, marker, options, infoWindow) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search for a location...';
    input.className = 'map-search-box';
    
    const searchBox = new google.maps.places.SearchBox(input);
    
    // Bias search results towards map viewport
    map.addListener('bounds_changed', () => {
        searchBox.setBounds(map.getBounds());
    });
    
    // Listen for place selection
    searchBox.addListener('places_changed', () => {
        const places = searchBox.getPlaces();
        
        if (places.length === 0) return;
        
        const place = places[0];
        
        if (!place.geometry || !place.geometry.location) {
            showToast('No details available for this location', 'warning');
            return;
        }
        
        // Update marker and map
        marker.setPosition(place.geometry.location);
        map.setCenter(place.geometry.location);
        map.setZoom(15);
        
        // Update info window
        if (infoWindow) {
            infoWindow.setContent(`<div style="padding: 5px; font-size: 13px;"><strong>${place.name || 'Location selected'}</strong><br>${place.formatted_address}</div>`);
            infoWindow.open(map, marker);
        }
        
        // Trigger callbacks
        if (options.onPositionChange) {
            options.onPositionChange({
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng()
            });
        }
        
        if (options.onAddressChange) {
            options.onAddressChange(place.formatted_address);
        }
    });
    
    return input;
}

// Add current location button
function addCurrentLocationButton(map, marker, options, infoWindow) {
    const locationButton = document.createElement('button');
    locationButton.textContent = '📍 My Location';
    locationButton.className = 'map-location-button';
    locationButton.style.cssText = `
        position: absolute;
        top: 60px;
        right: 10px;
        background: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        z-index: 1000;
    `;
    
    locationButton.addEventListener('click', async () => {
        try {
            locationButton.disabled = true;
            locationButton.textContent = 'Getting location...';
            
            const position = await getCurrentLocation();
            marker.setPosition(position);
            map.setCenter(position);
            map.setZoom(15);
            
            if (infoWindow) {
                infoWindow.setContent(`<div style="padding: 5px; font-size: 13px;">Your current location</div>`);
                infoWindow.open(map, marker);
            }
            
            // Trigger callbacks
            if (options.onPositionChange) {
                options.onPositionChange(position);
            }
            
            if (options.onAddressChange) {
                const address = await reverseGeocode(position);
                options.onAddressChange(address);
            }
            
            showToast('Location updated', 'success');
            
        } catch (error) {
            showToast('Could not get your location', 'error');
        } finally {
            locationButton.disabled = false;
            locationButton.textContent = '📍 My Location';
        }
    });
    
    map.controls[google.maps.ControlPosition.RIGHT_TOP].push(locationButton);
}

// Reverse geocode: Get address from coordinates
async function reverseGeocode(position) {
    await loadGoogleMapsAPI();
    
    return new Promise((resolve, reject) => {
        const geocoder = new google.maps.Geocoder();
        
        geocoder.geocode({ location: position }, (results, status) => {
            if (status === 'OK') {
                if (results[0]) {
                    resolve(results[0].formatted_address);
                } else {
                    reject(new Error('No address found'));
                }
            } else {
                reject(new Error(`Geocoder failed: ${status}`));
            }
        });
    });
}

// Forward geocode: Get coordinates from address
async function geocodeAddress(address) {
    await loadGoogleMapsAPI();
    
    return new Promise((resolve, reject) => {
        const geocoder = new google.maps.Geocoder();
        
        geocoder.geocode({ address: address }, (results, status) => {
            if (status === 'OK') {
                if (results[0]) {
                    const location = results[0].geometry.location;
                    resolve({
                        lat: location.lat(),
                        lng: location.lng(),
                        formatted_address: results[0].formatted_address
                    });
                } else {
                    reject(new Error('No location found'));
                }
            } else {
                reject(new Error(`Geocoder failed: ${status}`));
            }
        });
    });
}

// Show multiple competitions on map (competitions page map view)
async function showCompetitionsOnMap(containerId, competitions, options = {}) {
    await loadGoogleMapsAPI();
    
    const map = await initDisplayMap(containerId, {
        center: DEFAULT_MAP_CENTER,
        zoom: 7,
        ...options
    });
    
    const bounds = new google.maps.LatLngBounds();
    const markers = [];
    
    competitions.forEach(competition => {
        if (!competition.location_lat || !competition.location_lng) return;
        
        const position = {
            lat: parseFloat(competition.location_lat),
            lng: parseFloat(competition.location_lng)
        };
        
        // Format date
        const competitionDate = new Date(competition.competition_date);
        const formattedDate = competitionDate.toLocaleDateString('en-BD', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        
        const infoContent = `
            <div class="map-info-window">
                ${competition.banner_url ? `<img src="${competition.banner_url}" alt="${competition.title}" style="width: 100%; max-width: 200px; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 8px;">` : ''}
                <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">${competition.title}</h4>
                <p style="margin: 0; color: #666; font-size: 12px; line-height: 1.5;">
                    <strong>Date:</strong> ${formattedDate}<br>
                    <strong>Venue:</strong> ${competition.venue}<br>
                    <strong>Fee:</strong> ৳${competition.registration_fee ? competition.registration_fee.toLocaleString('en-BD') : '0'}
                </p>
                <a href="/competition-detail.html?id=${competition.id}" style="display: inline-block; margin-top: 8px; padding: 6px 12px; background: #1991EB; color: white; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: 500;">View Details →</a>
            </div>
        `;
        
        const marker = addMarker(map, position, {
            title: competition.title,
            infoContent: infoContent,
            closeOthers: true,
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
                scaledSize: new google.maps.Size(40, 40)
            }
        });
        
        markers.push(marker);
        bounds.extend(position);
    });
    
    // Fit map to show all markers
    if (markers.length > 0) {
        map.fitBounds(bounds);
        
        // Adjust zoom if only one marker
        if (markers.length === 1) {
            map.setZoom(12);
        }
        
        // Add padding to bounds
        const padding = { top: 50, right: 50, bottom: 50, left: 50 };
        map.fitBounds(bounds, padding);
    }
    
    // Marker clustering for many markers (if library available)
    if (markers.length > 10 && typeof MarkerClusterer !== 'undefined') {
        new MarkerClusterer(map, markers, {
            imagePath: 'https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/m'
        });
    }
    
    return { map, markers };
}

// Show single competition location (competition detail page)
async function showCompetitionLocation(containerId, competition, options = {}) {
    if (!competition.location_lat || !competition.location_lng) {
        throw new Error('Competition has no location data');
    }
    
    const position = {
        lat: parseFloat(competition.location_lat),
        lng: parseFloat(competition.location_lng)
    };
    
    const map = await initDisplayMap(containerId, {
        center: position,
        zoom: 15,
        ...options
    });
    
    // Format date and time
    const competitionDate = new Date(competition.competition_date);
    const formattedDate = competitionDate.toLocaleDateString('en-BD', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const infoContent = `
        <div class="map-info-window">
            <h4 style="margin: 0 0 8px 0; font-weight: 600;">${competition.title}</h4>
            <p style="margin: 0; color: #666; font-size: 13px; line-height: 1.6;">
                <strong>📍 Venue:</strong> ${competition.venue}<br>
                <strong>📅 Date:</strong> ${formattedDate}<br>
                <strong>⏰ Time:</strong> ${competition.competition_time || 'TBA'}
            </p>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${position.lat},${position.lng}" target="_blank" rel="noopener" style="display: inline-block; margin-top: 10px; padding: 6px 12px; background: #10B981; color: white; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: 500;">🗺 Get Directions</a>
        </div>
    `;
    
    const marker = addMarker(map, position, {
        title: competition.venue,
        infoContent: infoContent,
        autoOpen: true,
        animation: google.maps.Animation.DROP,
        icon: {
            url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
            scaledSize: new google.maps.Size(50, 50)
        }
    });
    
    return { map, marker };
}

// Get current user location
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported by your browser'));
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                let message = 'Failed to get location';
                
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Location permission denied';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Location information unavailable';
                        break;
                    case error.TIMEOUT:
                        message = 'Location request timed out';
                        break;
                }
                
                reject(new Error(message));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// Calculate distance between two points (in km)
function calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
    const deltaLng = (point2.lng - point1.lng) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
}

// Format distance for display
function formatDistance(distanceKm) {
    if (distanceKm < 1) {
        return `${Math.round(distanceKm * 1000)} meters`;
    } else if (distanceKm < 10) {
        return `${distanceKm.toFixed(1)} km`;
    } else {
        return `${Math.round(distanceKm)} km`;
    }
}

// Get directions URL
function getDirectionsUrl(destination, origin = null) {
    const baseUrl = 'https://www.google.com/maps/dir/';
    
    let url = baseUrl;
    
    if (origin) {
        url += `${origin.lat},${origin.lng}/`;
    }
    
    url += `${destination.lat},${destination.lng}`;
    
    return url;
}

// Batch geocode multiple addresses
async function geocodeMultipleAddresses(addresses) {
    const results = [];
    
    for (const address of addresses) {
        try {
            const result = await geocodeAddress(address);
            results.push({ address, success: true, ...result });
        } catch (error) {
            results.push({ address, success: false, error: error.message });
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return results;
}

// Export functions
export {
    loadGoogleMapsAPI,
    isGoogleMapsLoaded,
    initDisplayMap,
    initLocationPicker,
    addMarker,
    reverseGeocode,
    geocodeAddress,
    geocodeMultipleAddresses,
    showCompetitionsOnMap,
    showCompetitionLocation,
    getCurrentLocation,
    calculateDistance,
    formatDistance,
    getDirectionsUrl
};