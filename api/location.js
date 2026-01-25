// api/location.js
import axios from 'axios';

// In-memory storage for location data
const locationStorage = new Map();

// Rate limiting storage
const rateLimitMap = new Map();

// User agent parser (simplified)
function parseUserAgent(userAgent) {
  if (!userAgent) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };
  
  const ua = userAgent.toLowerCase();
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Unknown';
  
  // Browser detection
  if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('edge')) browser = 'Edge';
  else if (ua.includes('opera')) browser = 'Opera';
  
  // OS detection
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  
  // Device detection
  if (ua.includes('mobile')) device = 'Mobile';
  else if (ua.includes('tablet')) device = 'Tablet';
  else if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) device = 'Bot';
  else device = 'Desktop';
  
  // Check for bots/crawlers
  const bots = ['bot', 'crawler', 'spider', 'scraper', 'curl', 'wget', 'python', 'java', 'php'];
  if (bots.some(bot => ua.includes(bot))) {
    device = 'Bot/Crawler';
  }
  
  return { browser, os, device };
}

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

// Get all possible headers for device fingerprinting
function collectHeaders(req) {
  const headers = {};
  const interestingHeaders = [
    'user-agent',
    'accept-language',
    'accept-encoding',
    'accept',
    'connection',
    'host',
    'referer',
    'origin',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'dnt',
    'upgrade-insecure-requests'
  ];
  
  interestingHeaders.forEach(header => {
    const value = req.headers[header];
    if (value) {
      headers[header] = value;
    }
  });
  
  return headers;
}

// Generate unique ID
function generateId() {
  return `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Generate device fingerprint
function generateDeviceFingerprint(req) {
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const headers = collectHeaders(req);
  
  // Create a simple fingerprint hash
  const fingerprintString = `${ip}|${userAgent}|${acceptLanguage}`;
  const fingerprint = Buffer.from(fingerprintString).toString('base64').substring(0, 32);
  
  return {
    fingerprint,
    ip,
    userAgent,
    acceptLanguage,
    headers
  };
}

// Get location from IP using multiple free APIs
async function getLocationFromIp(ip) {
  // Handle local IPs
  if (ip === 'unknown' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
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

// Store location with automatic device detection
function storeLocation(data) {
  const id = generateId();
  const timestamp = data.timestamp || Date.now();
  const userAgent = data.userAgent || 'unknown';
  const deviceInfo = parseUserAgent(userAgent);
  
  const locationData = {
    id,
    deviceName: data.deviceName || 'Anonymous-Visitor',
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy || null,
    altitude: data.altitude || null,
    altitudeAccuracy: data.altitudeAccuracy || null,
    speed: data.speed || null,
    heading: data.heading || null,
    ip: data.ip || 'unknown',
    source: data.source || 'unknown',
    userAgent: userAgent,
    deviceInfo: {
      ...deviceInfo,
      ...(data.deviceInfo || {})
    },
    city: data.city || null,
    country: data.country || null,
    region: data.region || null,
    isp: data.isp || null,
    fingerprint: data.fingerprint || null,
    headers: data.headers || {},
    timestamp: timestamp,
    storedAt: new Date().toISOString(),
    formattedTime: new Date(timestamp).toLocaleString(),
    method: data.method || 'GET'
  };
  
  locationStorage.set(id, locationData);
  
  // Optional: Clean up old entries (keep last 5000)
  if (locationStorage.size > 5000) {
    const keys = Array.from(locationStorage.keys()).slice(0, 1000);
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
        locations: [],
        deviceInfo: location.deviceInfo,
        fingerprint: location.fingerprint
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
    
    // Get most common location
    const locationCounts = {};
    device.locations.forEach(loc => {
      const key = `${loc.latitude?.toFixed(4)}|${loc.longitude?.toFixed(4)}`;
      locationCounts[key] = (locationCounts[key] || 0) + 1;
    });
    
    const mostCommonKey = Object.keys(locationCounts).reduce((a, b) => 
      locationCounts[a] > locationCounts[b] ? a : b
    );
    device.mostCommonLocation = mostCommonKey.split('|').map(Number);
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
    since,
    fingerprint,
    analytics
  } = params;

  // Dashboard view - shows all devices and locations
  if (view === 'dashboard') {
    return getDashboardView(res);
  }

  // Analytics view
  if (view === 'analytics') {
    return getAnalyticsView(res);
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
      deviceInfo: deviceData.deviceInfo,
      fingerprint: deviceData.fingerprint,
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
        deviceInfo: device.deviceInfo,
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
    
    // Analytics data
    if (analytics === 'true') {
      const analyticsData = {
        uniqueDevices: allData.totalDevices,
        totalRequests: allData.totalLocations,
        byBrowser: {},
        byOS: {},
        byDeviceType: {},
        byCountry: {},
        requestsByHour: {},
        topIPs: {}
      };
      
      allData.devices.forEach(device => {
        device.locations.forEach(loc => {
          // Browser stats
          const browser = loc.deviceInfo?.browser || 'Unknown';
          analyticsData.byBrowser[browser] = (analyticsData.byBrowser[browser] || 0) + 1;
          
          // OS stats
          const os = loc.deviceInfo?.os || 'Unknown';
          analyticsData.byOS[os] = (analyticsData.byOS[os] || 0) + 1;
          
          // Device type stats
          const deviceType = loc.deviceInfo?.device || 'Unknown';
          analyticsData.byDeviceType[deviceType] = (analyticsData.byDeviceType[deviceType] || 0) + 1;
          
          // Country stats
          const country = loc.country || 'Unknown';
          analyticsData.byCountry[country] = (analyticsData.byCountry[country] || 0) + 1;
          
          // Hourly stats
          const hour = new Date(loc.timestamp).getHours();
          analyticsData.requestsByHour[hour] = (analyticsData.requestsByHour[hour] || 0) + 1;
          
          // IP stats
          if (loc.ip && loc.ip !== 'unknown') {
            analyticsData.topIPs[loc.ip] = (analyticsData.topIPs[loc.ip] || 0) + 1;
          }
        });
      });
      
      // Sort top IPs
      analyticsData.topIPs = Object.entries(analyticsData.topIPs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reduce((obj, [ip, count]) => ({...obj, [ip]: count}), {});
      
      return res.status(200).json({
        success: true,
        analytics: analyticsData,
        timestamp: new Date().toISOString()
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
    const fingerprintData = generateDeviceFingerprint(req);
    const storedLocation = storeLocation({
      ...location,
      deviceName: `IP-Lookup-${ip.substring(0, 8)}`,
      source: 'ip-lookup',
      ip: ip,
      ...fingerprintData,
      method: 'GET-IP'
    });
    
    return res.status(200).json({
      success: true,
      location: storedLocation,
      timestamp: new Date().toISOString()
    });
  }

  // Get locations by fingerprint
  if (fingerprint) {
    const locations = Array.from(locationStorage.values())
      .filter(loc => loc.fingerprint === fingerprint)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    return res.status(200).json({
      success: true,
      count: locations.length,
      fingerprint: fingerprint,
      locations: locations
    });
  }

  // DEFAULT: Regular API call - collect visitor information automatically
  return await handleRegularApiCall(req, res);
}

// Handle regular API call (no special parameters)
async function handleRegularApiCall(req, res) {
  const clientIP = getClientIp(req);
  const fingerprintData = generateDeviceFingerprint(req);
  const userAgentInfo = parseUserAgent(fingerprintData.userAgent);
  
  // Generate device name based on fingerprint
  const deviceName = `Visitor-${fingerprintData.fingerprint.substring(0, 8)}`;
  
  // Try to get location from IP
  const ipLocation = await getLocationFromIp(clientIP);
  
  // Store visitor information
  const storedLocation = storeLocation({
    deviceName: deviceName,
    latitude: ipLocation?.latitude || null,
    longitude: ipLocation?.longitude || null,
    city: ipLocation?.city || null,
    country: ipLocation?.country || null,
    region: ipLocation?.region || null,
    isp: ipLocation?.isp || null,
    ip: clientIP,
    source: 'auto-track',
    ...fingerprintData,
    deviceInfo: userAgentInfo,
    method: 'GET-AUTO'
  });
  
  // Return visitor information
  return res.status(200).json({
    success: true,
    message: 'Visitor information collected successfully',
    visitor: {
      id: storedLocation.id,
      deviceName: storedLocation.deviceName,
      ip: clientIP,
      location: ipLocation ? {
        city: ipLocation.city,
        region: ipLocation.region,
        country: ipLocation.country,
        coordinates: ipLocation.latitude && ipLocation.longitude ? {
          latitude: ipLocation.latitude,
          longitude: ipLocation.longitude
        } : null
      } : null,
      deviceInfo: userAgentInfo,
      fingerprint: fingerprintData.fingerprint,
      timestamp: new Date().toISOString()
    },
    dashboardUrl: `${req.headers.host}/api/location?view=dashboard`,
    yourDataUrl: `${req.headers.host}/api/location?fingerprint=${fingerprintData.fingerprint}`
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
  const fingerprintData = generateDeviceFingerprint(req);
  const userAgentInfo = parseUserAgent(fingerprintData.userAgent);
  
  const sanitizedData = {
    deviceName: sanitizeInput(body.deviceName || `Device-${fingerprintData.fingerprint.substring(0, 8)}`),
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy: body.accuracy,
    altitude: body.altitude,
    altitudeAccuracy: body.altitudeAccuracy,
    speed: body.speed,
    heading: body.heading,
    timestamp: body.timestamp || Date.now(),
    source: sanitizeInput(body.source || 'device-geolocation'),
    deviceInfo: {
      ...userAgentInfo,
      ...(body.deviceInfo || {})
    },
    ip: body.ip || getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
    method: 'POST',
    city: body.city,
    country: body.country,
    region: body.region,
    ...fingerprintData
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
    dashboardUrl: `${req.headers.host}/api/location?view=dashboard`,
    yourDataUrl: `${req.headers.host}/api/location?fingerprint=${fingerprintData.fingerprint}`
  });
}

// Handle bulk location submission
async function handleBulkLocation(res, body, req) {
  const { locations, deviceName } = body;
  const fingerprintData = generateDeviceFingerprint(req);
  
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
      const deviceNameToUse = deviceName || loc.deviceName || `Device-${fingerprintData.fingerprint.substring(0, 8)}`;
      
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
          method: 'BULK_POST',
          ...fingerprintData
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
    fingerprint: fingerprintData.fingerprint,
    yourDataUrl: `${req.headers.host}/api/location?fingerprint=${fingerprintData.fingerprint}`,
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
  
  // Calculate analytics
  const analytics = {
    byBrowser: {},
    byOS: {},
    byDeviceType: {},
    byCountry: {},
    requestsByHour: Array(24).fill(0),
    topVisitors: []
  };
  
  allData.devices.forEach(device => {
    device.locations.forEach(loc => {
      const browser = loc.deviceInfo?.browser || 'Unknown';
      analytics.byBrowser[browser] = (analytics.byBrowser[browser] || 0) + 1;
      
      const os = loc.deviceInfo?.os || 'Unknown';
      analytics.byOS[os] = (analytics.byOS[os] || 0) + 1;
      
      const deviceType = loc.deviceInfo?.device || 'Unknown';
      analytics.byDeviceType[deviceType] = (analytics.byDeviceType[deviceType] || 0) + 1;
      
      const country = loc.country || 'Unknown';
      analytics.byCountry[country] = (analytics.byCountry[country] || 0) + 1;
      
      const hour = new Date(loc.timestamp).getHours();
      analytics.requestsByHour[hour]++;
    });
    
    analytics.topVisitors.push({
      deviceName: device.deviceName,
      totalLocations: device.totalLocations,
      deviceInfo: device.deviceInfo,
      lastSeen: device.lastSeenFormatted
    });
  });
  
  analytics.topVisitors.sort((a, b) => b.totalLocations - a.totalLocations).slice(0, 10);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Location Tracker Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
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
            transition: transform 0.3s;
        }
        .stat-box:hover {
            transform: translateY(-2px);
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
        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        .card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .card-header h2 {
            color: #333;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .device-list {
            max-height: 400px;
            overflow-y: auto;
        }
        .device-card {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 10px;
            transition: all 0.3s;
            cursor: pointer;
            border: 2px solid transparent;
        }
        .device-card:hover {
            background: #eef2ff;
            border-color: #667eea;
        }
        .device-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .device-name {
            font-size: 16px;
            font-weight: bold;
            color: #333;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .device-info {
            display: flex;
            gap: 15px;
            font-size: 12px;
            color: #666;
        }
        .device-location {
            font-family: monospace;
            background: #e9ecef;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        .chart-container {
            height: 250px;
            margin-top: 15px;
        }
        .analytics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
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
            z-index: 1000;
        }
        .refresh-btn:hover {
            transform: rotate(90deg);
        }
        .tab-container {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        .tab {
            background: white;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            color: #666;
            transition: all 0.3s;
        }
        .tab.active {
            background: #667eea;
            color: white;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .visitor-info {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        .visitor-icon {
            width: 40px;
            height: 40px;
            background: #667eea;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 18px;
        }
        .api-info {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            margin-top: 20px;
        }
        .code {
            background: #2d3748;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 14px;
            overflow-x: auto;
            margin: 10px 0;
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
        
        <div class="tab-container">
            <div class="tab active" onclick="switchTab('devices')">Devices</div>
            <div class="tab" onclick="switchTab('analytics')">Analytics</div>
            <div class="tab" onclick="switchTab('api')">API Usage</div>
        </div>
        
        <div class="tab-content active" id="devicesTab">
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-mobile-alt"></i> Tracked Devices</h2>
                    <input type="text" placeholder="Search devices..." id="searchInput" 
                           style="padding: 8px 15px; border: 2px solid #e0e0e0; border-radius: 8px; width: 300px;">
                </div>
                <div class="device-list" id="deviceList">
                    ${allData.totalDevices === 0 ? 
                        '<div style="text-align: center; padding: 40px; color: #666;">No devices tracked yet. Call the API to get started!</div>' : 
                        allData.devices.map(device => `
                            <div class="device-card" data-device="${device.deviceName}">
                                <div class="device-header">
                                    <div class="device-name">
                                        <i class="fas fa-${device.deviceInfo?.device === 'Mobile' ? 'mobile-alt' : 
                                                         device.deviceInfo?.device === 'Desktop' ? 'desktop' : 
                                                         device.deviceInfo?.device === 'Tablet' ? 'tablet-alt' : 
                                                         'question-circle'}"></i>
                                        ${device.deviceName}
                                    </div>
                                    <span style="font-size: 12px; color: #666;">${device.totalLocations} locations</span>
                                </div>
                                <div class="device-info">
                                    <span><i class="fas fa-globe"></i> ${device.deviceInfo?.os || 'Unknown OS'}</span>
                                    <span><i class="fas fa-compass"></i> ${device.deviceInfo?.browser || 'Unknown Browser'}</span>
                                    <span><i class="fas fa-clock"></i> Last: ${device.lastSeenFormatted}</span>
                                </div>
                                ${device.locations[0]?.latitude ? `
                                    <div style="margin-top: 10px;">
                                        <div class="device-location">
                                            ${device.locations[0].latitude.toFixed(6)}, ${device.locations[0].longitude.toFixed(6)}
                                        </div>
                                        ${device.locations[0].city ? 
                                            `<div style="font-size: 12px; color: #666; margin-top: 5px;">
                                                <i class="fas fa-map-pin"></i> ${device.locations[0].city}, ${device.locations[0].country}
                                            </div>` : ''}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')
                    }
                </div>
            </div>
        </div>
        
        <div class="tab-content" id="analyticsTab">
            <div class="analytics-grid">
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-chart-pie"></i> Browser Usage</h2>
                    </div>
                    <div class="chart-container">
                        <canvas id="browserChart"></canvas>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-chart-bar"></i> OS Distribution</h2>
                    </div>
                    <div class="chart-container">
                        <canvas id="osChart"></canvas>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-chart-line"></i> Requests by Hour</h2>
                    </div>
                    <div class="chart-container">
                        <canvas id="hourlyChart"></canvas>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-users"></i> Top Visitors</h2>
                    </div>
                    <div style="max-height: 250px; overflow-y: auto;">
                        ${analytics.topVisitors.slice(0, 5).map(visitor => `
                            <div class="visitor-info">
                                <div class="visitor-icon">
                                    <i class="fas fa-user"></i>
                                </div>
                                <div>
                                    <div style="font-weight: bold;">${visitor.deviceName}</div>
                                    <div style="font-size: 12px; color: #666;">
                                        ${visitor.deviceInfo?.browser} on ${visitor.deviceInfo?.os}
                                    </div>
                                    <div style="font-size: 11px; color: #999;">
                                        ${visitor.totalLocations} requests • Last: ${visitor.lastSeen}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        
        <div class="tab-content" id="apiTab">
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-code"></i> API Usage Guide</h2>
                </div>
                <div class="api-info">
                    <h3>Basic Usage:</h3>
                    <p>Simply call the API endpoint to automatically track visitor information:</p>
                    <div class="code">
                        // Basic GET request - auto-collects visitor data<br>
                        fetch('/api/location')<br>
                          .then(response => response.json())<br>
                          .then(data => console.log(data));
                    </div>
                    
                    <h3>Submit Device Location:</h3>
                    <div class="code">
                        fetch('/api/location', {<br>
                          method: 'POST',<br>
                          headers: { 'Content-Type': 'application/json' },<br>
                          body: JSON.stringify({<br>
                            deviceName: 'My-Device',<br>
                            latitude: 40.7128,<br>
                            longitude: -74.0060,<br>
                            accuracy: 25<br>
                          })<br>
                        })
                    </div>
                    
                    <h3>Get Your Data:</h3>
                    <div class="code">
                        // Your data is automatically tracked with a fingerprint<br>
                        // Check the response for your fingerprint URL<br>
                        // Example: /api/location?fingerprint=YOUR_UNIQUE_FINGERPRINT
                    </div>
                    
                    <h3>View All Data:</h3>
                    <div class="code">
                        // Get all devices and locations<br>
                        fetch('/api/location?view=all')<br>
                        <br>
                        // View analytics<br>
                        fetch('/api/location?view=all&analytics=true')
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Refresh Button -->
    <div class="refresh-btn" onclick="refreshData()">
        <i class="fas fa-redo"></i>
    </div>

    <script>
        const analyticsData = ${JSON.stringify(analytics)};
        let allDevices = ${JSON.stringify(allData.devices)};
        
        // Tab switching
        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            document.querySelector(`.tab[onclick="switchTab('${tabName}')"]`).classList.add('active');
            document.getElementById(`${tabName}Tab`).classList.add('active');
            
            if (tabName === 'analytics') {
                renderCharts();
            }
        }
        
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
        
        // Render charts
        function renderCharts() {
            // Browser chart
            const browserCtx = document.getElementById('browserChart').getContext('2d');
            new Chart(browserCtx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(analyticsData.byBrowser),
                    datasets: [{
                        data: Object.values(analyticsData.byBrowser),
                        backgroundColor: ['#667eea', '#764ba2', '#f56565', '#ed8936', '#ecc94b', '#48bb78']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
            
            // OS chart
            const osCtx = document.getElementById('osChart').getContext('2d');
            new Chart(osCtx, {
                type: 'bar',
                data: {
                    labels: Object.keys(analyticsData.byOS),
                    datasets: [{
                        label: 'Requests',
                        data: Object.values(analyticsData.byOS),
                        backgroundColor: '#667eea'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
            
            // Hourly chart
            const hourlyCtx = document.getElementById('hourlyChart').getContext('2d');
            new Chart(hourlyCtx, {
                type: 'line',
                data: {
                    labels: Array.from({length: 24}, (_, i) => `${i}:00`),
                    datasets: [{
                        label: 'Requests',
                        data: analyticsData.requestsByHour,
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
        }
        
        // Refresh data
        async function refreshData() {
            document.querySelector('.refresh-btn').style.transform = 'rotate(180deg)';
            
            try {
                const response = await fetch('/api/location?view=all');
                const data = await response.json();
                
                if (data.success) {
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
        
        // Initialize charts if on analytics tab
        if (window.location.hash === '#analytics') {
            setTimeout(renderCharts, 100);
        }
    </script>
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
}

// Analytics view
function getAnalyticsView(res) {
  const allData = getAllLocations();
  
  // Calculate detailed analytics
  const analytics = {
    summary: {
      totalDevices: allData.totalDevices,
      totalLocations: allData.totalLocations,
      dateRange: {
        start: allData.devices.length > 0 ? 
          new Date(Math.min(...allData.devices.map(d => d.firstSeen))).toISOString() : null,
        end: allData.devices.length > 0 ?
          new Date(Math.max(...allData.devices.map(d => d.lastSeen))).toISOString() : null
      }
    },
    devices: allData.devices.map(device => ({
      name: device.deviceName,
      totalLocations: device.totalLocations,
      deviceInfo: device.deviceInfo,
      firstSeen: device.firstSeenFormatted,
      lastSeen: device.lastSeenFormatted,
      fingerprint: device.fingerprint
    }))
  };
  
  res.status(200).json({
    success: true,
    analytics: analytics,
    timestamp: new Date().toISOString()
  });
}