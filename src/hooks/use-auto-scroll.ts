"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

// Constants for scroll behavior
const SCROLL_BOTTOM_THRESHOLD_PX = 100;
const SCROLL_DEBOUNCE_MS = 150;

interface UseAutoScrollOptions {
  /**
   * Whether streaming/loading is active
   */
  isLoading: boolean;
  /**
   * Current status (streaming, submitted, etc.)
   */
  status?: "streaming" | "submitted" | "ready" | "error";
  /**
   * Messages array - triggers auto-scroll when updated
   */
  messages: unknown[];
  /**
   * Optional callback when scroll position changes
   */
  onScrollPositionChange?: (isAtBottom: boolean) => void;
  /**
   * Optional callback when user scrolls (for focus handling, etc.)
   */
  onScroll?: () => void;
}

interface UseAutoScrollReturn {
  /**
   * Ref to attach to the scrollable container
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Function to manually scroll to bottom
   */
  scrollToBottom: () => void;
  /**
   * Scroll handler to attach to container's onScroll
   */
  handleScroll: () => void;
  /**
   * Whether user is currently at bottom
   */
  isAtBottom: boolean;
}

/**
 * Custom hook for smooth auto-scrolling during message streaming
 *
 * Features:
 * - Automatic scrolling during streaming with smooth transitions
 * - Pauses when user manually scrolls up
 * - Resumes when user scrolls back to bottom
 * - Proper cleanup to prevent memory leaks
 * - Enterprise-grade error handling
 *
 * @param options - Configuration options
 * @returns Auto-scroll utilities and state
 */
export function useAutoScroll(
  options: UseAutoScrollOptions,
): UseAutoScrollReturn {
  const { isLoading, status, messages, onScrollPositionChange, onScroll } =
    options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Auto-scroll state management
  const autoScrollEnabledRef = useRef(true);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Smooth scroll function using requestAnimationFrame for optimal performance
  const smoothScrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    try {
      // Cancel any pending scroll
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      rafIdRef.current = requestAnimationFrame(() => {
        try {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
        } catch (error) {
          // Silently handle scroll errors (e.g., element removed from DOM)
          console.debug("[useAutoScroll] Scroll error:", error);
        } finally {
          rafIdRef.current = null;
        }
      });
    } catch (error) {
      // Silently handle RAF errors
      console.debug("[useAutoScroll] RequestAnimationFrame error:", error);
      rafIdRef.current = null;
    }
  }, []);

  // Enhanced scroll handler with auto-scroll state management
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    try {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isScrollAtBottom = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX;

      setIsAtBottom(isScrollAtBottom);
      onScrollPositionChange?.(isScrollAtBottom);

      // Clear existing timeout
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }

      // Mark as user scrolling
      isUserScrollingRef.current = true;

      // Update auto-scroll state
      autoScrollEnabledRef.current = isScrollAtBottom;

      // Reset user scrolling flag after scroll stops
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
        scrollTimeoutRef.current = null;
      }, SCROLL_DEBOUNCE_MS);

      onScroll?.();
    } catch (error) {
      // Silently handle scroll calculation errors
      console.debug("[useAutoScroll] Scroll handler error:", error);
    }
  }, [onScrollPositionChange, onScroll]);

  const scrollToBottom = useCallback(() => {
    // Enable auto-scroll when user clicks scroll-to-bottom button
    autoScrollEnabledRef.current = true;
    smoothScrollToBottom();
  }, [smoothScrollToBottom]);

  // Enable auto-scroll when streaming starts
  useEffect(() => {
    const isStreaming = status === "streaming" || status === "submitted";
    if (isStreaming || isLoading) {
      // Check if user is at bottom, if so enable auto-scroll
      const container = containerRef.current;
      if (container) {
        try {
          const { scrollTop, scrollHeight, clientHeight } = container;
          const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
          const isAtBottomValue =
            distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX;
          if (isAtBottomValue) {
            autoScrollEnabledRef.current = true;
          }
        } catch (error) {
          // Silently handle scroll calculation errors
          console.debug("[useAutoScroll] Scroll position check error:", error);
        }
      }
    }
  }, [isLoading, status]);

  // Auto-scroll effect during streaming
  useEffect(() => {
    if (!autoScrollEnabledRef.current) return;
    const isStreaming = status === "streaming" || status === "submitted";
    if (!isStreaming && !isLoading) return;

    smoothScrollToBottom();
  }, [messages, status, isLoading, smoothScrollToBottom]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup scroll-related refs
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  return {
    containerRef,
    scrollToBottom,
    handleScroll,
    isAtBottom,
  };
}
