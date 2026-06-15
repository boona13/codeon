// ---- CHUNK 6/6 from hoisted.js (AST statement boundaries; order preserved) ----



async function ensureGitInitializedIfNeeded() {
  if (!window.electronAPI) throw new Error('Missing electronAPI');

  const inside = await window.electronAPI.runTerminalCommand('git rev-parse --is-inside-work-tree', true);
  if (!inside || inside.success !== true) {
    // Auto-init git repo (workspace should always be recoverable).
    const initRes = await window.electronAPI.runTerminalCommand(
      'git init && git config user.name "AI Agent" && git config user.email "ai@agent.local"',
      true
    );
    if (!initRes || initRes.success !== true) {
      throw new Error(initRes?.error || initRes?.output || 'Failed to initialize git');
    }
  }

  const head = await window.electronAPI.runTerminalCommand('git rev-parse --verify HEAD', true);
  if (!head || head.success !== true || typeof head.output !== 'string' || !head.output.trim()) {
    // Create the initial commit (exclude .ai-agent).
    const initCommit = await window.electronAPI.runTerminalCommand(
      'git add -A && git reset -q -- .ai-agent >/dev/null 2>&1 || true; git commit -m "Initial commit" && git checkout -B main',
      true
    );
    if (!initCommit || initCommit.success !== true) {
      throw new Error(initCommit?.error || initCommit?.output || 'Failed to create initial commit');
    }
    const newHead = await window.electronAPI.runTerminalCommand('git rev-parse --verify HEAD', true);
    if (!newHead || newHead.success !== true || typeof newHead.output !== 'string' || !newHead.output.trim()) {
      throw new Error('Git repository must have at least one commit');
    }
    return newHead.output.trim();
  }

  return head.output.trim();
}


async function getGitInProgressState() {
  try {
    if (!window.electronAPI) return;
    const ops = [
      { op: 'cherry-pick', head: 'CHERRY_PICK_HEAD', conflictsCmd: 'git diff --name-only --diff-filter=U' },
      { op: 'merge', head: 'MERGE_HEAD', conflictsCmd: 'git diff --name-only --diff-filter=U' },
      { op: 'rebase', head: 'REBASE_HEAD', conflictsCmd: 'git diff --name-only --diff-filter=U' }
    ];
    for (const o of ops) {
      const headRes = await window.electronAPI.runTerminalCommand(`git rev-parse -q --verify ${o.head}`, true);
      if (headRes && headRes.success === true) {
        let conflictFiles = [];
        try {
          const cf = await window.electronAPI.runTerminalCommand(o.conflictsCmd, true);
          const out = cf && cf.success && typeof cf.output === 'string' ? cf.output : '';
          conflictFiles = out.split('\n').map(s => s.trim()).filter(Boolean);
        } catch { /* ignore */ }
        return { inProgress: true, op: o.op, conflictFiles };
      }
    }
    return { inProgress: false, op: null, conflictFiles: [] };
  } catch {
    return { inProgress: false, op: null, conflictFiles: [] };
  }
}


async function abortGitOpIfAny() {
  if (!window.electronAPI) return;
  const st = await getGitInProgressState();
  if (!st || st.inProgress !== true) return;
  await withGitOperationLock(async () => {
    if (st.op === 'cherry-pick') {
      await window.electronAPI.runTerminalCommand('git cherry-pick --abort', true);
    } else if (st.op === 'merge') {
      await window.electronAPI.runTerminalCommand('git merge --abort', true);
    } else if (st.op === 'rebase') {
      await window.electronAPI.runTerminalCommand('git rebase --abort', true);
    }
  });
}


function addGitOpRecoveryMessage(sessionId, { op = 'cherry-pick', conflictFiles = [], beforeCommit = '', filesChanged = 0, note = '' } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  ensureSessionMessages(sid);
  ensureMessageSeqInitialized(sid);
  const msgs = chatSessions[sid] && Array.isArray(chatSessions[sid].messages) ? chatSessions[sid].messages : [];

  // De-dupe: keep only one active recovery card.
  for (const m of msgs) {
    if (m && m.role === 'git_op_recovery' && m.dismissed !== true) {
      m.dismissed = true;
    }
  }

  const msg = {
    role: 'git_op_recovery',
    op: String(op || 'cherry-pick'),
    conflictFiles: Array.isArray(conflictFiles) ? conflictFiles.slice(0, 50) : [],
    beforeCommit: String(beforeCommit || ''),
    filesChanged: Number.isFinite(Number(filesChanged)) ? Number(filesChanged) : 0,
    note: String(note || ''),
    dismissed: false,
    timestamp: Date.now(),
    seq: nextMessageSeq(sid)
  };
  msgs.push(msg);
  chatSessions[sid].messages = msgs;
  chatSessions[sid].history = chatSessions[sid].messages;
  saveChatHistory(true);

  if (sid === currentSessionId) {
    renderMessageToUI(msg);
    try {
      const messagesContainer = document.getElementById('chatMessages');
      if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch { /* ignore */ }
  }
}


async function createNewFile() {
  console.log('[Context Menu] createNewFile called');

  // Save context menu state before hiding
  const targetDir = contextMenuIsFolder ? contextMenuPath : currentFolder;

  hideContextMenu();

  if (!currentFolder) {
    await customAlert('Please open a folder first', 'File Explorer');
    return;
  }

  console.log('[Context Menu] Target dir:', targetDir);
  const fileName = await customPrompt('Enter file name:', 'untitled.txt');

  if (!fileName) return;

  const filePath = `${targetDir}/${fileName}`;

  if (window.electronAPI) {
    const result = await window.electronAPI.writeFile(filePath, '');
    if (result.success) {
      showToast(`Created: ${fileName}`);
      await refreshFileTree();
      await openFile(filePath);

      // Commit to git and add chat message with restore button
      await commitFileOperation('create', fileName, filePath);
    } else {
      await customAlert('Error creating file: ' + result.error);
    }
  }
}


async function createNewFolder() {
  // Save context menu state before hiding
  const targetDir = contextMenuIsFolder ? contextMenuPath : currentFolder;

  hideContextMenu();

  if (!currentFolder) {
    await customAlert('Please open a folder first', 'File Explorer');
    return;
  }

  const folderName = await customPrompt('Enter folder name:', 'New Folder');

  if (!folderName) return;

  const dirPath = `${targetDir}/${folderName}`;

  if (window.electronAPI) {
    const result = await window.electronAPI.createDirectory(dirPath);
    if (result.success) {
      // Create .gitkeep file so Git can track empty folders
      const gitkeepPath = `${dirPath}/.gitkeep`;
      await window.electronAPI.writeFile(gitkeepPath, '');

      showToast(`Created folder: ${folderName}`);
      await refreshFileTree();

      // Commit to git and add chat message with restore button
      await commitFileOperation('create_folder', folderName, dirPath);
    } else {
      await customAlert('Error creating folder: ' + result.error);
    }
  }
}


async function renameItem() {
  console.log('[Context Menu] renameItem called');

  // Save context menu state before hiding
  const savedPath = contextMenuPath;
  const savedTarget = contextMenuTarget;
  const savedIsFolder = contextMenuIsFolder;

  console.log('[Context Menu] contextMenuPath:', savedPath);
  console.log('[Context Menu] contextMenuTarget:', savedTarget);

  hideContextMenu();

  if (!savedPath || !savedTarget) {
    console.log('[Context Menu] Missing path or target, returning');
    return;
  }

  const currentName = savedTarget.dataset.name;
  const newName = await customPrompt('Enter new name:', currentName);

  if (!newName || newName === currentName) return;

  const oldPath = savedPath;
  const newPath = oldPath.replace(new RegExp(currentName + '$'), newName);

  if (window.electronAPI) {
    const result = await window.electronAPI.renameFile(oldPath, newPath);
    if (result.success) {
      showToast(`Renamed to: ${newName}`);

      // If currently editing this file, update the path
      if (currentFile === oldPath) {
        currentFile = newPath;
        window.currentFile = newPath;
        document.getElementById('currentFilePath').textContent = newName;
      }

      await refreshFileTree();

      // Commit to git and add chat message with restore button
      const operation = savedIsFolder ? 'rename_folder' : 'rename';
      await commitFileOperation(operation, `${currentName} → ${newName}`, newPath, oldPath);
    } else {
      await customAlert('Error renaming: ' + result.error);
    }
  }
}


async function deleteItem() {
  // Save context menu state before hiding
  const savedPath = contextMenuPath;
  const savedTarget = contextMenuTarget;
  const savedIsFolder = contextMenuIsFolder;

  hideContextMenu();

  if (!savedPath) return;

  const itemName = savedTarget.dataset.name;
  const itemType = savedIsFolder ? 'folder' : 'file';

  if (!await customConfirm(`Are you sure you want to delete this ${itemType}: ${itemName}?`)) {
    return;
  }

  if (window.electronAPI) {
    const result = await window.electronAPI.deleteFile(savedPath);
    if (result.success) {
      showToast(`Deleted: ${itemName}`);

      // If currently editing this file, clear editor
      if (currentFile === savedPath) {
        currentFile = null;
        window.currentFile = null;
        if (editor) {
          editor.setValue('');
        }
        document.getElementById('currentFilePath').textContent = 'No file open';
        document.getElementById('editorEmptyState').style.display = 'flex';
      }

      await refreshFileTree();

      // Commit to git and add chat message with restore button
      const operation = savedIsFolder ? 'delete_folder' : 'delete';
      await commitFileOperation(operation, itemName, savedPath);
    } else {
      await customAlert('Error deleting: ' + result.error);
    }
  }
}


async function revealInFinder() {
  // Save context menu state before hiding
  const savedPath = contextMenuPath;

  hideContextMenu();

  if (!savedPath) return;

  if (window.electronAPI) {
    await window.electronAPI.revealInFinder(savedPath);
  }
}


// Commit file operation to git and add chat message with restore button
async function commitFileOperation(operation, itemName, newPath, oldPath = null) {
  console.log('[File Operation] Committing:', operation, itemName, newPath);
  try {
    // Check if HEAD is detached and fix it
    const headCheck = await window.electronAPI.runTerminalCommand('git symbolic-ref -q HEAD', true);
    if (!headCheck.success) {
      console.log('[File Operation] Detached HEAD detected, creating/switching to main branch');
      // Create or switch to main branch
      await window.electronAPI.runTerminalCommand('git checkout -B main', true);
    }

    // Get commit hash before the operation
    const beforeCommit = await getLastCommitHash();
    console.log('[File Operation] Before commit:', beforeCommit);

    // Stage and commit the changes
    const commitMessages = {
      'create': `Created file: ${itemName}`,
      'create_folder': `Created folder: ${itemName}`,
      'rename': `Renamed file: ${itemName}`,
      'rename_folder': `Renamed folder: ${itemName}`,
      'delete': `Deleted file: ${itemName}`,
      'delete_folder': `Deleted folder: ${itemName}`
    };

    const commitMessage = commitMessages[operation] || `File operation: ${operation}`;

    // Commit to git
    console.log('[File Operation] Committing with message:', commitMessage);
    const commitResult = await window.electronAPI.runTerminalCommand(
      `git add -A && git reset -q -- .ai-agent >/dev/null 2>&1 || true; git commit -m "${commitMessage}"`,
      true
    );

    console.log('[File Operation] Commit result:', commitResult);

    if (commitResult.success) {
      // Get the new commit hash
      const afterCommit = await getLastCommitHash();
      console.log('[File Operation] After commit:', afterCommit);

      // Add a system message to chat with restore button
      addFileOperationMessage(operation, itemName, beforeCommit, afterCommit, newPath, oldPath);
    } else {
      console.error('[File Operation] Commit failed:', commitResult.error || commitResult.output);
    }
  } catch (e) {
    console.error('[File Operation] Failed to commit:', e);
  }
}


// Add file operation message to chat
function addFileOperationMessage(operation, itemName, beforeCommit, afterCommit, newPath, oldPath) {
  const messagesContainer = document.getElementById('chatMessages');
  // Safety: ensure we persist this operation to the correct session history.
  ensureHydratedChatHistoryForCurrentSession('file_operation');
  ensureMessageSeqInitialized(currentSessionId);
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system file-operation';

  const icons = {
    'create': '📄',
    'create_folder': '📁',
    'rename': '✏️',
    'rename_folder': '📁✏️',
    'delete': '🗑️',
    'delete_folder': '📁🗑️'
  };

  const descriptions = {
    'create': `Created file: ${itemName}`,
    'create_folder': `Created folder: ${itemName}`,
    'rename': `Renamed file: ${itemName}`,
    'rename_folder': `Renamed folder: ${itemName}`,
    'delete': `Deleted file: ${itemName}`,
    'delete_folder': `Deleted folder: ${itemName}`
  };

  messageDiv.innerHTML = `
    <div class="message-header" style="display: flex; justify-content: space-between; align-items: center;">
      <span>${icons[operation] || '📝'} ${descriptions[operation]}</span>
      <button class="restore-btn" data-before-commit="${beforeCommit}" data-operation="${operation}" data-path="${newPath}" data-old-path="${oldPath || ''}">
        ⏮️ Undo
      </button>
    </div>
  `;

  // Add restore functionality
  const restoreBtn = messageDiv.querySelector('.restore-btn');
  restoreBtn.addEventListener('click', async () => {
    if (await customConfirm(`Undo this operation: ${descriptions[operation]}?`)) {
      await restoreFileOperation(beforeCommit, operation, newPath, oldPath);
      restoreBtn.disabled = true;
      restoreBtn.textContent = '✓ Undone';
      restoreBtn.style.opacity = '0.5';
    }
  });

  appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
  smartScrollToBottom(messagesContainer);

  // Save to chat history so it persists across tab switches
  chatHistory.push({
    role: 'file_operation',
    operation: operation,
    itemName: itemName,
    beforeCommit: beforeCommit,
    afterCommit: afterCommit,
    newPath: newPath,
    oldPath: oldPath,
    timestamp: Date.now(),
    seq: nextMessageSeq(currentSessionId)
  });
  saveChatHistory();
}


// Restore file operation by checking out previous commit
async function restoreFileOperation(beforeCommit, operation, newPath, oldPath) {
  try {
    if (operation === 'delete' || operation === 'delete_folder') {
      // Restore deleted file/folder from previous commit
      await window.electronAPI.runTerminalCommand(
        `git checkout ${beforeCommit} -- "${newPath}"`,
        true
      );
      showToast('Restored from Git');
    } else if (operation === 'create' || operation === 'create_folder') {
      // Delete the created file/folder
      await window.electronAPI.deleteFile(newPath);
      showToast('Creation undone');
    } else if (operation === 'rename' || operation === 'rename_folder') {
      // Rename back to original name
      if (oldPath) {
        await window.electronAPI.renameFile(newPath, oldPath);
        showToast('Rename undone');
      }
    }

    // Commit the undo operation
    await window.electronAPI.runTerminalCommand(
      `git add -A && git reset -q -- .ai-agent >/dev/null 2>&1 || true; git commit -m "Undo: ${operation}"`,
      true
    );

    await refreshFileTree();
  } catch (e) {
    console.error('[File Operation] Failed to restore:', e);
    await customAlert('Failed to undo operation: ' + e.message);
  }
}


async function refreshFileTree() {
  if (!currentFolder) return;

  if (window.electronAPI) {
    const result = await window.electronAPI.readDirectory(currentFolder);
    if (result.success) {
      workspaceFileTreeSnapshot = Array.isArray(result.files) ? result.files : workspaceFileTreeSnapshot;
      renderFileTree(result.files);
      try { scheduleProjectProblemsScan('filetree-refresh'); } catch { /* ignore */ }
    }
  }
}
