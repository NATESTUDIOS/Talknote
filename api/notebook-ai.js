// api/notebook-ai.js
import { db } from "../utils/firebase.js";

// ==================== CONFIGURATION ====================
// CHANGE THESE VALUES AS NEEDED
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Model Configuration
const HEADING_MODEL = "gemini-1.5-flash";    // For title/summary generation (fast & cheap)
const PROCESS_MODEL = "gemini-1.5-pro";      // For command processing (more capable)

// Usage Limits (per user)
const DAILY_AI_LIMIT = 60;                   // Max 60 AI calls per user per day
const MAX_CONTENT_LENGTH = 10000;            // Max characters per request

// Token Limits
const HEADING_MAX_TOKENS = 500;
const PROCESS_MAX_TOKENS = 2000;
// ======================================================

// Helper to validate user existence
async function validateUser(userId) {
  const snapshot = await db.ref('users').orderByChild('user_id').equalTo(userId).once('value');
  return snapshot.exists();
}

// Helper to check and update user usage
async function checkAndUpdateUsage(userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const usageKey = `usage/${userId}/${today}`;
  
  const snapshot = await db.ref(usageKey).once('value');
  const currentUsage = snapshot.val() || 0;
  
  if (currentUsage >= DAILY_AI_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      limit: DAILY_AI_LIMIT
    };
  }
  
  // Increment usage
  await db.ref(usageKey).set(currentUsage + 1);
  
  return {
    allowed: true,
    remaining: DAILY_AI_LIMIT - (currentUsage + 1),
    limit: DAILY_AI_LIMIT
  };
}

// Get user's usage stats
async function getUserUsage(userId) {
  const today = new Date().toISOString().split('T')[0];
  const usageKey = `usage/${userId}/${today}`;
  
  const snapshot = await db.ref(usageKey).once('value');
  const currentUsage = snapshot.val() || 0;
  
  return {
    used: currentUsage,
    remaining: Math.max(0, DAILY_AI_LIMIT - currentUsage),
    limit: DAILY_AI_LIMIT,
    reset_date: today
  };
}

// Call Gemini REST API with specific model
async function callGemini(prompt, model, maxTokens) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
        topP: 0.8,
        topK: 40
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  
  throw new Error('Invalid response from Gemini API');
}

// Generate heading and summary (uses HEADING_MODEL)
async function generateHeadingSummary(content, type = 'note') {
  const prompt = `Generate a title and summary for this ${type}.

Content:
${content.substring(0, 3000)}

Format your response EXACTLY like this:
TITLE: [2-3 word title]
SUMMARY: [1-2 sentence summary]

Make the title catchy and relevant. Make the summary concise and capture the essence.`;

  const result = await callGemini(prompt, HEADING_MODEL, HEADING_MAX_TOKENS);
  
  // Parse response
  const titleMatch = result.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  const summaryMatch = result.match(/SUMMARY:\s*(.+)/i);
  
  return {
    title: titleMatch ? titleMatch[1].trim() : 'Untitled',
    summary: summaryMatch ? summaryMatch[1].trim() : 'No summary available.'
  };
}

// Pre-defined commands
const PREDEFINED_COMMANDS = {
  // Content enhancement
  'summarize': 'Provide a concise 3-5 bullet point summary of the key points.',
  'improve': 'Fix grammar, spelling, and improve readability while keeping the original meaning.',
  'simplify': 'Make this content simpler and easier to understand.',
  'expand': 'Add more details, examples, and explanations.',
  'organize': 'Reorganize with clear sections and logical flow.',
  
  // Analysis
  'analyze': 'Identify key themes, insights, and main ideas.',
  'action-items': 'Extract actionable tasks and to-do items.',
  'questions': 'Generate 5 relevant questions based on this content.',
  'keywords': 'Extract 5-7 key keywords or phrases.',
  
  // Formatting
  'bullet-points': 'Convert into clear bullet points.',
  'markdown': 'Format as clean markdown with proper headings.',
  'checklist': 'Convert into a step-by-step checklist.',
  
  // Learning
  'explain': 'Explain the concepts in simple terms.',
  'study-guide': 'Create a study guide with key concepts.',
  
  // Creative
  'brainstorm': 'Brainstorm related ideas and expansions.',
  'rewrite': 'Rewrite in a different style while keeping the core message.',
  
  // Utility
  'translate': 'Translate to clear, natural English.',
  'tl-dr': 'Create a one-sentence TL;DR summary.'
};

// Process content with command (uses PROCESS_MODEL)
async function processContent(content, command, type = 'note') {
  let prompt;
  
  if (PREDEFINED_COMMANDS[command]) {
    // Use predefined command
    prompt = `${PREDEFINED_COMMANDS[command]}\n\nContent:\n${content}`;
  } else {
    // Use custom command (any text passed as command)
    prompt = `${command}\n\nContent:\n${content}`;
  }

  const result = await callGemini(prompt, PROCESS_MODEL, PROCESS_MAX_TOKENS);
  
  return {
    result,
    command: command,
    isPredefined: PREDEFINED_COMMANDS.hasOwnProperty(command),
    description: PREDEFINED_COMMANDS[command] || `Custom instruction: ${command}`
  };
}

// Main API handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  try {
    const { action, user_id, content, type = 'note', command } = req.body;

    // Validate required fields
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // Verify user exists
    const userExists = await validateUser(user_id);
    if (!userExists) {
      return res.status(401).json({
        success: false,
        error: 'User does not exist or is not authorized'
      });
    }

    // Route based on action
    switch (action) {
      case 'heading':
        // Generate heading and summary
        if (!content) {
          return res.status(400).json({
            success: false,
            error: 'content is required for heading generation'
          });
        }

        // Check usage limit
        const headingUsage = await checkAndUpdateUsage(user_id);
        if (!headingUsage.allowed) {
          return res.status(429).json({
            success: false,
            error: 'Daily AI usage limit exceeded',
            limit: headingUsage.limit,
            remaining: 0
          });
        }

        // Content length limit
        if (content.length > MAX_CONTENT_LENGTH) {
          return res.status(400).json({
            success: false,
            error: `Content too long (max ${MAX_CONTENT_LENGTH} characters)`
          });
        }

        const headingResult = await generateHeadingSummary(content, type);
        return res.status(200).json({
          success: true,
          title: headingResult.title,
          summary: headingResult.summary,
          type,
          timestamp: Date.now(),
          model: HEADING_MODEL,
          usage: {
            used: headingUsage.limit - headingUsage.remaining,
            remaining: headingUsage.remaining,
            limit: headingUsage.limit
          }
        });

      case 'process':
        // Process with command
        if (!content) {
          return res.status(400).json({
            success: false,
            error: 'content is required'
          });
        }

        if (!command) {
          return res.status(400).json({
            success: false,
            error: 'command is required'
          });
        }

        // Check usage limit
        const processUsage = await checkAndUpdateUsage(user_id);
        if (!processUsage.allowed) {
          return res.status(429).json({
            success: false,
            error: 'Daily AI usage limit exceeded',
            limit: processUsage.limit,
            remaining: 0
          });
        }

        // Content length limit
        if (content.length > MAX_CONTENT_LENGTH) {
          return res.status(400).json({
            success: false,
            error: `Content too long (max ${MAX_CONTENT_LENGTH} characters)`
          });
        }

        const processResult = await processContent(content, command, type);
        return res.status(200).json({
          success: true,
          result: processResult.result,
          command: processResult.command,
          is_predefined: processResult.isPredefined,
          description: processResult.description,
          type,
          timestamp: Date.now(),
          model: PROCESS_MODEL,
          usage: {
            used: processUsage.limit - processUsage.remaining,
            remaining: processUsage.remaining,
            limit: processUsage.limit
          }
        });

      case 'commands':
        // List available commands (doesn't count toward usage)
        if (!user_id) {
          return res.status(400).json({
            success: false,
            error: 'user_id is required'
          });
        }

        const commandsList = Object.entries(PREDEFINED_COMMANDS).map(([name, description]) => ({
          name,
          description: description.split('.')[0] + '.',
          example: `Use "command": "${name}" in your request`
        }));
        
        const userUsage = await getUserUsage(user_id);
        
        return res.status(200).json({
          success: true,
          commands: commandsList,
          total: commandsList.length,
          timestamp: Date.now(),
          usage: userUsage
        });

      case 'usage':
        // Get user usage stats (doesn't count toward usage)
        if (!user_id) {
          return res.status(400).json({
            success: false,
            error: 'user_id is required'
          });
        }

        const usageStats = await getUserUsage(user_id);
        return res.status(200).json({
          success: true,
          usage: usageStats,
          timestamp: Date.now()
        });

      case 'config':
        // Return current configuration (read-only, doesn't count toward usage)
        return res.status(200).json({
          success: true,
          config: {
            heading_model: HEADING_MODEL,
            process_model: PROCESS_MODEL,
            max_content_length: MAX_CONTENT_LENGTH,
            daily_ai_limit: DAILY_AI_LIMIT,
            heading_max_tokens: HEADING_MAX_TOKENS,
            process_max_tokens: PROCESS_MAX_TOKENS,
            available_actions: ['heading', 'process', 'commands', 'usage', 'config'],
            total_predefined_commands: Object.keys(PREDEFINED_COMMANDS).length
          },
          timestamp: Date.now()
        });

      default:
        return res.status(400).json({
          success: false,
          error: 'Valid action required: heading, process, commands, usage, or config'
        });
    }

  } catch (error) {
    console.error('AI API error:', error);

    // Gemini API specific errors
    if (error.message.includes('API_KEY') || error.message.includes('quota')) {
      return res.status(503).json({
        success: false,
        error: 'AI service temporarily unavailable'
      });
    }

    if (error.message.includes('safety') || error.message.includes('blocked')) {
      return res.status(400).json({
        success: false,
        error: 'Content could not be processed due to safety policies'
      });
    }

    if (error.message.includes('model not found') || error.message.includes('invalid model')) {
      return res.status(400).json({
        success: false,
        error: `Invalid model configuration. Please check the model names.`
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}