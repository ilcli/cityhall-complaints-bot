#!/bin/bash

WEBHOOK_URL="https://cityhall-complaints-bot-production.up.railway.app/webhook"

# Load webhook secret from environment or use test secret
WEBHOOK_SECRET=${WEBHOOK_SECRET:-"test-webhook-secret-for-development"}

echo "Testing image with caption..."

# First payload
PAYLOAD1='{
    "type": "message",
    "payload": {
      "id": "test-image-123",
      "source": "972501234567",
      "type": "image",
      "payload": {
        "url": "https://example.com/test-image.jpg",
        "caption": "תמונה של בור ברחוב יפו - דחוף לתיקון"
      },
      "sender": {
        "phone": "972501234567",
        "name": "Test User"
      },
      "timestamp": "'"$(date +%s000)"'"
    }
  }'

# Generate signature and send first request
if [ -n "$WEBHOOK_SECRET" ]; then
  SIGNATURE1=$(echo -n "$PAYLOAD1" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | cut -d' ' -f2)
  curl -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: $SIGNATURE1" \
    -d "$PAYLOAD1"
else
  curl -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD1"
fi

echo -e "\n\nTesting image without caption (should use fallback)..."
sleep 2

# Second payload
PAYLOAD2='{
    "type": "message",
    "payload": {
      "id": "test-image-456",
      "source": "972509876543",
      "type": "image",
      "payload": {
        "url": "https://example.com/test-image2.jpg"
      },
      "sender": {
        "phone": "972509876543",
        "name": "Test User 2"
      },
      "timestamp": "'"$(date +%s000)"'"
    }
  }'

# Generate signature and send second request
if [ -n "$WEBHOOK_SECRET" ]; then
  SIGNATURE2=$(echo -n "$PAYLOAD2" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | cut -d' ' -f2)
  curl -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: $SIGNATURE2" \
    -d "$PAYLOAD2"
else
  curl -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD2"
fi

echo ""