import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE, BRAND, BRAND_ASSETS } from '@xc8/shared';

/**
 * The app's brand (sidebar header, login, invite and reset screens). Names come from
 * packages/shared/src/brand.ts. With the OpsTrack profile it is the Ops Pulse lockup (logo.svg,
 * or logo-white.svg on purple); until then the Ops Pulse mark plus the current name as text.
 */
export function BrandLogo({
  short = false,
  onPurple = false,
}: {
  short?: boolean;
  /** Purple (#5355e0) or dark background: use the white artwork (logo README). */
  onPurple?: boolean;
}) {
  const alt = `${APP_NAME} ${APP_TAGLINE}`;
  if (BRAND.lockup) {
    return (
      <img
        src={onPurple ? BRAND_ASSETS.logoWhite : BRAND_ASSETS.logo}
        alt={alt}
        height={40}
        className="app-brand-lockup"
      />
    );
  }
  return (
    <span className="d-inline-flex align-items-center gap-2">
      <img
        src={onPurple ? BRAND_ASSETS.iconWhite : BRAND_ASSETS.icon}
        alt=""
        aria-hidden="true"
        width={28}
        height={28}
        className="app-brand-mark"
      />
      <span
        className={`app-brand-text fw-bold fs-5 ${onPurple ? 'text-white' : 'text-heading'}`}
        title={alt}
      >
        {short ? APP_SHORT_NAME : APP_NAME}
      </span>
    </span>
  );
}
