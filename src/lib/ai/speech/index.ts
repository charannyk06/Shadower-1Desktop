import { UIMessage } from "ai";
import { ChatMention } from "app-types/chat";

export type UIMessageWithCompleted = UIMessage & { completed: boolean };

export interface VoiceChatSession {
  isActive: boolean;
  isListening: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  isLoading: boolean;
  messages: UIMessageWithCompleted[];
  error: Error | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
}

export type VoiceChatOptions = {
  toolMentions?: ChatMention[];
  agentId?: string;
  model?: string;
  voice?: string;
};

export type VoiceChatHook = (props?: {
  [key: string]: any;
}) => VoiceChatSession;

export const DEFAULT_VOICE_TOOLS = [
  {
    type: "function",
    name: "changeBrowserTheme",
    description: "Change the browser theme",
    parameters: {
      type: "object",
      properties: {
        theme: {
          type: "string",
          enum: ["light", "dark"],
        },
      },
      required: ["theme"],
    },
  },
  {
    type: "function",
    name: "endConversation",
    description:
      "End the current voice conversation, similar to hanging up a call. This tool should be invoked when the user clearly expresses a desire to finish, exit, or end the dialogue.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "executeAppAction",
    description:
      "Execute any action on connected apps like Gmail, Slack, GitHub, Jira, Salesforce, etc. Use this to send emails, create issues, post messages, search data, and perform any other action on the user's connected apps. Describe what you want to do in natural language.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description:
            "Natural language description of what action to perform, e.g. 'send an email', 'create a GitHub issue', 'search slack messages', 'get my calendar events'",
        },
        params: {
          type: "object",
          description:
            "Parameters for the action. For emails: to, subject, body. For issues: title, body, repo. For messages: channel, text. Varies by action.",
          additionalProperties: true,
        },
      },
      required: ["intent"],
    },
  },
];
