const test = require('node:test');
const assert = require('node:assert/strict');

const { registerTerminalCommandIpc } = require('../main/ipc/terminal-commands');

test('registerTerminalCommandIpc validates required dependencies', () => {
  assert.throws(() => registerTerminalCommandIpc(), /ipcMain is required/);
  assert.throws(
    () => registerTerminalCommandIpc({ ipcMain: { handle() {} } }),
    /execAsync is required/
  );
});



