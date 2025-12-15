// api/notes.js
import { db } from "../utils/firebase.js";
import { v4 as uuidv4 } from 'uuid';

// Helper to validate user existence
async function validateUserExistence(userId) {
  const snapshot = await db.ref('users').orderByChild('user_id').equalTo(userId).once('value');
  return snapshot.exists();
}

// Helper to get user by user_id
async function getUserByUserId(userId) {
  const snapshot = await db.ref('users').orderByChild('user_id').equalTo(userId).once('value');
  if (snapshot.exists()) {
    const users = snapshot.val();
    const uid = Object.keys(users)[0];
    return { uid, ...users[uid] };
  }
  return null;
}

// Create a new note
async function createNote(userId, noteData) {
  const noteId = uuidv4();
  const timestamp = Date.now();
  
  const note = {
    note_id: noteId,
    user_id: userId,
    title: noteData.title || '',
    text: noteData.text || '',
    public: noteData.public !== undefined ? Boolean(noteData.public) : false,
    created_at: timestamp,
    updated_at: timestamp
  };

  await db.ref(`notes/${noteId}`).set(note);
  return note;
}

// Get note by ID
async function getNoteById(noteId) {
  const snapshot = await db.ref(`notes/${noteId}`).once('value');
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return null;
}

// Update note
async function updateNote(noteId, userId, updateData) {
  const note = await getNoteById(noteId);
  if (!note) {
    throw new Error('Note not found');
  }
  
  // Check if user owns the note
  if (note.user_id !== userId) {
    throw new Error('Unauthorized: You do not own this note');
  }

  const updates = {
    updated_at: Date.now(),
    ...updateData
  };

  // Remove fields that shouldn't be updated
  delete updates.note_id;
  delete updates.user_id;
  delete updates.created_at;

  await db.ref(`notes/${noteId}`).update(updates);
  
  return { ...note, ...updates };
}

// Delete note
async function deleteNote(noteId, userId) {
  const note = await getNoteById(noteId);
  if (!note) {
    throw new Error('Note not found');
  }
  
  // Check if user owns the note
  if (note.user_id !== userId) {
    throw new Error('Unauthorized: You do not own this note');
  }

  await db.ref(`notes/${noteId}`).remove();
  return true;
}

// List notes for a user
async function listNotes(userId, includePublic = false) {
  let notes = [];
  
  if (includePublic) {
    // Get user's notes
    const userSnapshot = await db.ref('notes').orderByChild('user_id').equalTo(userId).once('value');
    const userNotes = userSnapshot.val() || {};
    
    // Get public notes from other users
    const publicSnapshot = await db.ref('notes').orderByChild('public').equalTo(true).once('value');
    const publicNotes = publicSnapshot.val() || {};
    
    // Combine, remove duplicates, and exclude user's public notes from public list
    const combinedNotes = { ...userNotes };
    Object.keys(publicNotes).forEach(noteId => {
      if (publicNotes[noteId].user_id !== userId) {
        combinedNotes[noteId] = publicNotes[noteId];
      }
    });
    
    notes = Object.values(combinedNotes);
  } else {
    // Get only user's notes
    const snapshot = await db.ref('notes').orderByChild('user_id').equalTo(userId).once('value');
    const notesObj = snapshot.val() || {};
    notes = Object.values(notesObj);
  }

  // Sort by updated_at descending
  notes.sort((a, b) => b.updated_at - a.updated_at);
  
  return notes;
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
    // Route based on method
    const { method } = req;
    
    if (method === 'POST') {
      return await handleCreateNote(req, res);
    } else if (method === 'GET') {
      return await handleGetNotes(req, res);
    } else if (method === 'PUT') {
      return await handleUpdateNote(req, res);
    } else if (method === 'DELETE') {
      return await handleDeleteNote(req, res);
    } else {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed'
      });
    }
  } catch (error) {
    console.error('Notes API error:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'An error occurred'
    });
  }
}

// POST /api/notes - Create a new note
async function handleCreateNote(req, res) {
  try {
    const { action, title, text, public: isPublic, user_id } = req.body;

    // Validate required fields
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
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

    const noteData = {
      title: title || '',
      text: text,
      public: isPublic !== undefined ? Boolean(isPublic) : false
    };

    const note = await createNote(user_id, noteData);

    return res.status(201).json({
      success: true,
      note: {
        note_id: note.note_id,
        user_id: note.user_id,
        title: note.title,
        text: note.text,
        public: note.public,
        created_at: note.created_at,
        updated_at: note.updated_at
      },
      message: 'Note created successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// GET /api/notes - List notes or get specific note
async function handleGetNotes(req, res) {
  try {
    const { note_id, user_id, include_public } = req.query;

    // Get single note
    if (note_id) {
      const note = await getNoteById(note_id);
      
      if (!note) {
        return res.status(404).json({
          success: false,
          error: 'Note not found'
        });
      }

      // Check if note is public or belongs to the requesting user
      const userId = user_id || note.user_id;
      if (!note.public && note.user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. This note is private.'
        });
      }

      return res.status(200).json({
        success: true,
        note: note
      });
    }

    // List notes - user_id is required
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required to list notes'
      });
    }

    const includePublic = include_public === 'true';
    const notes = await listNotes(user_id, includePublic);

    return res.status(200).json({
      success: true,
      notes: notes,
      count: notes.length
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// PUT /api/notes - Update a note
async function handleUpdateNote(req, res) {
  try {
    const { note_id, user_id, title, text, public: isPublic } = req.body;

    if (!note_id) {
      return res.status(400).json({
        success: false,
        error: 'Note ID is required'
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (text !== undefined) updateData.text = text;
    if (isPublic !== undefined) updateData.public = Boolean(isPublic);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No update data provided'
      });
    }

    const updatedNote = await updateNote(note_id, user_id, updateData);

    return res.status(200).json({
      success: true,
      note: updatedNote,
      message: 'Note updated successfully'
    });
  } catch (error) {
    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    } else if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
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

// DELETE /api/notes - Delete a note
async function handleDeleteNote(req, res) {
  try {
    const { note_id, user_id } = req.query;

    if (!note_id) {
      return res.status(400).json({
        success: false,
        error: 'Note ID is required'
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    await deleteNote(note_id, user_id);

    return res.status(200).json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    } else if (error.message.includes('Unauthorized')) {
      return res.status(403).json({
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