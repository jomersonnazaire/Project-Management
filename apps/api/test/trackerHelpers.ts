import { LookupModel } from '../src/models/index.js';
import { ensureDefaultLookups } from '../src/services/tracker.js';

/** Ids of seeded list values by name (doc 14 §10 defaults). */
export async function lookups() {
  await ensureDefaultLookups();
  const docs = await LookupModel.find().lean();
  const by = (kind: string, name: string) =>
    docs.find((d) => d.kind === kind && d.name === name)!._id.toString();
  return {
    integration: by('ACTIVITY_TYPE', 'Integration'),
    configuration: by('ACTIVITY_TYPE', 'Configuration'),
    internalMeeting: by('ACTIVITY_TYPE', 'Internal meeting'),
    financials: by('MODULE', 'Financials'),
    inventory: by('MODULE', 'Inventory'),
    onsite: by('LOCATION', 'Onsite'),
    wfh: by('LOCATION', 'WFH'),
    office: by('LOCATION', 'Office'),
  };
}

/** The fields Log time now needs on every entry (FR-ACT-15, FR-DAR-09). */
export async function entryFields() {
  const l = await lookups();
  return { activityTypeId: l.configuration, moduleId: l.financials };
}
