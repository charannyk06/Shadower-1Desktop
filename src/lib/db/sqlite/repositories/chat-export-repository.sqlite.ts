import {
  ChatExport,
  ChatExportCommentWithUser,
  ChatExportCreateSchema,
  ChatExportRepository,
  ChatExportSummary,
  ChatExportWithUser,
} from "app-types/chat-export";
import { and, count, eq, sql } from "drizzle-orm";
import z from "zod";
import { sqliteDb as db } from "../db.sqlite";
import {
  ChatExportCommentTable,
  ChatExportTable,
  UserTable,
} from "../schema.sqlite";
import { sqliteChatRepository } from "./chat-repository.sqlite";

function toChatExport(data: typeof ChatExportTable.$inferSelect): ChatExport {
  return {
    id: data.id,
    exporterId: data.exporterId,
    title: data.title,
    messages: data.messages,
    originalThreadId: data.originalThreadId ?? undefined,
    exportedAt: data.exportedAt ?? new Date(),
    expiresAt: data.expiresAt ?? undefined,
  };
}

function toChatExportInsert(
  data: z.infer<typeof ChatExportCreateSchema>,
): typeof ChatExportTable.$inferInsert {
  return ChatExportCreateSchema.parse(data) as ChatExport;
}

export const sqliteChatExportRepository: ChatExportRepository = {
  exportChat: async ({ threadId, exporterId, expiresAt }) => {
    const [thread, messages] = await Promise.all([
      sqliteChatRepository.selectThread(threadId),
      sqliteChatRepository.selectMessagesByThreadId(threadId),
    ]);

    if (!thread) {
      throw new Error("Thread not found");
    }

    return await sqliteChatExportRepository.insert({
      exporterId: exporterId ?? thread.userId,
      title: thread.title,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
        metadata: m.metadata,
      })),
      originalThreadId: threadId,
      expiresAt,
    });
  },

  insert: async (data) => {
    const result = await db
      .insert(ChatExportTable)
      .values(toChatExportInsert(data))
      .returning();
    return result[0].id;
  },
  selectById: async (id) => {
    const [result] = await db
      .select()
      .from(ChatExportTable)
      .where(eq(ChatExportTable.id, id));
    return toChatExport(result);
  },
  selectByIdWithUser: async (id) => {
    const [result] = await db
      .select({
        id: ChatExportTable.id,
        title: ChatExportTable.title,
        exporterId: ChatExportTable.exporterId,
        messages: ChatExportTable.messages,
        exportedAt: ChatExportTable.exportedAt,
        expiresAt: ChatExportTable.expiresAt,
        originalThreadId: ChatExportTable.originalThreadId,
        exporterName: UserTable.name,
        exporterImage: UserTable.image,
      })
      .from(ChatExportTable)
      .leftJoin(UserTable, eq(ChatExportTable.exporterId, UserTable.id))
      .where(eq(ChatExportTable.id, id));
    return result as ChatExportWithUser;
  },
  selectByExporterId: async (exporterId) => {
    const result = await db
      .select()
      .from(ChatExportTable)
      .where(eq(ChatExportTable.exporterId, exporterId));
    return result.map(toChatExport);
  },
  selectSummaryByExporterId: async (exporterId) => {
    const result = await db
      .select({
        id: ChatExportTable.id,
        title: ChatExportTable.title,
        exporterId: ChatExportTable.exporterId,
        originalThreadId: ChatExportTable.originalThreadId,
        exportedAt: ChatExportTable.exportedAt,
        expiresAt: ChatExportTable.expiresAt,
        commentCount: count(ChatExportCommentTable.id),
      })
      .from(ChatExportTable)
      .leftJoin(
        ChatExportCommentTable,
        eq(ChatExportCommentTable.exportId, ChatExportTable.id),
      )
      .where(eq(ChatExportTable.exporterId, exporterId))
      .groupBy(ChatExportTable.id)
      .orderBy(sql`${ChatExportTable.exportedAt} DESC`);

    return result.map((row) => ({
      ...row,
      originalThreadId: row.originalThreadId ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      commentCount: Number(row.commentCount) || 0,
    })) as ChatExportSummary[];
  },
  checkAccess: async (id, userId) => {
    const result = await db
      .select({
        exporterId: ChatExportTable.exporterId,
      })
      .from(ChatExportTable)
      .where(
        and(eq(ChatExportTable.id, id), eq(ChatExportTable.exporterId, userId)),
      );
    return result.length > 0;
  },
  deleteById: async (id) => {
    await db.delete(ChatExportTable).where(eq(ChatExportTable.id, id));
  },
  isExpired: async (id) => {
    const [result] = await db
      .select({
        expiresAt: ChatExportTable.expiresAt,
      })
      .from(ChatExportTable)
      .where(eq(ChatExportTable.id, id));
    return !!result?.expiresAt && result.expiresAt < new Date();
  },
  insertComment: async (data) => {
    await db.insert(ChatExportCommentTable).values(data);
  },
  selectCommentsByExportId: async (exportId, userId) => {
    const result = await db
      .select({
        id: ChatExportCommentTable.id,
        exportId: ChatExportCommentTable.exportId,
        authorId: ChatExportCommentTable.authorId,
        parentId: ChatExportCommentTable.parentId,
        content: ChatExportCommentTable.content,
        createdAt: ChatExportCommentTable.createdAt,
        updatedAt: ChatExportCommentTable.updatedAt,
        authorName: UserTable.name,
        authorImage: UserTable.image,
      })
      .from(ChatExportCommentTable)
      .leftJoin(UserTable, eq(ChatExportCommentTable.authorId, UserTable.id))
      .where(eq(ChatExportCommentTable.exportId, exportId))
      .orderBy(ChatExportCommentTable.createdAt)
      .then((result) => {
        if (!userId) return result;
        return result.map((comment) => ({
          ...comment,
          isOwner: comment.authorId === userId,
        }));
      });

    const commentsById = new Map<string, ChatExportCommentWithUser>(
      result.map((comment) => [
        comment.id,
        comment as ChatExportCommentWithUser,
      ]),
    );
    result.forEach((comment) => {
      if (comment.parentId) {
        const parent = commentsById.get(comment.parentId);
        if (parent) {
          parent.replies = [
            ...(parent.replies || []),
            comment as ChatExportCommentWithUser,
          ];
        }
      }
    });

    return result.filter(
      (comment) => !comment.parentId,
    ) as ChatExportCommentWithUser[];
  },
  checkCommentAccess: async (id, authorId) => {
    const result = await db
      .select({
        authorId: ChatExportCommentTable.authorId,
      })
      .from(ChatExportCommentTable)
      .where(
        and(
          eq(ChatExportCommentTable.id, id),
          eq(ChatExportCommentTable.authorId, authorId),
        ),
      );
    return result.length > 0;
  },
  deleteComment: async (id, authorId) => {
    await db
      .delete(ChatExportCommentTable)
      .where(
        and(
          eq(ChatExportCommentTable.id, id),
          eq(ChatExportCommentTable.authorId, authorId),
        ),
      );
  },
};
