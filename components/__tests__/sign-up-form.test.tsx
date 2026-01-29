import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from '../sign-up-form';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockSignUp = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signUp: mockSignUp,
    },
  }),
}));

describe('SignUpForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the sign-up form with all fields', () => {
    render(<SignUpForm />);

    // Card title is rendered as a div, check it exists along with button
    const signUpElements = screen.getAllByText('Sign up');
    expect(signUpElements).toHaveLength(2); // Title and button
    expect(screen.getByText('Create a new account')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repeat password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /login/i })).toHaveAttribute('href', '/auth/login');
  });

  it('shows error when passwords do not match', async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/repeat password/i), 'differentpassword');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('shows loading state while submitting', async () => {
    const user = userEvent.setup();
    mockSignUp.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/repeat password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByRole('button', { name: /creating an account/i })).toBeDisabled();
  });

  it('redirects to success page on successful sign-up', async () => {
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ error: null });

    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/repeat password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/auth/sign-up-success');
    });
  });

  it('displays error message on sign-up failure', async () => {
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ error: new Error('Email already in use') });

    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/repeat password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByText(/email already in use/i)).toBeInTheDocument();
  });

  it('calls supabase signUp with correct parameters', async () => {
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ error: null });

    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/repeat password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        options: {
          emailRedirectTo: expect.stringContaining('/leagues'),
        },
      });
    });
  });
});
