#!/bin/bash

# AI Code Agent Editor - Installation and Launch Script

echo "🚀 AI Code Agent Editor - Setup"
echo "================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js v22.14.0 or higher from https://nodejs.org"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "⚠️  Warning: Node.js version is less than 22. Current version: $(node -v)"
    echo "Recommended: v22.14.0 or higher"
    echo ""
fi

echo "✅ Node.js detected: $(node -v)"
echo "✅ npm detected: $(npm -v)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    echo "This may take a few minutes..."
    echo ""
    npm install

    if [ $? -ne 0 ]; then
        echo "❌ Installation failed!"
        exit 1
    fi

    echo ""
    echo "✅ Dependencies installed successfully!"
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Starting AI Code Agent Editor..."
echo "================================"
echo ""

# Launch the application
npm start

