import { relations } from "drizzle-orm/relations";
import {
  account,
  agent,
  archive,
  archiveItem,
  bookmark,
  chatExport,
  chatExportComment,
  chatMessage,
  chatThread,
  mcpOauthSession,
  mcpServer,
  mcpServerCustomInstructions,
  mcpServerToolCustomInstructions,
  promoCode,
  promoCodeRedemption,
  referral,
  session,
  subscription,
  usageAlert,
  usageEvent,
  user,
  userInvitation,
  workflow,
  workflowEdge,
  workflowNode,
} from "./schema";

export const agentRelations = relations(agent, ({ one }) => ({
  user: one(user, {
    fields: [agent.userId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  agents: many(agent),
  archives: many(archive),
  bookmarks: many(bookmark),
  chatExports: many(chatExport),
  chatThreads: many(chatThread),
  accounts: many(account),
  chatExportComments: many(chatExportComment),
  mcpServerCustomInstructions: many(mcpServerCustomInstructions),
  sessions: many(session),
  mcpServerToolCustomInstructions: many(mcpServerToolCustomInstructions),
  userInvitations: many(userInvitation),
  mcpServers: many(mcpServer),
  archiveItems: many(archiveItem),
  workflows: many(workflow),
  subscriptions: many(subscription),
  referrals_referrerId: many(referral, {
    relationName: "referral_referrerId_user_id",
  }),
  referrals_refereeId: many(referral, {
    relationName: "referral_refereeId_user_id",
  }),
  promoCodeRedemptions: many(promoCodeRedemption),
  usageEvents: many(usageEvent),
  usageAlerts: many(usageAlert),
}));

export const archiveRelations = relations(archive, ({ one, many }) => ({
  user: one(user, {
    fields: [archive.userId],
    references: [user.id],
  }),
  archiveItems: many(archiveItem),
}));

export const bookmarkRelations = relations(bookmark, ({ one }) => ({
  user: one(user, {
    fields: [bookmark.userId],
    references: [user.id],
  }),
}));

export const chatExportRelations = relations(chatExport, ({ one, many }) => ({
  user: one(user, {
    fields: [chatExport.exporterId],
    references: [user.id],
  }),
  chatExportComments: many(chatExportComment),
}));

export const chatThreadRelations = relations(chatThread, ({ one, many }) => ({
  user: one(user, {
    fields: [chatThread.userId],
    references: [user.id],
  }),
  chatMessages: many(chatMessage),
}));

export const chatMessageRelations = relations(chatMessage, ({ one }) => ({
  chatThread: one(chatThread, {
    fields: [chatMessage.threadId],
    references: [chatThread.id],
  }),
}));

export const mcpOauthSessionRelations = relations(
  mcpOauthSession,
  ({ one }) => ({
    mcpServer: one(mcpServer, {
      fields: [mcpOauthSession.mcpServerId],
      references: [mcpServer.id],
    }),
  }),
);

export const mcpServerRelations = relations(mcpServer, ({ one, many }) => ({
  mcpOauthSessions: many(mcpOauthSession),
  mcpServerCustomInstructions: many(mcpServerCustomInstructions),
  mcpServerToolCustomInstructions: many(mcpServerToolCustomInstructions),
  user: one(user, {
    fields: [mcpServer.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const chatExportCommentRelations = relations(
  chatExportComment,
  ({ one, many }) => ({
    chatExport: one(chatExport, {
      fields: [chatExportComment.exportId],
      references: [chatExport.id],
    }),
    user: one(user, {
      fields: [chatExportComment.authorId],
      references: [user.id],
    }),
    chatExportComment: one(chatExportComment, {
      fields: [chatExportComment.parentId],
      references: [chatExportComment.id],
      relationName: "chatExportComment_parentId_chatExportComment_id",
    }),
    chatExportComments: many(chatExportComment, {
      relationName: "chatExportComment_parentId_chatExportComment_id",
    }),
  }),
);

export const mcpServerCustomInstructionsRelations = relations(
  mcpServerCustomInstructions,
  ({ one }) => ({
    user: one(user, {
      fields: [mcpServerCustomInstructions.userId],
      references: [user.id],
    }),
    mcpServer: one(mcpServer, {
      fields: [mcpServerCustomInstructions.mcpServerId],
      references: [mcpServer.id],
    }),
  }),
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const mcpServerToolCustomInstructionsRelations = relations(
  mcpServerToolCustomInstructions,
  ({ one }) => ({
    user: one(user, {
      fields: [mcpServerToolCustomInstructions.userId],
      references: [user.id],
    }),
    mcpServer: one(mcpServer, {
      fields: [mcpServerToolCustomInstructions.mcpServerId],
      references: [mcpServer.id],
    }),
  }),
);

export const userInvitationRelations = relations(userInvitation, ({ one }) => ({
  user: one(user, {
    fields: [userInvitation.invitedBy],
    references: [user.id],
  }),
}));

export const archiveItemRelations = relations(archiveItem, ({ one }) => ({
  archive: one(archive, {
    fields: [archiveItem.archiveId],
    references: [archive.id],
  }),
  user: one(user, {
    fields: [archiveItem.userId],
    references: [user.id],
  }),
}));

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  user: one(user, {
    fields: [workflow.userId],
    references: [user.id],
  }),
  workflowEdges: many(workflowEdge),
  workflowNodes: many(workflowNode),
}));

export const workflowEdgeRelations = relations(workflowEdge, ({ one }) => ({
  workflow: one(workflow, {
    fields: [workflowEdge.workflowId],
    references: [workflow.id],
  }),
  workflowNode_source: one(workflowNode, {
    fields: [workflowEdge.source],
    references: [workflowNode.id],
    relationName: "workflowEdge_source_workflowNode_id",
  }),
  workflowNode_target: one(workflowNode, {
    fields: [workflowEdge.target],
    references: [workflowNode.id],
    relationName: "workflowEdge_target_workflowNode_id",
  }),
}));

export const workflowNodeRelations = relations(
  workflowNode,
  ({ one, many }) => ({
    workflowEdges_source: many(workflowEdge, {
      relationName: "workflowEdge_source_workflowNode_id",
    }),
    workflowEdges_target: many(workflowEdge, {
      relationName: "workflowEdge_target_workflowNode_id",
    }),
    workflow: one(workflow, {
      fields: [workflowNode.workflowId],
      references: [workflow.id],
    }),
  }),
);

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  user: one(user, {
    fields: [subscription.userId],
    references: [user.id],
  }),
}));

export const referralRelations = relations(referral, ({ one }) => ({
  user_referrerId: one(user, {
    fields: [referral.referrerId],
    references: [user.id],
    relationName: "referral_referrerId_user_id",
  }),
  user_refereeId: one(user, {
    fields: [referral.refereeId],
    references: [user.id],
    relationName: "referral_refereeId_user_id",
  }),
}));

export const promoCodeRedemptionRelations = relations(
  promoCodeRedemption,
  ({ one }) => ({
    promoCode: one(promoCode, {
      fields: [promoCodeRedemption.promoCodeId],
      references: [promoCode.id],
    }),
    user: one(user, {
      fields: [promoCodeRedemption.userId],
      references: [user.id],
    }),
  }),
);

export const promoCodeRelations = relations(promoCode, ({ many }) => ({
  promoCodeRedemptions: many(promoCodeRedemption),
}));

export const usageEventRelations = relations(usageEvent, ({ one }) => ({
  user: one(user, {
    fields: [usageEvent.userId],
    references: [user.id],
  }),
}));

export const usageAlertRelations = relations(usageAlert, ({ one }) => ({
  user: one(user, {
    fields: [usageAlert.userId],
    references: [user.id],
  }),
}));
