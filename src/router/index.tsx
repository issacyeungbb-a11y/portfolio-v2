import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppShell } from '../layout/AppShell';

export const router = createBrowserRouter([
  // Standalone tool route — outside AppShell, no sidebar/topbar/bottomnav
  {
    path: '/system/diagnostics',
    lazy: async () => ({
      Component: (await import('../pages/SystemDiagnosticsPage')).SystemDiagnosticsPage,
    }),
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('../pages/DashboardPage')).DashboardPage,
        }),
        handle: {
          title: '投資總覽',
        },
      },
      {
        path: 'assets',
        lazy: async () => ({
          Component: (await import('../pages/AssetsPage')).AssetsPage,
        }),
        handle: {
          title: '資產管理',
        },
      },
      {
        path: 'import',
        element: <Navigate to="/transactions" replace />,
        handle: {
          title: '截圖匯入',
        },
      },
      {
        path: 'funds',
        lazy: async () => ({
          Component: (await import('../pages/FundsPage')).FundsPage,
        }),
        handle: {
          title: '資金流水',
        },
      },
      {
        path: 'analysis',
        lazy: async () => ({
          Component: (await import('../pages/AnalysisPage')).AnalysisPage,
        }),
        handle: {
          title: '分析與報告',
        },
      },
      {
        path: 'quarterly',
        element: <Navigate to="/analysis" replace />,
        handle: {
          title: '季度報告',
        },
      },
      {
        path: 'trends',
        lazy: async () => ({
          Component: (await import('../pages/AssetTrendsPage')).AssetTrendsPage,
        }),
        handle: {
          title: '資產走勢',
        },
      },
      {
        path: 'transactions',
        lazy: async () => ({
          Component: (await import('../pages/TransactionsPage')).TransactionsPage,
        }),
        handle: {
          title: '交易記錄',
        },
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
