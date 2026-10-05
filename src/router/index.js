import { defineRouter } from '#q-app'
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router'

import routes from './routes.js'
import { pendingSetupRoute } from '@/utils/setup'

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default defineRouter((/* { store, ssrContext } */) => {
  const createHistory = import.meta.env.QUASAR_SERVER
    ? createMemoryHistory
    : (import.meta.env.QUASAR_VUE_ROUTER_MODE === 'history' ? createWebHistory : createWebHashHistory)

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE)
  })

  // Só na abertura do app: com Empresa/Contador vazios, começa por essas
  // telas. Depois disso a navegação é livre (dá pra sair pelo menu).
  let setupChecked = false
  Router.beforeEach(async (to) => {
    if (setupChecked) return true
    setupChecked = true
    try {
      const pending = await pendingSetupRoute()
      if (pending && !(to.path === pending && to.query.setup)) {
        return { path: pending, query: { setup: '1' } }
      }
    } catch (err) {
      console.error('Falha ao verificar a configuração inicial:', err)
    }
    return true
  })

  return Router
})
