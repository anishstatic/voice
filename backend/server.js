const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const Session = require('./models/Session');
const User = require('./models/User');

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_this';

// ---- MongoDB connection ---------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/voiceagent';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    console.warn('Dashboard will work with in-memory fallback (data will not persist).');
  });

// ---- Gemini Live config -------------------------------------------------
const GEMINI_LIVE_MODEL = (process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview')
  .replace(/^models\//, '');
const GEMINI_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

async function logAvailableLiveModels() {
  try {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) return;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`);
    const body = await res.json();
    const live = (body.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'))
      .map(m => m.name.replace(/^models\//, ''));
    console.log('Live-capable models for this API key:', live.length ? live : '(none found)');
    if (live.length && !live.includes(GEMINI_LIVE_MODEL)) {
      console.warn(`WARNING: "${GEMINI_LIVE_MODEL}" is NOT in that list. Set GEMINI_LIVE_MODEL in .env to one of them.`);
    }
  } catch (e) {
    console.warn('Could not list Gemini models:', e.message);
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// ---- JWT Auth Middleware --------------------------------------------------
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

// ---- Auth Routes ---------------------------------------------------------
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
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

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
    res.status(500).json({ error: err.message || 'Server error. Please try again.' });
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

    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Server error. Please try again.' });
  }
});

// Verify token and get user data
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ---- Helper: compute real stats from database ----------------------------
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

// ---- Protected API Routes ------------------------------------------------
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

// ---- Socket.IO connections -----------------------------------------------
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  let geminiSession = null;
  let setupDone = false;
  let sessionStartTime = null;
  let sessionTokenCount = 0;
  let sessionDoc = null;
  const sessionId = Math.random().toString(36).substring(7);

  socket.on('start-voice', async (config) => {
    try {
      sessionStartTime = Date.now();
      sessionTokenCount = 0;

      try {
        sessionDoc = await Session.create({
          sessionId,
          status: 'active',
          startTime: new Date()
        });
      } catch (dbErr) {
        console.warn('Could not save session to DB:', dbErr.message);
      }

      const stats = await getStatsFromDB();
      io.emit('dashboardUpdate', stats);

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'dummy_key_to_prevent_crash') {
        throw new Error('Valid GEMINI_API_KEY is missing in .env');
      }

      const wsUrl = `${GEMINI_WS_BASE}?key=${apiKey.trim()}`;
      geminiSession = new WebSocket(wsUrl);

      geminiSession.on('open', () => {
        geminiSession.send(JSON.stringify({
          setup: {
            model: `models/${GEMINI_LIVE_MODEL}`,
            generationConfig: { responseModalities: ['AUDIO'] },
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: `You are a ${config.persona}. Keep responses short and conversational.` }]
            }
          }
        }));
      });

      geminiSession.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          console.log("Raw Gemini Response:", JSON.stringify(response, null, 2));
          
          if (response.setupComplete) {
            setupDone = true;
            console.log('Gemini setup complete - ready for audio');
            socket.emit('voice-ready');
          }
          if (response.error) {
            socket.emit('error', response.error.message || 'Gemini returned an error.');
          }
          const sc = response.serverContent;
          if (sc?.inputTranscription?.text) {
            sessionTokenCount += Math.ceil(sc.inputTranscription.text.length / 4);
            socket.emit('transcript', { speaker: 'user', text: sc.inputTranscription.text, partial: true });
          }
          if (sc?.outputTranscription?.text) {
            sessionTokenCount += Math.ceil(sc.outputTranscription.text.length / 4);
            socket.emit('transcript', { speaker: 'agent', text: sc.outputTranscription.text, partial: true });
          }
          if (sc?.interrupted) socket.emit('interrupted');
          if (sc?.turnComplete) socket.emit('turn-complete');
          if (response.serverContent?.modelTurn) {
             const parts = response.serverContent.modelTurn.parts;
             parts.forEach(part => {
               if (part.text && !part.thought) {
                 sessionTokenCount += Math.ceil(part.text.length / 4);
                 socket.emit('transcript', { speaker: 'agent', text: part.text });
               }
               if (part.inlineData && part.inlineData.data) {
                  sessionTokenCount += Math.ceil(part.inlineData.data.length / 100);
                  socket.emit('agent-audio', part.inlineData.data);
               }
             });
          }

          if (response.usageMetadata) {
            const um = response.usageMetadata;
            sessionTokenCount += (um.promptTokenCount || 0) + (um.candidatesTokenCount || 0) + (um.totalTokenCount || 0);
          }
        } catch (e) {
          console.error("Error parsing message from Gemini:", e, "Data:", data.toString());
        }
      });

      geminiSession.on('close', (code, reason) => {
        console.log(`Gemini WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
        setupDone = false;
        if (code !== 1000) socket.emit('error', `Gemini closed the connection (${code}): ${reason.toString()}`);
      });

      geminiSession.on('error', (err) => {
        console.error('Gemini WS Error:', err);
        socket.emit('error', 'Gemini connection error.');
      });
      
    } catch (err) {
      console.error('Error starting Gemini:', err);
      socket.emit('error', err.message || 'Failed to connect to Gemini API. Check your API key.');
    }
  });

  socket.on('user-audio-chunk', (base64Audio) => {
    if (geminiSession && geminiSession.readyState === WebSocket.OPEN && setupDone) {
      sessionTokenCount += Math.ceil(base64Audio.length / 100);
      geminiSession.send(JSON.stringify({
        realtimeInput: {
          audio: { mimeType: 'audio/pcm;rate=16000', data: base64Audio }
        }
      }));
    }
  });

  socket.on('user-text', (text) => {
    if (geminiSession && geminiSession.readyState === WebSocket.OPEN) {
      sessionTokenCount += Math.ceil(text.length / 4);
      geminiSession.send(JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text: text }] }],
          turnComplete: true
        }
      }));
      socket.emit('transcript', { speaker: 'user', text: text });
    }
  });

  socket.on('end-voice', async () => {
    if (geminiSession) {
      const duration = Math.floor((Date.now() - sessionStartTime) / 1000);
      const cost = sessionTokenCount * 0.000000075;

      try {
        if (sessionDoc) {
          await Session.findByIdAndUpdate(sessionDoc._id, {
            status: 'completed',
            durationSeconds: duration,
            tokensUsed: sessionTokenCount,
            estimatedCost: cost,
            endTime: new Date()
          });
        }
      } catch (dbErr) {
        console.warn('Could not update session in DB:', dbErr.message);
      }

      const stats = await getStatsFromDB();
      io.emit('dashboardUpdate', stats);

      geminiSession.close();
      geminiSession = null;
    }
  });

  socket.on('disconnect', async () => {
    if (geminiSession) {
      try {
        if (sessionDoc) {
          const duration = Math.floor((Date.now() - (sessionStartTime || Date.now())) / 1000);
          const cost = sessionTokenCount * 0.000000075;
          await Session.findByIdAndUpdate(sessionDoc._id, {
            status: 'completed',
            durationSeconds: duration,
            tokensUsed: sessionTokenCount,
            estimatedCost: cost,
            endTime: new Date()
          });
        }
      } catch (dbErr) {
        console.warn('Could not update session on disconnect:', dbErr.message);
      }

      const stats = await getStatsFromDB();
      io.emit('dashboardUpdate', stats);
      geminiSession.close();
    }
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Using Gemini Live model: ${GEMINI_LIVE_MODEL}`);
  logAvailableLiveModels();
});