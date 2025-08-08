# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
1. First think through the problem, read the codebase for relevant files, and write a plan to tasks/todo.md.
2. The plan should have a list of todo items that you can check off as you complete them
3. Before you begin working, check in with me and I will verify the plan.
4. Then, begin working on the todo items, marking them as complete as you go.
5. Please every step of the way just give me a high level explanation of what changes you made
6. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
7. Finally, add a review section to the [todo.md](http://todo.md/) file with a summary of the changes you made and any other relevant information.


## Project Overview

This is a City Hall Complaints Bot that processes incoming WhatsApp messages via Gupshup webhook, analyzes them using AI (OpenRouter API), and logs complaints to Google Sheets. The bot handles both text and image messages in Hebrew, categorizing and prioritizing municipal complaints.

## Development Commands

```bash
# Start the server
npm start

# Test text message webhook
./cityhall-complaints-bot/test-text.sh

# Test image message webhook  
./cityhall-complaints-bot/test-image.sh
```

## Architecture

### Core Components

1. **Webhook Server** (`index.js`): Express server handling Gupshup webhook messages
   - Pairs text messages with subsequent images within 60 seconds
   - Validates and processes both text and image message types
   - Maintains recent message cache for image-text pairing

2. **AI Analysis** (`analyzeMessageWithAI.js`): OpenRouter API integration
   - Analyzes complaints in Hebrew
   - Returns structured JSON with categorization, urgency, department assignment
   - Has fallback response mechanism for API failures

3. **Google Sheets Integration** (`googleSheets.js`): 
   - Authenticates using service account credentials
   - Appends processed complaints to specified sheet
   - Auto-creates credentials file from environment variable if missing

### Message Flow

1. Webhook receives message from Gupshup
2. Text messages are cached for potential pairing with images
3. Images check for recent text messages within 60 seconds for context
4. AI analyzes complaint content and/or image
5. Results are appended to Google Sheet with structured fields

### Required Environment Variables

- `OPENROUTER_API_KEY`: For AI analysis
- `SHEET_ID`: Target Google Sheets ID
- `SERVICE_ACCOUNT_JSON`: Google service account credentials (JSON string)
- `OPENROUTER_MODEL`: Optional, defaults to 'openrouter/auto'
- `PORT`: Optional, defaults to 8080

### Data Structure

Complaints are processed into these fields:
- שם הפונה (complainant name)
- קטגוריה (category)
- רמת דחיפות (urgency level)
- תוכן הפנייה (complaint content)
- תאריך ושעה (date and time)
- טלפון (phone)
- קישור לתמונה (image link)
- סוג הפנייה (complaint type)
- מחלקה אחראית (responsible department)
- source (always 'gupshup')