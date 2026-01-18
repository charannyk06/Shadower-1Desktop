-- Migration: 0023_fragments
-- Add tables for fragment-based micro-app and document generation

-- Fragments table - stores generated code and metadata
CREATE TABLE IF NOT EXISTS fragments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Fragment metadata
  template VARCHAR(100) NOT NULL,
  title VARCHAR(100) NOT NULL,
  description TEXT,

  -- Code and execution
  code TEXT NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  port INTEGER,

  -- Sandbox and deployment
  sandbox_id VARCHAR(100),
  preview_url TEXT,
  deployment_url TEXT,

  -- Status
  status VARCHAR(50) DEFAULT 'draft',
  error_message TEXT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fragment executions - history of runs
CREATE TABLE IF NOT EXISTS fragment_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fragment_id UUID NOT NULL REFERENCES fragments(id) ON DELETE CASCADE,
  sandbox_id VARCHAR(100) NOT NULL,
  template VARCHAR(100) NOT NULL,

  -- Results
  stdout TEXT,
  stderr TEXT,
  runtime_error TEXT,
  preview_url TEXT,

  -- Metrics
  execution_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- E2B usage tracking for cost management
CREATE TABLE IF NOT EXISTS e2b_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id VARCHAR(100) NOT NULL,
  template VARCHAR(100),

  -- Usage metrics
  duration_ms INTEGER NOT NULL,
  credits_used TEXT NOT NULL,
  cost_usd TEXT NOT NULL,

  -- Metadata
  operation_type VARCHAR(50), -- 'create', 'edit', 'execute'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fragments_thread ON fragments(thread_id);
CREATE INDEX IF NOT EXISTS idx_fragments_user ON fragments(user_id);
CREATE INDEX IF NOT EXISTS idx_fragments_status ON fragments(status);
CREATE INDEX IF NOT EXISTS idx_fragment_executions_fragment ON fragment_executions(fragment_id);
CREATE INDEX IF NOT EXISTS idx_e2b_usage_user ON e2b_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_e2b_usage_created ON e2b_usage(created_at);

-- Fragment shares for public deployment links
CREATE TABLE IF NOT EXISTS fragment_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fragment_id UUID NOT NULL REFERENCES fragments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Share settings
  share_id VARCHAR(50) NOT NULL UNIQUE,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,

  -- Analytics
  view_count INTEGER DEFAULT 0,
  last_viewed_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fragment_shares_fragment ON fragment_shares(fragment_id);
CREATE INDEX IF NOT EXISTS idx_fragment_shares_share_id ON fragment_shares(share_id);

-- Add persistence tracking to browser_session
ALTER TABLE browser_session
  ADD COLUMN IF NOT EXISTS persistence_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
