# Qdrant Quick Start Guide

Get Qdrant Cloud vector search up and running in 5 minutes!

## Step 1: Get Qdrant Cloud Credentials

1. Go to https://cloud.qdrant.io
2. Sign up or log in
3. Create a new cluster (or use existing)
4. Copy your cluster URL and API key

## Step 2: Configure Environment

Add to your `.env` file:

```bash
QDRANT_URL=https://your-cluster-id.us-east4-0.gcp.cloud.qdrant.io:6333
QDRANT_API_KEY=your_api_key_here
```

## Step 3: Run Setup

```bash
# Option A: CLI Script (easiest)
pnpm qdrant:setup

# Option B: API Endpoint (if server is running)
curl -X POST http://localhost:3000/api/qdrant/setup
```

## Step 4: Run Database Migration

```bash
pnpm db:migrate
```

## Step 5: Test It!

```bash
# Search for messages
curl -X POST http://localhost:3000/api/search/semantic \
  -H "Content-Type: application/json" \
  -d '{
    "query": "your search query",
    "collectionType": "messages",
    "limit": 10
  }'
```

## That's It! 🎉

Your vector search is now ready. Messages will be automatically indexed as they're created.

For more details, see [Qdrant Setup Guide](./qdrant-setup.md).
