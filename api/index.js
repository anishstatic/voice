const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Session = require('./models/Session');

const app = express();

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'voiceai_super_secret_key_2026_change_this';

// Cached MongoDB Connection for Serverless environments
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set in Vercel Environment Variables. Please add it in Vercel Settings -> Environment Variables.');
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    };
    cached.promise = mongoose.connect(uri, opts).then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
    console.log('✅ MongoDB connected in Vercel Serverless');
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    console.error('❌ MongoDB serverless connection error:', err.message);
    throw err;
  }
}

// Middleware to ensure DB connection before handling requests
app.use(async (req, res, next) => {
  // Allow health check to pass without DB
  if (req.path === '/api/health') return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection middleware error:', err.message);
    return res.status(503).json({ 
      error: `Database connection failed: ${err.message}. Please check MongoDB Atlas IP Whitelist (add 0.0.0.0/0) and Vercel MONGODB_URI.` 
    });
  }
});

// JWT Auth Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ---- Auth Routes -----------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const user = await User.create({ name, email, password });
    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join('. ') });
    }
    res.status(500).json({ error: err.message || 'Server error during registration.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Server error during login.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error retrieving user.' });
  }
});

// ---- Dashboard Telemetry Routes --------------------------------------------
async function getStatsFromDB() {
  try {
    const activeSessions = await Session.countDocuments({ status: 'active' });
    const completedSessions = await Session.countDocuments({ status: 'completed' });
    const totals = await Session.aggregate([
      { $group: { _id: null, totalTokens: { $sum: '$tokensUsed' }, totalCost: { $sum: '$estimatedCost' } } }
    ]);
    const recentSessions = await Session.find()
      .sort({ startTime: -1 })
      .limit(10)
      .lean();

    return {
      activeSessions,
      completedSessions,
      totalTokens: totals.length > 0 ? totals[0].totalTokens : 0,
      totalCost: totals.length > 0 ? totals[0].totalCost : 0,
      recentSessions: recentSessions.map(s => ({
        id: s.sessionId,
        status: s.status,
        duration: s.durationSeconds,
        tokens: s.tokensUsed,
        cost: s.estimatedCost
      }))
    };
  } catch (err) {
    console.error('Error fetching stats from DB:', err.message);
    return { activeSessions: 0, completedSessions: 0, totalTokens: 0, totalCost: 0, recentSessions: [] };
  }
}

app.get('/api/stats', authMiddleware, async (req, res) => {
  const stats = await getStatsFromDB();
  res.json(stats);
});

app.get('/api/trends', authMiddleware, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const trends = await Session.aggregate([
      { $match: { startTime: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
          cost: { $sum: '$estimatedCost' },
          tokens: { $sum: '$tokensUsed' },
          sessions: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = trends.map(t => {
      const date = new Date(t._id);
      return {
        name: dayNames[date.getDay()],
        date: t._id,
        cost: parseFloat(t.cost.toFixed(6)),
        tokens: t.tokens,
        sessions: t.sessions
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching trends:', err.message);
    res.json([]);
  }
});

// ---- Serverless AI Chat Route ----------------------------------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { message, persona } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on Vercel.' });
    }

    const systemPrompt = `You are a ${persona || 'helpful assistant'}. Keep answers concise, natural, and conversational.`;
    
    // Call Gemini 2.5 Flash / 3.1 Flash REST API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: message }] }]
      })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm here to help!";
    const tokens = data.usageMetadata?.totalTokenCount || Math.ceil((message.length + reply.length) / 4);

    // Save session in MongoDB for telemetry
    try {
      await Session.create({
        sessionId: Math.random().toString(36).substring(7),
        status: 'completed',
        durationSeconds: 5,
        tokensUsed: tokens,
        estimatedCost: tokens * 0.000000075,
        startTime: new Date(),
        endTime: new Date()
      });
    } catch (saveErr) {
      console.warn('Could not save telemetry session:', saveErr.message);
    }

    res.json({ reply, tokens });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message || 'Error processing AI response.' });
  }
});

// Fallback health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'VoiceAI Vercel Serverless API' });
});

module.exports = app;
