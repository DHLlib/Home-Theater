# 验收条件（Acceptance Criteria）

> 状态: 活跃（与当前代码同步）

---

## AC-001 站点管理

**Given** 用户访问设置页
**When** 添加/编辑/删除站点
**Then** 站点配置持久化到 SQLite
**And** 支持探测站点健康状态

---

## AC-002 分类映射（互斥约束）

**Given** 站点已拉取分类列表
**When** 用户映射系统分类到站点分类
**Then** 同一 remote_id 只能属于一个系统分类
**And** 前端 occupancy map 实时置灰已占用分类

---

## AC-003 首页视频聚合列表

**Given** 后台已完成视频刮削
**When** 用户访问首页
**Then** 返回按 `normalize_title + year` 聚合去重后的视频列表
**And** 同名同年视频合并为一条记录，sources 包含所有来源
**And** 无分类筛选时从预聚合缓存表读取（响应 <100ms）
**And** 有分类筛选时从 VideoCache 实时聚合

---

## AC-004 视频搜索

**Given** 后台已刮削多个站点
**When** 用户输入关键词搜索
**Then** 跨所有站点并发查询并聚合结果
**And** 返回与首页相同的 AggregatedVideo 结构

---

## AC-005 视频详情

**Given** 用户点击某视频卡片
**When** 前端请求详情
**Then** 返回该视频在所有来源的详情（简介、封面、演员、选集）
**And** 用户可显式选择从哪个来源播放或下载

---

## AC-006 播放地址解析

**Given** 资源站返回原始播放字符串
**When** 后端解析集数列表
**Then** 按 `$` 分隔解析为（集数, 地址, 后缀）
**And** feifan/dytt 分享页解析为真实 m3u8 地址
**And** 所有 *m3u8、*yun、360zy、dytt 类后缀统一归一化为 ffm3u8

---

## AC-007 显式选源

**Given** 视频存在多个来源
**When** 用户点击播放或下载
**Then** 系统要求用户先选择来源站点
**And** 禁止自动挑选默认来源

---

## AC-008 ckplayer 播放

**Given** 用户选择来源并点击播放
**When** 播放器加载视频
**Then** 根据后缀选择对应播放器（ckplayer/mp4/m3u8）
**And** HLS 流强制锁定最高码率，避免 ABR 自动降级

---

## AC-009 播放进度记录与恢复

**Given** 用户正在观看视频
**When** 播放进度变化
**Then** 后端记录（视频名 + 年份 + 集数 + 时间戳）
**And** 用户可从历史记录恢复播放

---

## AC-010 收藏管理

**Given** 用户浏览视频列表
**When** 用户点击收藏
**Then** 视频加入收藏列表（按 title + year 去重）
**And** 支持取消收藏

---

## AC-011 下载任务管理

**Given** 用户选择来源并点击下载
**When** 系统创建下载任务
**Then** 支持断点续传（HTTP Range）
**And** 支持暂停/继续
**And** 下载根目录从配置读取，不重复询问用户

---

## AC-012 断点续传下载

**Given** 下载任务已暂停或中断
**When** 用户恢复下载
**Then** 从已下载位置继续（Range 请求）
**And** 状态通过 SSE 实时推送到前端

---

## AC-013 站点健康监控与自动禁用

**Given** 后端定时探测站点
**When** 站点连续失败 3 次
**Then** 自动禁用该站点
**And** 连续成功 2 次后自动恢复

---

## AC-014 VideoCache 缓存管理

**Given** 后端执行刮削
**When** 写入 VideoCache
**Then** 完整保留所有数据（无 5000 行上限）
**And** 按 `source_updated_at` 排序（非 `cached_at`）

---

## AC-015 前端 IndexedDB 缓存

**Given** 用户浏览首页
**When** 数据加载完成
**Then** 自动缓存到 IndexedDB（aggregated/detail/episodes）
**And** TTL 过期后自动清理
**And** IndexedDB 操作 3 秒超时，不阻塞 UI
**And** 缓存写入 fire-and-forget，不影响 loading 状态

---

## AC-016 下载进度实时推送（SSE）

**Given** 用户打开下载页面
**When** 下载器进度发生变化
**Then** 前端通过 SSE 实时收到进度更新，无需轮询

---

## AC-017 局域网部署与静态托管

**Given** 后端绑定 0.0.0.0
**When** 前端构建为静态文件
**Then** 后端通过 FastAPI StaticFiles 托管 dist
**And** 局域网内所有设备可通过 IP:8181 访问
