import { CLIENT_IMPORT_STATUS_VALUES } from '@xc8/shared';
import type { Types } from 'mongoose';
import { ClientContactModel, ClientModel } from '../../models/index.js';
import { clientScopeFilter, type ImportContext } from './plan.js';
import type { WorkbookRows } from './workbook.js';

/**
 * Clients export (Jomerson, Nov 3): the clients the user may see and their contact persons, in
 * the template's columns, so an unedited export previews as all No change (round trip).
 *   - Scope: the same fixed scope as the import (ImportContext.scope, FR-ACL-07): Admin and PM
 *     see every client; a Member only the clients of their projects.
 *   - Inactive clients and inactive contacts are included (Status column on Clients).
 *   - Clients sorted by name; contacts by company, then Full Name, then Email.
 * Clients have no soft delete (only active/inactive), so nothing else is excluded.
 */

interface StoredClient {
  _id: Types.ObjectId;
  name: string;
  nameKey: string;
  industry?: string | null;
  address?: string | null;
  notes?: string | null;
  active: boolean;
}
interface StoredContact {
  clientId: Types.ObjectId;
  name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  notes?: string | null;
}

const text = (v: string | null | undefined) => v ?? '';
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const [ACTIVE, INACTIVE] = CLIENT_IMPORT_STATUS_VALUES;

export async function exportRows(ctx: Pick<ImportContext, 'scope'>): Promise<WorkbookRows> {
  const clients = (await ClientModel.find(clientScopeFilter(ctx.scope))
    .select('name nameKey industry address notes active')
    .lean()) as unknown as StoredClient[];
  clients.sort((a, b) => byText(a.nameKey, b.nameKey) || byText(a.name, b.name));
  const byId = new Map(clients.map((c) => [c._id.toString(), c]));

  const contacts = (await ClientContactModel.find({ clientId: { $in: clients.map((c) => c._id) } })
    .select('clientId name position email phone department notes')
    .lean()) as unknown as (StoredContact & { client?: StoredClient })[];
  for (const c of contacts) c.client = byId.get(c.clientId.toString());
  const live = contacts.filter((c) => c.client);
  live.sort(
    (a, b) =>
      byText(a.client!.nameKey, b.client!.nameKey) ||
      byText(a.name.toLowerCase(), b.name.toLowerCase()) ||
      byText(text(a.email), text(b.email)),
  );

  return {
    Clients: clients.map((c) => ({
      company: c.name,
      industry: text(c.industry),
      address: text(c.address),
      notes: text(c.notes),
      status: c.active ? ACTIVE : INACTIVE,
    })),
    Contacts: live.map((c) => ({
      company: c.client!.name,
      name: c.name,
      position: text(c.position),
      email: text(c.email),
      phone: text(c.phone),
      department: text(c.department),
      notes: text(c.notes),
    })),
  };
}
