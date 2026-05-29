Feature: AC-015 前端 IndexedDB 缓存
  作为用户
  我希望前端缓存聚合列表、详情和选集数据
  并在启动时自动清理过期缓存

  Scenario: 聚合列表缓存
    When 用户浏览首页
    Then 首次请求后数据存入 IndexedDB aggregated store
    And 5 分钟内再次访问同一页时直接从 IndexedDB 读取

  Scenario: 详情缓存
    When 用户查看视频详情
    Then 详情数据存入 IndexedDB detail store
    And 10 分钟内再次查看同一视频时直接从 IndexedDB 读取

  Scenario: 启动时清理过期缓存
    Given IndexedDB 中存在过期数据
    When 应用启动时
    Then 系统自动遍历所有 store 并删除超过 TTL 的条目
