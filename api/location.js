// api/location.js - API endpoints only
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
  MAX_RETURNED_LOCATIONS: 1000,
};

// ==================== RATE LIMITING IN MEMORY ====================
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
        fingerprint: location.fingerprint,
        ip: location.ip,
        city: location.city,
        country: location.country
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
    
    // Calculate most common location
    const locationCounts = {};
    device.locations.forEach(loc => {
      const key = `${loc.latitude?.toFixed(3)}|${loc.longitude?.toFixed(3)}`;
      locationCounts[key] = (locationCounts[key] || 0) + 1;
    });
    
    const mostCommonKey = Object.keys(locationCounts).reduce((a, b) => 
      locationCounts[a] > locationCounts[b] ? a : b
    );
    device.mostCommonLocation = mostCommonKey ? mostCommonKey.split('|').map(Number) : null;
  });
  
  // Calculate analytics
  const analytics = {
    byBrowser: {},
    byOS: {},
    byDeviceType: {},
    byCountry: {},
    requestsByHour: Array(24).fill(0),
    geolocations: []
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
    
    // Collect geolocations for map
    if (location.latitude && location.longitude) {
      analytics.geolocations.push({
        latitude: location.latitude,
        longitude: location.longitude,
        deviceName: location.deviceName,
        city: location.city,
        country: location.country,
        timestamp: location.timestamp
      });
    }
  });
  
  // Get top visitors
  const topVisitors = devicesArray
    .map(device => ({
      deviceName: device.deviceName,
      totalLocations: device.totalLocations,
      deviceInfo: device.deviceInfo,
      lastSeen: device.lastSeenFormatted,
      city: device.city,
      country: device.country
    }))
    .sort((a, b) => b.totalLocations - a.totalLocations)
    .slice(0, 10);
  
  return {
    totalLocations: locations.length,
    totalDevices: devicesArray.length,
    devices: devicesArray,
    locations: locations,
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
  
  // Calculate most common location
  const locationCounts = {};
  locations.forEach(loc => {
    const key = `${loc.latitude?.toFixed(3)}|${loc.longitude?.toFixed(3)}`;
    locationCounts[key] = (locationCounts[key] || 0) + 1;
  });
  
  const mostCommonKey = Object.keys(locationCounts).reduce((a, b) => 
    locationCounts[a] > locationCounts[b] ? a : b
  );
  const mostCommonLocation = mostCommonKey ? mostCommonKey.split('|').map(Number) : null;
  
  return {
    deviceName,
    totalLocations: locations.length,
    firstSeen,
    lastSeen,
    firstSeenFormatted: new Date(firstSeen).toLocaleString(),
    lastSeenFormatted: new Date(lastSeen).toLocaleString(),
    locations,
    deviceInfo: locations[0]?.deviceInfo || {},
    fingerprint: locations[0]?.fingerprint || null,
    ip: locations[0]?.ip || null,
    mostCommonLocation,
    cities: [...new Set(locations.filter(l => l.city).map(l => l.city))],
    countries: [...new Set(locations.filter(l => l.country).map(l => l.country))]
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

  // Redirect dashboard to separate endpoint
  if (view === 'dashboard') {
    return res.status(302).json({
      success: true,
      message: 'Dashboard available at /api/location-dashboard',
      dashboardUrl: `${req.headers.host}/api/location-dashboard`
    });
  }

  // Device details view
  if (view === 'device' && device) {
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
      locations: deviceData.locations,
      deviceInfo: deviceData.deviceInfo,
      fingerprint: deviceData.fingerprint,
      ip: deviceData.ip,
      cities: deviceData.cities,
      countries: deviceData.countries
    });
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
    dashboardUrl: `${req.headers.host}/api/location-dashboard`,
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
    dashboardUrl: `${req.headers.host}/api/location-dashboard`,
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