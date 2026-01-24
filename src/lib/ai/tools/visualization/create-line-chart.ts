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

export const createLineChartTool = createTool({
  description: "Create a line chart with multiple data series",
  inputSchema: z.object({
    data: z
      .array(
        z.object({
          xAxisLabel: z.string(),
          series: z.array(
            z.object({
              seriesName: z.string(),
              value: permissiveNumber(),
            }),
          ),
        }),
      )
      .describe("Chart data with x-axis labels and series values"),
    title: z.string(),
    description: z.string().nullable(),
    yAxisLabel: z.string().nullable().describe("Label for Y-axis"),
  }),
  execute: async () => {
    return "Success";
  },
});
