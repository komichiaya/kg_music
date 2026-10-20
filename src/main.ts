import { createApp } from 'vue'
import { createPinia } from 'pinia'
// Element Plus 暗色变量必须早于自定义样式加载，自定义令牌才能覆盖它
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@/styles/index.css'
import App from './App.vue'
import router from './router'
import { getBridge } from '@/bridge'
import { setApiBase } from '@/api/request'
import { useSettingsStore } from '@/stores/settings'

/**
 * 启动流程：
 * 1. 安装 Pinia（路由守卫依赖 store，必须先于 router 安装）
 * 2. 从 Main 取 apiBase 注入请求层（上游端口可能被环境变量改写）
 * 3. 先应用主题再挂载，避免首屏闪白
 */
async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  const bridge = getBridge()
  if (bridge) {
    try {
      const info = await bridge.app.info()
      setApiBase(info.apiBase)
      document.documentElement.dataset.platform = info.platform
    } catch (error) {
      console.warn('[bootstrap] 获取应用信息失败，使用默认 API 地址', error)
    }
  }

  useSettingsStore(pinia).applyTheme()
  app.mount('#app')
}

void bootstrap()
