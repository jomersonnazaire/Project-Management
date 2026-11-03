import {
  CLIENT_IMPORT_COLUMNS,
  CLIENT_IMPORT_REASONS as R,
  emailSchema,
  type ClientImportCountsDto,
  type ClientImportResult,
  type ClientImportRowDto,
  type ClientImportSheet,
} from '@xc8/shared';
import { Types, type ClientSession } from 'mongoose';
import { ClientContactModel, ClientModel } from '../../models/index.js';
import type { ParsedWorkbook, RowValues, SheetRow } from './workbook.js';

/**
 * CR-19 validation and matching (§5, §6). The same function runs for the preview and, again,
 * inside the commit's transaction, where the result must equal the signed preview (FR-CLI-35b).
 * Matching uses one lookup per sheet (NFR-40), never one query per row.
 */

export interface ImportContext {
  /** `clients.delete`: needed to change Status on an existing client (FR-CLI-41). */
  canChangeStatus: boolean;
  /** Fixed scope (FR-ACL-07): client ids the caller may see, or null for all. */
  scope: Set<string> | null;
  session?: ClientSession;
}

type Change = { field: string; old: unknown; new: unknown };

interface ExistingClient {
  _id: Types.ObjectId;
  name: string;
  nameKey: string;
  industry?: string | null;
  address?: string | null;
  notes?: string | null;
  active: boolean;
  updatedAt?: Date;
  __v?: number;
}
interface ExistingContact {
  _id: Types.ObjectId;
  clientId: Types.ObjectId;
  name: string;
  email?: string | null;
  position?: string | null;
  phone?: string | null;
  department?: string | null;
  notes?: string | null;
  active: boolean;
  updatedAt?: Date;
  __v?: number;
}

interface Planned {
  sheet: ClientImportSheet;
  row: number;
  values: RowValues;
  reasons: string[];
  warnings: string[];
  result: ClientImportResult;
  inactive?: boolean;
  changes: Change[];
}

export interface PlannedClient extends Planned {
  key: string;
  existing?: ExistingClient;
  /** New client document, or the `$set` for an update. */
  doc?: Record<string, unknown>;
  set?: Record<string, unknown>;
  /** Status change on an existing client (written as client_(de|re)activated). */
  activeChange?: { old: boolean; new: boolean };
  /** Pre-assigned id of a new client, so new contacts in the same file can link to it. */
  newId?: Types.ObjectId;
}

export interface PlannedContact extends Planned {
  existing?: ExistingContact;
  /** The client: an existing id, or the planned new client from the Clients sheet. */
  clientId?: Types.ObjectId;
  doc?: Record<string, unknown>;
  set?: Record<string, unknown>;
  newId?: Types.ObjectId;
}

export interface ImportPlan {
  clients: PlannedClient[];
  contacts: PlannedContact[];
}

/** FR-ACL-07: true when the fixed scope lets the caller see this client (null scope = all). */
export const inScopeOf = (scope: ImportContext['scope']) => (id: Types.ObjectId) =>
  !scope || scope.has(id.toString());

/** The same scope as a clients query filter (used by the clients export). */
export const clientScopeFilter = (scope: ImportContext['scope']) =>
  scope ? { _id: { $in: [...scope].map((id) => new Types.ObjectId(id)) } } : {};

const keyOf = (s: string) => s.toLowerCase(); // values are already trimmed (FR-CLI-29)
const label = (active: boolean) => (active ? 'Active' : 'Inactive');

const CLIENT_FIELDS = ['industry', 'address', 'notes'] as const;
const CONTACT_FIELDS = ['position', 'phone', 'department', 'notes'] as const;

function lengthReasons(sheet: ClientImportSheet, values: RowValues): string[] {
  return CLIENT_IMPORT_COLUMNS[sheet]
    .filter((c) => c.field !== 'email' && c.field !== 'status' && values[c.field].length > c.max)
    .map((c) => R.tooLong(c.header, c.max));
}

function markDuplicates<T extends Planned>(items: { item: T; key: string }[]) {
  const groups = new Map<string, T[]>();
  for (const { item, key } of items) groups.set(key, [...(groups.get(key) ?? []), item]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const reason = R.duplicate(group.map((g) => g.row));
    for (const g of group) g.reasons.push(reason);
  }
}

/** Filled cells that differ from the stored value (blank keeps the current value, FR-CLI-31). */
function diff(
  values: Record<string, string>,
  stored: Record<string, unknown>,
  fields: readonly string[],
): { set: Record<string, unknown>; changes: Change[] } {
  const set: Record<string, unknown> = {};
  const changes: Change[] = [];
  for (const f of fields) {
    const v = values[f];
    if (!v) continue;
    const old = (stored[f] as string | null | undefined) ?? null;
    if (v !== old) {
      set[f] = v;
      changes.push({ field: f, old, new: v });
    }
  }
  return { set, changes };
}

function finish(p: Planned, changed: boolean) {
  p.result = p.reasons.length ? 'ERROR' : changed ? 'UPDATE' : 'NO_CHANGE';
}

export async function planImport(file: ParsedWorkbook, ctx: ImportContext): Promise<ImportPlan> {
  const inScope = inScopeOf(ctx.scope);

  // ----- one lookup for every company name in the file -----
  const keys = [
    ...new Set(
      [...file.Clients, ...file.Contacts]
        .map((r) => r.values.company)
        .filter(Boolean)
        .map(keyOf),
    ),
  ];
  const existingClients = (await ClientModel.find({ nameKey: { $in: keys } })
    .session(ctx.session ?? null)
    .lean()) as unknown as ExistingClient[];
  const byKey = new Map(existingClients.map((c) => [c.nameKey, c]));

  // ----- Clients sheet -----
  const clients: PlannedClient[] = file.Clients.map(({ row, values }) => {
    const p: PlannedClient = {
      sheet: 'Clients',
      row,
      values,
      reasons: [],
      warnings: [],
      result: 'NEW',
      changes: [],
      key: keyOf(values.company),
    };
    if (!values.company) p.reasons.push(R.companyBlank);
    p.reasons.push(...lengthReasons('Clients', values));
    const status = values.status.toLowerCase();
    if (status && status !== 'active' && status !== 'inactive') p.reasons.push(R.statusInvalid);
    return p;
  });
  markDuplicates(clients.filter((c) => c.values.company).map((item) => ({ item, key: item.key })));

  for (const p of clients) {
    if (p.reasons.length) {
      p.result = 'ERROR';
      continue;
    }
    const status = p.values.status.toLowerCase();
    const existing = byKey.get(p.key);
    if (existing && !inScope(existing._id)) {
      // EC-154: never say the client exists.
      p.reasons.push(R.companyOutOfScope);
      p.result = 'ERROR';
      continue;
    }
    if (!existing) {
      p.result = 'NEW';
      p.newId = new Types.ObjectId();
      p.doc = {
        _id: p.newId,
        name: p.values.company,
        nameKey: p.key,
        industry: p.values.industry || null,
        address: p.values.address || null,
        notes: p.values.notes || null,
        // Blank = Active (model default); a new client may be Inactive without clients.delete.
        active: status !== 'inactive',
      };
      p.changes = CLIENT_IMPORT_COLUMNS.Clients.filter((c) => p.values[c.field]).map((c) => ({
        field: c.field === 'company' ? 'name' : c.field === 'status' ? 'active' : c.field,
        old: null,
        new: c.field === 'status' ? status !== 'inactive' : p.values[c.field],
      }));
      continue;
    }
    p.existing = existing;
    p.inactive = !existing.active;
    const { set, changes } = diff(p.values, existing as never, CLIENT_FIELDS);
    if (status) {
      const active = status === 'active';
      if (active !== existing.active) {
        // FR-CLI-41 (Q-110): a Status change is Deactivate / Reactivate and needs clients.delete;
        // without it the WHOLE row is an Error and nothing in it is saved. Q-107 is still open:
        // like POST /clients/:id/deactivate today, no open-project check runs.
        if (!ctx.canChangeStatus) p.reasons.push(R.statusPermission(label(existing.active)));
        else p.activeChange = { old: existing.active, new: active };
      }
    }
    p.set = set;
    p.changes = changes;
    finish(p, changes.length > 0 || !!p.activeChange);
  }

  // ----- Contacts sheet -----
  const fileClients = new Map<string, PlannedClient[]>();
  for (const c of clients) {
    if (c.values.company) fileClients.set(c.key, [...(fileClients.get(c.key) ?? []), c]);
  }

  const contacts: (PlannedContact & { email: string | null; clientKey: string })[] =
    file.Contacts.map(({ row, values }: SheetRow) => {
      const p: PlannedContact & { email: string | null; clientKey: string } = {
        sheet: 'Contacts',
        row,
        values,
        reasons: [],
        warnings: [],
        result: 'NEW',
        changes: [],
        email: null,
        clientKey: keyOf(values.company),
      };
      if (!values.company) p.reasons.push(R.companyBlank);
      if (!values.email && !values.name) p.reasons.push(R.fullNameBlank);
      p.reasons.push(...lengthReasons('Contacts', values));
      if (values.email) {
        const parsed = emailSchema.safeParse(values.email);
        if (parsed.success) p.email = parsed.data;
        else p.reasons.push(R.emailInvalid);
      }
      if (!values.company) return p;
      // Resolve the contact's client (FR-CLI-34a, EC-141, EC-154).
      const existing = byKey.get(p.clientKey);
      const inFile = fileClients.get(p.clientKey);
      const valid = inFile?.length === 1 && inFile[0]!.result !== 'ERROR' ? inFile[0] : undefined;
      if (existing && !inScope(existing._id)) p.reasons.push(R.companyOutOfScope);
      else if (valid) p.clientId = valid.existing?._id ?? valid.newId;
      else if (existing) p.clientId = existing._id;
      else if (inFile) p.reasons.push(R.clientRowError(inFile[0]!.row));
      else p.reasons.push(R.companyNotFound(values.company));
      return p;
    });

  // FR-CLI-33: the same contact key twice under one client in the file: every copy is an Error.
  markDuplicates(
    contacts
      .filter((c) => c.values.company && (c.email || (!c.values.email && c.values.name)))
      .map((item) => ({
        item,
        key: `${item.clientKey}\u0000${item.email ? `e:${item.email}` : `n:${keyOf(item.values.name)}`}`,
      })),
  );

  const existingIds = [
    ...new Set(
      contacts
        .filter((c) => c.clientId && byKey.has(c.clientKey))
        .map((c) => c.clientId!.toString()),
    ),
  ];
  const stored = (await ClientContactModel.find({ clientId: { $in: existingIds } })
    .session(ctx.session ?? null)
    .lean()) as unknown as ExistingContact[];
  const byClient = new Map<string, ExistingContact[]>();
  for (const c of stored) {
    const k = c.clientId.toString();
    byClient.set(k, [...(byClient.get(k) ?? []), c]);
  }

  for (const p of contacts) {
    if (p.reasons.length) {
      p.result = 'ERROR';
      continue;
    }
    const nameKey = keyOf(p.values.name);
    const pool = byClient.get(p.clientId!.toString()) ?? [];
    // FR-CLI-30: Email within the client; with no Email, Full name among no-email contacts.
    const matches = p.email
      ? pool.filter((c) => c.email === p.email)
      : pool.filter((c) => !c.email && keyOf(c.name.trim()) === nameKey);
    if (matches.length > 1) {
      p.reasons.push(R.ambiguous(byKey.get(p.clientKey)?.name ?? p.values.company));
      p.result = 'ERROR';
      continue;
    }
    const match = matches[0];
    if (!match) {
      if (!p.values.name) {
        p.reasons.push(R.fullNameBlank);
        p.result = 'ERROR';
        continue;
      }
      // Q-113: an Email row never matches a no-email contact, but says it may be a duplicate.
      const twin =
        p.email && pool.find((c) => !c.email && keyOf(c.name.trim()) === nameKey && nameKey);
      if (twin) p.warnings.push(R.possibleDuplicate(twin.name));
      p.result = 'NEW';
      p.newId = new Types.ObjectId();
      p.doc = {
        _id: p.newId,
        clientId: p.clientId,
        name: p.values.name,
        email: p.email,
        position: p.values.position || null,
        phone: p.values.phone || null,
        department: p.values.department || null,
        notes: p.values.notes || null,
        active: true, // A-35
      };
      p.changes = CLIENT_IMPORT_COLUMNS.Contacts.filter(
        (c) => c.field !== 'company' && p.values[c.field],
      ).map((c) => ({
        field: c.field,
        old: null,
        new: c.field === 'email' ? p.email : p.values[c.field],
      }));
      continue;
    }
    p.existing = match;
    p.inactive = !match.active;
    // The match key isn't rewritten (no rename by case); Full name updates only on an email match.
    const fields = p.email ? (['name', ...CONTACT_FIELDS] as const) : CONTACT_FIELDS;
    const { set, changes } = diff(p.values, match as never, fields);
    p.set = set;
    p.changes = changes;
    finish(p, changes.length > 0);
  }

  return {
    clients,
    contacts: contacts.map(({ email: _e, clientKey: _k, ...rest }) => rest),
  };
}

// ----- DTOs -----

export function rowDto(p: Planned): ClientImportRowDto {
  const values: Record<string, string> = {};
  for (const c of CLIENT_IMPORT_COLUMNS[p.sheet]) values[c.header] = p.values[c.field];
  return {
    sheet: p.sheet,
    row: p.row,
    result: p.result,
    ...(p.inactive && p.result === 'UPDATE' ? { inactive: true } : {}),
    reasons: p.reasons,
    warnings: p.warnings,
    values,
  };
}

export function countsOf(rows: Planned[]): ClientImportCountsDto {
  return {
    new: rows.filter((r) => r.result === 'NEW').length,
    update: rows.filter((r) => r.result === 'UPDATE').length,
    noChange: rows.filter((r) => r.result === 'NO_CHANGE').length,
    error: rows.filter((r) => r.result === 'ERROR').length,
  };
}

export function sumCounts(a: ClientImportCountsDto, b: ClientImportCountsDto) {
  return {
    new: a.new + b.new,
    update: a.update + b.update,
    noChange: a.noChange + b.noChange,
    error: a.error + b.error,
  };
}
