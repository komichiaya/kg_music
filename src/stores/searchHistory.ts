/**
 * 搜索历史（本地存储，最多 10 条）
 *
 * 与发现页的热搜不同：热搜来自 /search/hot、按会话缓存；历史是本机用户偏好，
 * 写在 localStorage，不随登录态或账号切换清除（搜索行为本身与登录无关）。
 *
 * 只存关键词字符串，不存时间 —— 排序即「最近搜过」，数组首项最新。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'kugou.concept.searchHistory.v1'
/** 历史上限；超出后最旧的被丢弃 */
const LIMIT = 10

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, LIMIT)
  } catch {
    // 坏数据（旧版本、手改）直接当空历史
    return []
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 隐私模式或配额受限：静默失败，不影响搜索本身
  }
}

export const useSearchHistoryStore = defineStore('searchHistory', () => {
  const items = ref<string[]>(read())

  function persist() {
    write(items.value)
  }

  /**
   * 记入一次搜索词。
   *
   * 搜索由标题栏回车 / 点历史热词触发，正常只会记下最终词；但「反查单曲」
   * （点歌手、专辑卡片）与连续多次回车仍可能先后记下「周」「周杰伦」这类前缀关系。
   * 若照单全收，历史会被半成品词占满，因此记入新词时顺带移除「是新词前缀」的旧项，
   * 只保留最终那个更完整的词。
   */
  function add(keyword: string) {
    const next = keyword.trim()
    if (!next) return
    const list = items.value.filter((item) => item !== next && !next.startsWith(item))
    list.unshift(next)
    items.value = list.slice(0, LIMIT)
    persist()
  }

  function remove(keyword: string) {
    items.value = items.value.filter((item) => item !== keyword)
    persist()
  }

  function clear() {
    items.value = []
    persist()
  }

  return { items, add, remove, clear }
})
