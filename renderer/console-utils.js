
// ============ CONSOLE VIEW & TASKS ============

// Initialize Console Panel
window.initConsolePanel = function initConsolePanel() {
  const consolePanel = document.getElementById('consolePanel');
  const consoleToggle = document.getElementById('consoleToggle');

  if (consoleToggle && consolePanel) {
    // Toggle button click
    consoleToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      consolePanel.classList.toggle('collapsed');
    });
  }
};

// Add a message to the console
window.addConsoleMessage = function addConsoleMessage(message, type = 'info') { // type: 'info', 'success', 'error', 'processing'
  const consolePanel = document.getElementById('consolePanel');
  const consoleContent = document.getElementById('consoleContent');
  const consoleIndicator = document.querySelector('.console-indicator');

  if (!consolePanel || !consoleContent) return;

  // Ensure panel is visible when activity happens
  if (consolePanel.style.display === 'none') {
    consolePanel.style.display = 'flex';
  }

  const item = document.createElement('div');
  item.className = `console-item ${type}`;

  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  item.innerHTML = `
    <span class="timestamp">[${time}]</span>
    <span class="content">${message}</span>
  `;

  consoleContent.appendChild(item);
  consoleContent.scrollTop = consoleContent.scrollHeight;

  // Update status indicator
  if (type === 'processing') {
    if (consoleIndicator) {
      consoleIndicator.className = 'console-indicator processing';
    }
  } else if (type === 'success') {
    if (consoleIndicator) {
      consoleIndicator.className = 'console-indicator success';
    }
  } else if (type === 'error') {
    if (consoleIndicator) {
      consoleIndicator.className = 'console-indicator error';
    }
  }
};

// Update console status text directly
window.updateConsoleStatus = function updateConsoleStatus(status, type = 'idle') {
  // Status text removed from UI, only updating indicator
  const consoleIndicator = document.querySelector('.console-indicator');

  if (consoleIndicator) {
    consoleIndicator.className = 'console-indicator';
    if (type !== 'idle') {
      consoleIndicator.classList.add(type);
    }
  }

  // Optional: Add tooltip title to indicator
  if (consoleIndicator && status) {
    consoleIndicator.title = status;
  }
};

// Call initialization on load
document.addEventListener('DOMContentLoaded', () => {
  window.initConsolePanel?.();
});
