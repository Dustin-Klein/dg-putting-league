import { render, screen, waitFor } from '@testing-library/react';
import { AccessCodeForm } from '../access-code-form';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFetch = jest.fn();

describe('AccessCodeForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    sessionStorage.clear();
  });

  it('pre-fills and submits the initial code once on mount', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ mode: 'bracket' }) });

    render(<AccessCodeForm initialCode="ABC123" />);

    expect(screen.getByLabelText('Access code')).toHaveValue('ABC123');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/score/matches'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ access_code: 'ABC123' });
    expect(sessionStorage.getItem('scoring_access_code')).toBe('ABC123');
  });

  it('shows the error when the initial code is rejected', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid access code' }) });

    render(<AccessCodeForm initialCode="NOPE" />);

    expect(await screen.findByText('Invalid access code')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not submit without an initial code', () => {
    render(<AccessCodeForm />);

    expect(screen.getByLabelText('Access code')).toHaveValue('');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
