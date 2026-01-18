#!/bin/bash

# Production Qdrant Setup Script
# Sets up Qdrant environment variables for production (Vercel)

set -e

echo "🚀 Setting up Qdrant Cloud for Production..."

# Qdrant credentials
QDRANT_URL="https://6c01be2b-0005-404a-b0ff-eb2cc603fabf.us-east4-0.gcp.cloud.qdrant.io:6333"
QDRANT_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.bWTn2BEuSbGz-VShAwM4lURXm_HgyXdlHyGgUHkAtsE"

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Install it with: npm i -g vercel"
    exit 1
fi

echo "📝 Setting Vercel environment variables..."

# Set environment variables in Vercel
vercel env add QDRANT_URL production <<< "$QDRANT_URL" || echo "QDRANT_URL might already exist"
vercel env add QDRANT_API_KEY production <<< "$QDRANT_API_KEY" || echo "QDRANT_API_KEY might already exist"

echo ""
echo "✅ Production environment variables set!"
echo ""
echo "Next steps:"
echo "1. Deploy to production: vercel --prod"
echo "2. Initialize collections: GET https://your-app.vercel.app/api/qdrant/setup"
echo "3. Run database migration in production"
echo ""
echo "To verify: vercel env ls"
