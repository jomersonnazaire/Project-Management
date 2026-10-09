import { appEnv, isProductionBuild } from '../lib/appEnv';

/** "Staging" marker for every non-production deploy (NFR-26); nothing at all in production. */
export function EnvBadge({ env = appEnv() }: { env?: string }) {
  if (isProductionBuild(env)) return null;
  return (
    <span
      className="badge bg-label-warning flex-shrink-0"
      title={`This is the ${env} environment, not production.`}
      data-testid="env-badge"
    >
      Staging
    </span>
  );
}
