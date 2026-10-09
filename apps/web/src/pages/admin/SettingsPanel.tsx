/** Read-only view of the Phase 1 defaults; Admin-editable settings come in a later milestone. */
export function SettingsPanel() {
  const rows: [string, string][] = [
    ['Session idle timeout', '30 minutes (FR-AUTH-03)'],
    ['Account lockout', '15 minutes after 5 consecutive failed sign-ins (FR-AUTH-07)'],
    ['Sign-in rate limit', '20 attempts per IP per 15 minutes (NFR-05)'],
    ['Password policy', '8+ characters, a number and a symbol'],
    ['Delayed threshold', 'Forecast more than 5 days past baseline (FR-PRJ-10)'],
    ['Default working hours per week', '40'],
  ];
  return (
    <div className="card">
      <div className="card-body">
        <h5 className="mb-1">Settings</h5>
        <p className="small text-body-secondary">
          These defaults are set by environment configuration for now. Editing them in the app
          arrives in a later milestone.
        </p>
        <dl className="row mb-0">
          {rows.map(([k, v]) => (
            <div className="col-12 d-flex flex-wrap border-bottom py-2" key={k}>
              <dt className="col-sm-4 fw-medium text-heading">{k}</dt>
              <dd className="col-sm-8 mb-0">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
