const routes = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('@/pages/IndexPage.vue') },
      { path: 'settings/connections', component: () => import('@/pages/settings/ConnectionsPage.vue') },
      { path: 'settings/sql', component: () => import('@/pages/settings/SqlEditorPage.vue') },
      { path: 'settings/export', component: () => import('@/pages/settings/ExportSettingsPage.vue') },
      { path: 'settings/accountant', component: () => import('@/pages/settings/AccountantPage.vue') },
      { path: 'company', component: () => import('@/pages/settings/CompanyPage.vue') }
    ],
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('@/pages/ErrorNotFound.vue'),
  }
]

export default routes
