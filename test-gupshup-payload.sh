#!/bin/bash

WEBHOOK_URL="https://cityhall-complaints-bot-production.up.railway.app/webhook"

curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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
        "name": "Test User",
        "country_code": "972",
        "dial_code": "501234567"
      },
      "timestamp": "'"$(date +%s000)"'"
    }
  }'
