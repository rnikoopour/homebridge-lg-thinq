// A failed or skipped token refresh used to leave the plugin unable to reach LG until
// Homebridge restarted. These cover the refresh rules that keep it recovering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Session } = require('../dist/lib/Session.js');
const { Auth } = require('../dist/lib/Auth.js');
const { API } = require('../dist/lib/API.js');
const { requestClient } = require('../dist/lib/request.js');
const { TokenError, TokenExpiredError } = require('../dist/errors/index.js');

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('Session: a token is valid until shortly before LG says it expires', () => {
  assert.equal(new Session('token', 'refresh', 3600).hasValidToken(), true);
  assert.equal(new Session('token', 'refresh', 30).hasValidToken(), false);
  assert.equal(new Session('token', 'refresh', 0).hasValidToken(), false);
  assert.equal(new Session('', 'refresh', 3600).hasValidToken(), false);
});

test('Session: a refreshed token restarts the expiry clock', () => {
  const session = new Session('old', 'refresh', 0);
  session.newToken('new', '3600');
  assert.equal(session.accessToken, 'new');
  assert.equal(session.hasValidToken(), true);
});

test('Auth.refreshNewToken: a reply without an access token throws and keeps the old token', async () => {
  const auth = new Auth({ country_code: 'US', language_code: 'en-US' });
  const session = new Session('old-token', 'refresh', 0);
  const originalPost = requestClient.post;
  requestClient.post = async () => ({ data: { error: { code: 'LG.OAUTH.EC.4001', message: 'invalid' } } });

  try {
    await assert.rejects(auth.refreshNewToken(session), TokenError);
  } finally {
    requestClient.post = originalPost;
  }
  assert.equal(session.accessToken, 'old-token');
});

/** An API wired to a fake Auth and HTTP client; `responses` are served in order. */
function makeApi({ refresh, login, responses }) {
  const api = new API('US', 'en-US');
  api.logger = quietLogger;
  api._gateway = { thinq2_url: 'https://thinq2.example/', thinq1_url: 'https://thinq1.example/' };
  const calls = { refresh: 0, login: 0, requests: [] };
  api.auth = {
    async refreshNewToken(session) {
      calls.refresh++;
      await refresh(session, calls.refresh);
      session.newToken('token-' + calls.refresh, 3600);
      return session;
    },
    async getJSessionId() {
      return 'jsession';
    },
    async login() {
      calls.login++;
      await login?.();
      return new Session('login-token', 'login-refresh', 3600);
    },
  };
  api.httpClient = {
    async request(config) {
      calls.requests.push(config.headers['x-emp-token']);
      const next = responses.shift();
      if (next instanceof Error) {
        throw next;
      }
      return { data: next };
    },
  };
  return { api, calls };
}

test('request: an expiring token is refreshed before the request goes out', async () => {
  const { api, calls } = makeApi({ refresh: async () => {}, responses: [{ result: 'ok' }] });
  api.setRefreshToken('refresh');

  assert.deepEqual(await api.getRequest('https://lg.example/x'), { result: 'ok' });
  assert.equal(calls.refresh, 1);
  assert.deepEqual(calls.requests, ['token-1']);
});

test('request: a valid token is not refreshed', async () => {
  const { api, calls } = makeApi({ refresh: async () => {}, responses: [{ result: 'ok' }] });
  api.session = new Session('current', 'refresh', 3600);

  await api.getRequest('https://lg.example/x');
  assert.equal(calls.refresh, 0);
  assert.deepEqual(calls.requests, ['current']);
});

test('request: "token expired" from LG refreshes and retries once', async () => {
  const { api, calls } = makeApi({ refresh: async () => {}, responses: [new TokenExpiredError(), { result: 'ok' }] });
  api.session = new Session('stale', 'refresh', 3600);

  assert.deepEqual(await api.getRequest('https://lg.example/x'), { result: 'ok' });
  assert.equal(calls.refresh, 1);
  assert.deepEqual(calls.requests, ['stale', 'token-1']);
});

test('reauthenticate: concurrent callers share one refresh', async () => {
  const { api, calls } = makeApi({ refresh: () => new Promise(resolve => setTimeout(resolve, 10)), responses: [] });
  api.setRefreshToken('refresh');

  await Promise.all([api.reauthenticate(), api.reauthenticate(), api.reauthenticate()]);
  assert.equal(calls.refresh, 1);
});

test('reauthenticate: a failed refresh signs in again when credentials are configured', async () => {
  const { api, calls } = makeApi({
    refresh: async (_session, attempt) => {
      if (attempt === 1) {
        throw new TokenError('refresh token revoked');
      }
    },
    responses: [],
  });
  api.setRefreshToken('revoked');
  api.setUsernamePassword('user', 'pass');

  await api.reauthenticate();
  assert.equal(calls.login, 1);
  assert.equal(api.session.refreshToken, 'login-refresh');
  assert.equal(api.session.hasValidToken(), true);
});

test('reauthenticate: without credentials a failed refresh rejects, and the next call tries again', async () => {
  const { api, calls } = makeApi({
    refresh: async (_session, attempt) => {
      if (attempt === 1) {
        throw new TokenError('LG unavailable');
      }
    },
    responses: [],
  });
  api.setRefreshToken('refresh');

  await assert.rejects(api.reauthenticate(), TokenError);
  await api.reauthenticate();
  assert.equal(calls.refresh, 2);
  assert.equal(calls.login, 0);
});

test('getListDevices: a failed request throws instead of reporting no devices', async () => {
  const { api } = makeApi({ refresh: async () => {}, responses: [new Error('socket hang up')] });
  api.session = new Session('current', 'refresh', 3600);

  await assert.rejects(api.getListDevices(), /home list/);
});

test('getListDevices: lists devices from every home', async () => {
  const { api } = makeApi({
    refresh: async () => {},
    responses: [
      { result: { item: [{ homeId: 'a' }, { homeId: 'b' }] } },
      { result: { devices: [{ deviceId: '1' }] } },
      { result: { devices: [] } },
    ],
  });
  api.session = new Session('current', 'refresh', 3600);

  assert.deepEqual(await api.getListDevices(), [{ deviceId: '1' }]);
});

test('refreshNewToken: a successful refresh is logged at info level with the token lifetime', async () => {
  const { api } = makeApi({ refresh: async () => {}, responses: [] });
  const infos = [];
  api.logger = { ...quietLogger, info: (...args) => infos.push(args.join(' ')) };
  api.setRefreshToken('refresh');

  await api.refreshNewToken();
  assert.deepEqual(infos, ['Refreshed the LG access token (valid for 3600 seconds).']);
});
