import { convertTextToTiptapWithMentions } from "lib/ai/workflow/convert-tiptap-mentions";
import { describe, expect, it } from "vitest";

describe("convertTextToTiptapWithMentions", () => {
  describe("empty/null inputs", () => {
    it("should return empty doc for empty string", () => {
      const result = convertTextToTiptapWithMentions("", {});
      expect(result).toEqual({
        type: "doc",
        content: [],
      });
    });

    it("should return empty doc for whitespace-only string", () => {
      const result = convertTextToTiptapWithMentions("   ", {});
      expect(result).toEqual({
        type: "doc",
        content: [],
      });
    });
  });

  describe("plain text without mentions", () => {
    it("should wrap plain text in proper TipTap structure", () => {
      const result = convertTextToTiptapWithMentions("Hello world", {});
      expect(result).toEqual({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world" }],
          },
        ],
      });
    });
  });

  describe("single mention", () => {
    it("should convert simple {{nodeId.output.field}} to mention", () => {
      const idMapping = { "node-input-1": "uuid-123" };
      const result = convertTextToTiptapWithMentions(
        "Search for: {{node-input-1.output.query}}",
        idMapping,
      );

      expect(result.type).toBe("doc");
      expect(result.content[0].type).toBe("paragraph");

      const content = result.content[0].content;
      expect(content).toHaveLength(2);

      // Text before mention
      expect(content[0]).toEqual({ type: "text", text: "Search for: " });

      // Mention node
      expect(content[1].type).toBe("mention");
      expect(content[1].attrs.id).toBe("uuid-123");

      const sourceKey = JSON.parse(content[1].attrs.label);
      expect(sourceKey.nodeId).toBe("uuid-123");
      expect(sourceKey.path).toEqual(["query"]);
    });

    it("should handle {{nodeId.output}} without path", () => {
      const idMapping = { "node-tool-1": "uuid-456" };
      const result = convertTextToTiptapWithMentions(
        "Process: {{node-tool-1.output}}",
        idMapping,
      );

      const content = result.content[0].content;
      const sourceKey = JSON.parse(content[1].attrs.label);
      expect(sourceKey.path).toEqual([]);
    });

    it("should handle nested paths like {{nodeId.output.data.emails}}", () => {
      const idMapping = { "node-fetch": "uuid-789" };
      const result = convertTextToTiptapWithMentions(
        "Emails: {{node-fetch.output.data.emails}}",
        idMapping,
      );

      const content = result.content[0].content;
      const sourceKey = JSON.parse(content[1].attrs.label);
      expect(sourceKey.path).toEqual(["data", "emails"]);
    });
  });

  describe("multiple mentions", () => {
    it("should convert multiple mentions in same text", () => {
      const idMapping = {
        "node-input-1": "uuid-input",
        "node-fetch": "uuid-fetch",
      };
      const result = convertTextToTiptapWithMentions(
        "Fetch {{node-input-1.output.maxResults}} emails about {{node-input-1.output.query}}",
        idMapping,
      );

      const content = result.content[0].content;
      expect(content).toHaveLength(4);

      expect(content[0]).toEqual({ type: "text", text: "Fetch " });
      expect(content[1].type).toBe("mention");
      expect(content[2]).toEqual({ type: "text", text: " emails about " });
      expect(content[3].type).toBe("mention");
    });

    it("should handle adjacent mentions without text between", () => {
      const idMapping = {
        "node-a": "uuid-a",
        "node-b": "uuid-b",
      };
      const result = convertTextToTiptapWithMentions(
        "{{node-a.output.x}}{{node-b.output.y}}",
        idMapping,
      );

      const content = result.content[0].content;
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("mention");
      expect(content[1].type).toBe("mention");
    });
  });

  describe("ID mapping", () => {
    it("should map AI-generated IDs to UUIDs", () => {
      const idMapping = {
        "node-input-1": "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = convertTextToTiptapWithMentions(
        "{{node-input-1.output.query}}",
        idMapping,
      );

      const content = result.content[0].content;
      expect(content[0].attrs.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("should preserve original ID if not in mapping", () => {
      const result = convertTextToTiptapWithMentions(
        "{{unknown-node.output.field}}",
        {},
      );

      const content = result.content[0].content;
      expect(content[0].attrs.id).toBe("unknown-node");
    });
  });

  describe("tool_result pattern (critical for workflow execution)", () => {
    it("should correctly handle tool_result reference", () => {
      const idMapping = { "node-fetch-emails": "uuid-tool" };
      const result = convertTextToTiptapWithMentions(
        "Summarize these emails:\n\n{{node-fetch-emails.output.tool_result}}",
        idMapping,
      );

      // With \n\n, text splits into 3 paragraphs:
      // [0]: "Summarize these emails:" (text)
      // [1]: "" (empty paragraph)
      // [2]: mention node
      expect(result.content).toHaveLength(3);

      // First paragraph should have the text
      const firstParagraph = result.content[0].content;
      expect(firstParagraph).toHaveLength(1);
      expect(firstParagraph[0]).toEqual({
        type: "text",
        text: "Summarize these emails:",
      });

      // Third paragraph should have the mention
      const thirdParagraph = result.content[2].content;
      expect(thirdParagraph).toHaveLength(1);

      const sourceKey = JSON.parse(thirdParagraph[0].attrs.label);
      expect(sourceKey.nodeId).toBe("uuid-tool");
      expect(sourceKey.path).toEqual(["tool_result"]);
    });
  });

  describe("edge cases", () => {
    it("should not match malformed patterns", () => {
      const result = convertTextToTiptapWithMentions(
        "Invalid: {node.output.x} and {{node.input.y}}",
        {},
      );

      const content = result.content[0].content;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe("text");
    });

    it("should handle text after last mention", () => {
      const idMapping = { "node-1": "uuid-1" };
      const result = convertTextToTiptapWithMentions(
        "Start {{node-1.output.x}} end",
        idMapping,
      );

      const content = result.content[0].content;
      expect(content).toHaveLength(3);
      expect(content[2]).toEqual({ type: "text", text: " end" });
    });

    it("should handle mention at start of text", () => {
      const idMapping = { "node-1": "uuid-1" };
      const result = convertTextToTiptapWithMentions(
        "{{node-1.output.x}} is the value",
        idMapping,
      );

      const content = result.content[0].content;
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("mention");
      expect(content[1]).toEqual({ type: "text", text: " is the value" });
    });

    it("should handle mention at end of text", () => {
      const idMapping = { "node-1": "uuid-1" };
      const result = convertTextToTiptapWithMentions(
        "The value is {{node-1.output.x}}",
        idMapping,
      );

      const content = result.content[0].content;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "The value is " });
      expect(content[1].type).toBe("mention");
    });
  });
});
