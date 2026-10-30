import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '../login-form';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockSignInWithPassword = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  }),
}));

describe('LoginForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the login form with all fields', () => {
    render(<LoginForm />);

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/players don't need an account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/auth/forgot-password'
    );
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/auth/sign-up');
  });

  it('shows loading state while submitting', async () => {
    const user = userEvent.setup();
    mockSignInWithPassword.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('button', { name: /signing in/i })).toBeDisabled();
  });

  it('redirects to admin leagues page on successful login', async () => {
    const user = userEvent.setup();
    mockSignInWithPassword.mockResolvedValue({ error: null });

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin/leagues');
    });
  });

  it('displays error message on login failure', async () => {
    const user = userEvent.setup();
    mockSignInWithPassword.mockResolvedValue({
      error: new Error('Invalid login credentials'),
    });

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
  });

  it('calls supabase signInWithPassword with correct parameters', async () => {
    const user = userEvent.setup();
    mockSignInWithPassword.mockResolvedValue({ error: null });

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });

  it('clears error when submitting again', async () => {
    const user = userEvent.setup();
    mockSignInWithPassword
      .mockResolvedValueOnce({ error: new Error('Invalid login credentials') })
      .mockResolvedValueOnce({ error: null });

    render(<LoginForm />);

    // First attempt - failure
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();

    // Second attempt - should clear error during submission
    await user.clear(screen.getByLabelText(/password/i));
    await user.type(screen.getByLabelText(/password/i), 'correctpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/invalid login credentials/i)).not.toBeInTheDocument();
    });
  });
});
