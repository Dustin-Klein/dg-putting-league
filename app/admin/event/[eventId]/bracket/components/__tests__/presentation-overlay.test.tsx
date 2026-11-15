import { render, screen } from '@testing-library/react';
import { PresentationOverlay } from '../presentation-overlay';

const baseProps = {
  stageName: 'Bracket',
  scale: 1,
  isAutoScale: true,
  onToggleAutoScale: jest.fn(),
  onRefresh: jest.fn(),
  onExit: jest.fn(),
  hideFinished: false,
  onToggleHideFinished: jest.fn(),
};

describe('PresentationOverlay', () => {
  it('shows the bracket key without the admin correction hint', () => {
    render(<PresentationOverlay {...baseProps} accessCode="ABC123" />);

    expect(screen.getByText('Playing')).toBeInTheDocument();
    expect(screen.getByText('On deck')).toBeInTheDocument();
    expect(screen.queryByText(/click to correct/i)).not.toBeInTheDocument();
  });

  it('renders a QR code that links to scoring with the access code', () => {
    const { container } = render(<PresentationOverlay {...baseProps} accessCode="AB C1" />);

    expect(screen.getByRole('img', { name: 'Scan to keep score' })).toBeInTheDocument();
    expect(screen.getByText('AB C1')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Scan to keep score"] path')).not.toBeNull();
  });

  it('omits the score panel and QR code without an access code', () => {
    render(<PresentationOverlay {...baseProps} />);

    expect(screen.queryByRole('img', { name: 'Scan to keep score' })).not.toBeInTheDocument();
    expect(screen.queryByText(/submit scores at/i)).not.toBeInTheDocument();
    expect(screen.getByText('Playing')).toBeInTheDocument();
  });
});
