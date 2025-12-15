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
    updated_at: timestamp,
    comment_count: 0
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

// Get note with comments
async function getNoteWithComments(noteId) {
  const note = await getNoteById(noteId);
  if (!note) return null;

  // Get comments for this note
  const commentsSnapshot = await db.ref(`comments/${noteId}`).orderByChild('created_at').once('value');
  const comments = commentsSnapshot.val() || {};
  
  // Convert to array and sort by creation date (newest first)
  const commentsArray = Object.values(comments).sort((a, b) => b.created_at - a.created_at);
  
  return {
    ...note,
    comments: commentsArray
  };
}

// Add comment to note
async function addComment(noteId, commentData) {
  const note = await getNoteById(noteId);
  if (!note) {
    throw new Error('Note not found');
  }

  // Check if note is public (allow comments on public notes)
  if (!note.public) {
    throw new Error('Cannot comment on private notes');
  }

  const commentId = uuidv4();
  const timestamp = Date.now();
  
  const comment = {
    comment_id: commentId,
    note_id: noteId,
    user_id: commentData.user_id || 'anonymous',
    name: commentData.name || 'Anonymous',
    text: commentData.text,
    created_at: timestamp,
    updated_at: timestamp
  };

  // Save comment
  await db.ref(`comments/${noteId}/${commentId}`).set(comment);
  
  // Update comment count in note
  const newCommentCount = (note.comment_count || 0) + 1;
  await db.ref(`notes/${noteId}`).update({
    comment_count: newCommentCount,
    updated_at: timestamp
  });

  return { comment, comment_count: newCommentCount };
}

// Get comments for a note
async function getComments(noteId, limit = 50) {
  const snapshot = await db.ref(`comments/${noteId}`).orderByChild('created_at').limitToLast(limit).once('value');
  const comments = snapshot.val() || {};
  
  // Convert to array and sort by creation date (newest first)
  return Object.values(comments).sort((a, b) => b.created_at - a.created_at);
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
  delete updates.comment_count;

  await db.ref(`notes/${noteId}`).update(updates);

  return { ...note, ...updates };
}

// Delete note (and all its comments)
async function deleteNote(noteId, userId) {
  const note = await getNoteById(noteId);
  if (!note) {
    throw new Error('Note not found');
  }

  // Check if user owns the note
  if (note.user_id !== userId) {
    throw new Error('Unauthorized: You do not own this note');
  }

  // Delete note
  await db.ref(`notes/${noteId}`).remove();
  
  // Delete all comments for this note
  await db.ref(`comments/${noteId}`).remove();
  
  return true;
}

// Delete comment
async function deleteComment(noteId, commentId, userId) {
  const commentRef = db.ref(`comments/${noteId}/${commentId}`);
  const commentSnapshot = await commentRef.once('value');
  
  if (!commentSnapshot.exists()) {
    throw new Error('Comment not found');
  }

  const comment = commentSnapshot.val();
  
  // Only note owner or comment creator can delete
  const note = await getNoteById(noteId);
  if (note.user_id !== userId && comment.user_id !== userId) {
    throw new Error('Unauthorized: You cannot delete this comment');
  }

  // Delete comment
  await commentRef.remove();
  
  // Update comment count in note
  const newCommentCount = Math.max(0, (note.comment_count || 1) - 1);
  await db.ref(`notes/${noteId}`).update({
    comment_count: newCommentCount,
    updated_at: Date.now()
  });

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
    const { method, query } = req;
    
    // Check for comment-related actions in query params
    const action = query.action || (req.body && req.body.action);

    if (action === 'add_comment') {
      return await handleAddComment(req, res);
    } else if (action === 'get_comments') {
      return await handleGetComments(req, res);
    } else if (action === 'delete_comment') {
      return await handleDeleteComment(req, res);
    } else if (method === 'POST') {
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
        updated_at: note.updated_at,
        comment_count: note.comment_count || 0
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
    const { note_id, user_id, include_public, with_comments } = req.query;

    // Get single note
    if (note_id) {
      let note;
      
      if (with_comments === 'true') {
        // Get note with comments
        note = await getNoteWithComments(note_id);
      } else {
        // Get note without comments
        note = await getNoteById(note_id);
      }

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

// POST /api/notes?action=add_comment - Add comment to note
async function handleAddComment(req, res) {
  try {
    const { note_id, user_id, name, text } = req.body;

    if (!note_id) {
      return res.status(400).json({
        success: false,
        error: 'Note ID is required'
      });
    }

    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Comment text is required'
      });
    }

    const commentData = {
      user_id: user_id || 'anonymous',
      name: name || 'Anonymous',
      text: text
    };

    const result = await addComment(note_id, commentData);

    return res.status(201).json({
      success: true,
      comment: result.comment,
      comment_count: result.comment_count,
      message: 'Comment added successfully'
    });
  } catch (error) {
    if (error.message === 'Note not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    } else if (error.message === 'Cannot comment on private notes') {
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

// GET /api/notes?action=get_comments - Get comments for note
async function handleGetComments(req, res) {
  try {
    const { note_id, limit } = req.query;

    if (!note_id) {
      return res.status(400).json({
        success: false,
        error: 'Note ID is required'
      });
    }

    const comments = await getComments(note_id, parseInt(limit) || 50);

    return res.status(200).json({
      success: true,
      comments: comments,
      count: comments.length
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// DELETE /api/notes?action=delete_comment - Delete comment
async function handleDeleteComment(req, res) {
  try {
    const { note_id, comment_id, user_id } = req.query;

    if (!note_id || !comment_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Note ID, Comment ID, and User ID are required'
      });
    }

    await deleteComment(note_id, comment_id, user_id);

    return res.status(200).json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    if (error.message === 'Comment not found') {
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