import { getOriginMismatchReason, requiresCsrfCheck } from '../same-origin';

function req(headers: Record<string, string>): Request {
  return new Request('http://example.com/api/x', { method: 'POST', headers });
}

describe('getOriginMismatchReason', () => {
  it('accepts a same-origin request', () => {
    expect(getOriginMismatchReason(req({ origin: 'https://app.test', host: 'app.test' }))).toBeNull();
  });

  it('rejects a cross-origin request', () => {
    expect(getOriginMismatchReason(req({ origin: 'https://evil.test', host: 'app.test' }))).toBe(
      'Origin mismatch'
    );
  });

  it('rejects a request without an Origin header', () => {
    expect(getOriginMismatchReason(req({ host: 'app.test' }))).toBe('Missing origin header');
  });

  it('rejects a malformed Origin header', () => {
    expect(getOriginMismatchReason(req({ origin: 'not a url', host: 'app.test' }))).toBe(
      'Invalid origin header'
    );
  });
});

describe('requiresCsrfCheck', () => {
  it('checks state-changing API requests', () => {
    expect(requiresCsrfCheck('POST', '/api/score')).toBe(true);
    expect(requiresCsrfCheck('put', '/api/score/match/1/batch')).toBe(true);
    expect(requiresCsrfCheck('DELETE', '/api')).toBe(true);
  });

  it('skips safe methods and non-API paths', () => {
    expect(requiresCsrfCheck('GET', '/api/score')).toBe(false);
    expect(requiresCsrfCheck('OPTIONS', '/api/score')).toBe(false);
    expect(requiresCsrfCheck('POST', '/auth/login')).toBe(false);
    expect(requiresCsrfCheck('POST', '/apiary')).toBe(false);
  });
});
