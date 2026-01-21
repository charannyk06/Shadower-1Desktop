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

# Qdrant credentials - MUST be set via environment variables
# DO NOT hardcode credentials in this file!
if [ -z "$QDRANT_URL" ]; then
    echo "❌ Error: QDRANT_URL environment variable is not set"
    echo "   Please set QDRANT_URL before running this script"
    exit 1
fi

if [ -z "$QDRANT_API_KEY" ]; then
    echo "❌ Error: QDRANT_API_KEY environment variable is not set"
    echo "   Please set QDRANT_API_KEY before running this script"
    exit 1
fi

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
