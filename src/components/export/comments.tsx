"use client";

import { ChatExportCommentWithUser } from "app-types/chat-export";

interface CommentsProps {
  id: string;
  defaultComments: ChatExportCommentWithUser[];
}

export default function Comments({ id: _id, defaultComments }: CommentsProps) {
  if (defaultComments.length === 0) {
    return null;
  }

  return (
    <div className="bg-background/80 backdrop-blur-sm rounded-lg p-4 shadow-lg max-w-xs">
      <h3 className="text-sm font-semibold mb-2">
        Comments ({defaultComments.length})
      </h3>
      <div className="space-y-2">
        {defaultComments.map((comment) => (
          <div key={comment.id} className="text-xs text-muted-foreground">
            <span className="font-medium">{comment.authorName}:</span>{" "}
            {/* Content is TipTapMentionJsonContent, render as JSON for now */}
            {typeof comment.content === "string"
              ? comment.content
              : JSON.stringify(comment.content)}
          </div>
        ))}
      </div>
    </div>
  );
}
