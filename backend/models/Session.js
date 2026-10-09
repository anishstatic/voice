const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  durationSeconds: { type: Number, default: 0 },
  tokensUsed: { type: Number, default: 0 },
  estimatedCost: { type: Number, default: 0 },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date }
});

module.exports = mongoose.model('Session', sessionSchema);
