import { NextRequest } from 'next/server';
import { updateSession } from '../proxy';
import { REQUEST_ID_HEADER } from '@/lib/utils/request-id';

describe('updateSession request id', () => {
  it('assigns a fresh request id to the request and the response', async () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { [REQUEST_ID_HEADER]: 'client-chosen' },
    });

    const response = await updateSession(request);
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
  });

  it('sets the request id on CSRF rejections too', async () => {
    const request = new NextRequest('http://localhost:3000/api/event', {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'localhost:3000' },
    });

    const response = await updateSession(request);

    expect(response.status).toBe(403);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });
});
