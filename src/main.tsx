import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import {
  ThemeProvider,
  ThemeStyleProvider,
} from "@/components/layouts/theme-provider";
import { Toaster } from "ui/sonner";
import { UpdateNotification } from "@/components/update-notification";

// Import global styles
import "./app/globals.css";
import "katex/dist/katex.min.css";

// Create root element
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

// Render app
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      themes={["light", "dark"]}
      storageKey="app-theme-v2"
      disableTransitionOnChange
    >
      <ThemeStyleProvider>
        <RouterProvider router={router} />
        <Toaster richColors />
        <UpdateNotification />
      </ThemeStyleProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
