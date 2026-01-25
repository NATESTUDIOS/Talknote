// api/location-dashboard.js - Dashboard UI only
import { db } from "../utils/firebase.js";

// ==================== CONFIGURATION ====================
const CONFIG = {
  MAX_RETURNED_LOCATIONS: 1000,
  MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN || '',
  DEFAULT_MAP_CENTER: [40.7128, -74.0060], // New York
  DEFAULT_ZOOM: 2,
  LOCATION_ZOOM: 12
};

// ==================== FIREBASE FUNCTIONS ====================

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

// ==================== MAIN HANDLER ====================

export default async function handler(req, res) {
  const { method } = req;

  // Enhanced CORS headers for dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (method === 'GET') {
      return await handleDashboardRequest(req, res);
    }
    
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
}

async function handleDashboardRequest(req, res) {
  const { device, action } = req.query;

  // Handle device details AJAX request
  if (device && action === 'details') {
    const deviceData = await getLocationsByDevice(device);
    
    if (!deviceData) {
      return res.status(404).json({ 
        success: false,
        error: `Device not found: ${device}` 
      });
    }
    
    return res.status(200).json({
      success: true,
      device: deviceData
    });
  }

  // Return full dashboard HTML
  const allData = await getAllLocations();
  return res.status(200).send(generateDashboardHTML(allData));
}

// ==================== HTML GENERATION ====================

function generateDashboardHTML(allData) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Location Tracker Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1600px; margin: 0 auto; }
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
            cursor: pointer;
        }
        .stat-box:hover { transform: translateY(-2px); }
        .stat-box h3 { color: #666; font-size: 14px; margin-bottom: 5px; }
        .stat-box .number { font-size: 32px; font-weight: bold; color: #333; }
        
        .tab-container { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .tab {
            background: white;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            color: #666;
            transition: all 0.3s;
            white-space: nowrap;
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
            cursor: pointer;
        }
        .device-card:hover { background: #eef2ff; border-color: #667eea; transform: translateY(-2px); }
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
        .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
        
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
        
        /* Map Styles */
        .map-container { 
            height: 500px; 
            width: 100%; 
            border-radius: 12px;
            overflow: hidden;
            margin-top: 20px;
            border: 2px solid #e2e8f0;
        }
        .map-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .map-controls {
            display: flex;
            gap: 10px;
        }
        .map-control-btn {
            background: white;
            border: 2px solid #e2e8f0;
            padding: 8px 15px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s;
        }
        .map-control-btn:hover {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }
        
        /* Modal Styles */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            backdrop-filter: blur(5px);
            z-index: 2000;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .modal-content {
            background: white;
            border-radius: 15px;
            padding: 30px;
            max-width: 900px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            position: relative;
            animation: modalSlideIn 0.3s ease;
        }
        @keyframes modalSlideIn {
            from { opacity: 0; transform: translateY(-30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .close-modal {
            position: absolute;
            top: 15px;
            right: 15px;
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        }
        .modal-header {
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .modal-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 30px;
            margin-top: 20px;
        }
        .location-details-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .detail-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 10px;
        }
        .detail-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .detail-value {
            font-size: 16px;
            font-weight: 600;
            color: #333;
        }
        .timeline {
            margin-top: 20px;
        }
        .timeline-item {
            display: flex;
            gap: 15px;
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
            transition: background 0.3s;
        }
        .timeline-item:hover {
            background: #f8f9fa;
        }
        .timeline-time {
            font-size: 12px;
            color: #666;
            min-width: 120px;
        }
        .timeline-location {
            flex: 1;
        }
        .timeline-coords {
            font-family: monospace;
            font-size: 14px;
            color: #333;
        }
        .timeline-city {
            font-size: 12px;
            color: #666;
            margin-top: 3px;
        }
        
        @media (max-width: 1200px) {
            .grid-3 { grid-template-columns: 1fr 1fr; }
            .modal-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
            .grid-2, .grid-3 { grid-template-columns: 1fr; }
            .stats { flex-direction: column; }
            .stat-box { min-width: auto; }
            .tab-container { overflow-x: auto; padding-bottom: 10px; }
            .map-container { height: 350px; }
        }
        @media (max-width: 480px) {
            .modal-content { padding: 20px; }
            .location-details-grid { grid-template-columns: 1fr; }
            .map-controls { flex-wrap: wrap; }
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
                <div class="stat-box" onclick="switchTab('devices')">
                    <h3>Total Devices</h3>
                    <div class="number">${allData.totalDevices}</div>
                </div>
                <div class="stat-box" onclick="switchTab('map')">
                    <h3>Total Locations</h3>
                    <div class="number">${allData.totalLocations}</div>
                </div>
                <div class="stat-box" onclick="switchTab('analytics')">
                    <h3>Active Today</h3>
                    <div class="number" id="activeToday">${allData.devices.filter(d => 
                        new Date(d.lastSeen).toDateString() === new Date().toDateString()
                    ).length}</div>
                </div>
            </div>
        </div>
        
        <div class="tab-container">
            <div class="tab active" onclick="switchTab('devices')"><i class="fas fa-mobile-alt"></i> Devices</div>
            <div class="tab" onclick="switchTab('map')"><i class="fas fa-map"></i> World Map</div>
            <div class="tab" onclick="switchTab('analytics')"><i class="fas fa-chart-bar"></i> Analytics</div>
            <div class="tab" onclick="switchTab('realtime')"><i class="fas fa-clock"></i> Real-time</div>
            <div class="tab" onclick="switchTab('api')"><i class="fas fa-code"></i> API Guide</div>
        </div>
        
        <div id="devicesTab" class="tab-content active">
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-mobile-alt"></i> Tracked Devices</h2>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" placeholder="Search devices..." id="searchInput" 
                               style="padding: 8px 15px; border: 2px solid #e0e0e0; border-radius: 8px; width: 300px;">
                        <button onclick="exportDevices()" style="background: #48bb78; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-download"></i> Export
                        </button>
                    </div>
                </div>
                <div class="device-list" id="deviceList">
                    ${allData.totalDevices === 0 ? 
                        '<div style="text-align: center; padding: 40px; color: #666;">No devices tracked yet. Call the API to get started!</div>' : 
                        allData.devices.map(device => `
                            <div class="device-card" onclick="viewDeviceDetails('${device.deviceName}')">
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
        
        <div id="mapTab" class="tab-content">
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-map"></i> World Map - Location Visualization</h2>
                    <div class="map-controls">
                        <button class="map-control-btn" onclick="resetMapView()">
                            <i class="fas fa-globe-americas"></i> Reset View
                        </button>
                        <button class="map-control-btn" onclick="clusterMarkers = !clusterMarkers; updateMapMarkers()">
                            <i class="fas fa-layer-group"></i> Toggle Clusters
                        </button>
                        <button class="map-control-btn" onclick="showHeatmap = !showHeatmap; updateMapMarkers()">
                            <i class="fas fa-fire"></i> Heatmap
                        </button>
                    </div>
                </div>
                <div class="map-container" id="worldMap"></div>
                <div style="margin-top: 15px; color: #666; font-size: 14px;">
                    <i class="fas fa-info-circle"></i> Showing ${allData.analytics.geolocations.length} geolocated points from ${allData.totalDevices} devices
                </div>
            </div>
            
            <div class="grid-3" style="margin-top: 20px;">
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-users"></i> Top Visitors</h2>
                    </div>
                    <div style="max-height: 250px; overflow-y: auto;">
                        ${allData.analytics.topVisitors.map((visitor, index) => `
                            <div style="padding: 10px; border-bottom: 1px solid #f0f0f0; cursor: pointer;" onclick="viewDeviceDetails('${visitor.deviceName}')">
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
                
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-flag"></i> Top Countries</h2>
                    </div>
                    <div style="max-height: 250px; overflow-y: auto;">
                        ${Object.entries(allData.analytics.byCountry)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([country, count]) => `
                            <div style="padding: 10px; border-bottom: 1px solid #f0f0f0;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="font-weight: 500;">${country}</div>
                                    <div style="background: #667eea; color: white; padding: 2px 8px; border-radius: 10px; font-size: 12px;">
                                        ${count}
                                    </div>
                                </div>
                            </div>
                          `).join('')}
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2><i class="fas fa-location-dot"></i> Recent Activity</h2>
                    </div>
                    <div style="max-height: 250px; overflow-y: auto;">
                        ${allData.locations
                          .sort((a, b) => b.timestamp - a.timestamp)
                          .slice(0, 6)
                          .map(location => `
                            <div style="padding: 10px; border-bottom: 1px solid #f0f0f0; cursor: pointer;" onclick="viewLocationOnMap(${location.latitude}, ${location.longitude})">
                                <div style="font-size: 12px; color: #666;">
                                    <i class="fas fa-clock"></i> ${new Date(location.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </div>
                                <div style="font-weight: 500; margin-top: 3px;">${location.deviceName}</div>
                                <div style="font-size: 11px; color: #999;">
                                    ${location.city ? location.city + ', ' : ''}${location.country || 'Unknown location'}
                                </div>
                            </div>
                          `).join('')}
                    </div>
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
                        <h2><i class="fas fa-mobile-alt"></i> Device Types</h2>
                    </div>
                    <div class="chart-container">
                        <canvas id="deviceChart"></canvas>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="realtimeTab" class="tab-content">
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-clock"></i> Real-time Activity Stream</h2>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <div style="width: 12px; height: 12px; background: #48bb78; border-radius: 50%;" id="statusIndicator"></div>
                            <span id="connectionStatus">Connected</span>
                        </div>
                        <button onclick="toggleAutoRefresh()" style="background: #667eea; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-sync"></i> <span id="autoRefreshText">Auto Refresh: ON</span>
                        </button>
                    </div>
                </div>
                <div style="height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; background: #f8f9fa;" id="activityStream">
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <i class="fas fa-stream fa-2x" style="margin-bottom: 15px;"></i>
                        <div>Waiting for activity...</div>
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
fetch('/api/location')<br>
  .then(response => response.json())<br>
  .then(data => console.log(data));<br><br>
// Response includes your fingerprint URL<br>
// Use it to view your data: /api/location?fingerprint=YOUR_FINGERPRINT
                    </div>
                    
                    <h3><i class="fas fa-upload"></i> Submit Device Location</h3>
                    <div class="code-block">
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
                    
                    <h3><i class="fas fa-database"></i> View Data</h3>
                    <div class="code-block">
// Get all data<br>
fetch('/api/location?view=all')<br>
<br>
// Get analytics<br>
fetch('/api/location?view=analytics')<br>
<br>
// Get device data<br>
fetch('/api/location?device=Device-Name')<br>
<br>
// Get device details page<br>
fetch('/api/location?view=device&device=Device-Name')
                    </div>
                    
                    <h3><i class="fas fa-trash"></i> Admin Operations</h3>
                    <div class="code-block">
// Delete all data (requires admin token)<br>
fetch('/api/location?all=true', {<br>
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
    
    <!-- Device Details Modal -->
    <div class="modal" id="deviceModal">
        <div class="modal-content">
            <button class="close-modal" onclick="closeDeviceModal()">&times;</button>
            <div class="modal-header">
                <h2><i class="fas fa-mobile-alt"></i> <span id="modalDeviceName">Loading...</span></h2>
                <div>
                    <button onclick="deleteDevice()" style="background: #f56565; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer;">
                        <i class="fas fa-trash"></i> Delete Device
                    </button>
                </div>
            </div>
            <div id="modalDeviceContent">
                <div style="text-align: center; padding: 40px;">
                    <i class="fas fa-spinner fa-spin fa-2x"></i>
                    <div style="margin-top: 15px;">Loading device details...</div>
                </div>
            </div>
        </div>
    </div>
    
    <div class="refresh-btn" onclick="refreshData()" title="Refresh Data">
        <i class="fas fa-redo"></i>
    </div>

    <script>
        const analyticsData = ${JSON.stringify(allData.analytics)};
        const allDevices = ${JSON.stringify(allData.devices)};
        const geolocations = ${JSON.stringify(allData.analytics.geolocations)};
        
        let map = null;
        let markers = [];
        let clusterMarkers = true;
        let showHeatmap = false;
        let deviceModalOpen = false;
        let autoRefresh = true;
        let refreshInterval;
        
        // Tab switching
        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            document.querySelector(\`.tab[onclick="switchTab('\${tabName}')"]\`).classList.add('active');
            document.getElementById(\`\${tabName}Tab\`).classList.add('active');
            
            if (tabName === 'analytics') {
                renderCharts();
            } else if (tabName === 'map' && !map) {
                setTimeout(initMap, 100);
            } else if (tabName === 'realtime') {
                startAutoRefresh();
            } else if (tabName !== 'realtime') {
                stopAutoRefresh();
            }
        }
        
        // Search functionality
        document.getElementById('searchInput').addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            const deviceCards = document.querySelectorAll('.device-card');
            
            deviceCards.forEach(card => {
                const deviceName = card.querySelector('.device-name').textContent.toLowerCase();
                card.style.display = deviceName.includes(searchTerm) ? 'block' : 'none';
            });
        });
        
        // Initialize map
        function initMap() {
            map = L.map('worldMap').setView(${JSON.stringify(CONFIG.DEFAULT_MAP_CENTER)}, ${CONFIG.DEFAULT_ZOOM});
            
            // Use OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);
            
            updateMapMarkers();
            
            // Add click event to map
            map.on('click', function(e) {
                console.log('Map clicked at:', e.latlng);
            });
        }
        
        // Update map markers
        function updateMapMarkers() {
            if (!map) return;
            
            // Clear existing markers
            markers.forEach(marker => map.removeLayer(marker));
            markers = [];
            
            if (geolocations.length === 0) return;
            
            // Create marker cluster group if clustering enabled
            let markerGroup;
            if (clusterMarkers && geolocations.length > 10) {
                markerGroup = L.markerClusterGroup({
                    maxClusterRadius: 50,
                    spiderfyOnMaxZoom: true,
                    showCoverageOnHover: true,
                    zoomToBoundsOnClick: true
                });
            }
            
            // Add markers for each location
            geolocations.forEach(location => {
                if (!location.latitude || !location.longitude) return;
                
                const marker = L.marker([location.latitude, location.longitude])
                    .bindPopup(\`
                        <div style="min-width: 200px;">
                            <h4 style="margin: 0 0 10px 0;"><i class="fas fa-mobile-alt"></i> \${location.deviceName}</h4>
                            <div style="margin-bottom: 5px;"><strong>Location:</strong> \${location.latitude.toFixed(6)}, \${location.longitude.toFixed(6)}</div>
                            \${location.city ? \`<div style="margin-bottom: 5px;"><strong>City:</strong> \${location.city}, \${location.country}</div>\` : ''}
                            <div style="margin-bottom: 5px;"><strong>Time:</strong> \${new Date(location.timestamp).toLocaleString()}</div>
                            <button onclick="viewDeviceDetails('\${location.deviceName}')" style="background: #667eea; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; width: 100%;">
                                <i class="fas fa-eye"></i> View Device
                            </button>
                        </div>
                    \`);
                
                if (clusterMarkers && geolocations.length > 10) {
                    markerGroup.addLayer(marker);
                } else {
                    marker.addTo(map);
                    markers.push(marker);
                }
            });
            
            if (clusterMarkers && geolocations.length > 10 && markerGroup) {
                map.addLayer(markerGroup);
            }
            
            // Add heatmap if enabled
            if (showHeatmap && geolocations.length > 0) {
                const heatData = geolocations
                    .filter(loc => loc.latitude && loc.longitude)
                    .map(loc => [loc.latitude, loc.longitude, 1]);
                
                const heatLayer = L.heatLayer(heatData, {
                    radius: 25,
                    blur: 15,
                    maxZoom: 17,
                    gradient: {0.4: 'blue', 0.65: 'lime', 1: 'red'}
                }).addTo(map);
                
                markers.push(heatLayer);
            }
        }
        
        // Reset map view
        function resetMapView() {
            if (map) {
                map.setView(${JSON.stringify(CONFIG.DEFAULT_MAP_CENTER)}, ${CONFIG.DEFAULT_ZOOM});
            }
        }
        
        // View location on map
        function viewLocationOnMap(lat, lng) {
            switchTab('map');
            setTimeout(() => {
                if (map) {
                    map.setView([lat, lng], ${CONFIG.LOCATION_ZOOM});
                    L.popup()
                        .setLatLng([lat, lng])
                        .setContent('Selected Location')
                        .openOn(map);
                }
            }, 100);
        }
        
        // View device details
        async function viewDeviceDetails(deviceName) {
            deviceModalOpen = true;
            document.getElementById('deviceModal').style.display = 'flex';
            document.getElementById('modalDeviceName').textContent = deviceName;
            
            try {
                const response = await fetch(\`/api/location-dashboard?device=\${encodeURIComponent(deviceName)}&action=details\`);
                const data = await response.json();
                
                if (data.success) {
                    const device = data.device;
                    renderDeviceDetails(device);
                } else {
                    document.getElementById('modalDeviceContent').innerHTML = \`
                        <div style="text-align: center; padding: 40px; color: #666;">
                            <i class="fas fa-exclamation-circle fa-2x"></i>
                            <div style="margin-top: 15px;">Failed to load device details</div>
                        </div>
                    \`;
                }
            } catch (error) {
                console.error('Failed to load device:', error);
                document.getElementById('modalDeviceContent').innerHTML = \`
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <i class="fas fa-exclamation-circle fa-2x"></i>
                        <div style="margin-top: 15px;">Error loading device details</div>
                    </div>
                \`;
            }
        }
        
        // Render device details
        function renderDeviceDetails(deviceData) {
            const locations = deviceData.locations || [];
            
            // Calculate some stats
            const cities = [...new Set(locations.filter(l => l.city).map(l => l.city))];
            const countries = [...new Set(locations.filter(l => l.country).map(l => l.country))];
            const accuracyAvg = locations.reduce((sum, loc) => sum + (loc.accuracy || 0), 0) / locations.length;
            
            const modalContent = \`
                <div class="modal-grid">
                    <div>
                        <h3><i class="fas fa-map"></i> Device Location History</h3>
                        <div style="height: 300px; width: 100%; border-radius: 8px; background: #f8f9fa; margin-top: 10px;" id="deviceMap"></div>
                        
                        <div class="location-details-grid" style="margin-top: 20px;">
                            <div class="detail-card">
                                <div class="detail-label">Total Locations</div>
                                <div class="detail-value">\${deviceData.totalLocations}</div>
                            </div>
                            <div class="detail-card">
                                <div class="detail-label">First Seen</div>
                                <div class="detail-value">\${deviceData.firstSeenFormatted}</div>
                            </div>
                            <div class="detail-card">
                                <div class="detail-label">Last Seen</div>
                                <div class="detail-value">\${deviceData.lastSeenFormatted}</div>
                            </div>
                            <div class="detail-card">
                                <div class="detail-label">Avg Accuracy</div>
                                <div class="detail-value">\${accuracyAvg ? accuracyAvg.toFixed(0) + 'm' : 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <h3><i class="fas fa-info-circle"></i> Device Information</h3>
                        <div class="detail-card" style="margin-top: 10px;">
                            <div class="detail-label">Device Name</div>
                            <div class="detail-value">\${deviceData.deviceName}</div>
                        </div>
                        <div class="detail-card" style="margin-top: 10px;">
                            <div class="detail-label">Fingerprint</div>
                            <div class="detail-value" style="font-family: monospace; font-size: 12px;">\${deviceData.fingerprint || 'N/A'}</div>
                        </div>
                        <div class="detail-card" style="margin-top: 10px;">
                            <div class="detail-label">IP Address</div>
                            <div class="detail-value">\${deviceData.ip || 'Unknown'}</div>
                        </div>
                        <div class="detail-card" style="margin-top: 10px;">
                            <div class="detail-label">Device Type</div>
                            <div class="detail-value">\${deviceData.deviceInfo?.device || 'Unknown'}</div>
                        </div>
                        <div class="detail-card" style="margin-top: 10px;">
                            <div class="detail-label">Operating System</div>
                            <div class="detail-value">\${deviceData.deviceInfo?.os || 'Unknown'}</div>
                        </div>
                        <div class="detail-card" style="margin-top: 10px;">
                            <div class="detail-label">Browser</div>
                            <div class="detail-value">\${deviceData.deviceInfo?.browser || 'Unknown'}</div>
                        </div>
                        
                        <h3 style="margin-top: 20px;"><i class="fas fa-city"></i> Locations</h3>
                        <div style="margin-top: 10px;">
                            <div><strong>Cities:</strong> \${cities.length > 0 ? cities.join(', ') : 'Unknown'}</div>
                            <div style="margin-top: 5px;"><strong>Countries:</strong> \${countries.length > 0 ? countries.join(', ') : 'Unknown'}</div>
                        </div>
                    </div>
                </div>
                
                <div class="timeline" style="margin-top: 30px;">
                    <h3><i class="fas fa-history"></i> Recent Activity Timeline</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin-top: 15px;">
                        \${locations.slice(0, 10).map(location => \`
                            <div class="timeline-item">
                                <div class="timeline-time">
                                    \${new Date(location.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </div>
                                <div class="timeline-location">
                                    <div class="timeline-coords">
                                        \${location.latitude?.toFixed(6) || 'N/A'}, \${location.longitude?.toFixed(6) || 'N/A'}
                                    </div>
                                    <div class="timeline-city">
                                        \${location.city ? location.city + ', ' : ''}\${location.country || 'Unknown location'}
                                    </div>
                                </div>
                            </div>
                        \`).join('')}
                    </div>
                </div>
            \`;
            
            document.getElementById('modalDeviceContent').innerHTML = modalContent;
            
            // Initialize mini map for device
            setTimeout(() => {
                if (locations.length > 0 && locations[0].latitude) {
                    const deviceMap = L.map('deviceMap').setView([locations[0].latitude, locations[0].longitude], 10);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        attribution: '© OpenStreetMap contributors'
                    }).addTo(deviceMap);
                    
                    locations.forEach(location => {
                        if (location.latitude && location.longitude) {
                            L.marker([location.latitude, location.longitude])
                                .addTo(deviceMap)
                                .bindPopup(\`
                                    <div style="min-width: 150px;">
                                        <div>\${new Date(location.timestamp).toLocaleString()}</div>
                                        <div>\${location.latitude.toFixed(6)}, \${location.longitude.toFixed(6)}</div>
                                    </div>
                                \`);
                        }
                    });
                }
            }, 100);
        }
        
        // Close device modal
        function closeDeviceModal() {
            deviceModalOpen = false;
            document.getElementById('deviceModal').style.display = 'none';
        }
        
        // Delete device (requires confirmation)
        async function deleteDevice() {
            const deviceName = document.getElementById('modalDeviceName').textContent;
            
            if (!confirm(\`Are you sure you want to delete all data for \${deviceName}? This action cannot be undone.\`)) {
                return;
            }
            
            try {
                const response = await fetch(\`/api/location?device=\${encodeURIComponent(deviceName)}\`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': 'Bearer ' + prompt('Enter admin token to delete:')
                    }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    alert(data.message);
                    closeDeviceModal();
                    refreshData();
                } else {
                    alert('Failed to delete device: ' + data.error);
                }
            } catch (error) {
                alert('Error deleting device: ' + error.message);
            }
        }
        
        // Render charts
        function renderCharts() {
            // Browser chart
            const browserCtx = document.getElementById('browserChart').getContext('2d');
            new Chart(browserCtx, {
                type: 'pie',
                data: {
                    labels: Object.keys(analyticsData.byBrowser),
                    datasets: [{
                        data: Object.values(analyticsData.byBrowser),
                        backgroundColor: ['#667eea', '#764ba2', '#f56565', '#48bb78', '#ed8936']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
            
            // OS chart
            const osCtx = document.getElementById('osChart').getContext('2d');
            new Chart(osCtx, {
                type: 'bar',
                data: {
                    labels: Object.keys(analyticsData.byOS),
                    datasets: [{
                        label: 'Devices',
                        data: Object.values(analyticsData.byOS),
                        backgroundColor: '#667eea'
                    }]
                },
                options: {
                    responsive: true,
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
                    labels: Array.from({length: 24}, (_, i) => i + ':00'),
                    datasets: [{
                        label: 'Requests',
                        data: analyticsData.requestsByHour,
                        borderColor: '#48bb78',
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
            
            // Device chart
            const deviceCtx = document.getElementById('deviceChart').getContext('2d');
            new Chart(deviceCtx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(analyticsData.byDeviceType),
                    datasets: [{
                        data: Object.values(analyticsData.byDeviceType),
                        backgroundColor: ['#667eea', '#f56565', '#48bb78', '#ed8936']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
        
        // Export devices
        function exportDevices() {
            const csvData = [
                ['Device Name', 'Total Locations', 'First Seen', 'Last Seen', 'OS', 'Browser', 'Device Type', 'IP', 'City', 'Country'],
                ...allDevices.map(device => [
                    device.deviceName,
                    device.totalLocations,
                    device.firstSeenFormatted,
                    device.lastSeenFormatted,
                    device.deviceInfo?.os || 'Unknown',
                    device.deviceInfo?.browser || 'Unknown',
                    device.deviceInfo?.device || 'Unknown',
                    device.ip || 'Unknown',
                    device.city || 'Unknown',
                    device.country || 'Unknown'
                ])
            ];
            
            const csvContent = csvData.map(row => row.map(cell => \`"\${cell}"\`).join(',')).join('\\n');
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`location-tracker-\${new Date().toISOString().split('T')[0]}.csv\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
        
        // Refresh data
        async function refreshData() {
            try {
                const response = await fetch('/api/location-dashboard?refresh=' + Date.now());
                const html = await response.text();
                
                // Replace the container content
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                const newContent = tempDiv.querySelector('.container').innerHTML;
                document.querySelector('.container').innerHTML = newContent;
                
                // Reinitialize event listeners
                initEventListeners();
                
                // Switch back to current tab
                const activeTab = document.querySelector('.tab.active').getAttribute('onclick').match(/switchTab\('(.+?)'\)/)[1];
                switchTab(activeTab);
            } catch (error) {
                console.error('Failed to refresh data:', error);
                alert('Failed to refresh data. Please reload the page.');
            }
        }
        
        // Auto refresh
        function startAutoRefresh() {
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(async () => {
                try {
                    const response = await fetch('/api/location?view=all&format=simple');
                    const data = await response.json();
                    
                    if (data.success) {
                        // Update activity stream
                        const activityStream = document.getElementById('activityStream');
                        const now = new Date();
                        const timestamp = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
                        
                        const newActivity = \`
                            <div style="padding: 10px; border-bottom: 1px solid #e2e8f0; background: white; border-radius: 6px; margin-bottom: 10px;">
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="color: #667eea; font-weight: 500;">\${timestamp}</span>
                                    <span style="font-size: 12px; color: #666;">Refresh</span>
                                </div>
                                <div style="margin-top: 5px; color: #333;">
                                    Active devices: \${data.totalDevices}, Total locations: \${data.totalLocations}
                                </div>
                            </div>
                        \`;
                        
                        activityStream.innerHTML = newActivity + activityStream.innerHTML;
                        
                        // Keep only last 20 activities
                        const activities = activityStream.querySelectorAll('div');
                        if (activities.length > 20) {
                            for (let i = 20; i < activities.length; i++) {
                                activities[i].remove();
                            }
                        }
                    }
                } catch (error) {
                    console.log('Auto-refresh error:', error);
                }
            }, 10000); // Refresh every 10 seconds
        }
        
        function stopAutoRefresh() {
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
        }
        
        function toggleAutoRefresh() {
            autoRefresh = !autoRefresh;
            document.getElementById('autoRefreshText').textContent = \`Auto Refresh: \${autoRefresh ? 'ON' : 'OFF'}\`;
            
            if (autoRefresh) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        }
        
        // Initialize event listeners
        function initEventListeners() {
            // Tab switching
            document.querySelectorAll('.tab').forEach(tab => {
                tab.addEventListener('click', function() {
                    const tabName = this.getAttribute('onclick').match(/switchTab\('(.+?)'\)/)[1];
                    switchTab(tabName);
                });
            });
            
            // Search input
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', function(e) {
                    const searchTerm = e.target.value.toLowerCase();
                    const deviceCards = document.querySelectorAll('.device-card');
                    
                    deviceCards.forEach(card => {
                        const deviceName = card.querySelector('.device-name').textContent.toLowerCase();
                        card.style.display = deviceName.includes(searchTerm) ? 'block' : 'none';
                    });
                });
            }
        }
        
        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            initEventListeners();
            renderCharts();
            
            // Close modal on escape key
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && deviceModalOpen) {
                    closeDeviceModal();
                }
            });
            
            // Close modal when clicking outside
            document.getElementById('deviceModal').addEventListener('click', function(e) {
                if (e.target === this) {
                    closeDeviceModal();
                }
            });
        });
    </script>
</body>
</html>
  `;
}