/**
 * 把 KuGouMusicApi 准备成「能随安装包分发」的形态
 *
 * 为什么不能直接把 ../KuGouMusicApi 塞进 extraResources：
 * 它的 node_modules 是 pnpm 布局，每个包都是指向 D:/project/... 的**绝对符号链接**，
 * 复制到别人机器上全部失效（MODULE_NOT_FOUND）。所以这里只复制源码，
 * 再用 npm 在生产模式装一份扁平的 node_modules。
 *
 * 产物：build/upstream/ —— electron-builder 通过 extraResources 放到
 * resources/KuGouMusicApi，Main 进程的 resolveApiDir() 正好找这个位置。
 *
 * 用法：
 *   node scripts/prepare-upstream.mjs          # 默认取同级目录 ../KuGouMusicApi
 *   KUGOU_API_DIR=/path/to/api node scripts/prepare-upstream.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.env.KUGOU_API_DIR
  ? path.resolve(process.env.KUGOU_API_DIR)
  : path.resolve(root, '..', 'KuGouMusicApi')
const target = path.join(root, 'build', 'upstream')

/** 只复制运行必需的东西：入口、路由模块、工具、静态资源、配置 */
const ENTRIES = ['app.js', 'server.js', 'main.js', 'index.js', 'package.json', '.env', 'module', 'util', 'public']

function fail(message) {
  console.error(`[prepare-upstream] ${message}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(source, 'app.js'))) {
  fail(`未找到上游工程：${source}（可用 KUGOU_API_DIR 指定）`)
}

console.log(`[prepare-upstream] 源目录：${source}`)
console.log(`[prepare-upstream] 输出：${target}`)

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })

for (const entry of ENTRIES) {
  const from = path.join(source, entry)
  if (!fs.existsSync(from)) {
    console.warn(`[prepare-upstream] 跳过不存在的条目：${entry}`)
    continue
  }
  fs.cpSync(from, path.join(target, entry), { recursive: true })
}

// 只保留运行时依赖：devDependencies 里的 pkg / typescript / nodemon 有几十 MB，
// 且对运行毫无用处
const sourcePkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
const runtimePkg = {
  name: sourcePkg.name,
  version: sourcePkg.version,
  private: true,
  main: sourcePkg.main,
  dependencies: sourcePkg.dependencies ?? {},
}
fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(runtimePkg, null, 2)}\n`, 'utf8')

console.log('[prepare-upstream] 安装生产依赖（npm，扁平 node_modules）…')
try {
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: target,
    stdio: 'inherit',
    // Windows 上 npm 是 npm.cmd，必须走 shell 才能被 execFileSync 找到
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: 'production' },
  })
} catch (error) {
  fail(`依赖安装失败：${error instanceof Error ? error.message : String(error)}`)
}

const size = (dir) => {
  let total = 0
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) total += size(full)
    else if (item.isFile()) total += fs.statSync(full).size
  }
  return total
}

console.log(`[prepare-upstream] 完成，体积约 ${(size(target) / 1024 / 1024).toFixed(1)} MB`)
