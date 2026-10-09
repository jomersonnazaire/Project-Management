export function BrandLogo({ short = false }: { short?: boolean }) {
  return (
    <span className="d-inline-flex align-items-center gap-2">
      <span className="app-brand-logo-box" aria-hidden="true">
        IT
      </span>
      <span className="app-brand-text fw-bold text-heading fs-5">
        {short ? 'Impl. Tracker' : 'Implementation Tracker'}
      </span>
    </span>
  );
}
