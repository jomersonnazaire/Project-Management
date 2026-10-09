import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequireRole } from './auth/guards';
import { AppShell } from './layout/AppShell';
import { ContactsPage } from './pages/ContactsPage';
import { ForbiddenPage, NotFoundPage } from './pages/ErrorPages';
import { LoginPage } from './pages/LoginPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { SetupPasswordPage } from './pages/SetupPasswordPage';
import { AdminPage } from './pages/admin/AdminPage';

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
            <Route path="/contacts" element={<ContactsPage />} />
            <Route
              path="/admin/*"
              element={
                <RequireRole roles={['ADMIN']}>
                  <AdminPage />
                </RequireRole>
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
