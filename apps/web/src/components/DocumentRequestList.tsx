import { partyLabel, requestDueLabel, type DocumentRequestRowDto } from '@xc8/shared';
import { Link } from 'react-router-dom';

const pill = (r: DocumentRequestRowDto) =>
  r.overdue ? 'bg-label-danger' : r.daysOverdue >= -1 ? 'bg-label-warning' : 'bg-label-secondary';

const requestLink = (r: DocumentRequestRowDto) =>
  `/projects/${r.project.id}/documents?folder=${r.folder.id}&doc=${r.id}`;

/**
 * Open document requests (FR-DOC-26): the Dashboard "Waiting on client" list and My tasks
 * "Documents requested from you". Overdue first with "6d overdue", then "Due tomorrow"/"Due Oct 15".
 */
export function DocumentRequestList({
  items,
  showContact,
}: {
  items: DocumentRequestRowDto[];
  showContact: boolean;
}) {
  return (
    <div className="table-responsive">
      <table className="table table-stack-md mb-0">
        <thead>
          <tr>
            <th scope="col">Document</th>
            {showContact && <th scope="col">Contact</th>}
            <th scope="col">Project</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td className="cell-primary">
                <Link to={requestLink(r)} className="text-heading fw-medium">
                  {r.name}
                </Link>
              </td>
              {showContact && <td data-label="Contact">{partyLabel(r.requestedFrom)}</td>}
              <td data-label="Project">
                <Link to={`/projects/${r.project.id}`}>{r.project.name}</Link>
              </td>
              <td data-label="Due">
                <span className={`badge ${pill(r)}`}>
                  {requestDueLabel(r.daysOverdue, r.dueDate)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
