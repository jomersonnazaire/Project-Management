import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../components/Avatar';

/** CR-21 shared avatar: photo when the API has one, initials on 404 / error / no photo. */
describe('Avatar (CR-21)', () => {
  it('shows initials when there is no stored photo, without requesting an image', () => {
    const { container } = render(<Avatar userId="u2" name="Rita R." photo={null} />);
    expect(screen.getByTestId('avatar')).toHaveTextContent('RR');
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the photo URL versioned by avatarUpdatedAt', () => {
    const { container } = render(
      <Avatar userId="u2" name="Maria Member" photo="2026-11-05T08:00:00.000Z" />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/v1/users/u2/avatar?v=2026-11-05T08%3A00%3A00.000Z');
    expect(img).toHaveAttribute('alt', '');
  });

  it('falls back to initials when the image errors (404)', () => {
    const { container } = render(
      <Avatar userId="u2" name="Maria Member" photo="2026-11-05T08:00:00.000Z" />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByTestId('avatar')).toHaveTextContent('MM');
    expect(container.querySelector('img')).toBeNull();
  });
});
