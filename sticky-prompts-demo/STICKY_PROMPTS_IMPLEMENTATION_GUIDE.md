# Sticky User Prompts - Implementation Guide

A comprehensive guide to implementing Cursor-style sticky user prompts in any Electron/web application.

## 📋 Table of Contents

1. [Overview](#overview)
2. [UX Behavior](#ux-behavior)
3. [Architecture](#architecture)
4. [HTML Structure](#html-structure)
5. [CSS Styling](#css-styling)
6. [JavaScript Logic](#javascript-logic)
7. [Complete Example](#complete-example)
8. [Advanced Features](#advanced-features)

---

## Overview

**Sticky user prompts** keep the user's question visible at the top of the chat while scrolling through the AI's response. This provides better context and improves readability in long conversations.

### ⚠️ Important Note

**This guide only shows how to add sticky prompts to your existing app.** 

- ✅ Keep your existing API calls, response handling, and app logic
- ✅ Keep your existing styling and design
- ✅ Just add the sticky prompts structure and CSS
- ❌ Don't change how your app works internally
- ❌ Don't copy the demo responses or placeholder code

The sticky behavior is **purely presentational** - it works with any backend, any API, and any response format you already have.

### Key Features

- ✅ User messages stay pinned at the top while scrolling
- ✅ Each conversation "turn" is self-contained
- ✅ Prompts smoothly push each other (no overlap)
- ✅ Flush positioning against the top when scrolling
- ✅ High z-index to stay above content
- ✅ Works with your existing code (no refactoring needed!)

---

## UX Behavior

### Visual Flow

```
┌─────────────────────────────────────┐
│ [Sticky User Prompt 1]              │ ← Stays at top
├─────────────────────────────────────┤
│ Assistant Response (scrollable)     │
│ ...                                  │
│ ...                                  │
│ ...                                  │
├─────────────────────────────────────┤
│ [Sticky User Prompt 2]              │ ← Pushes prompt 1 up
├─────────────────────────────────────┤
│ Assistant Response (scrollable)     │
│ ...                                  │
└─────────────────────────────────────┘
```

### Scrolling States

1. **Not scrolled**: Top padding creates breathing room
2. **Scrolling**: Padding removed, prompt sits flush at top
3. **Next prompt appears**: Previous prompt smoothly exits upward

---

## Architecture

### Core Concept: Turn-Based Containment

Each user→assistant exchange is wrapped in a **"turn" container**. This is the secret sauce that makes prompts push each other smoothly.

```html
<div class="chat-list">
  <div class="turn">                    <!-- Turn 1 -->
    <div class="sticky-prompt">User message 1</div>
    <div class="assistant-msg">AI response 1</div>
  </div>
  <div class="turn">                    <!-- Turn 2 -->
    <div class="sticky-prompt">User message 2</div>
    <div class="assistant-msg">AI response 2</div>
  </div>
</div>
```

### Why Turns Matter

- **Without turns**: Sticky prompts overlap or jump suddenly
- **With turns**: `position: sticky` is constrained to parent, so prompts naturally push each other

---

## HTML Structure

### Basic Chat Container

```html
<!DOCTYPE html>
<html>
<head>
  <title>Sticky Prompts Chat</title>
  <link rel="stylesheet" href="chat.css">
</head>
<body>
  <div class="chat-app">
    <!-- Main scrollable chat area -->
    <div class="chat-container" id="chatContainer">
      <!-- Messages blur wrapper (optional, for effects) -->
      <div class="messages-blur-wrapper">
        <!-- Messages list -->
        <div class="messages-list" id="messagesList">
          <!-- Turns will be dynamically added here -->
        </div>
      </div>
    </div>
    
    <!-- Input area (fixed at bottom) -->
    <div class="chat-input-area">
      <textarea id="userInput" placeholder="Type your message..."></textarea>
      <button id="sendBtn">Send</button>
    </div>
  </div>

  <script src="chat.js"></script>
</body>
</html>
```

### Message Structure (Created Dynamically)

```html
<!-- A single turn -->
<div class="turn">
  <!-- User message (sticky) -->
  <div class="message user-message sticky-message" data-role="user">
    <div class="message-bubble">
      <div class="message-content">User's question here</div>
    </div>
  </div>
  
  <!-- Assistant message -->
  <div class="message assistant-message" data-role="assistant">
    <div class="message-header">
      <span class="avatar">🤖</span>
      <span class="username">Assistant</span>
    </div>
    <div class="message-content">
      Assistant's response here...
    </div>
  </div>
</div>
```

---

## CSS Styling

### Complete Stylesheet

```css
/* ===================================================================
 * Base Chat Layout
 * =================================================================== */

.chat-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #1e1e1e;
  color: #cccccc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  /* Default padding with breathing room */
  padding: 14px 12px 10px;
  /* Smooth transition when padding changes */
  transition: padding-top 0.1s ease-out;
}

/* Remove top padding when scrolled (flush against top) */
.chat-container.scrolled {
  padding-top: 0;
}

.messages-blur-wrapper {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ===================================================================
 * Turn Container (Critical for Sticky Behavior)
 * =================================================================== */

.turn {
  /* Position relative creates a containing block for sticky children */
  position: relative;
  /* Add some spacing between turns */
  margin-bottom: 20px;
}

/* ===================================================================
 * Sticky User Messages
 * =================================================================== */

.sticky-message {
  /* THIS IS THE MAGIC: position sticky */
  position: sticky;
  /* Stick to the top of the scrolling container */
  top: 0;
  /* High z-index to stay above content (but below next sticky prompt) */
  z-index: 1000;
  /* Background to cover content scrolling underneath */
  background-color: #1e1e1e;
  /* Some vertical padding */
  padding-top: 10px;
  padding-bottom: 10px;
}

/* Pseudo-element to extend background slightly above (prevents gaps) */
.sticky-message::after {
  content: "";
  position: absolute;
  top: -1px;
  left: 0;
  right: 0;
  height: 5px;
  background-color: #1e1e1e;
  /* Behind the actual content */
  z-index: -1;
}

/* ===================================================================
 * User Message Styling
 * =================================================================== */

.user-message {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.user-message .message-bubble {
  background-color: #2d2d2d;
  border: 1px solid #3e3e3e;
  border-radius: 8px;
  padding: 10px 14px;
  max-width: 80%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.user-message .message-content {
  color: #e1e1e1;
  font-size: 13px;
  line-height: 1.5;
  word-wrap: break-word;
}

/* ===================================================================
 * Assistant Message Styling
 * =================================================================== */

.assistant-message {
  margin-bottom: 20px;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  color: #999;
}

.avatar {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.assistant-message .message-content {
  color: #cccccc;
  font-size: 14px;
  line-height: 1.6;
  padding: 8px 0;
  /* Allow long responses to be readable */
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* ===================================================================
 * Input Area (Fixed Bottom)
 * =================================================================== */

.chat-input-area {
  display: flex;
  gap: 8px;
  padding: 12px;
  background-color: #252525;
  border-top: 1px solid #3e3e3e;
}

#userInput {
  flex: 1;
  min-height: 40px;
  max-height: 200px;
  padding: 10px;
  background-color: #2d2d2d;
  border: 1px solid #3e3e3e;
  border-radius: 6px;
  color: #e1e1e1;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
  outline: none;
}

#userInput:focus {
  border-color: #007acc;
}

#sendBtn {
  padding: 10px 20px;
  background-color: #007acc;
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

#sendBtn:hover {
  background-color: #005a9e;
}

#sendBtn:active {
  background-color: #004578;
}

/* ===================================================================
 * Scrollbar Styling (Optional)
 * =================================================================== */

.chat-container::-webkit-scrollbar {
  width: 10px;
}

.chat-container::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.chat-container::-webkit-scrollbar-thumb {
  background: #3e3e3e;
  border-radius: 5px;
}

.chat-container::-webkit-scrollbar-thumb:hover {
  background: #4e4e4e;
}
```

---

## JavaScript Logic

### Complete Implementation

```javascript
/**
 * Sticky Prompts Chat Application
 */

class StickyPromptsChat {
  constructor() {
    this.chatContainer = document.getElementById('chatContainer');
    this.messagesList = document.getElementById('messagesList');
    this.userInput = document.getElementById('userInput');
    this.sendBtn = document.getElementById('sendBtn');
    
    // Track the current turn element for grouping messages
    this.currentTurnEl = null;
    
    this.init();
  }
  
  init() {
    // Set up event listeners
    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
    
    // Monitor scroll to toggle "scrolled" class
    this.chatContainer.addEventListener('scroll', () => {
      this.updateScrollState();
    });
    
    // Initial scroll state
    this.updateScrollState();
  }
  
  /**
   * Update the "scrolled" class based on scroll position
   * This removes top padding when scrolling starts
   */
  updateScrollState() {
    const isScrolled = this.chatContainer.scrollTop > 0;
    this.chatContainer.classList.toggle('scrolled', isScrolled);
  }
  
  /**
   * Handle send button click
   */
  async handleSend() {
    const text = this.userInput.value.trim();
    if (!text) return;
    
    // Add user message
    this.addUserMessage(text);
    
    // Clear input
    this.userInput.value = '';
    
    // Scroll to bottom
    this.scrollToBottom();
    
    // Simulate AI response (replace with your actual API call)
    await this.simulateAssistantResponse(text);
  }
  
  /**
   * Add a user message to the chat
   * Creates a new "turn" for grouping user→assistant messages
   */
  addUserMessage(text) {
    // Create a new turn container
    this.currentTurnEl = document.createElement('div');
    this.currentTurnEl.className = 'turn';
    this.messagesList.appendChild(this.currentTurnEl);
    
    // Create the user message element
    const messageEl = document.createElement('div');
    messageEl.className = 'message user-message sticky-message';
    messageEl.setAttribute('data-role', 'user');
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;
    
    bubble.appendChild(content);
    messageEl.appendChild(bubble);
    
    // Add to the current turn
    this.currentTurnEl.appendChild(messageEl);
  }
  
  /**
   * Add an assistant message to the chat
   * Appends to the current turn (same user→assistant grouping)
   */
  addAssistantMessage(text) {
    // Use the current turn (or create one if missing)
    const parent = this.currentTurnEl || this.messagesList;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'message assistant-message';
    messageEl.setAttribute('data-role', 'assistant');
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = '🤖';
    
    const username = document.createElement('span');
    username.className = 'username';
    username.textContent = 'Assistant';
    
    header.appendChild(avatar);
    header.appendChild(username);
    
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;
    
    messageEl.appendChild(header);
    messageEl.appendChild(content);
    
    parent.appendChild(messageEl);
  }
  
  /**
   * Get AI response - REPLACE THIS WITH YOUR EXISTING API LOGIC
   * This is just a placeholder to demonstrate the sticky prompts behavior
   */
  async simulateAssistantResponse(userText) {
    // ==================================================================
    // TODO: Replace this entire method with your existing API call logic
    // The sticky prompts work with ANY response mechanism you already have
    // ==================================================================
    
    // Just call your existing API method here, for example:
    // const response = await yourApp.getAIResponse(userText);
    // this.addAssistantMessage(response);
    
    // Below is minimal demo code only:
    await this.sleep(1000);
    const demoResponse = `Response to: "${userText}"`;
    this.addAssistantMessage(demoResponse);
    this.scrollToBottom();
  }
  
  /**
   * Scroll chat to bottom smoothly
   */
  scrollToBottom(smooth = true) {
    this.chatContainer.scrollTo({
      top: this.chatContainer.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }
  
  /**
   * Helper to simulate async delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Add a message with streaming (character by character)
   * Useful for real-time AI responses
   */
  async addAssistantMessageStreaming(text) {
    const parent = this.currentTurnEl || this.messagesList;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'message assistant-message';
    messageEl.setAttribute('data-role', 'assistant');
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = '🤖';
    
    const username = document.createElement('span');
    username.className = 'username';
    username.textContent = 'Assistant';
    
    header.appendChild(avatar);
    header.appendChild(username);
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    messageEl.appendChild(header);
    messageEl.appendChild(content);
    parent.appendChild(messageEl);
    
    // Stream characters one by one
    for (let i = 0; i < text.length; i++) {
      content.textContent += text[i];
      
      // Auto-scroll as content appears
      if (this.isNearBottom()) {
        this.scrollToBottom(false);
      }
      
      // Small delay between characters
      await this.sleep(10);
    }
  }
  
  /**
   * Check if user is near the bottom of chat
   */
  isNearBottom(threshold = 100) {
    const { scrollTop, scrollHeight, clientHeight } = this.chatContainer;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }
}

// Initialize the chat when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.chat = new StickyPromptsChat();
});
```

---

## Complete Example

### Project Structure

```
sticky-prompts-chat/
├── index.html
├── chat.css
├── chat.js
└── README.md
```

### Quick Start

1. **Create `index.html`** with the HTML structure above
2. **Create `chat.css`** with the CSS styling above  
3. **Create `chat.js`** with the JavaScript logic above
4. **Open in browser** or package with Electron

### Testing the Behavior

1. Type a message and send it
2. Scroll up through the assistant's response
3. Notice the user prompt stays sticky at the top
4. Send another message
5. Watch how the new prompt pushes the old one up smoothly

---

## Advanced Features

### 1. Add Message Actions (Edit, Copy, Delete)

```javascript
addUserMessage(text) {
  // ... existing code ...
  
  // Add action buttons
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = `
    <button class="action-btn" title="Edit">✏️</button>
    <button class="action-btn" title="Copy">📋</button>
    <button class="action-btn" title="Delete">🗑️</button>
  `;
  
  bubble.appendChild(actions);
  
  // Add event listeners
  actions.querySelector('button:nth-child(1)').onclick = () => this.editMessage(messageEl);
  actions.querySelector('button:nth-child(2)').onclick = () => this.copyMessage(text);
  actions.querySelector('button:nth-child(3)').onclick = () => this.deleteMessage(messageEl);
}
```

### 2. Persist Chat History

```javascript
saveChatToStorage() {
  const messages = Array.from(this.messagesList.querySelectorAll('.message')).map(el => ({
    role: el.getAttribute('data-role'),
    content: el.querySelector('.message-content').textContent
  }));
  
  localStorage.setItem('chatHistory', JSON.stringify(messages));
}

loadChatFromStorage() {
  const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
  
  history.forEach(msg => {
    if (msg.role === 'user') {
      this.addUserMessage(msg.content);
    } else {
      this.addAssistantMessage(msg.content);
    }
  });
}
```

### 3. Add Markdown Rendering

```javascript
// Use a library like marked.js
addAssistantMessage(text) {
  // ... existing code ...
  
  // Render markdown instead of plain text
  content.innerHTML = marked.parse(text);
  
  // Add syntax highlighting for code blocks
  content.querySelectorAll('pre code').forEach(block => {
    hljs.highlightElement(block);
  });
}
```

### 4. Add Typing Indicator

```javascript
showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.id = 'typingIndicator';
  indicator.innerHTML = `
    <span class="dot"></span>
    <span class="dot"></span>
    <span class="dot"></span>
  `;
  
  this.currentTurnEl.appendChild(indicator);
  this.scrollToBottom();
}

hideTypingIndicator() {
  document.getElementById('typingIndicator')?.remove();
}
```

```css
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px;
}

.typing-indicator .dot {
  width: 8px;
  height: 8px;
  background-color: #666;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-8px);
  }
}
```

### 5. Add Smooth Scroll Snap (Optional)

```css
.messages-list {
  scroll-snap-type: y proximity;
}

.turn {
  scroll-snap-align: start;
  scroll-snap-stop: normal;
}
```

### 6. Integrate with Your Existing API

**Important:** Don't change your existing API logic! Just use the sticky prompts structure:

```javascript
async handleSend() {
  const text = this.userInput.value.trim();
  if (!text) return;
  
  // 1. Add user message (creates the sticky prompt and turn container)
  this.addUserMessage(text);
  
  // 2. Clear input
  this.userInput.value = '';
  this.scrollToBottom();
  
  // 3. Call YOUR EXISTING API method (don't change your API logic!)
  // ==================================================================
  // Just replace this line with your existing API call:
  const response = await yourApp.callYourExistingAPI(text);
  
  // 4. Add the response (appends to the same turn container)
  this.addAssistantMessage(response);
  // ==================================================================
  
  this.scrollToBottom();
}

// That's it! The sticky behavior works automatically because:
// - addUserMessage() creates a new .turn container
// - User messages have .sticky-message class (position: sticky)
// - Assistant messages are added to the same turn
// No changes to your API/response logic needed!
```

**For streaming responses**, just update the content as chunks arrive:

```javascript
// Your existing streaming code can stay the same!
// Just make sure you:
// 1. Create the turn with addUserMessage()
// 2. Add initial assistant message element
// 3. Update its .message-content as data streams in

const messageEl = this.addAssistantMessage(''); // Empty initially
const contentEl = messageEl.querySelector('.message-content');

// Your existing streaming logic:
yourExistingStreamHandler((chunk) => {
  contentEl.textContent += chunk;
  if (this.isNearBottom()) this.scrollToBottom(false);
});
```

---

## Electron Integration

### Main Process (`main.js`)

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden', // Optional: custom title bar
  });
  
  win.loadFile('index.html');
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

### Package.json

```json
{
  "name": "sticky-prompts-chat",
  "version": "1.0.0",
  "description": "Chat app with sticky user prompts",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dev": "NODE_ENV=development electron .",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.1"
  },
  "build": {
    "appId": "com.yourcompany.stickychat",
    "productName": "Sticky Chat",
    "directories": {
      "output": "dist"
    },
    "mac": {
      "category": "public.app-category.productivity"
    },
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

---

## Key Takeaways

### The Three Pillars

1. **Turn Containers** - Group each user→assistant exchange
2. **Position Sticky** - Make user messages stick to `top: 0`
3. **High Z-Index** - Keep sticky messages above scrolling content

### Integration with Your App

✅ **Just wrap your existing message rendering:**
- Create a `.turn` container when user sends a message
- Add user message with `.sticky-message` class
- Add assistant response to the same turn
- Everything else stays exactly the same!

✅ **Your existing code doesn't change:**
- Keep your API calls as-is
- Keep your response handling as-is
- Keep your styling preferences
- Just add the structural wrapper + sticky CSS

### Common Pitfalls

❌ **Forgetting turn containers** → Prompts will overlap or jump  
❌ **Wrong parent positioning** → Sticky won't work without `position: relative` parent  
❌ **Low z-index** → Content scrolls over the prompt  
❌ **No background** → See-through effect as content scrolls underneath  
❌ **Trying to change existing app logic** → Not needed! This is purely structural

### Performance Tips

- Use `transform` instead of `top` for animations
- Debounce scroll event handlers
- Use `will-change: transform` for frequently updated elements
- Lazy load old messages if chat history is very long

---

## Browser Compatibility

This technique works in all modern browsers:

- ✅ Chrome/Edge 91+
- ✅ Firefox 89+
- ✅ Safari 13+
- ✅ Electron (all recent versions)

`position: sticky` has excellent support, so no polyfills needed!

---

## License

This implementation guide is provided as-is for educational purposes. Feel free to use it in your projects!

## Questions?

If you need clarification on any part of this implementation, feel free to ask. Good luck with your chat app! 🚀

