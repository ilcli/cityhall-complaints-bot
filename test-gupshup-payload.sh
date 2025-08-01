#!/bin/bash

WEBHOOK_URL="https://cityhall-complaints-bot-production.up.railway.app/webhook"

curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "payload": {
      "payload": "שלום, יש פנס שבור ברחוב יפו",
      "sender": {
        "phone": "972501234567"
      },
      "timestamp": "'"$(date +%s000)"'"
    }
  }'
