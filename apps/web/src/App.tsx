import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { AppShell } from './layout/AppShell';
import { AccessRulesPage } from './pages/AccessRulesPage';
import { ForbiddenPage, NotFoundPage } from './pages/ErrorPages';
import { LoginPage } from './pages/LoginPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { SetupPasswordPage } from './pages/SetupPasswordPage';
import { AdminPage } from './pages/admin/AdminPage';
import { ClientDetailPage } from './pages/clients/ClientDetailPage';
import { ClientsPage } from './pages/clients/ClientsPage';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** The old Client contacts page moved into each client's Contacts tab (FR-CLI-09). */
function ContactsRedirect() {
  const [params] = useSearchParams();
  const clientId = params.get('clientId');
  return (
    <Navigate
      to={clientId && OBJECT_ID.test(clientId) ? `/clients/${clientId}/contacts` : '/clients'}
      replace
    />
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup-password" element={<SetupPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/my-tasks" replace />} />
            <Route path="/my-tasks" element={<MyTasksPage />} />
            <Route path="/contacts" element={<ContactsRedirect />} />
            <Route
              path="/clients"
              element={
                <RequirePermission any={[['clients', 'view']]}>
                  <ClientsPage />
                </RequirePermission>
              }
            />
            <Route
              path="/clients/:id/*"
              element={
                <RequirePermission any={[['clients', 'view']]}>
                  <ClientDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="/access-rules"
              element={
                <RequirePermission any={[['accessRules', 'view']]}>
                  <AccessRulesPage />
                </RequirePermission>
              }
            />
            <Route
              path="/admin/*"
              element={
                <RequirePermission
                  any={[
                    ['users', 'view'],
                    ['teams', 'view'],
                    ['settings', 'view'],
                  ]}
                >
                  <AdminPage />
                </RequirePermission>
              }
            />
            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
