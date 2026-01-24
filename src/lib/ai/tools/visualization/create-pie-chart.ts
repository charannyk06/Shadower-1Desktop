import { tool as createTool } from "ai";
import { z } from "zod";

// Permissive number for local model compatibility
const permissiveNumber = () =>
  z.union([
    z.number(),
    z.string().transform(v => {
      const parsed = parseFloat(v);
      if (isNaN(parsed)) throw new Error(`Cannot convert "${v}" to number`);
      return parsed;
    })
  ]);

export const createPieChartTool = createTool({
  description: "Create a pie chart",
  inputSchema: z.object({
    data: z.array(z.object({ label: z.string(), value: permissiveNumber() })),
    title: z.string(),
    description: z.string().nullable(),
    unit: z.string().nullable(),
  }),
  execute: async () => {
    return "Success";
  },
});
