# Executive Desktop Agent

An AI-powered desktop application that provides three specialized agent personas to assist with business tasks:

- **CEO Agent** - Strategic planning, vision, and high-level decision support
- **Operations Manager** - Process optimization, workflow management, and operational efficiency
- **Finance Manager** - Financial planning, budgeting, analysis, and reporting

Built with Electron and powered by Claude AI (Anthropic).

## Features

- 🤖 **Three Specialized AI Agents** - Each with domain-specific expertise
- 💬 **Conversational Interface** - Natural language interaction with context retention
- 🎨 **Modern UI** - Clean, professional dark theme interface
- 🔒 **Secure** - Local API key storage, secure IPC communication
- ⚡ **Fast** - Instant agent switching with conversation history
- 🖥️ **Cross-Platform** - Works on Windows, macOS, and Linux

## Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Anthropic API Key** - Get one at [console.anthropic.com](https://console.anthropic.com/)

## Installation

1. **Navigate to the project directory:**
   ```bash
   cd desktop-agent
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up your Anthropic API key:**

   Create a `.env` file in the project root or set the environment variable:

   **On macOS/Linux:**
   ```bash
   export ANTHROPIC_API_KEY='your-api-key-here'
   ```

   **On Windows (Command Prompt):**
   ```cmd
   set ANTHROPIC_API_KEY=your-api-key-here
   ```

   **On Windows (PowerShell):**
   ```powershell
   $env:ANTHROPIC_API_KEY='your-api-key-here'
   ```

   Alternatively, create a `.env` file:
   ```
   ANTHROPIC_API_KEY=your-api-key-here
   ```

## Usage

### Development Mode

Run the application in development mode with DevTools:

```bash
npm run dev
```

### Production Mode

Run the application normally:

```bash
npm start
```

### Building Executables

Build platform-specific executables:

```bash
npm run build
```

This will create installers in the `dist/` directory for your platform:
- **macOS**: `.dmg` file
- **Windows**: `.exe` installer
- **Linux**: `.AppImage` file

## How to Use

1. **Launch the application**
2. **Select an agent** from the sidebar (CEO, Operations, or Finance)
3. **Type your question or task** in the input box at the bottom
4. **Press Enter** to send (or Shift+Enter for new line)
5. **Switch agents** anytime to get different perspectives

### Example Tasks

**CEO Agent:**
- "Help me create a 5-year strategic plan for expanding into new markets"
- "Analyze the competitive landscape in the fintech industry"
- "What should I prioritize this quarter to maximize growth?"

**Operations Manager:**
- "How can I optimize our customer onboarding process?"
- "Create a project plan for implementing a new CRM system"
- "What metrics should I track for operational efficiency?"

**Finance Manager:**
- "Create a monthly budget template for a startup"
- "Analyze the ROI of investing in marketing automation"
- "What financial KPIs should I monitor for a SaaS business?"

## Project Structure

```
desktop-agent/
├── src/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Secure IPC bridge
│   ├── index.html       # Main UI structure
│   ├── styles.css       # UI styling
│   └── renderer.js      # Frontend logic & API calls
├── package.json         # Dependencies & scripts
└── README.md           # This file
```

## API Key Security

- Your API key is stored as an environment variable
- It never leaves your local machine
- The app uses secure IPC communication between processes
- No data is stored or transmitted except to Anthropic's API

## Troubleshooting

### "Claude API not initialized"

Make sure your `ANTHROPIC_API_KEY` environment variable is set correctly. Restart the application after setting it.

### "Connection Error"

Check your internet connection and verify your API key is valid.

### Application won't start

1. Delete `node_modules/` folder
2. Run `npm install` again
3. Try `npm start`

## Customization

### Modifying Agent Personas

Edit the system prompts in `src/main.js` in the `systemPrompts` object to customize agent behavior.

### Changing the UI Theme

Modify `src/styles.css` to customize colors, fonts, and layout.

### Adding New Agents

1. Add a new button in `src/index.html`
2. Add agent info in `src/renderer.js` (agentInfo object)
3. Add system prompt in `src/main.js` (systemPrompts object)

## Technology Stack

- **Electron** - Desktop application framework
- **Claude AI** (Anthropic) - AI language model
- **Vanilla JavaScript** - No framework overhead, fast and simple
- **CSS3** - Modern styling with animations

## License

MIT

## Support

For issues, questions, or contributions, please open an issue on the project repository.

## Credits

Built with ❤️ using Claude AI and Electron.
