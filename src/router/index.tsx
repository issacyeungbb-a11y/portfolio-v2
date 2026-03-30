import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppShell } from '../layout/AppShell';
import { AnalysisPage } from '../pages/AnalysisPage';
import { AssetsPage } from '../pages/AssetsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ImportPage } from '../pages/ImportPage';
import { SettingsPage } from '../pages/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
        handle: {
          title: '投資總覽',
        },
      },
      {
        path: 'assets',
        element: <AssetsPage />,
        handle: {
          title: '資產管理',
        },
      },
      {
        path: 'import',
        element: <ImportPage />,
        handle: {
          title: '截圖匯入',
        },
      },
      {
        path: 'analysis',
        element: <AnalysisPage />,
        handle: {
          title: 'AI 分析',
        },
      },
      {
        path: 'settings',
        element: <SettingsPage />,
        handle: {
          title: '設定',
        },
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
