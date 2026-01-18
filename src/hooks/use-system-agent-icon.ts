"use client";

import { AgentIcon } from "app-types/agent";
import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "system-agent-icon-";

/**
 * Hook to manage custom icons for system agents (stored in localStorage)
 */
export function useSystemAgentIcon(agentId?: string) {
  const [customIcon, setCustomIconState] = useState<AgentIcon | null>(null);

  // Load custom icon from localStorage
  const loadCustomIcon = useCallback((): AgentIcon | null => {
    if (!agentId || typeof window === "undefined") return null;
    try {
      const key = `${STORAGE_PREFIX}${agentId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as AgentIcon;
      }
    } catch (error) {
      console.error("Failed to load system agent custom icon:", error);
    }
    return null;
  }, [agentId]);

  // Save custom icon to localStorage
  const saveCustomIcon = useCallback(
    (icon: AgentIcon) => {
      if (!agentId || typeof window === "undefined") return;
      try {
        const key = `${STORAGE_PREFIX}${agentId}`;
        localStorage.setItem(key, JSON.stringify(icon));
        setCustomIconState(icon);
      } catch (error) {
        console.error("Failed to save system agent custom icon:", error);
      }
    },
    [agentId],
  );

  // Get effective icon (custom if available, otherwise default)
  const getEffectiveIcon = useCallback(
    (defaultIcon: AgentIcon): AgentIcon => {
      return customIcon || defaultIcon;
    },
    [customIcon],
  );

  // Load icon on mount and when agentId changes
  useEffect(() => {
    if (agentId) {
      const loaded = loadCustomIcon();
      setCustomIconState(loaded);
    }
  }, [agentId, loadCustomIcon]);

  return {
    customIcon,
    saveCustomIcon,
    getEffectiveIcon,
  };
}

/**
 * Utility function to get custom icon for a system agent (for use outside React components)
 */
export function getSystemAgentCustomIcon(agentId: string): AgentIcon | null {
  if (typeof window === "undefined") return null;
  try {
    const key = `${STORAGE_PREFIX}${agentId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as AgentIcon;
    }
  } catch (error) {
    console.error("Failed to load system agent custom icon:", error);
  }
  return null;
}
