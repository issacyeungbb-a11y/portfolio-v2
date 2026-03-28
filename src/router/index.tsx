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
          subtitle: '用手機優先的資訊節奏，先把總覽頁的閱讀與操作感做好。',
        },
      },
      {
        path: 'assets',
        element: <AssetsPage />,
        handle: {
          title: '資產管理',
          subtitle: '展示手動新增、價格更新與持倉瀏覽的主要操作區。',
        },
      },
      {
        path: 'import',
        element: <ImportPage />,
        handle: {
          title: '截圖匯入',
          subtitle: '先定義上傳、AI 抽取與人工確認的整體版面流程。',
        },
      },
      {
        path: 'analysis',
        element: <AnalysisPage />,
        handle: {
          title: 'AI 分析',
          subtitle: '先把提問、分析結果與歷史紀錄的閱讀體驗搭起來。',
        },
      },
      {
        path: 'settings',
        element: <SettingsPage />,
        handle: {
          title: '設定',
          subtitle: '整理匿名身份、偏好設定與資料安全說明。',
        },
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
