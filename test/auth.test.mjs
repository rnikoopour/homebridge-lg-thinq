// The new-terms flow must use the account's configured country and language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Auth } = require('../dist/lib/Auth.js');
const { requestClient } = require('../dist/lib/request.js');

test('new-term agreement uses the configured country and language', async () => {
  const originalGet = requestClient.get;
  const urls = [];
  requestClient.get = async (url) => {
    urls.push(url);
    if (url.includes('common/showTerms')) {
      return { data: 'signature   :   "sig" tStamp   :   "ts"' };
    }
    if (url.includes('account/user/terms')) {
      return { data: { account: { terms: [{ termsID: 'SVC202_1' }] } } };
    }
    if (url.includes('info/terms')) {
      return { data: { info: { terms: [{ termsType: 'SVC202', termsID: 'SVC202_1', defaultLang: 'en-GB' }] } } };
    }
    throw new Error('unexpected URL: ' + url);
  };

  try {
    const auth = new Auth({
      login_base_url: 'https://login.example/',
      emp_base_url: 'https://emp.example/',
      country_code: 'GB',
      language_code: 'en-GB',
    });
    await auth.handleNewTerm('token');
  } finally {
    requestClient.get = originalGet;
  }

  assert.match(urls[0], /[?&]country=GB(?:&|$)/);
  assert.match(urls[0], /[?&]language=en-GB(?:&|$)/);
});
