import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Send, AlertCircle, Bot, User, Sparkles } from 'lucide-react';
import io from 'socket.io-client';
import { WS_BASE } from '../config';

const INPUT_RATE = 16000;   // Gemini expects 16 kHz 16-bit PCM from us
const OUTPUT_RATE = 24000;  // Gemini sends back 24 kHz 16-bit PCM

// base64 -> Int16 PCM samples
function base64ToInt16(b64) {
  const bin = window.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

// Float32 mic samples at any rate -> Float32 at 16 kHz (window-average = simple low-pass)
function downsampleTo16k(input, inputRate) {
  if (inputRate === INPUT_RATE) return input;
  const ratio = inputRate / INPUT_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) { sum += input[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

// Float32 -> base64 of little-endian Int16 PCM
function float32ToBase64Pcm16(float32) {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

const VoiceAgent = () => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | connecting | listening
  const [transcript, setTranscript] = useState([
    { speaker: 'agent', text: "Hello! I'm your AI assistant. Tap the mic or type a message to start." }
  ]);
  const [persona, setPersona] = useState('Helpful Assistant');
  const [error, setError] = useState(null);
  const [textInput, setTextInput] = useState('');

  const socketRef = useRef(null);
  const captureCtxRef = useRef(null);    // microphone side (native sample rate)
  const playbackCtxRef = useRef(null);   // speaker side (24 kHz)
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef(new Set());
  const readyRef = useRef(false);            // true once Gemini says setupComplete
  const lastPartialSpeakerRef = useRef(null); // used to merge transcript fragments
  const chatEndRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);

  const stopPlayback = () => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    activeSourcesRef.current.clear();
    nextPlayTimeRef.current = 0;
  };

  const stopCapture = () => {
    readyRef.current = false;
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    stopPlayback();
    if (captureCtxRef.current) { captureCtxRef.current.close(); captureCtxRef.current = null; }
    if (playbackCtxRef.current) { playbackCtxRef.current.close(); playbackCtxRef.current = null; }
    setIsActive(false);
    setStatus('idle');
  };

  // Play one chunk of raw 24 kHz PCM from Gemini, queued back-to-back
  const playPcm = (base64Audio) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    const pcm = base64ToInt16(base64Audio);
    const buffer = ctx.createBuffer(1, pcm.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now + 0.05; // small jitter buffer
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => activeSourcesRef.current.delete(source);
  };

  useEffect(() => {
    // Connect to backend Socket.io
    const socket = io(WS_BASE);
    socketRef.current = socket;

    socket.on('agent-audio', playPcm);

    socket.on('voice-ready', () => {
      readyRef.current = true;
      setStatus('listening');
    });

    // User started talking over the agent: drop whatever audio is still queued
    socket.on('interrupted', () => {
      stopPlayback();
      lastPartialSpeakerRef.current = null;
    });

    socket.on('turn-complete', () => {
      lastPartialSpeakerRef.current = null;
    });

    socket.on('transcript', (msg) => {
      setTranscript((prev) => {
        // Transcription arrives in small fragments: append them to the current bubble
        if (msg.partial && lastPartialSpeakerRef.current === msg.speaker && prev.length > 0) {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, text: last.text + msg.text };
          return copy;
        }
        return [...prev, { speaker: msg.speaker, text: msg.text }];
      });
      lastPartialSpeakerRef.current = msg.partial ? msg.speaker : null;
    });

    socket.on('error', (errMsg) => {
      setError(typeof errMsg === 'string' ? errMsg : 'Voice connection error.');
      stopCapture();
    });

    return () => {
      socket.disconnect();
      stopCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleMic = async () => {
    if (isActive) {
      socketRef.current.emit('end-voice');
      stopCapture();
      return;
    }

    setError(null);
    try {
      // Browser echo cancellation stops the agent hearing itself (headphones are still best)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      mediaStreamRef.current = stream;

      // Created inside the click handler so the browser allows audio to start
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      playbackCtxRef.current = new AudioCtx({ sampleRate: OUTPUT_RATE });
      captureCtxRef.current = new AudioCtx(); // native rate; we downsample to 16 kHz ourselves
      await playbackCtxRef.current.resume();
      await captureCtxRef.current.resume();
      nextPlayTimeRef.current = 0;
      lastPartialSpeakerRef.current = null;

      const captureCtx = captureCtxRef.current;
      const source = captureCtx.createMediaStreamSource(stream);
      const processor = captureCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!socketRef.current || !readyRef.current) return; // wait for Gemini setup
        const input = e.inputBuffer.getChannelData(0);
        const down = downsampleTo16k(input, captureCtx.sampleRate);
        socketRef.current.emit('user-audio-chunk', float32ToBase64Pcm16(down));
      };

      // ScriptProcessor only fires if connected to the destination; a zero-gain node keeps it silent
      const mute = captureCtx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(captureCtx.destination);

      setIsActive(true);
      setStatus('connecting');
      socketRef.current.emit('start-voice', { persona });
    } catch (err) {
      console.error(err);
      stopCapture();
      setError('Microphone permission denied or error capturing audio.');
    }
  };

  const handleSendText = () => {
    if (textInput.trim() !== '' && isActive) {
      socketRef.current.emit('user-text', textInput.trim());
      setTextInput('');
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connecting': return 'Connecting to Gemini...';
      case 'listening': return 'Listening — speak now';
      default: return 'Ready to connect';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'connecting': return '#f59e0b';
      case 'listening': return '#10b981';
      default: return '#64748b';
    }
  };

  return (
    <div className="glass-card flex flex-col overflow-hidden" style={{ height: '780px' }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(15, 17, 23, 0.5)'
      }}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
              background: isActive ? 'var(--gradient-accent)' : 'var(--surface-hover)',
              transition: 'all 0.3s'
            }}>
              <Bot size={20} className="text-white" />
            </div>
            {isActive && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: getStatusColor() }}></span>
                <span className="relative inline-flex rounded-full h-3 w-3" style={{ background: getStatusColor() }}></span>
              </span>
            )}
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Voice Agent</h2>
            <p className="text-xs" style={{ color: getStatusColor() }}>{getStatusText()}</p>
          </div>
        </div>
        <div className="status-badge" style={{
          background: `${getStatusColor()}15`,
          color: getStatusColor(),
          border: `1px solid ${getStatusColor()}30`
        }}>
          {status === 'listening' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Idle'}
        </div>
      </div>

      {/* Persona Selector */}
      <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <label className="block text-xs font-medium uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
          AI Persona
        </label>
        <select 
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          disabled={isActive}
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-all"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            cursor: isActive ? 'not-allowed' : 'pointer',
            opacity: isActive ? 0.5 : 1
          }}
        >
          <option>Helpful Assistant</option>
          <option>Customer Support Agent</option>
          <option>Technical Expert</option>
        </select>
      </div>

      {/* Chat Area */}
      <div className="flex-1 px-4 py-4 overflow-y-auto space-y-3" style={{ background: 'var(--surface)' }}>
        {transcript.map((msg, idx) => (
          <div 
            key={idx} 
            className={`flex items-end gap-2 ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
            style={{ animation: `fadeIn 0.3s ease ${idx * 0.05}s both` }}
          >
            {/* Agent Avatar (left side) */}
            {msg.speaker === 'agent' && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mb-0.5" style={{
                background: 'var(--gradient-accent)'
              }}>
                <Sparkles size={14} className="text-white" />
              </div>
            )}
            
            {/* Message Bubble */}
            <div className={msg.speaker === 'user' ? 'chat-bubble-user' : 'chat-bubble-agent'}>
              <p className="text-sm leading-relaxed">{msg.text}</p>
            </div>

            {/* User Avatar (right side) */}
            {msg.speaker === 'user' && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mb-0.5" style={{
                background: 'var(--gradient-primary)'
              }}>
                <User size={14} className="text-white" />
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-xl flex items-start gap-3" style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)'
        }}>
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs" style={{ color: '#fca5a5' }}>{error}</p>
        </div>
      )}

      {/* Controls */}
      <div className="px-4 py-4" style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'rgba(15, 17, 23, 0.5)'
      }}>
        {/* Text Input */}
        <div className="flex gap-2 mb-4">
          <input 
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={isActive ? "Type a message..." : "Start voice session first..."}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-all"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              opacity: isActive ? 1 : 0.4
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendText();
            }}
            disabled={!isActive}
          />
          <button 
            className="rounded-xl px-4 py-2.5 transition-all flex items-center justify-center"
            style={{
              background: isActive ? 'var(--gradient-primary)' : 'var(--surface-hover)',
              border: 'none',
              cursor: isActive ? 'pointer' : 'not-allowed',
              opacity: isActive ? 1 : 0.4
            }}
            disabled={!isActive}
            onClick={handleSendText}
          >
            <Send size={16} className="text-white" />
          </button>
        </div>

        {/* Mic Button */}
        <div className="flex flex-col items-center">
          <button 
            onClick={handleToggleMic}
            className="relative group flex items-center justify-center w-16 h-16 rounded-full transition-all duration-300 cursor-pointer"
            style={{
              background: isActive 
                ? 'linear-gradient(135deg, #ef4444, #dc2626)' 
                : 'var(--gradient-primary)',
              boxShadow: isActive 
                ? '0 0 30px rgba(239, 68, 68, 0.4)' 
                : '0 0 30px rgba(99, 102, 241, 0.3)'
            }}
          >
            {isActive ? <MicOff size={22} className="text-white" /> : <Mic size={22} className="text-white" />}
            {isActive && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-red-400 pulse-ring"></div>
                <div className="absolute inset-[-4px] rounded-full border border-red-400/20 pulse-ring" style={{ animationDelay: '0.5s' }}></div>
              </>
            )}
          </button>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            {isActive ? 'Tap to stop' : 'Tap to start'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default VoiceAgent;