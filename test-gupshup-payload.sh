#!/bin/bash

WEBHOOK_URL="https://cityhall-complaints-bot-production.up.railway.app/webhook"

curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message",
    "payload": {
      "sender": "972501234567",
      "message": {
        "type": "text",
        "text": "שלום, יש פנס שבור ברחוב יפו"
      },
      "timestamp": "'"$(date +%s000)"'",
      "source": "whatsapp"
    }
  }'
