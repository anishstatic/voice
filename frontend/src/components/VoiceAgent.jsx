import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Send, AlertCircle, Bot, User, Sparkles, Volume2, Loader2 } from 'lucide-react';
import io from 'socket.io-client';
import axios from 'axios';
import { API_BASE, WS_BASE } from '../config';

const INPUT_RATE = 16000;   // Gemini expects 16 kHz 16-bit PCM
const OUTPUT_RATE = 24000;  // Gemini sends back 24 kHz 16-bit PCM

function base64ToInt16(b64) {
  const bin = window.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

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
  const [status, setStatus] = useState('idle'); // idle | connecting | listening | thinking | speaking
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transcript, setTranscript] = useState([
    { speaker: 'agent', text: "Hello! I'm your AI assistant. You can speak to me with the mic or type any question below." }
  ]);
  const [persona, setPersona] = useState('Helpful Assistant');
  const [error, setError] = useState(null);
  const [textInput, setTextInput] = useState('');

  const socketRef = useRef(null);
  const captureCtxRef = useRef(null);
  const playbackCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef(new Set());
  const readyRef = useRef(false);
  const lastPartialSpeakerRef = useRef(null);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript, isGenerating]);

  // Connect socket if a WebSocket server is reachable (e.g. local or persistent host)
  useEffect(() => {
    if (!WS_BASE) return;

    try {
      const socket = io(WS_BASE, {
        timeout: 4000,
        reconnectionAttempts: 2
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setIsSocketConnected(true);
        console.log('✅ Connected to WebSocket audio server');
      });

      socket.on('disconnect', () => {
        setIsSocketConnected(false);
      });

      socket.on('connect_error', () => {
        setIsSocketConnected(false);
      });

      socket.on('agent-audio', playPcm);

      socket.on('voice-ready', () => {
        readyRef.current = true;
        setStatus('listening');
      });

      socket.on('interrupted', () => {
        stopPlayback();
        lastPartialSpeakerRef.current = null;
      });

      socket.on('turn-complete', () => {
        lastPartialSpeakerRef.current = null;
        setStatus('idle');
      });

      socket.on('transcript', (msg) => {
        setTranscript((prev) => {
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
    } catch {
      setIsSocketConnected(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPlayback = () => {
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch { /* ignore */ }
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
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    stopPlayback();
    if (captureCtxRef.current) { captureCtxRef.current.close(); captureCtxRef.current = null; }
    if (playbackCtxRef.current) { playbackCtxRef.current.close(); playbackCtxRef.current = null; }
    setIsActive(false);
    setStatus('idle');
  };

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
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now + 0.05;
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => activeSourcesRef.current.delete(source);
  };

  // Speak text using browser speech synthesis
  const speakText = (text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    utterance.onerror = () => setStatus('idle');
    window.speechSynthesis.speak(utterance);
  };

  // Process text through Gemini AI API
  const sendToGemini = async (userMessage) => {
    if (!userMessage.trim()) return;
    setError(null);
    setIsGenerating(true);
    setStatus('thinking');

    try {
      const response = await axios.post(`${API_BASE}/api/chat`, {
        message: userMessage,
        persona
      });

      if (response.data?.reply) {
        setTranscript(prev => [...prev, { speaker: 'agent', text: response.data.reply }]);
        speakText(response.data.reply);
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errMsg = err.response?.data?.error || 'Could not reach Gemini AI. Please check your connection or GEMINI_API_KEY.';
      setError(errMsg);
      setTranscript(prev => [...prev, { 
        speaker: 'agent', 
        text: 'Sorry, I encountered an issue connecting to Gemini. Please verify your GEMINI_API_KEY.' 
      }]);
      setStatus('idle');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Text Submission (works anytime)
  const handleSendText = async () => {
    if (!textInput.trim() || isGenerating) return;
    const msg = textInput.trim();
    setTextInput('');

    // Append user message immediately
    setTranscript(prev => [...prev, { speaker: 'user', text: msg }]);

    // If live WebSocket is connected and mic is active, emit via socket
    if (isSocketConnected && isActive && socketRef.current?.connected && readyRef.current) {
      socketRef.current.emit('user-text', msg);
    } else {
      // Direct REST API call
      await sendToGemini(msg);
    }
  };

  // Handle Microphone Toggle
  const handleToggleMic = async () => {
    if (isActive) {
      if (isSocketConnected && socketRef.current?.connected) {
        socketRef.current.emit('end-voice');
      }
      stopCapture();
      return;
    }

    setError(null);

    // Mode A: If WebSocket audio server is connected, use real-time PCM stream
    if (isSocketConnected && socketRef.current?.connected) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        mediaStreamRef.current = stream;

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        playbackCtxRef.current = new AudioCtx({ sampleRate: OUTPUT_RATE });
        captureCtxRef.current = new AudioCtx();
        await playbackCtxRef.current.resume();
        await captureCtxRef.current.resume();
        nextPlayTimeRef.current = 0;
        lastPartialSpeakerRef.current = null;

        const captureCtx = captureCtxRef.current;
        const source = captureCtx.createMediaStreamSource(stream);
        const processor = captureCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (!socketRef.current || !readyRef.current) return;
          const input = e.inputBuffer.getChannelData(0);
          const down = downsampleTo16k(input, captureCtx.sampleRate);
          socketRef.current.emit('user-audio-chunk', float32ToBase64Pcm16(down));
        };

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
      return;
    }

    // Mode B: Serverless Web Speech Mode (Works 100% on Vercel without WebSockets)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari, or type your message.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      setIsActive(true);
      setStatus('listening');

      let finalTranscript = '';

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        setTextInput(finalTranscript || interim);
      };

      recognition.onerror = (e) => {
        console.warn('Speech recognition error:', e.error);
        if (e.error !== 'no-speech') {
          setError(`Speech error: ${e.error}`);
        }
        stopCapture();
      };

      recognition.onend = async () => {
        setIsActive(false);
        if (finalTranscript.trim()) {
          const userMsg = finalTranscript.trim();
          setTextInput('');
          setTranscript(prev => [...prev, { speaker: 'user', text: userMsg }]);
          await sendToGemini(userMsg);
        } else {
          setStatus('idle');
        }
      };

      recognition.start();
    } catch (recErr) {
      console.error('Speech recognition failed to start:', recErr);
      setError('Could not access microphone for speech recognition.');
      stopCapture();
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'connecting':
        return { text: 'Connecting to Gemini...', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' };
      case 'listening':
        return { text: 'Listening — speak now...', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
      case 'thinking':
        return { text: 'Gemini is thinking...', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' };
      case 'speaking':
        return { text: 'Gemini is speaking...', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' };
      default:
        return { text: 'Gemini AI Ready', color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="glass-card flex flex-col overflow-hidden" style={{ height: '780px' }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(15, 17, 23, 0.5)'
      }}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-all" style={{
              background: isActive ? 'var(--gradient-accent)' : 'var(--gradient-primary)',
              boxShadow: isActive ? '0 0 20px rgba(16, 185, 129, 0.4)' : '0 0 15px rgba(99, 102, 241, 0.2)'
            }}>
              <Bot size={20} className="text-white" />
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-sm leading-none" style={{ color: 'var(--text-primary)' }}>
              Voice Assistant
            </h3>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-indigo-400'}`} />
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {badge.text}
              </span>
            </div>
          </div>
        </div>

        {/* Persona Select */}
        <select 
          value={persona} 
          onChange={(e) => setPersona(e.target.value)}
          className="text-xs rounded-lg px-2.5 py-1.5 focus:outline-none transition-all cursor-pointer"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)'
          }}
        >
          <option value="Helpful Assistant">Helpful Assistant</option>
          <option value="Data Analyst">Data Analyst</option>
          <option value="Customer Support">Customer Support</option>
          <option value="Technical Expert">Technical Expert</option>
        </select>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl flex items-center justify-between gap-2 border text-xs" style={{
          background: 'rgba(239, 68, 68, 0.1)',
          borderColor: 'rgba(239, 68, 68, 0.25)',
          color: '#fca5a5'
        }}>
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-xs hover:text-white cursor-pointer">✕</button>
        </div>
      )}

      {/* Transcript / Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {transcript.map((msg, idx) => {
          const isUser = msg.speaker === 'user';
          return (
            <div 
              key={idx} 
              className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              <div 
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: isUser ? 'var(--gradient-primary)' : 'var(--surface-hover)',
                  border: `1px solid ${isUser ? 'transparent' : 'var(--border-subtle)'}`
                }}
              >
                {isUser ? <User size={13} className="text-white" /> : <Sparkles size={13} className="text-indigo-400" />}
              </div>

              {/* Message Bubble */}
              <div 
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed transition-all ${
                  isUser 
                    ? 'rounded-tr-sm text-white shadow-md' 
                    : 'rounded-tl-sm text-slate-200 border'
                }`}
                style={{
                  background: isUser ? 'var(--gradient-primary)' : 'rgba(22, 25, 35, 0.85)',
                  borderColor: isUser ? 'transparent' : 'var(--border-subtle)',
                }}
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    {isUser ? 'You' : persona}
                  </span>
                  {!isUser && (
                    <button 
                      onClick={() => speakText(msg.text)} 
                      title="Speak aloud"
                      className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <Volume2 size={12} />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          );
        })}

        {/* Typing / Generating Indicator */}
        {isGenerating && (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-800 border border-slate-700/50">
              <Sparkles size={13} className="text-indigo-400 animate-spin" />
            </div>
            <div className="px-4 py-2.5 rounded-2xl bg-slate-900/80 border border-white/5 text-xs text-slate-400 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin text-indigo-400" />
              <span>Gemini is generating response...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input & Controls Footer */}
      <div className="p-4 border-t" style={{
        borderColor: 'var(--border-subtle)',
        background: 'rgba(15, 17, 23, 0.6)'
      }}>
        {/* Text Input Row (ALWAYS ENABLED) */}
        <div className="flex gap-2 mb-3">
          <input 
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Ask Gemini anything or type a prompt..."
            className="flex-1 rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-all"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendText();
            }}
          />
          <button 
            type="button"
            className="rounded-xl px-4 py-2.5 transition-all flex items-center justify-center cursor-pointer shadow-md hover:scale-105 active:scale-95"
            style={{
              background: 'var(--gradient-primary)',
              border: 'none',
              opacity: textInput.trim() ? 1 : 0.6
            }}
            disabled={!textInput.trim() || isGenerating}
            onClick={handleSendText}
            title="Send Message"
          >
            {isGenerating ? <Loader2 size={16} className="text-white animate-spin" /> : <Send size={16} className="text-white" />}
          </button>
        </div>

        {/* Mic Control */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-red-500 animate-ping' : 'bg-slate-500'}`} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {isActive ? 'Microphone Active — speak now' : 'Tap mic to speak voice prompt'}
            </span>
          </div>

          <button 
            type="button"
            onClick={handleToggleMic}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer shadow-lg"
            style={{
              background: isActive 
                ? 'linear-gradient(135deg, #ef4444, #dc2626)' 
                : 'var(--surface-raised)',
              border: `1px solid ${isActive ? '#f87171' : 'var(--border-subtle)'}`,
              color: 'white'
            }}
          >
            {isActive ? <MicOff size={14} className="text-white" /> : <Mic size={14} className="text-indigo-400" />}
            <span>{isActive ? 'Stop Mic' : 'Voice Input'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceAgent;