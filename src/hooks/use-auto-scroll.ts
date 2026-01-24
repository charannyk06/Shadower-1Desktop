"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

// Constants for scroll behavior
const SCROLL_BOTTOM_THRESHOLD_PX = 100;
const SCROLL_DEBOUNCE_MS = 100;
// Interpolation factor - higher = faster catch-up (0.1 = smooth, 0.3 = snappy)
const SCROLL_LERP_FACTOR = 0.15;
// Minimum distance to bother animating
const SCROLL_MIN_DELTA = 1;

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
  containerRef: React.RefObject<HTMLDivElement>;
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
 * - Butter-smooth scrolling using linear interpolation (no animation stacking)
 * - Continuous animation loop during streaming for fluid motion
 * - Pauses when user manually scrolls up
 * - Resumes when user scrolls back to bottom
 * - Proper cleanup to prevent memory leaks
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
  const animationFrameRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);

  // Smooth interpolation scroll animation
  // This creates butter-smooth scrolling without CSS animation stacking
  const animateScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || !autoScrollEnabledRef.current) {
      isAnimatingRef.current = false;
      return;
    }

    const targetScroll = container.scrollHeight - container.clientHeight;
    const currentScroll = container.scrollTop;
    const delta = targetScroll - currentScroll;

    // If we're close enough, snap to target and stop
    if (Math.abs(delta) < SCROLL_MIN_DELTA) {
      container.scrollTop = targetScroll;
      isAnimatingRef.current = false;
      return;
    }

    // Smooth interpolation - move a fraction of the remaining distance each frame
    // This creates an easing effect without stacking animations
    container.scrollTop = currentScroll + delta * SCROLL_LERP_FACTOR;

    // Continue animation loop
    animationFrameRef.current = requestAnimationFrame(animateScroll);
  }, []);

  // Start the smooth scroll animation loop
  const startSmoothScroll = useCallback(() => {
    if (isAnimatingRef.current) return; // Already animating

    isAnimatingRef.current = true;

    // Cancel any existing animation
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(animateScroll);
  }, [animateScroll]);

  // Stop the animation loop
  const stopAnimation = useCallback(() => {
    isAnimatingRef.current = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
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

      // Mark as user scrolling (temporarily disable auto-scroll detection)
      isUserScrollingRef.current = true;

      // Update auto-scroll state based on position
      autoScrollEnabledRef.current = isScrollAtBottom;

      // If user scrolled away from bottom, stop animation
      if (!isScrollAtBottom) {
        stopAnimation();
      }

      // Reset user scrolling flag after scroll stops
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
        scrollTimeoutRef.current = null;
      }, SCROLL_DEBOUNCE_MS);

      onScroll?.();
    } catch (error) {
      console.debug("[useAutoScroll] Scroll handler error:", error);
    }
  }, [onScrollPositionChange, onScroll, stopAnimation]);

  // Manual scroll to bottom button - always smooth
  const scrollToBottom = useCallback(() => {
    autoScrollEnabledRef.current = true;
    startSmoothScroll();
  }, [startSmoothScroll]);

  // Enable auto-scroll when streaming starts (if at bottom)
  useEffect(() => {
    const isStreaming = status === "streaming" || status === "submitted";
    if (isStreaming || isLoading) {
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
          console.debug("[useAutoScroll] Scroll position check error:", error);
        }
      }
    }
  }, [isLoading, status]);

  // Start/continue smooth scroll animation during streaming
  useEffect(() => {
    if (!autoScrollEnabledRef.current) return;

    const isStreaming = status === "streaming" || status === "submitted";
    if (!isStreaming && !isLoading) {
      // Streaming stopped - do one final scroll to ensure we're at bottom
      startSmoothScroll();
      return;
    }

    // Start or continue the smooth scroll animation
    startSmoothScroll();
  }, [messages, status, isLoading, startSmoothScroll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
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
