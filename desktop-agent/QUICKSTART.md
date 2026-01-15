# Quick Start Guide

Get up and running with Executive Desktop Agent in 5 minutes!

## Step 1: Install Dependencies

```bash
cd desktop-agent
npm install
```

## Step 2: Set Your API Key

Get your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/)

Then set it as an environment variable:

**macOS/Linux:**
```bash
export ANTHROPIC_API_KEY='sk-ant-xxxxx'
npm start
```

**Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY='sk-ant-xxxxx'
npm start
```

**Or create a .env file:**
```bash
echo "ANTHROPIC_API_KEY=sk-ant-xxxxx" > .env
npm start
```

## Step 3: Launch the App

```bash
npm start
```

That's it! The app will open and you can start chatting with your AI agents.

## Quick Tips

- **Switch agents** using the sidebar buttons
- **Enter** to send, **Shift+Enter** for new lines
- Each agent has specialized knowledge for their domain
- Conversation history is maintained per agent

## Try These Examples

**Ask the CEO Agent:**
> "Help me prioritize initiatives for next quarter"

**Ask the Operations Manager:**
> "How can I improve our project delivery process?"

**Ask the Finance Manager:**
> "Create a cash flow forecast template"

Enjoy your new AI-powered executive team! 🚀
