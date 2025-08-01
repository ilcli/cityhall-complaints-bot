#!/bin/bash

WEBHOOK_URL="https://cityhall-complaints-bot-production.up.railway.app/webhook"

echo "Testing image with caption..."
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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

echo -e "\n\nTesting image without caption (should use fallback)..."
sleep 2
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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
