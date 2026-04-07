import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppShell } from '../layout/AppShell';
import { AnalysisPage } from '../pages/AnalysisPage';
import { AssetsPage } from '../pages/AssetsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { FundsPage } from '../pages/FundsPage';
import { ImportPage } from '../pages/ImportPage';
import { AssetTrendsPage } from '../pages/AssetTrendsPage';

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
        path: 'funds',
        element: <FundsPage />,
        handle: {
          title: '資金流水',
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
        path: 'trends',
        element: <AssetTrendsPage />,
        handle: {
          title: '資產走勢',
        },
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
