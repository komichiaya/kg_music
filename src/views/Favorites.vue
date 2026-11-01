<script setup lang="ts">
/**
 * 我的收藏
 *
 * 两段内容：
 * - 关注的歌手：`/user/follow` 的列表（follow store 缓存，歌手页关注后立即同步）
 * - 收藏的歌单：`/user/playlist` 里 `mine === false` 的条目
 *   （酷狗把「收藏别人的歌单」直接混在账号歌单列表里，用 creator 区分，
 *    没有单独的收藏接口，所以这里复用 library store 的同一份数据）
 *
 * 入口在个人中心；侧栏不放，避免导航层级过深。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageShell from '@/components/common/PageShell.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useFollowStore } from '@/stores/follow'
import { useLibraryStore } from '@/stores/library'

const router = useRouter()
const auth = useAuthStore()
const follow = useFollowStore()
const library = useLibraryStore()

/** 只在首次进入时自动展开骨架，手动刷新不闪 */
const refreshing = ref(false)

/** 收藏的别人创建的歌单；自建的归「我的音乐」，这里不重复展示 */
const favoritePlaylists = computed(() => library.playlists.filter((item) => !item.mine))

const artistCount = computed(() => follow.artists.length)
const playlistCount = computed(() => favoritePlaylists.value.length)

async function reload() {
  if (!auth.userId) return
  refreshing.value = true
  try {
    await Promise.all([follow.load(auth.userId, true), library.loadPlaylists(auth.userId, true)])
  } finally {
    refreshing.value = false
  }
}

function openArtist(id: string) {
  void router.push({ name: 'artist', params: { id } })
}

function openPlaylist(id: string) {
  void router.push({ name: 'playlist', params: { id } })
}

onMounted(() => {
  if (!auth.userId) return
  void follow.load(auth.userId)
  void library.loadPlaylists(auth.userId)
})

// 冷启动时 userId 要等凭证补水完成才有，补一次懒加载
watch(
  () => auth.userId,
  (userid) => {
    if (!userid) return
    void follow.load(userid)
    void library.loadPlaylists(userid)
  }
)
</script>

<template>
  <PageShell eyebrow="Favorites" title="我的收藏" subtitle="关注的歌手与他人创建的歌单。">
    <template #actions>
      <button class="ghost-button" type="button" :disabled="refreshing" @click="reload">
        <AppIcon name="refresh" :size="14" />
        {{ refreshing ? '刷新中…' : '刷新' }}
      </button>
    </template>

    <!-- 关注的歌手 -->
    <section class="block">
      <header class="block__head">
        <h3 class="block__title">
          <AppIcon name="user" :size="15" />
          关注的歌手
        </h3>
        <span class="block__count tabular">{{ artistCount }} 位</span>
      </header>

      <p v-if="follow.error" class="error">{{ follow.error }}</p>

      <div v-if="follow.loading && artistCount === 0" class="artists">
        <div v-for="index in 8" :key="index" class="artist panel">
          <span class="skeleton artist__avatar" />
          <span class="skeleton artist__line" />
        </div>
      </div>

      <div v-else-if="artistCount > 0" class="artists">
        <button
          v-for="artist in follow.artists"
          :key="artist.id"
          class="artist panel panel--interactive"
          type="button"
          @click="openArtist(artist.id)"
        >
          <span class="artist__avatar">
            <img
              v-if="artist.avatar"
              :src="artist.avatar"
              alt=""
              referrerpolicy="no-referrer"
            />
            <AppIcon v-else name="user" :size="26" />
          </span>
          <span class="artist__name">{{ artist.name }}</span>
        </button>
      </div>

      <div v-else class="panel">
        <EmptyState
          compact
          icon="user"
          title="还没有关注的歌手"
          description="在歌手页点「关注」，他们就会出现在这里。"
        />
      </div>
    </section>

    <!-- 收藏的歌单 -->
    <section class="block">
      <header class="block__head">
        <h3 class="block__title">
          <AppIcon name="disc" :size="15" />
          收藏的歌单
        </h3>
        <span class="block__count tabular">{{ playlistCount }} 个</span>
      </header>

      <p v-if="library.playlistError" class="error">{{ library.playlistError }}</p>

      <div v-if="library.loadingPlaylists && playlistCount === 0" class="playlists">
        <div v-for="index in 6" :key="index" class="playlist panel">
          <span class="skeleton playlist__cover" />
          <span class="skeleton playlist__line" />
        </div>
      </div>

      <div v-else-if="playlistCount > 0" class="playlists">
        <button
          v-for="playlist in favoritePlaylists"
          :key="playlist.id"
          class="playlist panel panel--interactive"
          type="button"
          @click="openPlaylist(playlist.id)"
        >
          <span class="playlist__cover">
            <img v-if="playlist.cover" :src="playlist.cover" alt="" referrerpolicy="no-referrer" />
            <AppIcon v-else name="disc" :size="28" />
            <span class="playlist__count tabular">{{ playlist.count }} 首</span>
          </span>
          <span class="playlist__name">{{ playlist.name }}</span>
          <span class="playlist__meta">by {{ playlist.creator }}</span>
        </button>
      </div>

      <div v-else class="panel">
        <EmptyState
          compact
          icon="disc"
          title="还没有收藏的歌单"
          description="在酷狗客户端收藏别人的歌单后，这里会自动同步。"
        />
      </div>
    </section>
  </PageShell>
</template>

<style scoped>
.block + .block {
  margin-top: 26px;
}

.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.block__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.block__count {
  font-size: 11px;
  color: var(--text-3);
}

.error {
  margin-bottom: 12px;
  padding: 10px 14px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
  font-size: 12px;
  color: var(--err);
}

/* 歌手是圆形头像 + 名字，一列能放更多，所以栅格比歌单密 */
.artists {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 12px;
}

.artist {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 10px 14px;
  border-radius: var(--r-md);
  text-align: center;
}

.artist__avatar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  border: 1px solid var(--stroke);
  background:
    radial-gradient(circle at 30% 20%, rgba(44, 230, 230, 0.22), transparent 60%),
    linear-gradient(140deg, rgba(45, 127, 249, 0.24), rgba(124, 92, 255, 0.16));
  color: var(--text-3);
  overflow: hidden;
}

.artist__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.artist__name {
  width: 100%;
  font-size: 12px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artist__line {
  width: 60%;
  height: 9px;
  border-radius: 999px;
}

.playlists {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 14px;
}

.playlist {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r-md);
  text-align: left;
}

.playlist__cover {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: var(--r-sm);
  background:
    radial-gradient(circle at 30% 20%, rgba(44, 230, 230, 0.2), transparent 60%),
    linear-gradient(140deg, rgba(45, 127, 249, 0.24), rgba(124, 92, 255, 0.16));
  color: var(--text-3);
  overflow: hidden;
}

.playlist__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.playlist__count {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 9.5px;
  color: #fff;
}

.playlist__name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist__meta {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist__line {
  height: 9px;
  border-radius: 999px;
}
</style>
