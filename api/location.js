// api/location.js
import axios from 'axios';

// In-memory storage for location data
const locationStorage = new Map();

// Rate limiting storage
const rateLimitMap = new Map();

export default async function handler(req, res) {
  const { method, query: params, body } = req;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
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
    } else if (method === 'DELETE') {
      return await handleDelete(req, res, params);
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

  // Required fields validation
  if (!data.deviceName || data.deviceName.trim().length < 1) {
    errors.push('Device name is required');
  }

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

  // Validate timestamp if provided
  if (data.timestamp !== undefined) {
    const timestamp = parseInt(data.timestamp);
    if (isNaN(timestamp) || timestamp < 0) {
      errors.push('Invalid timestamp');
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

// Generate unique ID
function generateId() {
  return `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

// Store location
function storeLocation(data) {
  const id = generateId();
  const timestamp = data.timestamp || Date.now();
  
  const locationData = {
    id,
    deviceName: data.deviceName || 'Unknown Device',
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy || null,
    altitude: data.altitude || null,
    altitudeAccuracy: data.altitudeAccuracy || null,
    speed: data.speed || null,
    heading: data.heading || null,
    ip: data.ip || 'unknown',
    source: data.source || 'unknown',
    userAgent: data.userAgent || 'unknown',
    deviceInfo: data.deviceInfo || {},
    city: data.city || null,
    country: data.country || null,
    region: data.region || null,
    timestamp: timestamp,
    storedAt: new Date().toISOString(),
    formattedTime: new Date(timestamp).toLocaleString()
  };
  
  locationStorage.set(id, locationData);
  
  // Optional: Clean up old entries (keep last 1000)
  if (locationStorage.size > 1000) {
    const keys = Array.from(locationStorage.keys()).slice(0, 100);
    keys.forEach(key => locationStorage.delete(key));
  }
  
  return locationData;
}

// Get all locations grouped by device
function getAllLocations() {
  const locations = Array.from(locationStorage.values());
  
  // Group by device name
  const groupedByDevice = {};
  
  locations.forEach(location => {
    const deviceName = location.deviceName;
    if (!groupedByDevice[deviceName]) {
      groupedByDevice[deviceName] = {
        deviceName: deviceName,
        totalLocations: 0,
        firstSeen: null,
        lastSeen: null,
        locations: []
      };
    }
    
    groupedByDevice[deviceName].locations.push(location);
    groupedByDevice[deviceName].totalLocations++;
    
    // Update first and last seen
    if (!groupedByDevice[deviceName].firstSeen || location.timestamp < groupedByDevice[deviceName].firstSeen) {
      groupedByDevice[deviceName].firstSeen = location.timestamp;
    }
    if (!groupedByDevice[deviceName].lastSeen || location.timestamp > groupedByDevice[deviceName].lastSeen) {
      groupedByDevice[deviceName].lastSeen = location.timestamp;
    }
  });
  
  // Convert to array and sort by last seen (newest first)
  const devicesArray = Object.values(groupedByDevice);
  devicesArray.sort((a, b) => b.lastSeen - a.lastSeen);
  
  // Sort locations within each device by timestamp (newest first)
  devicesArray.forEach(device => {
    device.locations.sort((a, b) => b.timestamp - a.timestamp);
    device.firstSeenFormatted = new Date(device.firstSeen).toLocaleString();
    device.lastSeenFormatted = new Date(device.lastSeen).toLocaleString();
  });
  
  return {
    totalLocations: locations.length,
    totalDevices: devicesArray.length,
    devices: devicesArray,
    lastUpdated: new Date().toISOString()
  };
}

// Get locations for specific device
function getLocationsByDevice(deviceName) {
  const allLocations = getAllLocations();
  const device = allLocations.devices.find(d => d.deviceName === deviceName);
  
  return device || null;
}

// Get single location by ID
function getLocationById(id) {
  return locationStorage.get(id) || null;
}

// Delete location by ID
function deleteLocation(id) {
  return locationStorage.delete(id);
}

// Delete all locations for a device
function deleteDeviceLocations(deviceName) {
  const locationsToDelete = Array.from(locationStorage.entries())
    .filter(([_, location]) => location.deviceName === deviceName);
  
  locationsToDelete.forEach(([id, _]) => locationStorage.delete(id));
  
  return locationsToDelete.length;
}

// ==================== GET REQUEST HANDLER ====================

async function handleGet(req, res, params) {
  const { 
    view,
    device,
    id,
    ip, 
    format,
    limit,
    since
  } = params;

  // Dashboard view - shows all devices and locations
  if (view === 'dashboard') {
    return getDashboardView(res);
  }

  // Get specific location by ID
  if (id) {
    const location = getLocationById(id);
    
    if (!location) {
      return res.status(404).json({ 
        error: 'Location not found' 
      });
    }
    
    return res.status(200).json({
      success: true,
      location
    });
  }

  // Get locations for specific device
  if (device) {
    const deviceData = getLocationsByDevice(device);
    
    if (!deviceData) {
      return res.status(404).json({ 
        error: `No locations found for device: ${device}` 
      });
    }
    
    // Filter by timestamp if since parameter is provided
    if (since) {
      const sinceTimestamp = parseInt(since);
      if (!isNaN(sinceTimestamp)) {
        deviceData.locations = deviceData.locations.filter(
          loc => loc.timestamp >= sinceTimestamp
        );
      }
    }
    
    // Limit results if specified
    if (limit) {
      const limitNum = parseInt(limit);
      if (!isNaN(limitNum) && limitNum > 0) {
        deviceData.locations = deviceData.locations.slice(0, limitNum);
      }
    }
    
    return res.status(200).json({
      success: true,
      device: deviceData.deviceName,
      totalLocations: deviceData.totalLocations,
      firstSeen: deviceData.firstSeenFormatted,
      lastSeen: deviceData.lastSeenFormatted,
      locations: deviceData.locations
    });
  }

  // Get all locations grouped by device
  if (view === 'all' || !view) {
    const allData = getAllLocations();
    
    if (format === 'simple') {
      const simpleData = allData.devices.map(device => ({
        deviceName: device.deviceName,
        totalLocations: device.totalLocations,
        lastSeen: device.lastSeenFormatted,
        lastLocation: device.locations[0] ? {
          latitude: device.locations[0].latitude,
          longitude: device.locations[0].longitude,
          city: device.locations[0].city,
          timestamp: device.locations[0].formattedTime
        } : null
      }));
      
      return res.status(200).json({
        success: true,
        totalDevices: allData.totalDevices,
        totalLocations: allData.totalLocations,
        devices: simpleData
      });
    }
    
    return res.status(200).json({
      success: true,
      ...allData
    });
  }

  // Get location for specific IP
  if (ip) {
    const location = await getLocationFromIp(ip);
    
    if (!location) {
      return res.status(404).json({ 
        error: 'Unable to fetch location for the specified IP' 
      });
    }
    
    // Store with generic device name
    const storedLocation = storeLocation({
      ...location,
      deviceName: `IP_${ip}`,
      source: 'ip-lookup',
      ip: ip
    });
    
    return res.status(200).json({
      success: true,
      location: storedLocation,
      timestamp: new Date().toISOString()
    });
  }

  // Default: Get location from requester's IP
  const clientIP = getClientIp(req);
  const location = await getLocationFromIp(clientIP);
  
  if (!location) {
    return res.status(500).json({ 
      error: 'Unable to fetch your location' 
    });
  }
  
  // Store with device name based on IP
  const storedLocation = storeLocation({
    ...location,
    deviceName: `IP_${clientIP}`,
    source: 'auto-detect',
    clientIP,
    userAgent: req.headers['user-agent'] || 'unknown',
    method: 'GET'
  });
  
  return res.status(200).json({
    success: true,
    location: storedLocation,
    clientIP,
    storedId: storedLocation.id,
    timestamp: new Date().toISOString()
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

  return res.status(400).json({ error: 'Invalid action' });
}

// Handle device geolocation submission
async function handleDeviceGeolocation(res, body, req) {
  // Sanitize input data
  const sanitizedData = {
    deviceName: sanitizeInput(body.deviceName || `Device_${Date.now()}`),
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy: body.accuracy,
    altitude: body.altitude,
    altitudeAccuracy: body.altitudeAccuracy,
    speed: body.speed,
    heading: body.heading,
    timestamp: body.timestamp || Date.now(),
    source: sanitizeInput(body.source || 'device-geolocation'),
    deviceInfo: body.deviceInfo || {},
    ip: body.ip || getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
    method: 'POST',
    city: body.city,
    country: body.country,
    region: body.region
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
    dashboardUrl: `${req.headers.host}/api/location?view=dashboard`
  });
}

// Handle bulk location submission
async function handleBulkLocation(res, body, req) {
  const { locations, deviceName } = body;
  
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
      const deviceNameToUse = deviceName || loc.deviceName || `Device_${Date.now()}`;
      
      const validationErrors = validateLocationData({
        ...loc,
        deviceName: deviceNameToUse
      });
      
      if (validationErrors.length === 0) {
        const storedLoc = storeLocation({
          ...loc,
          deviceName: deviceNameToUse,
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

// ==================== DELETE REQUEST HANDLER ====================

async function handleDelete(req, res, params) {
  const { id, device, all } = params;
  
  // Admin check (optional)
  const adminSecret = process.env.LOCATION_ADMIN_SECRET;
  if (adminSecret && req.headers.authorization !== `Bearer ${adminSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Delete specific location
  if (id) {
    const deleted = deleteLocation(id);
    
    if (!deleted) {
      return res.status(404).json({ 
        error: 'Location not found' 
      });
    }
    
    return res.status(200).json({
      success: true,
      message: `Location ${id} deleted successfully`
    });
  }

  // Delete all locations for a device
  if (device) {
    const count = deleteDeviceLocations(device);
    
    return res.status(200).json({
      success: true,
      message: `Deleted ${count} locations for device: ${device}`
    });
  }

  // Delete all locations
  if (all === 'true') {
    const count = locationStorage.size;
    locationStorage.clear();
    
    return res.status(200).json({
      success: true,
      message: `Deleted all ${count} locations`
    });
  }

  return res.status(400).json({ 
    error: 'Specify id, device, or all=true to delete' 
  });
}

// ==================== DASHBOARD VIEW FUNCTION ====================

function getDashboardView(res) {
  const allData = getAllLocations();
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Location Tracker Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: white;
            padding: 25px;
            border-radius: 15px;
            margin-bottom: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        h1 {
            color: #333;
            font-size: 28px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        h1 i { color: #667eea; }
        .stats {
            display: flex;
            gap: 20px;
        }
        .stat-box {
            background: #f8f9fa;
            padding: 15px 25px;
            border-radius: 10px;
            text-align: center;
            min-width: 150px;
        }
        .stat-box h3 {
            color: #666;
            font-size: 14px;
            margin-bottom: 5px;
        }
        .stat-box .number {
            font-size: 32px;
            font-weight: bold;
            color: #333;
        }
        .devices-container {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .devices-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .devices-header h2 {
            color: #333;
            font-size: 22px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .search-box {
            padding: 10px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            width: 300px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        .search-box:focus {
            outline: none;
            border-color: #667eea;
        }
        .device-list {
            display: grid;
            gap: 15px;
        }
        .device-card {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            transition: all 0.3s;
            cursor: pointer;
            border: 2px solid transparent;
        }
        .device-card:hover {
            background: #eef2ff;
            border-color: #667eea;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.1);
        }
        .device-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .device-name {
            font-size: 20px;
            font-weight: bold;
            color: #333;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .device-name i {
            color: #667eea;
        }
        .device-meta {
            display: flex;
            gap: 15px;
            color: #666;
            font-size: 14px;
        }
        .device-locations {
            background: white;
            border-radius: 8px;
            padding: 15px;
            margin-top: 10px;
        }
        .location-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            border-bottom: 1px solid #f0f0f0;
        }
        .location-item:last-child {
            border-bottom: none;
        }
        .location-coords {
            font-family: monospace;
            background: #f0f0f0;
            padding: 5px 10px;
            border-radius: 5px;
        }
        .location-time {
            color: #666;
            font-size: 14px;
        }
        .no-devices {
            text-align: center;
            padding: 50px;
            color: #666;
            font-size: 18px;
        }
        .no-devices i {
            font-size: 48px;
            margin-bottom: 20px;
            color: #ccc;
        }
        .device-actions {
            display: flex;
            gap: 10px;
        }
        .btn {
            padding: 8px 15px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.3s;
        }
        .btn-view {
            background: #667eea;
            color: white;
        }
        .btn-view:hover {
            background: #5a6fd8;
        }
        .btn-map {
            background: #10b981;
            color: white;
        }
        .btn-map:hover {
            background: #0da271;
        }
        .btn-delete {
            background: #ef4444;
            color: white;
        }
        .btn-delete:hover {
            background: #dc2626;
        }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal-content {
            background: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 800px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .modal-header h2 {
            color: #333;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .close-modal {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        }
        .location-details {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .detail-item {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
        }
        .detail-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .detail-value {
            font-size: 16px;
            color: #333;
            font-weight: 500;
        }
        .map-container {
            height: 300px;
            width: 100%;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 20px;
        }
        .refresh-btn {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: white;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            transition: all 0.3s;
            font-size: 24px;
            color: #667eea;
        }
        .refresh-btn:hover {
            transform: rotate(90deg);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-map-marker-alt"></i> Location Tracker Dashboard</h1>
            <div class="stats">
                <div class="stat-box">
                    <h3>Total Devices</h3>
                    <div class="number">${allData.totalDevices}</div>
                </div>
                <div class="stat-box">
                    <h3>Total Locations</h3>
                    <div class="number">${allData.totalLocations}</div>
                </div>
                <div class="stat-box">
                    <h3>Last Updated</h3>
                    <div class="number" id="updateTime">Now</div>
                </div>
            </div>
        </div>
        
        <div class="devices-container">
            <div class="devices-header">
                <h2><i class="fas fa-mobile-alt"></i> Tracked Devices</h2>
                <input type="text" class="search-box" placeholder="Search devices..." id="searchInput">
            </div>
            
            <div class="device-list" id="deviceList">
                ${allData.totalDevices === 0 ? 
                    '<div class="no-devices"><i class="fas fa-map-marked-alt"></i><p>No devices tracked yet. Submit your first location!</p></div>' : 
                    allData.devices.map(device => `
                        <div class="device-card" data-device="${device.deviceName}">
                            <div class="device-header">
                                <div>
                                    <div class="device-name">
                                        <i class="fas fa-mobile-alt"></i>
                                        ${device.deviceName}
                                    </div>
                                    <div class="device-meta">
                                        <span><i class="fas fa-database"></i> ${device.totalLocations} locations</span>
                                        <span><i class="fas fa-clock"></i> First: ${device.firstSeenFormatted}</span>
                                        <span><i class="fas fa-history"></i> Last: ${device.lastSeenFormatted}</span>
                                    </div>
                                </div>
                                <div class="device-actions">
                                    <button class="btn btn-view" onclick="viewDevice('${device.deviceName}')">
                                        <i class="fas fa-eye"></i> View
                                    </button>
                                    <button class="btn btn-map" onclick="viewOnMap('${device.deviceName}')">
                                        <i class="fas fa-map"></i> Map
                                    </button>
                                </div>
                            </div>
                            ${device.locations.length > 0 ? `
                                <div class="device-locations">
                                    <div class="location-item">
                                        <div class="location-coords">
                                            ${device.locations[0].latitude.toFixed(6)}, ${device.locations[0].longitude.toFixed(6)}
                                        </div>
                                        <div class="location-time">
                                            ${device.locations[0].formattedTime}
                                        </div>
                                    </div>
                                    ${device.totalLocations > 1 ? 
                                        '<div style="text-align: center; padding: 10px; color: #666;">... and ' + (device.totalLocations - 1) + ' more locations</div>' : ''}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')
                }
            </div>
        </div>
    </div>
    
    <!-- Device Details Modal -->
    <div class="modal" id="deviceModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2><i class="fas fa-mobile-alt"></i> <span id="modalDeviceName"></span></h2>
                <button class="close-modal" onclick="closeModal()">&times;</button>
            </div>
            <div id="modalContent">
                <!-- Device details will be loaded here -->
            </div>
        </div>
    </div>
    
    <!-- Refresh Button -->
    <div class="refresh-btn" onclick="refreshData()">
        <i class="fas fa-redo"></i>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        let allDevices = ${JSON.stringify(allData.devices)};
        
        // Search functionality
        document.getElementById('searchInput').addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            const deviceCards = document.querySelectorAll('.device-card');
            
            deviceCards.forEach(card => {
                const deviceName = card.getAttribute('data-device').toLowerCase();
                if (deviceName.includes(searchTerm)) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        });
        
        // View device details
        async function viewDevice(deviceName) {
            try {
                const response = await fetch(\`/api/location?device=\${encodeURIComponent(deviceName)}\`);
                const data = await response.json();
                
                if (data.success) {
                    const device = data;
                    const modalContent = document.getElementById('modalContent');
                    const modal = document.getElementById('deviceModal');
                    
                    document.getElementById('modalDeviceName').textContent = deviceName;
                    
                    // Generate device details HTML
                    modalContent.innerHTML = \`
                        <div class="location-details">
                            <div class="detail-item">
                                <div class="detail-label">Total Locations</div>
                                <div class="detail-value">\${device.totalLocations}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">First Seen</div>
                                <div class="detail-value">\${device.firstSeen}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Last Seen</div>
                                <div class="detail-value">\${device.lastSeen}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Current Location</div>
                                <div class="detail-value">
                                    \${device.locations[0] ? 
                                        device.locations[0].latitude.toFixed(6) + ', ' + device.locations[0].longitude.toFixed(6) : 
                                        'Unknown'}
                                </div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Last City</div>
                                <div class="detail-value">
                                    \${device.locations[0]?.city || 'Unknown'}
                                </div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Last Country</div>
                                <div class="detail-value">
                                    \${device.locations[0]?.country || 'Unknown'}
                                </div>
                            </div>
                        </div>
                        
                        <h3 style="margin: 20px 0 10px 0; color: #333;">Recent Locations</h3>
                        <div style="max-height: 300px; overflow-y: auto;">
                            \${device.locations.map(loc => \`
                                <div class="location-item" style="border: 1px solid #f0f0f0; margin: 5px 0; padding: 10px; border-radius: 5px;">
                                    <div>
                                        <strong>\${loc.latitude.toFixed(6)}, \${loc.longitude.toFixed(6)}</strong>
                                        <div style="font-size: 12px; color: #666;">
                                            Accuracy: \${loc.accuracy ? loc.accuracy.toFixed(0) + 'm' : 'N/A'} | 
                                            Speed: \${loc.speed ? loc.speed.toFixed(1) + 'm/s' : 'N/A'} |
                                            Altitude: \${loc.altitude ? loc.altitude.toFixed(0) + 'm' : 'N/A'}
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="color: #666; font-size: 12px;">\${loc.formattedTime}</div>
                                        <div style="font-size: 12px; color: #999;">
                                            \${loc.city ? loc.city + ', ' : ''}\${loc.country || ''}
                                        </div>
                                    </div>
                                </div>
                            \`).join('')}
                        </div>
                        
                        <div class="map-container" id="deviceMap"></div>
                    \`;
                    
                    // Initialize map for device
                    if (device.locations.length > 0 && device.locations[0].latitude && device.locations[0].longitude) {
                        setTimeout(() => {
                            const map = L.map('deviceMap').setView(
                                [device.locations[0].latitude, device.locations[0].longitude], 
                                13
                            );
                            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                                attribution: '© OpenStreetMap contributors'
                            }).addTo(map);
                            
                            // Add markers for all locations
                            device.locations.forEach(loc => {
                                L.marker([loc.latitude, loc.longitude])
                                    .addTo(map)
                                    .bindPopup(\`
                                        <b>\${loc.formattedTime}</b><br>
                                        Lat: \${loc.latitude.toFixed(6)}<br>
                                        Lng: \${loc.longitude.toFixed(6)}<br>
                                        \${loc.city ? 'City: ' + loc.city + '<br>' : ''}
                                        \${loc.accuracy ? 'Accuracy: ' + loc.accuracy.toFixed(0) + 'm' : ''}
                                    \`);
                            });
                        }, 100);
                    }
                    
                    modal.style.display = 'flex';
                }
            } catch (error) {
                console.error('Error loading device:', error);
                alert('Failed to load device details');
            }
        }
        
        // View device on map
        function viewOnMap(deviceName) {
            const device = allDevices.find(d => d.deviceName === deviceName);
            if (device && device.locations.length > 0) {
                const lat = device.locations[0].latitude;
                const lng = device.locations[0].longitude;
                window.open(\`/api/location?map=true&lat=\${lat}&lng=\${lng}\`, '_blank');
            }
        }
        
        // Close modal
        function closeModal() {
            document.getElementById('deviceModal').style.display = 'none';
        }
        
        // Refresh data
        async function refreshData() {
            document.querySelector('.refresh-btn').style.transform = 'rotate(180deg)';
            
            try {
                const response = await fetch('/api/location?view=all');
                const data = await response.json();
                
                if (data.success) {
                    allDevices = data.devices;
                    location.reload();
                }
            } catch (error) {
                console.error('Refresh failed:', error);
                document.querySelector('.refresh-btn').style.transform = 'rotate(0)';
            }
        }
        
        // Auto-refresh every 30 seconds
        setInterval(refreshData, 30000);
        
        // Update time display
        function updateTime() {
            const now = new Date();
            document.getElementById('updateTime').textContent = 
                now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
        setInterval(updateTime, 60000);
        updateTime();
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('deviceModal');
            if (event.target === modal) {
                closeModal();
            }
        };
    </script>
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
}