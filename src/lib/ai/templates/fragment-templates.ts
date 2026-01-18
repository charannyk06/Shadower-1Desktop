import type {
  FragmentTemplateId,
  FragmentTemplateType,
} from "@/types/fragment";

/**
 * Fragment Templates Registry
 * Defines all available E2B sandbox templates for autonomous generation
 */

export interface FragmentTemplate {
  id: FragmentTemplateId;
  name: string;
  lib: string[];
  file_path: string;
  port: number | null;
  type: FragmentTemplateType;
  useCase: string;
  getInstallCommand: (deps: string[]) => string;
}

export const FRAGMENT_TEMPLATES: Record<FragmentTemplateId, FragmentTemplate> =
  {
    "code-interpreter-v1": {
      id: "code-interpreter-v1",
      name: "Python Code Interpreter",
      lib: [
        "python",
        "numpy",
        "pandas",
        "matplotlib",
        "seaborn",
        "plotly",
        "openpyxl",
        "python-pptx",
        "python-docx",
        "reportlab",
        "Pillow",
        "WeasyPrint",
      ],
      file_path: "script.py",
      port: null,
      type: "code-interpreter",
      useCase:
        "Data analysis, visualization, Word/Excel/PPT generation, charts",
      getInstallCommand: (deps) => `pip install ${deps.join(" ")}`,
    },

    "nextjs-developer": {
      id: "nextjs-developer",
      name: "Next.js Full-Stack App",
      lib: [
        "next@14.2.5",
        "react@18",
        "react-dom@18",
        "typescript",
        "tailwindcss@3",
        "@shadcn/ui",
        "lucide-react",
      ],
      file_path: "pages/index.tsx",
      port: 3000,
      type: "web-app",
      useCase:
        "Full-stack web apps, dashboards, admin panels, e-commerce, landing pages",
      getInstallCommand: (deps) => `npm install ${deps.join(" ")}`,
    },

    "vue-developer": {
      id: "vue-developer",
      name: "Vue.js SPA",
      lib: [
        "vue@3",
        "nuxt@3.13.0",
        "tailwindcss@3",
        "@nuxtjs/tailwindcss",
        "@pinia/nuxt",
      ],
      file_path: "app/app.vue",
      port: 3000,
      type: "web-app",
      useCase:
        "Interactive UIs, SPAs, component libraries, progressive web apps",
      getInstallCommand: (deps) => `npm install ${deps.join(" ")}`,
    },

    "streamlit-developer": {
      id: "streamlit-developer",
      name: "Streamlit Data Dashboard",
      lib: [
        "streamlit",
        "pandas",
        "numpy",
        "plotly",
        "altair",
        "matplotlib",
        "seaborn",
        "scipy",
      ],
      file_path: "app.py",
      port: 8501,
      type: "web-app",
      useCase: "Data dashboards, analytics apps, internal tools, ML demos",
      getInstallCommand: (deps) => `pip install ${deps.join(" ")}`,
    },

    "gradio-developer": {
      id: "gradio-developer",
      name: "Gradio ML Interface",
      lib: [
        "gradio",
        "pandas",
        "numpy",
        "matplotlib",
        "transformers",
        "torch",
        "scikit-learn",
      ],
      file_path: "app.py",
      port: 7860,
      type: "web-app",
      useCase:
        "ML model interfaces, AI demos, prototypes, computer vision apps",
      getInstallCommand: (deps) => `pip install ${deps.join(" ")}`,
    },
  };

/**
 * Get template by ID
 */
export function getTemplate(templateId: FragmentTemplateId): FragmentTemplate {
  return FRAGMENT_TEMPLATES[templateId];
}

/**
 * Get all template IDs
 */
export function getAllTemplateIds(): FragmentTemplateId[] {
  return Object.keys(FRAGMENT_TEMPLATES) as FragmentTemplateId[];
}

/**
 * Get templates by type
 */
export function getTemplatesByType(
  type: FragmentTemplateType,
): FragmentTemplate[] {
  return Object.values(FRAGMENT_TEMPLATES).filter((t) => t.type === type);
}
