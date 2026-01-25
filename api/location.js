// api/location.js
import axios from 'axios';

// In-memory storage for location data (optional - you can add Firebase back if needed)
const locationStorage = new Map();

// Rate limiting storage
const rateLimitMap = new Map();

export default async function handler(req, res) {
  const { method, query: params, body } = req;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Enhanced Security: Rate Limiting
    const clientIP = getClientIp(req);
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({ 
        error: 'Too many requests. Please try again later.' 
      });
    }

    // Route handling
    if (method === 'GET') {
      return await handleGet(req, res, params);
    } else if (method === 'POST') {
      return await handlePost(req, res, params, body);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ==================== SECURITY ENHANCEMENTS ====================

// Rate limiting function
function checkRateLimit(ip, maxRequests = 100, windowMs = 900000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, [now]);
    return true;
  }

  const requests = rateLimitMap.get(ip).filter(time => time > windowStart);
  rateLimitMap.set(ip, [...requests, now]);

  // Clean up old entries periodically
  if (requests.length === 0) {
    rateLimitMap.delete(ip);
  }

  return requests.length < maxRequests;
}

// Input sanitization
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 500); // Limit length
}

// Enhanced validation for location data
function validateLocationData(data) {
  const errors = [];

  // For POST requests requiring lat/lng
  if (data.latitude !== undefined && data.longitude !== undefined) {
    const lat = parseFloat(data.latitude);
    const lng = parseFloat(data.longitude);
    
    if (isNaN(lat) || lat < -90 || lat > 90) {
      errors.push('Latitude must be between -90 and 90');
    }
    
    if (isNaN(lng) || lng < -180 || lng > 180) {
      errors.push('Longitude must be between -180 and 180');
    }
    
    if (data.accuracy !== undefined && (data.accuracy < 0 || data.accuracy > 100000)) {
      errors.push('Accuracy must be between 0 and 100000 meters');
    }
  }

  return errors;
}

// ==================== HELPER FUNCTIONS ====================

// Get client IP
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         req.ip || 
         'unknown';
}

// Get location from IP using multiple free APIs
async function getLocationFromIp(ip) {
  // Handle local IPs
  if (ip === 'unknown' || ip === '127.0.0.1' || ip.startsWith('192.168.')) {
    return {
      ip: ip,
      latitude: 40.7128,
      longitude: -74.0060,
      accuracy: null,
      city: 'New York',
      region: 'New York',
      country: 'United States',
      countryCode: 'US',
      postalCode: '10001',
      timezone: 'America/New_York',
      isp: 'Local Network',
      source: 'default',
      message: 'Using default location for local IP'
    };
  }

  // Try multiple free geolocation APIs for reliability
  const apis = [
    `https://ipapi.co/${ip}/json/`,
    `http://ip-api.com/json/${ip}`,
    `https://geolocation-db.com/json/${ip}`
  ];
  
  for (const apiUrl of apis) {
    try {
      const response = await axios.get(apiUrl, { timeout: 5000 });
      
      if (apiUrl.includes('ipapi.co')) {
        const data = response.data;
        if (data.latitude && data.longitude) {
          return {
            ip: ip,
            latitude: parseFloat(data.latitude),
            longitude: parseFloat(data.longitude),
            accuracy: null,
            city: data.city,
            region: data.region,
            country: data.country_name,
            countryCode: data.country_code,
            postalCode: data.postal,
            timezone: data.timezone,
            isp: data.org,
            source: 'ipapi.co',
            rawData: data
          };
        }
      }
      
      if (apiUrl.includes('ip-api.com')) {
        const data = response.data;
        if (data.lat && data.lon) {
          return {
            ip: ip,
            latitude: parseFloat(data.lat),
            longitude: parseFloat(data.lon),
            accuracy: null,
            city: data.city,
            region: data.regionName,
            country: data.country,
            countryCode: data.countryCode,
            postalCode: data.zip,
            timezone: data.timezone,
            isp: data.isp,
            source: 'ip-api.com',
            rawData: data
          };
        }
      }
      
      if (apiUrl.includes('geolocation-db.com')) {
        const data = response.data;
        if (data.latitude && data.longitude) {
          return {
            ip: ip,
            latitude: parseFloat(data.latitude),
            longitude: parseFloat(data.longitude),
            accuracy: null,
            city: data.city,
            region: data.state,
            country: data.country_name,
            countryCode: data.country_code,
            postalCode: data.postal,
            timezone: null,
            isp: null,
            source: 'geolocation-db.com',
            rawData: data
          };
        }
      }
      
    } catch (error) {
      console.log(`API ${apiUrl} failed:`, error.message);
      continue;
    }
  }
  
  return null;
}

// Store location in memory (optional - can be replaced with Firebase)
function storeLocation(data) {
  const id = `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const locationData = {
    id,
    ...data,
    timestamp: Date.now(),
    storedAt: new Date().toISOString()
  };
  
  locationStorage.set(id, locationData);
  
  // Optional: Clean up old entries (keep last 1000)
  if (locationStorage.size > 1000) {
    const keys = Array.from(locationStorage.keys()).slice(0, 100);
    keys.forEach(key => locationStorage.delete(key));
  }
  
  return locationData;
}

// Get recent locations from memory
function getRecentLocations(limit = 50) {
  const locations = Array.from(locationStorage.values());
  return locations
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

// ==================== GET REQUEST HANDLER ====================

async function handleGet(req, res, params) {
  const { 
    ip, 
    recent, 
    format, 
    map, 
    limit = 50 
  } = params;

  // Get location for specific IP
  if (ip) {
    const location = await getLocationFromIp(ip);
    
    if (!location) {
      return res.status(404).json({ 
        error: 'Unable to fetch location for the specified IP' 
      });
    }
    
    // Store in memory
    storeLocation({
      ...location,
      source: 'ip-parameter',
      requestedIp: ip
    });
    
    return res.status(200).json({
      success: true,
      location,
      timestamp: new Date().toISOString()
    });
  }

  // Get recent locations
  if (recent === 'true') {
    const recentLocations = getRecentLocations(parseInt(limit));
    
    return res.status(200).json({
      success: true,
      count: recentLocations.length,
      locations: recentLocations,
      timestamp: new Date().toISOString()
    });
  }

  // Map view endpoint (returns HTML with map)
  if (map === 'true') {
    return getMapView(res);
  }

  // Default: Get location from requester's IP
  const clientIP = getClientIp(req);
  const location = await getLocationFromIp(clientIP);
  
  if (!location) {
    return res.status(500).json({ 
      error: 'Unable to fetch your location' 
    });
  }
  
  // Store in memory
  const storedLocation = storeLocation({
    ...location,
    source: 'auto-detect',
    clientIP,
    userAgent: req.headers['user-agent'] || 'unknown',
    method: 'GET'
  });
  
  // Different response formats
  if (format === 'simple') {
    return res.status(200).json({
      latitude: location.latitude,
      longitude: location.longitude,
      city: location.city,
      country: location.country
    });
  }
  
  if (format === 'geojson') {
    return res.status(200).json({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      },
      properties: {
        city: location.city,
        country: location.country,
        accuracy: location.accuracy,
        source: location.source,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  // Full response
  return res.status(200).json({
    success: true,
    location,
    clientIP,
    storedId: storedLocation.id,
    timestamp: new Date().toISOString(),
    mapUrl: `${req.headers.host}/api/location?map=true&lat=${location.latitude}&lng=${location.longitude}`
  });
}

// ==================== POST REQUEST HANDLER ====================

async function handlePost(req, res, params, body) {
  const { action } = params;

  // Submit device geolocation
  if (action === 'device' || !action) {
    return await handleDeviceGeolocation(res, body, req);
  }

  // Bulk location submission
  if (action === 'bulk') {
    return await handleBulkLocation(res, body, req);
  }

  // Admin actions (if needed)
  const adminSecret = process.env.LOCATION_ADMIN_SECRET;
  if (adminSecret && req.headers.authorization !== `Bearer ${adminSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (action === 'clear') {
    return await handleClearStorage(res);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// Handle device geolocation submission
async function handleDeviceGeolocation(res, body, req) {
  // Sanitize input data
  const sanitizedData = {
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy: body.accuracy,
    altitude: body.altitude,
    altitudeAccuracy: body.altitudeAccuracy,
    speed: body.speed,
    heading: body.heading,
    source: sanitizeInput(body.source || 'device-geolocation'),
    deviceInfo: body.deviceInfo || {},
    ip: body.ip || getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
    method: 'POST'
  };

  // Validate location data
  const validationErrors = validateLocationData(sanitizedData);
  if (validationErrors.length > 0) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: validationErrors 
    });
  }

  // Store location
  const storedLocation = storeLocation(sanitizedData);

  return res.status(200).json({
    success: true,
    message: 'Device location received successfully',
    location: storedLocation,
    mapUrl: `${req.headers.host}/api/location?map=true&lat=${storedLocation.latitude}&lng=${storedLocation.longitude}`
  });
}

// Handle bulk location submission
async function handleBulkLocation(res, body, req) {
  const { locations } = body;
  
  if (!Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({ 
      error: 'Array of locations required' 
    });
  }

  if (locations.length > 100) {
    return res.status(400).json({ 
      error: 'Maximum 100 locations per bulk request' 
    });
  }

  const storedLocations = [];
  const errors = [];

  for (const loc of locations) {
    try {
      const validationErrors = validateLocationData(loc);
      if (validationErrors.length === 0) {
        const storedLoc = storeLocation({
          ...loc,
          ip: loc.ip || getClientIp(req),
          userAgent: req.headers['user-agent'] || 'unknown',
          method: 'BULK_POST'
        });
        storedLocations.push(storedLoc.id);
      } else {
        errors.push({
          location: loc,
          errors: validationErrors
        });
      }
    } catch (error) {
      errors.push({
        location: loc,
        error: error.message
      });
    }
  }

  return res.status(200).json({
    success: true,
    storedCount: storedLocations.length,
    errorCount: errors.length,
    storedIds: storedLocations,
    errors: errors.length > 0 ? errors : undefined
  });
}

// Clear storage (admin only)
async function handleClearStorage(res) {
  const count = locationStorage.size;
  locationStorage.clear();
  
  return res.status(200).json({
    success: true,
    message: `Cleared ${count} locations from storage`
  });
}

// ==================== MAP VIEW FUNCTION ====================

function getMapView(res) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Location Map</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        #map { height: 100vh; width: 100%; }
        .controls {
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            display: flex;
            gap: 10px;
            align-items: center;
        }
        button {
            background: #0070f3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: 600;
        }
        button:hover { background: #0051cc; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .status {
            padding: 8px 12px;
            background: #f0f0f0;
            border-radius: 4px;
            min-width: 200px;
        }
        .info-panel {
            position: absolute;
            bottom: 20px;
            left: 20px;
            z-index: 1000;
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 300px;
        }
        .info-item { margin: 5px 0; }
        .label { font-weight: 600; color: #666; }
    </style>
</head>
<body>
    <div class="controls">
        <button onclick="getDeviceLocation()">📍 Get My Location</button>
        <button onclick="getIPLocation()">🌐 Get IP Location</button>
        <div class="status" id="status">Ready</div>
    </div>
    
    <div id="map"></div>
    
    <div class="info-panel" id="infoPanel" style="display: none;">
        <h3>Location Details</h3>
        <div class="info-item"><span class="label">Latitude:</span> <span id="infoLat">-</span></div>
        <div class="info-item"><span class="label">Longitude:</span> <span id="infoLng">-</span></div>
        <div class="info-item"><span class="label">Accuracy:</span> <span id="infoAccuracy">-</span> meters</div>
        <div class="info-item"><span class="label">City:</span> <span id="infoCity">-</span></div>
        <div class="info-item"><span class="label">Country:</span> <span id="infoCountry">-</span></div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        let map = null;
        let marker = null;
        
        // Initialize map
        function initMap(lat = 40.7128, lng = -74.0060) {
            if (!map) {
                map = L.map('map').setView([lat, lng], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors'
                }).addTo(map);
            }
            return map;
        }
        
        // Update location on map
        function updateLocation(lat, lng, accuracy = null, details = {}) {
            initMap(lat, lng);
            
            // Remove previous marker
            if (marker) map.removeLayer(marker);
            
            // Add new marker
            marker = L.marker([lat, lng]).addTo(map)
                .bindPopup(\`<b>Location:</b><br>Lat: \${lat.toFixed(6)}<br>Lng: \${lng.toFixed(6)}<br>City: \${details.city || 'Unknown'}\`);
            
            // Add accuracy circle if available
            if (accuracy && accuracy > 0) {
                L.circle([lat, lng], {
                    radius: accuracy,
                    color: '#0070f3',
                    fillOpacity: 0.2
                }).addTo(map);
            }
            
            // Update info panel
            updateInfoPanel(lat, lng, accuracy, details);
            
            // Center map
            const zoom = accuracy ? Math.max(13, Math.round(18 - Math.log2(accuracy/50))) : 13;
            map.setView([lat, lng], zoom);
        }
        
        // Update info panel
        function updateInfoPanel(lat, lng, accuracy, details) {
            document.getElementById('infoPanel').style.display = 'block';
            document.getElementById('infoLat').textContent = lat.toFixed(6);
            document.getElementById('infoLng').textContent = lng.toFixed(6);
            document.getElementById('infoAccuracy').textContent = accuracy ? accuracy.toFixed(0) : 'N/A';
            document.getElementById('infoCity').textContent = details.city || 'Unknown';
            document.getElementById('infoCountry').textContent = details.country || 'Unknown';
        }
        
        // Get device location using browser geolocation API
        async function getDeviceLocation() {
            document.getElementById('status').textContent = 'Requesting device location...';
            
            if (!navigator.geolocation) {
                document.getElementById('status').textContent = 'Geolocation not supported by browser';
                return;
            }
            
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    });
                });
                
                const { latitude, longitude, accuracy } = position.coords;
                
                // Update status and map
                document.getElementById('status').textContent = \`Device location: \${accuracy.toFixed(0)}m accuracy\`;
                updateLocation(latitude, longitude, accuracy, { source: 'Device GPS' });
                
                // Send to API
                const response = await fetch('/api/location', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        latitude,
                        longitude,
                        accuracy,
                        altitude: position.coords.altitude,
                        altitudeAccuracy: position.coords.altitudeAccuracy,
                        speed: position.coords.speed,
                        heading: position.coords.heading,
                        source: 'device-geolocation'
                    })
                });
                
                const data = await response.json();
                console.log('Location sent to API:', data);
                
            } catch (error) {
                document.getElementById('status').textContent = \`Error: \${error.message}\`;
                console.error('Geolocation error:', error);
            }
        }
        
        // Get location from IP via API
        async function getIPLocation() {
            document.getElementById('status').textContent = 'Getting IP location...';
            
            try {
                const response = await fetch('/api/location');
                const data = await response.json();
                
                if (data.success) {
                    const loc = data.location;
                    document.getElementById('status').textContent = \`IP location: \${loc.city || 'Unknown location'}\`;
                    
                    updateLocation(loc.latitude, loc.longitude, loc.accuracy, {
                        city: loc.city,
                        country: loc.country,
                        source: 'IP Geolocation'
                    });
                } else {
                    document.getElementById('status').textContent = 'Failed to get IP location';
                }
            } catch (error) {
                document.getElementById('status').textContent = \`Error: \${error.message}\`;
                console.error('API error:', error);
            }
        }
        
        // Check URL parameters for initial location
        function checkUrlParams() {
            const urlParams = new URLSearchParams(window.location.search);
            const lat = urlParams.get('lat');
            const lng = urlParams.get('lng');
            
            if (lat && lng) {
                updateLocation(parseFloat(lat), parseFloat(lng), null, { source: 'URL Parameter' });
                document.getElementById('status').textContent = 'Location from URL parameters';
            }
        }
        
        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            initMap();
            checkUrlParams();
        });
    </script>
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
}