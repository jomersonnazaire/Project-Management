import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATION_POLL_MS,
  type CalendarDto,
  type DocumentDto,
  type DocumentListDto,
  type DocumentRequestListDto,
  type RequestPartiesDto,
  type FolderDto,
  type HolidayDto,
  type HolidayImpactDto,
  type HolidayInput,
  type LoggableTaskDto,
  type MessageListDto,
  type MessageDto,
  type NotificationListDto,
  type PostMessageInput,
  type TaskDto,
  type TimeEntryDto,
  type TimeEntryInput,
  type TimeWeekDto,
  type TimeType,
  type UploadTicketDto,
} from '@xc8/shared';
import { ApiError, api, qs } from './client';

/** Data hooks for Milestone 3: calendar, time, documents, evidence, notifications, conversation. */

// ----- Calendar (Admin › Holidays) -----
export function useCalendar(year: number) {
  return useQuery({
    queryKey: ['calendar', year],
    queryFn: () => api<CalendarDto>(`/settings/calendar${qs({ year })}`),
  });
}

export function useHolidayImpact(date: string | null) {
  return useQuery({
    queryKey: ['calendar', 'impact', date],
    queryFn: () => api<HolidayImpactDto>(`/settings/holidays/impact${qs({ date })}`),
    enabled: Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date)),
  });
}

export function useCalendarMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      path: string;
      method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
    }) =>
      api<{ holiday?: HolidayDto; copied?: number; added?: number; skipped?: number }>(
        `/settings${req.path}`,
        {
          method: req.method ?? 'POST',
          body: req.body,
        },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

export type HolidayBody = HolidayInput;

// ----- Time logging -----
export function useTimeWeek(week?: string) {
  return useQuery({
    queryKey: ['time', 'week', week ?? ''],
    queryFn: () => api<TimeWeekDto>(`/time${qs({ week })}`),
  });
}

export function useTimeOptions(enabled = true) {
  return useQuery({
    queryKey: ['time', 'options'],
    queryFn: () => api<{ items: LoggableTaskDto[] }>('/time/options').then((r) => r.items),
    enabled,
  });
}

export interface ProjectTimeDto {
  items: TimeEntryDto[];
  total: number;
  byType: Record<TimeType, number>;
  scope: 'ALL' | 'OWN';
}

export function useProjectTime(projectId: string) {
  return useQuery({
    queryKey: ['time', 'project', projectId],
    queryFn: () => api<ProjectTimeDto>(`/projects/${projectId}/time`),
  });
}

export function useTimeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      id?: string;
      method?: 'POST' | 'PATCH' | 'DELETE';
      body?: Partial<TimeEntryInput>;
    }) =>
      api<{ entry?: TimeEntryDto }>(req.id ? `/time/${req.id}` : '/time', {
        method: req.method ?? 'POST',
        body: req.body,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['time'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// ----- Uploads (evidence and documents) -----
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * PUTs a file straight to its short-lived upload link with progress. In production the link
 * points at Azure Blob Storage; in development it's the API's in-memory stand-in.
 */
export function putFile(
  ticket: UploadTicketDto,
  file: Blob,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const local = ticket.uploadUrl.startsWith('/');
    xhr.open('PUT', local ? `${API_ORIGIN}${ticket.uploadUrl}` : ticket.uploadUrl);
    if (local) {
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'xc8-web');
    }
    for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, 'UPLOAD_FAILED', `Upload failed (${xhr.status}).`));
    xhr.onerror = () =>
      reject(new ApiError(0, 'NETWORK_ERROR', "Can't reach the file store. Try again."));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export const completeUpload = <T>(id: string) =>
  api<T>(`/uploads/${id}/complete`, { method: 'POST' });

export const fileMeta = (f: File) => ({
  name: f.name,
  size: f.size,
  ...(f.type ? { contentType: f.type } : {}),
});

/** Opens a short-lived, permission-checked download link (FR-DOC-41, FR-EVD-04). */
export async function openDownload(path: string) {
  const { url } = await api<{ url: string }>(path);
  window.location.assign(url);
}

export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['documents'] });
  };
}

export const evidenceTickets = (taskId: string, files: File[]) =>
  api<{ uploads: UploadTicketDto[] }>(`/tasks/${taskId}/evidence/uploads`, {
    method: 'POST',
    body: { files: files.map(fileMeta) },
  });

export type EvidenceComplete = { task: TaskDto };

// ----- Documents -----
export function useFolders(projectId: string) {
  return useQuery({
    queryKey: ['documents', 'folders', projectId],
    queryFn: () =>
      api<{
        items: FolderDto[];
        can: { createFolder: boolean; renameDefault: boolean; restrict?: boolean };
      }>(`/projects/${projectId}/folders`),
  });
}

export function useDocuments(
  projectId: string,
  params: { folderId?: string; q?: string; status?: string; archived?: string },
) {
  return useQuery({
    queryKey: ['documents', 'list', projectId, params],
    queryFn: () => api<DocumentListDto>(`/projects/${projectId}/documents${qs(params)}`),
  });
}

export function useDocumentMutation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      path: string;
      method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
    }) =>
      api<{ document?: DocumentDto; folder?: { id: string; name: string } }>(
        `/projects/${projectId}${req.path}`,
        { method: req.method ?? 'POST', body: req.body },
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['document-requests'] });
    },
  });
}

/** AC-26.2: project members and active contacts of the project's client. */
export function useRequestParties(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ['documents', 'parties', projectId],
    queryFn: () => api<RequestPartiesDto>(`/projects/${projectId}/request-parties`),
    enabled,
  });
}

/** FR-DOC-26: open requests from client contacts (Dashboard) or from me (My tasks). */
export function useDocumentRequests(kind: 'waiting-on-client' | 'mine', enabled = true) {
  return useQuery({
    queryKey: ['document-requests', kind],
    queryFn: () => api<DocumentRequestListDto>(`/document-requests/${kind}`),
    enabled,
  });
}

// ----- Notifications -----
export function useNotifications(open: boolean) {
  return useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api<NotificationListDto>('/notifications'),
    enabled: open,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ unread: number }>('/notifications/unread-count').then((r) => r.unread),
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      api<{ unread: number }>(
        id === 'all' ? '/notifications/read-all' : `/notifications/${id}/read`,
        {
          method: 'POST',
        },
      ),
    onSuccess: (r) => qc.setQueryData(['notifications', 'unread'], r.unread),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ----- Conversation -----
export function useMessages(
  projectId: string,
  params: { type?: string; taskId?: string; q?: string },
) {
  return useQuery({
    queryKey: ['messages', projectId, params],
    queryFn: () => api<MessageListDto>(`/projects/${projectId}/messages${qs(params)}`),
  });
}

export function usePostMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PostMessageInput) =>
      api<{ message: MessageDto }>(`/projects/${projectId}/messages`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', projectId] }),
  });
}

export function useHideMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<{ message: MessageDto }>(`/projects/${projectId}/messages/${id}/hide`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', projectId] }),
  });
}
