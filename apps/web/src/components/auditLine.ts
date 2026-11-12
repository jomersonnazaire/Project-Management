import { deliverableAuditText, type DeliverableAuditChange } from '@xc8/shared';

interface AuditLike {
  action: string;
  changes: { field: string }[];
  deliverables?: DeliverableAuditChange[] | null;
}

const PANEL = /^deliverable(s_migrated|_item_|_items_)/;

/**
 * One audit line after the actor's name (task History, project Activity). CR-23 AC-76.18: an
 * entry with deliverable item changes lists them ("imported the checklist: added “A”; …").
 */
export function auditLine(e: AuditLike, verb: (action: string) => string): string {
  const list = e.deliverables ?? [];
  const fields = [...new Set(e.changes.map((c) => c.field))].filter(
    (f) => !list.length || f !== 'deliverableItems',
  );
  const plain = `${verb(e.action)}${fields.length ? ` (${fields.join(', ')})` : ''}`;
  if (!list.length) return plain;
  if (PANEL.test(e.action)) return deliverableAuditText(list, false);
  const items = deliverableAuditText(list, true);
  // An import that also changed plan fields, or created the task, says so first.
  return e.action === 'task_updated' && !fields.length ? items : `${plain}; ${items}`;
}
