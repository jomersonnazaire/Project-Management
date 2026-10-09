import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClientDto,
  ClientInput,
  ContactDto,
  ContactInput,
  InviteResultDto,
  Paginated,
  TeamDto,
  UpdateUserInput,
  UserDto,
} from '@xc8/shared';
import { api, qs } from './client';

export const keys = {
  users: (p: object) => ['users', p] as const,
  teams: (includeArchived: boolean) => ['teams', includeArchived] as const,
  clients: (p: object) => ['clients', p] as const,
  contacts: (p: object) => ['contacts', p] as const,
};

// ----- Users -----
export function useUsers(params: { q?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: keys.users(params),
    queryFn: () => api<Paginated<UserDto>>(`/users${qs({ ...params, pageSize: 100 })}`),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api<InviteResultDto>('/users', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserInput }) =>
      api<{ user: UserDto }>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'deactivate' | 'reactivate' }) =>
      api<{ user: UserDto }>(`/users/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useReissueLink() {
  return useMutation({
    mutationFn: (id: string) => api<InviteResultDto>(`/users/${id}/invite`, { method: 'POST' }),
  });
}

// ----- Teams -----
export function useTeams(includeArchived = false) {
  return useQuery({
    queryKey: keys.teams(includeArchived),
    queryFn: () =>
      api<{ items: TeamDto[] }>(`/teams${qs({ includeArchived: includeArchived || undefined })}`),
  });
}

export function useSaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id?: string; name: string }) =>
      id
        ? api<{ team: TeamDto }>(`/teams/${id}`, { method: 'PATCH', body: { name } })
        : api<{ team: TeamDto }>('/teams', { method: 'POST', body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  });
}

export function useArchiveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      api<{ team: TeamDto }>(`/teams/${id}/${archive ? 'archive' : 'unarchive'}`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  });
}

// ----- Clients -----
export function useClients(params: { q?: string; includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: keys.clients(params),
    queryFn: () =>
      api<Paginated<ClientDto>>(
        `/clients${qs({ q: params.q, includeInactive: params.includeInactive || undefined, pageSize: 100 })}`,
      ),
  });
}

export function useSaveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ClientInput }) =>
      id
        ? api<{ client: ClientDto }>(`/clients/${id}`, { method: 'PATCH', body })
        : api<{ client: ClientDto }>('/clients', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useClientActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<{ client: ClientDto }>(`/clients/${id}/${active ? 'reactivate' : 'deactivate'}`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

// ----- Contacts -----
export function useContacts(params: { q?: string; clientId?: string; includeInactive?: boolean }) {
  return useQuery({
    queryKey: keys.contacts(params),
    queryFn: () =>
      api<Paginated<ContactDto>>(
        `/contacts${qs({ q: params.q, clientId: params.clientId, includeInactive: params.includeInactive || undefined, pageSize: 100 })}`,
      ),
  });
}

export function useSaveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, clientId, body }: { id?: string; clientId: string; body: ContactInput }) =>
      id
        ? api<{ contact: ContactDto }>(`/contacts/${id}`, { method: 'PATCH', body })
        : api<{ contact: ContactDto }>(`/clients/${clientId}/contacts`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useContactActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<{ contact: ContactDto }>(`/contacts/${id}/${active ? 'reactivate' : 'deactivate'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}
