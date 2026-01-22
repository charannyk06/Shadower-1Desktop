
// Vite environment types for import.meta.env
interface ImportMetaEnv {
  // Desktop config
  readonly DESKTOP_SESSION_MAX_DURATION_MS?: string;
  readonly DESKTOP_SESSION_IDLE_TIMEOUT_MS?: string;
  readonly DESKTOP_MAX_CONCURRENT_SESSIONS?: string;
  readonly DESKTOP_CLEANUP_INTERVAL_MS?: string;
  readonly DESKTOP_MAX_SCREENSHOTS_PER_SESSION?: string;
  readonly DESKTOP_SCREENSHOT_FORMAT?: string;
  readonly DESKTOP_SCREENSHOT_QUALITY?: string;
  readonly DESKTOP_SCREENSHOT_THUMBNAIL_WIDTH?: string;
  readonly DESKTOP_SCREENSHOT_RETENTION_MS?: string;
  readonly DESKTOP_STREAMING_FPS?: string;
  readonly DESKTOP_MAX_STREAMING_CONNECTIONS?: string;
  readonly DESKTOP_STREAMING_HEARTBEAT_MS?: string;
  readonly DESKTOP_STREAMING_TIMEOUT_MS?: string;
  readonly DESKTOP_STREAMING_POLL_INTERVAL_MS?: string;
  readonly DESKTOP_RATE_LIMIT_WINDOW_MS?: string;
  readonly DESKTOP_RATE_LIMIT_SESSION_CREATIONS?: string;
  readonly DESKTOP_RATE_LIMIT_SCREENSHOTS?: string;
  readonly DESKTOP_RATE_LIMIT_ACTIONS?: string;
  readonly DESKTOP_SHELL?: string;
  readonly DESKTOP_WORKING_DIR?: string;
  readonly DESKTOP_COMMAND_TIMEOUT_MS?: string;
  readonly DESKTOP_ACTION_TIMEOUT_MS?: string;
  readonly DESKTOP_WORKSPACE_DIR?: string;
  readonly DESKTOP_WORKSPACE_PERSISTENCE?: string;
  readonly DESKTOP_WORKSPACE_MAX_FILE_SIZE?: string;
  readonly DESKTOP_WORKSPACE_LANGUAGES?: string;
  readonly DESKTOP_CLICK_DELAY_MS?: string;
  readonly DESKTOP_TYPE_DELAY_MS?: string;
  readonly DESKTOP_DOUBLE_CLICK_INTERVAL_MS?: string;
  readonly DESKTOP_DRAG_STEPS?: string;
  readonly DESKTOP_SCROLL_AMOUNT?: string;
  readonly DESKTOP_VERBOSE_LOGGING?: string;
  readonly DESKTOP_LOG_INPUTS?: string;
  readonly DESKTOP_LOG_PERFORMANCE?: string;
  readonly DESKTOP_LOG_LIFECYCLE?: string;

  // Browser config
  readonly BROWSER_SESSION_MAX_DURATION_MS?: string;
  readonly BROWSER_SESSION_IDLE_TIMEOUT_MS?: string;
  readonly BROWSER_MAX_CONCURRENT_SESSIONS?: string;
  readonly BROWSER_CLEANUP_INTERVAL_MS?: string;
  readonly BROWSER_MAX_SCREENSHOTS_PER_SESSION?: string;
  readonly BROWSER_SCREENSHOT_FORMAT?: string;
  readonly BROWSER_SCREENSHOT_QUALITY?: string;
  readonly BROWSER_SCREENSHOT_THUMBNAIL_WIDTH?: string;
  readonly BROWSER_SCREENSHOT_RETENTION_MS?: string;
  readonly BROWSER_STREAMING_FPS?: string;
  readonly BROWSER_MAX_STREAMING_CONNECTIONS?: string;
  readonly BROWSER_STREAMING_HEARTBEAT_MS?: string;
  readonly BROWSER_STREAMING_TIMEOUT_MS?: string;
  readonly BROWSER_STREAMING_POLL_INTERVAL_MS?: string;
  readonly BROWSER_RATE_LIMIT_WINDOW_MS?: string;
  readonly BROWSER_RATE_LIMIT_SESSION_CREATIONS?: string;
  readonly BROWSER_RATE_LIMIT_SCREENSHOTS?: string;
  readonly BROWSER_RATE_LIMIT_ACTIONS?: string;
  readonly BROWSER_CDP_PORT?: string;
  readonly BROWSER_EXECUTABLE_PATH?: string;
  readonly BROWSER_HEADLESS?: string;
  readonly BROWSER_NAVIGATION_TIMEOUT_MS?: string;
  readonly BROWSER_ACTION_TIMEOUT_MS?: string;
  readonly BROWSER_VIEWPORT_WIDTH?: string;
  readonly BROWSER_VIEWPORT_HEIGHT?: string;
  readonly BROWSER_VERBOSE_LOGGING?: string;
  readonly BROWSER_LOG_INPUTS?: string;
  readonly BROWSER_LOG_PERFORMANCE?: string;
  readonly BROWSER_LOG_LIFECYCLE?: string;

  // General environment
  readonly NODE_ENV?: string;
  readonly VITE_APP_VERSION?: string;
  [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type Mutate<T> = Partial<T> | ((prev: T) => Partial<T>);

type Override<T, R> = Omit<T, keyof R> & R;

type ValueOf<T> = T[keyof T];

type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};




