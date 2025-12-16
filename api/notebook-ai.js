// api/notebook-ai.js
import { db } from "../utils/firebase.js";

// Gemini REST API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// Helper to validate user existence
async function validateUser(userId) {
  const snapshot = await db.ref('users').orderByChild('user_id').equalTo(userId).once('value');
  return snapshot.exists();
}

// Call Gemini REST API
async function callGemini(prompt, maxTokens = 1000) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
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

// Generate heading and summary
async function generateHeadingSummary(content, type = 'note') {
  const prompt = `Generate a title and summary for this ${type}.

Content:
${content.substring(0, 3000)}

Format your response EXACTLY like this:
TITLE: [2-3 word title]
SUMMARY: [1-2 sentence summary]

Make the title catchy and relevant. Make the summary concise and capture the essence.`;

  const result = await callGemini(prompt, 500);
  
  // Parse response
  const titleMatch = result.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  const summaryMatch = result.match(/SUMMARY:\s*(.+)/i);
  
  return {
    title: titleMatch ? titleMatch[1].trim() : 'Untitled',
    summary: summaryMatch ? summaryMatch[1].trim() : 'No summary available.'
  };
}

// Pre-defined commands
const COMMANDS = {
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

// Process content with command
async function processCommand(content, command, type = 'note', customPrompt = null) {
  let prompt;
  
  if (customPrompt) {
    prompt = `${customPrompt}\n\nContent:\n${content}`;
  } else if (COMMANDS[command]) {
    prompt = `${COMMANDS[command]}\n\nContent:\n${content}`;
  } else {
    throw new Error(`Unknown command: ${command}. Available commands: ${Object.keys(COMMANDS).join(', ')}`);
  }

  const result = await callGemini(prompt);
  
  return {
    result,
    command: customPrompt ? 'custom' : command,
    description: customPrompt ? `Custom: ${customPrompt}` : COMMANDS[command]
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
    const { action, user_id, content, type = 'note', command, custom_prompt } = req.body;

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

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'content is required'
      });
    }

    // Content length limit
    if (content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Content too long (max 10000 characters)'
      });
    }

    // Route based on action
    switch (action) {
      case 'heading':
        // Generate heading and summary
        const headingResult = await generateHeadingSummary(content, type);
        return res.status(200).json({
          success: true,
          title: headingResult.title,
          summary: headingResult.summary,
          type,
          timestamp: Date.now()
        });

      case 'process':
        // Process with command
        if (!command && !custom_prompt) {
          return res.status(400).json({
            success: false,
            error: 'Either command or custom_prompt is required'
          });
        }

        const processResult = await processCommand(content, command, type, custom_prompt);
        return res.status(200).json({
          success: true,
          result: processResult.result,
          command: processResult.command,
          description: processResult.description,
          type,
          timestamp: Date.now()
        });

      case 'commands':
        // List available commands
        return res.status(200).json({
          success: true,
          commands: Object.keys(COMMANDS),
          total: Object.keys(COMMANDS).length,
          timestamp: Date.now()
        });

      default:
        return res.status(400).json({
          success: false,
          error: 'Valid action required: heading, process, or commands'
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

    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}