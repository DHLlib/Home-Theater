gaps:
  - id: GAP-001
    description: 无自动化测试
    severity: high
    impact: 代码变更无回归保护，bug 需人工发现
    files: []
    test_coverage: 0%

  - id: GAP-002
    description: API 响应缺少 OpenAPI schema 扩展描述
    severity: low
    impact: 前端类型与后端可能不同步
    files: [backend/app/schemas.py]

  - id: GAP-003
    description: VideoCard 封面懒加载可能请求过多 detail API
    severity: medium
    impact: 首页滚动时并发请求量大
    files: [frontend/src/components/VideoCard.tsx]

  - id: GAP-004
    description: 下载器缺少限速/带宽控制
    severity: low
    impact: 大文件下载可能占满带宽
    files: [backend/app/services/downloader.py]

  - id: GAP-005
    description: SSE 事件总线仅内存实现，不支持多实例
    severity: low
    impact: 当前单进程运行无问题，扩展时需替换
    files: [backend/app/services/event_bus.py]
