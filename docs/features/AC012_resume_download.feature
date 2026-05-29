Feature: AC-012 断点续传下载
  作为用户
  我希望下载任务能支持断点续传和 m3u8 片段并发下载
  以便在网络不稳定时也能完成视频下载

  Background:
    Given 下载根目录已配置
    And 存在一个可用的采集站点

  Scenario: HTTP Range 断点续传直接下载
    Given 存在一个已创建的直接下载任务，已下载 1024 字节
    And 服务端支持 Range 请求
    When 下载 worker 执行该任务
    Then 请求头包含 "Range: bytes=1024-"
    And 新下载的数据追加写入文件末尾
    And 任务完成后状态变为 done

  Scenario: 直接下载遇到 404 时标记资源失效
    Given 存在一个直接下载任务
    And 服务端返回 HTTP 404
    When 下载 worker 执行该任务
    Then 任务状态变为 error
    And 错误信息包含 "file_removed"

  Scenario: 直接下载遇到服务端 500 错误时标记站点不可用
    Given 存在一个直接下载任务
    And 服务端返回 HTTP 502
    When 下载 worker 执行该任务
    Then 任务状态变为 error
    And 错误信息包含 "site_unavailable"

  Scenario: m3u8 .ts 片段并发下载并跳过已存在片段
    Given 存在一个 m3u8 下载任务，总片段数为 10
    And 已有 3 个 .ts 片段下载完成
    When 下载 worker 执行该任务
    Then 并发下载剩余 7 个片段，并发数不超过 5
    And 已存在的 3 个片段被跳过
    And 已下载片段数和字节数正确累加

  Scenario: m3u8 下载完成后使用 ffmpeg 合并
    Given 存在一个 m3u8 下载任务，所有 .ts 片段已下载完成
    And 系统已安装 ffmpeg
    When 下载 worker 执行合并
    Then 调用 ffmpeg 生成最终 mp4 文件
    And 任务状态变为 done

  Scenario: ffmpeg 不可用时降级为二进制拼接
    Given 存在一个 m3u8 下载任务，所有 .ts 片段已下载完成
    And 系统未安装 ffmpeg
    When 下载 worker 执行合并
    Then 按顺序直接拼接所有 .ts 片段为 mp4 文件
    And 任务状态变为 done

  Scenario: m3u8 下载过程中暂停
    Given 存在一个 m3u8 下载任务，正在下载中
    When 调用 pause 暂停任务
    Then worker 在检测到暂停状态后退出当前下载
    And 任务状态变为 paused
    And 已下载进度被保存

  Scenario: m3u8 部分 .ts 片段下载失败
    Given 存在一个 m3u8 下载任务，共 10 个片段
    And 其中 2 个片段因网络问题无法下载
    When 下载 worker 执行该任务
    Then 任务状态变为 error
    And 错误信息包含 "2/10 个 .ts 片段下载失败"

  Scenario: m3u8 master playlist 自动选择最高带宽子流
    Given 存在一个 m3u8 下载任务，主播放列表包含多个带宽子流
    When 下载 worker 解析 m3u8
    Then 选择带宽最高的子流继续下载
