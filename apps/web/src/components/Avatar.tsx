import { useState } from 'react';
import { avatarInitials, avatarTone, avatarUrl } from '../lib/avatar';

/** Photo URLs that already failed (404 = no photo), so they aren't asked for again this session. */
const failed = new Set<string>();

/**
 * CR-21: one avatar for the top bar, the Users list and the follow-ups thread. Tries the user's
 * Microsoft profile photo (GET /users/:id/avatar) when `photo` is their avatarUpdatedAt, and
 * falls back to initials on a 404 or an image error, in the same circle so nothing shifts.
 * Decorative: the name is always in nearby text.
 *
 * `photo`: ISO `avatarUpdatedAt` from the API. A string tries the photo (and versions the URL);
 * null or omitted means the API says there is none (initials, no request).
 */
export function Avatar({
  userId,
  name,
  photo,
  size = 32,
  className = '',
}: {
  userId: string | null | undefined;
  name: string | null | undefined;
  photo?: string | null;
  size?: number;
  className?: string;
}) {
  const url = userId && photo ? avatarUrl(userId, photo) : null;
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = url !== null && broken !== url && !failed.has(url);
  return (
    <span
      className={`app-avatar ${showPhoto ? 'app-avatar-photo' : `bg-label-${avatarTone(name)}`} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.375) }}
      aria-hidden="true"
      data-testid="avatar"
    >
      {showPhoto ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => {
            failed.add(url);
            setBroken(url);
          }}
        />
      ) : (
        avatarInitials(name)
      )}
    </span>
  );
}
