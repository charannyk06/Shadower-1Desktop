import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { RouteErrorBoundary } from "./components/route-error-boundary";

// Loading component for lazy-loaded routes
const RouteLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

// Helper to wrap lazy-loaded routes with error boundary and suspense
const withErrorBoundary =
  (LazyComponent: React.LazyExoticComponent<any>) => () => (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoader />}>
        <LazyComponent />
      </Suspense>
    </RouteErrorBoundary>
  );

// Lazy load layouts
const RootLayout = lazy(() => import("./layouts/RootLayout"));
const ChatLayout = lazy(() => import("./layouts/ChatLayout"));
const AuthLayout = lazy(() => import("./layouts/AuthLayout"));

// Lazy load page components
const HomePage = lazy(() => import("./routes/index"));
const ChatThreadPage = lazy(() => import("./routes/chat.$threadId"));
const AgentsPage = lazy(() => import("./routes/agents"));
const AgentPage = lazy(() => import("./routes/agent.$agentId"));
const WorkflowListPage = lazy(() => import("./routes/workflow"));
const WorkflowEditorPage = lazy(() => import("./routes/workflow.$workflowId"));
const McpPage = lazy(() => import("./routes/mcp"));
const McpCreatePage = lazy(() => import("./routes/mcp.create"));
const McpModifyPage = lazy(() => import("./routes/mcp.$serverId.modify"));
const McpTestPage = lazy(() => import("./routes/mcp.$serverId.test"));
const ModelsPage = lazy(() => import("./routes/models"));
const KnowledgePage = lazy(() => import("./routes/knowledge"));
const ArchivePage = lazy(() => import("./routes/archive.$archiveId"));
const SignInPage = lazy(() => import("./routes/auth.sign-in"));
const SignUpPage = lazy(() => import("./routes/auth.sign-up"));
const SignUpEmailPage = lazy(() => import("./routes/auth.sign-up.email"));
const SetupPage = lazy(() => import("./routes/setup"));
const ExportPage = lazy(() => import("./routes/export.$exportId"));
const SharePage = lazy(() => import("./routes/share.$shareId"));

// Root route
const rootRoute = createRootRoute({
  component: () => (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoader />}>
        <RootLayout>
          <Outlet />
        </RootLayout>
      </Suspense>
    </RouteErrorBoundary>
  ),
});

// Auth layout route (no sidebar)
const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth-layout",
  component: () => (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoader />}>
        <AuthLayout>
          <Outlet />
        </AuthLayout>
      </Suspense>
    </RouteErrorBoundary>
  ),
});

// Chat layout route (with sidebar, requires auth)
const chatLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "chat-layout",
  component: () => (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoader />}>
        <ChatLayout>
          <Outlet />
        </ChatLayout>
      </Suspense>
    </RouteErrorBoundary>
  ),
});

// ==================== AUTH ROUTES ====================

const signInRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sign-in",
  component: withErrorBoundary(SignInPage),
});

const signUpRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sign-up",
  component: withErrorBoundary(SignUpPage),
});

const signUpEmailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sign-up/email",
  component: withErrorBoundary(SignUpEmailPage),
});

// ==================== CHAT ROUTES (Protected) ====================

const homeRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/",
  component: withErrorBoundary(HomePage),
});

const chatThreadRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/chat/$threadId",
  component: withErrorBoundary(ChatThreadPage),
});

const agentsRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/agents",
  component: withErrorBoundary(AgentsPage),
});

const agentRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/agent/$agentId",
  component: withErrorBoundary(AgentPage),
});

const workflowListRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/workflow",
  component: withErrorBoundary(WorkflowListPage),
});

const workflowEditorRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/workflow/$workflowId",
  component: withErrorBoundary(WorkflowEditorPage),
});

const mcpRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/mcp",
  component: withErrorBoundary(McpPage),
});

const mcpCreateRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/mcp/create",
  component: withErrorBoundary(McpCreatePage),
});

const mcpModifyRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/mcp/$serverId/modify",
  component: withErrorBoundary(McpModifyPage),
});

const mcpTestRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/mcp/$serverId/test",
  component: withErrorBoundary(McpTestPage),
});

const modelsRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/models",
  component: withErrorBoundary(ModelsPage),
});

const knowledgeRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/knowledge",
  component: withErrorBoundary(KnowledgePage),
});

const archiveRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: "/archive/$archiveId",
  component: withErrorBoundary(ArchivePage),
});

// ==================== PUBLIC ROUTES ====================

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: withErrorBoundary(SetupPage),
});

const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/export/$exportId",
  component: withErrorBoundary(ExportPage),
});

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/f/$shareId",
  component: withErrorBoundary(SharePage),
});

// ==================== BUILD ROUTE TREE ====================

const routeTree = rootRoute.addChildren([
  // Auth routes
  authLayoutRoute.addChildren([signInRoute, signUpRoute, signUpEmailRoute]),

  // Chat routes (protected)
  chatLayoutRoute.addChildren([
    homeRoute,
    chatThreadRoute,
    agentsRoute,
    agentRoute,
    workflowListRoute,
    workflowEditorRoute,
    mcpRoute,
    mcpCreateRoute,
    mcpModifyRoute,
    mcpTestRoute,
    modelsRoute,
    knowledgeRoute,
    archiveRoute,
  ]),

  // Public routes
  setupRoute,
  exportRoute,
  shareRoute,
]);

// Create router instance
export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
