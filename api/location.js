// api/location.js
import axios from 'axios';
import { db } from "../utils/firebase.js";
import { v4 as uuidv4 } from 'uuid';

// ==================== CONFIGURATION ====================
const CONFIG = {
  // Rate limiting configuration
  RATE_LIMIT_MAX_REQUESTS: 100,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  
  // Geolocation API fallback order
  GEOLOCATION_APIS: [
    `https://ipapi.co/{ip}/json/`,
    `https://geolocation-db.com/json/{ip}`
  ],
  
  // Security
  ADMIN_SECRET: process.env.LOCATION_ADMIN_SECRET || 'dev-secret-change-me',
  CORS_ALLOW_HEADERS: 'Content-Type, Authorization, X-API-Key',
  
  // Firebase storage limits
  MAX_RETURNED_LOCATIONS: 1000
};

// ==================== RATE LIMITING IN MEMORY ====================
// Rate limiting still in memory since it's short-lived
const rateLimitStorage = new Map();

// ==================== HELPER FUNCTIONS ====================

// Get client IP safely
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         req.ip || 
         'unknown';
}

// Get rate limit key
function getRateLimitKey(req) {
  const clientIP = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'no-ua';
  
  if (clientIP === 'unknown' || clientIP === '127.0.0.1') {
    return `local_${userAgent}_${Date.now() % 10000}`;
  }
  
  return clientIP;
}

// Rate limiting
function checkRateLimit(req) {
  const rateKey = getRateLimitKey(req);
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;

  if (!rateLimitStorage.has(rateKey)) {
    rateLimitStorage.set(rateKey, [now]);
    return true;
  }

  const requests = rateLimitStorage.get(rateKey).filter(time => time > windowStart);
  rateLimitStorage.set(rateKey, [...requests, now]);

  if (requests.length === 0) {
    rateLimitStorage.delete(rateKey);
  }

  return requests.length < CONFIG.RATE_LIMIT_MAX_REQUESTS;
}

// Input sanitization for display only
function sanitizeForDisplay(input) {
  if (typeof input !== 'string') return input;
  return input.trim()
    .replace(/[<>]/g, '')
    .substring(0, 500);
}

// Enhanced device fingerprinting
function generateDeviceFingerprint(req) {
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const secCHUA = req.headers['sec-ch-ua'] || '';
  const secCHUAPlatform = req.headers['sec-ch-ua-platform'] || '';
  
  const fingerprintString = [
    ip,
    userAgent,
    acceptLanguage,
    secCHUA,
    secCHUAPlatform,
    req.headers['accept'] || '',
    req.headers['connection'] || '',
    Date.now().toString().slice(-6)
  ].join('|');
  
  let hash = 0;
  for (let i = 0; i < fingerprintString.length; i++) {
    hash = ((hash << 5) - hash) + fingerprintString.charCodeAt(i);
    hash = hash & hash;
  }
  
  const fingerprint = `fp_${Math.abs(hash).toString(16)}_${Date.now().toString(36)}`;
  
  return {
    fingerprint,
    ip,
    userAgent,
    acceptLanguage,
    headers: {
      'sec-ch-ua': secCHUA,
      'sec-ch-ua-platform': secCHUAPlatform
    }
  };
}

// User agent parser
function parseUserAgent(userAgent) {
  if (!userAgent) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };
  
  const ua = userAgent.toLowerCase();
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Unknown';
  
  if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('edge')) browser = 'Edge';
  else if (ua.includes('opera')) browser = 'Opera';
  
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  
  if (ua.includes('mobile')) device = 'Mobile';
  else if (ua.includes('tablet')) device = 'Tablet';
  else if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) device = 'Bot';
  else device = 'Desktop';
  
  return { browser, os, device };
}

// Get location from IP with fallback APIs
async function getLocationFromIp(ip) {
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

  for (const apiTemplate of CONFIG.GEOLOCATION_APIS) {
    const apiUrl = apiTemplate.replace('{ip}', ip);
    
    try {
      const response = await axios.get(apiUrl, { 
        timeout: 5000,
        headers: {
          'User-Agent': 'LocationTrackerAPI/1.0'
        }
      });
      
      const data = response.data;
      
      if (apiUrl.includes('ipapi.co')) {
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
      
      if (apiUrl.includes('geolocation-db.com')) {
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
      console.log(`Geolocation API failed (${apiUrl}):`, error.message);
      continue;
    }
  }
  
  return null;
}

// ==================== FIREBASE FUNCTIONS ====================

// Store location in Firebase
async function storeLocation(data) {
  const locationId = uuidv4();
  const timestamp = data.timestamp || Date.now();
  const userAgent = data.userAgent || 'unknown';
  const deviceInfo = parseUserAgent(userAgent);
  
  const locationData = {
    location_id: locationId,
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
    userAgent,
    deviceInfo: {
      ...deviceInfo,
      ...(data.deviceInfo || {})
    },
    city: data.city || null,
    country: data.country || null,
    region: data.region || null,
    isp: data.isp || null,
    fingerprint: data.fingerprint || null,
    timestamp,
    created_at: new Date().toISOString(),
    method: data.method || 'GET'
  };
  
  await db.ref(`locations/${locationId}`).set(locationData);
  
  return locationData;
}

// Get location by ID from Firebase
async function getLocationById(id) {
  const snapshot = await db.ref(`locations/${id}`).once('value');
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return null;
}

// Get all locations with analytics from Firebase
async function getAllLocations() {
  const snapshot = await db.ref('locations').orderByChild('timestamp').limitToLast(CONFIG.MAX_RETURNED_LOCATIONS).once('value');
  
  if (!snapshot.exists()) {
    return {
      totalLocations: 0,
      totalDevices: 0,
      devices: [],
      analytics: {
        byBrowser: {},
        byOS: {},
        byDeviceType: {},
        byCountry: {},
        requestsByHour: Array(24).fill(0),
        topVisitors: []
      },
      lastUpdated: new Date().toISOString()
    };
  }
  
  const locationsObj = snapshot.val();
  const locations = Object.values(locationsObj);
  
  // Group by device name
  const groupedByDevice = {};
  
  locations.forEach(location => {
    const deviceName = location.deviceName;
    if (!groupedByDevice[deviceName]) {
      groupedByDevice[deviceName] = {
        deviceName,
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
    
    if (!groupedByDevice[deviceName].firstSeen || location.timestamp < groupedByDevice[deviceName].firstSeen) {
      groupedByDevice[deviceName].firstSeen = location.timestamp;
    }
    if (!groupedByDevice[deviceName].lastSeen || location.timestamp > groupedByDevice[deviceName].lastSeen) {
      groupedByDevice[deviceName].lastSeen = location.timestamp;
    }
  });
  
  // Convert to array and sort
  const devicesArray = Object.values(groupedByDevice);
  devicesArray.sort((a, b) => b.lastSeen - a.firstSeen);
  
  devicesArray.forEach(device => {
    device.locations.sort((a, b) => b.timestamp - a.timestamp);
    device.firstSeenFormatted = new Date(device.firstSeen).toLocaleString();
    device.lastSeenFormatted = new Date(device.lastSeen).toLocaleString();
  });
  
  // Calculate analytics
  const analytics = {
    byBrowser: {},
    byOS: {},
    byDeviceType: {},
    byCountry: {},
    requestsByHour: Array(24).fill(0)
  };
  
  locations.forEach(location => {
    const browser = location.deviceInfo?.browser || 'Unknown';
    analytics.byBrowser[browser] = (analytics.byBrowser[browser] || 0) + 1;
    
    const os = location.deviceInfo?.os || 'Unknown';
    analytics.byOS[os] = (analytics.byOS[os] || 0) + 1;
    
    const deviceType = location.deviceInfo?.device || 'Unknown';
    analytics.byDeviceType[deviceType] = (analytics.byDeviceType[deviceType] || 0) + 1;
    
    const country = location.country || 'Unknown';
    analytics.byCountry[country] = (analytics.byCountry[country] || 0) + 1;
    
    const hour = new Date(location.timestamp).getHours();
    analytics.requestsByHour[hour]++;
  });
  
  // Get top visitors
  const topVisitors = devicesArray
    .map(device => ({
      deviceName: device.deviceName,
      totalLocations: device.totalLocations,
      deviceInfo: device.deviceInfo,
      lastSeen: device.lastSeenFormatted
    }))
    .sort((a, b) => b.totalLocations - a.totalLocations)
    .slice(0, 10);
  
  return {
    totalLocations: locations.length,
    totalDevices: devicesArray.length,
    devices: devicesArray,
    analytics: {
      ...analytics,
      topVisitors
    },
    lastUpdated: new Date().toISOString()
  };
}

// Get locations by device name from Firebase
async function getLocationsByDevice(deviceName) {
  const snapshot = await db.ref('locations')
    .orderByChild('deviceName')
    .equalTo(deviceName)
    .once('value');
  
  if (!snapshot.exists()) {
    return null;
  }
  
  const locationsObj = snapshot.val();
  const locations = Object.values(locationsObj).sort((a, b) => b.timestamp - a.timestamp);
  
  // Calculate device stats
  const firstSeen = Math.min(...locations.map(l => l.timestamp));
  const lastSeen = Math.max(...locations.map(l => l.timestamp));
  
  return {
    deviceName,
    totalLocations: locations.length,
    firstSeen,
    lastSeen,
    firstSeenFormatted: new Date(firstSeen).toLocaleString(),
    lastSeenFormatted: new Date(lastSeen).toLocaleString(),
    locations,
    deviceInfo: locations[0]?.deviceInfo || {}
  };
}

// Get locations by fingerprint from Firebase
async function getLocationsByFingerprint(fingerprint) {
  const snapshot = await db.ref('locations')
    .orderByChild('fingerprint')
    .equalTo(fingerprint)
    .once('value');
  
  if (!snapshot.exists()) {
    return [];
  }
  
  const locationsObj = snapshot.val();
  return Object.values(locationsObj).sort((a, b) => b.timestamp - a.timestamp);
}

// Delete location from Firebase
async function deleteLocation(id) {
  await db.ref(`locations/${id}`).remove();
  return true;
}

// Delete all locations for a device from Firebase
async function deleteDeviceLocations(deviceName) {
  const snapshot = await db.ref('locations')
    .orderByChild('deviceName')
    .equalTo(deviceName)
    .once('value');
  
  if (!snapshot.exists()) {
    return 0;
  }
  
  const locations = snapshot.val();
  const deletePromises = Object.keys(locations).map(key => 
    db.ref(`locations/${key}`).remove()
  );
  
  await Promise.all(deletePromises);
  return Object.keys(locations).length;
}

// Delete all locations from Firebase
async function deleteAllLocations() {
  const snapshot = await db.ref('locations').once('value');
  if (!snapshot.exists()) {
    return 0;
  }
  
  const locations = snapshot.val();
  await db.ref('locations').remove();
  return Object.keys(locations).length;
}

// Secure admin authentication
function isAdminAuthenticated(req) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.warn('Admin request missing Authorization header');
    return false;
  }
  
  const token = authHeader.replace('Bearer ', '');
  return token === CONFIG.ADMIN_SECRET;
}

// ==================== MAIN HANDLER ====================

export default async function handler(req, res) {
  const { method, query: params, body } = req;

  // Enhanced CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', CONFIG.CORS_ALLOW_HEADERS);

  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Rate limiting
    if (!checkRateLimit(req)) {
      return res.status(429).json({ 
        success: false,
        error: 'Too many requests. Please try again later.' 
      });
    }

    // Route handling
    switch (method) {
      case 'GET':
        return await handleGet(req, res, params);
      case 'POST':
        return await handlePost(req, res, params, body);
      case 'DELETE':
        return await handleDelete(req, res, params);
      default:
        return res.status(405).json({ 
          success: false,
          error: 'Method not allowed' 
        });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
}

// ==================== GET HANDLER ====================

async function handleGet(req, res, params) {
  const { view, device, id, ip, format, fingerprint } = params;

  // Dashboard view
  if (view === 'dashboard') {
    return getDashboardView(res);
  }

  // Analytics view
  if (view === 'analytics') {
    const allData = await getAllLocations();
    return res.status(200).json({
      success: true,
      analytics: allData.analytics,
      summary: {
        totalDevices: allData.totalDevices,
        totalLocations: allData.totalLocations,
        lastUpdated: allData.lastUpdated
      }
    });
  }

  // Get specific location
  if (id) {
    const location = await getLocationById(id);
    return location ? 
      res.status(200).json({ 
        success: true, 
        location 
      }) :
      res.status(404).json({ 
        success: false,
        error: 'Location not found' 
      });
  }

  // Get device data
  if (device) {
    const deviceData = await getLocationsByDevice(device);
    
    if (!deviceData) {
      return res.status(404).json({ 
        success: false,
        error: `Device not found: ${device}` 
      });
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

  // IP lookup
  if (ip) {
    const location = await getLocationFromIp(ip);
    
    if (!location) {
      return res.status(404).json({ 
        success: false,
        error: 'Unable to fetch location for IP' 
      });
    }
    
    const fingerprintData = generateDeviceFingerprint(req);
    const storedLocation = await storeLocation({
      ...location,
      deviceName: `IP-Lookup-${ip.substring(0, 8)}`,
      source: 'ip-lookup',
      ...fingerprintData,
      method: 'GET-IP'
    });
    
    return res.status(200).json({
      success: true,
      location: storedLocation,
      timestamp: new Date().toISOString()
    });
  }

  // Get by fingerprint
  if (fingerprint) {
    const locations = await getLocationsByFingerprint(fingerprint);
    
    return res.status(200).json({
      success: true,
      count: locations.length,
      fingerprint,
      locations
    });
  }

  // Get all data
  if (view === 'all') {
    const allData = await getAllLocations();
    
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
          timestamp: device.locations[0].timestamp
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

  // Regular API call - auto collect visitor data
  return await handleRegularApiCall(req, res);
}

async function handleRegularApiCall(req, res) {
  const clientIP = getClientIp(req);
  const fingerprintData = generateDeviceFingerprint(req);
  const userAgentInfo = parseUserAgent(fingerprintData.userAgent);
  
  const deviceName = `Visitor-${fingerprintData.fingerprint.substring(0, 8)}`;
  const ipLocation = await getLocationFromIp(clientIP);
  
  const storedLocation = await storeLocation({
    deviceName,
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
  
  return res.status(200).json({
    success: true,
    message: 'Visitor information collected successfully',
    visitor: {
      id: storedLocation.location_id,
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

// ==================== POST HANDLER ====================

async function handlePost(req, res, params, body) {
  const { action } = params;

  if (action === 'device' || !action) {
    return await handleDeviceGeolocation(res, body, req);
  }

  if (action === 'bulk') {
    return await handleBulkLocation(res, body, req);
  }

  return res.status(400).json({ 
    success: false,
    error: 'Invalid action' 
  });
}

async function handleDeviceGeolocation(res, body, req) {
  const fingerprintData = generateDeviceFingerprint(req);
  const userAgentInfo = parseUserAgent(fingerprintData.userAgent);
  
  const sanitizedData = {
    deviceName: sanitizeForDisplay(body.deviceName || `Device-${fingerprintData.fingerprint.substring(0, 8)}`),
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy: body.accuracy,
    altitude: body.altitude,
    altitudeAccuracy: body.altitudeAccuracy,
    speed: body.speed,
    heading: body.heading,
    timestamp: body.timestamp || Date.now(),
    source: sanitizeForDisplay(body.source || 'device-geolocation'),
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

  // Simple validation
  if (!sanitizedData.latitude || !sanitizedData.longitude) {
    return res.status(400).json({ 
      success: false,
      error: 'Latitude and longitude are required' 
    });
  }

  const storedLocation = await storeLocation(sanitizedData);

  return res.status(200).json({
    success: true,
    message: 'Device location received successfully',
    location: storedLocation,
    dashboardUrl: `${req.headers.host}/api/location?view=dashboard`,
    yourDataUrl: `${req.headers.host}/api/location?fingerprint=${fingerprintData.fingerprint}`
  });
}

async function handleBulkLocation(res, body, req) {
  const { locations, deviceName } = body;
  const fingerprintData = generateDeviceFingerprint(req);
  
  if (!Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({ 
      success: false,
      error: 'Array of locations required' 
    });
  }

  if (locations.length > 100) {
    return res.status(400).json({ 
      success: false,
      error: 'Maximum 100 locations per request' 
    });
  }

  const storedLocations = [];
  const errors = [];

  for (const loc of locations) {
    try {
      const deviceNameToUse = deviceName || loc.deviceName || `Device-${fingerprintData.fingerprint.substring(0, 8)}`;
      
      if (!loc.latitude || !loc.longitude) {
        errors.push({ location: loc, error: 'Missing latitude/longitude' });
        continue;
      }
      
      const storedLoc = await storeLocation({
        ...loc,
        deviceName: deviceNameToUse,
        ip: loc.ip || getClientIp(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        method: 'BULK_POST',
        ...fingerprintData
      });
      
      storedLocations.push(storedLoc.location_id);
    } catch (error) {
      errors.push({ location: loc, error: error.message });
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

// ==================== DELETE HANDLER ====================

async function handleDelete(req, res, params) {
  const { id, device, all } = params;

  // Admin authentication
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ 
      success: false,
      error: 'Unauthorized. Valid admin token required.' 
    });
  }

  // Delete location
  if (id) {
    const deleted = await deleteLocation(id);
    return res.status(deleted ? 200 : 404).json({
      success: deleted,
      message: deleted ? `Location ${id} deleted` : 'Location not found'
    });
  }

  // Delete device
  if (device) {
    const count = await deleteDeviceLocations(device);
    return res.status(200).json({
      success: true,
      message: `Deleted ${count} locations for device: ${device}`
    });
  }

  // Delete all
  if (all === 'true') {
    const count = await deleteAllLocations();
    // Also clear rate limit storage
    rateLimitStorage.clear();
    
    return res.status(200).json({
      success: true,
      message: `Deleted all ${count} locations and reset rate limits`
    });
  }

  return res.status(400).json({ 
    success: false,
    error: 'Specify id, device, or all=true to delete' 
  });
}

// ==================== DASHBOARD VIEW ====================

async function getDashboardView(res) {
  const allData = await getAllLocations();
  
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
        .container { max-width: 1400px; margin: 0 auto; }
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
        h1 { color: #333; font-size: 28px; display: flex; align-items: center; gap: 10px; }
        h1 i { color: #667eea; }
        .stats { display: flex; gap: 20px; }
        .stat-box {
            background: #f8f9fa;
            padding: 15px 25px;
            border-radius: 10px;
            text-align: center;
            min-width: 150px;
            transition: transform 0.3s;
        }
        .stat-box:hover { transform: translateY(-2px); }
        .stat-box h3 { color: #666; font-size: 14px; margin-bottom: 5px; }
        .stat-box .number { font-size: 32px; font-weight: bold; color: #333; }
        
        .tab-container { display: flex; gap: 10px; margin-bottom: 20px; }
        .tab {
            background: white;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            color: #666;
            transition: all 0.3s;
        }
        .tab.active { background: #667eea; color: white; }
        
        .card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .card-header h2 { color: #333; font-size: 20px; display: flex; align-items: center; gap: 10px; }
        
        .device-list { max-height: 500px; overflow-y: auto; }
        .device-card {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 10px;
            transition: all 0.3s;
            border: 2px solid transparent;
        }
        .device-card:hover { background: #eef2ff; border-color: #667eea; }
        .device-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .device-name { font-size: 16px; font-weight: bold; color: #333; display: flex; align-items: center; gap: 8px; }
        .device-info { display: flex; gap: 10px; font-size: 12px; color: #666; flex-wrap: wrap; }
        .device-location {
            font-family: monospace;
            background: #e9ecef;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
            margin-top: 8px;
        }
        
        .chart-container { height: 300px; margin-top: 20px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        
        .api-guide { margin-top: 30px; }
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 14px;
            overflow-x: auto;
            margin: 10px 0;
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
        .refresh-btn:hover { transform: rotate(90deg); }
        
        .success-banner {
            background: #c6f6d5;
            border: 2px solid #48bb78;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 20px;
            color: #22543d;
        }
        .success-banner i { color: #48bb78; margin-right: 10px; }
        
        @media (max-width: 768px) {
            .grid-2 { grid-template-columns: 1fr; }
            .stats { flex-direction: column; }
            .stat-box { min-width: auto; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-banner">
            <i class="fas fa-database"></i>
            <strong>FIREBASE STORAGE:</strong> All data is persistently stored in Firebase Realtime Database.
            Data will persist across server restarts and deployments.
        </div>
        
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
            <div class="tab" onclick="switchTab('api')">API Guide</div>
        </div>
        
        <div id="devicesTab" class="tab-content active">
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
                                    <span style="font-size: 12px; color: #666; background: #e9ecef; padding: 3px 8px; border-radius: 4px;">
                                        ${device.totalLocations} locations
                                    </span>
                                </div>
                                <div class="device-info">
                                    <span><i class="fas fa-globe"></i> ${device.deviceInfo?.os || 'Unknown OS'}</span>
                                    <span><i class="fas fa-compass"></i> ${device.deviceInfo?.browser || 'Unknown Browser'}</span>
                                    <span><i class="fas fa-clock"></i> Last: ${device.lastSeenFormatted}</span>
                                </div>
                                ${device.locations[0]?.latitude ? `
                                    <div class="device-location">
                                        ${device.locations[0].latitude.toFixed(6)}, ${device.locations[0].longitude.toFixed(6)}
                                    </div>
                                    ${device.locations[0].city ? 
                                        `<div style="font-size: 12px; color: #666; margin-top: 5px;">
                                            <i class="fas fa-map-pin"></i> ${device.locations[0].city}, ${device.locations[0].country}
                                        </div>` : ''}
                                ` : ''}
                            </div>
                        `).join('')
                    }
                </div>
            </div>
        </div>
        
        <div id="analyticsTab" class="tab-content">
            <div class="grid-2">
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
                        ${allData.analytics.topVisitors.map((visitor, index) => `
                            <div style="padding: 10px; border-bottom: 1px solid #f0f0f0;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div style="width: 30px; height: 30px; background: #667eea; border-radius: 50%; 
                                                display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                                        ${index + 1}
                                    </div>
                                    <div>
                                        <div style="font-weight: bold;">${visitor.deviceName}</div>
                                        <div style="font-size: 12px; color: #666;">
                                            ${visitor.deviceInfo?.browser} • ${visitor.deviceInfo?.os}
                                        </div>
                                    </div>
                                    <div style="margin-left: auto; text-align: right;">
                                        <div style="font-weight: bold;">${visitor.totalLocations}</div>
                                        <div style="font-size: 11px; color: #999;">requests</div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        
        <div id="apiTab" class="tab-content">
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-code"></i> API Usage Guide</h2>
                </div>
                <div class="api-guide">
                    <h3><i class="fas fa-link"></i> Basic Usage</h3>
                    <p>Call the API endpoint to automatically track visitor information:</p>
                    <div class="code-block">
// Simple GET request - auto-collects visitor data<br>
fetch('https://mytalknote.vercel.app/api/location')<br>
  .then(response => response.json())<br>
  .then(data => console.log(data));<br><br>
// Response includes your fingerprint URL<br>
// Use it to view your data: /api/location?fingerprint=YOUR_FINGERPRINT
                    </div>
                    
                    <h3><i class="fas fa-upload"></i> Submit Device Location</h3>
                    <div class="code-block">
fetch('https://mytalknote.vercel.app/api/location', {<br>
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
                    
                    <h3><i class="fas fa-database"></i> View Data</h3>
                    <div class="code-block">
// Get all data<br>
fetch('https://mytalknote.vercel.app/api/location?view=all')<br>
<br>
// Get analytics<br>
fetch('https://mytalknote.vercel.app/api/location?view=analytics')<br>
<br>
// Get device data<br>
fetch('https://mytalknote.vercel.app/api/location?device=Device-Name')<br>
<br>
// IP lookup<br>
fetch('https://mytalknote.vercel.app/api/location?ip=8.8.8.8')
                    </div>
                    
                    <h3><i class="fas fa-trash"></i> Admin Operations</h3>
                    <div class="code-block">
// Delete all data (requires admin token)<br>
fetch('https://mytalknote.vercel.app/api/location?all=true', {<br>
  method: 'DELETE',<br>
  headers: {<br>
    'Authorization': 'Bearer ADMIN_SECRET_TOKEN'<br>
  }<br>
})
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <div class="refresh-btn" onclick="refreshData()" title="Refresh Data">
        <i class="fas fa-redo"></i>
    </div>

    <script>
        const analyticsData = ${JSON.stringify(allData.analytics)};
        
        // Tab switching
        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            document.querySelector(\`.tab[onclick="switchTab('\${tabName}')"]\`).classList.add('active');
            document.getElementById(\`\${tabName}Tab\`).classList.add('active');
            
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
                card.style.display = deviceName.includes(searchTerm) ? 'block' : 'none';
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
                options: { responsive: true, maintainAspectRatio: false }
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
                    scales: { y: { beginAtZero: true } }
                }
            });
            
            // Hourly chart
            const hourlyCtx = document.getElementById('hourlyChart').getContext('2d');
            new Chart(hourlyCtx, {
                type: 'line',
                data: {
                    labels: Array.from({length: 24}, (_, i) => \`\${i}:00\`),
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
                    scales: { y: { beginAtZero: true } }
                }
            });
        }
        
        // Refresh data
        async function refreshData() {
            const btn = document.querySelector('.refresh-btn');
            btn.style.transform = 'rotate(180deg)';
            
            try {
                const response = await fetch('/api/location?view=all');
                if (response.ok) {
                    location.reload();
                }
            } catch (error) {
                console.error('Refresh failed:', error);
                btn.style.transform = 'rotate(0)';
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
        
        // Initialize charts if needed
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