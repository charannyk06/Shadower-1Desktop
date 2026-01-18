#!/bin/bash

# Script to update Stripe environment variables from TEST to LIVE mode in Vercel
# This script helps migrate production from test mode to live mode
#
# Security: Uses proper input validation and prevents shell injection
# Usage: ./scripts/update-stripe-live-keys.sh

set -euo pipefail  # Exit on error, undefined vars, and pipe failures
IFS=$'\n\t'        # Internal Field Separator for safer word splitting

echo "🔍 Stripe Payment Configuration Review & Update Script"
echo "========================================================"
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI is not installed. Please install it first:"
    echo "   npm i -g vercel"
    exit 1
fi

echo "📋 Current Production Environment Variables:"
echo "---------------------------------------------"
vercel env ls --environment=production | grep STRIPE || echo "No Stripe vars found"

echo ""
echo "⚠️  ISSUE DETECTED:"
echo "   Production environment is using TEST mode keys!"
echo "   - STRIPE_SECRET_KEY should start with 'sk_live_' not 'sk_test_'"
echo "   - STRIPE_PUBLISHABLE_KEY should start with 'pk_live_' not 'pk_test_'"
echo "   - STRIPE_WEBHOOK_SECRET should be from LIVE webhook endpoint"
echo "   - Price IDs should be from LIVE mode products"
echo ""

echo "📝 Required Environment Variables for LIVE Mode:"
echo "-------------------------------------------------"
echo "1. STRIPE_SECRET_KEY (sk_live_...)"
echo "   Get from: https://dashboard.stripe.com/apikeys"
echo ""
echo "2. STRIPE_PUBLISHABLE_KEY (pk_live_...)"
echo "   Get from: https://dashboard.stripe.com/apikeys"
echo ""
echo "3. STRIPE_WEBHOOK_SECRET (whsec_...)"
echo "   Get from: https://dashboard.stripe.com/webhooks"
echo "   Create webhook endpoint pointing to: https://your-domain.com/api/billing/webhook"
echo ""
echo "4. STRIPE_PRICE_PRO_MONTHLY (price_...)"
echo "   Create in LIVE mode using: STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/setup-billing.ts"
echo ""
echo "5. STRIPE_PRICE_PRO_ANNUAL (price_...)"
echo "   Create in LIVE mode using Stripe Dashboard or API"
echo ""
echo "6. STRIPE_PRICE_ULTRA_MONTHLY (price_...)"
echo "   Create in LIVE mode using: STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/setup-billing.ts"
echo ""
echo "7. STRIPE_PRICE_ULTRA_ANNUAL (price_...)"
echo "   Create in LIVE mode using Stripe Dashboard or API"
echo ""

read -p "Do you have your LIVE Stripe keys ready? (y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Please get your LIVE keys from Stripe Dashboard first:"
    echo "  - Secret key: https://dashboard.stripe.com/apikeys"
    echo "  - Publishable key: https://dashboard.stripe.com/apikeys"
    echo "  - Webhook secret: https://dashboard.stripe.com/webhooks"
    echo ""
    echo "Then run this script again."
    exit 0
fi

echo ""
echo "🔧 Updating Environment Variables..."
echo "===================================="
echo ""

# Function to update an env var (without trailing newline)
# Validates input to prevent shell injection
update_env_var() {
    local var_name=$1
    local var_value=$2
    
    # Validate variable name format (alphanumeric and underscores only)
    if [[ ! "$var_name" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
        echo "❌ Error: Invalid variable name format: $var_name" >&2
        return 1
    fi
    
    echo "Updating $var_name..."
    # Use printf instead of echo -n for better portability and security
    # Pipe directly to vercel CLI to avoid shell interpretation
    if printf '%s' "$var_value" | vercel env add "$var_name" production --force >/dev/null 2>&1; then
        echo "✅ Updated $var_name"
        return 0
    else
        echo "❌ Failed to update $var_name"
        return 1
    fi
}

# Prompt for each required variable with validation
# Constants for error messages
readonly ERROR_PRICE_ID_PREFIX="❌ Error: Price ID must start with 'price_'"
readonly ERROR_UPDATE_FAILED="❌ Failed to update"

read -p "Enter STRIPE_SECRET_KEY (sk_live_...): " STRIPE_SECRET_KEY
if [[ -z "${STRIPE_SECRET_KEY:-}" ]] || [[ ! "$STRIPE_SECRET_KEY" =~ ^sk_live_ ]]; then
    echo "❌ Error: Secret key must start with 'sk_live_'" >&2
    exit 1
fi
if ! update_env_var "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY"; then
    echo "${ERROR_UPDATE_FAILED} STRIPE_SECRET_KEY. Aborting." >&2
    exit 1
fi

read -p "Enter STRIPE_PUBLISHABLE_KEY (pk_live_...): " STRIPE_PUBLISHABLE_KEY
if [[ -z "${STRIPE_PUBLISHABLE_KEY:-}" ]] || [[ ! "$STRIPE_PUBLISHABLE_KEY" =~ ^pk_live_ ]]; then
    echo "❌ Error: Publishable key must start with 'pk_live_'" >&2
    exit 1
fi
if ! update_env_var "STRIPE_PUBLISHABLE_KEY" "$STRIPE_PUBLISHABLE_KEY"; then
    echo "${ERROR_UPDATE_FAILED} STRIPE_PUBLISHABLE_KEY. Aborting." >&2
    exit 1
fi

read -p "Enter STRIPE_WEBHOOK_SECRET (whsec_...): " STRIPE_WEBHOOK_SECRET
if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]] || [[ ! "$STRIPE_WEBHOOK_SECRET" =~ ^whsec_ ]]; then
    echo "❌ Error: Webhook secret must start with 'whsec_'" >&2
    exit 1
fi
if ! update_env_var "STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_SECRET"; then
    echo "${ERROR_UPDATE_FAILED} STRIPE_WEBHOOK_SECRET. Aborting." >&2
    exit 1
fi

read -p "Enter STRIPE_PRICE_PRO_MONTHLY (price_...): " STRIPE_PRICE_PRO_MONTHLY
if [[ -z "${STRIPE_PRICE_PRO_MONTHLY:-}" ]] || [[ ! "$STRIPE_PRICE_PRO_MONTHLY" =~ ^price_ ]]; then
    echo "${ERROR_PRICE_ID_PREFIX}" >&2
    exit 1
fi
if ! update_env_var "STRIPE_PRICE_PRO_MONTHLY" "$STRIPE_PRICE_PRO_MONTHLY"; then
    echo "${ERROR_UPDATE_FAILED} STRIPE_PRICE_PRO_MONTHLY. Aborting." >&2
    exit 1
fi

read -p "Enter STRIPE_PRICE_PRO_ANNUAL (price_...): " STRIPE_PRICE_PRO_ANNUAL
if [[ -z "${STRIPE_PRICE_PRO_ANNUAL:-}" ]] || [[ ! "$STRIPE_PRICE_PRO_ANNUAL" =~ ^price_ ]]; then
    echo "${ERROR_PRICE_ID_PREFIX}" >&2
    exit 1
fi
if ! update_env_var "STRIPE_PRICE_PRO_ANNUAL" "$STRIPE_PRICE_PRO_ANNUAL"; then
    echo "${ERROR_UPDATE_FAILED} STRIPE_PRICE_PRO_ANNUAL. Aborting." >&2
    exit 1
fi

read -p "Enter STRIPE_PRICE_ULTRA_MONTHLY (price_...): " STRIPE_PRICE_ULTRA_MONTHLY
if [[ -z "${STRIPE_PRICE_ULTRA_MONTHLY:-}" ]] || [[ ! "$STRIPE_PRICE_ULTRA_MONTHLY" =~ ^price_ ]]; then
    echo "${ERROR_PRICE_ID_PREFIX}" >&2
    exit 1
fi
if ! update_env_var "STRIPE_PRICE_ULTRA_MONTHLY" "$STRIPE_PRICE_ULTRA_MONTHLY"; then
    echo "${ERROR_UPDATE_FAILED} STRIPE_PRICE_ULTRA_MONTHLY. Aborting." >&2
    exit 1
fi

read -p "Enter STRIPE_PRICE_ULTRA_ANNUAL (price_...): " STRIPE_PRICE_ULTRA_ANNUAL
if [[ -z "${STRIPE_PRICE_ULTRA_ANNUAL:-}" ]] || [[ ! "$STRIPE_PRICE_ULTRA_ANNUAL" =~ ^price_ ]]; then
    echo "${ERROR_PRICE_ID_PREFIX}" >&2
    exit 1
fi
if ! update_env_var "STRIPE_PRICE_ULTRA_ANNUAL" "$STRIPE_PRICE_ULTRA_ANNUAL"; then
    echo "${ERROR_UPDATE_FAILED} STRIPE_PRICE_ULTRA_ANNUAL. Aborting." >&2
    exit 1
fi

echo ""
echo "✅ All environment variables updated!"
echo ""
echo "📌 NEXT STEPS:"
echo "1. Verify the updates: vercel env ls --environment=production | grep STRIPE"
echo "2. Redeploy your production environment to apply changes"
echo "3. Test a checkout flow to ensure LIVE mode is working"
echo "4. Monitor Stripe Dashboard for LIVE mode transactions"
echo ""
echo "🎉 Done!"
