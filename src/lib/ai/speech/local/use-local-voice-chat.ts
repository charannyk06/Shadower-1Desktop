"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateUUID } from "lib/utils";
import {
  UIMessageWithCompleted,
  VoiceChatOptions,
  VoiceChatSession,
} from "..";

// Get available local voices from browser SpeechSynthesis API
export function getLocalVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return [];
  }
  return window.speechSynthesis.getVoices();
}

// SpeechRecognition type definitions for browser API
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

/**
 * Local voice chat hook using browser Speech Recognition and Speech Synthesis APIs.
 * This provides a fallback for when OpenAI Realtime API is not available.
 */
export function useLocalVoiceChat(
  _props?: VoiceChatOptions,
): VoiceChatSession {
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [messages, setMessages] = useState<UIMessageWithCompleted[]>([]);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Check if browser supports speech APIs
  const isSpeechSupported = useCallback(() => {
    if (typeof window === "undefined") return false;
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SpeechRecognitionAPI && !!window.speechSynthesis;
  }, []);

  // Speak text using browser TTS
  const speakText = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    synthesisRef.current = utterance;

    utterance.onstart = () => setIsAssistantSpeaking(true);
    utterance.onend = () => setIsAssistantSpeaking(false);
    utterance.onerror = () => setIsAssistantSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, []);

  // Start listening for speech input
  const startListening = useCallback(async () => {
    if (!isSpeechSupported()) {
      setError(new Error("Speech recognition is not supported in this browser"));
      return;
    }

    try {
      const SpeechRecognitionAPI =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognitionAPI();

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onspeechstart = () => {
        setIsUserSpeaking(true);
      };

      recognition.onspeechend = () => {
        setIsUserSpeaking(false);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const result = event.results[event.results.length - 1];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          const messageId = generateUUID();
          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "user",
              parts: [{ type: "text", text: transcript }],
              completed: true,
            },
          ]);
        }
      };

      recognition.onerror = (event) => {
        if (event.error !== "no-speech" && event.error !== "aborted") {
          setError(new Error(`Speech recognition error: ${event.error}`));
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setIsUserSpeaking(false);
        // Restart if still active
        if (isActive && recognitionRef.current === recognition) {
          try {
            recognition.start();
          } catch {
            // Ignore restart errors
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [isSpeechSupported, isActive]);

  // Stop listening
  const stopListening = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsUserSpeaking(false);
  }, []);

  // Start voice chat session
  const start = useCallback(async () => {
    if (isActive || isLoading) return;

    if (!isSpeechSupported()) {
      setError(new Error("Speech APIs are not supported in this browser"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setMessages([]);

    try {
      setIsActive(true);
      await startListening();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsActive(false);
    } finally {
      setIsLoading(false);
    }
  }, [isActive, isLoading, isSpeechSupported, startListening]);

  // Stop voice chat session
  const stop = useCallback(async () => {
    try {
      await stopListening();

      // Cancel any ongoing speech
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      setIsActive(false);
      setIsAssistantSpeaking(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    isActive,
    isListening,
    isUserSpeaking,
    isAssistantSpeaking,
    isLoading,
    error,
    messages,
    start,
    stop,
    startListening,
    stopListening,
    speakText,
  };
}
