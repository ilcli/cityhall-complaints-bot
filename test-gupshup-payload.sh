#!/bin/bash

# Replace with your actual Railway webhook URL
WEBHOOK_URL="https://cityhall-complaints-bot-production.up.railway.app/webhook"

# Optional: Add token if you secure your webhook with a header
TOKEN="your-secret-token"

curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $TOKEN" \
  -d '{
    "type": "message",
    "payload": {
      "sender": "972501234567",
      "message": {
        "type": "text",
        "text": "שלום, יש פנס שבור ברחוב קפלן 3. אשמח שיטופל."
      },
      "timestamp": "'"$(date +%s000)"'",
      "source": "whatsapp"
    }
  }'


