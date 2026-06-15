const test = require('node:test');
const assert = require('node:assert/strict');

const { redactDeep, createLogger } = require('../main/logger');

test('redactDeep redacts common secret-ish keys', () => {
  const input = {
    apiKey: 'sk-test-123',
    api_key: 'sk-test-456',
    token: 'tok_abc',
    secret: 'supersecret',
    authorization: 'Bearer xyz',
    password: 'pw',
    nested: {
      openrouterApiKey: 'sk-or-v1-xxx',
      ok: 'keep'
    }
  };

  const out = redactDeep(input);
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.api_key, '[REDACTED]');
  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.secret, '[REDACTED]');
  assert.equal(out.authorization, '[REDACTED]');
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.nested.openrouterApiKey, '[REDACTED]');
  assert.equal(out.nested.ok, 'keep');
});

test('createLogger produces callable methods', () => {
  const log = createLogger({ name: 'Test', level: 'debug' });
  assert.equal(typeof log.debug, 'function');
  assert.equal(typeof log.info, 'function');
  assert.equal(typeof log.warn, 'function');
  assert.equal(typeof log.error, 'function');
});



