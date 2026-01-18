#!/bin/bash
#
# Quick Stripe Test Mode Setup
# Run: ./scripts/setup-test-billing.sh sk_test_xxx
#

set -e

TEST_KEY="$1"

if [[ -z "$TEST_KEY" ]]; then
    echo ""
    echo "🚀 Stripe Test Mode Setup"
    echo "========================="
    echo ""
    echo "Usage: ./scripts/setup-test-billing.sh sk_test_xxx"
    echo ""
    echo "📋 Get your TEST secret key from:"
    echo "   https://dashboard.stripe.com/test/apikeys"
    echo ""
    echo "Then run this script with your test key."
    exit 1
fi

if [[ ! "$TEST_KEY" =~ ^sk_test_ ]]; then
    echo "❌ Error: Key must start with sk_test_"
    echo "   You provided a key starting with: ${TEST_KEY:0:10}..."
    exit 1
fi

echo ""
echo "🚀 Setting up Stripe TEST mode..."
echo ""

# Create Pro product
echo "Creating Pro product..."
PRO_PRODUCT=$(stripe products create \
    --api-key="$TEST_KEY" \
    --name="Pro" \
    --description="Pro subscription tier - 2M tokens/month" \
    --metadata[tier]=pro \
    2>&1 | grep '"id":' | head -1 | sed 's/.*"id": "\([^"]*\)".*/\1/')

if [[ -z "$PRO_PRODUCT" ]]; then
    # Product might already exist, try to get it
    PRO_PRODUCT=$(stripe products list --api-key="$TEST_KEY" --limit=100 2>&1 | grep -A1 '"name": "Pro"' | grep '"id":' | sed 's/.*"id": "\([^"]*\)".*/\1/')
fi
echo "   ✓ Pro product: $PRO_PRODUCT"

# Create Ultra product
echo "Creating Ultra product..."
ULTRA_PRODUCT=$(stripe products create \
    --api-key="$TEST_KEY" \
    --name="Ultra" \
    --description="Ultra subscription tier - 10M tokens/month" \
    --metadata[tier]=ultra \
    2>&1 | grep '"id":' | head -1 | sed 's/.*"id": "\([^"]*\)".*/\1/')

if [[ -z "$ULTRA_PRODUCT" ]]; then
    ULTRA_PRODUCT=$(stripe products list --api-key="$TEST_KEY" --limit=100 2>&1 | grep -A1 '"name": "Ultra"' | grep '"id":' | sed 's/.*"id": "\([^"]*\)".*/\1/')
fi
echo "   ✓ Ultra product: $ULTRA_PRODUCT"

# Create Pro price ($19.99/month)
echo "Creating Pro price..."
PRO_PRICE=$(stripe prices create \
    --api-key="$TEST_KEY" \
    --product="$PRO_PRODUCT" \
    --unit-amount=1999 \
    --currency=usd \
    --recurring[interval]=month \
    --metadata[tier]=pro \
    2>&1 | grep '"id":' | head -1 | sed 's/.*"id": "\([^"]*\)".*/\1/')
echo "   ✓ Pro price: $PRO_PRICE ($19.99/month)"

# Create Ultra price ($49.99/month)
echo "Creating Ultra price..."
ULTRA_PRICE=$(stripe prices create \
    --api-key="$TEST_KEY" \
    --product="$ULTRA_PRODUCT" \
    --unit-amount=4999 \
    --currency=usd \
    --recurring[interval]=month \
    --metadata[tier]=ultra \
    2>&1 | grep '"id":' | head -1 | sed 's/.*"id": "\([^"]*\)".*/\1/')
echo "   ✓ Ultra price: $ULTRA_PRICE ($49.99/month)"

echo ""
echo "============================================================"
echo "✅ TEST MODE SETUP COMPLETE!"
echo "============================================================"
echo ""
echo "📝 Updating .env with test configuration..."

# Update .env file
ENV_FILE=".env"
if [[ -f "$ENV_FILE" ]]; then
    # Update STRIPE_SECRET_KEY
    sed -i '' "s|^STRIPE_SECRET_KEY=.*|STRIPE_SECRET_KEY=$TEST_KEY|" "$ENV_FILE"
    
    # Update price IDs
    sed -i '' "s|^STRIPE_PRICE_PRO_MONTHLY=.*|STRIPE_PRICE_PRO_MONTHLY=$PRO_PRICE|" "$ENV_FILE"
    sed -i '' "s|^STRIPE_PRICE_ULTRA_MONTHLY=.*|STRIPE_PRICE_ULTRA_MONTHLY=$ULTRA_PRICE|" "$ENV_FILE"
    
    echo "   ✓ Updated .env file"
else
    echo "   ❌ .env file not found!"
fi

echo ""
echo "============================================================"
echo "📌 NEXT STEPS:"
echo "============================================================"
echo ""
echo "1. Restart your dev server:"
echo "   pnpm dev"
echo ""
echo "2. For webhook testing, run in a new terminal:"
echo "   stripe listen --api-key=$TEST_KEY --forward-to localhost:3000/api/billing/webhook"
echo ""
echo "3. Test checkout with card: 4242 4242 4242 4242"
echo "   Any future date, any 3-digit CVC"
echo ""
echo "🎉 Done! Your local dev is now in TEST mode."
echo ""
