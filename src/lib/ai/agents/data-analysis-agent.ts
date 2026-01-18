import "server-only";
import { type Tool, tool as createTool } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { z } from "zod";

const logger = globalLogger.withDefaults({
  message: colorize("blue", "[Data Analysis Agent] "),
});

/**
 * Dataset profile information
 */
export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  columns: Array<{
    name: string;
    type: string;
    nullCount: number;
    uniqueCount: number;
    sample: unknown[];
  }>;
  memoryUsage: string;
}

/**
 * Statistical summary for a column
 */
export interface ColumnStats {
  name: string;
  type: "numeric" | "categorical" | "datetime" | "text";
  stats: {
    count: number;
    nullCount: number;
    uniqueCount: number;
    mean?: number;
    median?: number;
    std?: number;
    min?: number | string;
    max?: number | string;
    topValues?: Array<{ value: string; count: number }>;
  };
}

/**
 * Visualization configuration
 */
export interface VisualizationConfig {
  type: "line" | "bar" | "scatter" | "pie" | "heatmap" | "histogram" | "box";
  title: string;
  data: unknown;
  layout: Record<string, unknown>;
}

/**
 * Analysis result
 */
export interface AnalysisResult {
  profile: DatasetProfile;
  statistics: ColumnStats[];
  insights: string[];
  visualizations: VisualizationConfig[];
  recommendations: string[];
}

/**
 * Data Analysis Agent
 *
 * Performs AI-powered data analysis and visualization
 * using E2B Code Interpreter for execution.
 */
export class DataAnalysisAgent {
  private dataStream?: UIMessageStreamWriter;

  constructor(dataStream?: UIMessageStreamWriter) {
    this.dataStream = dataStream;
  }

  /**
   * Emit analysis progress to the UI
   */
  emitProgress(
    stage: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    logger.info(`[${stage}] ${message}`);
    if (this.dataStream) {
      this.dataStream.write({
        type: "data-analysis-progress",
        data: {
          stage,
          message,
          timestamp: new Date().toISOString(),
          ...data,
        },
      });
    }
  }

  /**
   * Generate Python code for data profiling
   */
  generateProfileCode(dataPath: string, fileType: string): string {
    this.emitProgress("profiling", `Profiling dataset: ${dataPath}`, {
      dataPath,
      fileType,
    });
    return `
import pandas as pd
import json
import sys

# Load data based on file type
file_type = "${fileType}"
data_path = "${dataPath}"

if file_type == "csv":
    df = pd.read_csv(data_path)
elif file_type == "excel":
    df = pd.read_excel(data_path)
elif file_type == "json":
    df = pd.read_json(data_path)
else:
    df = pd.read_csv(data_path)  # Default to CSV

# Generate profile
profile = {
    "rowCount": len(df),
    "columnCount": len(df.columns),
    "columns": [],
    "memoryUsage": f"{df.memory_usage(deep=True).sum() / 1024 / 1024:.2f} MB"
}

for col in df.columns:
    col_info = {
        "name": col,
        "type": str(df[col].dtype),
        "nullCount": int(df[col].isnull().sum()),
        "uniqueCount": int(df[col].nunique()),
        "sample": df[col].dropna().head(5).tolist()
    }
    profile["columns"].append(col_info)

print(json.dumps(profile))
`;
  }

  /**
   * Generate Python code for statistical analysis
   */
  generateStatsCode(dataPath: string, columns: string[]): string {
    const colList = columns.map((c) => `"${c}"`).join(", ");
    return `
import pandas as pd
import numpy as np
import json

df = pd.read_csv("${dataPath}")
columns_to_analyze = [${colList}] if ${columns.length > 0} else df.columns.tolist()

stats = []
for col in columns_to_analyze:
    if col not in df.columns:
        continue

    col_stats = {
        "name": col,
        "stats": {
            "count": int(df[col].count()),
            "nullCount": int(df[col].isnull().sum()),
            "uniqueCount": int(df[col].nunique())
        }
    }

    if pd.api.types.is_numeric_dtype(df[col]):
        col_stats["type"] = "numeric"
        col_stats["stats"].update({
            "mean": float(df[col].mean()) if not df[col].empty else None,
            "median": float(df[col].median()) if not df[col].empty else None,
            "std": float(df[col].std()) if not df[col].empty else None,
            "min": float(df[col].min()) if not df[col].empty else None,
            "max": float(df[col].max()) if not df[col].empty else None
        })
    elif pd.api.types.is_datetime64_any_dtype(df[col]):
        col_stats["type"] = "datetime"
        col_stats["stats"].update({
            "min": str(df[col].min()) if not df[col].empty else None,
            "max": str(df[col].max()) if not df[col].empty else None
        })
    else:
        col_stats["type"] = "categorical"
        top_values = df[col].value_counts().head(10)
        col_stats["stats"]["topValues"] = [
            {"value": str(v), "count": int(c)}
            for v, c in top_values.items()
        ]

    stats.append(col_stats)

print(json.dumps(stats))
`;
  }

  /**
   * Generate Python code for creating visualizations
   */
  generateVisualizationCode(
    dataPath: string,
    vizType: VisualizationConfig["type"],
    xColumn: string,
    yColumn?: string,
    title?: string,
  ): string {
    return `
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import json

df = pd.read_csv("${dataPath}")

viz_type = "${vizType}"
x_col = "${xColumn}"
y_col = "${yColumn || ""}"
title = "${title || `${vizType} chart`}"

if viz_type == "line":
    fig = px.line(df, x=x_col, y=y_col if y_col else None, title=title)
elif viz_type == "bar":
    if y_col:
        fig = px.bar(df, x=x_col, y=y_col, title=title)
    else:
        counts = df[x_col].value_counts()
        fig = px.bar(x=counts.index, y=counts.values, title=title)
elif viz_type == "scatter":
    fig = px.scatter(df, x=x_col, y=y_col, title=title)
elif viz_type == "pie":
    counts = df[x_col].value_counts()
    fig = px.pie(values=counts.values, names=counts.index, title=title)
elif viz_type == "histogram":
    fig = px.histogram(df, x=x_col, title=title)
elif viz_type == "box":
    fig = px.box(df, y=x_col if not y_col else y_col, x=x_col if y_col else None, title=title)
elif viz_type == "heatmap":
    numeric_cols = df.select_dtypes(include=['number']).columns
    corr = df[numeric_cols].corr()
    fig = px.imshow(corr, title=title, text_auto=True)
else:
    fig = px.histogram(df, x=x_col, title=title)

# Convert to JSON-serializable format
result = {
    "type": viz_type,
    "title": title,
    "data": fig.to_json(),
    "layout": {}
}

print(json.dumps(result))
`;
  }

  /**
   * Generate insights from statistics
   */
  generateInsights(stats: ColumnStats[]): string[] {
    const insights: string[] = [];

    for (const col of stats) {
      // Check for high null rates
      const nullRate = col.stats.nullCount / col.stats.count;
      if (nullRate > 0.1) {
        insights.push(
          `Column "${col.name}" has ${(nullRate * 100).toFixed(1)}% missing values`,
        );
      }

      // Check for high cardinality in categorical
      if (col.type === "categorical" && col.stats.uniqueCount > 100) {
        insights.push(
          `Column "${col.name}" has high cardinality (${col.stats.uniqueCount} unique values)`,
        );
      }

      // Check for potential outliers in numeric
      if (col.type === "numeric" && col.stats.std && col.stats.mean) {
        const cv = col.stats.std / Math.abs(col.stats.mean);
        if (cv > 1) {
          insights.push(
            `Column "${col.name}" shows high variability (coefficient of variation: ${cv.toFixed(2)})`,
          );
        }
      }
    }

    if (insights.length === 0) {
      insights.push(
        "Data appears well-structured with no major quality issues detected",
      );
    }

    return insights;
  }

  /**
   * Generate recommendations based on analysis
   */
  generateRecommendations(
    profile: DatasetProfile,
    stats: ColumnStats[],
  ): string[] {
    const recommendations: string[] = [];

    // Check data size
    if (profile.rowCount > 100000) {
      recommendations.push(
        "Consider sampling the data for exploratory analysis due to large size",
      );
    }

    // Check for columns needing cleaning
    const highNullCols = stats.filter(
      (s) => s.stats.nullCount / s.stats.count > 0.3,
    );
    if (highNullCols.length > 0) {
      recommendations.push(
        `Consider handling missing values in: ${highNullCols.map((c) => c.name).join(", ")}`,
      );
    }

    // Suggest visualization types
    const numericCols = stats.filter((s) => s.type === "numeric");
    const categoricalCols = stats.filter((s) => s.type === "categorical");

    if (numericCols.length >= 2) {
      recommendations.push(
        "Scatter plots could reveal relationships between numeric variables",
      );
    }

    if (categoricalCols.length > 0 && numericCols.length > 0) {
      recommendations.push(
        "Box plots could show distributions across categorical groups",
      );
    }

    if (numericCols.length >= 3) {
      recommendations.push(
        "A correlation heatmap could identify related variables",
      );
    }

    return recommendations;
  }
}

/**
 * Create the data profiling tool
 */
export function createDataProfileTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description:
      "Profile a dataset to understand its structure, types, and quality",
    inputSchema: z.object({
      dataPath: z.string().describe("Path to the data file in the sandbox"),
      fileType: z
        .enum(["csv", "excel", "json"])
        .default("csv")
        .describe("Type of the data file"),
    }),
    execute: async ({ dataPath, fileType }) => {
      const agent = new DataAnalysisAgent(dataStream);
      const code = agent.generateProfileCode(dataPath, fileType);

      return {
        success: true,
        code,
        instruction:
          "Execute this code in the sandbox to get the dataset profile",
      };
    },
  }) as Tool;
}

/**
 * Create the statistical analysis tool
 */
export function createStatsAnalysisTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description:
      "Perform statistical analysis on specific columns of a dataset",
    inputSchema: z.object({
      dataPath: z.string().describe("Path to the data file"),
      columns: z
        .array(z.string())
        .default([])
        .describe("Columns to analyze (empty for all columns)"),
    }),
    execute: async ({ dataPath, columns }) => {
      const agent = new DataAnalysisAgent(dataStream);
      const code = agent.generateStatsCode(dataPath, columns);

      return {
        success: true,
        code,
        instruction:
          "Execute this code in the sandbox to get statistical analysis",
      };
    },
  }) as Tool;
}

/**
 * Create the visualization generation tool
 */
export function createVisualizationTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description: "Generate an interactive Plotly visualization from data",
    inputSchema: z.object({
      dataPath: z.string().describe("Path to the data file"),
      vizType: z
        .enum(["line", "bar", "scatter", "pie", "heatmap", "histogram", "box"])
        .describe("Type of visualization to create"),
      xColumn: z
        .string()
        .describe("Column to use for x-axis or primary dimension"),
      yColumn: z
        .string()
        .optional()
        .describe("Column to use for y-axis (if applicable)"),
      title: z.string().optional().describe("Chart title"),
    }),
    execute: async ({ dataPath, vizType, xColumn, yColumn, title }) => {
      const agent = new DataAnalysisAgent(dataStream);
      const code = agent.generateVisualizationCode(
        dataPath,
        vizType,
        xColumn,
        yColumn,
        title,
      );

      return {
        success: true,
        code,
        vizType,
        instruction:
          "Execute this code in the sandbox to generate the visualization",
      };
    },
  }) as Tool;
}

/**
 * Create all data analysis tools
 */
export function createDataAnalysisTools(
  dataStream?: UIMessageStreamWriter,
): Record<string, Tool> {
  return {
    profileDataset: createDataProfileTool(dataStream),
    analyzeStats: createStatsAnalysisTool(dataStream),
    createVisualization: createVisualizationTool(dataStream),
  };
}
