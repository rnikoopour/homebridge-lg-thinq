// LG removed searchKey and now signs EMP OAuth requests through /signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Auth } = require('../dist/lib/Auth.js');
const { requestClient } = require('../dist/lib/request.js');

const auth = new Auth({
  login_base_url: 'https://login.example/',
  emp_base_url: 'https://emp.example/',
  country_code: 'US',
  language_code: 'en-US',
});

test('requestEmpSignature asks the signature service for the signed message', async () => {
  const originalGet = requestClient.get;
  let url;
  requestClient.get = async (requestUrl) => {
    url = requestUrl;
    return { data: 'c2lnbmF0dXJlLXRlc3Q=\n' };
  };

  try {
    const signature = await auth.requestEmpSignature('path?q\nTue, 05 Nov 2026');
    assert.equal(signature, 'c2lnbmF0dXJlLXRlc3Q=');
  } finally {
    requestClient.get = originalGet;
  }

  const params = new URL(url).searchParams;
  assert.match(url, /^https:\/\/login\.example\/signature\?/);
  assert.equal(params.get('kind'), 'oauth2');
  assert.equal(params.get('key_name'), 'OAUTH_SECRETKEY');
  assert.equal(params.get('sever_type'), 'OP');
  assert.equal(params.get('timestamp'), 'path?q\nTue, 05 Nov 2026');
});

test('requestEmpSignature rejects the HTML page LG serves for removed routes', async () => {
  const originalGet = requestClient.get;
  requestClient.get = async () => ({ data: '<!DOCTYPE html><html><head><title>Document</title></head></html>' });

  try {
    await assert.rejects(
      auth.requestEmpSignature('path?q\nTue, 05 Nov 2026'),
      /unexpected response from the LG signature service/,
    );
  } finally {
    requestClient.get = originalGet;
  }
});
