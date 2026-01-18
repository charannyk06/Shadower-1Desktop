#!/bin/bash

# Setup Vercel Production Environment Variables for Qdrant
# Run: ./scripts/setup-vercel-env.sh

set -e

echo "🚀 Setting up Qdrant Cloud for Vercel Production..."
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found."
    echo "   Install it with: npm i -g vercel"
    echo "   Or use: pnpm add -g vercel"
    exit 1
fi

# Qdrant credentials
QDRANT_URL="https://6c01be2b-0005-404a-b0ff-eb2cc603fabf.us-east4-0.gcp.cloud.qdrant.io:6333"
QDRANT_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.bWTn2BEuSbGz-VShAwM4lURXm_HgyXdlHyGgUHkAtsE"

echo "📝 Adding QDRANT_URL to Vercel production..."
echo "$QDRANT_URL" | vercel env add QDRANT_URL production 2>&1 | grep -v "Already exists" || echo "   (already exists)"

echo "📝 Adding QDRANT_API_KEY to Vercel production..."
echo "$QDRANT_API_KEY" | vercel env add QDRANT_API_KEY production 2>&1 | grep -v "Already exists" || echo "   (already exists)"

echo ""
echo "✅ Production environment variables configured!"
echo ""
echo "To verify: vercel env ls"
echo ""
echo "Next steps after deployment:"
echo "1. Initialize collections: GET https://your-app.vercel.app/api/qdrant/setup"
echo "2. Run database migration in production"
echo "3. Start indexing content"
