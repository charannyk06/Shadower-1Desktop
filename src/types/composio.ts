import { Tool } from "ai";
import { tag } from "lib/tag";
import { z } from "zod";

export const ComposioAppSchema = z.object({
  appId: z.string(),
  key: z.string().optional(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  logo: z.string().optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  no_auth: z.boolean().optional(),
  hasIntegration: z.boolean().optional(),
  meta: z
    .object({
      is_custom_app: z.boolean().optional(),
      triggersCount: z.number().optional(),
      actionsCount: z.number().optional(),
    })
    .optional(),
});

export type ComposioApp = z.infer<typeof ComposioAppSchema>;

export const ComposioToolInfoSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  appName: z.string(),
  appId: z.string(),
  parameters: z
    .object({
      type: z.string().optional(),
      properties: z.record(z.string(), z.any()).optional(),
      required: z.array(z.string()).optional(),
    })
    .optional(),
});

export type ComposioToolInfo = z.infer<typeof ComposioToolInfoSchema>;

export const ComposioConnectionSchema = z.object({
  id: z.string(),
  appName: z.string(),
  status: z.enum(["active", "pending", "expired", "error"]),
  createdAt: z.string().or(z.date()),
  expiresAt: z.string().or(z.date()).optional(),
});

export type ComposioConnection = z.infer<typeof ComposioConnectionSchema>;

export type ComposioEntityInfo = {
  id: string;
  userId: string;
  connectedApps: ComposioConnection[];
  createdAt: Date;
  updatedAt: Date;
};

export type ComposioConnectionInsert = {
  userId: string;
  entityId: string;
  appName?: string;
};

export type ComposioConnectionSelect = {
  id: string;
  userId: string;
  entityId: string;
  connectedApps: string[] | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VercelAIComposioTool = Tool & {
  _composioAppName: string;
  _composioAppId: string;
  _originToolName: string;
  _isComposioTool: true;
};

export const VercelAIComposioToolTag = tag<VercelAIComposioTool>("app");

export const AllowedComposioAppsSchema = z.object({
  apps: z.array(z.string()),
  tools: z.array(z.string()).optional(),
});

export type AllowedComposioApps = z.infer<typeof AllowedComposioAppsSchema>;

export interface ComposioRepository {
  getEntityByUserId(userId: string): Promise<ComposioConnectionSelect | null>;
  createEntity(
    data: ComposioConnectionInsert,
  ): Promise<ComposioConnectionSelect>;
  updateEntity(
    userId: string,
    data: Partial<ComposioConnectionSelect>,
  ): Promise<ComposioConnectionSelect>;
  deleteEntity(userId: string): Promise<void>;
  addConnectedApp(userId: string, appName: string): Promise<void>;
  removeConnectedApp(userId: string, appName: string): Promise<void>;
}
