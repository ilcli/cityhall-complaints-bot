#!/bin/bash

WEBHOOK_URL="https://cityhall-complaints-bot-production.up.railway.app/webhook"

# Load webhook secret from environment or use test secret
WEBHOOK_SECRET=${WEBHOOK_SECRET:-"test-webhook-secret-for-development"}

# Prepare the payload
PAYLOAD='{
    "type": "message",
    "payload": {
      "id": "test-message-123",
      "source": "972501234567",
      "type": "text",
      "payload": {
        "text": "שלום, יש פנס שבור ברחוב יפו"
      },
      "sender": {
        "phone": "972501234567",
        "name": "Test User"
      },
      "timestamp": "'"$(date +%s000)"'"
    }
  }'

# Generate HMAC-SHA256 signature if webhook secret is set
if [ -n "$WEBHOOK_SECRET" ]; then
  SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | cut -d' ' -f2)
  echo "Generated signature: $SIGNATURE"
  
  curl -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: $SIGNATURE" \
    -d "$PAYLOAD"
else
  echo "Warning: No WEBHOOK_SECRET set, sending without signature"
  curl -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD"
fi

echo ""
