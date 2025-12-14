// api/auth.js
import { db } from "../utils/firebase.js";
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// Helper function to generate unique user_id starting with tk01
async function generateUserId() {
  try {
    const prefix = 'tk';
    let counter = 1;
    let userId = '';
    let exists = true;

    while (exists) {
      userId = `${prefix}${counter.toString().padStart(2, '0')}`;
      
      // Check if user_id exists
      const snapshot = await db.ref(`users`).orderByChild('user_id').equalTo(userId).once('value');
      exists = snapshot.exists();
      counter++;
      
      // Safety limit
      if (counter > 999) {
        // Fallback to timestamp-based ID
        userId = `${prefix}${Date.now().toString().slice(-6)}`;
        break;
      }
    }
    
    return userId;
  } catch (error) {
    console.error('Error generating user ID:', error);
    // Fallback to timestamp if there's an error
    return `tk${Date.now().toString().slice(-6)}`;
  }
}

// Helper to hash passwords
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

// Helper to verify passwords
async function verifyPassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

// Helper to find user by email
async function findUserByEmail(email) {
  const snapshot = await db.ref('users').orderByChild('email').equalTo(email).once('value');
  if (snapshot.exists()) {
    const users = snapshot.val();
    const userId = Object.keys(users)[0];
    return { uid: userId, ...users[userId] };
  }
  return null;
}

// Helper to find user by user_id
async function findUserByUserId(userId) {
  const snapshot = await db.ref('users').orderByChild('user_id').equalTo(userId).once('value');
  if (snapshot.exists()) {
    const users = snapshot.val();
    const uid = Object.keys(users)[0];
    return { uid, ...users[uid] };
  }
  return null;
}

// Helper to create session
async function createSession(userId) {
  const sessionId = uuidv4();
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days from now
  
  await db.ref(`sessions/${sessionId}`).set({
    userId,
    expiresAt,
    createdAt: Date.now()
  });
  
  return sessionId;
}

// Helper to validate session
async function validateSession(sessionId) {
  const snapshot = await db.ref(`sessions/${sessionId}`).once('value');
  if (!snapshot.exists()) {
    return null;
  }
  
  const session = snapshot.val();
  
  // Check if session has expired
  if (session.expiresAt < Date.now()) {
    // Delete expired session
    await db.ref(`sessions/${sessionId}`).remove();
    return null;
  }
  
  // Extend session
  await db.ref(`sessions/${sessionId}`).update({
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
  });
  
  return session;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const { action, email, password, ...additionalData } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'Action is required'
      });
    }

    switch (action) {
      case 'register':
        return await handleRegistration(res, email, password, additionalData);
      case 'login':
        return await handleLogin(res, email, password);
      case 'change-password':
        return await handleChangePassword(res, email, password, additionalData);
      case 'edit-user':
        return await handleEditUser(res, email, additionalData);
      case 'validate-session':
        return await handleValidateSession(req, res);
      case 'logout':
        return await handleLogout(req, res);
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action'
        });
    }
  } catch (error) {
    console.error('Auth API error:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message || 'An error occurred'
    });
  }
}

// Registration handler
async function handleRegistration(res, email, password, additionalData) {
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required'
    });
  }

  // Check if user already exists
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    return res.status(400).json({
      success: false,
      error: 'Email already registered'
    });
  }

  // Generate user ID
  const userId = await generateUserId();
  
  // Hash password
  const hashedPassword = await hashPassword(password);
  
  // Create user object
  const userData = {
    user_id: userId,
    email: email.toLowerCase(),
    password: hashedPassword,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...additionalData
  };

  // Generate unique UID for the user
  const uid = uuidv4();
  
  // Save user to database
  await db.ref(`users/${uid}`).set(userData);
  
  // Create session
  const sessionId = await createSession(uid);

  return res.status(201).json({
    success: true,
    user_id: userId,
    email: email,
    uid: uid,
    session_id: sessionId,
    message: 'Registration successful'
  });
}

// Login handler
async function handleLogin(res, email, password) {
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required'
    });
  }

  // Find user
  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password'
    });
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password);
  if (!isValidPassword) {
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password'
    });
  }

  // Create session
  const sessionId = await createSession(user.uid);

  return res.status(200).json({
    success: true,
    user_id: user.user_id,
    email: user.email,
    uid: user.uid,
    session_id: sessionId,
    message: 'Login successful'
  });
}

// Change password handler
async function handleChangePassword(res, email, newPassword, additionalData) {
  const { currentPassword } = additionalData;

  if (!email || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'Email and new password are required'
    });
  }

  if (!currentPassword) {
    return res.status(400).json({
      success: false,
      error: 'Current password is required'
    });
  }

  // Find user
  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  // Verify current password
  const isValidPassword = await verifyPassword(currentPassword, user.password);
  if (!isValidPassword) {
    return res.status(401).json({
      success: false,
      error: 'Current password is incorrect'
    });
  }

  // Hash new password
  const hashedPassword = await hashPassword(newPassword);

  // Update password
  await db.ref(`users/${user.uid}`).update({
    password: hashedPassword,
    updatedAt: Date.now()
  });

  return res.status(200).json({
    success: true,
    message: 'Password changed successfully'
  });
}

// Edit user handler
async function handleEditUser(res, email, updateData) {
  const { session_id, user_id, ...otherUpdates } = updateData;

  if (!email && !session_id) {
    return res.status(400).json({
      success: false,
      error: 'Either email or session_id is required'
    });
  }

  let uid;
  
  if (session_id) {
    // Validate session
    const session = await validateSession(session_id);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }
    uid = session.userId;
  } else {
    // Find user by email
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    uid = user.uid;
  }

  // If user_id is being updated, check for uniqueness
  if (user_id) {
    const existingUser = await findUserByUserId(user_id);
    if (existingUser && existingUser.uid !== uid) {
      return res.status(400).json({
        success: false,
        error: 'User ID already taken'
      });
    }
  }

  // Prepare updates
  const updates = {
    updatedAt: Date.now(),
    ...otherUpdates
  };

  // Add user_id to updates if provided
  if (user_id) {
    updates.user_id = user_id;
  }

  // Update user in database
  await db.ref(`users/${uid}`).update(updates);

  // Get updated user data
  const snapshot = await db.ref(`users/${uid}`).once('value');
  const updatedUser = snapshot.val();

  return res.status(200).json({
    success: true,
    user_id: updatedUser.user_id,
    email: updatedUser.email,
    message: 'User updated successfully',
    updates: updates
  });
}

// Session validation handler
async function handleValidateSession(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No session token provided'
    });
  }

  const sessionId = authHeader.split(' ')[1];
  const session = await validateSession(sessionId);
  
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session'
    });
  }

  // Get user data
  const userSnapshot = await db.ref(`users/${session.userId}`).once('value');
  const user = userSnapshot.val();

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  return res.status(200).json({
    success: true,
    user_id: user.user_id,
    email: user.email,
    uid: session.userId,
    session_id: sessionId,
    message: 'Session is valid'
  });
}

// Logout handler
async function handleLogout(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(400).json({
      success: false,
      error: 'No session token provided'
    });
  }

  const sessionId = authHeader.split(' ')[1];
  
  // Remove session
  await db.ref(`sessions/${sessionId}`).remove();

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
}