#!/bin/bash

echo "🚀 Site Inspection App - Setup Script"
echo "====================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "❌ Node.js is not installed"
    echo "📦 Installing Node.js and npm..."

    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt update
        sudo apt install nodejs npm -y
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            brew install node
        else
            echo "Please install Homebrew first: https://brew.sh"
            exit 1
        fi
    else
        echo "Please install Node.js manually from https://nodejs.org/"
        exit 1
    fi
else
    echo "✅ Node.js is already installed: $(node --version)"
fi

# Check npm
if ! command -v npm &> /dev/null
then
    echo "❌ npm is not installed"
    exit 1
else
    echo "✅ npm is already installed: $(npm --version)"
fi

echo ""
echo "📦 Installing project dependencies..."
npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Connect your Android phone via USB"
echo "2. Enable USB Debugging on your phone"
echo "3. Run: npm run android"
echo ""
echo "Or to run on iOS (macOS only):"
echo "1. cd ios && pod install && cd .."
echo "2. Run: npm run ios"
