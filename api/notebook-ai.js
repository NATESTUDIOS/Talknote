// pages/api/talknote/ai.js (for Next.js) or api/talknote/ai.js (for other frameworks)
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Gemini AI - using gemini-1.5-flash for heading/summary
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const headingModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const commandModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Command registry - merged standard and custom commands
const commands = new Map();

// Command descriptions for explaining what was done
const commandDescriptions = new Map();

// Pre-defined commands with descriptions
const predefinedCommands = {
  // Content Transformation
  'summarize': {
    prompt: 'Provide a concise 3-5 bullet point summary of the key points.',
    description: 'Created a bullet point summary of key points'
  },
  'auto-correct': {
    prompt: 'Fix spelling, grammar, and improve readability while keeping the original meaning.',
    description: 'Corrected spelling and grammar, improved readability'
  },
  'explain': {
    prompt: 'Explain this content in simple terms. Break down complex concepts.',
    description: 'Explained content in simpler terms'
  },
  'organize': {
    prompt: 'Reorganize this content logically with clear sections and headings.',
    description: 'Reorganized content with clear sections'
  },
  'expand': {
    prompt: 'Add more details, examples, and relevant information to expand on the ideas.',
    description: 'Expanded content with details and examples'
  },
  'simplify': {
    prompt: 'Make this content simpler and easier to understand.',
    description: 'Simplified content for better understanding'
  },
  'translate': {
    prompt: 'Translate this content to clear, natural English.',
    description: 'Translated to natural English'
  },
  'bulletize': {
    prompt: 'Convert this content into bullet points.',
    description: 'Converted to bullet point format'
  },
  
  // Analysis & Extraction
  'action-items': {
    prompt: 'Extract actionable tasks and to-do items from the content.',
    description: 'Extracted actionable tasks'
  },
  'keywords': {
    prompt: 'Extract 5-7 key keywords or phrases from the content.',
    description: 'Extracted key keywords and phrases'
  },
  'tl-dr': {
    prompt: 'Provide a one-sentence summary that captures the essence.',
    description: 'Created one-sentence TL;DR summary'
  },
  'sentiment': {
    prompt: 'Analyze the sentiment (positive, negative, neutral) and provide evidence.',
    description: 'Analyzed content sentiment'
  },
  'complexity': {
    prompt: 'Rate the complexity from 1-5 (1=simple, 5=complex) and explain why.',
    description: 'Rated content complexity'
  },
  'pros-cons': {
    prompt: 'List the pros and cons mentioned or implied in the content.',
    description: 'Listed pros and cons'
  },
  'dates': {
    prompt: 'Extract all dates, deadlines, and time references.',
    description: 'Extracted dates and deadlines'
  },
  'tags': {
    prompt: 'Suggest 3-5 relevant tags for organizing this note.',
    description: 'Suggested organizing tags'
  },
  
  // Study & Learning
  'qa': {
    prompt: 'Generate 3 questions and answers based on this content.',
    description: 'Created Q&A pairs for study'
  },
  'flashcards': {
    prompt: 'Create 5 flashcards (question/answer) for study purposes.',
    description: 'Created study flashcards'
  },
  'study-guide': {
    prompt: 'Create a study guide with key concepts and definitions.',
    description: 'Created comprehensive study guide'
  },
  'analogy': {
    prompt: 'Create an analogy to help explain the main concept.',
    description: 'Created explanatory analogy'
  },
  'examples': {
    prompt: 'Add 2-3 relevant examples to illustrate the concepts.',
    description: 'Added illustrative examples'
  },
  
  // Productivity & Formatting
  'checklist': {
    prompt: 'Convert into a step-by-step checklist with estimated times.',
    description: 'Converted to checklist format'
  },
  'markdown': {
    prompt: 'Format this content as clean markdown with proper headings.',
    description: 'Formatted as markdown'
  },
  'swot': {
    prompt: 'Perform a SWOT analysis (Strengths, Weaknesses, Opportunities, Threats).',
    description: 'Performed SWOT analysis'
  },
  'improve': {
    prompt: 'Improve this content for clarity, flow, and impact.',
    description: 'Improved content clarity and flow'
  },
  'restructure': {
    prompt: 'Restructure this content with better organization and flow.',
    description: 'Restructured content organization'
  }
};

// Register all predefined commands
Object.entries(predefinedCommands).forEach(([name, config]) => {
  commands.set(name, config.prompt);
  commandDescriptions.set(name, config.description);
});

// Helper function to parse heading response
function parseHeadingResponse(text) {
  const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  const summaryMatch = text.match(/SUMMARY:\s*(.+)/i);
  
  return {
    heading: titleMatch ? titleMatch[1].trim() : 'Untitled Note',
    summary: summaryMatch ? summaryMatch[1].trim() : 'No summary available.'
  };
}

// Generate heading and summary only using gemini-1.5
async function generateHeadingAndSummary(article, type) {
  const prompt = `
You are TalkNote - an intelligent notebook assistant. Generate a title and summary for this ${type} note.

Note content:
"""
${article.substring(0, 5000)}
"""

Instructions:
1. Title: 2-3 words, catchy, no punctuation
2. Summary: 1-2 sentences, capture the essence

Format your response exactly like this:
TITLE: [your title here]
SUMMARY: [your summary here]

Keep the summary concise and focused on the main points.`;

  try {
    const response = await headingModel.generateContent(prompt);
    const text = response.response.text();
    return parseHeadingResponse(text);
  } catch (error) {
    console.error("TalkNote heading generation error:", error);
    return {
      heading: "Untitled",
      summary: "Failed to generate summary."
    };
  }
}

// Process with a command
async function processWithCommand(article, type, command) {
  const commandTemplate = commands.get(command);
  const defaultDescription = commandDescriptions.get(command) || `Processed with "${command}" command`;
  
  if (!commandTemplate) {
    // If command doesn't exist, use it as a custom prompt
    const customPrompt = `
You are TalkNote - an intelligent notebook assistant. The user wants you to: ${command}

Note content (type: ${type}):
"""
${article}
"""

Provide the requested output in a clear, useful format.`;
    
    try {
      const response = await commandModel.generateContent(customPrompt);
      return {
        content: response.response.text(),
        actionDescription: `Custom processing: ${command}`
      };
    } catch (error) {
      console.error("TalkNote command processing error:", error);
      return {
        content: `Failed to process: ${command}. Error: ${error.message}`,
        actionDescription: 'Failed to process command'
      };
    }
  }
  
  // Use predefined command
  const prompt = `
You are TalkNote - an intelligent notebook assistant. Execute this command: ${command}

Command instructions: ${commandTemplate}

Note content (type: ${type}):
"""
${article}
"""

Provide the requested output in a clear, useful format.`;

  try {
    const response = await commandModel.generateContent(prompt);
    return {
      content: response.response.text(),
      actionDescription: defaultDescription
    };
  } catch (error) {
    console.error("TalkNote command processing error:", error);
    return {
      content: `Failed to process command "${command}". Error: ${error.message}`,
      actionDescription: 'Command processing failed'
    };
  }
}

// Register a new command
function registerCommand(name, prompt, description = null) {
  commands.set(name, prompt);
  if (description) {
    commandDescriptions.set(name, description);
  } else {
    commandDescriptions.set(name, `Processed with "${name}" command`);
  }
}

// Unregister a command
function unregisterCommand(name) {
  commands.delete(name);
  commandDescriptions.delete(name);
}

// Main API handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }

  // Parse request body
  let { article, type = 'general', command = null, heading = false } = req.body;

  // Validate article
  if (!article || typeof article !== 'string' || article.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: "Valid 'article' text is required in the request body."
    });
  }

  // Character limit for safety
  const MAX_LENGTH = 15000;
  if (article.length > MAX_LENGTH) {
    article = article.substring(0, MAX_LENGTH);
  }

  // Clean and validate type
  const validTypes = [
    'general', 'meeting', 'study', 'code', 'task', 'idea', 
    'journal', 'recipe', 'project', 'email', 'research', 
    'brainstorm', 'summary', 'note', 'document', 'plan'
  ];
  
  if (!validTypes.includes(type)) {
    type = 'general';
  }

  try {
    // Case 1: Only heading requested (fast path)
    if (heading && !command) {
      const headingResult = await generateHeadingAndSummary(article, type);
      
      return res.status(200).json({
        success: true,
        data: {
          heading: headingResult.heading,
          summary: headingResult.summary,
          type,
          timestamp: new Date().toISOString(),
          length: article.length,
          service: 'TalkNote AI'
        }
      });
    }

    // Case 2: Process with command
    let contentResult = null;
    let headingResult = null;
    
    // Get processed content
    if (command) {
      contentResult = await processWithCommand(article, type, command);
    } else {
      // Default to auto-correct if no command specified
      contentResult = await processWithCommand(article, type, 'auto-correct');
    }
    
    // Get heading if requested
    if (heading) {
      headingResult = await generateHeadingAndSummary(article, type);
    }

    // Build response
    const response = {
      success: true,
      data: {
        content: contentResult.content,
        actionDescription: contentResult.actionDescription,
        ...(headingResult && {
          heading: headingResult.heading,
          summary: headingResult.summary
        }),
        type,
        ...(command && { 
          command: command,
          isPredefined: commands.has(command)
        }),
        timestamp: new Date().toISOString(),
        length: article.length,
        service: 'TalkNote AI'
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('TalkNote AI processing error:', error);
    
    // User-friendly error messages
    let statusCode = 500;
    let errorMessage = 'TalkNote AI processing failed. Please try again.';
    
    if (error.message?.includes('API_KEY') || error.message?.includes('key is not valid')) {
      statusCode = 503;
      errorMessage = 'TalkNote AI service is currently unavailable.';
    } else if (error.message?.includes('quota') || error.message?.includes('resource exhausted')) {
      statusCode = 429;
      errorMessage = 'TalkNote AI service limit reached. Please try again later.';
    } else if (error.message?.includes('safety') || error.message?.includes('blocked')) {
      statusCode = 400;
      errorMessage = 'Content could not be processed due to safety policies.';
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      service: 'TalkNote AI',
      ...(process.env.NODE_ENV === 'development' && { debug: error.message })
    });
  }
}

// Command management endpoints (optional separate file)
export async function commandsHandler(req, res) {
  if (req.method === 'GET') {
    // List all available commands
    const allCommands = Array.from(commands.entries()).map(([name, prompt]) => ({
      name,
      description: commandDescriptions.get(name) || 'No description available',
      prompt: prompt.substring(0, 100) + '...',
      isPredefined: Object.keys(predefinedCommands).includes(name)
    }));
    
    return res.status(200).json({
      success: true,
      service: 'TalkNote AI',
      commands: allCommands,
      totalCommands: commands.size,
      noteTypes: validTypes
    });
  }
  
  if (req.method === 'POST') {
    // Register new command
    const { name, prompt, description } = req.body;
    
    if (!name || !prompt) {
      return res.status(400).json({
        success: false,
        error: 'Command name and prompt are required.',
        service: 'TalkNote AI'
      });
    }
    
    registerCommand(name, prompt, description);
    
    return res.status(200).json({
      success: true,
      message: `Command '${name}' registered successfully in TalkNote AI.`,
      totalCommands: commands.size,
      service: 'TalkNote AI'
    });
  }
  
  if (req.method === 'DELETE') {
    // Remove command
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Command name is required.',
        service: 'TalkNote AI'
      });
    }
    
    if (!commands.has(name)) {
      return res.status(404).json({
        success: false,
        error: `Command '${name}' not found.`,
        service: 'TalkNote AI'
      });
    }
    
    unregisterCommand(name);
    
    return res.status(200).json({
      success: true,
      message: `Command '${name}' removed successfully.`,
      totalCommands: commands.size,
      service: 'TalkNote AI'
    });
  }
  
  return res.status(405).json({ 
    success: false, 
    error: 'Method not allowed.',
    service: 'TalkNote AI'
  });
}