import { db } from "../utils/firebase.js";
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from "@google/genai";

// =============== CONFIGURATION ===============
const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_TEMPERATURE = 0.7;
const GEMINI_MAX_TOKENS = 8192;
const CACHE_TTL_MS = 3600000; // 1 hour
const DEFAULT_WEBSITE_TYPE = "general";
const DEFAULT_VARIATIONS = 3;
const MAX_VARIATIONS = 10;
// =============================================

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `
You are a world-class UI/UX Designer and Frontend Engineer known for building award-winning, "Awwwards" style websites. 
Your goal is to generate HTML websites that are visually stunning, modern, and have a "premium" feel.

**Design Philosophy (Strictly Follow):**
1.  **Modern Aesthetics:** Use glassmorphism (backdrop-blur), deep gradients, subtle borders (border-white/10), and dark mode by default unless specified otherwise.
2.  **Typography:** Use large, bold headings (text-5xl to text-7xl) for hero sections. Use wide letter spacing (tracking-tight) for a modern look.
3.  **Layout:** Use "Bento Grid" layouts, asymmetrical grids, and plenty of whitespace (padding/margins). Avoid cramped designs.
4.  **Components:**
    -   **Buttons:** sleek, pill-shaped, or soft-rounded with subtle glows/shadows.
    -   **Cards:** glass effect (bg-white/5 border-white/10) or clean solid backgrounds with hover lift effects.
    -   **Images:** Use high-quality placement placeholders (https://picsum.photos/...) with rounded corners (rounded-2xl or rounded-3xl).
5.  **Color Palette:** Prefer rich, deep backgrounds (slate-900, zinc-950, indigo-950) with vibrant accents (violet, blue, emerald, orange) used sparingly but effectively in gradients or buttons.

**Technical Requirements:**
1.  **Single File:** Output a single valid HTML5 string.
2.  **Framework:** Tailwind CSS (via CDN). Use arbitrary values (e.g., h-[500px], bg-[#1a1a1a]) if needed for precision.
3.  **Icons:** FontAwesome (via CDN). Use them generously for visual cues.
4.  **Interactivity:** Write JavaScript for:
    -   Mobile menu toggles (Mandatory).
    -   Simple scroll animations (e.g., fade-in on scroll using IntersectionObserver).
    -   Interactive hover states.
5.  **Output Format:** Return ONLY the raw HTML. No markdown code blocks. No explanations.

**Site Types Strategy:**
-   **Landing:** High-impact Hero, Feature Grid (Bento style), Trust Signals (Logos), FAQ, Sticky CTA.
-   **Portfolio:** Large personal name, creative bio, masonry project grid, minimal contact section.
-   **Ecommerce:** Clean product cards with hover-reveal details, sticky cart indicator, categorized sections.
`;

// Cache for frequently generated websites
const generationCache = new Map();

// Helper to find user by user_id (matching your auth API pattern)
async function findUserByUserId(userId) {
  const snapshot = await db.ref('users').orderByChild('user_id').equalTo(userId).once('value');
  if (snapshot.exists()) {
    const users = snapshot.val();
    const uid = Object.keys(users)[0];
    return { uid, ...users[uid] };
  }
  return null;
}

// Validate user existence
async function validateUserExistence(userId) {
  const user = await findUserByUserId(userId);
  return user !== null;
}

// Generate HTML from prompt
async function generateHtmlCode(prompt, type = DEFAULT_WEBSITE_TYPE) {
  try {
    // Check cache first
    const cacheKey = `${prompt}:${type}`;
    if (generationCache.has(cacheKey)) {
      console.log('Cache hit for:', cacheKey.substring(0, 50));
      return generationCache.get(cacheKey);
    }

    let typeInstruction = "";
    switch (type) {
      case 'landing':
        typeInstruction = "Focus on conversion. Hero section must be immersive with a gradient background or abstract shape. Use a Bento-grid layout for features.";
        break;
      case 'portfolio':
        typeInstruction = "Focus on personal branding. Use massive typography for the name. Create a 'masonry' style layout for the project gallery.";
        break;
      case 'blog':
        typeInstruction = "Focus on readability and content discovery. deeply aesthetic card-based article list. Sidebar with glassmorphism effect.";
        break;
      case 'ecommerce':
        typeInstruction = "Focus on product presentation. Minimalist luxury aesthetic. Product cards should focus on the image. Use a sidebar or drawer for filters if possible.";
        break;
      case 'dashboard':
        typeInstruction = "Focus on data visualization and clarity. Use clean cards, charts, and a sidebar navigation. Dark mode with accent colors for metrics.";
        break;
      default:
        typeInstruction = "Create a versatile, modern structure suitable for a SaaS or creative agency.";
    }

    const fullPrompt = `Website Type: ${type}\nSpecific Direction: ${typeInstruction}\n\nUser Request: ${prompt}`;

    console.log('Generating HTML for type:', type);
    
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: fullPrompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: GEMINI_TEMPERATURE,
        maxOutputTokens: GEMINI_MAX_TOKENS,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("No content generated.");
    }

    const html = text.replace(/^```html\s*/, '').replace(/```$/, '').trim();
    
    // Cache the result
    generationCache.set(cacheKey, html);
    setTimeout(() => generationCache.delete(cacheKey), CACHE_TTL_MS);
    
    return html;
  } catch (error) {
    console.error("Error generating website:", error);
    throw error;
  }
}

// Create a new website
async function createWebsite(userId, websiteData, versionData) {
  const websiteId = uuidv4();
  const versionId = uuidv4();
  const timestamp = Date.now();

  // Website object
  const website = {
    website_id: websiteId,
    user_id: userId,
    project_name: websiteData.project_name || 'New Website',
    description: websiteData.description || '',
    type: websiteData.type || DEFAULT_WEBSITE_TYPE,
    is_public: websiteData.is_public !== undefined ? Boolean(websiteData.is_public) : false,
    tags: websiteData.tags || [],
    thumbnail: websiteData.thumbnail || '',
    total_versions: 1,
    latest_version_id: versionId,
    total_edits: 0,
    total_views: 0,
    total_forks: 0,
    created_at: timestamp,
    updated_at: timestamp
  };

  // Version object
  const version = {
    version_id: versionId,
    website_id: websiteId,
    user_id: userId,
    html: versionData.html,
    prompt: versionData.prompt,
    edit_prompt: versionData.edit_prompt || null,
    type: versionData.type || DEFAULT_WEBSITE_TYPE,
    is_initial: true,
    version_number: 1.0,
    parent_version_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    view_count: 0,
    fork_count: 0
  };

  // Save to Firebase
  await db.ref(`websites/${websiteId}`).set(website);
  await db.ref(`website_versions/${versionId}`).set(version);

  return { website, version };
}

// Get website by ID
async function getWebsiteById(websiteId) {
  const snapshot = await db.ref(`websites/${websiteId}`).once('value');
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return null;
}

// Get version by ID
async function getVersionById(versionId) {
  const snapshot = await db.ref(`website_versions/${versionId}`).once('value');
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return null;
}

// Get website with latest version
async function getWebsiteWithLatestVersion(websiteId, includeHtml = true) {
  const website = await getWebsiteById(websiteId);
  if (!website) return null;

  const version = await getVersionById(website.latest_version_id);
  if (!version) return { ...website, latest_version: null };

  const result = {
    ...website,
    latest_version: {
      version_id: version.version_id,
      version_number: version.version_number,
      prompt: version.prompt,
      type: version.type,
      created_at: version.created_at
    }
  };

  if (includeHtml) {
    result.latest_version.html = version.html;
  }

  return result;
}

// Edit a website (create new version)
async function editWebsite(websiteId, userId, editData) {
  const website = await getWebsiteById(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  // Check if user owns the website
  if (website.user_id !== userId) {
    throw new Error('Unauthorized: You do not own this website');
  }

  const latestVersion = await getVersionById(website.latest_version_id);
  if (!latestVersion) {
    throw new Error('No version found for website');
  }

  // Generate edited HTML
  const combinedPrompt = `
    Original Prompt: ${latestVersion.prompt}
    Original Type: ${latestVersion.type}
    
    Edit Request: ${editData.edit_prompt}
    
    Please modify the following HTML according to the edit request:
    ${latestVersion.html}
  `;

  const editedHtml = await generateHtmlCode(combinedPrompt, latestVersion.type);

  // Create new version
  const newVersionId = uuidv4();
  const timestamp = Date.now();
  
  const newVersion = {
    version_id: newVersionId,
    website_id: websiteId,
    user_id: userId,
    html: editedHtml,
    prompt: latestVersion.prompt,
    edit_prompt: editData.edit_prompt,
    type: latestVersion.type,
    is_initial: false,
    version_number: editData.is_major_edit ? 
      Math.floor(latestVersion.version_number) + 1 : 
      latestVersion.version_number + 0.1,
    parent_version_id: latestVersion.version_id,
    created_at: timestamp,
    updated_at: timestamp,
    view_count: 0,
    fork_count: 0
  };

  // Save new version
  await db.ref(`website_versions/${newVersionId}`).set(newVersion);

  // Update website
  await db.ref(`websites/${websiteId}`).update({
    latest_version_id: newVersionId,
    total_versions: website.total_versions + 1,
    total_edits: (website.total_edits || 0) + 1,
    updated_at: timestamp
  });

  return { website: { ...website, latest_version_id: newVersionId }, version: newVersion };
}

// Fork a website
async function forkWebsite(originalWebsiteId, userId, forkData = {}) {
  const originalWebsite = await getWebsiteById(originalWebsiteId);
  if (!originalWebsite) {
    throw new Error('Original website not found');
  }

  // Check if website is public
  if (!originalWebsite.is_public) {
    throw new Error('Cannot fork private websites');
  }

  const latestVersion = await getVersionById(originalWebsite.latest_version_id);
  if (!latestVersion) {
    throw new Error('No version found for website');
  }

  // Create new website
  const newWebsiteId = uuidv4();
  const newVersionId = uuidv4();
  const timestamp = Date.now();

  // New website object
  const newWebsite = {
    website_id: newWebsiteId,
    user_id: userId,
    project_name: forkData.project_name || `Fork of ${originalWebsite.project_name}`,
    description: forkData.description || originalWebsite.description,
    type: originalWebsite.type,
    is_public: forkData.is_public !== undefined ? Boolean(forkData.is_public) : false,
    tags: forkData.tags || originalWebsite.tags,
    is_fork: true,
    original_website_id: originalWebsiteId,
    original_user_id: originalWebsite.user_id,
    total_versions: 1,
    latest_version_id: newVersionId,
    total_edits: 0,
    total_views: 0,
    total_forks: 0,
    created_at: timestamp,
    updated_at: timestamp
  };

  // New version object
  const newVersion = {
    version_id: newVersionId,
    website_id: newWebsiteId,
    user_id: userId,
    html: latestVersion.html,
    prompt: forkData.prompt || latestVersion.prompt,
    edit_prompt: null,
    type: latestVersion.type,
    is_initial: true,
    version_number: 1.0,
    parent_version_id: latestVersion.version_id,
    is_fork: true,
    created_at: timestamp,
    updated_at: timestamp,
    view_count: 0,
    fork_count: 0
  };

  // Save to Firebase
  await db.ref(`websites/${newWebsiteId}`).set(newWebsite);
  await db.ref(`website_versions/${newVersionId}`).set(newVersion);

  // Update original website fork count
  await db.ref(`websites/${originalWebsiteId}`).update({
    total_forks: (originalWebsite.total_forks || 0) + 1,
    updated_at: timestamp
  });

  return { website: newWebsite, version: newVersion };
}

// Update website metadata
async function updateWebsite(websiteId, userId, updateData) {
  const website = await getWebsiteById(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  // Check if user owns the website
  if (website.user_id !== userId) {
    throw new Error('Unauthorized: You do not own this website');
  }

  const allowedUpdates = ['project_name', 'description', 'is_public', 'tags', 'thumbnail'];
  const updates = {
    updated_at: Date.now()
  };

  Object.keys(updateData).forEach(key => {
    if (allowedUpdates.includes(key)) {
      updates[key] = updateData[key];
    }
  });

  await db.ref(`websites/${websiteId}`).update(updates);

  return { ...website, ...updates };
}

// Delete website
async function deleteWebsite(websiteId, userId) {
  const website = await getWebsiteById(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  // Check if user owns the website
  if (website.user_id !== userId) {
    throw new Error('Unauthorized: You do not own this website');
  }

  // Delete website
  await db.ref(`websites/${websiteId}`).remove();

  // Find and delete all versions
  const versionsSnapshot = await db.ref('website_versions')
    .orderByChild('website_id')
    .equalTo(websiteId)
    .once('value');
  
  if (versionsSnapshot.exists()) {
    const versions = versionsSnapshot.val();
    const deletePromises = Object.keys(versions).map(versionId => 
      db.ref(`website_versions/${versionId}`).remove()
    );
    await Promise.all(deletePromises);
  }

  return true;
}

// List websites
async function listWebsites(filters = {}) {
  let websites = [];

  // Get all websites
  const snapshot = await db.ref('websites').once('value');
  if (!snapshot.exists()) {
    return [];
  }

  websites = Object.values(snapshot.val());

  // Apply filters
  if (filters.user_id) {
    websites = websites.filter(website => website.user_id === filters.user_id);
  }

  if (filters.is_public !== undefined) {
    websites = websites.filter(website => website.is_public === filters.is_public);
  }

  if (filters.type) {
    websites = websites.filter(website => website.type === filters.type);
  }

  if (filters.tags && filters.tags.length > 0) {
    websites = websites.filter(website => 
      website.tags && website.tags.some(tag => filters.tags.includes(tag))
    );
  }

  // Sort by updated_at descending
  websites.sort((a, b) => b.updated_at - a.updated_at);

  // Apply limit
  if (filters.limit) {
    websites = websites.slice(0, filters.limit);
  }

  return websites;
}

// Track view
async function trackView(websiteId, userId = null) {
  const website = await getWebsiteById(websiteId);
  if (!website) return;

  const updates = {
    total_views: (website.total_views || 0) + 1,
    updated_at: Date.now()
  };

  await db.ref(`websites/${websiteId}`).update(updates);
}

// Generate multiple variations
async function generateVariations(prompt, type = DEFAULT_WEBSITE_TYPE, variations = DEFAULT_VARIATIONS) {
  const actualVariations = Math.min(variations, MAX_VARIATIONS);
  const results = [];
  
  for (let i = 0; i < actualVariations; i++) {
    const variedPrompt = `${prompt} (variation ${i + 1}: focus on unique layout and color scheme)`;
    const html = await generateHtmlCode(variedPrompt, type);
    
    results.push({
      variation_id: i + 1,
      html,
      prompt: variedPrompt,
      type
    });
  }
  
  return results;
}

// Get all versions of a website
async function getWebsiteVersions(websiteId, userId = null) {
  const website = await getWebsiteById(websiteId);
  if (!website) return null;

  // Check if user has access
  if (!website.is_public && website.user_id !== userId) {
    throw new Error('Unauthorized: This website is private');
  }

  // Get all versions
  const versionsSnapshot = await db.ref('website_versions')
    .orderByChild('website_id')
    .equalTo(websiteId)
    .once('value');
  
  if (!versionsSnapshot.exists()) {
    return { ...website, versions: [] };
  }

  const versions = versionsSnapshot.val();
  const versionsArray = Object.values(versions).sort((a, b) => b.version_number - a.version_number);

  return {
    ...website,
    versions: versionsArray
  };
}

// Get websites forked from a specific website
async function getForkedWebsites(originalWebsiteId) {
  const snapshot = await db.ref('websites')
    .orderByChild('original_website_id')
    .equalTo(originalWebsiteId)
    .once('value');
  
  if (!snapshot.exists()) {
    return [];
  }

  return Object.values(snapshot.val());
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { method, query } = req;
    const action = query.action || (req.body && req.body.action);

    switch (method) {
      case 'POST':
        if (action === 'generate') {
          return await handleGenerate(req, res);
        } else if (action === 'edit') {
          return await handleEdit(req, res);
        } else if (action === 'fork') {
          return await handleFork(req, res);
        } else if (action === 'generate_variations') {
          return await handleGenerateVariations(req, res);
        } else {
          return await handleCreateWebsite(req, res);
        }
      case 'GET':
        if (action === 'preview') {
          return await handlePreview(req, res);
        } else if (action === 'versions') {
          return await handleGetVersions(req, res);
        } else if (action === 'forked_from') {
          return await handleGetForkedFrom(req, res);
        } else {
          return await handleGetWebsites(req, res);
        }
      case 'PUT':
        return await handleUpdateWebsite(req, res);
      case 'DELETE':
        return await handleDeleteWebsite(req, res);
      default:
        return res.status(405).json({
          success: false,
          error: 'Method not allowed'
        });
    }
  } catch (error) {
    console.error('Website API error:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'An error occurred'
    });
  }
}

// POST /api/generate-website - Create new website
async function handleCreateWebsite(req, res) {
  try {
    const { user_id, project_name, description, type, is_public, tags, prompt } = req.body;

    // Validate required fields
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    // Validate user existence
    const userExists = await validateUserExistence(user_id);
    if (!userExists) {
      return res.status(400).json({
        success: false,
        error: 'User does not exist'
      });
    }

    // Generate HTML
    const html = await generateHtmlCode(prompt, type || DEFAULT_WEBSITE_TYPE);

    // Create website
    const { website, version } = await createWebsite(user_id, {
      project_name: project_name || 'New Website',
      description: description || '',
      type: type || DEFAULT_WEBSITE_TYPE,
      is_public: is_public !== undefined ? Boolean(is_public) : false,
      tags: tags || []
    }, {
      html,
      prompt,
      type: type || DEFAULT_WEBSITE_TYPE
    });

    // Track view
    await trackView(website.website_id, user_id);

    return res.status(201).json({
      success: true,
      data: {
        website: {
          website_id: website.website_id,
          project_name: website.project_name,
          description: website.description,
          type: website.type,
          is_public: website.is_public,
          tags: website.tags,
          total_versions: website.total_versions,
          latest_version_id: website.latest_version_id,
          created_at: website.created_at,
          updated_at: website.updated_at
        },
        version: {
          version_id: version.version_id,
          version_number: version.version_number,
          prompt: version.prompt,
          type: version.type
        },
        html: html
      },
      message: 'Website created successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// POST /api/generate-website?action=generate - Just generate HTML (no save, public)
async function handleGenerate(req, res) {
  try {
    const { prompt, type } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    const html = await generateHtmlCode(prompt, type || DEFAULT_WEBSITE_TYPE);

    return res.status(200).json({
      success: true,
      data: {
        html: html,
        prompt: prompt,
        type: type || DEFAULT_WEBSITE_TYPE
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// POST /api/generate-website?action=edit - Edit existing website
async function handleEdit(req, res) {
  try {
    const { website_id, user_id, edit_prompt, is_major_edit } = req.body;

    if (!website_id || !user_id || !edit_prompt) {
      return res.status(400).json({
        success: false,
        error: 'Website ID, User ID, and Edit Prompt are required'
      });
    }

    const result = await editWebsite(website_id, user_id, {
      edit_prompt,
      is_major_edit: is_major_edit || false
    });

    return res.status(200).json({
      success: true,
      data: {
        website: {
          website_id: result.website.website_id,
          project_name: result.website.project_name,
          latest_version_id: result.website.latest_version_id,
          total_versions: result.website.total_versions,
          total_edits: result.website.total_edits
        },
        version: {
          version_id: result.version.version_id,
          version_number: result.version.version_number,
          edit_prompt: result.version.edit_prompt,
          parent_version_id: result.version.parent_version_id
        },
        html: result.version.html
      },
      message: 'Website edited successfully'
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    } else if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// POST /api/generate-website?action=fork - Fork a website
async function handleFork(req, res) {
  try {
    const { website_id, user_id, project_name, is_public } = req.body;

    if (!website_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Website ID and User ID are required'
      });
    }

    // Validate user existence
    const userExists = await validateUserExistence(user_id);
    if (!userExists) {
      return res.status(400).json({
        success: false,
        error: 'User does not exist'
      });
    }

    const result = await forkWebsite(website_id, user_id, {
      project_name,
      is_public
    });

    return res.status(201).json({
      success: true,
      data: {
        website: {
          website_id: result.website.website_id,
          project_name: result.website.project_name,
          is_public: result.website.is_public,
          is_fork: true,
          original_website_id: result.website.original_website_id,
          original_user_id: result.website.original_user_id
        },
        version: {
          version_id: result.version.version_id,
          is_fork: true,
          parent_version_id: result.version.parent_version_id
        },
        html: result.version.html
      },
      message: 'Website forked successfully'
    });
  } catch (error) {
    if (error.message.includes('private')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    } else if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// POST /api/generate-website?action=generate_variations - Generate multiple variations (public)
async function handleGenerateVariations(req, res) {
  try {
    const { prompt, type, variations } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    const actualVariations = Math.min(variations || DEFAULT_VARIATIONS, MAX_VARIATIONS);
    const results = await generateVariations(prompt, type || DEFAULT_WEBSITE_TYPE, actualVariations);

    return res.status(200).json({
      success: true,
      data: {
        variations: results,
        count: results.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// GET /api/generate-website - List websites or get specific website
async function handleGetWebsites(req, res) {
  try {
    const { website_id, user_id, public_only, type, tags, limit } = req.query;

    // Get single website
    if (website_id) {
      const userId = user_id || null;
      
      const website = await getWebsiteWithLatestVersion(website_id, true);

      if (!website) {
        return res.status(404).json({
          success: false,
          error: 'Website not found'
        });
      }

      // Check access
      if (!website.is_public && website.user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. This website is private.'
        });
      }

      // Track view
      await trackView(website_id, userId);

      return res.status(200).json({
        success: true,
        data: {
          website: website
        }
      });
    }

    // List websites
    const filters = {};
    if (user_id) filters.user_id = user_id;
    if (public_only === 'true') filters.is_public = true;
    if (type) filters.type = type;
    if (tags) filters.tags = tags.split(',');
    if (limit) filters.limit = parseInt(limit);

    // If no user_id specified and not public_only, return only public websites
    if (!user_id && public_only !== 'true') {
      filters.is_public = true;
    }

    const websites = await listWebsites(filters);

    return res.status(200).json({
      success: true,
      data: {
        websites: websites,
        count: websites.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// GET /api/generate-website?action=preview - Preview HTML (public)
async function handlePreview(req, res) {
  try {
    const { html } = req.query;

    if (!html) {
      return res.status(400).json({
        success: false,
        error: 'HTML content is required'
      });
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// GET /api/generate-website?action=versions - Get all versions of a website
async function handleGetVersions(req, res) {
  try {
    const { website_id, user_id } = req.query;

    if (!website_id) {
      return res.status(400).json({
        success: false,
        error: 'Website ID is required'
      });
    }

    const userId = user_id || null;
    const website = await getWebsiteVersions(website_id, userId);

    if (!website) {
      return res.status(404).json({
        success: false,
        error: 'Website not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        website: {
          website_id: website.website_id,
          project_name: website.project_name,
          user_id: website.user_id,
          is_public: website.is_public,
          total_versions: website.total_versions
        },
        versions: website.versions.map(v => ({
          version_id: v.version_id,
          version_number: v.version_number,
          prompt: v.prompt,
          edit_prompt: v.edit_prompt,
          created_at: v.created_at,
          view_count: v.view_count
        })),
        count: website.versions.length
      }
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    } else if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// GET /api/generate-website?action=forked_from - Get websites forked from a specific website (public)
async function handleGetForkedFrom(req, res) {
  try {
    const { website_id } = req.query;

    if (!website_id) {
      return res.status(400).json({
        success: false,
        error: 'Website ID is required'
      });
    }

    const forks = await getForkedWebsites(website_id);

    return res.status(200).json({
      success: true,
      data: {
        forks: forks,
        count: forks.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// PUT /api/generate-website - Update website metadata
async function handleUpdateWebsite(req, res) {
  try {
    const { website_id, user_id, project_name, description, is_public, tags, thumbnail } = req.body;

    if (!website_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Website ID and User ID are required'
      });
    }

    const updateData = {};
    if (project_name !== undefined) updateData.project_name = project_name;
    if (description !== undefined) updateData.description = description;
    if (is_public !== undefined) updateData.is_public = Boolean(is_public);
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [tags];
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;

    const updatedWebsite = await updateWebsite(website_id, user_id, updateData);

    return res.status(200).json({
      success: true,
      data: {
        website: updatedWebsite
      },
      message: 'Website updated successfully'
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    } else if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// DELETE /api/generate-website - Delete website
async function handleDeleteWebsite(req, res) {
  try {
    const { website_id, user_id } = req.query;

    if (!website_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Website ID and User ID are required'
      });
    }

    await deleteWebsite(website_id, user_id);

    return res.status(200).json({
      success: true,
      message: 'Website deleted successfully'
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    } else if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}